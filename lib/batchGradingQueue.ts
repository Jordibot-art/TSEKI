import {
    gradeStudentTest,
    GradingResponse,
    GradingResultItem,
    levenshteinDistance,
} from "./gradingService";
import { LayoutJSON } from "./printEngine/types";

// ── Types ─────────────────────────────────────────────────────────────────────
export type BatchSheetStatus =
    | "queued"
    | "optimizing"
    | "grading"
    | "ready"
    | "needs_review"
    | "error";

export interface StudentRosterItem {
    id: string;
    full_name: string;
    email: string | null;
    average?: number;
}

export interface BatchSheetItem {
    id: string;
    imageUri: string;
    status: BatchSheetStatus;
    studentNameExtracted?: string;
    matchedStudentId?: string;
    matchedStudentName?: string;
    isAutoMatched: boolean;
    gradingResult?: GradingResponse;
    flaggedCount: number;
    errorMessage?: string;
    isApproved: boolean;
    addedAt: number;
    completedAt?: number;
    retryCount: number;
}

export interface BatchQueueOptions {
    answerKey: any;
    layoutJson?: LayoutJSON;
    roster: StudentRosterItem[];
    onProgress?: (items: BatchSheetItem[]) => void;
    concurrency?: number;
}

// ── Smart Roster Fuzzy Matcher ────────────────────────────────────────────────
/**
 * Normalizes a student name by stripping punctuation, extra spaces, and casing.
 */
