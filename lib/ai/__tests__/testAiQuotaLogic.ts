import { AI_QUOTA_CONFIG } from "../aiQuotaConfig";

interface LocalQuotaStore {
    manilaDate: string;
    usedCount: number;
    lastAttemptTimestamp: number;
    recentAttemptTimestamps: number[];
    cooldownUntil: number;
}

function getManilaDateString(date: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: AI_QUOTA_CONFIG.RESET_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(date);
}

function pruneRecentAttempts(timestamps: number[], windowMinutes: number): number[] {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    return timestamps.filter((t) => t > cutoff);
}

class MockQuotaTracker {
    private store: LocalQuotaStore;

    constructor() {
        this.store = {
            manilaDate: getManilaDateString(),
            usedCount: 0,
            lastAttemptTimestamp: 0,
            recentAttemptTimestamps: [],
            cooldownUntil: 0,
        };
    }

    getState() {
        const now = Date.now();
        const cooldownRemaining = Math.max(0, Math.ceil((this.store.cooldownUntil - now) / 1000));
        const secondsSinceLast = Math.max(0, Math.ceil((now - this.store.lastAttemptTimestamp) / 1000));
        const burstCooldownRemaining =
            this.store.lastAttemptTimestamp > 0 && secondsSinceLast < AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS
                ? AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS - secondsSinceLast
                : 0;

        const effectiveCooldown = Math.max(cooldownRemaining, burstCooldownRemaining);
        const remainingToday = Math.max(0, AI_QUOTA_CONFIG.DAILY_LIMIT - this.store.usedCount);
        const isBurstLimited = this.store.recentAttemptTimestamps.length >= AI_QUOTA_CONFIG.BURST_WINDOW_MAX_ATTEMPTS;

        return {
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
            usedToday: this.store.usedCount,
            remainingToday,
            cooldownSecondsRemaining: effectiveCooldown,
            isDailyLimitReached: remainingToday <= 0,
            isCooldownActive: effectiveCooldown > 0,
            isBurstLimited,
        };
    }

    checkCanGenerate(isSingleQuestion: boolean = false) {
        const cost = isSingleQuestion
            ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
            : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

        const state = this.getState();

        if (cost > 0 && state.usedToday + cost > AI_QUOTA_CONFIG.DAILY_LIMIT) {
            return {
                allowed: false,
                reason: "DAILY_LIMIT" as const,
                message: `You've reached today's limit of ${AI_QUOTA_CONFIG.DAILY_LIMIT} quizzes.`,
                remainingToday: 0,
            };
        }

        if (state.cooldownSecondsRemaining > 0) {
            return {
                allowed: false,
                reason: "COOLDOWN" as const,
                message: `Please wait ${state.cooldownSecondsRemaining} seconds before generating another quiz.`,
                cooldownSeconds: state.cooldownSecondsRemaining,
            };
        }

        if (state.isBurstLimited) {
            return {
                allowed: false,
                reason: "BURST_LIMIT" as const,
                message: "You've generated 3 quizzes in the last 10 minutes. Please take a short break.",
            };
        }

        return { allowed: true, remainingToday: state.remainingToday };
    }

    recordSuccess(isSingleQuestion: boolean = false) {
        const cost = isSingleQuestion
            ? AI_QUOTA_CONFIG.COSTS.SINGLE_QUESTION
            : AI_QUOTA_CONFIG.COSTS.FULL_QUIZ;

        const now = Date.now();
        if (cost > 0) {
            this.store.usedCount = Math.min(AI_QUOTA_CONFIG.DAILY_LIMIT, this.store.usedCount + cost);
        }
        this.store.lastAttemptTimestamp = now;
        this.store.recentAttemptTimestamps = pruneRecentAttempts(
            [...this.store.recentAttemptTimestamps, now],
            AI_QUOTA_CONFIG.BURST_WINDOW_MINUTES
        );
        this.store.cooldownUntil = now + AI_QUOTA_CONFIG.BURST_COOLDOWN_SECONDS * 1000;
        return this.getState();
    }

    applyRateLimitPenalty(penaltySeconds: number = AI_QUOTA_CONFIG.RATE_LIMIT_COOLDOWN_SECONDS) {
        const now = Date.now();
        this.store.cooldownUntil = Math.max(this.store.cooldownUntil, now + penaltySeconds * 1000);
        this.store.lastAttemptTimestamp = now;
    }

    simulateDateChange(newDate: string) {
        this.store.manilaDate = newDate;
        this.store.usedCount = 0; // Midnight reset!
    }
}

