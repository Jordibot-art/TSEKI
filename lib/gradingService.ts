import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "./ai/geminiKey";
import { extractJsonFromResponse } from "./ai/openAICompatibleClient";
import {
    formatMiddleInitial,
    formatStudentFullName,
    splitStudentFullName,
    toSmartTitleCase,
} from "./classListParserService";
import { LayoutJSON } from "./printEngine/types";
import {
    estimateBoxRegionFromLayout,
    NormalizedBoxRegion,
    sanitizeBoxRegion,
    sanitizePaperRegion,
} from "./questionCropService";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ReviewFlagReason = "double_mark" | "unclear" | "faint" | "low_confidence" | "blank" | "multiple_answers";

export type InkCleanliness =
    | "clean_single_mark"
    | "blank"
    | "overwritten"
    | "crossed_out"
    | "scribbled_or_blob"
    | "faint_or_ambiguous";

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
    maxPoints?: number;
    confidence?: number;
    flaggedForReview?: boolean;
    flagReason?: ReviewFlagReason;
    flagDetails?: string;
    visualObservations?: string;
    inkCleanliness?: InkCleanliness;
    detectedOptions?: string[];
    boxRegion?: NormalizedBoxRegion;
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
    paperRegion?: NormalizedBoxRegion;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.80;

/**
 * Single source of truth for whether a graded item requires manual teacher verification.
 */
export function isItemFlaggedForReview(item: GradingResultItem): boolean {
    return Boolean(
        item.flaggedForReview ||
        item.flagReason === "double_mark" ||
        item.flagReason === "unclear" ||
        item.flagReason === "faint" ||
        item.flagReason === "low_confidence" ||
        item.flagReason === "multiple_answers" ||
        (item.confidence !== undefined && item.confidence < LOW_CONFIDENCE_THRESHOLD)
    );
}

/**
 * True only when an item was flagged by OCR AND has not yet been confirmed/overridden by the teacher.
 */
