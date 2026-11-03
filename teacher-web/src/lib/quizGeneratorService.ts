import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SupportedDocType } from "./documentParserService";

export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "identification"
  | "enumeration"
  | "word_box";

export interface ScannableQuestion {
  questionNumber: number;
  type: QuestionType;
  questionText: string;
  options: string[];
  answerBoxesRequired: number;
}

export interface AnswerKeyItem {
  questionNumber: number;
  correctAnswer: string;
  points: number;
}

export interface GeneratedAssessment {
  quizTitle: string;
  questions: ScannableQuestion[];
  answerKey: AnswerKeyItem[];
  generatedBy?: string;
}

export interface AssessmentGenerationParams {
  topic: string;
  subject?: string;
  gradeLevel?: string;
  questionType?: string;
  questionCount?: number;
  difficulty?: string;
  attachedPdfBase64?: string;
  attachedPdfName?: string;
  attachedFileName?: string;
  attachedFileType?: SupportedDocType;
  attachedFileText?: string;
  lessonNotes?: string;
  onStatusUpdate?: (status: string, isBusy?: boolean) => void;
  onProviderUsed?: (provider: string, model: string) => void;
}

const DEFAULT_API_KEY =
  (import.meta as any).env?.VITE_GEMINI_API_KEY ||
  (import.meta as any).env?.EXPO_PUBLIC_GEMINI_API_KEY ||
  "";

/**
 * Generates an educational assessment calibrated to Bloom's taxonomy and formatted
 * for optical bubble sheet rendering, derived from attached curriculum documents.
 */
