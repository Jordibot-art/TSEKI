import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ─────────────────────────────────────────────────────────────────────
export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "identification" | "enumeration";

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
}

/**
 * Generates an educational assessment formatted specifically for rendering onto
 * scannable test papers with physical answer boxes, along with a matching Answer Key.
 */
export async function generateScannableQuiz(
    params: AssessmentGenerationParams
): Promise<GeneratedAssessment> {
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Missing Gemini API Key. Ensure EXPO_PUBLIC_GEMINI_API_KEY is configured in your .env file.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"];

    const count = params.questionCount || 10;
    const diff = params.difficulty || "Medium";
    const subj = params.subject || "General Education";
    const grade = params.gradeLevel || "Grade 10";
    const qType = params.questionType || "Mixed (Multiple Choice, True/False, Fill in Blank)";

    const difficultyGuide = {
        Easy: `
CRITICAL DIFFICULTY GUIDELINES - EASY (Bloom's Level 1 & 2: Direct Recall & Basic Understanding):
- Cognitive Focus: Focus strictly on direct definitions, basic facts, core terminology, and straightforward identification.
- Question Phrasing: Keep sentences short, simple, and unambiguous. Avoid trick wording, double negatives, or complex scenarios.
- Distractors / Choices: Incorrect options should be plausible but clearly distinguishable from the correct answer for any student with basic familiarity.
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
    }[diff as "Easy" | "Medium" | "Hard"] || `
CRITICAL DIFFICULTY GUIDELINES:
- Calibrate the cognitive complexity, vocabulary, and distractor subtlety strictly to the requested "${diff}" level.`;

    let promptText = `
You are an expert curriculum designer and psychometrician. Generate an educational assessment based on the requested topic and the STRICT cognitive difficulty guidelines below.

Assessment Parameters:
- Topic: ${params.topic}
- Subject: ${subj}
- Grade Level: ${grade}
- Question Type Preference: ${qType}
- Number of Questions: ${count}
- Selected Difficulty: ${diff.toUpperCase()}
${params.attachedPdfName ? `- Source Document: Strictly derive questions and answers from the attached PDF document ("${params.attachedPdfName}"). Do NOT ask general questions outside this document.` : ""}

CRITICAL QUESTION TYPE RULES (Strictly match "${qType}"):
1. If Question Type Preference is "Multiple Choice":
   - Every question MUST have type: "multiple_choice"
   - options: array of 4 choices formatted as ["A) ...", "B) ...", "C) ...", "D) ..."]
   - answerBoxesRequired: 1
   - correctAnswer: Single capital letter "A", "B", "C", or "D"

2. If Question Type Preference is "True / False" or contains "True":
   - Every question MUST have type: "true_false"
   - options: ["A) True", "B) False"]
   - answerBoxesRequired: 1
   - correctAnswer: Single letter "T" or "F"

3. If Question Type Preference is "Identification" or "Fill in the Blank":
   - Every question MUST have type: "identification"
   - options: [] (MUST BE AN EMPTY ARRAY - DO NOT PROVIDE CHOICES!)
   - answerBoxesRequired: 1
   - correctAnswer: The exact concept, term, name, or word being tested (e.g. "Photosynthesis", "Isaac Newton")

4. If Question Type Preference is "Enumeration":
   - Every question MUST have type: "enumeration"
   - questionText: clearly state how many items to enumerate (e.g. "Name 3 greenhouse gases:", "List the 4 cardinal directions:")
   - options: [] (MUST BE AN EMPTY ARRAY - DO NOT PROVIDE CHOICES!)
   - answerBoxesRequired: The number of items to enumerate (between 2 and 4)
   - correctAnswer: Comma-separated list of items (e.g. "Carbon dioxide, Methane, Water vapor")

5. If Question Type Preference is "Mixed Assessment":
   - Create a balanced pedagogical mix of the above types across the test (e.g. Multiple Choice, True / False, Identification, and Enumeration) following each type's exact rules.

You MUST return ONLY a strict, valid JSON object. Do not include markdown formatting (like \`\`\`json). The JSON must perfectly follow this structure so it can be rendered into a scannable test paper:

{
  "quizTitle": "Generated Title Here",
  "questions": [
    {
      "questionNumber": 1,
      "type": "multiple_choice", // Must be one of: "multiple_choice", "true_false", "identification", "enumeration"
      "questionText": "What is the capital of France?",
      "options": ["A) London", "B) Paris", "C) Berlin", "D) Rome"], // Leave empty array [] if identification or enumeration
      "answerBoxesRequired": 1 // 1 for MC/TF/Identification, 2-4 for Enumeration
    }
  ],
  "answerKey": [
    {
      "questionNumber": 1,
      "correctAnswer": "B",
      "points": 1
    }
  ]
}
`;

    const parts: any[] = [];
    if (params.attachedPdfBase64) {
        parts.push({
            inlineData: {
                data: params.attachedPdfBase64,
                mimeType: "application/pdf",
            },
        });
    }
    parts.push({ text: promptText });

    let result: any = null;
    let lastError: any = null;

    // Try candidate models sequentially (fallback if one hits 429 quota or 404)
    for (const modelName of candidateModels) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.2,
                },
            });

            result = await model.generateContent(parts);
            if (result) break; // Succeeded!
        } catch (apiErr: any) {
            lastError = apiErr;
            const errMsg = apiErr?.message || "";
            const is429 = errMsg.includes("429") || errMsg.includes("quota");
            const is404 = errMsg.includes("404") || errMsg.includes("not found");
            const is503 = errMsg.includes("503");

            console.warn(`[QuizGen] Model ${modelName} failed (${is429 ? "Quota 429" : is503 ? "Busy 503" : "Error"}). Trying next model...`);
            continue;
        }
    }

    if (!result) {
        throw lastError || new Error("No response received from AI quiz generator.");
    }

    const rawText = result.response.text().trim();
    const cleanJson = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const parsed: GeneratedAssessment = JSON.parse(cleanJson);

    if (!parsed.quizTitle || !Array.isArray(parsed.questions) || !Array.isArray(parsed.answerKey)) {
        throw new Error("Invalid assessment schema returned from Gemini.");
    }

    return parsed;
}
