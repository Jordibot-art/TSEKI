import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface StudentQuestionResult {
  questionNumber: number;
  questionText?: string;
  questionType?: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  pointsAwarded: number;
}

export interface StudentQuizResult {
  studentId: string;
  studentName: string;
  classroomId: string;
  quizTitle: string;
  scorePercentage: number;
  totalScore: number;
  maxScore: number;
  results: StudentQuestionResult[];
  gradedAt: string;
}

export interface QuestionAnalysisSummary {
  questionNumber: number;
  questionText?: string;
  questionType?: string;
  correctAnswer: string;
  totalAttempts: number;
  correctCount: number;
  incorrectCount: number;
  accuracyRate: number; // 0-100
  studentsMissed: string[]; // names of students who got it wrong
}

export interface ClassQuizAnalysis {
  quizTitle: string;
  totalStudentsGraded: number;
  classAverageScore: number;
  questionBreakdown: QuestionAnalysisSummary[];
  hardestQuestions: QuestionAnalysisSummary[]; // top 3 most-missed
  easiestQuestions: QuestionAnalysisSummary[]; // top 3 easiest
}

// ── Storage Keys ──────────────────────────────────────────────────────────────
const RESULTS_PREFIX = "tseki_quiz_results_";

function getStorageKey(classroomId: string): string {
  return `${RESULTS_PREFIX}${classroomId}`;
}

// ── Save Per-Student Quiz Results ─────────────────────────────────────────────
/**
 * Persists a student's per-question grading results for later analysis.
 * Stores one entry per student per quiz (updates if regraded).
 */
export async function saveStudentQuizResult(
  result: StudentQuizResult
): Promise<void> {
  const key = getStorageKey(result.classroomId);
  try {
    const existing = await getAllStudentQuizResults(result.classroomId);

    // Remove previous entry for same student + quiz (if regraded)
    const filtered = existing.filter(
      (r) =>
        !(
          r.studentId === result.studentId &&
          r.quizTitle === result.quizTitle
        )
    );

    filtered.push(result);
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to save student quiz result:", err);
  }
}

// ── Load All Results for a Classroom ──────────────────────────────────────────
export async function getAllStudentQuizResults(
  classroomId: string
): Promise<StudentQuizResult[]> {
  const key = getStorageKey(classroomId);
  try {
    const json = await AsyncStorage.getItem(key);
    if (json) {
      return JSON.parse(json);
    }
  } catch (err) {
    console.error("Failed to load student quiz results:", err);
  }
  return [];
}

// ── Get Results for a Specific Student ────────────────────────────────────────
export async function getStudentResults(
  classroomId: string,
  studentId: string
): Promise<StudentQuizResult[]> {
  const all = await getAllStudentQuizResults(classroomId);
  return all.filter((r) => r.studentId === studentId);
}

// ── Get Results for a Specific Quiz ───────────────────────────────────────────
export async function getQuizResults(
  classroomId: string,
  quizTitle: string
): Promise<StudentQuizResult[]> {
  const all = await getAllStudentQuizResults(classroomId);
  return all.filter((r) => r.quizTitle === quizTitle);
}

// ── Class-Wide Quiz Analysis ──────────────────────────────────────────────────
/**
 * Analyzes all graded results for a specific quiz across the class.
 * Identifies hardest/easiest questions and which students missed each.
 */
export async function analyzeQuizForClass(
  classroomId: string,
  quizTitle: string
): Promise<ClassQuizAnalysis | null> {
  const quizResults = await getQuizResults(classroomId, quizTitle);
  if (quizResults.length === 0) return null;

  // Build per-question aggregates
  const questionMap = new Map<number, QuestionAnalysisSummary>();

  for (const studentResult of quizResults) {
    for (const qr of studentResult.results) {
      const existing = questionMap.get(qr.questionNumber);
      if (existing) {
        existing.totalAttempts++;
        if (qr.isCorrect) {
          existing.correctCount++;
        } else {
          existing.incorrectCount++;
          existing.studentsMissed.push(studentResult.studentName);
        }
        existing.accuracyRate = Math.round(
          (existing.correctCount / existing.totalAttempts) * 100
        );
      } else {
        questionMap.set(qr.questionNumber, {
          questionNumber: qr.questionNumber,
          questionText: qr.questionText,
          questionType: qr.questionType,
          correctAnswer: qr.correctAnswer,
          totalAttempts: 1,
          correctCount: qr.isCorrect ? 1 : 0,
          incorrectCount: qr.isCorrect ? 0 : 1,
          accuracyRate: qr.isCorrect ? 100 : 0,
          studentsMissed: qr.isCorrect ? [] : [studentResult.studentName],
        });
      }
    }
  }

  const allQuestions = Array.from(questionMap.values()).sort(
    (a, b) => a.questionNumber - b.questionNumber
  );

  // Sort by accuracy to find hardest/easiest
  const sorted = [...allQuestions].sort(
    (a, b) => a.accuracyRate - b.accuracyRate
  );
  const hardestQuestions = sorted.slice(0, 3);
  const easiestQuestions = sorted.slice(-3).reverse();

  const classAverageScore = Math.round(
    quizResults.reduce((sum, r) => sum + r.scorePercentage, 0) /
      quizResults.length
  );

  return {
    quizTitle,
    totalStudentsGraded: quizResults.length,
    classAverageScore,
    questionBreakdown: allQuestions,
    hardestQuestions,
    easiestQuestions,
  };
}

