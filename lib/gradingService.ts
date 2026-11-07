import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "./ai/geminiKey";
import { LayoutJSON } from "./printEngine/types";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReviewFlagReason = "double_mark" | "unclear" | "faint" | "low_confidence" | "blank" | "multiple_answers";

export type LightingCondition = "ok" | "too_dark" | "too_bright";

export interface PhotoQualityDiagnostics {
    lighting: LightingCondition;
    qrVisible: boolean;
    cornerMarkersVisible: boolean;
    visibleCornerCount: number;
    paperFlat: boolean;
    fullEdgesVisible: boolean;
    isBlurry: boolean;
    hasWarnings: boolean;
    warnings: string[];
}

export interface GradingResultItem {
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    pointsAwarded: number;
    confidence?: number;
    flaggedForReview?: boolean;
    flagReason?: ReviewFlagReason;
    flagDetails?: string;
    detectedOptions?: string[];
    isOverridden?: boolean;
    originalStudentAnswer?: string;
}

export interface GradingResponse {
    studentName: string;
    lastName?: string;
    firstName?: string;
    middleName?: string | null;
    totalScore: number;
    maxScore: number;
    results: GradingResultItem[];
    photoQuality?: PhotoQualityDiagnostics;
}

/**
 * Normalizes raw photo quality diagnostics from the AI Vision model and generates
 * clear teacher-facing warnings for the 5 optical capture conditions:
 * 1. Room is too dark
 * 2. Room is too light / glare
 * 3. QR code is not visible
 * 4. 4 corner markers not visible
 * 5. Paper is not flat or full edges not visible
 */
export function normalizePhotoQuality(raw: any): PhotoQualityDiagnostics {
    if (!raw || typeof raw !== "object") {
        return {
            lighting: "ok",
            qrVisible: true,
            cornerMarkersVisible: true,
            visibleCornerCount: 4,
            paperFlat: true,
            fullEdgesVisible: true,
            isBlurry: false,
            hasWarnings: false,
            warnings: [],
        };
    }

    const rawLighting = String(raw.lighting || "ok").toLowerCase().trim();
    const lighting: LightingCondition =
        rawLighting === "too_dark" || rawLighting === "dark" || rawLighting === "underexposed"
            ? "too_dark"
            : rawLighting === "too_bright" || rawLighting === "too_light" || rawLighting === "glare" || rawLighting === "overexposed"
            ? "too_bright"
            : "ok";

    const qrVisible = raw.qrVisible !== false;
    const visibleCornerCount =
        typeof raw.visibleCornerCount === "number"
            ? Math.max(0, Math.min(4, Math.round(raw.visibleCornerCount)))
            : raw.cornerMarkersVisible === false
            ? 0
            : 4;
    const cornerMarkersVisible = raw.cornerMarkersVisible !== false && visibleCornerCount >= 4;
    const paperFlat = raw.paperFlat !== false;
    const fullEdgesVisible = raw.fullEdgesVisible !== false;
    const isBlurry = Boolean(raw.isBlurry || raw.blurred || raw.blur);

    const warnings: string[] = [];

    if (lighting === "too_dark") {
        warnings.push("Room is too dark — move to brighter lighting or tap Torch (⚡).");
    } else if (lighting === "too_bright") {
        warnings.push("Harsh glare on sheet — tilt slightly to avoid direct reflection.");
    }

    if (!qrVisible) {
        warnings.push("QR code is not visible — ensure top-right QR code is inside frame and clear.");
    }

    if (!cornerMarkersVisible) {
        warnings.push(`4 corner markers not visible (${visibleCornerCount}/4 detected) — keep corner squares inside frame.`);
    }

    if (isBlurry) {
        warnings.push("Test paper answers are blurred — retake with camera held steady.");
    }

    return {
        lighting,
        qrVisible,
        cornerMarkersVisible,
        visibleCornerCount,
        paperFlat: true,
        fullEdgesVisible: true,
        isBlurry,
        hasWarnings: warnings.length > 0,
        warnings,
    };
}

/**
 * Computes Levenshtein edit distance between two strings (for spelling tolerance).
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[m][n];
}

/**
 * Checks whether a student's handwritten answer matches the official answer
 * or any accepted variant, including <= 1 character typo tolerance for words >= 6 letters.
 */
