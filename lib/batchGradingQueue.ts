import {
    formatMiddleInitial,
    formatStudentFullName,
    splitStudentFullName,
} from "./classListParserService";
import {
    gradeStudentTest,
    GradingResponse,
    isItemUnresolvedFlag,
    levenshteinDistance,
    PhotoQualityDiagnostics,
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
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
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
    photoQuality?: PhotoQualityDiagnostics;
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

function stringSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 0;
    return Math.max(0, 1 - levenshteinDistance(a, b) / maxLen);
}

interface ParsedMatchName {
    last: string;
    lastCompact: string;
    first: string;
    firstCompact: string;
    firstTokens: string[];
    midInit: string;
    canonical: string;
    allTokens: string[];
}

function parseNameForMatching(
    rawFullName?: string,
    parts?: { lastName?: string; firstName?: string; middleName?: string | null }
): ParsedMatchName {
    const hasExplicitParts = Boolean(parts?.lastName?.trim() || parts?.firstName?.trim());
    const fallbackSplit = splitStudentFullName(rawFullName || "");

    const rawLast = (hasExplicitParts && parts?.lastName?.trim()) ? parts.lastName.trim() : fallbackSplit.last_name;
    const rawFirst = (hasExplicitParts && parts?.firstName?.trim()) ? parts.firstName.trim() : fallbackSplit.first_name;
    const rawMiddle = (parts?.middleName !== undefined && parts?.middleName !== null && String(parts.middleName).trim())
        ? String(parts.middleName).trim()
        : (fallbackSplit.middle_name || "");

    const last = normalizeName(rawLast);
    const first = normalizeName(rawFirst);
    const midFormatted = formatMiddleInitial(rawMiddle);
    const midInit = midFormatted ? midFormatted[0].toLowerCase() : "";

    const formattedCanonical = formatStudentFullName({
        last_name: rawLast,
        first_name: rawFirst,
        middle_name: midFormatted || null,
        full_name: rawFullName,
    });
    const canonical = normalizeName(formattedCanonical || rawFullName || "");
    const firstTokens = first ? first.split(" ").filter(Boolean) : [];
    const allTokens = canonical.split(" ").filter((t) => t.length > 1);

    return {
        last,
        lastCompact: last.replace(/\s+/g, ""),
        first,
        firstCompact: first.replace(/\s+/g, ""),
        firstTokens,
        midInit,
        canonical,
        allTokens,
    };
}

function computeFirstNameSimilarity(
    eFirst: string,
    eCompact: string,
    eTokens: string[],
    rFirst: string,
    rCompact: string,
    rTokens: string[],
    lastSim: number,
    midConflict: boolean
): number {
    if (!eFirst || !rFirst) return 0;
    if (eFirst === rFirst || eCompact === rCompact) return 1.0;

    const wholeSim = Math.max(stringSimilarity(eFirst, rFirst), stringSimilarity(eCompact, rCompact));

    if (eTokens.length === 0 || rTokens.length === 0) return wholeSim;

    // Symmetric best-token matching
    const eBestSims = eTokens.map((et) =>
        Math.max(...rTokens.map((rt) => stringSimilarity(et, rt)))
    );
    const rBestSims = rTokens.map((rt) =>
        Math.max(...eTokens.map((et) => stringSimilarity(rt, et)))
    );

    if (eTokens.length === rTokens.length) {
        const minTokenSim = Math.min(...eBestSims, ...rBestSims);
        const avgTokenSim =
            (eBestSims.reduce((a, b) => a + b, 0) + rBestSims.reduce((a, b) => a + b, 0)) /
            (eBestSims.length + rBestSims.length);
        // Prevent false matches on multi-word first names where one given name is completely different
        // (e.g. "John Mark" vs "John Ariel" -> minTokenSim ~ 0.25 -> do not boost)
        if (minTokenSim >= 0.65) {
            return Math.max(wholeSim, avgTokenSim);
        }
        return wholeSim;
    }

    // Different number of first-name words (e.g. student wrote "John" instead of "John Ariel")
    const shorterSims = eTokens.length < rTokens.length ? eBestSims : rBestSims;
    const allShorterMatch = shorterSims.every((s) => s >= 0.8);
    if (allShorterMatch && lastSim >= 0.9 && !midConflict) {
        return Math.max(wholeSim, 0.8);
    }

    return wholeSim;
}

/**
 * Matches an extracted student name from the physical paper against the classroom roster.
 * Supports:
 * - Exact canonical "Last Name, First Name M." match
 * - Full middle name vs single-letter middle initial vs omitted middle name
 * - "Lastname, Firstname" vs "Firstname Lastname" or accidentally swapped Last/First fields
 * - Handwriting / OCR spelling tolerance (e.g. "Ramos, John Arel C." -> "Ramos, John Ariel C.")
 * - Sibling protection so two distinct students sharing a surname are not falsely merged
 */
