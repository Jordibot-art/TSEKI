import type { GeneratedAssessment, AnswerKeyItem } from "./quizGeneratorService";

export interface FlaggedQuestion {
  questionNumber: number;
  answer: string;
  charCount: number;
  wordCount: number;
  warning: string;
}

/**
 * Validates that handwritten answers for Identification, Fill in the Blank,
 * and Enumeration do not exceed physical paper answer box capacity
 * (1-3 words, maximum 25 characters).
 */
export function validateAnswerLengths(assessment: GeneratedAssessment): FlaggedQuestion[] {
  const MAX_CHARS = 25;
  const MAX_WORDS = 3;
  const flagged: FlaggedQuestion[] = [];

  const keyMap = new Map<number, AnswerKeyItem>(
    (assessment.answerKey || []).map((k) => [k.questionNumber, k])
  );

  for (const q of assessment.questions) {
    const keyItem = keyMap.get(q.questionNumber);
    const rawAns = String(keyItem?.correctAnswer ?? (q as any).correctAnswer ?? "").trim();
    if (!rawAns) continue;

    if (q.type === "enumeration") {
      // Enumeration may contain comma/semicolon/slash/newline separated items
      const subItems = rawAns.split(/[,;\n/]+/).map((s) => s.trim()).filter(Boolean);
      for (const sub of subItems) {
        const wordCount = sub.split(/\s+/).filter(Boolean).length;
        if (sub.length > MAX_CHARS || wordCount > MAX_WORDS) {
          flagged.push({
            questionNumber: q.questionNumber,
            answer: sub,
            charCount: sub.length,
            wordCount,
            warning: `Enumeration item "${sub}" (${sub.length} chars, ${wordCount} words) exceeds the physical answer box limit (max 3 words / 25 chars).`,
          });
        }
      }
    } else if (q.type === "fill_blank" || q.type === "identification") {
      const wordCount = rawAns.split(/\s+/).filter(Boolean).length;
      if (rawAns.length > MAX_CHARS || wordCount > MAX_WORDS) {
        flagged.push({
          questionNumber: q.questionNumber,
          answer: rawAns,
          charCount: rawAns.length,
          wordCount,
          warning: `Answer "${rawAns}" (${rawAns.length} chars, ${wordCount} words) is too long for the handwritten answer box. Keep it to 1-3 words and under 25 characters.`,
        });
      }
    }
  }

  return flagged;
}