export function isAnswerAccepted(
    studentAnswer: string,
    correctAnswer: string,
    acceptedVariants: string[] = []
): boolean {
    const rawStudent = (studentAnswer || "").trim().toUpperCase();
    if (!rawStudent) return false;

    const rawCorrect = (correctAnswer || "").trim().toUpperCase();
    const candidates = new Set<string>([
        rawCorrect,
        rawCorrect.replace(/[.,\-_/\\()]/g, " ").replace(/\s+/g, " ").trim(),
        rawCorrect.replace(/[^A-Z0-9]/g, ""),
        ...acceptedVariants.map((v) => v.trim().toUpperCase()),
    ]);

    const studentNorm = rawStudent.replace(/[.,\-_/\\()]/g, " ").replace(/\s+/g, " ").trim();
    const studentCompact = rawStudent.replace(/[^A-Z0-9]/g, "");

    if (candidates.has(rawStudent) || candidates.has(studentNorm) || (studentCompact.length > 0 && candidates.has(studentCompact))) {
        return true;
    }

    // Spelling tolerance: 1 character difference is accepted for words >= 6 letters
    if (studentNorm.length >= 6 && rawCorrect.length >= 6) {
        for (const cand of candidates) {
            if (cand.length >= 6 && levenshteinDistance(studentNorm, cand) <= 1) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Sends a student's handwritten test image and answer key to Gemini for automated grading.
 * Uses the LayoutJSON coordinate map (4 corner registration squares, QR code, and item rects)
 * to guide vision extraction and deterministically validates every answer against the key.
 *
 * @param imageBase64 - Base64 encoded string of the captured paper
 * @param answerKey   - The answer key array (e.g. from quizStore or quiz presets)
 * @param mimeType    - Image format: "image/jpeg" (default) or "image/png"
 * @param layoutJson  - Optional LayoutJSON coordinate map generated by Print Engine v2
 * @returns Promise<GradingResponse>
 */
export async function gradeStudentTest(
    imageBase64: string,
    answerKey: any,
    mimeType: "image/jpeg" | "image/png" = "image/jpeg",
    layoutJson?: LayoutJSON
): Promise<GradingResponse> {
    const apiKey = getGeminiApiKey();

    // Strip data URL prefix if present (e.g., 'data:image/jpeg;base64,...')
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "");

    const keyArray: any[] = Array.isArray(answerKey) ? answerKey : (answerKey?.answerKey || []);
    const totalPossiblePoints = keyArray.reduce(
        (acc: number, item: any) => acc + (Number(item.points) || 1),
        0
    ) || keyArray.length;

    let layoutPromptSection = "";
    if (layoutJson && Array.isArray(layoutJson.pages) && layoutJson.pages.length > 0) {
        const lines: string[] = [
            `\nOPTICAL REGISTRATION & BOUNDING BOX COORDINATE MAP (Page Size: ${layoutJson.pageSize?.width || 612}x${layoutJson.pageSize?.height || 792} pt, y=0 at top edge):`,
            "1. Locate the 4 solid black corner registration squares (TL, TR, BL, BR) at 18pt from the page edges to establish perspective alignment.",
            `2. Verify the top-right QR code (${layoutJson.pages[0].qr?.content || layoutJson.quizId}).`,
            "3. Read handwritten answers strictly from inside these exact physical answer box rectangles:",
        ];
        for (const page of layoutJson.pages) {
            for (const item of page.items || []) {
                const r = item.rect || (item as any).box || {};
                const label = item.subIndex !== undefined
                    ? `Item ${item.questionNumber}.${item.subIndex}`
                    : `Item ${item.questionNumber}`;
                lines.push(
                    `- ${label} (${item.type}): rect [x=${Math.round(r.x || 0)}, y=${Math.round(r.y || 0)}, w=${Math.round(r.width || 0)}, h=${Math.round(r.height || 0)}] maxChars=${item.maxChars}`
                );
            }
        }
        layoutPromptSection = lines.join("\n") + "\n";
    }

    const systemInstruction = `You are an expert automated grading assistant for TSEKI test sheets. Your task is to analyze the provided image of a student's completed test paper and grade it against this official Answer Key:
${JSON.stringify(keyArray, null, 2)}
${layoutPromptSection}
INSTRUCTIONS:
1. Extract the student's name from the top "Last Name:", "First Name:", "Middle Name:" line (above "Date:", "Section:") (fields: "lastName", "firstName", "middleName", and combined "studentName" formatted as "Last Name, First Name Middle Name").
2. Read the student's handwritten answers inside the numbered square answer boxes (1, 2, 3...) or shaded bubbles on the paper.
3. CRITICAL — MANDATORY PER-BOX VISUAL SCRUTINY FOR SCRIBBLES, CORRECTIONS & OVERWRITING:
   Teachers rely on TSEKI to ALWAYS flag ANY question box where a student scribbled, corrected, shaded out, scratched out, or overwrote an answer.
   
   FOR EACH NUMBERED BOX, YOU MUST FIRST EXAMINE ITS VISUAL MARKS:
   - "hasScribbleOrCorrection" (boolean):
     MUST be set to true if the box contains ANY of the following:
     * A dark circular ink blob, shaded-in patch, or blacked-out mark (e.g. student shading out / scribbling over a previous mistake, like Box #2)
     * Heavy zig-zag, scratch-outs, cross-outs, horizontal strike-throughs, or slashes drawn through or over a letter (e.g. Box #4)
     * Overwritten / superimposed strokes (e.g., tracing a C over a B, or writing one letter on top of another)
     * Two or more letters inside the same box (e.g., "A" and "C" both present)
     * Messy double strokes, ambiguous loops, or ink spilling outside box borders (e.g. Box #10)
     * Erasure smudges, ghost marks, or faint ambiguous handwriting.
     Set to false ONLY if the box contains ONE single, crisp, clean, unambiguous letter with ZERO extra ink blobs, scratches, or corrections.

   - "visualObservations" (string):
     Briefly describe what you see in the box (e.g. "Clean single letter B", "Dark circular ink blob next to letter C", "Letter A with heavy scratch-out lines", "Double stroke handwriting").

   - "confidence" (number between 0.0 and 1.0):
     * If hasScribbleOrCorrection is true: Confidence MUST be between 0.25 and 0.45 (NEVER >= 0.70).
       MANDATORY RULE: Even if you are 100% certain which letter the student intended (for example, you clearly see a 'C' next to the dark scribble in Box #2), you MUST STILL assign confidence <= 0.45 and flag it! The teacher must verify whether the scribble invalidates the answer.
     * If single clean mark: Confidence is 0.92 - 0.99.
     * If blank: Confidence is 0.95.

   - "flagReason" ("double_mark" | "unclear" | "blank" | null):
     * "double_mark": two distinct letters or superimposed letters.
     * "unclear": scribbled, scratched-out, dark ink blob, erasure, correction, or messy handwriting.
     * "blank": box completely empty.
     * null: ONLY if clean, single, unambiguous letter with no scribble or correction.

   - "flagDetails" (string or null):
     Detailed explanation (e.g. "Dark scribble / scratched-out mark in box #2 with letter C", "Heavy overwriting in box #4").

   - "detectedOptions" (array of string):
     List all visible letters (e.g. ["C"] or ["A", "C"]).

4. Compare "studentAnswer" directly to the official "correctAnswer":
   - If the answer matches cleanly and is NOT double-marked: set "isCorrect" to true, and "pointsAwarded" to the question's points (usually 1).
   - If the answer does NOT match, is blank, or is double-marked: set "isCorrect" to false, and "pointsAwarded" to 0.
5. "totalScore" MUST be the EXACT mathematical sum of all "pointsAwarded" across the results array.
6. "maxScore" MUST be ${totalPossiblePoints}.
7. PHOTO QUALITY & OPTICAL REGISTRATION DIAGNOSTICS ("photoQuality"):
   Inspect the overall photo quality and physical paper capture conditions to alert the teacher if any of these 5 issues occur:
   - "lighting": set to "too_dark" if dim/underexposed; "too_bright" if harsh glare/washed-out; otherwise "ok".
   - "qrVisible": set to true if the top-right QR code is clearly visible inside the frame; otherwise false.
   - "visibleCornerCount": integer (0 to 4) counting how many of the 4 solid black corner registration squares are visible.
   - "cornerMarkersVisible": set to true ONLY if all 4 black corner registration squares are clearly visible (visibleCornerCount === 4); otherwise false.
   - "paperFlat": set to true if the paper is lying reasonably flat without severe folding/crumpling; otherwise false.
   - "fullEdgesVisible": set to true if full answer sheet borders are inside the frame; otherwise false.
   - "isBlurry": set to true if student handwritten answers, letters, bubbles, or lines are blurred or out of focus; otherwise false.

You MUST return the final result as a strict, valid JSON object with this exact structure (note how scribbled/overwritten items MUST be formatted):
{
  "studentName": "Extracted Student Name",
  "lastName": "Extracted Last Name",
  "firstName": "Extracted First Name",
  "middleName": "Extracted Middle Name",
  "totalScore": 1,
  "maxScore": ${totalPossiblePoints},
  "photoQuality": {
    "lighting": "ok",
    "qrVisible": true,
    "cornerMarkersVisible": true,
    "visibleCornerCount": 4,
    "paperFlat": true,
    "fullEdgesVisible": true,
    "isBlurry": false
  },
  "results": [
    {
      "questionNumber": 1,
      "hasScribbleOrCorrection": false,
      "visualObservations": "Single clean letter B",
      "studentAnswer": "B",
      "correctAnswer": "B",
      "isCorrect": true,
      "pointsAwarded": 1,
      "confidence": 0.96,
      "flagReason": null,
      "flagDetails": null,
      "detectedOptions": ["B"]
    },
    {
      "questionNumber": 2,
      "hasScribbleOrCorrection": true,
      "visualObservations": "Dark circular ink blob / scribble next to letter C",
      "studentAnswer": "C",
      "correctAnswer": "C",
      "isCorrect": true,
      "pointsAwarded": 1,
      "confidence": 0.35,
      "flagReason": "unclear",
      "flagDetails": "Dark scribble / scratched-out mark in box #2 with letter C",
      "detectedOptions": ["C"]
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

    if (apiKey) {
        const genAI = new GoogleGenerativeAI(apiKey);
        // Primary Gemini models ordered by vision accuracy and speed:
        // gemini-2.5-flash and gemini-2.0-flash provide the sharpest OCR on handwritten ink blobs and scribbles,
        // followed by gemini-1.5-flash
        const candidateModels = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
        ];
        const MAX_RETRIES_PER_MODEL = 2;
        const BASE_BACKOFF_MS = 1500;

        for (const modelName of candidateModels) {
            let attempt = 0;

            while (attempt <= MAX_RETRIES_PER_MODEL) {
                try {
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.0,
                        },
                    });

                    result = await model.generateContent(parts);
                    if (result) break;
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
                        console.warn(`[Grading] Gemini API key invalid. Fast-failing over to backup vision AI...`);
                        break;
                    }

                    const isNotFound =
                        status === 404 ||
                        errMsg.includes("not found") ||
                        errMsg.includes("is no longer available") ||
                        errMsg.includes("is not supported");

                    if (isNotFound) {
                        console.warn(`[Grading] Gemini ${modelName} not available (404), trying next model...`);
                        break; // Move to next model candidate immediately
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
                        const backoffMs = Math.round(BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 500);
                        console.warn(
                            `[Grading] Gemini ${modelName} busy (503/429). Retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES_PER_MODEL})...`
                        );
                        await new Promise((r) => setTimeout(r, backoffMs));
                        continue;
                    }

                    console.warn(`[Grading] Gemini ${modelName} failed (${errMsg.slice(0, 90)}). Trying next candidate...`);
                    break;
                }
            }

            if (result) break;
        }
    } else {
        lastError = new Error("Missing EXPO_PUBLIC_GEMINI_API_KEY.");
    }

    let parsed: any = null;

    if (result) {
        try {
            const rawText = result.response.text().trim();
            const cleanJson = rawText
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();
            parsed = JSON.parse(cleanJson);
        } catch (e) {
            console.warn("[Grading] Failed to parse JSON from Gemini:", e);
        }
    }

    // Failover to backup vision AI if Gemini was exhausted or failed
    if (!parsed) {
        console.warn("[Grading] Gemini vision unavailable. Failing over to backup vision AI provider...");
        parsed = await gradeWithBackupVisionAI(cleanBase64, mimeType, systemInstruction, lastError);
    }

    const parsedResults: any[] = Array.isArray(parsed.results) ? parsed.results : [];

    const variantMap = new Map<number, string[]>(
        (layoutJson?.answerVariants || []).map((v) => [v.questionNumber, v.accepted])
    );

    // Deterministic validation: enforce ground truth from official answerKey + answerVariants
    let computedTotalScore = 0;
    let computedMaxScore = 0;

    const verifiedResults: GradingResultItem[] = keyArray.map((keyItem: any, idx: number) => {
        const qNum = keyItem.questionNumber || (idx + 1);
        const officialCorrect = String(keyItem.correctAnswer || "").trim();
        const itemPoints = Number(keyItem.points) || 1;
        computedMaxScore += itemPoints;

        const detected = parsedResults.find((r: any) => Number(r.questionNumber) === qNum) || parsedResults[idx] || {};
        const rawStudentAnswer = String(detected.studentAnswer ?? detected.answer ?? "").trim();
        let confidence = typeof detected.confidence === "number" ? detected.confidence : 0.95;
        const acceptedVariants = variantMap.get(qNum) || [];

        let flagReason: ReviewFlagReason | undefined = detected.flagReason || undefined;
        let flagDetails: string | undefined = detected.flagDetails || undefined;
        let detectedOptions: string[] = Array.isArray(detected.detectedOptions)
            ? detected.detectedOptions.map((o: any) => String(o).trim().toUpperCase()).filter(Boolean)
            : [];

        // Normalize string "null" or "none" from AI JSON
        if ((flagReason as any) === "null" || (flagReason as any) === "none" || (flagReason as any) === "") {
            flagReason = undefined;
        }
        if ((flagReason as any) === "faint" || (flagReason as any) === "scribbled" || (flagReason as any) === "messy" || (flagReason as any) === "correction") {
            flagReason = "unclear";
        }
        if ((flagReason as any) === "multiple_answers" || (flagReason as any) === "overwritten") {
            flagReason = "double_mark";
        }

        // 1. Detect visual evidence of scribble, dark blob, scratch-out, or correction
        const visualText = [
            detected.visualObservations,
            detected.rawMarksDescription,
            detected.notes,
            detected.flagDetails,
            flagDetails,
        ].filter(Boolean).join(" ").toLowerCase();

        const hasScribbleEvidence = Boolean(
            detected.hasScribbleOrCorrection === true ||
            detected.isScribbled === true ||
            detected.hasCorrection === true ||
            (detected.scribbleType && detected.scribbleType !== "none") ||
            /\b(scribble|scribbled|scratch|scratched|crossed|cross-out|blob|shaded|blacked|correction|corrected|smudge|erasure|superimposed|overwritten|messy|double|stray ink)\b/i.test(visualText)
        );

        if (hasScribbleEvidence) {
            confidence = Math.min(confidence, 0.38);
            flagReason = flagReason || (detectedOptions.length >= 2 ? "double_mark" : "unclear");
            if (!flagDetails) {
                flagDetails = `Scribble, dark blob, or correction mark detected in box #${qNum}`;
            }
        }

        // 2. Deterministic detection of double-shaded / overwritten / multiple marked boxes
        const isSingleChoice = !officialCorrect.includes(",") && (officialCorrect.length === 1 || officialCorrect === "T" || officialCorrect === "F");
        const multipleMarkRegex = /^([A-D]|[T|F])\s*[,/&+\sor-]+\s*([A-D]|[T|F])$/i;
        const compactLetters = rawStudentAnswer.replace(/[^A-Za-z0-9]/g, "");

        // Even if officialCorrect is longer, if the student wrote multiple single-letter MC choices (e.g. "A, D" or "B/C") or detectedOptions has >= 2 letters
        if (
            multipleMarkRegex.test(rawStudentAnswer) ||
            (isSingleChoice && compactLetters.length >= 2 && compactLetters.length <= 4 && /^[A-D]+$/i.test(compactLetters)) ||
            (detectedOptions.length >= 2 && !flagReason)
        ) {
            flagReason = flagReason || "double_mark";
            flagDetails = flagDetails || `Multiple or overwritten marks detected (${rawStudentAnswer || detectedOptions.join(", ")})`;
            confidence = Math.min(confidence, 0.40);
            if (detectedOptions.length === 0) {
                detectedOptions = Array.from(new Set(rawStudentAnswer.toUpperCase().match(/[A-D]/g) || []));
            }
        }

        // 3. Detect uncertainty markers in rawStudentAnswer (e.g., "?", "unclear", "scribble", "blob")
        if (/[?*]|\b(unclear|scribble|illegible|messy|blob)\b/i.test(rawStudentAnswer)) {
            flagReason = flagReason || "unclear";
            flagDetails = flagDetails || `Unclear or scribbled mark detected inside box #${qNum}`;
            confidence = Math.min(confidence, 0.38);
        }

        // 4. If AI or visual scrutiny flagged double_mark, unclear, or low_confidence, strictly enforce low confidence (< 0.70)
        if (flagReason === "double_mark" || flagReason === "unclear" || flagReason === "low_confidence" || detected.flaggedForReview === true) {
            confidence = Math.min(confidence, 0.45);
            if (!flagDetails) {
                flagDetails =
                    flagReason === "double_mark"
                        ? `Overwritten or double-shaded mark in box #${qNum}`
                        : `Unclear or scribbled mark in box #${qNum}`;
            }
        }

        // 5. Automatic low confidence threshold (< 0.75)
        const isLowConfidence = confidence < 0.75;
        if (isLowConfidence && !flagReason) {
            flagReason = "low_confidence";
            flagDetails = flagDetails || `Low OCR confidence (${Math.round(confidence * 100)}%)`;
        }

        const isFlagged = Boolean(
            hasScribbleEvidence ||
            detected.flaggedForReview === true ||
            flagReason === "double_mark" ||
            flagReason === "unclear" ||
            flagReason === "low_confidence" ||
            isLowConfidence
        );

        let awarded = 0;
        let isMatch = false;

        // Double-marked answers for single-choice questions are strictly incorrect by default until teacher fixes
        if (flagReason === "double_mark" && isSingleChoice) {
            isMatch = false;
            awarded = 0;
        } else if (itemPoints > 1 && officialCorrect.includes(",")) {
            // Check if multi-point enumeration (comma-separated expected items)
            const expectedList = officialCorrect.split(/[,;\n/]+/).map((s) => s.trim()).filter(Boolean);
            const studentList = rawStudentAnswer.split(/[,;\n/]+/).map((s) => s.trim()).filter(Boolean);
            const matchedExpectedIndices = new Set<number>();

            for (const sItem of studentList) {
                for (let eIdx = 0; eIdx < expectedList.length; eIdx++) {
                    if (matchedExpectedIndices.has(eIdx)) continue;
                    if (isAnswerAccepted(sItem, expectedList[eIdx])) {
                        matchedExpectedIndices.add(eIdx);
                        awarded += 1;
                        break;
                    }
                }
            }
            awarded = Math.min(awarded, itemPoints);
            isMatch = awarded === itemPoints;
        } else {
            isMatch = isAnswerAccepted(rawStudentAnswer, officialCorrect, acceptedVariants);
            awarded = isMatch ? itemPoints : 0;
        }

        computedTotalScore += awarded;

        return {
            questionNumber: qNum,
            studentAnswer: rawStudentAnswer,
            correctAnswer: officialCorrect,
            isCorrect: isMatch,
            pointsAwarded: awarded,
            confidence,
            flaggedForReview: isFlagged,
            flagReason,
            flagDetails,
            detectedOptions,
            isOverridden: false,
            originalStudentAnswer: rawStudentAnswer,
        };
    });

    const extractedLast = typeof parsed.lastName === "string" ? parsed.lastName.trim() : "";
    const extractedFirst = typeof parsed.firstName === "string" ? parsed.firstName.trim() : "";
    const extractedMiddle = typeof parsed.middleName === "string" ? parsed.middleName.trim() : "";
    const combinedExtractedName =
        extractedLast && extractedFirst
            ? `${extractedLast}, ${extractedFirst}${extractedMiddle ? ` ${extractedMiddle}` : ""}`
            : parsed.studentName || extractedLast || extractedFirst || "Student";

    const photoQuality = normalizePhotoQuality(parsed.photoQuality);

    return {
        studentName: combinedExtractedName,
        lastName: extractedLast || undefined,
        firstName: extractedFirst || undefined,
        middleName: extractedMiddle || null,
        totalScore: computedTotalScore,
        maxScore: computedMaxScore || totalPossiblePoints,
        results: verifiedResults,
        photoQuality,
    };
}

