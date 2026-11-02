import { GoogleGenerativeAI } from "@google/generative-ai";

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
}

/**
 * Generates an educational assessment formatted specifically for rendering onto
 * scannable test papers with physical answer boxes, along with a matching Answer Key.
 */
export async function generateScannableQuiz(
    params: AssessmentGenerationParams
): Promise<GeneratedAssessment> {
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

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
        const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"];

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
                            return parsed;
                        }
                    } catch (parseErr) {
                        console.warn(`[QuizGen] Failed to parse JSON from ${modelName}, trying next candidate...`, parseErr);
                    }
                }
            } catch (apiErr: any) {
                lastError = apiErr;
                const errMsg = apiErr?.message || "";
                const is429 = errMsg.includes("429") || errMsg.includes("quota");
                const is503 = errMsg.includes("503");

                console.warn(`[QuizGen] Gemini ${modelName} failed (${is429 ? "Quota 429" : is503 ? "Busy 503" : "Error"}). Trying next model...`);
                continue;
            }
        }
    } else {
        lastError = new Error("Missing EXPO_PUBLIC_GEMINI_API_KEY.");
    }

    // ── Failover to Backup AI Provider (OpenRouter / Ollama / Groq) ───────────
    console.warn("[QuizGen] All Gemini options exhausted or rate-limited. Activating backup AI provider...");
    return await generateAssessmentWithBackupProvider(params, promptText, lastError);
}

/**
 * Executes assessment generation via configured OpenAI-compatible backup provider.
 */
async function generateAssessmentWithBackupProvider(
    params: AssessmentGenerationParams,
    promptText: string,
    geminiError?: any
): Promise<GeneratedAssessment> {
    const { getAIConfig, DEFAULT_OPENROUTER_MODELS, DEFAULT_OLLAMA_MODELS, DEFAULT_GROQ_MODELS } = await import("./ai/aiConfigService");
    const { callOpenAICompatible, extractJsonFromResponse } = await import("./ai/openAICompatibleClient");

    const backupConfig = await getAIConfig();
    if (!backupConfig.enabled) {
        throw geminiError || new Error("Gemini AI is unavailable, and backup AI is disabled in Settings.");
    }

    let candidateModels: string[] = [];
    let apiKey: string | undefined = undefined;
    let baseUrl: string | undefined = undefined;

    if (backupConfig.provider === "openrouter") {
        apiKey = backupConfig.openRouterKey?.trim();
        if (!apiKey) {
            throw new Error(
                "Google Gemini is busy or rate-limited, but OpenRouter backup API key is missing. Please add your free OpenRouter API key in Settings."
            );
        }
        candidateModels = Array.from(new Set([backupConfig.openRouterModel, ...DEFAULT_OPENROUTER_MODELS].filter(Boolean)));
    } else if (backupConfig.provider === "ollama") {
        baseUrl = backupConfig.ollamaBaseUrl;
        candidateModels = Array.from(new Set([backupConfig.ollamaModel, ...DEFAULT_OLLAMA_MODELS].filter(Boolean)));
    } else if (backupConfig.provider === "groq") {
        apiKey = backupConfig.groqKey?.trim();
        if (!apiKey) {
            throw new Error(
                "Google Gemini is busy or rate-limited, but Groq backup API key is missing. Please add your Groq API key in Settings."
            );
        }
        candidateModels = Array.from(new Set([backupConfig.groqModel, ...DEFAULT_GROQ_MODELS].filter(Boolean)));
    }

    // If PDF was attached without pre-extracted text, extract readable text so backup model has access
    let docContext = "";
    if (params.attachedPdfBase64 && !params.attachedFileText) {
        try {
            const { extractStringsFromBinary } = await import("./documentParserService");
            const extracted = extractStringsFromBinary(params.attachedPdfBase64);
            if (extracted && extracted.length > 50) {
                docContext = `\n--- EXTRACTED REFERENCE DOCUMENT TEXT (${params.attachedPdfName || "Attachment"}) ---\n${extracted.slice(0, 50000)}\n--- END REFERENCE DOCUMENT TEXT ---\n`;
            }
        } catch (e) {
            console.warn("[QuizGen Backup] Could not extract text from PDF:", e);
        }
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

    let lastBackupErr: any = null;
    for (const modelName of candidateModels) {
        try {
            console.log(`[QuizGen Backup] Attempting generation via ${backupConfig.provider} (${modelName})...`);
            const callRes = await callOpenAICompatible({
                provider: backupConfig.provider,
                model: modelName,
                apiKey,
                baseUrl,
                messages,
                responseFormatJson: true,
                temperature: 0.2,
                timeoutMs: 40000,
            });

            const rawJson = callRes.json || extractJsonFromResponse(callRes.text);
            if (rawJson && rawJson.quizTitle && Array.isArray(rawJson.questions) && Array.isArray(rawJson.answerKey)) {
                rawJson.generatedBy = `${backupConfig.provider.toUpperCase()} (${modelName})`;
                params.onProviderUsed?.(backupConfig.provider, modelName);
                return rawJson as GeneratedAssessment;
            }
        } catch (bErr: any) {
            lastBackupErr = bErr;
            console.warn(`[QuizGen Backup] Model ${modelName} failed:`, bErr?.message);
            continue;
        }
    }

    throw new Error(
        `Gemini AI was unavailable (${geminiError?.message || "Rate-limited / busy"}), and backup provider ${backupConfig.provider.toUpperCase()} also failed: ${lastBackupErr?.message || "All models failed"}`
    );
}

