import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────
export type DifficultyLevel = "Easy" | "Moderate" | "Difficult";

export function getDifficultyLevel(p: number): DifficultyLevel {
  if (p >= 0.75) return "Easy";
  if (p >= 0.25) return "Moderate";
  return "Difficult";
}

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

export interface DistractorOptionStat {
  option: string;
  count: number;
  percentage: number;
  isCorrect: boolean;
}

export interface StudentMissedDetail {
  studentId?: string;
  studentName: string;
  studentAnswer: string;
}

export interface QuestionAnalysisSummary {
  questionNumber: number;
  questionText?: string;
  questionType?: string;
  correctAnswer: string;
  options?: string[];
  totalAttempts: number;
  correctCount: number;
  incorrectCount: number;
  accuracyRate: number; // 0-100%
  missedRate: number; // 0-100%
  difficultyIndex: number; // 0.00 to 1.00 (p-value = correctCount / totalAttempts)
  difficultyLevel: DifficultyLevel; // "Easy" (>=0.75), "Moderate" (0.25-0.74), "Difficult" (<0.25)
  distractorCounts: Record<string, number>; // e.g. { "A": 2, "B": 6, "C": 1 }
  distractorBreakdown: DistractorOptionStat[];
  mostCommonMistake?: {
    answer: string;
    count: number;
    percentage: number;
  };
  pedagogicalInsight?: string;
  studentsMissed: string[]; // names of students who got it wrong
  studentsMissedDetails: StudentMissedDetail[];
  studentsCorrect: string[];
}

