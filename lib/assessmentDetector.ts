import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKey } from "./ai/geminiKey";
import { extractJsonFromResponse } from "./ai/openAICompatibleClient";
import { levenshteinDistance } from "./gradingService";
import type { StoredQuiz } from "./quizStore";

export const AUTO_DETECT_ASSESSMENT = "Auto-Detect from Test Paper";

export interface ParsedTsekiQr {
    quizId: string;
    version?: string;
    docType?: string;
    page?: string;
}

export interface PaperAssessmentSignals {
    matchedIndex?: number | null;
    detectedQuizCode?: string | null;
    detectedTitle?: string | null;
    detectedItemCount?: number | null;
    detectedVersion?: string | null;
    detectedQ1Snippet?: string | null;
    detectedQ2Snippet?: string | null;
    aiConfidence?: number;
}

export interface AssessmentMatchResult {
    quiz: StoredQuiz;
    confidence: number;
    method: "qr_exact" | "code_exact" | "vision_match" | "single_available";
    detectedTitle?: string;
    detectedItemCount?: number;
    detectedQuizCode?: string;
    detectedVersion?: string;
}

const STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "which",
    "into",
    "your",
    "about",
    "are",
    "was",
    "were",
    "does",
    "following",
    "best",
    "most",
    "used",
    "in",
    "of",
    "to",
    "a",
    "an",
    "is",
    "on",
    "at",
    "by",
    "or",
    "as",
]);