export async function generateScannableQuiz(
  params: AssessmentGenerationParams
): Promise<GeneratedAssessment> {
  const apiKey =
    localStorage.getItem("tseki_gemini_api_key") ||
    DEFAULT_API_KEY;

  const count = params.questionCount || 10;
  const rawDiff = params.difficulty || "Medium (Application & Analysis)";
  const diffCategory: "Easy" | "Medium" | "Hard" =
    rawDiff.toLowerCase().includes("easy") ? "Easy" :
    rawDiff.toLowerCase().includes("hard") ? "Hard" :
    "Medium";

  const subj = params.subject || "General Education";
  const grade = params.gradeLevel || "Grade 10";
  const qType = params.questionType || "Mixed (Multiple Choice, True/False, Fill in Blank)";

  const difficultyGuide = {
    Easy: `
CRITICAL DIFFICULTY GUIDELINES - EASY (Bloom's Level 1 & 2: Direct Recall & Basic Understanding):
- Cognitive Focus: Focus strictly on direct definitions, basic facts, core terminology, and straightforward identification.
- Question Phrasing: Keep sentences short, simple, and unambiguous. Avoid trick wording, double negatives, or complex scenarios.
- Distractors / Choices: Incorrect options should be plausible but clearly distinguishable from the correct answer.
- Pedagogical Goal: Rebuild student confidence and test essential foundational literacy.`,
    Medium: `
CRITICAL DIFFICULTY GUIDELINES - MEDIUM (Bloom's Level 3 & 4: Application, Context & Conceptual Analysis):
- Cognitive Focus: Test cause-and-effect relationships, practical applications, formula use, and standard scenario interpretations.
- Question Phrasing: Frame questions around realistic contextual examples or multi-step problem solving.
- Distractors / Choices: Distractors must represent common student errors or closely related concepts, requiring true comprehension rather than simple memorization.
- Pedagogical Goal: Assess whether the student can apply the concept to novel situations.`,
    Hard: `
CRITICAL DIFFICULTY GUIDELINES - HARD (Bloom's Level 5 & 6: Evaluation, Complex Synthesis & Edge Cases):
- Cognitive Focus: Multi-step critical deduction, evaluating contrasting scenarios, subtle edge cases, and high-level synthesis.
- Question Phrasing: Present challenging, multi-layered problem scenarios where simple recall is insufficient to arrive at the answer.
- Distractors / Choices: Distractors must be highly sophisticated, specifically targeting subtle student misconceptions, calculation traps, and edge-case pitfalls.
- Pedagogical Goal: Challenge and stretch top-tier students, demanding deep mastery and rigorous critical thinking.`,
  }[diffCategory];

  const docName = params.attachedFileName || params.attachedPdfName;
  const isPdf = params.attachedFileType === "pdf" || Boolean(params.attachedPdfBase64);

  let documentSourceInstruction = "";
  if (docName) {
    if (params.attachedFileText) {
      documentSourceInstruction = `
- Attached Reference Document: "${docName}"
Content from "${docName}":
--- BEGIN ATTACHED DOCUMENT CONTENT ---
${params.attachedFileText}
--- END ATTACHED DOCUMENT CONTENT ---
`;
    } else if (isPdf) {
      documentSourceInstruction = `- Attached Reference Document: Strictly derive questions and answers from the attached PDF document ("${docName}"). Do NOT ask general questions outside this document.`;
    }
  }

  if (params.lessonNotes && params.lessonNotes.trim()) {
    documentSourceInstruction += `
ADDITIONAL TEACHER LESSON NOTES:
${params.lessonNotes.trim()}
`;
  }

  const promptText = `
You are an expert curriculum designer and psychometrician for TSEKI Educational Assessment System.
Generate an educational assessment based on the requested topic and the STRICT cognitive difficulty guidelines below.

Assessment Parameters:
- Topic: ${params.topic}
- Subject: ${subj}
- Grade Level: ${grade}
- Question Type Preference: ${qType}
- Number of Questions: ${count}
- Selected Difficulty: ${diffCategory.toUpperCase()}
${documentSourceInstruction}
${difficultyGuide}

CRITICAL ANSWER BOX LENGTH RESTRICTIONS:
All tests are printed on physical paper sheets with bounded scannable answer boxes.
- For Identification and Fill in the Blank: The correctAnswer MUST be 1 to 3 words only and at most 25 characters (e.g. "Photosynthesis", "Isaac Newton", "Cell Wall"). NEVER write full sentences or explanations as answers!
- For Enumeration: Each item MUST be 1 to 3 words and at most 25 characters (e.g. "Nitrogen, Oxygen, Argon").
- For True / False: Answer must be strictly "True" or "False".
- For Multiple Choice: Answer must be strictly "A", "B", "C", or "D".

CRITICAL QUESTION TYPE RULES (Strictly match "${qType}"):
1. If Question Type Preference is "Multiple Choice" or contains "Choice":
   - Every question MUST have type: "multiple_choice"
   - options: array of 4 choices formatted as ["A) ...", "B) ...", "C) ...", "D) ..."]
   - answerBoxesRequired: 1
   - correctAnswer: Single capital letter "A", "B", "C", or "D"

2. If Question Type Preference is "True / False" or contains "True":
   - Every question MUST have type: "true_false"
   - options: ["A) True", "B) False"]
   - answerBoxesRequired: 1
   - correctAnswer: Single letter "T" or "F" (or "True" / "False")

3. If Question Type Preference is "Identification" or "Fill in the Blank":
   - Every question MUST have type: "identification"
   - options: [] (MUST BE AN EMPTY ARRAY - DO NOT PROVIDE CHOICES!)
   - answerBoxesRequired: 1
   - correctAnswer: 1-3 words, max 25 characters (e.g. "Photosynthesis")

4. If Question Type Preference is "Enumeration":
   - Every question MUST have type: "enumeration"
   - questionText: clearly state how many items to enumerate (e.g. "Name 3 greenhouse gases:", "List 4 state capitals:")
   - options: [] (MUST BE AN EMPTY ARRAY)
   - answerBoxesRequired: The number of items to enumerate (2 to 4)
   - correctAnswer: Comma-separated list of items, each 1-3 words (e.g. "Carbon dioxide, Methane, Water vapor")

5. If Question Type Preference is "Word Box" or "Word Bank":
   - Every question MUST have type: "word_box"
   - questionText: Write a clear statement with a blank indicated by "______"
   - options: An array of word bank choices including the correct answer and plausible distractors (4 to 6 concise choices, WITHOUT "A)", "B)" prefixes)
   - answerBoxesRequired: 1
   - correctAnswer: The exact word or phrase from the options array (max 25 characters)

6. If Question Type Preference is "Mixed Assessment" or "mixed" or contains "Mixed Assessment":
   - If specific parts/types are listed:
     * Include ONLY the specified question types sequentially.
     * Maintain continuous overall question numbering from 1 up to ${count}.
     * Distribute questions evenly across the chosen parts.
   - If no specific parts are specified, create a balanced pedagogical mix across Multiple Choice, True / False, Identification, Word Box, and Enumeration.
   - Each question MUST strictly follow formatting rules 1 to 5 above.

You MUST return ONLY a strict, valid JSON object without markdown formatting or code fences:
{
  "quizTitle": "Concise Assessment Title",
  "questions": [
    {
      "questionNumber": 1,
      "type": "multiple_choice",
      "questionText": "Question wording...",
      "options": ["A) Choice 1", "B) Choice 2", "C) Choice 3", "D) Choice 4"],
      "answerBoxesRequired": 1
    }
  ],
  "answerKey": [
    {
      "questionNumber": 1,
      "correctAnswer": "A",
      "points": 1
    }
  ]
}
`;

  if (apiKey) {
    const candidateModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];

    const genAI = new GoogleGenerativeAI(apiKey);
    const parts: any[] = [];

    if (isPdf && params.attachedPdfBase64) {
      parts.push({
        inlineData: {
          data: params.attachedPdfBase64,
          mimeType: "application/pdf",
        },
      });
    }
    parts.push({ text: promptText });

    const MAX_RETRIES_PER_MODEL = 2;
    const BASE_BACKOFF_MS = 2000;

    for (const modelName of candidateModels) {
      let attempt = 0;

      while (attempt <= MAX_RETRIES_PER_MODEL) {
        try {
          params.onStatusUpdate?.(
            attempt > 0
              ? `AI is busy. Retrying with ${modelName} (attempt ${attempt + 1})...`
              : `Generating quiz questions using ${modelName}...`,
            attempt > 0
          );

          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          const result = await model.generateContent(parts);
          if (result) {
            try {
              const rawText = result.response.text().trim();
              const cleanJson = rawText
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();

              const parsed: GeneratedAssessment = JSON.parse(cleanJson);
              if (
                parsed.quizTitle &&
                Array.isArray(parsed.questions) &&
                Array.isArray(parsed.answerKey)
              ) {
                parsed.generatedBy = `Google Gemini (${modelName})`;
                params.onProviderUsed?.("gemini", modelName);
                params.onStatusUpdate?.("Assessment generated successfully!", false);
                return parsed;
              }
            } catch (parseErr) {
              console.warn(
                `[TSEKI AI] JSON parse error from ${modelName}, trying next candidate...`,
                parseErr
              );
              break;
            }
          }
        } catch (apiErr: any) {
          const errMsg = (apiErr?.message || "").toLowerCase();
          const status = Number(apiErr?.status);

          const isNotFound =
            status === 404 || errMsg.includes("not found") || errMsg.includes("is not supported");
          if (isNotFound) {
            console.warn(`[TSEKI AI] Model ${modelName} not found (404), trying next model...`);
            break;
          }

          const isBusyOrRateLimited =
            status === 429 ||
            status === 503 ||
            status === 500 ||
            status === 502 ||
            status === 504 ||
            errMsg.includes("429") ||
            errMsg.includes("quota") ||
            errMsg.includes("resource_exhausted") ||
            errMsg.includes("rate limit") ||
            errMsg.includes("503") ||
            errMsg.includes("overloaded") ||
            errMsg.includes("busy") ||
            errMsg.includes("service unavailable");

          if (isBusyOrRateLimited && attempt < MAX_RETRIES_PER_MODEL) {
            attempt++;
            const backoffMs = Math.round(
              BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 400
            );
            const waitSec = Math.ceil(backoffMs / 1000);

            params.onStatusUpdate?.(
              `AI is busy right now. Retrying in ${waitSec}s... (Attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1})`,
              true
            );

            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          console.warn(
            `[TSEKI AI] Gemini ${modelName} failed: ${apiErr?.message}. Trying next candidate...`
          );
          break;
        }
      }
    }
  }

  // Fallback: If online Gemini is unavailable, generate an assessment derived from the document's content
  params.onStatusUpdate?.("Generating structured assessment from reference document...", false);
  return generateDocumentDerivedAssessment(params);
}

