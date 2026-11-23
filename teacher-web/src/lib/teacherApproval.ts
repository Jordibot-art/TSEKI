// AUTO-SYNCED FROM /shared — edit the canonical file in /shared and run `npm run sync:shared`.
/**
 * Shared Teacher Account Approval Status Checker
 *
 * Evaluates a row from `public.teachers` against TSEKI's admin approval states:
 * - 'approved'  -> allowed
 * - 'pending'   -> blocked until admin approves
 * - 'rejected'  -> blocked (displays rejection_reason if present)
 * - 'suspended' -> blocked until admin re-enables
 * - null/absent -> allowed (grandfathers legacy accounts created before Admin Portal)
 */

export type TeacherApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "needs_verification";

export interface TeacherApprovalRow {
  status?: string | null;
  rejection_reason?: string | null;
  school_id_url?: string | null;
  school_id_back_url?: string | null;
  facial_verification_url?: string | null;
}

export interface TeacherApprovalCheckResult {
  allowed: boolean;
  status: TeacherApprovalStatus | "legacy";
  needsIdentityVerification?: boolean;
  title?: string;
  message?: string;
}

export function evaluateTeacherApprovalRow(
  row: TeacherApprovalRow | null | undefined,
  userMetadata?: Record<string, unknown> | null
): TeacherApprovalCheckResult {
  // If no teachers row exists yet, check whether the user started the new 2-step registration
  // and needs to finish Step 2 (ID Front/Back + Face Selfie upload).
  if (!row || !row.status) {
    if (userMetadata && userMetadata.needs_identity_verification === true) {
      return {
        allowed: false,
        status: "needs_verification",
        needsIdentityVerification: true,
        title: "Complete Identity Verification",
        message:
          "Please complete Step 2 by uploading your Physical Teacher ID (Front & Back) and Face Selfie so your school admin can verify your account.",
      };
    }
    if (
      userMetadata &&
      (userMetadata.needs_identity_verification === false ||
        userMetadata.registration_status === "pending")
    ) {
      return {
        allowed: false,
        status: "pending",
        title: "Account Pending Approval",
        message:
          "Your teacher registration is currently awaiting administrator approval. Please check back once your account has been verified.",
      };
    }
    return { allowed: true, status: "legacy" };
  }

  const normalized = String(row.status).trim().toLowerCase();

  if (normalized === "approved") {
    return { allowed: true, status: "approved" };
  }

  if (normalized === "pending") {
    const missingRequiredDocs =
      userMetadata?.needs_identity_verification === true &&
      (!row.school_id_url || !row.facial_verification_url);
    if (missingRequiredDocs) {
      return {
        allowed: false,
        status: "needs_verification",
        needsIdentityVerification: true,
        title: "Complete Identity Verification",
        message:
          "Please finish uploading your Physical Teacher ID (Front & Back) and Face Selfie to submit your application for admin approval.",
      };
    }

    return {
      allowed: false,
      status: "pending",
      title: "Account Pending Approval",
      message:
        "Your teacher registration is currently awaiting administrator approval. Please check back once your account has been verified.",
    };
  }

  if (normalized === "rejected") {
    const reason = (row.rejection_reason || "").trim();
    return {
      allowed: false,
      status: "rejected",
      title: "Registration Rejected",
      message: reason
        ? `Your teacher registration was rejected by an administrator.\n\nReason: ${reason}`
        : "Your teacher registration was rejected by an administrator. Please contact your school admin for assistance.",
    };
  }

  if (normalized === "suspended") {
    return {
      allowed: false,
      status: "suspended",
      title: "Account Suspended",
      message:
        "Your teacher account has been suspended by an administrator. Please contact your school admin to restore access.",
    };
  }

  // Unknown future status: do not silently lock out unless explicitly restricted
  return { allowed: true, status: "legacy" };
}

export interface SupabaseLikeClient {
  from: (table: string) => any;
}

/**
 * Checks the signed-in teacher's approval status in `public.teachers`.
 * Fails open gracefully if offline or if the `teachers` table is not yet migrated,
 * so existing classrooms remain accessible without false lockouts.
 */
export async function checkTeacherAccountApproval(
  supabaseClient: SupabaseLikeClient,
  userId?: string | null,
  userMetadata?: Record<string, unknown> | null
): Promise<TeacherApprovalCheckResult> {
  if (!userId) {
    return { allowed: true, status: "legacy" };
  }

  try {
    let { data, error } = await supabaseClient
      .from("teachers")
      .select("status, rejection_reason, school_id_url, school_id_back_url, facial_verification_url")
      .eq("user_id", userId)
      .maybeSingle();

    // Backwards compatibility if migration adding school_id_back_url isn't applied yet
    if (error && String(error.message || "").includes("school_id_back_url")) {
      const fallback = await supabaseClient
        .from("teachers")
        .select("status, rejection_reason, school_id_url, facial_verification_url")
        .eq("user_id", userId)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      if (userMetadata && userMetadata.needs_identity_verification === true) {
        return evaluateTeacherApprovalRow(null, userMetadata);
      }
      // Table not created yet, RLS/network error, or offline -> avoid false lockouts
      return { allowed: true, status: "legacy" };
    }

    return evaluateTeacherApprovalRow(data as TeacherApprovalRow | null, userMetadata);
  } catch {
    return { allowed: true, status: "legacy" };
  }
}