export interface ClassQuizAnalysis {
  quizTitle: string;
  totalStudentsGraded: number;
  classAverageScore: number;
  averageDifficultyIndex: number; // average p-value across all questions
  difficultyBreakdown: {
    easyCount: number;
    moderateCount: number;
    difficultCount: number;
  };
  questionBreakdown: QuestionAnalysisSummary[];
  mostMissedQuestions: QuestionAnalysisSummary[]; // sorted by highest missed rate / lowest p-value
  hardestQuestions: QuestionAnalysisSummary[]; // alias for mostMissedQuestions
  easiestQuestions: QuestionAnalysisSummary[];
  overallRecommendation: string;
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
 * Computes per-question difficulty index (p-value), identifies most-missed questions,
 * calculates distractor frequency distribution, and generates pedagogical recommendations.
 */
export async function analyzeQuizForClass(
  classroomId: string,
  quizTitle: string,
  publishedQuiz?: any,
  rosterStudents?: { id: string; full_name: string }[]
): Promise<ClassQuizAnalysis | null> {
  const quizResults = await getQuizResults(classroomId, quizTitle);
  
  if (quizResults.length === 0) {
    return null;
  }

  // Build per-question aggregates
  const questionMap = new Map<number, {
    questionNumber: number;
    questionText?: string;
    questionType?: string;
    correctAnswer: string;
    options?: string[];
    totalAttempts: number;
    correctCount: number;
    incorrectCount: number;
    distractorCounts: Record<string, number>;
    studentsMissed: string[];
    studentsMissedDetails: StudentMissedDetail[];
    studentsCorrect: string[];
  }>();

  // If a published quiz definition is available, pre-populate question metadata
  if (publishedQuiz && Array.isArray(publishedQuiz.questions)) {
    for (const q of publishedQuiz.questions) {
      const qNum = q.questionNumber || q.id;
      questionMap.set(qNum, {
        questionNumber: qNum,
        questionText: q.questionText || q.question,
        questionType: q.type || q.questionType || "multiple_choice",
        correctAnswer: String(q.correctAnswer || "").trim().toUpperCase(),
        options: Array.isArray(q.options) ? q.options : ["A", "B", "C", "D"],
        totalAttempts: 0,
        correctCount: 0,
        incorrectCount: 0,
        distractorCounts: {},
        studentsMissed: [],
        studentsMissedDetails: [],
        studentsCorrect: [],
      });
    }
  }

  for (const studentResult of quizResults) {
    for (const qr of studentResult.results) {
      const qNum = qr.questionNumber;
      let existing = questionMap.get(qNum);
      const studentAns = String(qr.studentAnswer || "BLANK").trim().toUpperCase();

      if (!existing) {
        existing = {
          questionNumber: qNum,
          questionText: qr.questionText,
          questionType: qr.questionType,
          correctAnswer: String(qr.correctAnswer || "").trim().toUpperCase(),
          options: ["A", "B", "C", "D"],
          totalAttempts: 0,
          correctCount: 0,
          incorrectCount: 0,
          distractorCounts: {},
          studentsMissed: [],
          studentsMissedDetails: [],
          studentsCorrect: [],
        };
        questionMap.set(qNum, existing);
      }

      existing.totalAttempts++;
      existing.distractorCounts[studentAns] = (existing.distractorCounts[studentAns] || 0) + 1;

      if (qr.isCorrect) {
        existing.correctCount++;
        existing.studentsCorrect.push(studentResult.studentName);
      } else {
        existing.incorrectCount++;
        existing.studentsMissed.push(studentResult.studentName);
        existing.studentsMissedDetails.push({
          studentId: studentResult.studentId,
          studentName: studentResult.studentName,
          studentAnswer: qr.studentAnswer || "Blank",
        });
      }
    }
  }

  const allQuestions: QuestionAnalysisSummary[] = Array.from(questionMap.values())
    .filter((q) => q.totalAttempts > 0)
    .map((raw) => {
      const accuracyRate = raw.totalAttempts > 0 ? Math.round((raw.correctCount / raw.totalAttempts) * 100) : 0;
      const missedRate = 100 - accuracyRate;
      const difficultyIndex = raw.totalAttempts > 0 ? Math.round((raw.correctCount / raw.totalAttempts) * 100) / 100 : 0.50;
      const difficultyLevel = getDifficultyLevel(difficultyIndex);

      // Distractor Breakdown
      const standardOptions = raw.options && raw.options.length > 0 ? raw.options : ["A", "B", "C", "D"];
      const distractorBreakdown: DistractorOptionStat[] = standardOptions.map((opt) => {
        const optLetter = opt.length === 1 ? opt.toUpperCase() : opt.charAt(0).toUpperCase();
        const count = raw.distractorCounts[optLetter] || raw.distractorCounts[opt] || 0;
        const percentage = raw.totalAttempts > 0 ? Math.round((count / raw.totalAttempts) * 100) : 0;
        const isCorrect = optLetter === raw.correctAnswer || opt === raw.correctAnswer;
        return {
          option: optLetter,
          count,
          percentage,
          isCorrect,
        };
      });

      // Find Most Common Mistake
      let mostCommonMistake: { answer: string; count: number; percentage: number } | undefined;
      for (const [ans, count] of Object.entries(raw.distractorCounts)) {
        if (ans !== raw.correctAnswer && count > 0) {
          if (!mostCommonMistake || count > mostCommonMistake.count) {
            mostCommonMistake = {
              answer: ans,
              count,
              percentage: raw.totalAttempts > 0 ? Math.round((count / raw.totalAttempts) * 100) : 0,
            };
          }
        }
      }

      // Pedagogical Insight
      let pedagogicalInsight = "";
      if (difficultyLevel === "Difficult") {
        pedagogicalInsight = `${missedRate}% of students missed this question. ${
          mostCommonMistake
            ? `Most common misconception was option [${mostCommonMistake.answer}] (${mostCommonMistake.percentage}% chose this). `
            : ""
        }Targeted concept re-teaching recommended.`;
      } else if (difficultyLevel === "Moderate") {
        pedagogicalInsight = `Balanced discriminator (p = ${difficultyIndex}). ${accuracyRate}% demonstrated mastery, while ${missedRate}% need brief reinforcement.`;
      } else {
        pedagogicalInsight = `High mastery item (p = ${difficultyIndex}). ${accuracyRate}% answered correctly. Excellent retention.`;
      }

      return {
        questionNumber: raw.questionNumber,
        questionText: raw.questionText,
        questionType: raw.questionType,
        correctAnswer: raw.correctAnswer,
        options: raw.options,
        totalAttempts: raw.totalAttempts,
        correctCount: raw.correctCount,
        incorrectCount: raw.incorrectCount,
        accuracyRate,
        missedRate,
        difficultyIndex,
        difficultyLevel,
        distractorCounts: raw.distractorCounts,
        distractorBreakdown,
        mostCommonMistake,
        pedagogicalInsight,
        studentsMissed: raw.studentsMissed,
        studentsMissedDetails: raw.studentsMissedDetails,
        studentsCorrect: raw.studentsCorrect,
      };
    })
    .sort((a, b) => a.questionNumber - b.questionNumber);

  // Sort by highest miss rate / lowest difficulty index to find most missed questions
  const mostMissedQuestions = [...allQuestions].sort(
    (a, b) => b.missedRate - a.missedRate || a.difficultyIndex - b.difficultyIndex
  );
  const hardestQuestions = mostMissedQuestions.slice(0, 3);
  const easiestQuestions = [...allQuestions].sort(
    (a, b) => b.accuracyRate - a.accuracyRate || b.difficultyIndex - a.difficultyIndex
  ).slice(0, 3);

  const totalGraded = quizResults.length;
  const classAverageScore = Math.round(
    quizResults.reduce((sum, r) => sum + r.scorePercentage, 0) / (totalGraded || 1)
  );

  const avgDiff = allQuestions.length > 0
    ? Math.round((allQuestions.reduce((sum, q) => sum + q.difficultyIndex, 0) / allQuestions.length) * 100) / 100
    : 0.50;

  const easyCount = allQuestions.filter((q) => q.difficultyLevel === "Easy").length;
  const moderateCount = allQuestions.filter((q) => q.difficultyLevel === "Moderate").length;
  const difficultCount = allQuestions.filter((q) => q.difficultyLevel === "Difficult").length;

  let overallRecommendation = "";
  if (difficultCount >= 3) {
    overallRecommendation = `Found ${difficultCount} difficult items. We recommend reviewing Questions ${mostMissedQuestions.slice(0, 2).map((q) => `Q${q.questionNumber}`).join(" & ")} during the next class session.`;
  } else if (easyCount >= allQuestions.length * 0.7) {
    overallRecommendation = `Class demonstrated high facility across most items. Consider introducing higher-order Bloom's taxonomy application problems.`;
  } else {
    overallRecommendation = `Well-balanced assessment difficulty. Moderate questions effectively discriminated student performance across the class.`;
  }

  return {
    quizTitle,
    totalStudentsGraded: totalGraded,
    classAverageScore,
    averageDifficultyIndex: avgDiff,
    difficultyBreakdown: {
      easyCount,
      moderateCount,
      difficultCount,
    },
    questionBreakdown: allQuestions,
    mostMissedQuestions,
    hardestQuestions,
    easiestQuestions,
    overallRecommendation,
  };
}

/**
 * Generates an authentic, realistic Item Analysis benchmark for preview or zero-data testing.
 * Uses real student names from the classroom roster and aligns with published quiz questions.
 */
export function generateDemoQuizAnalysis(
  quizTitle: string,
  classroomTitle?: string,
  rosterStudents?: { id: string; full_name: string }[],
  publishedQuiz?: any
): ClassQuizAnalysis {
  const defaultNames = [
    "Sarah Jenkins",
    "Michael Chang",
    "Emily Davis",
    "Liam Vance",
    "Sophia Reyes",
    "Lucas Wright",
    "Olivia Chen",
    "Noah Miller",
    "Mia Santos",
  ];

  const studentPool = rosterStudents && rosterStudents.length >= 3
    ? rosterStudents.map((s) => s.full_name)
    : defaultNames;

  const totalStudents = studentPool.length;

  // Realistic question blueprints
  const defaultItems = [
    {
      qNum: 1,
      text: "Which cellular organelle is responsible for ATP synthesis via aerobic respiration?",
      key: "A",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 89, // Easy (p = 0.89)
      misconceptions: { A: 8, B: 1, C: 0, D: 0 },
    },
    {
      qNum: 2,
      text: "What is the primary role of messenger RNA (mRNA) in protein biosynthesis?",
      key: "B",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 67, // Moderate (p = 0.67)
      misconceptions: { A: 1, B: 6, C: 2, D: 0 },
    },
    {
      qNum: 3,
      text: "During enzyme catalysis, how does the presence of an active enzyme affect activation energy?",
      key: "C",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 78, // Easy (p = 0.78)
      misconceptions: { A: 1, B: 1, C: 7, D: 0 },
    },
    {
      qNum: 4,
      text: "During which phase of mitosis do sister chromatids segregate and migrate to opposite poles?",
      key: "A",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 22, // Difficult (p = 0.22) - Top Most Missed!
      misconceptions: { A: 2, B: 6, C: 1, D: 0 }, // 6 students picked B (Metaphase)
    },
    {
      qNum: 5,
      text: "Which lipid bilayer property is maintained by cholesterol molecules at low temperatures?",
      key: "D",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 56, // Moderate (p = 0.56)
      misconceptions: { A: 1, B: 2, C: 1, D: 5 },
    },
    {
      qNum: 6,
      text: "In anaerobic fermentation in human muscle cells, what is pyruvate converted into?",
      key: "B",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 67, // Moderate (p = 0.67)
      misconceptions: { A: 1, B: 6, C: 1, D: 1 },
    },
    {
      qNum: 7,
      text: "Which law of thermodynamics states that total entropy of an isolated system always increases?",
      key: "C",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 33, // Difficult (p = 0.33) - 2nd Most Missed!
      misconceptions: { A: 4, B: 2, C: 3, D: 0 }, // 4 students picked A (First law)
    },
    {
      qNum: 8,
      text: "What type of cellular junction provides tight cytoplasmic bridges between adjacent plant cells?",
      key: "A",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 78, // Easy (p = 0.78)
      misconceptions: { A: 7, B: 1, C: 1, D: 0 },
    },
    {
      qNum: 9,
      text: "Which metabolic cycle occurs in the mitochondrial matrix to generate NADH and FADH2?",
      key: "D",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 56, // Moderate (p = 0.56)
      misconceptions: { A: 1, B: 2, C: 1, D: 5 },
    },
    {
      qNum: 10,
      text: "Which organelle contains hydrolytic digestive enzymes for autolysis and waste degradation?",
      key: "B",
      type: "multiple_choice",
      options: ["A", "B", "C", "D"],
      accuracy: 89, // Easy (p = 0.89)
      misconceptions: { A: 0, B: 8, C: 1, D: 0 },
    },
  ];

  // If published quiz has questions, use its actual questions & keys
  const itemsToUse = publishedQuiz && Array.isArray(publishedQuiz.questions) && publishedQuiz.questions.length > 0
    ? publishedQuiz.questions.map((q: any, idx: number) => {
        const fallback = defaultItems[idx % defaultItems.length];
        return {
          qNum: q.questionNumber || (idx + 1),
          text: q.questionText || q.question || fallback.text,
          key: String(q.correctAnswer || fallback.key).trim().toUpperCase(),
          type: q.type || fallback.type,
          options: Array.isArray(q.options) && q.options.length > 0 ? q.options : fallback.options,
          accuracy: fallback.accuracy,
          misconceptions: fallback.misconceptions,
        };
      })
    : defaultItems;

  const questionBreakdown: QuestionAnalysisSummary[] = itemsToUse.map((item) => {
    const correctCount = Math.max(1, Math.round((item.accuracy / 100) * totalStudents));
    const incorrectCount = totalStudents - correctCount;
    const accuracyRate = Math.round((correctCount / totalStudents) * 100);
    const missedRate = 100 - accuracyRate;
    const difficultyIndex = Math.round((correctCount / totalStudents) * 100) / 100;
    const difficultyLevel = getDifficultyLevel(difficultyIndex);

    // Distribute students
    const studentsCorrect = studentPool.slice(0, correctCount);
    const studentsMissed = studentPool.slice(correctCount);

    const distractorCounts: Record<string, number> = {
      [item.key]: correctCount,
    };

    // Allocate incorrect answers across options
    const otherOptions = ["A", "B", "C", "D"].filter((o) => o !== item.key);
    const primaryDistractor = item.qNum === 4 ? "B" : item.qNum === 7 ? "A" : otherOptions[0];
    const secondaryDistractor = otherOptions.find((o) => o !== primaryDistractor) || otherOptions[1];

    const primaryCount = Math.ceil(incorrectCount * 0.7);
    const secondaryCount = incorrectCount - primaryCount;

    if (primaryCount > 0) distractorCounts[primaryDistractor] = primaryCount;
    if (secondaryCount > 0) distractorCounts[secondaryDistractor] = secondaryCount;

    const distractorBreakdown: DistractorOptionStat[] = ["A", "B", "C", "D"].map((opt) => {
      const count = distractorCounts[opt] || 0;
      return {
        option: opt,
        count,
        percentage: Math.round((count / totalStudents) * 100),
        isCorrect: opt === item.key,
      };
    });

    const mostCommonMistake = incorrectCount > 0 ? {
      answer: primaryDistractor,
      count: primaryCount,
      percentage: Math.round((primaryCount / totalStudents) * 100),
    } : undefined;

    const studentsMissedDetails: StudentMissedDetail[] = studentsMissed.map((name, i) => ({
      studentId: `stud-${i}`,
      studentName: name,
      studentAnswer: i < primaryCount ? primaryDistractor : secondaryDistractor,
    }));

    let pedagogicalInsight = "";
    if (difficultyLevel === "Difficult") {
      pedagogicalInsight = `${missedRate}% of students missed this item. ${
        mostCommonMistake
          ? `Widespread misconception: ${mostCommonMistake.percentage}% chose distractor [${mostCommonMistake.answer}]. `
          : ""
      }Reviewing this concept with targeted practice is strongly recommended.`;
    } else if (difficultyLevel === "Moderate") {
      pedagogicalInsight = `Optimal discriminator (p = ${difficultyIndex}). ${accuracyRate}% demonstrated mastery, while ${missedRate}% need brief reinforcement.`;
    } else {
      pedagogicalInsight = `High mastery item (p = ${difficultyIndex}). ${accuracyRate}% class accuracy. Core concept well understood.`;
    }

    return {
      questionNumber: item.qNum,
      questionText: item.text,
      questionType: item.type,
      correctAnswer: item.key,
      options: item.options,
      totalAttempts: totalStudents,
      correctCount,
      incorrectCount,
      accuracyRate,
      missedRate,
      difficultyIndex,
      difficultyLevel,
      distractorCounts,
      distractorBreakdown,
      mostCommonMistake,
      pedagogicalInsight,
      studentsMissed,
      studentsMissedDetails,
      studentsCorrect,
    };
  });

  const mostMissedQuestions = [...questionBreakdown].sort(
    (a, b) => b.missedRate - a.missedRate || a.difficultyIndex - b.difficultyIndex
  );
  const hardestQuestions = mostMissedQuestions.slice(0, 3);
  const easiestQuestions = [...questionBreakdown].sort(
    (a, b) => b.accuracyRate - a.accuracyRate || b.difficultyIndex - a.difficultyIndex
  ).slice(0, 3);

  const avgDiff = Math.round((questionBreakdown.reduce((sum, q) => sum + q.difficultyIndex, 0) / questionBreakdown.length) * 100) / 100;
  const classAverageScore = Math.round(avgDiff * 100);

  const easyCount = questionBreakdown.filter((q) => q.difficultyLevel === "Easy").length;
  const moderateCount = questionBreakdown.filter((q) => q.difficultyLevel === "Moderate").length;
  const difficultCount = questionBreakdown.filter((q) => q.difficultyLevel === "Difficult").length;

  return {
    quizTitle: quizTitle || "Classroom Assessment",
    totalStudentsGraded: totalStudents,
    classAverageScore,
    averageDifficultyIndex: avgDiff,
    difficultyBreakdown: {
      easyCount,
      moderateCount,
      difficultCount,
    },
    questionBreakdown,
    mostMissedQuestions,
    hardestQuestions,
    easiestQuestions,
    overallRecommendation: `Item Analysis flagged ${difficultCount} questions needing review (Q4 & Q7). 67% of missed answers on Q4 selected distractor [B]. Consider re-teaching Mitosis phases before the next unit test.`,
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
