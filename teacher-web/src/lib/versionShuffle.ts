import type { AnswerKeyItem, GeneratedAssessment, ScannableQuestion } from "./quizGeneratorService";

/**
 * 32-bit FNV-1a hash function to derive a numeric seed from a string.
 */
function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Produces deterministic numbers between 0 and 1 for consistent shuffling across renders.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffles assessment questions for anti-cheating exam versions (Set A, Set B, Set C).
 *
 * - Set A: Original order (no shuffle).
 * - Set B: Deterministic shuffle using Set B seed.
 * - Set C: Deterministic shuffle using Set C seed.
 *
 * The corresponding answer key items are paired with questions and stay in perfect synchronization.
 */
export function shuffleAssessmentForVersion(
  assessment: GeneratedAssessment,
  version: "A" | "B" | "C" = "A",
  seedKey?: string
): GeneratedAssessment {
  if (version === "A" || !assessment.questions || assessment.questions.length <= 1) {
    return assessment;
  }

  const seedStr = `${seedKey || assessment.quizTitle || "TSEKI"}_SET_${version}`;
  const rng = mulberry32(hashString(seedStr));

  // Pair each question with its corresponding answer key item
  const keyMap = new Map<number, AnswerKeyItem>();
  (assessment.answerKey || []).forEach((ak) => {
    keyMap.set(ak.questionNumber, ak);
  });

  const pairs = assessment.questions.map((q) => ({
    question: { ...q, options: q.options ? [...q.options] : [] },
    answerKey: keyMap.get(q.questionNumber)
      ? { ...keyMap.get(q.questionNumber)! }
      : { questionNumber: q.questionNumber, correctAnswer: "", points: 1 },
  }));

  // Fisher-Yates shuffle
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = pairs[i];
    pairs[i] = pairs[j];
    pairs[j] = temp;
  }

  // Renumber 1..N
  const shuffledQuestions: ScannableQuestion[] = pairs.map((pair, idx) => ({
    ...pair.question,
    questionNumber: idx + 1,
  }));

  const shuffledAnswerKey: AnswerKeyItem[] = pairs.map((pair, idx) => ({
    ...pair.answerKey,
    questionNumber: idx + 1,
  }));

  return {
    ...assessment,
    questions: shuffledQuestions,
    answerKey: shuffledAnswerKey,
  };
}
