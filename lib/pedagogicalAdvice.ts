import { analyzeStudentWeakAreas, StudentQuizResult } from "./questionAnalysis";

// ── Readable Question Type Labels ─────────────────────────────────────────────
const QUESTION_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple Choice",
  true_false: "True/False",
  fill_blank: "Fill in the Blank",
  identification: "Identification",
  enumeration: "Enumeration",
  unknown: "mixed",
};

function formatQuestionType(type: string): string {
  return QUESTION_TYPE_LABELS[type] || type;
}

function getFirstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}

// ── Student-Level Advice ──────────────────────────────────────────────────────
/**
 * Generates context-aware pedagogical advice for a single student's profile.
 */
export function generateStudentAdvice(params: {
  studentName: string;
  average: number;
  classAverage: number;
  highestAvg: number;
  subject?: string;
  quizTitle?: string;
  difficulty?: string;
  totalStudents: number;
  studentResults?: StudentQuizResult[];
}): string {
  const {
    studentName,
    average,
    classAverage,
    highestAvg,
    subject,
    quizTitle,
    difficulty,
    totalStudents,
    studentResults,
  } = params;

  const firstName = getFirstName(studentName);
  const subjectLabel = subject && subject !== "No Subject" ? subject : "the subject";
  const quizLabel = quizTitle || "the assessment";
  const isFlagged = average <= 50;
  const isTop = !isFlagged && highestAvg > 50 && average === highestAvg;
  const isAboveAverage = average > classAverage && !isTop;
  const isNearPassing = average > 50 && average < 75;
  const diffLabel = difficulty || "Standard";

  // Analyze per-question data if available
  const analysis = studentResults && studentResults.length > 0
    ? analyzeStudentWeakAreas(studentResults)
    : null;

  // ── TOP TIER (highest in class) ───────────────────────────────────────────
  if (isTop) {
    const base = `${firstName} leads the class at ${average}% in ${subjectLabel}!`;

    if (analysis && analysis.trend === "improving") {
      return `${base} Their scores show a consistently upward trajectory. Consider assigning ${firstName} as a peer tutor or creating an advanced ${diffLabel === "Hard" ? "mastery-level" : "harder-tier"} quiz on ${subjectLabel} to keep them challenged and engaged.`;
    }

    if (analysis && analysis.weakQuestionTypes.length > 0) {
      const weakType = formatQuestionType(analysis.weakQuestionTypes[0].type);
      return `${base} Despite being top-tier, ${firstName} shows some difficulty with ${weakType} questions (${analysis.weakQuestionTypes[0].accuracy}% accuracy). A targeted ${weakType} practice set could strengthen this area while maintaining their overall excellence.`;
    }

    return `${base} Consider assigning ${firstName} as a peer tutor or creating an advanced, harder-tier quiz on ${subjectLabel} to keep them challenged. They could also benefit from leadership roles in group activities.`;
  }

  // ── AT-RISK / FLAGGED (≤50%) ──────────────────────────────────────────────
  if (isFlagged) {
    // Deep analysis with per-question data
    if (analysis && analysis.recentMissedQuestions.length > 0) {
      const missedCount = analysis.recentMissedQuestions.length;

      if (analysis.weakQuestionTypes.length > 0) {
        const weakTypes = analysis.weakQuestionTypes
          .slice(0, 2)
          .map((t) => formatQuestionType(t.type))
          .join(" and ");

        if (analysis.trend === "declining") {
          return `${firstName} is at ${average}% in ${subjectLabel} and their scores are declining. They've missed ${missedCount} questions recently, struggling particularly with ${weakTypes} items. I strongly recommend a focused remedial session: create a shorter, 5-question Easy-difficulty quiz on ${subjectLabel} targeting ${weakTypes} concepts to rebuild foundational understanding before moving forward.`;
        }

        if (analysis.trend === "improving") {
          return `${firstName} is still at-risk at ${average}%, but showing signs of improvement in ${subjectLabel}! They struggle most with ${weakTypes} questions. Keep the momentum going — a targeted Easy-difficulty practice quiz focusing on ${weakTypes} concepts in ${subjectLabel} could help them cross the passing threshold.`;
        }

        return `${firstName} is struggling at ${average}% in ${subjectLabel}. Analysis shows weakness in ${weakTypes} questions (missed ${missedCount} items recently). I recommend creating a shorter, Easy-difficulty quiz focused on introductory ${subjectLabel} concepts using ${weakTypes} format to rebuild confidence step by step.`;
      }

      return `${firstName} scored ${average}% on "${quizLabel}" and missed ${missedCount} questions. I recommend a remedial quiz with Easy difficulty focused on the fundamental concepts of ${subjectLabel} to strengthen their foundation before tackling more complex material.`;
    }

    // Fallback without per-question data
    if (average <= 30) {
      return `${firstName} is critically at-risk at ${average}% in ${subjectLabel}. This signals a significant gap in foundational understanding. I recommend starting with the basics — create a short, 5-question Easy-difficulty quiz on introductory ${subjectLabel} concepts and consider one-on-one support or peer tutoring to close the gap.`;
    }

    return `${firstName} is below the passing threshold at ${average}% in ${subjectLabel}. I recommend creating a focused, Easy-difficulty practice quiz on core ${subjectLabel} concepts to rebuild their confidence and close knowledge gaps. ${classAverage > 65 ? `The class average is ${classAverage}%, so targeted support can help ${firstName} catch up.` : ""}`;
  }

  // ── NEAR PASSING (51%-74%) ────────────────────────────────────────────────
  if (isNearPassing) {
    if (analysis && analysis.weakQuestionTypes.length > 0) {
      const weakType = formatQuestionType(analysis.weakQuestionTypes[0].type);
      const trendMsg =
        analysis.trend === "improving"
          ? `${firstName} is trending upward — great progress!`
          : analysis.trend === "declining"
          ? `${firstName}'s scores are dipping — targeted practice is key.`
          : "";

      return `${firstName} is at ${average}% in ${subjectLabel}, just below the passing mark. ${trendMsg} They particularly struggle with ${weakType} questions. A targeted Medium-difficulty practice session focusing on ${weakType} items in ${subjectLabel} could push them across the 75% threshold.`;
    }

    const gap = 75 - average;
    return `${firstName} is ${gap} points away from passing at ${average}% in ${subjectLabel}. They're close! Recommend focused practice on "${quizLabel}" concepts with a ${diffLabel === "Hard" ? "Medium" : diffLabel}-difficulty review quiz to reinforce areas of weakness and push past the passing threshold.`;
  }

  // ── ABOVE AVERAGE (above class avg but not top) ───────────────────────────
  if (isAboveAverage) {
    if (analysis && analysis.weakQuestionTypes.length > 0) {
      const weakType = formatQuestionType(analysis.weakQuestionTypes[0].type);
      return `${firstName} is performing well at ${average}% in ${subjectLabel}, above the class average of ${classAverage}%. To reach top-tier status, focus on strengthening ${weakType} questions where their accuracy drops to ${analysis.weakQuestionTypes[0].accuracy}%. A targeted Hard-difficulty practice set could bridge the gap.`;
    }

    return `${firstName} is performing solidly at ${average}% in ${subjectLabel}, above the class average of ${classAverage}%. To push toward the top tier, recommend a challenging practice set on advanced ${subjectLabel} topics to deepen mastery.`;
  }

  // ── ON TRACK (75%-89%, at or near class average) ──────────────────────────
  if (analysis && analysis.trend === "declining") {
    return `${firstName} is at ${average}% in ${subjectLabel} but their recent scores show a downward trend. Recommend reviewing recent ${subjectLabel} material and creating a targeted practice quiz on "${quizLabel}" concepts to stabilize performance before it drops further.`;
  }

  if (analysis && analysis.weakQuestionTypes.length > 0) {
    const weakType = formatQuestionType(analysis.weakQuestionTypes[0].type);
    return `${firstName} is maintaining steady progress at ${average}% in ${subjectLabel}. They handle most question types well but show some difficulty with ${weakType} items. Targeted practice on complex ${subjectLabel} problem sets emphasizing ${weakType} format could boost them toward the top tier.`;
  }

  return `${firstName} is maintaining steady progress at ${average}% in ${subjectLabel}. Recommend targeted practice on complex ${subjectLabel} problem sets to help boost mastery toward the top tier. ${average >= 85 ? `They're close to top-tier performance!` : `A focused review of "${quizLabel}" concepts could help.`}`;
}

