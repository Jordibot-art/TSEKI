import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../supabase";
import { AI_QUOTA_CONFIG, getManilaDateString, getManilaDayBoundsIso } from "./aiQuotaConfig";

export { getManilaDateString, getManilaDayBoundsIso };

export interface QuotaState {
    teacherId: string | null;
    manilaDate: string;
    dailyLimit: number;
    usedToday: number;
    remainingToday: number;
    cooldownSecondsRemaining: number;
    isDailyLimitReached: boolean;
    isCooldownActive: boolean;
    isBurstLimited: boolean;
}

interface LocalQuotaStore {
    teacherId: string;
    manilaDate: string;
    usedCount: number;
    pendingUnsyncedCount: number;
    lastAttemptTimestamp: number;
    recentAttemptTimestamps: number[];
    cooldownUntil: number;
    testResetTimestamp?: number;
}

/**
 * Resolves the currently authenticated user's UUID (`teacher_id`).
 * Checks local session first (0 ms) and falls back to `supabase.auth.getUser()`.
 */
export async function resolveCurrentTeacherId(explicitTeacherId?: string | null): Promise<string | null> {
    if (explicitTeacherId && explicitTeacherId.trim().length > 0) {
        return explicitTeacherId.trim();
    }
    try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
            return sessionData.session.user.id;
        }
        const { data: userData } = await supabase.auth.getUser();
        return userData?.user?.id || null;
    } catch {
        return null;
    }
}

/**
 * Builds a per-user, per-Manila-day storage key so User 1 and User 2 never share local quota state,
 * and each new day at 12:00 AM Manila starts clean.
 */
function getStorageKey(teacherId: string, manilaDate: string): string {
    return `@tseki_ai_quota_v2_${teacherId}_${manilaDate}`;
}

/**
 * Reads local quota store for a specific `(teacherId, manilaDate)`.
 */
async function readLocalStore(teacherId: string, manilaDate: string): Promise<LocalQuotaStore> {
    const key = getStorageKey(teacherId, manilaDate);
    try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
            const data: LocalQuotaStore = JSON.parse(raw);
            if (data.manilaDate === manilaDate && data.teacherId === teacherId) {
                return {
                    ...data,
                    pendingUnsyncedCount: data.pendingUnsyncedCount || 0,
                    testResetTimestamp: data.testResetTimestamp || 0,
                };
            }
        }
    } catch {
        // ignore and return fresh state
    }

    return {
        teacherId,
        manilaDate,
        usedCount: 0,
        pendingUnsyncedCount: 0,
        lastAttemptTimestamp: 0,
        recentAttemptTimestamps: [],
        cooldownUntil: 0,
        testResetTimestamp: 0,
    };
}

/**
 * Saves local quota store for a specific `(teacherId, manilaDate)`.
 */
async function saveLocalStore(store: LocalQuotaStore): Promise<void> {
    const key = getStorageKey(store.teacherId, store.manilaDate);
    try {
        await AsyncStorage.setItem(key, JSON.stringify(store));
    } catch {
        // ignore
    }
}

function pruneRecentAttempts(timestamps: number[], windowMinutes: number): number[] {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    return timestamps.filter((t) => t > cutoff);
}

/**
 * Fetches the current quota state for the authenticated user (`teacher_id`),
 * querying `public.ai_generation_logs` for today's Manila day window (since 12:00 AM PHT).
 */
