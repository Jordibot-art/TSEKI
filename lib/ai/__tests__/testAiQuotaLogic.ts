import { AI_QUOTA_CONFIG, getManilaDateString, getManilaDayBoundsIso } from "../aiQuotaConfig";

interface SimulatedLogRow {
    id: string;
    teacher_id: string;
    action_type: string;
    cost: number;
    status: "success" | "failed";
    error_message?: string | null;
    created_at: string;
}

class SimulatedAiLogsDatabase {
    private rows: SimulatedLogRow[] = [];

    insert(row: Omit<SimulatedLogRow, "id">) {
        this.rows.push({
            id: `log_${this.rows.length + 1}`,
            ...row,
        });
    }

    getUsedTodayForTeacher(teacherId: string, now: Date): number {
        const { startIso, endIso } = getManilaDayBoundsIso(now);
        const startMs = new Date(startIso).getTime();
        const endMs = new Date(endIso).getTime();

        return this.rows
            .filter((r) => {
                if (r.teacher_id !== teacherId) return false;
                if (r.status !== "success") return false;
                const t = new Date(r.created_at).getTime();
                return t >= startMs && t < endMs;
            })
            .reduce((sum, r) => sum + r.cost, 0);
    }

    checkCanGenerate(teacherId: string, now: Date) {
        const usedToday = this.getUsedTodayForTeacher(teacherId, now);
        const remainingToday = Math.max(0, AI_QUOTA_CONFIG.DAILY_LIMIT - usedToday);
        if (usedToday + AI_QUOTA_CONFIG.COSTS.FULL_QUIZ > AI_QUOTA_CONFIG.DAILY_LIMIT) {
            return {
                allowed: false,
                usedToday,
                remainingToday: 0,
                dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
            };
        }
        return {
            allowed: true,
            usedToday,
            remainingToday,
            dailyLimit: AI_QUOTA_CONFIG.DAILY_LIMIT,
        };
    }
}

async function runLogicTests() {
    console.log("=================================================================");
    console.log("  TESTING: Per-User 10x Daily AI Quota (12:00 AM Manila Reset)");
    console.log("=================================================================\n");

    const db = new SimulatedAiLogsDatabase();
    const user1 = "11111111-1111-4111-8111-111111111111";
    const user2 = "22222222-2222-4222-8222-222222222222";

    // Current time: 2026-11-03 14:30:00 Manila Time (+08:00)
    const day1AfternoonManila = new Date("2026-11-03T14:30:00.000+08:00");
    const manilaDate1 = getManilaDateString(day1AfternoonManila);
    console.log(`[Test 1] Manila Date at 2:30 PM PHT: ${manilaDate1}`);
    if (manilaDate1 !== "2026-11-03") {
        throw new Error(`Expected 2026-11-03, got ${manilaDate1}`);
    }

    // User 1 generates 5x on Day 1
    for (let i = 0; i < 5; i++) {
        db.insert({
            teacher_id: user1,
            action_type: "full_quiz",
            cost: 1,
            status: "success",
            created_at: new Date(day1AfternoonManila.getTime() + i * 60000).toISOString(),
        });
    }

    const u1State = db.checkCanGenerate(user1, day1AfternoonManila);
    const u2State = db.checkCanGenerate(user2, day1AfternoonManila);

    console.log(`[Test 2] User 1 after 5x generations: used=${u1State.usedToday}/10, remaining=${u1State.remainingToday}/10`);
    console.log(`[Test 2] User 2 logs in on same day:  used=${u2State.usedToday}/10, remaining=${u2State.remainingToday}/10`);

    if (u1State.usedToday !== 5 || u1State.remainingToday !== 5) {
        throw new Error("User 1 should have 5 used and 5 remaining");
    }
    if (u2State.usedToday !== 0 || u2State.remainingToday !== 10) {
        throw new Error("User 2 should have 0 used and 10 remaining (isolated per teacher_id)");
    }
    console.log("✓ Per-user isolation verified: User 2 has full 10x limit unaffected by User 1.\n");

    // User 1 generates 5 more times (reaching 10x daily limit)
    for (let i = 0; i < 5; i++) {
        db.insert({
            teacher_id: user1,
            action_type: "full_quiz",
            cost: 1,
            status: "success",
            created_at: new Date(day1AfternoonManila.getTime() + (i + 10) * 60000).toISOString(),
        });
    }

    const u1AtCap = db.checkCanGenerate(user1, day1AfternoonManila);
    const u2StillAvailable = db.checkCanGenerate(user2, day1AfternoonManila);
    console.log(`[Test 3] User 1 after 10x generations: allowed=${u1AtCap.allowed}, used=${u1AtCap.usedToday}/10, remaining=${u1AtCap.remainingToday}`);
    console.log(`[Test 3] User 2 while User 1 is at cap: allowed=${u2StillAvailable.allowed}, remaining=${u2StillAvailable.remainingToday}/10`);
    if (u1AtCap.allowed || u1AtCap.remainingToday !== 0) {
        throw new Error("User 1 should be blocked at 10/10");
    }
    if (!u2StillAvailable.allowed || u2StillAvailable.remainingToday !== 10) {
        throw new Error("User 2 should still have 10/10 available");
    }
    console.log("✓ 10x daily cap enforced per user.\n");

    // Test right before 12:00 AM Manila (11:59:59 PM Manila) vs exact 12:00:00 AM Midnight Manila
    const justBeforeMidnightManila = new Date("2026-11-03T23:59:59.000+08:00");
    const exactMidnightManila = new Date("2026-11-04T00:00:00.000+08:00");

    const u1BeforeMidnight = db.checkCanGenerate(user1, justBeforeMidnightManila);
    const u1AtMidnight = db.checkCanGenerate(user1, exactMidnightManila);

    console.log(`[Test 4] User 1 at 11:59:59 PM Manila: used=${u1BeforeMidnight.usedToday}/10, allowed=${u1BeforeMidnight.allowed}`);
    console.log(`[Test 4] User 1 at 12:00:00 AM Manila: used=${u1AtMidnight.usedToday}/10, remaining=${u1AtMidnight.remainingToday}/10, allowed=${u1AtMidnight.allowed}`);

    if (u1BeforeMidnight.allowed || u1BeforeMidnight.usedToday !== 10) {
        throw new Error("Should still be at limit at 11:59:59 PM Manila");
    }
    if (!u1AtMidnight.allowed || u1AtMidnight.usedToday !== 0 || u1AtMidnight.remainingToday !== 10) {
        throw new Error("Should reset to 0 used / 10 remaining at exact 12:00:00 AM Manila");
    }
    console.log("✓ Exact 12:00 AM Midnight Manila (UTC+8) reset verified!\n");

    console.log("=================================================================");
    console.log("🎉 ALL PER-USER 10x QUOTA & MANILA MIDNIGHT RESET TESTS PASSED!");
    console.log("=================================================================");
}

runLogicTests().catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
});