// ── Classroom-Level Advice ────────────────────────────────────────────────────
/**
 * Generates context-aware pedagogical advice for the Tracker overview.
 */
export function generateClassroomAdvice(params: {
  classAverage: number;
  passRate: number;
  totalStudents: number;
  atRiskStudents: { name: string; average: number }[];
  topStudents: { name: string; average: number }[];
  subject?: string;
  classTitle?: string;
  quizTitle?: string;
  gradeDistribution?: { a: number; b: number; c: number; f: number };
  trend?: "improving" | "declining" | "stable" | "insufficient_data";
}): string {
  const {
    classAverage,
    passRate,
    totalStudents,
    atRiskStudents,
    topStudents,
    subject,
    classTitle,
    quizTitle,
    gradeDistribution,
    trend,
  } = params;

  const subjectLabel = subject && subject !== "No Subject" ? subject : classTitle;
  const quizLabel = quizTitle || "the assessment";

  // ── EMPTY CLASSROOM ─────────────────────────────────────────────────────
  if (totalStudents === 0) {
    return `Welcome to ${classTitle}! Add students in the Record tab or create your first ${subjectLabel} quiz in AI Builder to get started. Once you've graded papers, I'll provide personalized insights about your class performance.`;
  }

  // ── CRITICAL: Many at-risk (≥50% of class) ──────────────────────────────
  if (atRiskStudents.length > 0 && atRiskStudents.length >= totalStudents * 0.5) {
    const names = atRiskStudents
      .slice(0, 3)
      .map((s) => getFirstName(s.name))
      .join(", ");
    const moreCount = atRiskStudents.length - 3;

    return `⚠️ Critical: ${atRiskStudents.length} out of ${totalStudents} students (${Math.round((atRiskStudents.length / totalStudents) * 100)}%) are at-risk in ${subjectLabel}${moreCount > 0 ? ` — including ${names} and ${moreCount} more` : ` — including ${names}`}. The class average is only ${classAverage}%. I strongly recommend creating an Easy-difficulty remedial quiz on foundational ${subjectLabel} concepts to rebuild the class's understanding. Consider reviewing how the material was taught.`;
  }

  // ── SOME AT-RISK STUDENTS ───────────────────────────────────────────────
  if (atRiskStudents.length > 0) {
    const names = atRiskStudents
      .slice(0, 3)
      .map((s) => `${getFirstName(s.name)} (${s.average}%)`)
      .join(", ");

    let trendNote = "";
    if (trend === "declining") {
      trendNote = " and class performance is trending downward";
    } else if (trend === "improving") {
      trendNote = ", though overall class performance is improving";
    }

    if (atRiskStudents.length === 1) {
      const s = atRiskStudents[0];
      return `${getFirstName(s.name)} is struggling at ${s.average}% in ${subjectLabel}${trendNote}. Click "Create remedial quiz" to generate a targeted Easy-difficulty practice quiz that can help them catch up. ${topStudents.length > 0 ? `Consider pairing them with ${getFirstName(topStudents[0].name)} for peer tutoring.` : ""}`;
    }

    return `${atRiskStudents.length} student${atRiskStudents.length > 1 ? "s" : ""} need attention in ${subjectLabel}: ${names}${trendNote}. Click "Create remedial quiz" to generate targeted Easy-difficulty practice material. ${passRate < 70 ? `Only ${passRate}% of the class is passing — consider reviewing core concepts.` : ""}`;
  }

  // ── ALL PASSING, LOW CLASS AVERAGE (75-80%) ─────────────────────────────
  if (classAverage < 80 && classAverage >= 75) {
    const nearFailCount = gradeDistribution
      ? gradeDistribution.c + gradeDistribution.f
      : 0;

    if (nearFailCount > 0) {
      return `Everyone is passing in ${subjectLabel}, but ${nearFailCount} student${nearFailCount > 1 ? "s are" : " is"} near the threshold at C-grade or below (class average: ${classAverage}%). A review quiz on "${quizLabel}" concepts could help solidify understanding and push scores higher.`;
    }

    return `The class is passing ${subjectLabel} with a ${classAverage}% average, but there's room for growth. Consider a Medium-difficulty review quiz on "${quizLabel}" to strengthen weaker areas and push the average higher.`;
  }

  // ── STRONG PERFORMANCE (≥80%) ───────────────────────────────────────────
  if (classAverage >= 80) {
    if (trend === "declining") {
      return `The class is performing well at ${classAverage}% in ${subjectLabel}, but recent scores show a slight decline. Consider a focused review session on "${quizLabel}" to maintain momentum. ${topStudents.length > 0 ? `${getFirstName(topStudents[0].name)} leads at ${topStudents[0].average}%.` : ""}`;
    }

    if (classAverage >= 90) {
      return `Outstanding! The class is excelling at ${classAverage}% in ${subjectLabel}. ${topStudents.length > 0 ? `${getFirstName(topStudents[0].name)} leads at ${topStudents[0].average}%.` : ""} Challenge them further with a Hard-difficulty quiz using AI Builder to push mastery to the next level and prepare for advanced material.`;
    }

    return `Great performance! The class averages ${classAverage}% in ${subjectLabel} with a ${passRate}% pass rate. ${topStudents.length > 0 ? `${getFirstName(topStudents[0].name)} leads at ${topStudents[0].average}%.` : ""} Consider creating a challenging quiz using AI Builder to keep top performers engaged and push everyone higher.`;
  }

  // ── DEFAULT FALLBACK ────────────────────────────────────────────────────
  return `The class averages ${classAverage}% in ${subjectLabel}. ${passRate >= 80 ? "Most students are on track!" : `${passRate}% are passing.`} Review "${quizLabel}" results and use AI Builder to create targeted practice material for areas that need improvement.`;
}
