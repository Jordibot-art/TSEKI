// AUTO-SYNCED FROM /shared — edit the canonical file in /shared and run `npm run sync:shared`.
/**
 * Shared Pure Question Performance & Item Analysis Engine
 *
 * Computes per-question difficulty index (p-value), distractor breakdown,
 * most common misconception, hardest/easiest items, and pedagogical advice
 * directly from graded student quiz results (no platform/storage dependencies).
 */

export type DifficultyLevel = "Easy" | "Moderate" | "Difficult";

export function getDifficultyLevel(p: number): DifficultyLevel {
  if (p >= 0.75) return "Easy";
  if (p >= 0.25) return "Moderate";
  return "Difficult";
}

export interface ItemResultInput {
  questionNumber: number;
  questionText?: string;
  questionType?: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  pointsAwarded?: number;
}

export interface QuizResultInput {
  studentId: string;
  studentName?: string;
  quizTitle: string;
  scorePercentage: number;
  totalScore: number;
  maxScore: number;
  results: ItemResultInput[];
}

export interface QuizQuestionMeta {
  questionNumber?: number;
  id?: number;
  questionText?: string;
  question?: string;
  type?: string;
  questionType?: string;
  correctAnswer?: string;
  options?: string[];
}

export interface QuizDefinitionMeta {
  questions?: QuizQuestionMeta[];
  answerKey?: Array<{ questionNumber?: number; qNum?: number; correctAnswer?: string }>;
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
  accuracyRate: number;
  missedRate: number;
  difficultyIndex: number;
  difficultyLevel: DifficultyLevel;
  distractorCounts: Record<string, number>;
  distractorBreakdown: DistractorOptionStat[];
  mostCommonMistake?: {
    answer: string;
    count: number;
    percentage: number;
  };
  pedagogicalInsight: string;
  studentsMissed: string[];
  studentsMissedDetails: StudentMissedDetail[];
  studentsCorrect: string[];
}

export interface ClassQuizAnalysis {
  quizTitle: string;
  totalStudentsGraded: number;
  classAverageScore: number;
  averageDifficultyIndex: number;
  difficultyBreakdown: {
    easyCount: number;
    moderateCount: number;
    difficultCount: number;
  };
  questionBreakdown: QuestionAnalysisSummary[];
  mostMissedQuestions: QuestionAnalysisSummary[];
  hardestQuestions: QuestionAnalysisSummary[];
  easiestQuestions: QuestionAnalysisSummary[];
  overallRecommendation: string;
}