export function matchStudentToRoster(
    extractedName: string | undefined,
    roster: StudentRosterItem[],
    extractedParts?: { lastName?: string; firstName?: string; middleName?: string | null }
): { student: StudentRosterItem; confidence: number } | null {
    if (!roster || roster.length === 0) return null;

    const normRaw = normalizeName(extractedName || "");
    const hasParts = Boolean(extractedParts?.lastName?.trim() || extractedParts?.firstName?.trim());
    if (!hasParts && (!normRaw || normRaw === "unknown" || normRaw === "student" || normRaw.length < 2)) {
        return null;
    }

    const extracted = parseNameForMatching(extractedName, extractedParts);
    if (!extracted.canonical || extracted.canonical === "unknown" || extracted.canonical === "student") {
        return null;
    }

    let bestMatch: StudentRosterItem | null = null;
    let highestScore = 0;
    let secondBestScore = 0;

    for (const student of roster) {
        const rosterParsed = parseNameForMatching(student.full_name, {
            lastName: student.last_name,
            firstName: student.first_name,
            middleName: student.middle_name,
        });
        if (!rosterParsed.canonical) continue;

        let score = 0;

        // 1. Direct canonical match ("ramos john ariel c" === "ramos john ariel c")
        if (extracted.canonical === rosterParsed.canonical) {
            return { student, confidence: 1.0 };
        }

        // 2. Structured Last + First + Middle Initial match
        if (extracted.last && extracted.first && rosterParsed.last && rosterParsed.first) {
            const lastSim = Math.max(
                stringSimilarity(extracted.last, rosterParsed.last),
                stringSimilarity(extracted.lastCompact, rosterParsed.lastCompact)
            );
            const midMatch = Boolean(extracted.midInit && rosterParsed.midInit && extracted.midInit === rosterParsed.midInit);
            const midConflict = Boolean(extracted.midInit && rosterParsed.midInit && extracted.midInit !== rosterParsed.midInit);

            const firstSim = computeFirstNameSimilarity(
                extracted.first,
                extracted.firstCompact,
                extracted.firstTokens,
                rosterParsed.first,
                rosterParsed.firstCompact,
                rosterParsed.firstTokens,
                lastSim,
                midConflict
            );

            if (lastSim === 1.0 && firstSim === 1.0) {
                score = midMatch ? 0.99 : midConflict ? 0.85 : 0.96;
            } else if (lastSim >= 0.75 && firstSim >= 0.72) {
                let midBonus = 0.03;
                if (midMatch) {
                    midBonus = 0.08;
                } else if (midConflict) {
                    midBonus = lastSim === 1.0 && firstSim >= 0.9 ? -0.04 : -0.12;
                }
                score = Math.min(0.99, lastSim * 0.48 + firstSim * 0.44 + midBonus);
            }

            // Check accidentally swapped Last Name & First Name fields on paper
            if (score < 0.75) {
                const swappedLastSim = stringSimilarity(extracted.first, rosterParsed.last);
                const swappedFirstSim = stringSimilarity(extracted.last, rosterParsed.first);
                if (swappedLastSim >= 0.85 && swappedFirstSim >= 0.85) {
                    score = Math.max(score, 0.9);
                }
            }
        } else {
            // 3. Fallback when one side is missing structured last/first split
            if (extracted.allTokens.length > 0 && rosterParsed.allTokens.length > 0) {
                let matchedTokens = 0;
                for (const et of extracted.allTokens) {
                    if (rosterParsed.allTokens.some((rt) => stringSimilarity(et, rt) >= 0.78)) {
                        matchedTokens++;
                    }
                }
                const maxTokens = Math.max(extracted.allTokens.length, rosterParsed.allTokens.length);
                const tokenRatio = matchedTokens / maxTokens;
                if (tokenRatio >= 0.72) {
                    score = Math.max(score, tokenRatio * 0.9);
                }
            }

            if (extracted.canonical.length >= 6 && rosterParsed.canonical.length >= 6) {
                const levSim = stringSimilarity(extracted.canonical, rosterParsed.canonical);
                if (levSim >= 0.8) {
                    score = Math.max(score, levSim);
                }
            }
        }

        if (score > highestScore) {
            secondBestScore = highestScore;
            highestScore = score;
            bestMatch = student;
        } else if (score > secondBestScore) {
            secondBestScore = score;
        }
    }

    if (
        bestMatch &&
        highestScore >= 0.75 &&
        (highestScore >= 0.92 || highestScore - secondBestScore >= 0.05)
    ) {
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
            if (
                item.status === "ready" ||
                (item.status === "needs_review" &&
                    item.flaggedCount === 0 &&
                    item.matchedStudentId &&
                    !item.photoQuality?.hasWarnings)
            ) {
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
                    [{ resize: { width: 1800 } }],
                    { compress: 0.90, format: SaveFormat.JPEG, base64: true }
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
                this.options.layoutJson,
                this.options.roster
            );

            // Stage 3: Post-Grading Analysis & Roster Matching
            const flaggedItems = (gradingResult.results || []).filter(isItemUnresolvedFlag);

            const flaggedCount = flaggedItems.length;

            // Roster Matching (using both canonical name and extracted structured parts)
            const match = matchStudentToRoster(gradingResult.studentName, this.options.roster, {
                lastName: gradingResult.lastName,
                firstName: gradingResult.firstName,
                middleName: gradingResult.middleName,
            });

            const hasMatched = Boolean(match);
            const photoQuality = gradingResult.photoQuality;
            const hasPhotoWarnings = Boolean(photoQuality?.hasWarnings);
            const needsReview = flaggedCount > 0 || !hasMatched || hasPhotoWarnings;

            this.updateItem(item.id, {
                status: needsReview ? "needs_review" : "ready",
                gradingResult,
                photoQuality,
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
