// lib/printEngine/layoutJson.ts

import { AnswerKeyItem, AnswerVariant, GeneratedAssessment, LayoutItem, LayoutJSON, QuestionType, ScannableQuestion } from './types';

export interface FlaggedQuestion {
    questionNumber: number;
    answer: string;
    charCount: number;
    warning: string;
}

/**
 * Validates that handwritten answers for Identification, Fill in the Blank,
 * and Enumeration do not exceed physical paper answer box capacity (~25 characters).
 */
export function validateAnswerLengths(assessment: GeneratedAssessment): FlaggedQuestion[] {
    const MAX_CHARS = 25;
    const flagged: FlaggedQuestion[] = [];

    const keyMap = new Map<number, AnswerKeyItem>(
        assessment.answerKey.map((k) => [k.questionNumber, k])
    );

    for (const q of assessment.questions) {
        const keyItem = keyMap.get(q.questionNumber);
        if (!keyItem) continue;

        const rawAns = keyItem.correctAnswer || '';

        if (q.type === 'enumeration') {
            // Enumeration may contain comma/semicolon/slash separated items
            const subItems = rawAns.split(/[,;\n/]+/).map((s) => s.trim()).filter(Boolean);
            for (const sub of subItems) {
                if (sub.length > MAX_CHARS) {
                    flagged.push({
                        questionNumber: q.questionNumber,
                        answer: sub,
                        charCount: sub.length,
                        warning: `Enumeration item "${sub}" (${sub.length} chars) exceeds the 25-character physical answer box limit.`,
                    });
                }
            }
        } else if (q.type === 'fill_blank' || q.type === 'identification') {
            if (rawAns.length > MAX_CHARS) {
                flagged.push({
                    questionNumber: q.questionNumber,
                    answer: rawAns,
                    charCount: rawAns.length,
                    warning: `Answer "${rawAns}" (${rawAns.length} chars) is too long for the handwritten answer box. Keep it under 25 characters.`,
                });
            }
        }
    }

    return flagged;
}

/**
 * Generates accepted answer variants for each question to accommodate
 * minor variations in spelling, casing, punctuation, and abbreviations.
 */
export function generateAnswerVariants(assessment: GeneratedAssessment): AnswerVariant[] {
    const keyMap = new Map<number, AnswerKeyItem>(
        assessment.answerKey.map((k) => [k.questionNumber, k])
    );

    const variants: AnswerVariant[] = [];

    for (const q of assessment.questions) {
        const key = keyMap.get(q.questionNumber);
        if (!key) continue;

        const baseAnswer = (key.correctAnswer || '').trim();
        const set = new Set<string>();

        // Exact uppercase
        set.add(baseAnswer.toUpperCase());

        // Without punctuation (periods, commas, hyphens)
        const stripped = baseAnswer.replace(/[.,\-_/\\()]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
        set.add(stripped);

        // No spaces (e.g. "DATA CENTER" -> "DATACENTER")
        const compressed = stripped.replace(/\s+/g, '');
        if (compressed.length > 3) {
            set.add(compressed);
        }

        // True/False variants
        if (q.type === 'true_false') {
            const first = baseAnswer.trim().toUpperCase()[0];
            if (first === 'T') {
                set.add('T');
                set.add('TRUE');
            } else if (first === 'F') {
                set.add('F');
                set.add('FALSE');
            }
        }

        variants.push({
            questionNumber: q.questionNumber,
            type: q.type,
            accepted: Array.from(set),
            maxChars: q.type === 'multiple_choice' || q.type === 'true_false' || q.type === 'word_box' ? 1 : 25,
        });
    }

    return variants;
}

/**
 * Formats LayoutJSON bounding boxes into precise coordinates for Gemini Vision OCR prompt.
 * Coordinates are formatted with y measured from the TOP edge of the page (y = 0 at top),
 * matching standard image and computer vision coordinate systems.
 */
export function formatBoxesForGraderPrompt(layoutJson: LayoutJSON): string {
    const lines: string[] = [
        `LAYOUT COORDINATE MAP (Page Size: ${layoutJson.pageSize.width}x${layoutJson.pageSize.height} pt, y measured from top edge):`,
        'Look at these exact physical bounding boxes on the straightened paper to read student handwriting (y=0 is at top edge):',
    ];

    for (const page of layoutJson.pages) {
        lines.push(`--- Page ${page.pageNumber} ---`);
        for (const item of page.items) {
            const b = item.box;
            const label = item.subIndex !== undefined
                ? `Item ${item.questionNumber}.${item.subIndex}`
                : `Item ${item.questionNumber}`;
            lines.push(
                `- ${label} (${item.type}): box at [x=${Math.round(b.x)}, y=${Math.round(b.y)}, w=${Math.round(b.width)}, h=${Math.round(b.height)}] maxChars=${item.maxChars}`
            );
        }
    }

    return lines.join('\n');
}

/**
 * Finds a specific item's layout box by questionNumber and optional subIndex.
 */
export function findLayoutItemBox(
    layoutJson: LayoutJSON,
    questionNumber: number,
    subIndex?: number
): LayoutItem | undefined {
    for (const page of layoutJson.pages) {
        for (const item of page.items) {
            if (item.questionNumber === questionNumber) {
                if (subIndex === undefined || item.subIndex === subIndex) {
                    return item;
                }
            }
        }
    }
    return undefined;
}