export async function getTeacherQuotaState(explicitTeacherId?: string | null): Promise<QuotaState> {
    const teacherId = await resolveCurrentTeacherId(explicitTeacherId);
    const { manilaDate, startIso, endIso } = getManilaDayBoundsIso();

    if (!teacherId) {
        return {
            teacherId: null,
            manilaDate,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
            usedToday: 0,
            remainingToday: AI_QUOTA_CONFIG.DAILY_LIMIT,
            cooldownSecondsRemaining: 0,
            isDailyLimitReached: false,
            isCooldownActive: false,
            isBurstLimited: false,
        };
    }

    const store = await readLocalStore(teacherId, manilaDate);
    store.recentAttemptTimestamps = pruneRecentAttempts(
        store.recentAttemptTimestamps || [],
        AI_QUOTA_CONFIG.BURST_WINDOW_MINUTES
    );

    // Synchronize directly with `public.ai_generation_logs` for this specific `teacher_id` and Manila day
    try {
        // If there are any offline unsynced generations for this teacher today, flush them first
        if (store.pendingUnsyncedCount > 0) {
            const pending = store.pendingUnsyncedCount;
            const rowsToInsert = Array.from({ length: pending }, () => ({
                teacher_id: teacherId,
                action_type: "full_quiz",
                cost: AI_QUOTA_CONFIG.COSTS.FULL_QUIZ,
                status: "success",
            }));
            const { error: flushErr } = await supabase.from("ai_generation_logs").insert(rowsToInsert);
            if (!flushErr) {
                store.pendingUnsyncedCount = 0;
            }
        }

        const queryStartIso = (store.testResetTimestamp && store.testResetTimestamp > new Date(startIso).getTime())
            ? new Date(store.testResetTimestamp).toISOString()
            : startIso;

        const { data: logs, error: logsError } = await supabase
            .from("ai_generation_logs")
            .select("cost")
            .eq("teacher_id", teacherId)
            .eq("status", "success")
            .gte("created_at", queryStartIso)
            .lt("created_at", endIso);

        if (!logsError && Array.isArray(logs)) {
            const serverUsedToday = logs.reduce(
                (sum, row: any) => sum + (typeof row.cost === "number" ? row.cost : 1),
                0
            );
            // Server count for this teacherId + any remaining unsynced local count
            store.usedCount = Math.min(
                AI_QUOTA_CONFIG.DAILY_LIMIT,
                serverUsedToday + (store.pendingUnsyncedCount || 0)
            );
            await saveLocalStore(store);
        }
    } catch {
        // Offline fallback: rely on this teacher's local store for today's Manila date
    }

    const now = Date.now();
    const cooldownRemaining = Math.max(0, Math.ceil((store.cooldownUntil - now) / 1000));
    const secondsSinceLast = Math.max(0, Math.ceil((now - store.lastAttemptTimestamp) / 1000));
    const burstCooldownRemaining =
        AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS > 0 &&
        store.lastAttemptTimestamp > 0 &&
        secondsSinceLast < AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS
            ? AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS - secondsSinceLast
            : 0;

    const effectiveCooldown = Math.max(cooldownRemaining, burstCooldownRemaining);
    const usedToday = Math.min(AI_QUOTA_CONFIG.DAILY_LIMIT, store.usedCount);
    const remainingToday = Math.max(0, AI_QUOTA_CONFIG.DAILY_LIMIT - usedToday);
    const isBurstLimited =
        store.recentAttemptTimestamps.length >= AI_QUOTA_CONFIG.BURST_WINDOW_MAX_ATTEMPTS &&
        remainingToday <= 0;

    return {
        teacherId,
        manilaDate,
        dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        usedToday,
        remainingToday,
        cooldownSecondsRemaining: effectiveCooldown,
        isDailyLimitReached: remainingToday <= 0,
        isCooldownActive: effectiveCooldown > 0,
        isBurstLimited,
    };
}

/**
 * Checks whether the current user (`teacher_id`) can generate a quiz right now.
 * Enforces the 10x daily limit per user resetting at 12:00 AM midnight Manila time.
 */
