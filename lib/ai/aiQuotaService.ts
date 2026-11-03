import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../supabase";
import { AI_QUOTA_CONFIG } from "./aiQuotaConfig";

export interface QuotaState {
    dailyLimit: number;
    usedToday: number;
    remainingToday: number;
    cooldownSecondsRemaining: number;
    isDailyLimitReached: boolean;
    isCooldownActive: boolean;
    isBurstLimited: boolean;
}

interface LocalQuotaStore {
    manilaDate: string;
    usedCount: number;
    lastAttemptTimestamp: number;
    recentAttemptTimestamps: number[];
    cooldownUntil: number;
}

/**
 * Returns today's date formatted as YYYY-MM-DD in the Asia/Manila (UTC+8) timezone.
 */
export function getManilaDateString(date: Date = new Date()): string {
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: AI_QUOTA_CONFIG.RESET_TIMEZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        return formatter.format(date);
    } catch {
        // Fallback: manually offset UTC by +8 hours
        const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
        const manilaMs = utcMs + 8 * 3600000;
        const d = new Date(manilaMs);
        return d.toISOString().slice(0, 10);
    }
}

/**
 * Gets storage key for the teacher's quota.
 */
function getStorageKey(teacherId?: string): string {
    return `@tseki_ai_quota_v1_${teacherId || "anon_teacher"}`;
}

/**
 * Reads local quota store from AsyncStorage.
 */
async function readLocalStore(key: string): Promise<LocalQuotaStore> {
    const today = getManilaDateString();
    try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
            const data: LocalQuotaStore = JSON.parse(raw);
            if (data.manilaDate === today) {
                return data;
            }
        }
    } catch {
        // ignore and return default
    }

    // Default/Reset state for a fresh day in Manila
    return {
        manilaDate: today,
        usedCount: 0,
        lastAttemptTimestamp: 0,
        recentAttemptTimestamps: [],
        cooldownUntil: 0,
    };
}

/**
 * Saves local quota store to AsyncStorage.
 */
async function saveLocalStore(key: string, data: LocalQuotaStore): Promise<void> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch {
        // ignore
    }
}

/**
 * Cleans up timestamps older than windowMinutes (10 mins).
 */
function pruneRecentAttempts(timestamps: number[], windowMinutes: number): number[] {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    return timestamps.filter((t) => t > cutoff);
}

/**
 * Fetches the current quota state for a teacher, synchronizing with Supabase if online.
 */
export async function getTeacherQuotaState(teacherId?: string): Promise<QuotaState> {
    const key = getStorageKey(teacherId);
    let store = await readLocalStore(key);
    store.recentAttemptTimestamps = pruneRecentAttempts(
        store.recentAttemptTimestamps || [],
        AI_QUOTA_CONFIG.BURST_WINDOW_MINUTES
    );

    // Try synchronizing with Supabase server-side if user is authenticated
    if (teacherId) {
        try {
            // First check if Supabase RPC is available
            const { data: rpcData, error: rpcError } = await supabase.rpc("check_ai_quota", {
                p_teacher_id: teacherId,
                p_cost: 0,
                p_daily_limit: AI_QUOTA_CONFIG.DAILY_LIMIT,
            });

            if (!rpcError && rpcData && typeof rpcData.used_today === "number") {
                store.usedCount = Math.max(store.usedCount, rpcData.used_today);
                await saveLocalStore(key, store);
            } else {
                // Alternatively query the logs table directly if RPC isn't deployed yet
                const manilaToday = getManilaDateString();
                const { count, error: countError } = await supabase
                    .from("ai_generation_logs")
                    .select("*", { count: "exact", head: true })
                    .eq("teacher_id", teacherId)
                    .eq("status", "success")
                    .gte("created_at", `${manilaToday}T00:00:00+08:00`);

                if (!countError && typeof count === "number") {
                    store.usedCount = Math.max(store.usedCount, count);
                    await saveLocalStore(key, store);
                }
            }
        } catch {
            // Network unavailable or migration not yet run — gracefully rely on local store
        }
    }

    const now = Date.now();
    const cooldownRemaining = Math.max(0, Math.ceil((store.cooldownUntil - now) / 1000));
    const secondsSinceLast = Math.max(0, Math.ceil((now - store.lastAttemptTimestamp) / 1000));
    const burstCooldownRemaining =
        store.lastAttemptTimestamp > 0 && secondsSinceLast < AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS
            ? AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS - secondsSinceLast
            : 0;

    const effectiveCooldown = Math.max(cooldownRemaining, burstCooldownRemaining);
    const remainingToday = Math.max(0, AI_QUOTA_CONFIG.DAILY_LIMIT - store.usedCount);
    const isBurstLimited = store.recentAttemptTimestamps.length >= AI_QUOTA_CONFIG.BURST_WINDOW_MAX_ATTEMPTS;

    return {
        dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        usedToday: store.usedCount,
        remainingToday,
        cooldownSecondsRemaining: effectiveCooldown,
        isDailyLimitReached: remainingToday <= 0,
        isCooldownActive: effectiveCooldown > 0,
        isBurstLimited,
    };
}

