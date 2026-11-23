import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "../supabase";
import {
  TEACHER_VERIFICATION_BUCKET,
  type TeacherRegistrationProfile,
} from "../shared/teacherRegistration";

export interface VerificationPhotoSet {
  idFrontUri: string;
  idBackUri: string;
  selfieUri: string;
}

export interface SubmittedVerificationResult {
  idFrontPath: string;
  idBackPath: string;
  selfiePath: string;
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const clean = base64
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "")
    .replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Resizes and JPEG-compresses a local photo (max 1280px wide, 0.78 quality -> ~180–280 KB)
 * using Expo SDK 54 ImageManipulator so Supabase Storage uploads stay fast and lightweight.
 */
async function compressPhotoToJpegBytes(
  uri: string,
  maxWidth = 1280
): Promise<Uint8Array> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: maxWidth });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.78,
      base64: true,
    });

    if (saved.base64 && saved.base64.length > 100) {
      return decodeBase64ToUint8Array(saved.base64);
    }

    const fallbackB64 = await FileSystem.readAsStringAsync(saved.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return decodeBase64ToUint8Array(fallbackB64);
  } catch {
    // Fallback: read raw file directly if image manipulator cannot resize (e.g., already small)
    const rawB64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return decodeBase64ToUint8Array(rawB64);
  }
}

async function uploadSinglePhoto(
  userId: string,
  fileName: string,
  localUri: string,
  maxWidth: number
): Promise<string> {
  const bytes = await compressPhotoToJpegBytes(localUri, maxWidth);
  if (!bytes || bytes.byteLength < 100) {
    throw new Error(
      `Could not read ${fileName}. Please retake or select the photo again.`
    );
  }

  const storagePath = `${userId}/${fileName}`;
  const { error } = await supabase.storage
    .from(TEACHER_VERIFICATION_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (error) {
    const msg = error.message || "Upload failed";
    if (
      msg.toLowerCase().includes("bucket") &&
      msg.toLowerCase().includes("not found")
    ) {
      throw new Error(
        `Supabase Storage bucket "${TEACHER_VERIFICATION_BUCKET}" has not been created yet. Please run migrations/enhance_teacher_registration_verification.sql in Supabase SQL Editor.`
      );
    }
    throw new Error(`Failed to upload ${fileName}: ${msg}`);
  }

  return `${TEACHER_VERIFICATION_BUCKET}/${storagePath}`;
}

function isRlsPolicyError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42501") return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("row-level security") || msg.includes("violates row-level security");
}

/**
 * Uploads Teacher ID Front, Teacher ID Back, and Face Selfie to private Supabase Storage
 * (`teacher-verification-docs/<userId>/*`) and saves the pending teacher application row
 * in `public.teachers`.
 */