function normalizeName(str: string): string {
    return (str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Matches an extracted student name from the physical paper against the classroom roster.
 * Supports:
 * - Exact string match (ignoring case/whitespace)
 * - "Lastname, Firstname" vs "Firstname Lastname" inversion
 * - Partial token overlap (e.g. middle initials or dropped middle names)
 * - Levenshtein tolerance for minor spelling/OCR errors (edit distance <= 2 for words >= 5 chars)
 */
export function matchStudentToRoster(
    extractedName: string | undefined,
    roster: StudentRosterItem[]
): { student: StudentRosterItem; confidence: number } | null {
    if (!extractedName || !roster || roster.length === 0) return null;

    const normExtracted = normalizeName(extractedName);
    if (!normExtracted || normExtracted === "unknown" || normExtracted.length < 2) {
        return null;
    }

    const extractedTokens = normExtracted.split(" ").filter((t) => t.length > 1);

    let bestMatch: StudentRosterItem | null = null;
    let highestScore = 0;

    for (const student of roster) {
        const normRoster = normalizeName(student.full_name);
        if (!normRoster) continue;

        // 1. Direct exact match
        if (normExtracted === normRoster) {
            return { student, confidence: 1.0 };
        }

        // 2. Substring inclusion
        if (normRoster.includes(normExtracted) || normExtracted.includes(normRoster)) {
            const score = 0.92;
            if (score > highestScore) {
                highestScore = score;
                bestMatch = student;
            }
        }

        // 3. Token-based overlap (handles "Dela Cruz, Juan" vs "Juan Dela Cruz")
        const rosterTokens = normRoster.split(" ").filter((t) => t.length > 1);
        let sharedTokens = 0;
        for (const eToken of extractedTokens) {
            if (rosterTokens.some((rToken) => rToken === eToken || (eToken.length >= 4 && rToken.startsWith(eToken)))) {
                sharedTokens++;
            }
        }

        const maxTokens = Math.max(extractedTokens.length, rosterTokens.length);
        if (maxTokens > 0) {
            const tokenScore = (sharedTokens / maxTokens) * 0.9;
            if (tokenScore > highestScore && tokenScore >= 0.5) {
                highestScore = tokenScore;
                bestMatch = student;
            }
        }

        // 4. Overall Levenshtein distance
        const dist = levenshteinDistance(normExtracted, normRoster);
        const maxLen = Math.max(normExtracted.length, normRoster.length);
        if (maxLen > 0) {
            const levRatio = 1 - dist / maxLen;
            if (levRatio > highestScore && levRatio >= 0.72) {
                highestScore = levRatio;
                bestMatch = student;
            }
        }
    }

    if (bestMatch && highestScore >= 0.55) {
        return { student: bestMatch, confidence: highestScore };
    }

    return null;
}

// ── Batch Queue Manager Class ─────────────────────────────────────────────────
export class BatchGradingQueue {
    private items: BatchSheetItem[] = [];
    private activeWorkers = 0;
    // Sequential execution (concurrency = 1) prevents 429/503 rate-limit spikes on Gemini free/developer tier
    private concurrency = 1;
    private options: BatchQueueOptions;
    private isRunning = false;

    constructor(options: BatchQueueOptions) {
        this.options = options;
        this.concurrency = 1;
    }

    public updateOptions(newOptions: Partial<BatchQueueOptions>) {
        this.options = { ...this.options, ...newOptions };
        if (newOptions.concurrency) {
            this.concurrency = 1; // Enforce sequential processing for vision API
        }
    }

    public getItems(): BatchSheetItem[] {
        return [...this.items];
    }

    public enqueueImages(imageUris: string[]): BatchSheetItem[] {
        const newItems: BatchSheetItem[] = imageUris.map((uri) => ({
            id: `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            imageUri: uri,
            status: "queued",
            flaggedCount: 0,
            isApproved: false,
            isAutoMatched: false,
            addedAt: Date.now(),
            retryCount: 0,
        }));

        this.items.push(...newItems);
        this.notify();
        this.pump();
        return newItems;
    }

    public updateItem(id: string, updates: Partial<BatchSheetItem>) {
        const idx = this.items.findIndex((i) => i.id === id);
        if (idx !== -1) {
            this.items[idx] = { ...this.items[idx], ...updates };
            this.notify();
        }
    }

    public removeItem(id: string) {
        this.items = this.items.filter((i) => i.id !== id);
        this.notify();
    }

    public retryFailedItems() {
        for (const item of this.items) {
            if (item.status === "error") {
                item.status = "queued";
                item.errorMessage = undefined;
            }
        }
        this.notify();
        this.pump();
    }

    public approveAllReady() {
        for (const item of this.items) {
            if (item.status === "ready" || (item.status === "needs_review" && item.flaggedCount === 0 && item.matchedStudentId)) {
                item.isApproved = true;
            }
        }
        this.notify();
    }

    public clear() {
        this.items = [];
        this.notify();
    }

    private notify() {
        if (this.options.onProgress) {
            this.options.onProgress([...this.items]);
        }
    }

    private pump() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.spawnWorkers();
    }

    private spawnWorkers() {
        while (this.activeWorkers < this.concurrency) {
            const nextItem = this.items.find((i) => i.status === "queued");
            if (!nextItem) break;

            this.activeWorkers++;
            this.processItem(nextItem).finally(async () => {
                this.activeWorkers--;
                // Add an 800ms spacing between batch sheets so Gemini never gets hit back-to-back
                await new Promise((r) => setTimeout(r, 800));
                this.spawnWorkers();
                if (this.activeWorkers === 0) {
                    this.isRunning = false;
                }
            });
        }
    }

    private async processItem(item: BatchSheetItem) {
        try {
            // Stage 1: Optimize / Downscale Image
            this.updateItem(item.id, { status: "optimizing" });

            let base64 = "";
            let mimeType: "image/jpeg" = "image/jpeg";

            try {
                const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
                const manipulated = await manipulateAsync(
                    item.imageUri,
                    [{ resize: { width: 1280 } }],
                    { compress: 0.72, format: SaveFormat.JPEG, base64: true }
                );
                base64 = manipulated.base64 || "";
            } catch (optErr) {
                console.warn("[BatchQueue] Image optimization failed, attempting raw:", optErr);
            }

            if (!base64) {
                throw new Error("Failed to read image data from capture.");
            }

            // Stage 2: Gemini Vision Grading
            this.updateItem(item.id, { status: "grading" });

            const gradingResult = await gradeStudentTest(
                base64,
                this.options.answerKey,
                mimeType,
                this.options.layoutJson
            );

            // Stage 3: Post-Grading Analysis & Roster Matching
            const flaggedItems = (gradingResult.results || []).filter(
                (r: GradingResultItem) =>
                    r.flaggedForReview ||
                    (r.confidence !== undefined && r.confidence < 0.75) ||
                    r.flagReason === "double_mark" ||
                    r.flagReason === "unclear"
            );

            const flaggedCount = flaggedItems.length;

            // Roster Matching
            const match = matchStudentToRoster(gradingResult.studentName, this.options.roster);

            const hasMatched = Boolean(match);
            const needsReview = flaggedCount > 0 || !hasMatched;

            this.updateItem(item.id, {
                status: needsReview ? "needs_review" : "ready",
                gradingResult,
                studentNameExtracted: gradingResult.studentName || "Unknown",
                matchedStudentId: match?.student.id,
                matchedStudentName: match?.student.full_name,
                isAutoMatched: hasMatched,
                flaggedCount,
                completedAt: Date.now(),
                isApproved: !needsReview,
            });
        } catch (error: any) {
            console.error(`[BatchQueue] Error processing item ${item.id}:`, error);

            // Auto-retry once for transient 429 rate limit or network glitch
            if (item.retryCount < 1) {
                item.retryCount++;
                item.status = "queued";
                // Exponential backoff wait (1.5s)
                await new Promise((r) => setTimeout(r, 1500));
                this.notify();
            } else {
                this.updateItem(item.id, {
                    status: "error",
                    errorMessage: error.message || "Grading analysis failed.",
                });
            }
        }
    }
}