/**
 * Checks whether a teacher can generate right now.
 * Validates daily quota, burst cooldown (25s), and burst limit (3 in 10 mins).
 */
export async function checkCanGenerate(
    teacherId?: string,
    isSingleQuestion: boolean = false
): Promise<{
    allowed: boolean;
    reason?: "DAILY_LIMIT" | "COOLDOWN" | "BURST_LIMIT";
    message?: string;
    cooldownSeconds?: number;
    remainingToday: number;
    dailyLimit: number;
}> {
    const cost = isSingleQuestion
        ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
        : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

    const state = await getTeacherQuotaState(teacherId);

    // 1. Daily limit check (only if action costs quota)
    if (cost > 0 && state.usedToday + cost > AI_QUOTA_CONFIG.DAILY_LIMIT) {
        return {
            allowed: false,
            reason: "DAILY_LIMIT",
            message: `You've reached today's limit of ${AI_QUOTA_CONFIG.DAILY_LIMIT} quizzes. Resets tomorrow at midnight (Asia/Manila).`,
            remainingToday: 0,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }

    // 2. Burst cooldown check (must wait 20-30s between attempts)
    if (state.cooldownSecondsRemaining > 0) {
        return {
            allowed: false,
            reason: "COOLDOWN",
            message: `Please wait ${state.cooldownSecondsRemaining} seconds before generating another quiz.`,
            cooldownSeconds: state.cooldownSecondsRemaining,
            remainingToday: state.remainingToday,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }

    // 3. Burst rate window (no more than 3 in 10 minutes)
    if (state.isBurstLimited) {
        return {
            allowed: false,
            reason: "BURST_LIMIT",
            message: "You've generated 3 quizzes in the last 10 minutes. Please take a short break before generating again.",
            cooldownSeconds: 60,
            remainingToday: state.remainingToday,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }

    return {
        allowed: true,
        remainingToday: state.remainingToday,
        dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
    };
}

/**
 * Records a successful generation.
 * ONLY called upon successful completion. Failed requests, 429s, or lost connection do NOT count.
 */
export async function recordGenerationSuccess(
    teacherId?: string,
    isSingleQuestion: boolean = false
): Promise<QuotaState> {
    const cost = isSingleQuestion
        ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
        : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

    const key = getStorageKey(teacherId);
    const store = await readLocalStore(key);
    const now = Date.now();

    // Increment used count if cost > 0
    if (cost > 0) {
        store.usedCount = Math.min(AI_QUOTA_CONFIG.DAILY_LIMIT, store.usedCount + cost);
    }
    store.lastAttemptTimestamp = now;
    store.recentAttemptTimestamps = pruneRecentAttempts(
        [...store.recentAttemptTimestamps, now],
        AI_QUOTA_CONFIG.BURST_WINDOW_MINUTES
    );
    // Apply normal burst cooldown (25s) after every attempt
    store.cooldownUntil = now + AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS * 1000;

    await saveLocalStore(key, store);

    // Synchronize to Supabase if teacher is authenticated
    if (teacherId) {
        try {
            // Try RPC first
            const { error: rpcError } = await supabase.rpc("record_ai_generation_success", {
                p_teacher_id: teacherId,
                p_action_type: isSingleQuestion ? "single_question" : "full_quiz",
                p_cost: cost,
            });

            if (rpcError) {
                // Fallback to direct insert
                await supabase.from("ai_generation_logs").insert({
                    teacher_id: teacherId,
                    action_type: isSingleQuestion ? "single_question" : "full_quiz",
                    cost,
                    status: "success",
                });
            }
        } catch {
            // Silently persist offline; local storage already accounted for it
        }
    }

    return getTeacherQuotaState(teacherId);
}

/**
 * Applies a cooldown penalty specifically after receiving a 429 or server busy error.
 * Greys out the button for 25-30 seconds with a short countdown.
 */
export async function applyRateLimitPenalty(
    teacherId?: string,
    cooldownSeconds: number = AI_QUOTA_CONFIG.RATE_LIMIT_COOLDOWN_SECONDS
): Promise<number> {
    const key = getStorageKey(teacherId);
    const store = await readLocalStore(key);
    const now = Date.now();
    store.cooldownUntil = Math.max(store.cooldownUntil, now + cooldownSeconds * 1000);
    store.lastAttemptTimestamp = now;
    await saveLocalStore(key, store);
    return cooldownSeconds;
}