// ── Get Student's Weak Areas Across All Quizzes ───────────────────────────────
/**
 * Analyzes a student's question-level results to determine topic areas of weakness.
 * Returns the question types and specific questions the student struggles with.
 */
export function analyzeStudentWeakAreas(
  studentResults: StudentQuizResult[]
): {
  totalQuestionsAttempted: number;
  totalCorrect: number;
  overallAccuracy: number;
  weakQuestionTypes: { type: string; accuracy: number; missed: number; total: number }[];
  recentMissedQuestions: { quizTitle: string; questionNumber: number; questionText?: string; correctAnswer: string }[];
  trend: "improving" | "declining" | "stable" | "insufficient_data";
} {
  if (studentResults.length === 0) {
    return {
      totalQuestionsAttempted: 0,
      totalCorrect: 0,
      overallAccuracy: 0,
      weakQuestionTypes: [],
      recentMissedQuestions: [],
      trend: "insufficient_data",
    };
  }

  let totalAttempted = 0;
  let totalCorrect = 0;

  // Aggregate by question type
  const typeMap = new Map<string, { correct: number; total: number }>();

  // Track recently missed questions (from all quizzes)
  const recentMissed: {
    quizTitle: string;
    questionNumber: number;
    questionText?: string;
    correctAnswer: string;
  }[] = [];

  for (const quiz of studentResults) {
    for (const qr of quiz.results) {
      totalAttempted++;
      if (qr.isCorrect) totalCorrect++;

      const qType = qr.questionType || "unknown";
      const existing = typeMap.get(qType) || { correct: 0, total: 0 };
      existing.total++;
      if (qr.isCorrect) existing.correct++;
      typeMap.set(qType, existing);

      if (!qr.isCorrect) {
        recentMissed.push({
          quizTitle: quiz.quizTitle,
          questionNumber: qr.questionNumber,
          questionText: qr.questionText,
          correctAnswer: qr.correctAnswer,
        });
      }
    }
  }

  // Determine weak question types (accuracy below 60%)
  const weakQuestionTypes = Array.from(typeMap.entries())
    .map(([type, stats]) => ({
      type,
      accuracy: Math.round((stats.correct / stats.total) * 100),
      missed: stats.total - stats.correct,
      total: stats.total,
    }))
    .filter((t) => t.accuracy < 60)
    .sort((a, b) => a.accuracy - b.accuracy);

  // Determine trend from quiz scores over time
  let trend: "improving" | "declining" | "stable" | "insufficient_data" =
    "insufficient_data";
  if (studentResults.length >= 2) {
    const sorted = [...studentResults].sort(
      (a, b) =>
        new Date(a.gradedAt).getTime() - new Date(b.gradedAt).getTime()
    );
    const recentScores = sorted.slice(-3).map((r) => r.scorePercentage);
    if (recentScores.length >= 2) {
      const first = recentScores[0];
      const last = recentScores[recentScores.length - 1];
      const diff = last - first;
      if (diff > 5) trend = "improving";
      else if (diff < -5) trend = "declining";
      else trend = "stable";
    }
  }

  return {
    totalQuestionsAttempted: totalAttempted,
    totalCorrect,
    overallAccuracy: totalAttempted > 0
      ? Math.round((totalCorrect / totalAttempted) * 100)
      : 0,
    weakQuestionTypes,
    recentMissedQuestions: recentMissed.slice(-5), // Last 5 missed
    trend,
  };
}

// ── Delete Results for a Classroom ────────────────────────────────────────────
export async function deleteClassroomQuizResults(
  classroomId: string
): Promise<void> {
  const key = getStorageKey(classroomId);
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.error("Failed to delete classroom quiz results:", err);
  }
}
