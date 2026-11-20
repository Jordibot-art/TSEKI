export const DELETE_OTP_LENGTH = 6;

/**
 * Strips non-numeric characters and caps the OTP input to 6 digits.
 */
export function normalizeOtpCode(raw: string): string {
    return (raw || "").replace(/[^0-9]/g, "").slice(0, DELETE_OTP_LENGTH);
}

/**
 * True only when the OTP code contains exactly 6 numeric digits.
 */
export function isValidOtpCode(code: string): boolean {
    return /^\d{6}$/.test((code || "").trim());
}

/**
 * Confirms the verified auth account email matches the teacher's logged-in email.
 */
export function isVerifiedEmailMatch(
    expectedEmail?: string | null,
    verifiedEmail?: string | null
): boolean {
    const a = (expectedEmail || "").trim().toLowerCase();
    const b = (verifiedEmail || "").trim().toLowerCase();
    return Boolean(a && b && a === b);
}

/**
 * Extracts Supabase's retry cooldown in seconds when an OTP was recently requested.
 */
export function extractCooldownSeconds(errorMessage?: string | null): number | null {
    const msg = (errorMessage || "").toLowerCase();
    if (!msg) return null;
    const match = msg.match(/after\s+(\d+)\s*second/);
    if (match) {
        const secs = Number(match[1]);
        if (Number.isFinite(secs) && secs > 0) return secs;
    }
    if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("security purposes")) {
        return 60;
    }
    return null;
}

/**
 * Retrieves the currently logged-in teacher's email address from Supabase Auth.
 */
export async function getLoggedInTeacherEmail(): Promise<string | null> {
    try {
        const { supabase } = await import("../supabase");
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.email) {
            return userData.user.email.trim();
        }
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.email) {
            return sessionData.session.user.email.trim();
        }
    } catch (err) {
        console.warn("[DeleteVerify] Failed to fetch logged-in email:", err);
    }
    return null;
}

/**
 * Sends a 6-digit email verification code via Supabase Auth to the logged-in teacher's email.
 */
export async function sendDeleteVerificationOtp(email: string): Promise<{
    sent: boolean;
    alreadyRecentlySent?: boolean;
    cooldownSeconds?: number;
    error?: string;
}> {
    const cleanEmail = (email || "").trim();
    if (!cleanEmail) {
        return { sent: false, error: "No logged-in email address was found for your account." };
    }

    try {
        const { supabase } = await import("../supabase");
        const { error } = await supabase.auth.signInWithOtp({
            email: cleanEmail,
            options: {
                shouldCreateUser: false,
            },
        });

        if (error) {
            const cooldown = extractCooldownSeconds(error.message);
            if (cooldown !== null) {
                return {
                    sent: true,
                    alreadyRecentlySent: true,
                    cooldownSeconds: cooldown,
                };
            }
            return {
                sent: false,
                error: error.message || "Could not send verification code to your email.",
            };
        }

        return { sent: true, cooldownSeconds: 60 };
    } catch (err: any) {
        return {
            sent: false,
            error: err?.message || "Network error while sending verification email.",
        };
    }
}

/**
 * Extracts a Supabase verification `token_hash` (or `token`) if the user pasted a
 * magic-link URL (e.g. `https://<proj>.supabase.co/auth/v1/verify?token=...&type=magiclink`)
 * before their Supabase Magic Link template was updated to include `{{ .Token }}`.
 */
export function extractTokenHashFromMagicLink(rawInput?: string | null): string | null {
    const trimmed = (rawInput || "").trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

    try {
        const match = trimmed.match(/[?&](?:token_hash|token)=([^&#]+)/i);
        if (!match?.[1]) return null;
        const decoded = decodeURIComponent(match[1]).trim();
        return decoded.length >= 16 ? decoded : null;
    } catch {
        return null;
    }
}

/**
 * Verifies either a 6-digit email OTP code OR a copied Supabase verification link
 * against Supabase Auth for the logged-in teacher's email.
 */
export async function verifyDeleteOtpCode(
    email: string,
    rawTokenOrLink: string
): Promise<{ verified: boolean; error?: string }> {
    const cleanEmail = (email || "").trim();
    const rawInput = (rawTokenOrLink || "").trim();

    if (!cleanEmail) {
        return { verified: false, error: "Missing logged-in account email." };
    }

    const tokenHashFromLink = extractTokenHashFromMagicLink(rawInput);
    const otpDigits = normalizeOtpCode(rawInput);

    if (!tokenHashFromLink && !isValidOtpCode(otpDigits)) {
        return { verified: false, error: "Enter the 6-digit code from your email." };
    }

    try {
        const { supabase } = await import("../supabase");
        let data: any = null;
        let error: any = null;

        if (tokenHashFromLink) {
            const first = await supabase.auth.verifyOtp({
                token_hash: tokenHashFromLink,
                type: "magiclink",
            });
            data = first.data;
            error = first.error;

            if (error) {
                const second = await supabase.auth.verifyOtp({
                    token_hash: tokenHashFromLink,
                    type: "email",
                });
                data = second.data;
                error = second.error;
            }
        } else {
            const first = await supabase.auth.verifyOtp({
                email: cleanEmail,
                token: otpDigits,
                type: "email",
            });
            data = first.data;
            error = first.error;

            if (error) {
                const second = await supabase.auth.verifyOtp({
                    email: cleanEmail,
                    token: otpDigits,
                    type: "magiclink",
                });
                data = second.data;
                error = second.error;
            }
        }

        if (error) {
            return {
                verified: false,
                error: tokenHashFromLink
                    ? "That link is invalid or expired. Request a new email and try again."
                    : "Invalid or expired code. Please check your email and try again.",
            };
        }

        const verifiedEmail = data?.user?.email || data?.session?.user?.email || null;
        if (!isVerifiedEmailMatch(cleanEmail, verifiedEmail)) {
            return {
                verified: false,
                error: "Verification did not match your logged-in email.",
            };
        }

        return { verified: true };
    } catch (err: any) {
        return {
            verified: false,
            error: err?.message || "Verification failed. Please try again.",
        };
    }
}
