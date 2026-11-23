import assert from "node:assert/strict";
import {
  evaluateTeacherApprovalRow,
  checkTeacherAccountApproval,
} from "../../../shared/teacherApproval";
import {
  computeClassQuizAnalysis,
  getDifficultyLevel,
} from "../../../shared/itemAnalysisCore";
import { textRequiresUnicodeFont } from "../../printEngine/fonts/embedFonts";
import { isProductionBuild } from "../aiQuotaConfig";

async function run() {
  console.log("=== Testing Phase 1–3 Security, Approval, Item Analysis & Unicode Guards ===");

  // 1. Teacher Approval Status Evaluator
  assert.equal(evaluateTeacherApprovalRow(null).allowed, true, "Legacy account without teachers row should be allowed");
  assert.equal(evaluateTeacherApprovalRow({ status: "approved" }).allowed, true, "Approved teacher should be allowed");

  const pending = evaluateTeacherApprovalRow({ status: "pending" });
  assert.equal(pending.allowed, false, "Pending teacher must be blocked");
  assert.equal(pending.status, "pending");

  const rejected = evaluateTeacherApprovalRow({
    status: "rejected",
    rejection_reason: "Invalid school ID photo",
  });
  assert.equal(rejected.allowed, false, "Rejected teacher must be blocked");
  assert.ok(rejected.message?.includes("Invalid school ID photo"), "Rejection reason should be surfaced");

  const suspended = evaluateTeacherApprovalRow({ status: "suspended" });
  assert.equal(suspended.allowed, false, "Suspended teacher must be blocked");

  // Mock Supabase client test for checkTeacherAccountApproval
  const mockSupabaseBlocked = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: "pending", rejection_reason: null }, error: null }),
        }),
      }),
    }),
  };
  const checkedPending = await checkTeacherAccountApproval(mockSupabaseBlocked, "user-123");
  assert.equal(checkedPending.allowed, false, "Pending row from Supabase must block sign-in");

  const mockSupabaseOffline = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: "network offline" } }),
        }),
      }),
    }),
  };
  const checkedOffline = await checkTeacherAccountApproval(mockSupabaseOffline, "user-123");
  assert.equal(checkedOffline.allowed, true, "Offline/query error should fail open to avoid locking out valid teachers");

  // 2. Shared Item Analysis Engine
  assert.equal(getDifficultyLevel(0.85), "Easy");
  assert.equal(getDifficultyLevel(0.5), "Moderate");
  assert.equal(getDifficultyLevel(0.15), "Difficult");

  const analysis = computeClassQuizAnalysis(
    "Midterm Science",
    [
      {
        studentId: "s1",
        studentName: "Dela Cruz, Juan",
        quizTitle: "Midterm Science",
        scorePercentage: 50,
        totalScore: 1,
        maxScore: 2,
        results: [
          { questionNumber: 1, studentAnswer: "A", correctAnswer: "A", isCorrect: true },
          { questionNumber: 2, studentAnswer: "B", correctAnswer: "C", isCorrect: false },
        ],
      },
      {
        studentId: "s2",
        studentName: "Santos, Maria",
        quizTitle: "Midterm Science",
        scorePercentage: 50,
        totalScore: 1,
        maxScore: 2,
        results: [
          { questionNumber: 1, studentAnswer: "A", correctAnswer: "A", isCorrect: true },
          { questionNumber: 2, studentAnswer: "B", correctAnswer: "C", isCorrect: false },
        ],
      },
    ],
    {
      questions: [
        { questionNumber: 1, questionText: "Basic cell question", options: ["A", "B", "C", "D"] },
        { questionNumber: 2, questionText: "Hard genetics question", options: ["A", "B", "C", "D"] },
      ],
      answerKey: [
        { questionNumber: 1, correctAnswer: "A" },
        { questionNumber: 2, correctAnswer: "C" },
      ],
    }
  );
  assert.ok(analysis, "Analysis should be computed");
  assert.equal(analysis!.hardestQuestions[0].questionNumber, 2, "Q2 should be hardest");
  assert.equal(analysis!.hardestQuestions[0].difficultyLevel, "Difficult");
  assert.equal(analysis!.hardestQuestions[0].mostCommonMistake?.answer, "B");
  assert.equal(analysis!.hardestQuestions[0].mostCommonMistake?.percentage, 100);
  assert.equal(analysis!.easiestQuestions[0].questionNumber, 1, "Q1 should be easiest");
  assert.equal(analysis!.easiestQuestions[0].difficultyLevel, "Easy");

  // 3. Unicode PDF Font Fast-Path Detection
  assert.equal(textRequiresUnicodeFont("Standard quiz text with 1 + 2 = 3 and ±5° × ÷"), false);
  assert.equal(textRequiresUnicodeFont("Solve for x: x ≥ 5 and πr² = √16"), true);
  assert.equal(textRequiresUnicodeFont("Angle α + β = 90°"), true);

  // 4. Production AI Quota Reset Guard
  const envMap = process.env as Record<string, string | undefined>;
  const origNodeEnv = envMap.NODE_ENV;
  try {
    envMap.NODE_ENV = "production";
    assert.equal(isProductionBuild(), true, "isProductionBuild() must detect NODE_ENV=production");
    envMap.NODE_ENV = "development";
    assert.equal(isProductionBuild(), false, "isProductionBuild() must allow dev/test mode");
  } finally {
    if (origNodeEnv === undefined) delete envMap.NODE_ENV;
    else envMap.NODE_ENV = origNodeEnv;
  }

  console.log("ALL SECURITY, APPROVAL, ITEM ANALYSIS & UNICODE GUARD TESTS PASSED!");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