function normalizeText(str?: string | null): string {
    return (str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(str?: string | null): string[] {
    return normalizeText(str)
        .split(" ")
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function tokenOverlapScore(a?: string | null, b?: string | null): number {
    const normA = normalizeText(a);
    const normB = normalizeText(b);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    // Prefix / containment check — handles printed titles truncated near the SCORE box
    // e.g. "introduction to client server systems server har" vs full title
    const shorter = normA.length <= normB.length ? normA : normB;
    const longer = normA.length <= normB.length ? normB : normA;
    let prefixScore = 0;
    if (shorter.length >= 10 && longer.startsWith(shorter)) {
        prefixScore = Math.min(0.98, 0.88 + (shorter.length / longer.length) * 0.10);
    } else if (shorter.length >= 12 && longer.includes(shorter)) {
        prefixScore = 0.90;
    }

    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    if (tokensA.length === 0 || tokensB.length === 0) {
        return prefixScore;
    }

    // Count fuzzy token matches (handles minor OCR typos or clipped trailing word like "har" -> "hardware")
    let matchedA = 0;
    for (const ta of tokensA) {
        const hit = tokensB.some((tb) => {
            if (ta === tb) return true;
            if (ta.length >= 3 && (tb.startsWith(ta) || ta.startsWith(tb))) return true;
            const maxLen = Math.max(ta.length, tb.length);
            return maxLen >= 4 && levenshteinDistance(ta, tb) / maxLen <= 0.25;
        });
        if (hit) matchedA++;
    }

    let matchedB = 0;
    for (const tb of tokensB) {
        const hit = tokensA.some((ta) => {
            if (ta === tb) return true;
            if (tb.length >= 3 && (ta.startsWith(tb) || tb.startsWith(ta))) return true;
            const maxLen = Math.max(ta.length, tb.length);
            return maxLen >= 4 && levenshteinDistance(ta, tb) / maxLen <= 0.25;
        });
        if (hit) matchedB++;
    }

    const recallA = matchedA / tokensA.length;
    const recallB = matchedB / tokensB.length;
    // Favor containment when the printed snippet is shorter/truncated, balanced with bidirectional F1
    const f1 = recallA + recallB > 0 ? (2 * recallA * recallB) / (recallA + recallB) : 0;
    const containment = Math.max(recallA, recallB) * 0.85;

    return Math.max(prefixScore, f1, containment);
}

/**
 * Parses a TSEKI QR code payload (`<quizId>|<version>|<docType>|<page>/<total>`).
 */
export function parseTsekiQrPayload(rawQr?: string | null): ParsedTsekiQr | null {
    const cleaned = (rawQr || "").trim();
    if (!cleaned) return null;

    if (cleaned.includes("|")) {
        const parts = cleaned.split("|").map((p) => p.trim());
        const quizId = parts[0];
        if (!quizId) return null;
        return {
            quizId,
            version: parts[1] || undefined,
            docType: parts[2] || undefined,
            page: parts[3] || undefined,
        };
    }

    // Also accept bare quiz IDs like "QZ-237673" or "quiz_1795205311680"
    if (/^(?:QZ-|quiz_|draft_)[A-Za-z0-9_-]+$/i.test(cleaned)) {
        return { quizId: cleaned };
    }

    return null;
}

function getQuizQuestionCount(quiz: StoredQuiz): number {
    if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        return quiz.questions.length;
    }
    if (Array.isArray(quiz.answerKey) && quiz.answerKey.length > 0) {
        return quiz.answerKey.length;
    }
    return 0;
}

/**
 * Formats a clean, unambiguous dropdown label for a published quiz.
 * When two quizzes in the same classroom share the exact same title (e.g. a 5-item and 20-item version),
 * automatically appends the item count (and date if still colliding) so both remain selectable.
 */
export function getDisambiguatedQuizLabel(quiz: StoredQuiz, allQuizzes: StoredQuiz[]): string {
    const baseTitle = (quiz.quizTitle || "Untitled Assessment").trim();
    const normBase = baseTitle.toLowerCase();
    const sameTitleQuizzes = allQuizzes.filter(
        (q) => (q.quizTitle || "").trim().toLowerCase() === normBase
    );
    if (sameTitleQuizzes.length <= 1) {
        return baseTitle;
    }

    const itemCount = getQuizQuestionCount(quiz);
    const sameCountToo = sameTitleQuizzes.filter(
        (q) => getQuizQuestionCount(q) === itemCount
    );
    if (sameCountToo.length <= 1) {
        return `${baseTitle} (${itemCount} items)`;
    }

    const dateLabel = quiz.createdAt
        ? new Date(quiz.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
    return dateLabel
        ? `${baseTitle} (${itemCount} items · ${dateLabel})`
        : `${baseTitle} (${itemCount} items)`;
}

/**
 * Instant, deterministic match against a scanned QR payload string.
 */
export function matchAssessmentByQr(
    rawQr: string | null | undefined,
    quizzes: StoredQuiz[]
): AssessmentMatchResult | null {
    if (!rawQr || !Array.isArray(quizzes) || quizzes.length === 0) return null;
    const parsed = parseTsekiQrPayload(rawQr);
    if (!parsed?.quizId) return null;

    const targetCode = parsed.quizId.trim().toLowerCase();
    const matched = quizzes.find((q) => {
        const idMatch = (q.id || "").trim().toLowerCase() === targetCode;
        const layoutIdMatch = (q.layoutJson?.quizId || "").trim().toLowerCase() === targetCode;
        return idMatch || layoutIdMatch;
    });

    if (!matched) return null;
    return {
        quiz: matched,
        confidence: 1.0,
        method: "qr_exact",
        detectedQuizCode: parsed.quizId,
        detectedVersion: parsed.version,
        detectedTitle: matched.quizTitle,
        detectedItemCount: getQuizQuestionCount(matched),
    };
}

/**
 * Deterministic multi-signal matcher that selects the best matching published assessment
 * from a classroom's catalog using printed code, item count, title, and printed Q1/Q2 stems.
 */
export function matchAssessmentToCatalog(
    signals: PaperAssessmentSignals,
    quizzes: StoredQuiz[]
): AssessmentMatchResult | null {
    if (!Array.isArray(quizzes) || quizzes.length === 0) return null;

    // 1. Exact quiz code match (footer "QZ-XXXXXX" or stored ID)
    const detectedCode = (signals.detectedQuizCode || "").trim();
    if (detectedCode) {
        const normCode = detectedCode.toLowerCase();
        const codeMatch = quizzes.find(
            (q) =>
                (q.id || "").trim().toLowerCase() === normCode ||
                (q.layoutJson?.quizId || "").trim().toLowerCase() === normCode
        );
        if (codeMatch) {
            return {
                quiz: codeMatch,
                confidence: 0.99,
                method: "code_exact",
                detectedTitle: signals.detectedTitle || codeMatch.quizTitle,
                detectedItemCount: signals.detectedItemCount || getQuizQuestionCount(codeMatch),
                detectedQuizCode: detectedCode,
                detectedVersion: signals.detectedVersion || undefined,
            };
        }
    }

    const detectedCount =
        typeof signals.detectedItemCount === "number" && signals.detectedItemCount > 0
            ? Math.round(signals.detectedItemCount)
            : null;
    const q1Snippet = (signals.detectedQ1Snippet || "").trim();
    const q2Snippet = (signals.detectedQ2Snippet || "").trim();
    const titleSnippet = (signals.detectedTitle || "").trim();

    let bestQuiz: StoredQuiz | null = null;
    let bestScore = -Infinity;

    quizzes.forEach((quiz, idx) => {
        let score = 0;

        // A. Printed Question #1 and #2 stem comparison (strongest disambiguator when titles overlap)
        const quizQuestions = Array.isArray(quiz.questions) ? quiz.questions : [];
        let q1Sim = 0;
        let q2Sim = 0;

        if (q1Snippet && quizQuestions.length > 0) {
            // Direct Q1 match weighted highest; also check first 6 questions for shuffled Version B/C
            const directQ1 = tokenOverlapScore(q1Snippet, quizQuestions[0]?.questionText);
            const anyQ1 = Math.max(
                ...quizQuestions.slice(0, Math.min(8, quizQuestions.length)).map((q) =>
                    tokenOverlapScore(q1Snippet, q.questionText)
                )
            );
            q1Sim = Math.max(directQ1, anyQ1 * 0.92);
        }

        if (q2Snippet && quizQuestions.length > 1) {
            const directQ2 = tokenOverlapScore(q2Snippet, quizQuestions[1]?.questionText);
            const anyQ2 = Math.max(
                ...quizQuestions.slice(0, Math.min(8, quizQuestions.length)).map((q) =>
                    tokenOverlapScore(q2Snippet, q.questionText)
                )
            );
            q2Sim = Math.max(directQ2, anyQ2 * 0.92);
        }

        if (q1Snippet && q2Snippet) {
            score += q1Sim * 0.32 + q2Sim * 0.22;
        } else if (q1Snippet) {
            score += q1Sim * 0.46;
        } else if (q2Snippet) {
            score += q2Sim * 0.35;
        }

        // B. Printed Title similarity (handles truncated titles near the score box)
        if (titleSnippet) {
            const titleSim = tokenOverlapScore(titleSnippet, quiz.quizTitle);
            score += titleSim * 0.34;
        }

        // C. Item count alignment (critical for distinguishing e.g. 5-item vs 20-item quizzes on same topic!)
        const quizCount = getQuizQuestionCount(quiz);
        if (detectedCount !== null && quizCount > 0) {
            const diff = Math.abs(detectedCount - quizCount);
            if (diff === 0) {
                score += 0.24;
            } else if (diff === 1) {
                score += 0.05;
            } else {
                // Strong penalty when item count clearly disagrees (e.g. 5 items vs 20 items)
                score -= Math.min(0.32, 0.16 + diff * 0.02);
            }
        }

        // D. Vision AI catalog selection bonus (tie-breaker)
        if (
            typeof signals.matchedIndex === "number" &&
            signals.matchedIndex === idx &&
            (signals.aiConfidence === undefined || signals.aiConfidence >= 0.55)
        ) {
            score += 0.14;
        }

        if (score > bestScore) {
            bestScore = score;
            bestQuiz = quiz;
        }
    });

    const minThreshold = quizzes.length === 1 ? 0.10 : 0.30;
    if (bestQuiz && bestScore >= minThreshold) {
        return {
            quiz: bestQuiz,
            confidence: Math.max(0.4, Math.min(0.99, Number(bestScore.toFixed(2)))),
            method: "vision_match",
            detectedTitle: titleSnippet || (bestQuiz as StoredQuiz).quizTitle,
            detectedItemCount: detectedCount ?? getQuizQuestionCount(bestQuiz),
            detectedQuizCode: detectedCode || undefined,
            detectedVersion: signals.detectedVersion || undefined,
        };
    }

    return null;
}

/**
 * Identifies which published assessment a captured student paper belongs to.
 * Tier 1: Instant 0ms QR code match (when captured via live camera).
 * Tier 2: Single-quiz shortcut when classroom has only 1 published assessment.
 * Tier 3: Fast Vision AI identification of printed title, quiz code, item count, and Q1/Q2 stems,
 *         verified deterministically against the classroom's published catalog.
 */
export async function identifyAssessmentFromImage(params: {
    base64Image: string;
    mimeType: "image/jpeg" | "image/png";
    publishedQuizzes: StoredQuiz[];
    qrData?: string | null;
}): Promise<AssessmentMatchResult | null> {
    const { base64Image, mimeType, publishedQuizzes, qrData } = params;
    if (!Array.isArray(publishedQuizzes) || publishedQuizzes.length === 0) {
        return null;
    }

    // Tier 1: Instant exact QR code match
    if (qrData) {
        const qrMatch = matchAssessmentByQr(qrData, publishedQuizzes);
        if (qrMatch) {
            return qrMatch;
        }
    }

    // Tier 2: Only one assessment exists in this classroom
    if (publishedQuizzes.length === 1) {
        const onlyQuiz = publishedQuizzes[0];
        return {
            quiz: onlyQuiz,
            confidence: 0.95,
            method: "single_available",
            detectedTitle: onlyQuiz.quizTitle,
            detectedItemCount: getQuizQuestionCount(onlyQuiz),
        };
    }

    // Tier 3: Fast Vision AI paper identification against classroom catalog
    const cleanBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
    const catalogCandidates = publishedQuizzes.slice(0, 25);
    const catalogManifest = catalogCandidates.map((q, index) => ({
        index,
        quizCode: q.layoutJson?.quizId || q.id,
        title: q.quizTitle,
        itemCount: getQuizQuestionCount(q),
        q1: (q.questions?.[0]?.questionText || "").slice(0, 95),
        q2: (q.questions?.[1]?.questionText || "").slice(0, 95),
    }));

    const prompt = `You are identifying WHICH published assessment a photographed test paper belongs to.
Read the printed header title, printed item count (e.g. "5 Items" or "SCORE ___ / 5" or highest question number), footer quiz code (e.g. "QZ-237673"), version letter, and the first few words of Question 1 and Question 2 on the paper.

PUBLISHED ASSESSMENTS IN THIS CLASSROOM:
${JSON.stringify(catalogManifest, null, 2)}

Return ONLY a strict valid JSON object:
{
  "detectedTitle": "Exact printed title from top of paper",
  "detectedQuizCode": "QZ-237673 or null if not visible",
  "detectedItemCount": 5,
  "detectedVersion": "A",
  "detectedQ1Snippet": "First 10-12 words of printed Question 1",
  "detectedQ2Snippet": "First 10-12 words of printed Question 2",
  "matchedIndex": 0,
  "confidence": 0.95
}
If none of the catalog entries match, set "matchedIndex": null.`;

    let parsed: any = null;
    const apiKey = getGeminiApiKey();

    if (apiKey) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const fastModels = [
            "gemini-3.5-flash-lite",
            "gemini-3.6-flash",
            "gemini-3.8-flash",
        ];

        for (const modelName of fastModels) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.0,
                        maxOutputTokens: 512,
                    },
                });
                const res = await model.generateContent([
                    { inlineData: { data: cleanBase64, mimeType } },
                    { text: prompt },
                ]);
                const text = res?.response?.text()?.trim();
                if (text) {
                    parsed = extractJsonFromResponse(text);
                    if (parsed) break;
                }
            } catch (err: any) {
                console.warn(`[AssessmentDetect] ${modelName} failed (${err?.message?.slice(0, 70)}). Trying next...`);
            }
        }
    }

    if (!parsed) {
        try {
            const { runBackupChain } = await import("./ai/backupRunner");
            const backup = await runBackupChain<any>({
                kind: "vision",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: { url: `data:${mimeType};base64,${cleanBase64}` },
                            },
                        ],
                    },
                ],
                logTag: "[AssessmentDetect Backup]",
                timeoutMs: 20000,
                totalBudgetMs: 30000,
                maxTokens: 512,
                temperature: 0.0,
                validate: (json) => (json && typeof json === "object" ? json : null),
            });
            parsed = backup.value;
        } catch (backupErr) {
            console.warn("[AssessmentDetect] Backup vision identification failed:", backupErr);
        }
    }

    if (!parsed) {
        return null;
    }

    return matchAssessmentToCatalog(
        {
            matchedIndex: typeof parsed.matchedIndex === "number" ? parsed.matchedIndex : null,
            detectedQuizCode: parsed.detectedQuizCode ?? null,
            detectedTitle: parsed.detectedTitle ?? null,
            detectedItemCount:
                typeof parsed.detectedItemCount === "number"
                    ? parsed.detectedItemCount
                    : Number(parsed.detectedItemCount) || null,
            detectedVersion: parsed.detectedVersion ?? null,
            detectedQ1Snippet: parsed.detectedQ1Snippet ?? null,
            detectedQ2Snippet: parsed.detectedQ2Snippet ?? null,
            aiConfidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
        },
        catalogCandidates
    );
}
