import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "./ai/geminiKey";

// ── Types ─────────────────────────────────────────────────────────────────────
export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "identification" | "enumeration" | "word_box";

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
    topic?: string;
    lessonNotes?: string;
    subject?: string;
    gradeLevel?: string;
    questionType?: string;
    questionCount?: number;
    difficulty?: string;
    attachedPdfBase64?: string;
    attachedPdfName?: string;
    attachedFileName?: string;
    attachedFileType?: "pdf" | "docx" | "doc" | "pptx" | "ppt" | "txt";
    attachedFileText?: string;
    onProviderUsed?: (provider: string, model: string) => void;
    onStatusUpdate?: (status: string, isBusy?: boolean) => void;
}

/**
 * Generates an educational assessment formatted specifically for rendering onto
 * scannable test papers with physical answer boxes, along with a matching Answer Key.
 */
export async function generateScannableQuiz(
    params: AssessmentGenerationParams
): Promise<GeneratedAssessment> {
    const apiKey = getGeminiApiKey();

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

    let lessonNotesInstruction = "";
    if (params.lessonNotes && params.lessonNotes.trim().length > 0) {
        lessonNotesInstruction = `
- Teacher's Lesson Notes / Syllabus Text:
--- BEGIN LESSON NOTES ---
${params.lessonNotes.trim()}
--- END LESSON NOTES ---
`;
    }

    const effectiveTopic =
        params.topic?.trim() ||
        (docName ? `Content from ${docName}` : "") ||
        (params.lessonNotes?.trim() ? "Teacher's Lesson Notes & Syllabus Content" : `${subj} Course Material`);

    let sourceMaterialSection = "";
    if (documentSourceInstruction || lessonNotesInstruction) {
        sourceMaterialSection = `
STRICT ASSESSMENT SOURCE MATERIAL:
The user has provided reference learning material below. You MUST strictly base your questions, correct answers, and distractors on the provided content. Do NOT generate questions on external topics not mentioned in these materials:
${documentSourceInstruction}
${lessonNotesInstruction}
`;
    }

    const promptText = `
You are an expert curriculum designer and psychometrician. Generate an educational assessment based on the requested materials and the STRICT cognitive difficulty guidelines below.

Assessment Parameters:
- Topic / Focus: ${effectiveTopic}
- Subject: ${subj}
- Grade Level: ${grade}
- Question Type Preference: ${qType}
- Number of Questions: ${count}
- Selected Bloom's Difficulty: ${rawDiff} (${diffCategory.toUpperCase()})
${sourceMaterialSection}

${difficultyGuide}

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
   - Every question MUST have type: "identification" (or "fill_blank" if Fill in the Blank)
   - options: [] (MUST BE AN EMPTY ARRAY - DO NOT PROVIDE CHOICES!)
   - answerBoxesRequired: 1
   - correctAnswer: The exact concept, term, name, or word being tested (e.g. "Photosynthesis", "Isaac Newton"). MUST be 1 to 3 words, MAXIMUM 25 characters to fit handwritten paper boxes!

4. If Question Type Preference is "Enumeration":
   - Every question MUST have type: "enumeration"
   - questionText: clearly state how many items to enumerate (e.g. "Name 3 greenhouse gases:", "List the 4 cardinal directions:")
   - options: [] (MUST BE AN EMPTY ARRAY - DO NOT PROVIDE CHOICES!)
   - answerBoxesRequired: The number of items to enumerate (between 2 and 4)
   - correctAnswer: Comma-separated list of items (e.g. "Carbon dioxide, Methane, Water vapor"). Each individual item MUST be concise (1 to 3 words, under 25 characters)!

5. If Question Type Preference is "Word Box" or "Word Bank":
   - Every question MUST have type: "word_box"
   - questionText: Write a clear question or fill-in-the-blank statement with a blank indicated by "______" (e.g. "The national hero of the Philippines is ______.", "______ is the process by which plants make food using sunlight.")
   - options: An array of word bank choices that includes the correct answer AND distractor words. Include exactly 4 to 6 choices total, shuffled randomly. Format each as a simple word/phrase WITHOUT letter prefixes (e.g. ["Jose Rizal", "Andres Bonifacio", "Emilio Aguinaldo", "Apolinario Mabini"]) - NO "A)", "B)" prefixes!
   - answerBoxesRequired: 1
   - correctAnswer: The exact word or phrase from the options array that is the correct answer (e.g. "Jose Rizal")
   - IMPORTANT: The word bank (options) should contain plausible distractors that are related to the topic but incorrect, making the question challenging. The correct answer MUST appear exactly (case-sensitive) in the options array.

6. If Question Type Preference is "Mixed Assessment" or contains "Mixed Assessment":
   - If specific parts/types are listed (e.g. "include ONLY these parts sequentially: Part I. Multiple Choice, Part II. Enumeration, Part III. True / False"):
     * You MUST ONLY include the specified question types. Do NOT generate any unselected question types.
     * Organize the questions sequentially into sections in the EXACT order the parts are listed (e.g. Part I questions first, Part II questions next, Part III questions after), maintaining continuous overall question numbering (1, 2, 3... up to ${count}).
     * If exact per-part item counts are specified in parentheses (e.g. "Part I. Multiple Choice (5 items)"), generate that exact number of items for each part. Otherwise distribute the total question count evenly across the chosen parts.
   - If no specific parts are specified, create a balanced pedagogical mix across Multiple Choice, True / False, Identification, Word Box, and Enumeration.
   - Each individual question MUST strictly follow its respective formatting rules from items 1 to 5 above (including the strict 1-3 words, <= 25 characters limit on text/enumeration answers).

You MUST return ONLY a strict, valid JSON object. Do not include markdown formatting (like \`\`\`json). The JSON must perfectly follow this structure so it can be rendered into a scannable test paper:

{
  "quizTitle": "Generated Title Here",
  "questions": [
    {
      "questionNumber": 1,
      "type": "multiple_choice", // Must be one of: "multiple_choice", "true_false", "fill_blank", "identification", "enumeration", "word_box"
      "questionText": "What is the capital of France?",
      "options": ["A) London", "B) Paris", "C) Berlin", "D) Rome"], // Leave empty [] if identification or enumeration. For word_box: plain words WITHOUT letter prefixes e.g. ["Paris", "London", "Berlin", "Rome"]
      "answerBoxesRequired": 1 // 1 for MC/TF/Identification/WordBox, 2-4 for Enumeration
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
    if (isPdf && params.attachedPdfBase64) {
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

    if (apiKey) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
        const MAX_RETRIES_PER_MODEL = 2; // Up to 2 retries (3 total attempts) if rate-limited / busy
        const BASE_BACKOFF_MS = 2000;

        // Try candidate models sequentially with retry and exponential backoff
        for (const modelName of candidateModels) {
            let attempt = 0;

            while (attempt <= MAX_RETRIES_PER_MODEL) {
                try {
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.2,
                        },
                    });

                    result = await model.generateContent(parts);
                    if (result) {
                        try {
                            const rawText = result.response.text().trim();
                            const cleanJson = rawText
                                .replace(/^```(?:json)?\s*/i, "")
                                .replace(/\s*```$/i, "")
                                .trim();

                            const parsed: GeneratedAssessment = JSON.parse(cleanJson);
                            if (parsed.quizTitle && Array.isArray(parsed.questions) && Array.isArray(parsed.answerKey)) {
                                parsed.generatedBy = `Google Gemini (${modelName})`;
                                params.onProviderUsed?.("gemini", modelName);
                                params.onStatusUpdate?.("Assessment generated successfully!", false);
                                return parsed;
                            }
                        } catch (parseErr) {
                            console.warn(`[QuizGen] Failed to parse JSON from ${modelName}, trying next candidate...`, parseErr);
                            break; // JSON formatting issue on this model, switch candidate
                        }
                    }
                } catch (apiErr: any) {
                    lastError = apiErr;
                    const errMsg = (apiErr?.message || "").toLowerCase();
                    const status = Number(apiErr?.status);

                    const isInvalidKey =
                        status === 400 ||
                        status === 401 ||
                        errMsg.includes("api key not valid") ||
                        errMsg.includes("api_key_invalid");

                    if (isInvalidKey) {
                        console.warn(`[QuizGen] Gemini API key invalid. Fast-failing over to backup provider...`);
                        params.onStatusUpdate?.("Gemini API key rejected. Switching to backup AI provider...", true);
                        return await generateAssessmentWithBackupProvider(params, promptText, lastError);
                    }

                    const isNotFound = status === 404 || errMsg.includes("not found") || errMsg.includes("is not supported");
                    if (isNotFound) {
                        console.warn(`[QuizGen] Model ${modelName} not found (404), trying next model...`);
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
                        errMsg.includes("high demand") ||
                        errMsg.includes("busy") ||
                        errMsg.includes("service unavailable");

                    if (isBusyOrRateLimited && attempt < MAX_RETRIES_PER_MODEL) {
                        attempt++;
                        // Exponential backoff: ~2s on retry 1, ~4s on retry 2 (+ jitter)
                        const backoffMs = Math.round(BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 400);
                        const waitSec = Math.ceil(backoffMs / 1000);

                        console.warn(
                            `[QuizGen] AI is busy (${apiErr?.message || "rate-limited"}). Backing off ${backoffMs}ms before retry ${attempt}/${MAX_RETRIES_PER_MODEL}...`
                        );

                        // Show friendly "AI is busy" message to teacher
                        params.onStatusUpdate?.(
                            `AI is busy right now. Retrying in ${waitSec}s... (Attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1})`,
                            true
                        );

                        await new Promise((r) => setTimeout(r, backoffMs));

                        params.onStatusUpdate?.("AI is busy. Retrying assessment generation...", true);
                        continue;
                    }

                    console.warn(`[QuizGen] Gemini ${modelName} attempt ${attempt + 1} failed: ${apiErr?.message}. Trying next candidate...`);
                    break;
                }
            }
        }
    } else {
        lastError = new Error("Missing EXPO_PUBLIC_GEMINI_API_KEY.");
    }

    // ── Failover to Backup AI Provider (OpenRouter / Ollama / Groq) ───────────
    console.warn("[QuizGen] All Gemini options exhausted or rate-limited. Activating backup AI provider...");
    params.onStatusUpdate?.("Primary AI is busy. Switching to backup AI provider...", true);
    await new Promise((r) => setTimeout(r, 350));
    return await generateAssessmentWithBackupProvider(params, promptText, lastError);
}

/**
 * Executes assessment generation via configured OpenAI-compatible backup provider.
 */
export async function generateAssessmentWithBackupProvider(
    params: AssessmentGenerationParams,
    promptText: string,
    geminiError?: any
): Promise<GeneratedAssessment> {
    const { runBackupChain } = await import("./ai/backupRunner");

    // If PDF was attached without pre-extracted text, extract a compact reference snippet
    // (capped at 6,000 chars so backup models don't choke or time out).
    let docContext = "";
    if (params.attachedPdfBase64 && !params.attachedFileText) {
        try {
            const { extractStringsFromBinary } = await import("./documentParserService");
            const extracted = extractStringsFromBinary(params.attachedPdfBase64);
            if (extracted && extracted.length > 50) {
                docContext = `\n--- REFERENCE DOCUMENT EXCERPT (${params.attachedPdfName || "Attachment"}) ---\n${extracted.slice(0, 6000)}\n--- END REFERENCE EXCERPT ---\n`;
            }
        } catch (e) {
            console.warn("[QuizGen Backup] Could not extract text from PDF:", e);
        }
    } else if (params.attachedFileText && params.attachedFileText.length > 6000) {
        // If teacher attached very large text, keep the most relevant beginning
        docContext = `\n--- REFERENCE DOCUMENT EXCERPT (${params.attachedFileName || "Attachment"}) ---\n${params.attachedFileText.slice(0, 6000)}\n--- END REFERENCE EXCERPT ---\n`;
    }

    const messages = [
        {
            role: "system" as const,
            content: "You are an expert curriculum designer and psychometrician. You must generate valid JSON matching the requested educational assessment schema without any markdown formatting or commentary.",
        },
        {
            role: "user" as const,
            content: `${promptText}${docContext ? `\n\n${docContext}` : ""}`,
        },
    ];

    const expectedCount = params.questionCount || 10;
    const maxTokens = Math.min(4000, Math.max(1200, expectedCount * 180));

    try {
        const result = await runBackupChain<GeneratedAssessment>({
            kind: "text",
            messages,
            logTag: "[QuizGen Backup]",
            timeoutMs: 30000,
            totalBudgetMs: 50000,
            maxTokens,
            temperature: 0.2,
            onStatusUpdate: (status) => {
                params.onStatusUpdate?.(status, true);
            },
            validate: (json) => {
                if (json && json.quizTitle && Array.isArray(json.questions) && json.questions.length > 0 && Array.isArray(json.answerKey)) {
                    return json as GeneratedAssessment;
                }
                return null;
            },
        });

        const assessment = result.value;
        assessment.generatedBy = `${result.provider.toUpperCase()} (${result.model})`;
        params.onProviderUsed?.(result.provider, result.model);
        params.onStatusUpdate?.("Assessment generated successfully!", false);
        return assessment;
    } catch (err: any) {
        const combinedMsg = `${geminiError?.message || ""} ${err?.message || ""}`.toLowerCase();
        const isNetwork =
            combinedMsg.includes("network") ||
            combinedMsg.includes("internet") ||
            combinedMsg.includes("failed to fetch") ||
            combinedMsg.includes("network request failed") ||
            combinedMsg.includes("offline") ||
            combinedMsg.includes("enotfound");

        if (isNetwork) {
            throw new Error("No internet connection. Check your signal and try again.");
        }

        const isBusy =
            combinedMsg.includes("429") ||
            combinedMsg.includes("503") ||
            combinedMsg.includes("busy") ||
            combinedMsg.includes("quota") ||
            combinedMsg.includes("rate") ||
            combinedMsg.includes("overloaded") ||
            combinedMsg.includes("resource has been exhausted");

        if (isBusy) {
            throw new Error(
                `AI is busy right now (429/503). Both primary and backup providers were rate-limited or overloaded: ${err?.message || geminiError?.message}`
            );
        }

        throw new Error(
            `AI generation failed: ${err?.message || geminiError?.message || "Unknown error"}`
        );
    }
}