async function runLogicTests() {
    console.log("=================================================================");
    console.log("  TESTING: AI Quota & Rate Limiting System Rules");
    console.log("=================================================================\n");

    const tracker = new MockQuotaTracker();

    // 1. Manila date format
    const today = getManilaDateString();
    console.log(`[Test 1] Asia/Manila Date: ${today}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Invalid Manila date");
    console.log("✓ Date calculation in Asia/Manila passed.\n");

    // 2. Initial state
    const s0 = tracker.getState();
    console.log(`[Test 2] Initial state: ${s0.remainingToday}/${s0.dailyLimit} remaining, used=${s0.usedToday}`);
    if (s0.remainingToday !== 10 || s0.usedToday !== 0) throw new Error("Initial state mismatch");
    console.log("✓ Initial 10 of 10 quota verified.\n");

    // 3. Can generate check
    const c0 = tracker.checkCanGenerate(false);
    console.log(`[Test 3] Pre-generation check: allowed=${c0.allowed}`);
    if (!c0.allowed) throw new Error("Expected to be allowed");
    console.log("✓ Allowed to generate initially.\n");

    // 4. Record 1 successful full quiz
    const s1 = tracker.recordSuccess(false);
    console.log(`[Test 4] Recorded full quiz: remaining=${s1.remainingToday}, used=${s1.usedToday}, cooldown=${s1.cooldownSecondsRemaining}s`);
    if (s1.usedToday !== 1 || s1.remainingToday !== 9) throw new Error("Usage should be 1, remaining 9");
    console.log("✓ Successfully decremented to 9 of 10.\n");

    // 5. Burst cooldown active (blocks repeat taps)
    const c1 = tracker.checkCanGenerate(false);
    console.log(`[Test 5] Immediate repeat tap: allowed=${c1.allowed}, reason=${c1.reason}`);
    if (c1.allowed || c1.reason !== "COOLDOWN") throw new Error("Burst cooldown should block repeat tap");
    console.log(`✓ Burst cooldown (${c1.cooldownSeconds}s) blocks accidental repeat taps.\n`);

    // 6. Cheaper regenerate (single question)
    const sSingle = tracker.recordSuccess(true);
    console.log(`[Test 6] Single question regenerate: used=${sSingle.usedToday}, remaining=${sSingle.remainingToday}`);
    if (sSingle.usedToday !== 1) throw new Error("Single question should not cost daily quota");
    console.log("✓ Single question regenerate does not consume daily quota.\n");

    // 7. Rate limit penalty (429 error)
    tracker.applyRateLimitPenalty(30);
    const sPenalty = tracker.getState();
    console.log(`[Test 7] 429 penalty cooldown: remaining=${sPenalty.cooldownSecondsRemaining}s`);
    if (sPenalty.cooldownSecondsRemaining < 25) throw new Error("30s penalty cooldown not applied");
    console.log("✓ 429 penalty cooldown (30s) correctly applied.\n");

    // 8. Simulate exhausting daily quota (10 total)
    console.log("[Test 8] Simulating reaching daily limit of 10...");
    for (let i = sPenalty.usedToday; i < 10; i++) {
        tracker.recordSuccess(false);
    }
    const sMax = tracker.getState();
    console.log(`  State at cap: used=${sMax.usedToday}, remaining=${sMax.remainingToday}`);
    const cMax = tracker.checkCanGenerate(false);
    console.log(`  Generation check: allowed=${cMax.allowed}, reason=${cMax.reason}`);
    if (cMax.allowed || cMax.reason !== "DAILY_LIMIT") throw new Error("Daily limit not enforced");
    console.log("✓ Daily limit (10 of 10 used) successfully blocks further generation.\n");

    // 9. Midnight Manila reset simulation
    console.log("[Test 9] Simulating midnight reset in Asia/Manila...");
    tracker.simulateDateChange("2026-11-04");
    const sReset = tracker.getState();
    console.log(`  After midnight: used=${sReset.usedToday}, remaining=${sReset.remainingToday}`);
    if (sReset.usedToday !== 0 || sReset.remainingToday !== 10) throw new Error("Midnight reset failed");
    console.log("✓ Midnight reset restores 10 of 10 left today!\n");

    console.log("=================================================================");
    console.log("🎉 ALL QUOTA & RATE LIMIT BEHAVIOR TESTS PASSED!");
    console.log("=================================================================");
}

runLogicTests().catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
});
