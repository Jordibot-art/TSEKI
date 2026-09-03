import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GradingResultItem {
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    pointsAwarded: number;
}

export interface GradingResponse {
    studentName: string;
    totalScore: number;
    maxScore: number;
    results: GradingResultItem[];
}

/**
 * Sends a student's handwritten test image and answer key to Gemini for automated grading.
 *
 * @param imageBase64 - Base64 encoded string of the captured paper (without or with data URI prefix)
 * @param answerKey   - The answer key object or array (e.g. from Supabase)
 * @param mimeType    - Image format: "image/jpeg" (default) or "image/png"
 * @returns Promise<GradingResponse>
 */
export async function gradeStudentTest(
    imageBase64: string,
    answerKey: any,
    mimeType: "image/jpeg" | "image/png" = "image/jpeg"
): Promise<GradingResponse> {
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Missing Gemini API Key. Ensure EXPO_PUBLIC_GEMINI_API_KEY is configured in your .env file.");
    }

    // Strip data URL prefix if present (e.g., 'data:image/jpeg;base64,...')
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "");

    const genAI = new GoogleGenerativeAI(apiKey);
    const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-2.5-flash"];

    const systemInstruction = `You are an expert automated grading assistant. Read the handwritten answers inside the boxes on the provided image. Compare them to this Answer Key: ${JSON.stringify(
        answerKey
    )}. You MUST return the final result as a strict, valid JSON object containing studentName, totalScore, maxScore, and a results array.`;

    const parts: any[] = [
        {
            inlineData: {
                data: cleanBase64,
                mimeType,
            },
        },
        { text: systemInstruction },
    ];

    let result: any = null;
    let lastError: any = null;

    for (const modelName of candidateModels) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1,
                },
            });

            result = await model.generateContent(parts);
            if (result) break;
        } catch (apiErr: any) {
            lastError = apiErr;
            const errMsg = apiErr?.message || "";
            const is429 = errMsg.includes("429") || errMsg.includes("quota");
            const is503 = errMsg.includes("503");
            console.warn(`[Grading] Model ${modelName} failed (${is429 ? "Quota 429" : is503 ? "Busy 503" : "Error"}). Trying next model...`);
            continue;
        }
    }

    if (!result) {
        throw lastError || new Error("No response received from AI grader.");
    }

    const rawText = result.response.text().trim();

    // Clean any markdown code blocks if present (e.g. ```json ... ```)
    const cleanJson = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const parsed: GradingResponse = JSON.parse(cleanJson);

    if (typeof parsed.totalScore !== "number" || !Array.isArray(parsed.results)) {
        throw new Error("Invalid response schema received from Gemini.");
    }

    return parsed;
}
