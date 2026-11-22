import assert from "assert";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildAlertCardSummary,
  buildAlertContextText,
  buildReconciledAlerts,
  classifyScoreSeverity,
  clearAllAlerts,
  DEFAULT_ALERT_PREFERENCES,
  dismissSingleAlert,
  evaluateAndRecordStudentAlert,
  formatAlertTimeLabel,
  getAlertPreferences,
  markAllAlertsAsRead,
  restoreDismissedAlerts,
  saveAlertPreferences,
  sortAlertsByPriority,
} from "../../alertStore";

// Patch AsyncStorage in-memory for Node test execution
const memStore = new Map<string, string>();
(AsyncStorage as any).getItem = async (k: string) => (memStore.has(k) ? memStore.get(k)! : null);
(AsyncStorage as any).setItem = async (k: string, v: string) => {
  memStore.set(k, v);
};
(AsyncStorage as any).removeItem = async (k: string) => {
  memStore.delete(k);
};

let passed = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  memStore.clear();
  await fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

async function main() {
  console.log("=== Testing Roster Alert Engine & Preferences ===");

  await runTest("classifyScoreSeverity maps scores across thresholds and watchlist cleanly", () => {
    assert.strictEqual(classifyScoreSeverity(20, DEFAULT_ALERT_PREFERENCES), "HIGH RISK");
    assert.strictEqual(classifyScoreSeverity(40, DEFAULT_ALERT_PREFERENCES), "HIGH RISK");
    assert.strictEqual(classifyScoreSeverity(45, DEFAULT_ALERT_PREFERENCES), "URGENT REVIEW");
    assert.strictEqual(classifyScoreSeverity(50, DEFAULT_ALERT_PREFERENCES), "URGENT REVIEW");
    assert.strictEqual(classifyScoreSeverity(51, DEFAULT_ALERT_PREFERENCES), null);

    // Near-passing watchlist enabled
    const withWatchlist = { ...DEFAULT_ALERT_PREFERENCES, includeNearPassing: true };
    assert.strictEqual(classifyScoreSeverity(60, withWatchlist), "NEEDS SUPPORT");
    assert.strictEqual(classifyScoreSeverity(74, withWatchlist), "NEEDS SUPPORT");
    assert.strictEqual(classifyScoreSeverity(75, withWatchlist), null);

    // Custom DepEd threshold (<=74%)
    const depEdPrefs = { ...DEFAULT_ALERT_PREFERENCES, atRiskThreshold: 74 };
    assert.strictEqual(classifyScoreSeverity(50, depEdPrefs), "HIGH RISK");
    assert.strictEqual(classifyScoreSeverity(65, depEdPrefs), "URGENT REVIEW");
    assert.strictEqual(classifyScoreSeverity(75, depEdPrefs), null);
  });

  await runTest("formatAlertTimeLabel computes live relative timestamps accurately", () => {
    const now = Date.now();
    assert.strictEqual(formatAlertTimeLabel(new Date(now - 10_000).toISOString()), "Just now");
    assert.strictEqual(formatAlertTimeLabel(new Date(now - 12 * 60_000).toISOString()), "12m ago");

    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    assert.strictEqual(formatAlertTimeLabel(yesterday.toISOString()), "Yesterday");

    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
    assert.strictEqual(formatAlertTimeLabel(threeDaysAgo.toISOString()), "3d ago");

    assert.strictEqual(formatAlertTimeLabel(undefined, "Fallback"), "Fallback");
  });

  await runTest("buildAlertContextText produces crisp, non-redundant messaging", () => {
    const basic = buildAlertContextText({
      alertType: "HIGH RISK",
      scorePercentage: 20,
    });
    assert.strictEqual(basic, "55 pts below the 75% passing mark");
    assert.ok(!basic.toLowerCase().includes("flagged: at-risk"));

    const withQuiz = buildAlertContextText({
      alertType: "HIGH RISK",
      scorePercentage: 20,
      quizScorePercentage: 20,
      rawScore: 2,
      maxScore: 10,
      quizTitle: "Quiz 1",
    });
    assert.strictEqual(withQuiz, "Scored 20% (2/10) on Quiz 1 · 55 pts below passing");

    const drop = buildAlertContextText({
      alertType: "SCORE DROP",
      scorePercentage: 64,
      quizScorePercentage: 48,
      previousAverage: 80,
      quizTitle: "Fractions Quiz",
    });
    assert.strictEqual(drop, "Dropped 32 pts on Fractions Quiz (80% → 48%)");

    const cardSummary = buildAlertCardSummary({
      alertType: "HIGH RISK",
      scorePercentage: 43,
      quizScorePercentage: 20,
      rawScore: 1,
      maxScore: 5,
    });
    assert.strictEqual(cardSummary, "Latest quiz: 20% (1/5) · 32 pts below passing");
  });

  await runTest("preferences persist and load cleanly", async () => {
    const initial = await getAlertPreferences();
    assert.strictEqual(initial.atRiskThreshold, 50);
    assert.strictEqual(initial.enableScoreDropAlerts, true);
    assert.strictEqual(initial.includeNearPassing, false);

    await saveAlertPreferences({ atRiskThreshold: 60, includeNearPassing: true });
    const reloaded = await getAlertPreferences();
    assert.strictEqual(reloaded.atRiskThreshold, 60);
    assert.strictEqual(reloaded.includeNearPassing, true);
  });

  await runTest("evaluateAndRecordStudentAlert triggers Critical, Score Drop, and auto-clears on recovery", async () => {
    // 1. Critical alert on 20%
    const a1 = await evaluateAndRecordStudentAlert({
      studentId: "stu-1",
      studentName: "Ramos, John Ariel C.",
      classroomId: "cls-1",
      classroomTitle: "TEST",
      cumulativeAverage: 20,
      quizScorePercentage: 20,
      rawScore: 2,
      maxScore: 10,
      quizTitle: "Quiz 1",
    });
    assert.ok(a1);
    assert.strictEqual(a1!.alertType, "HIGH RISK");

    // 2. Sudden score drop when cumulative average is still > 50%
    const a2 = await evaluateAndRecordStudentAlert({
      studentId: "stu-2",
      studentName: "Cruz, Maria L.",
      classroomId: "cls-1",
      classroomTitle: "TEST",
      cumulativeAverage: 66,
      quizScorePercentage: 45,
      previousAverage: 84,
      rawScore: 9,
      maxScore: 20,
      quizTitle: "Quiz 2",
    });
    assert.ok(a2);
    assert.strictEqual(a2!.alertType, "SCORE DROP");

    // 3. Student 1 recovers to 82% -> stale alert auto-cleared
    const recovered = await evaluateAndRecordStudentAlert({
      studentId: "stu-1",
      studentName: "Ramos, John Ariel C.",
      classroomId: "cls-1",
      classroomTitle: "TEST",
      cumulativeAverage: 82,
      quizScorePercentage: 95,
      previousAverage: 20,
      quizTitle: "Quiz 2",
    });
    assert.strictEqual(recovered, null);

    const reconciled = await buildReconciledAlerts({
      students: [
        { id: "stu-1", classroom_id: "cls-1", full_name: "Ramos, John Ariel C.", average: 82 },
        { id: "stu-2", classroom_id: "cls-1", full_name: "Cruz, Maria L.", average: 66 },
      ],
      classrooms: [{ id: "cls-1", title: "TEST", color: "#C2410C" }],
    });
    assert.strictEqual(reconciled.activeAlerts.length, 1);
    assert.strictEqual(reconciled.activeAlerts[0].studentId, "stu-2");
    assert.strictEqual(reconciled.activeAlerts[0].alertType, "SCORE DROP");
  });

  await runTest("buildReconciledAlerts ignores newly enrolled 0% students but flags genuine 0% quiz scores", async () => {
    const res = await buildReconciledAlerts({
      students: [
        { id: "new-stu", classroom_id: "cls-1", full_name: "New Student", average: 0 },
        { id: "zero-stu", classroom_id: "cls-1", full_name: "Zero Quiz Student", average: 0 },
      ],
      classrooms: [{ id: "cls-1", title: "MATH 10" }],
      latestQuizByStudent: {
        "zero-stu": {
          quizTitle: "Quiz 1",
          scorePercentage: 0,
          totalScore: 0,
          maxScore: 10,
          gradedAt: new Date().toISOString(),
        },
      },
    });
    assert.strictEqual(res.activeAlerts.length, 1);
    assert.strictEqual(res.activeAlerts[0].studentId, "zero-stu");
    assert.strictEqual(res.activeAlerts[0].alertType, "HIGH RISK");
    assert.strictEqual(res.flaggedCountsByClassroom["cls-1"], 1);
  });

  await runTest("dismiss, undo restore, mark all read, and smart re-trigger on further score drop", async () => {
    const classrooms = [{ id: "cls-1", title: "TEST", color: "#4F46E5" }];
    const students = [
      { id: "stu-a", classroom_id: "cls-1", full_name: "Student A", average: 45 },
      { id: "stu-b", classroom_id: "cls-1", full_name: "Student B", average: 20 },
    ];

    // Initial reconciliation sorts Critical (20%) ahead of At-Risk (45%)
    let res = await buildReconciledAlerts({ students, classrooms });
    assert.strictEqual(res.activeAlerts.length, 2);
    assert.strictEqual(res.activeAlerts[0].studentId, "stu-b");
    assert.strictEqual(res.activeAlerts[1].studentId, "stu-a");
    assert.strictEqual(res.unreadCount, 2);

    // Mark all read keeps alerts visible while clearing unread count
    await markAllAlertsAsRead(res.activeAlerts);
    res = await buildReconciledAlerts({ students, classrooms });
    assert.strictEqual(res.activeAlerts.length, 2);
    assert.strictEqual(res.unreadCount, 0);

    // Dismiss single alert moves it into dismissedAlerts
    const alertA = res.activeAlerts.find((a) => a.studentId === "stu-a")!;
    await dismissSingleAlert(alertA);
    res = await buildReconciledAlerts({ students, classrooms });
    assert.strictEqual(res.activeAlerts.length, 1);
    assert.strictEqual(res.dismissedAlerts.length, 1);
    assert.strictEqual(res.dismissedAlerts[0].studentId, "stu-a");

    // If dismissed Student A drops further from 45% -> 35%, alert auto-resurfaces!
    const worsenedStudents = [
      { id: "stu-a", classroom_id: "cls-1", full_name: "Student A", average: 35 },
      { id: "stu-b", classroom_id: "cls-1", full_name: "Student B", average: 20 },
    ];
    res = await buildReconciledAlerts({ students: worsenedStudents, classrooms });
    assert.strictEqual(res.activeAlerts.length, 2);
    assert.strictEqual(res.dismissedAlerts.length, 0);

    // Clear all & undo restore brings everything back
    const snapshot = [...res.activeAlerts];
    await clearAllAlerts(snapshot);
    res = await buildReconciledAlerts({ students: worsenedStudents, classrooms });
    assert.strictEqual(res.activeAlerts.length, 0);
    assert.strictEqual(res.dismissedAlerts.length, 2);

    await restoreDismissedAlerts(snapshot);
    res = await buildReconciledAlerts({ students: worsenedStudents, classrooms });
    assert.strictEqual(res.activeAlerts.length, 2);
    assert.strictEqual(res.dismissedAlerts.length, 0);
  });

  await runTest("sortAlertsByPriority prioritizes unread > severity > lowest score", () => {
    const sample = [
      { id: "1", isRead: true, alertType: "HIGH RISK", scorePercentage: 10, createdAt: "2026-11-22T01:00:00Z" },
      { id: "2", isRead: false, alertType: "URGENT REVIEW", scorePercentage: 45, createdAt: "2026-11-22T02:00:00Z" },
      { id: "3", isRead: false, alertType: "HIGH RISK", scorePercentage: 30, createdAt: "2026-11-22T01:00:00Z" },
      { id: "4", isRead: false, alertType: "HIGH RISK", scorePercentage: 15, createdAt: "2026-11-22T00:00:00Z" },
    ] as any[];
    const sorted = sortAlertsByPriority(sample);
    assert.deepStrictEqual(
      sorted.map((a) => a.id),
      ["4", "3", "2", "1"]
    );
  });

  console.log(`\nResults: ${passed} passed, 0 failed`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