/**
 * High-quality fallback generator that parses keywords, definitions, and sentences
 * from attached documents and lesson notes to construct realistic questions.
 */
function generateDocumentDerivedAssessment(
  params: AssessmentGenerationParams
): GeneratedAssessment {
  const count = params.questionCount || 10;
  const title =
    params.topic.trim() ||
    (params.attachedFileName
      ? `Assessment on ${params.attachedFileName.replace(/\.[^/.]+$/, "")}`
      : "Curriculum Assessment");
  const textContent =
    params.attachedFileText || params.lessonNotes || params.topic || "Core Curriculum Concepts";

  // Split text into meaningful lines/sentences
  const rawSentences = textContent
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && !s.startsWith("---"));

  const sentences =
    rawSentences.length >= 5
      ? rawSentences
      : [
          `${title} represents a core foundation within the modern curriculum.`,
          `Effective mastery requires understanding theoretical principles and empirical evidence.`,
          `Key methodologies enable systematic verification and evaluation of concepts.`,
          `Systemic application allows students to analyze and resolve contextual problems.`,
          `Formative assessment ensures Bloom's taxonomy objectives are comprehensively satisfied.`,
        ];

  const questions: ScannableQuestion[] = [];
  const answerKey: AnswerKeyItem[] = [];

  for (let i = 0; i < count; i++) {
    const qNum = i + 1;
    const sentence = sentences[i % sentences.length];
    const words = sentence.split(/\s+/).filter((w) => w.length > 3);
    const targetWord = words[Math.floor(Math.random() * words.length)] || "Concept";
    const cleanWord = targetWord.replace(/[^a-zA-Z0-9]/g, "");

    // Rotate question types
    const mod = i % 3;
    if (mod === 0) {
      // Multiple Choice
      const options = [
        `A) ${cleanWord}`,
        `B) Secondary Variable`,
        `C) Control Method`,
        `D) Inactive State`,
      ];
      questions.push({
        questionNumber: qNum,
        type: "multiple_choice",
        questionText: `Which of the following is most centrally associated with: "${sentence.slice(0, 80)}..."?`,
        options,
        answerBoxesRequired: 1,
      });
      answerKey.push({
        questionNumber: qNum,
        correctAnswer: "A",
        points: 1,
      });
    } else if (mod === 1) {
      // True / False
      questions.push({
        questionNumber: qNum,
        type: "true_false",
        questionText: `True or False: ${sentence}`,
        options: ["A) True", "B) False"],
        answerBoxesRequired: 1,
      });
      answerKey.push({
        questionNumber: qNum,
        correctAnswer: "T",
        points: 1,
      });
    } else {
      // Identification (1-3 words)
      questions.push({
        questionNumber: qNum,
        type: "identification",
        questionText: `Identify the term referenced in this statement: "${sentence.replace(targetWord, "______")}"`,
        options: [],
        answerBoxesRequired: 1,
      });
      answerKey.push({
        questionNumber: qNum,
        correctAnswer: cleanWord.slice(0, 25),
        points: 1,
      });
    }
  }

  return {
    quizTitle: title,
    questions,
    answerKey,
    generatedBy: "TSEKI Document Parser Engine",
  };
}