export function computeClassQuizAnalysis(
  quizTitle: string,
  quizResults: QuizResultInput[],
  publishedQuiz?: QuizDefinitionMeta | null,
  rosterStudents?: Array<{ id: string; full_name: string }>
): ClassQuizAnalysis | null {
  if (!quizResults || quizResults.length === 0) {
    return null;
  }

  const questionMap = new Map<
    number,
    {
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
    }
  >();

  if (publishedQuiz && Array.isArray(publishedQuiz.questions)) {
    for (const q of publishedQuiz.questions) {
      const qNum = Number(q.questionNumber || q.id);
      if (!Number.isFinite(qNum) || qNum <= 0) continue;
      const keyItem = Array.isArray(publishedQuiz.answerKey)
        ? publishedQuiz.answerKey.find((k) => Number(k.questionNumber || k.qNum) === qNum)
        : null;
      const ans = keyItem?.correctAnswer || q.correctAnswer || "";

      questionMap.set(qNum, {
        questionNumber: qNum,
        questionText: q.questionText || q.question,
        questionType: q.type || q.questionType || "multiple_choice",
        correctAnswer: String(ans || "").trim().toUpperCase(),
        options: Array.isArray(q.options) && q.options.length > 0 ? q.options : ["A", "B", "C", "D"],
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
    const rawName = (studentResult.studentName || "").trim();
    const matchedRoster = rosterStudents?.find((s) => s.id === studentResult.studentId);
    const resolvedStudentName = rawName || matchedRoster?.full_name?.trim() || "";

    const items = Array.isArray(studentResult.results) ? studentResult.results : [];
    for (const qr of items) {
      const qNum = Number(qr.questionNumber);
      if (!Number.isFinite(qNum) || qNum <= 0) continue;

      let existing = questionMap.get(qNum);
      const studentAns = String(qr.studentAnswer || "BLANK").trim().toUpperCase();

      if (!existing) {
        const keyItem = Array.isArray(publishedQuiz?.answerKey)
          ? publishedQuiz!.answerKey!.find((k) => Number(k.questionNumber || k.qNum) === qNum)
          : null;
        const ans = keyItem?.correctAnswer || qr.correctAnswer || "";

        existing = {
          questionNumber: qNum,
          questionText: qr.questionText,
          questionType: qr.questionType,
          correctAnswer: String(ans || "").trim().toUpperCase(),
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
      } else if (!existing.correctAnswer && qr.correctAnswer) {
        existing.correctAnswer = String(qr.correctAnswer).trim().toUpperCase();
      }

      existing.totalAttempts++;
      existing.distractorCounts[studentAns] = (existing.distractorCounts[studentAns] || 0) + 1;

      if (qr.isCorrect) {
        existing.correctCount++;
        if (resolvedStudentName) existing.studentsCorrect.push(resolvedStudentName);
      } else {
        existing.incorrectCount++;
        if (resolvedStudentName) {
          existing.studentsMissed.push(resolvedStudentName);
          existing.studentsMissedDetails.push({
            studentId: studentResult.studentId,
            studentName: resolvedStudentName,
            studentAnswer: qr.studentAnswer || "Blank",
          });
        }
      }
    }
  }

  const allQuestions: QuestionAnalysisSummary[] = Array.from(questionMap.values())
    .filter((q) => q.totalAttempts > 0)
    .map((raw) => {
      const accuracyRate =
        raw.totalAttempts > 0 ? Math.round((raw.correctCount / raw.totalAttempts) * 100) : 0;
      const missedRate = 100 - accuracyRate;
      const difficultyIndex =
        raw.totalAttempts > 0 ? Math.round((raw.correctCount / raw.totalAttempts) * 100) / 100 : 0.5;
      const difficultyLevel = getDifficultyLevel(difficultyIndex);

      const standardOptions =
        raw.options && raw.options.length > 0 ? raw.options : ["A", "B", "C", "D"];
      const distractorBreakdown: DistractorOptionStat[] = standardOptions.map((opt) => {
        const optLetter = opt.length === 1 ? opt.toUpperCase() : opt.charAt(0).toUpperCase();
        const count = raw.distractorCounts[optLetter] || raw.distractorCounts[opt] || 0;
        const percentage =
          raw.totalAttempts > 0 ? Math.round((count / raw.totalAttempts) * 100) : 0;
        const isCorrect = optLetter === raw.correctAnswer || opt === raw.correctAnswer;
        return { option: optLetter, count, percentage, isCorrect };
      });

      let mostCommonMistake: { answer: string; count: number; percentage: number } | undefined;
      for (const [ans, count] of Object.entries(raw.distractorCounts)) {
        if (ans !== raw.correctAnswer && count > 0) {
          if (!mostCommonMistake || count > mostCommonMistake.count) {
            mostCommonMistake = {
              answer: ans,
              count,
              percentage:
                raw.totalAttempts > 0 ? Math.round((count / raw.totalAttempts) * 100) : 0,
            };
          }
        }
      }

      let pedagogicalInsight = "";
      if (difficultyLevel === "Difficult") {
        pedagogicalInsight = `${missedRate}% of students missed this question. ${
          mostCommonMistake
            ? `Most common misconception was [${mostCommonMistake.answer}] (${mostCommonMistake.percentage}%). `
            : ""
        }Targeted concept re-teaching recommended.`;
      } else if (difficultyLevel === "Moderate") {
        pedagogicalInsight = `Balanced discriminator (p = ${difficultyIndex.toFixed(2)}). ${accuracyRate}% demonstrated mastery, while ${missedRate}% need brief reinforcement.`;
      } else {
        pedagogicalInsight = `High mastery item (p = ${difficultyIndex.toFixed(2)}). ${accuracyRate}% answered correctly.`;
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

  const classAverageScore = Math.round(
    quizResults.reduce((acc, r) => acc + (Number(r.scorePercentage) || 0), 0) / quizResults.length
  );

  const averageDifficultyIndex =
    allQuestions.length > 0
      ? Math.round(
          (allQuestions.reduce((acc, q) => acc + q.difficultyIndex, 0) / allQuestions.length) * 100
        ) / 100
      : 0;

  const difficultyBreakdown = {
    easyCount: allQuestions.filter((q) => q.difficultyLevel === "Easy").length,
    moderateCount: allQuestions.filter((q) => q.difficultyLevel === "Moderate").length,
    difficultCount: allQuestions.filter((q) => q.difficultyLevel === "Difficult").length,
  };

  const mostMissedQuestions = [...allQuestions].sort(
    (a, b) => a.difficultyIndex - b.difficultyIndex || b.missedRate - a.missedRate
  );
  const easiestQuestions = [...allQuestions].sort(
    (a, b) => b.difficultyIndex - a.difficultyIndex || b.accuracyRate - a.accuracyRate
  );

  let overallRecommendation =
    "Assessment items show healthy balance across difficulty bands. Continue reinforcing moderately missed concepts.";
  if (allQuestions.length === 0) {
    overallRecommendation =
      "Overall scores are recorded, but per-item answer breakdown was not stored for this quiz yet. Grade sheets using Tseki Scan to unlock item-level distractor diagnostics.";
  } else if (difficultyBreakdown.difficultCount > allQuestions.length * 0.4) {
    overallRecommendation = `${difficultyBreakdown.difficultCount} of ${allQuestions.length} items fell in the Difficult band (p < 0.25). Schedule a focused review session before moving to the next unit.`;
  } else if (classAverageScore >= 85) {
    overallRecommendation = `Strong overall mastery (${classAverageScore}% class average). Consider enrichment or higher-order Bloom's application items next.`;
  }

  return {
    quizTitle,
    totalStudentsGraded: quizResults.length,
    classAverageScore,
    averageDifficultyIndex,
    difficultyBreakdown,
    questionBreakdown: allQuestions,
    mostMissedQuestions,
    hardestQuestions: mostMissedQuestions,
    easiestQuestions,
    overallRecommendation,
  };
}