export async function submitTeacherVerification(params: {
  userId: string;
  profile: TeacherRegistrationProfile;
  photos: VerificationPhotoSet;
  onProgress?: (status: string) => void;
}): Promise<SubmittedVerificationResult> {
  const { userId, profile, photos, onProgress } = params;

  onProgress?.("Uploading Physical Teacher ID (Front)...");
  const idFrontPath = await uploadSinglePhoto(
    userId,
    "id-front.jpg",
    photos.idFrontUri,
    1400
  );

  onProgress?.("Uploading Physical Teacher ID (Back)...");
  const idBackPath = await uploadSinglePhoto(
    userId,
    "id-back.jpg",
    photos.idBackUri,
    1400
  );

  onProgress?.("Uploading Face Verification Selfie...");
  const selfiePath = await uploadSinglePhoto(
    userId,
    "selfie.jpg",
    photos.selfieUri,
    1080
  );

  onProgress?.("Submitting teacher registration for admin approval...");

  const username = profile.email.includes("@")
    ? profile.email.split("@")[0]
    : profile.fullName.toLowerCase().replace(/\s+/g, ".");

  const extendedRow = {
    user_id: userId,
    username,
    email: profile.email.toLowerCase(),
    full_name: profile.fullName,
    first_name: profile.firstName,
    middle_name: profile.middleName || null,
    last_name: profile.lastName,
    school_name: profile.schoolName,
    teacher_id: profile.teacherId,
    grade_level: profile.gradeLevelSummary || profile.gradeLevels.join(", "),
    grade_levels: profile.gradeLevels,
    subject: profile.subjectsSummary,
    strand: profile.subjectsSummary,
    subjects: profile.subjects,
    school_id_url: idFrontPath,
    school_id_back_url: idBackPath,
    facial_verification_url: selfiePath,
    status: "pending",
    rejection_reason: null,
  };

  // 1. Always persist complete verification record & photo paths in auth user_metadata first
  let metadataSaved = false;
  try {
    const { error: metaErr } = await supabase.auth.updateUser({
      data: {
        needs_identity_verification: false,
        registration_status: "pending",
        full_name: profile.fullName,
        first_name: profile.firstName,
        middle_name: profile.middleName || null,
        last_name: profile.lastName,
        school_name: profile.schoolName,
        teacher_id: profile.teacherId,
        grade_level: profile.gradeLevelSummary,
        grade_levels: profile.gradeLevels,
        subject: profile.subjectsSummary,
        strand: profile.subjectsSummary,
        subjects: profile.subjects,
        school_id_url: idFrontPath,
        school_id_back_url: idBackPath,
        facial_verification_url: selfiePath,
      },
    });
    metadataSaved = !metaErr;
  } catch {
    // non-fatal
  }

  // 2. Try SECURITY DEFINER RPC first (safely re-binds orphaned email rows with user_id = NULL)
  const { error: rpcErr } = await supabase.rpc("submit_teacher_verification", {
    p_payload: extendedRow,
  });

  if (!rpcErr) {
    return { idFrontPath, idBackPath, selfiePath };
  }

  // 3. Fallback to direct table upsert when RPC is not yet installed
  let { error: dbErr } = await supabase
    .from("teachers")
    .upsert(extendedRow, { onConflict: "email" });

  // Graceful backwards-compatible fallback if new SQL columns aren't migrated yet
  if (
    dbErr &&
    (dbErr.code === "PGRST204" ||
      String(dbErr.message || "").includes("school_id_back_url") ||
      String(dbErr.message || "").includes("school_name") ||
      String(dbErr.message || "").includes("grade_levels"))
  ) {
    const legacyRow = {
      user_id: userId,
      username,
      email: profile.email.toLowerCase(),
      full_name: profile.fullName,
      teacher_id: profile.teacherId,
      grade_level: profile.gradeLevelSummary || profile.gradeLevels.join(", "),
      subject: profile.subjectsSummary,
      strand: profile.subjectsSummary,
      school_id_url: idFrontPath,
      facial_verification_url: selfiePath,
      status: "pending",
      rejection_reason: null,
    };
    const retry = await supabase
      .from("teachers")
      .upsert(legacyRow, { onConflict: "email" });
    dbErr = retry.error;
  }

  // If direct table upsert hit an RLS conflict on an orphaned row (e.g., previous Auth user
  // with the same email was deleted in Supabase Auth leaving user_id = NULL), try update by
  // user_id; if metadataSaved is true, Admin Portal's service_role sync automatically links
  // the orphaned teachers row from auth.users metadata.
  if (dbErr && isRlsPolicyError(dbErr)) {
    const { error: updateOwnErr, count } = await supabase
      .from("teachers")
      .update(extendedRow, { count: "exact" })
      .eq("user_id", userId);
    if (!updateOwnErr && (count ?? 0) > 0) {
      dbErr = null;
    } else if (metadataSaved) {
      dbErr = null;
    }
  }

  if (dbErr) {
    throw new Error(`Could not save registration record: ${dbErr.message}`);
  }

  return { idFrontPath, idBackPath, selfiePath };
}

/**
 * Cancels an incomplete Step 2 teacher registration by removing any partial uploaded
 * verification photos and calling the `cancel_incomplete_teacher_registration` RPC
 * to delete the incomplete `auth.users` account and unsubmitted draft row, so the
 * email can immediately be used to register again.
 */
export async function cancelIncompleteTeacherRegistration(
  userId?: string | null
): Promise<void> {
  const uid =
    userId || (await supabase.auth.getSession()).data?.session?.user?.id || null;

  if (uid) {
    try {
      await supabase.storage
        .from(TEACHER_VERIFICATION_BUCKET)
        .remove([
          `${uid}/id-front.jpg`,
          `${uid}/id-back.jpg`,
          `${uid}/selfie.jpg`,
        ]);
    } catch {
      // Best-effort cleanup of any partial uploads
    }
  }

  const { error } = await supabase.rpc("cancel_incomplete_teacher_registration");
  if (error) {
    const msg = String(error.message || "");
    if (
      error.code === "PGRST202" ||
      msg.toLowerCase().includes("could not find the function") ||
      msg.toLowerCase().includes("does not exist")
    ) {
      throw new Error(
        "Database cleanup function is not installed yet. Please run migrations/cancel_incomplete_teacher_registration.sql in Supabase SQL Editor."
      );
    }
    throw new Error(msg || "Could not cancel incomplete registration.");
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore local sign-out errors after server-side user deletion
  }
}