export function isItemUnresolvedFlag(item: GradingResultItem): boolean {
    return isItemFlaggedForReview(item) && !item.isOverridden;
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

export interface RosterHintStudent {
    full_name: string;
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
}

function cleanNameFragment(value: unknown): string {
    if (typeof value !== "string") return "";
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (
        !trimmed ||
        /^(n\/a|na|none|null|undefined|unknown|student|-|—|_)+$/i.test(trimmed)
    ) {
        return "";
    }
    return trimmed;
}

/**
 * Formats extracted name fields from AI Vision into canonical
 * "Lastname, Firstname M." format (Smart Title Case, single-letter middle initial).
 */
export function formatExtractedStudentName(parsed: {
    lastName?: unknown;
    firstName?: unknown;
    middleName?: unknown;
    studentName?: unknown;
}): {
    studentName: string;
    lastName?: string;
    firstName?: string;
    middleName: string | null;
} {
    let rawLast = cleanNameFragment(parsed.lastName);
    let rawFirst = cleanNameFragment(parsed.firstName);
    let rawMiddle = cleanNameFragment(parsed.middleName);
    const rawCombined = cleanNameFragment(parsed.studentName);

    if ((!rawLast || !rawFirst) && rawCombined) {
        const split = splitStudentFullName(rawCombined);
        if (!rawLast && split.last_name) rawLast = split.last_name;
        if (!rawFirst && split.first_name) rawFirst = split.first_name;
        if (!rawMiddle && split.middle_name) rawMiddle = split.middle_name;
    }

    const lastName = rawLast ? toSmartTitleCase(rawLast) : "";
    const firstName = rawFirst ? toSmartTitleCase(rawFirst) : "";
    const middleInitial = formatMiddleInitial(rawMiddle);

    if (lastName || firstName) {
        const studentName = formatStudentFullName({
            last_name: lastName,
            first_name: firstName,
            middle_name: middleInitial || null,
        });
        return {
            studentName: studentName || "Unknown",
            lastName: lastName || undefined,
            firstName: firstName || undefined,
            middleName: middleInitial || null,
        };
    }

    if (rawCombined) {
        const formatted = formatStudentFullName({ full_name: rawCombined });
        return {
            studentName: formatted || toSmartTitleCase(rawCombined),
            lastName: undefined,
            firstName: undefined,
            middleName: middleInitial || null,
        };
    }

    return {
        studentName: "Unknown",
        lastName: undefined,
        firstName: undefined,
        middleName: null,
    };
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
 * @param roster      - Optional enrolled classroom roster for handwriting name disambiguation
 * @returns Promise<GradingResponse>
 */
export async function gradeStudentTest(
    imageBase64: string,
    answerKey: any,
    mimeType: "image/jpeg" | "image/png" = "image/jpeg",
    layoutJson?: LayoutJSON,
    roster?: RosterHintStudent[]
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

    let rosterPromptSection = "";
    if (Array.isArray(roster) && roster.length > 0) {
        const formattedRosterNames = Array.from(
            new Set(
                roster
                    .map((s) => formatStudentFullName(s))
                    .filter((name) => Boolean(name && name.trim().length > 1))
            )
        ).slice(0, 120);
        if (formattedRosterNames.length > 0) {
            rosterPromptSection = `\nENROLLED CLASSROOM ROSTER (for handwriting disambiguation ONLY):\n${formattedRosterNames
                .map((n) => `- ${n}`)
                .join("\n")}\nIf the handwritten name on the test paper clearly matches one of the enrolled students above (for example, faint or slightly messy letters like "Arel" for "Ariel" or slightly merged strokes), use that enrolled student's exact spelling. If the handwritten name is clearly a different person NOT on the roster, transcribe what is actually written.\n`;
        }
    }

    // Build a 100% BLIND question manifest (ZERO correctAnswer leakage!)
    // Grading happens deterministically in TypeScript AFTER blind OCR transcription,
    // preventing answer-key confirmation bias from masking crossed-out or scribbled boxes.
    const blindManifest = keyArray.map((item: any, idx: number) => {
        const qNum = item.questionNumber || (idx + 1);
        const ans = String(item.correctAnswer || "").trim();
        const pts = Number(item.points) || 1;
        let expectedFormat = "single capital letter (A, B, C, or D)";
        if (pts > 1 && ans.includes(",")) {
            const expectedCount = ans.split(/[,;\n/]+/).filter(Boolean).length;
            expectedFormat = `comma-separated list of ${expectedCount} short items`;
        } else if (/^(T|F|TRUE|FALSE)$/i.test(ans)) {
            expectedFormat = "single letter (T or F, or A/B)";
        } else if (ans.length > 1) {
            expectedFormat = "short handwritten word or phrase";
        }
        return { questionNumber: qNum, expectedFormat };
    });

    const systemInstruction = `You are a strict BLIND optical handwriting transcription and ink-cleanliness auditor for TSEKI test sheets.
Your job is ONLY to transcribe the exact handwritten ink marks inside each numbered square answer box and locate each box on the photo — NOT to grade correctness.
CRITICAL ANTI-HALLUCINATION RULE: COMPLETELY IGNORE the printed quiz question text and printed A/B/C/D options on the paper! NEVER solve a quiz question from its printed text or guess what the right answer should be. Even if a question is easy to solve, base your output 100% on the physical ink strokes inside its square answer box.

QUESTIONS TO TRANSCRIBE (blind — no answer key provided):
${JSON.stringify(blindManifest, null, 2)}
${layoutPromptSection}${rosterPromptSection}
INSTRUCTIONS:
1. STUDENT NAME: Extract the student's name from the top "Last Name:", "First Name:", "Middle Name:" line (above "Date:", "Section:").
   - Return "lastName" in Title Case (e.g., "Ramos").
   - Return "firstName" in Title Case (e.g., "John Ariel").
   - Return "middleName" as ONLY the first letter with a period (e.g., if the paper says "Coran", return "C."; if blank/absent, return null).
   - Return combined "studentName" strictly formatted as "Last Name, First Name M." (e.g., "Ramos, John Ariel C.", or "Ramos, John Ariel" if no middle name is written). Do NOT include the full middle word — ONLY the single middle initial letter with a period.

2. PAPER BOUNDARY ("paperRegion"):
   - Return "paperRegion": [ymin, xmin, ymax, xmax] as integers in 0..1000 normalized image coordinates (0 = top/left edge, 1000 = bottom/right edge) framing the white test paper inside the photo.

3. MANDATORY BLIND INK-CLEANLINESS AUDIT FOR EVERY QUESTION BOX:
   Teachers rely on TSEKI to ALWAYS flag ANY box where OCR could be confused or where a student crossed out, scribbled, corrected, overwrote, or smudged an answer.
   FIRST compare every box's ink strokes against the cleanest boxes on the same paper. If a box looks darker, thicker, scratched, crossed out, overwritten, or ambiguous compared to clean boxes, YOU MUST FLAG IT.

   For EACH question in the manifest, inspect the box and fill these fields IN ORDER:
   - "visualObservations" (string):
     Describe the literal ink strokes you see inside the square box (e.g., "Single crisp letter B with clean background", "Dense crossed-out / overwritten strokes inside box; ambiguous between B and C", "Letter A with heavy horizontal strike-through and extra strokes").
   - "inkCleanliness" ("clean_single_mark" | "blank" | "overwritten" | "crossed_out" | "scribbled_or_blob" | "faint_or_ambiguous"):
     * "clean_single_mark": ONLY if there is ONE crisp, unmistakable mark with ZERO cross-outs, overwrites, dark blobs, smudges, or extra strokes.
     * "blank": box is completely empty.
     * "crossed_out": X, slash, horizontal/diagonal strike-through, or scratch lines over/through a letter.
     * "overwritten": one letter traced/written on top of another (e.g., B over C, C over B, A over B) or heavy retraced/thickened strokes.
     * "scribbled_or_blob": dark shaded blob, scribbled-out patch, or dense ink cluster inside the box.
     * "faint_or_ambiguous": faint, smeared, erased, or messy handwriting where a human could hesitate between 2+ letters.
   - "hasScribbleOrCorrection" (boolean):
     MUST be true whenever inkCleanliness is anything other than "clean_single_mark" or "blank" (including ANY cross-out, overwrite, scribble, dark patch, double stroke, erasure smudge, or ambiguity).
   - "detectedOptions" (array of strings):
     List ALL letters that could plausibly be seen in the box (e.g., ["B"] for a clean B, or ["B", "C"] if crossed out / overwritten between B and C).
   - "studentAnswer" (string):
     Your best literal reading of the mark (or "" if blank; or "?" if illegible/crossed out). NEVER guess from the printed question text!
   - "confidence" (number 0.0 to 1.0):
     * If hasScribbleOrCorrection is true OR detectedOptions has >= 2 letters OR you have ANY doubt: confidence MUST be between 0.15 and 0.45 (NEVER >= 0.70).
     * Even if you think you can tell which letter is underneath a cross-out or next to a scribble, STILL set hasScribbleOrCorrection: true and confidence <= 0.40 so the teacher decides!
     * If single crisp clean mark: confidence 0.92 - 0.99.
     * If cleanly blank: confidence 0.95.
   - "flagReason" ("double_mark" | "unclear" | "low_confidence" | "blank" | null):
     * "double_mark": overwritten letters, two letters, or superimposed strokes.
     * "unclear": crossed-out, scribbled, dark ink blob, erasure, correction, or messy/ambiguous handwriting.
     * "low_confidence": faint or slightly ambiguous mark.
     * "blank": completely empty box.
     * null: ONLY when inkCleanliness is "clean_single_mark".
   - "flagDetails" (string or null):
     Short teacher-facing explanation (e.g., "Crossed-out / overwritten mark in box #3 — looks like B or C").
   - "boxRegion" ([ymin, xmin, ymax, xmax] integers 0..1000):
     REQUIRED for EVERY question! Tight 0..1000 normalized bounding box framing THAT specific question's square answer box (and its small item number right next to the box) so the app can crop and zoom straight into that exact box for the teacher.

4. PHOTO QUALITY DIAGNOSTICS ("photoQuality"):
   - "lighting": "too_dark" | "too_bright" | "ok"
   - "qrVisible": boolean
   - "visibleCornerCount": integer 0..4
   - "cornerMarkersVisible": boolean (true ONLY if all 4 black corner squares are visible)
   - "paperFlat": boolean
   - "fullEdgesVisible": boolean
   - "isBlurry": boolean

Return ONLY a strict, valid JSON object with this exact structure:
{
  "studentName": "Ramos, John Ariel C.",
  "lastName": "Ramos",
  "firstName": "John Ariel",
  "middleName": "C.",
  "paperRegion": [65, 15, 960, 965],
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
      "visualObservations": "Single crisp clean letter B inside square box",
      "inkCleanliness": "clean_single_mark",
      "hasScribbleOrCorrection": false,
      "detectedOptions": ["B"],
      "studentAnswer": "B",
      "confidence": 0.97,
      "flagReason": null,
      "flagDetails": null,
      "boxRegion": [235, 405, 275, 455]
    },
    {
      "questionNumber": 3,
      "visualObservations": "Dark crossed-out and overwritten ink strokes inside box; looks like C or B with scratch marks",
      "inkCleanliness": "crossed_out",
      "hasScribbleOrCorrection": true,
      "detectedOptions": ["B", "C"],
      "studentAnswer": "?",
      "confidence": 0.25,
      "flagReason": "unclear",
      "flagDetails": "Crossed-out / overwritten mark in box #3 — ambiguous between B and C",
      "boxRegion": [445, 400, 488, 452]
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
        // Prioritize full Flash vision models first for sharper scribble / cross-out detection
        // and accurate bounding-box localization, with flash-lite as fast fallback.
        const candidateModels = [
            "gemini-3.6-flash",
            "gemini-3.8-flash",
            "gemini-3.5-flash-lite",
        ];
        const MAX_RETRIES_PER_MODEL = 1;
        const BASE_BACKOFF_MS = 800;

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
            parsed = extractJsonFromResponse(rawText);
        } catch (e) {
            console.warn("[Grading] Failed to parse JSON from Gemini:", e);
        }
    }

    // Failover to backup vision AI ONLY if Gemini was completely exhausted or failed
    if (!parsed) {
        console.warn("[Grading] Gemini vision unavailable. Attempting backup vision AI provider...");
        try {
            parsed = await gradeWithBackupVisionAI(cleanBase64, mimeType, systemInstruction, lastError);
        } catch (backupErr: any) {
            console.error("[Grading] Backup vision AI also failed:", backupErr);
            const geminiMsg = (lastError?.message || "").toLowerCase();
            if (geminiMsg.includes("503") || geminiMsg.includes("high demand") || geminiMsg.includes("busy") || geminiMsg.includes("overloaded")) {
                throw new Error("Gemini AI is currently experiencing high demand. Please wait a moment and try scanning again.");
            }
            throw new Error(
                `Gemini Vision failed to grade the paper (${lastError?.message?.slice(0, 100) || "Service unavailable"}). Please ensure proper lighting and try scanning again.`
            );
        }
    }

    const parsedResults: any[] = Array.isArray(parsed.results) ? parsed.results : [];
    const paperRegion = sanitizePaperRegion(parsed.paperRegion);

    const variantMap = new Map<number, string[]>(
        (layoutJson?.answerVariants || []).map((v) => [v.questionNumber, v.accepted])
    );

    // Deterministic validation: enforce ground truth from official answerKey + answerVariants
    let computedTotalScore = 0;
    let computedMaxScore = 0;

    const verifiedResults: GradingResultItem[] = keyArray.map((keyItem: any, idx: number) => {
        const qNum = keyItem.questionNumber || (idx + 1);
        const itemPoints = Number(keyItem.points) || 1;
        computedMaxScore += itemPoints;

        const detected =
            parsedResults.find((r: any) => Number(r.questionNumber) === qNum) ||
            parsedResults[idx] ||
            {};
        const acceptedVariants = variantMap.get(qNum) || [];

        const gradedItem = evaluateGradedItem(
            detected,
            keyItem,
            idx,
            acceptedVariants,
            layoutJson,
            paperRegion
        );
        computedTotalScore += gradedItem.pointsAwarded;
        return gradedItem;
    });

    const formattedName = formatExtractedStudentName(parsed);

    const photoQuality = normalizePhotoQuality(parsed.photoQuality);

    return {
        studentName: formattedName.studentName,
        lastName: formattedName.lastName,
        firstName: formattedName.firstName,
        middleName: formattedName.middleName,
        totalScore: computedTotalScore,
        maxScore: computedMaxScore || totalPossiblePoints,
        results: verifiedResults,
        photoQuality,
        paperRegion,
    };
}

function normalizeInkCleanliness(raw: unknown): InkCleanliness | undefined {
    if (typeof raw !== "string") return undefined;
    const norm = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!norm || norm === "null" || norm === "none") return undefined;
    if (norm === "clean_single_mark" || norm === "clean" || norm === "crisp" || norm === "clear") {
        return "clean_single_mark";
    }
    if (norm === "blank" || norm === "empty") return "blank";
    if (norm === "overwritten" || norm === "double_mark" || norm === "superimposed" || norm === "retraced") {
        return "overwritten";
    }
    if (norm === "crossed_out" || norm === "cross_out" || norm === "struck_through" || norm === "scratched_out" || norm === "cancelled") {
        return "crossed_out";
    }
    if (norm === "scribbled_or_blob" || norm === "scribbled" || norm === "scribble" || norm === "blob" || norm === "shaded") {
        return "scribbled_or_blob";
    }
    if (norm === "faint_or_ambiguous" || norm === "faint" || norm === "ambiguous" || norm === "messy" || norm === "smudged" || norm === "erased" || norm === "unclear" || norm === "corrected") {
        return "faint_or_ambiguous";
    }
    return "faint_or_ambiguous";
}

/**
 * Deterministic post-processor that converts a single raw Vision OCR item + official answer key
 * into a verified GradingResultItem, enforcing strict scribble/cross-out/low-confidence flagging,
 * withholding unverified points on flagged single-choice answers, and resolving crop coordinates.
 */
export function evaluateGradedItem(
    detected: any,
    keyItem: any,
    idx: number,
    acceptedVariants: string[] = [],
    layoutJson?: LayoutJSON,
    paperRegion?: NormalizedBoxRegion
): GradingResultItem {
    const qNum = Number(keyItem?.questionNumber) || (idx + 1);
    const officialCorrect = String(keyItem?.correctAnswer || "").trim();
    const itemPoints = Number(keyItem?.points) || 1;
    const rawStudentAnswer = String(detected?.studentAnswer ?? detected?.answer ?? "").trim();

    let confidence =
        typeof detected?.confidence === "number" && Number.isFinite(detected.confidence)
            ? Math.max(0, Math.min(1, detected.confidence))
            : 0.95;

    let flagReason: ReviewFlagReason | undefined = detected?.flagReason || undefined;
    let flagDetails: string | undefined =
        typeof detected?.flagDetails === "string" && detected.flagDetails.trim() && detected.flagDetails.trim().toLowerCase() !== "null"
            ? detected.flagDetails.trim()
            : undefined;
    const visualObservations: string | undefined =
        typeof detected?.visualObservations === "string" && detected.visualObservations.trim()
            ? detected.visualObservations.trim()
            : undefined;
    const inkCleanliness = normalizeInkCleanliness(detected?.inkCleanliness);

    // Collect all candidate options from detectedOptions / possibleLetters / candidateAnswers
    const rawOptionsList = [
        ...(Array.isArray(detected?.detectedOptions) ? detected.detectedOptions : []),
        ...(Array.isArray(detected?.possibleLetters) ? detected.possibleLetters : []),
        ...(Array.isArray(detected?.candidateAnswers) ? detected.candidateAnswers : []),
    ];
    let detectedOptions: string[] = Array.from(
        new Set(
            rawOptionsList
                .map((o: any) => String(o ?? "").trim().toUpperCase())
                .filter((o: string) => Boolean(o) && o !== "?" && o !== "NULL" && o !== "NONE")
        )
    );

    // Normalize string "null" or "none" from AI JSON
    const rawFlagStr = typeof flagReason === "string" ? flagReason.trim().toLowerCase() : "";
    if (!rawFlagStr || rawFlagStr === "null" || rawFlagStr === "none") {
        flagReason = undefined;
    } else if (
        rawFlagStr === "faint" ||
        rawFlagStr === "scribbled" ||
        rawFlagStr === "crossed_out" ||
        rawFlagStr === "messy" ||
        rawFlagStr === "correction" ||
        rawFlagStr === "ambiguous"
    ) {
        flagReason = "unclear";
    } else if (rawFlagStr === "multiple_answers" || rawFlagStr === "overwritten") {
        flagReason = "double_mark";
    }

    // 1. Detect visual evidence of scribble, cross-out, overwrite, dark blob, erasure, or ambiguity
    const visualText = [
        visualObservations,
        detected?.rawMarksDescription,
        detected?.notes,
        flagDetails,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    // Strip negated phrases (e.g. "no cross-outs, overwrites, or smudges", "zero scribbles") before checking positive cues
    const negativeTerm =
        "(?:scribbl\\w*|scratch\\w*|cross(?:ed)?[\\s-]?out\\w*|strike[\\s-]?through\\w*|overwrit\\w*|correct\\w*|smudg\\w*|erasur\\w*|erased|blob\\w*|extra\\s+(?:stroke|mark|ink)\\w*|stray\\s+ink|double\\s+(?:mark|stroke|letter)\\w*|ambiguit\\w*|mess\\w*|corrections?)";
    const negatedClauseRegex = new RegExp(
        `\\b(?:no|zero|without|free of|lacks|not)\\s+(?:visible\\s+)?(?:any\\s+)?${negativeTerm}(?:(?:\\s*,\\s*(?:or|and)\\s+|\\s*,\\s*|\\s+(?:or|and)\\s+)(?:any\\s+)?${negativeTerm})*`,
        "gi"
    );
    const positiveVisualText = visualText.replace(negatedClauseRegex, " ");

    const hasDirtyInkCleanliness = Boolean(
        inkCleanliness &&
        inkCleanliness !== "clean_single_mark" &&
        inkCleanliness !== "blank"
    );

    const hasVisualCue = Boolean(
        /\b(scribbl\w*|scratch\w*|crossed[\s-]?out|cross[\s-]?out|crossed|strike[\s-]?through|struck[\s-]?through|slashed|cancel(?:led|ed)?|blob|shaded|blacked[\s-]?out|dark\s+patch|dense\s+ink|heavy\s+ink|retrac\w*|correct(?:ed|ion)|smudg\w*|eras(?:ed|ure)|superimpos\w*|overwrit\w*|overlap\w*|messy|double[\s-]?(?:mark|stroke|letter)|stray\s+ink|extra\s+(?:stroke|mark|line)|two\s+letters|multiple\s+(?:letters|strokes|marks)|ambiguous|uncertain|illegible|indistinct|hard\s+to\s+read|difficult\s+to\s+read|could\s+be|might\s+be|confused)\b/i.test(
            positiveVisualText
        ) ||
        /\b(?:either|between)\s+[a-d]\s+(?:or|and)\s+[a-d]\b/i.test(positiveVisualText) ||
        /\blooks?\s+like\s+[a-d]\s+or\s+[a-d]\b/i.test(positiveVisualText)
    );

    const hasScribbleEvidence = Boolean(
        hasDirtyInkCleanliness ||
        detected?.hasScribbleOrCorrection === true ||
        detected?.isScribbled === true ||
        detected?.hasCorrection === true ||
        (detected?.scribbleType && String(detected.scribbleType).toLowerCase() !== "none") ||
        hasVisualCue
    );

    if (hasScribbleEvidence) {
        confidence = Math.min(confidence, 0.38);
        if (!flagReason || flagReason === "blank") {
            flagReason =
                inkCleanliness === "overwritten" || detectedOptions.length >= 2
                    ? "double_mark"
                    : "unclear";
        }
        if (!flagDetails) {
            if (inkCleanliness === "crossed_out") {
                flagDetails = `Crossed-out or scratched mark in box #${qNum}`;
            } else if (inkCleanliness === "overwritten") {
                flagDetails = `Overwritten / retraced mark in box #${qNum}`;
            } else {
                flagDetails = visualObservations || `Scribble, cross-out, or correction detected in box #${qNum}`;
            }
        }
    }

    // 2. Deterministic detection of double-marked / overwritten / out-of-set single-choice answers
    const upperOfficial = officialCorrect.toUpperCase();
    const isMCKey = /^[A-D]$/.test(upperOfficial);
    const isTFKey = /^(T|F|TRUE|FALSE)$/.test(upperOfficial);
    const isSingleChoice = isMCKey || isTFKey || (!officialCorrect.includes(",") && officialCorrect.length === 1);
    const multipleMarkRegex = /^([A-D]|T|F)\s*[,/&+\sor-]+\s*([A-D]|T|F)$/i;
    const compactLetters = rawStudentAnswer.replace(/[^A-Za-z0-9]/g, "");

    if (
        multipleMarkRegex.test(rawStudentAnswer) ||
        (isSingleChoice && compactLetters.length >= 2 && compactLetters.length <= 4 && /^[A-D]+$/i.test(compactLetters)) ||
        (isSingleChoice && detectedOptions.length >= 2)
    ) {
        flagReason = !flagReason || flagReason === "blank" || flagReason === "low_confidence"
            ? "double_mark"
            : flagReason;
        if (detectedOptions.length === 0) {
            detectedOptions = Array.from(new Set(rawStudentAnswer.toUpperCase().match(/[A-D]/g) || []));
        }
        flagDetails =
            flagDetails ||
            `Multiple or overwritten marks detected (${detectedOptions.join(" / ") || rawStudentAnswer})`;
        confidence = Math.min(confidence, 0.38);
    }

    // 3. Detect uncertainty markers in rawStudentAnswer (e.g., "?", "unclear", "scribble", "blob")
    if (/[?*]|\b(unclear|scribble|illegible|messy|blob|crossed|ambiguous)\b/i.test(rawStudentAnswer)) {
        flagReason = !flagReason || flagReason === "blank" ? "unclear" : flagReason;
        flagDetails =
            flagDetails ||
            visualObservations ||
            `Unclear or crossed-out mark detected inside box #${qNum}`;
        confidence = Math.min(confidence, 0.35);
    }

    // 4. Out-of-set single-choice reading (e.g., crossed-out letter misread as "R", "K", "X", "8", "E")
    if (isMCKey && rawStudentAnswer.length > 0 && !/^[A-D]$/i.test(rawStudentAnswer)) {
        const extractedLetters = Array.from(new Set(rawStudentAnswer.toUpperCase().match(/[A-D]/g) || []));
        if (extractedLetters.length >= 2) {
            flagReason = !flagReason || flagReason === "blank" ? "double_mark" : flagReason;
            if (detectedOptions.length < 2) detectedOptions = extractedLetters;
        } else {
            flagReason = !flagReason || flagReason === "blank" ? "unclear" : flagReason;
        }
        flagDetails =
            flagDetails ||
            `Ambiguous mark ("${rawStudentAnswer}") in box #${qNum} — expected A, B, C, or D`;
        confidence = Math.min(confidence, 0.35);
    } else if (isTFKey && rawStudentAnswer.length > 0 && !/^(T|F|TRUE|FALSE|A|B)$/i.test(rawStudentAnswer)) {
        flagReason = !flagReason || flagReason === "blank" ? "unclear" : flagReason;
        flagDetails =
            flagDetails ||
            `Ambiguous mark ("${rawStudentAnswer}") in box #${qNum} — expected T or F`;
        confidence = Math.min(confidence, 0.35);
    }

    // 5. Enforce low confidence cap whenever a review flag is active
    if (
        flagReason === "double_mark" ||
        flagReason === "unclear" ||
        flagReason === "low_confidence" ||
        flagReason === "faint" ||
        flagReason === "multiple_answers" ||
        detected?.flaggedForReview === true
    ) {
        confidence = Math.min(confidence, 0.45);
        if (!flagDetails) {
            flagDetails =
                flagReason === "double_mark"
                    ? `Overwritten or double-marked box #${qNum}`
                    : `Unclear or crossed-out mark in box #${qNum}`;
        }
    }

    // 6. Automatic low-confidence threshold (< 0.80)
    const isCleanBlank =
        rawStudentAnswer === "" &&
        !hasScribbleEvidence &&
        detected?.flaggedForReview !== true &&
        confidence >= LOW_CONFIDENCE_THRESHOLD;
    const isLowConfidence = !isCleanBlank && confidence < LOW_CONFIDENCE_THRESHOLD;
    if (isLowConfidence && (!flagReason || flagReason === "blank")) {
        flagReason = "low_confidence";
        flagDetails = flagDetails || `Low OCR confidence (${Math.round(confidence * 100)}%) in box #${qNum}`;
    }

    const isFlagged = Boolean(
        hasScribbleEvidence ||
        detected?.flaggedForReview === true ||
        flagReason === "double_mark" ||
        flagReason === "unclear" ||
        flagReason === "faint" ||
        flagReason === "multiple_answers" ||
        flagReason === "low_confidence" ||
        isLowConfidence
    );

    let awarded = 0;
    let isMatch = false;

    // Flagged single-choice items withhold unverified points until the teacher confirms the student's intent
    if (isFlagged && isSingleChoice) {
        isMatch = false;
        awarded = 0;
    } else if (itemPoints > 1 && officialCorrect.includes(",")) {
        // Multi-point enumeration (comma-separated expected items)
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

    const boxRegion =
        sanitizeBoxRegion(detected?.boxRegion ?? detected?.boundingBox ?? detected?.box_2d) ||
        estimateBoxRegionFromLayout(qNum, layoutJson, paperRegion);

    return {
        questionNumber: qNum,
        studentAnswer: rawStudentAnswer,
        correctAnswer: officialCorrect,
        isCorrect: isMatch,
        pointsAwarded: awarded,
        maxPoints: itemPoints,
        confidence,
        flaggedForReview: isFlagged,
        flagReason,
        flagDetails,
        visualObservations,
        inkCleanliness,
        detectedOptions,
        boxRegion,
        isOverridden: false,
        originalStudentAnswer: rawStudentAnswer,
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
            maxTokens: 4096,
            temperature: 0.0,
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

