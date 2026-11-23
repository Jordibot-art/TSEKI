import { supabase } from "./supabase";
import {
  TEACHER_VERIFICATION_BUCKET,
  type TeacherRegistrationProfile,
} from "./teacherRegistration";

export interface WebVerificationPhotoFiles {
  idFront: Blob;
  idBack: Blob;
  selfie: Blob;
}

/**
 * Resizes and compresses a browser image File/Blob to JPEG using an offscreen Canvas
 * (max width 1400px, quality 0.8 -> ~150-300 KB) so Supabase Storage usage stays tiny.
 */
async function compressImageBlobToJpeg(blob: Blob, maxWidth = 1400): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(blob);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        canvas.toBlob(
          (out) => {
            URL.revokeObjectURL(url);
            resolve(out || blob);
          },
          "image/jpeg",
          0.8
        );
      } catch {
        URL.revokeObjectURL(url);
        resolve(blob);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}

async function uploadSingleWebPhoto(
  userId: string,
  fileName: string,
  fileBlob: Blob,
  maxWidth: number
): Promise<string> {
  const compressed = await compressImageBlobToJpeg(fileBlob, maxWidth);
  const storagePath = `${userId}/${fileName}`;

  const { error } = await supabase.storage
    .from(TEACHER_VERIFICATION_BUCKET)
    .upload(storagePath, compressed, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (error) {
    const msg = error.message || "Upload failed";
    if (msg.toLowerCase().includes("bucket") && msg.toLowerCase().includes("not found")) {
      throw new Error(
        `Supabase Storage bucket "${TEACHER_VERIFICATION_BUCKET}" has not been created yet. Run migrations/enhance_teacher_registration_verification.sql in Supabase SQL Editor.`
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

export async function submitWebTeacherVerification(params: {
  userId: string;
  profile: TeacherRegistrationProfile;
  photos: WebVerificationPhotoFiles;
  onProgress?: (msg: string) => void;
}): Promise<{ idFrontPath: string; idBackPath: string; selfiePath: string }> {
  const { userId, profile, photos, onProgress } = params;

  onProgress?.("Uploading Physical Teacher ID (Front)...");
  const idFrontPath = await uploadSingleWebPhoto(userId, "id-front.jpg", photos.idFront, 1400);

  onProgress?.("Uploading Physical Teacher ID (Back)...");
  const idBackPath = await uploadSingleWebPhoto(userId, "id-back.jpg", photos.idBack, 1400);

  onProgress?.("Uploading Face Verification Selfie...");
  const selfiePath = await uploadSingleWebPhoto(userId, "selfie.jpg", photos.selfie, 1080);

  onProgress?.("Saving teacher registration for admin review...");

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

  const { error: rpcErr } = await supabase.rpc("submit_teacher_verification", {
    p_payload: extendedRow,
  });

  if (!rpcErr) {
    return { idFrontPath, idBackPath, selfiePath };
  }

  let { error: dbErr } = await supabase
    .from("teachers")
    .upsert(extendedRow, { onConflict: "email" });

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
