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
 * Strictly verifies each answer against the official key so the score banner and question
 * breakdown are always 100% mathematically consistent.
 *
 * @param imageBase64 - Base64 encoded string of the captured paper
 * @param answerKey   - The answer key array (e.g. from quizStore or quiz presets)
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

    const keyArray: any[] = Array.isArray(answerKey) ? answerKey : (answerKey?.answerKey || []);
    const totalPossiblePoints = keyArray.reduce(
        (acc: number, item: any) => acc + (Number(item.points) || 1),
        0
    ) || keyArray.length;

    const systemInstruction = `You are an expert automated grading assistant. Your task is to analyze the provided image of a student's completed test paper and grade it against this official Answer Key:
${JSON.stringify(keyArray, null, 2)}

INSTRUCTIONS:
1. Extract the student's name from the top "Name:" line (field: "studentName").
2. Read the student's handwritten answers located inside the black answer boxes on the paper.
3. For each question number in the Answer Key, extract the exact student's handwritten answer (field: "studentAnswer").
4. Compare "studentAnswer" directly to the official "correctAnswer":
   - If the answer matches: set "isCorrect" to true, and "pointsAwarded" to the question's points (usually 1).
   - If the answer does NOT match or the box is blank: set "isCorrect" to false, and "pointsAwarded" to 0.
5. "totalScore" MUST be the EXACT mathematical sum of all "pointsAwarded" across the results array.
6. "maxScore" MUST be ${totalPossiblePoints}.

You MUST return the final result as a strict, valid JSON object with this exact structure:
{
  "studentName": "Extracted Student Name",
  "totalScore": 0,
  "maxScore": ${totalPossiblePoints},
  "results": [
    {
      "questionNumber": 1,
      "studentAnswer": "C",
      "correctAnswer": "C",
      "isCorrect": true,
      "pointsAwarded": 1
    }
  ]
}`;

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

    const parsed = JSON.parse(cleanJson);
    const parsedResults: any[] = Array.isArray(parsed.results) ? parsed.results : [];

    // Deterministic validation: enforce ground truth from official answerKey
    let computedTotalScore = 0;
    let computedMaxScore = 0;

    const verifiedResults: GradingResultItem[] = keyArray.map((keyItem: any, idx: number) => {
        const qNum = keyItem.questionNumber || (idx + 1);
        const officialCorrect = String(keyItem.correctAnswer || "").trim().toUpperCase();
        const itemPoints = Number(keyItem.points) || 1;
        computedMaxScore += itemPoints;

        // Find corresponding detected item by question number or index
        const detected = parsedResults.find((r: any) => Number(r.questionNumber) === qNum) || parsedResults[idx] || {};
        const rawStudentAnswer = String(detected.studentAnswer ?? detected.answer ?? "").trim();
        const studentClean = rawStudentAnswer.toUpperCase().replace(/[^A-Z0-9]/gi, "");
        const correctClean = officialCorrect.replace(/[^A-Z0-9]/gi, "");

        // Determine correctness:
        // 1. Direct character match (e.g. "C" === "C")
        // 2. Text match (case-insensitive)
        // 3. Fallback to detected.isCorrect if answer was marked correct
        const isMatch = Boolean(
            (studentClean.length > 0 && studentClean === correctClean) ||
            (rawStudentAnswer.length > 0 && rawStudentAnswer.toLowerCase() === officialCorrect.toLowerCase()) ||
            (detected.isCorrect === true && studentClean === correctClean)
        );

        const awarded = isMatch ? itemPoints : 0;
        computedTotalScore += awarded;

        return {
            questionNumber: qNum,
            studentAnswer: rawStudentAnswer,
            correctAnswer: keyItem.correctAnswer || officialCorrect,
            isCorrect: isMatch,
            pointsAwarded: awarded,
        };
    });

    return {
        studentName: parsed.studentName || "Student",
        totalScore: computedTotalScore,
        maxScore: computedMaxScore || totalPossiblePoints,
        results: verifiedResults,
    };
}