export async function checkCanGenerate(
    explicitTeacherId?: string | null,
    isSingleQuestion: boolean = false
): Promise<{
    allowed: boolean;
    reason?: "DAILY_LIMIT" | "COOLDOWN" | "BURST_LIMIT";
    message?: string;
    cooldownSeconds?: number;
    usedToday: number;
    remainingToday: number;
    dailyLimit: number;
}> {
    const cost = isSingleQuestion
        ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
        : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

    const state = await getTeacherQuotaState(explicitTeacherId);

    // 1. Per-User 10x Daily Limit Check (resets at 12:00 AM Asia/Manila)
    if (cost > 0 && state.usedToday + cost > AI_QUOTA_CONFIG.DAILY_LIMIT) {
        return {
            allowed: false,
            reason: "DAILY_LIMIT",
            message: `You have used all ${AI_QUOTA_CONFIG.DAILY_LIMIT} of your daily AI quiz generations (${state.usedToday}/${AI_QUOTA_CONFIG.DAILY_LIMIT} used today).\n\nYour 10x generation limit resets automatically at 12:00 AM midnight (Manila, Philippines time).`,
            usedToday: state.usedToday,
            remainingToday: 0,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }

    // 2. Active rate-limit cooldown check
    if (state.cooldownSecondsRemaining > 0) {
        return {
            allowed: false,
            reason: "COOLDOWN",
            message: `Please wait ${state.cooldownSecondsRemaining} seconds before generating another quiz.`,
            cooldownSeconds: state.cooldownSecondsRemaining,
            usedToday: state.usedToday,
            remainingToday: state.remainingToday,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }

    return {
        allowed: true,
        usedToday: state.usedToday,
        remainingToday: state.remainingToday,
        dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
    };
}

/**
 * Records a successful AI generation for the current user (`teacher_id`) in `public.ai_generation_logs`
 * and updates the user's daily quota count for today's Manila date.
 */
export async function recordGenerationSuccess(
    explicitTeacherId?: string | null,
    isSingleQuestion: boolean = false
): Promise<QuotaState> {
    const teacherId = await resolveCurrentTeacherId(explicitTeacherId);
    const { manilaDate } = getManilaDayBoundsIso();
    const cost = isSingleQuestion
        ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
        : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

    if (!teacherId) {
        return getTeacherQuotaState(null);
    }

    const store = await readLocalStore(teacherId, manilaDate);
    const now = Date.now();

    if (cost > 0) {
        store.usedCount = Math.min(AI_QUOTA_CONFIG.DAILY_LIMIT, store.usedCount + cost);
    }
    store.lastAttemptTimestamp = now;
    store.recentAttemptTimestamps = pruneRecentAttempts(
        [...store.recentAttemptTimestamps, now],
        AI_QUOTA_CONFIG.BURST_WINDOW_MINUTES
    );
    if (AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS > 0) {
        store.cooldownUntil = now + AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS * 1000;
    }

    // Insert directly into `public.ai_generation_logs` for this specific `teacher_id`
    let insertedToCloud = false;
    try {
        const { error: insertError } = await supabase.from("ai_generation_logs").insert({
            teacher_id: teacherId,
            action_type: isSingleQuestion ? "single_question" : "full_quiz",
            cost,
            status: "success",
        });

        if (!insertError) {
            insertedToCloud = true;
        } else {
            console.warn("Could not insert AI generation log into Supabase:", insertError.message);
        }
    } catch (err) {
        console.warn("Offline while recording AI generation log:", err);
    }

    if (!insertedToCloud && cost > 0) {
        store.pendingUnsyncedCount = (store.pendingUnsyncedCount || 0) + 1;
    }

    await saveLocalStore(store);

    return getTeacherQuotaState(teacherId);
}

/**
 * Logs a failed AI generation attempt to `public.ai_generation_logs` with `cost = 0` and `status = 'failed'`
 * so failures are recorded for diagnostics without deducting from the user's 10x daily limit.
 */
export async function recordGenerationFailure(
    explicitTeacherId?: string | null,
    errorMessage?: string
): Promise<void> {
    try {
        const teacherId = await resolveCurrentTeacherId(explicitTeacherId);
        if (!teacherId) return;

        await supabase.from("ai_generation_logs").insert({
            teacher_id: teacherId,
            action_type: "full_quiz",
            cost: 0,
            status: "failed",
            error_message: errorMessage ? errorMessage.slice(0, 500) : "Generation failed",
        });
    } catch {
        // Ignore logging error on failure
    }
}

/**
 * Applies a brief cooldown penalty after receiving a 429 or server busy error.
 */
export async function applyRateLimitPenalty(
    explicitTeacherId?: string | null,
    cooldownSeconds: number = AI_QUOTA_CONFIG.RATE_LIMIT_COOLDOWN_SECONDS
): Promise<number> {
    const teacherId = await resolveCurrentTeacherId(explicitTeacherId);
    if (!teacherId) return cooldownSeconds;

    const { manilaDate } = getManilaDayBoundsIso();
    const store = await readLocalStore(teacherId, manilaDate);
    const now = Date.now();
    store.cooldownUntil = Math.max(store.cooldownUntil, now + cooldownSeconds * 1000);
    store.lastAttemptTimestamp = now;
    await saveLocalStore(store);
    return cooldownSeconds;
}

/**
 * Resets the teacher's daily AI quota for testing purposes.
 * Clears local usage and sets a reset checkpoint so previous logs from today are ignored.
 */
export async function resetTeacherQuotaForTesting(explicitTeacherId?: string | null): Promise<QuotaState> {
    const teacherId = await resolveCurrentTeacherId(explicitTeacherId);
    const { manilaDate } = getManilaDayBoundsIso();
    const now = Date.now();

    if (teacherId) {
        const store: LocalQuotaStore = {
            teacherId,
            manilaDate,
            usedCount: 0,
            pendingUnsyncedCount: 0,
            lastAttemptTimestamp: 0,
            recentAttemptTimestamps: [],
            cooldownUntil: 0,
            testResetTimestamp: now,
        };
        await saveLocalStore(store);

        try {
            await supabase
                .from("ai_generation_logs")
                .delete()
                .eq("teacher_id", teacherId);
        } catch {
            // RLS may disallow client deletes, which is safely handled by testResetTimestamp
        }
    }

    return getTeacherQuotaState(teacherId);
}