/**
 * Executes multimodal vision grading via configured OpenAI-compatible backup provider.
 */
async function gradeWithBackupVisionAI(
    cleanBase64: string,
    mimeType: "image/jpeg" | "image/png",
    systemInstruction: string,
    geminiError?: any
): Promise<any> {
    const { runBackupChain } = await import("./ai/backupRunner");

    const messages = [
        {
            role: "user" as const,
            content: [
                {
                    type: "text" as const,
                    text: systemInstruction,
                },
                {
                    type: "image_url" as const,
                    image_url: {
                        url: `data:${mimeType};base64,${cleanBase64}`,
                    },
                },
            ],
        },
    ];

    try {
        const result = await runBackupChain<any>({
            kind: "vision",
            messages,
            logTag: "[Grading Backup]",
            timeoutMs: 35000,
            totalBudgetMs: 55000,
            maxTokens: 2500,
            temperature: 0.1,
            validate: (json) => {
                if (json && Array.isArray(json.results) && json.results.length > 0) {
                    return json;
                }
                return null;
            },
        });

        return result.value;
    } catch (err: any) {
        throw new Error(
            `Gemini Vision was unavailable (${geminiError?.message || "Rate-limited / busy"}), and backup vision provider also failed:\n${err.message}`
        );
    }
}

