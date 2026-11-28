// teacher-web/src/lib/printEngine/measure.ts

import { PDFDocument, type PDFFont, StandardFonts } from 'pdf-lib';
import { FONT_CONFIG } from './constants';
import type { AnswerKeyItem, ScannableQuestion } from './types';

let cachedRegularFont: PDFFont | null = null;
let cachedBoldFont: PDFFont | null = null;

function wrapUnicodeSafeWidth(font: PDFFont): PDFFont {
    const origWidth = font.widthOfTextAtSize.bind(font);
    font.widthOfTextAtSize = (text: string, size: number): number => {
        if (!text || text.length === 0) return 0;
        try {
            const safeText = /[^\x20-\x7E]/.test(text) ? text.replace(/[^\x20-\x7E]/g, 'n') : text;
            return origWidth(safeText, size);
        } catch {
            return text.length * size * 0.55;
        }
    };
    return font;
}

/**
 * Returns a shared lightweight PDFFont instance for fast text measurement (< 2 ms).
 * Uses built-in Helvetica metrics with Unicode-safe width fallback so LAYOUT_ONLY
 * and fit decisions never block the JS thread.
 */
export async function getMeasureFont(): Promise<PDFFont> {
    if (cachedRegularFont) return cachedRegularFont;
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    cachedRegularFont = wrapUnicodeSafeWidth(regular);
    cachedBoldFont = wrapUnicodeSafeWidth(bold);
    return cachedRegularFont;
}

/**
 * Returns a shared lightweight Bold PDFFont instance for fast text measurement.
 */
export async function getMeasureBoldFont(): Promise<PDFFont> {
    if (cachedBoldFont) return cachedBoldFont;
    await getMeasureFont();
    return cachedBoldFont!;
}

/**
 * Measures the exact rendered width of a string in points using embedded font metrics.
 */
export function measureTextWidth(text: string, fontSize: number, font: PDFFont): number {
    if (!text || text.length === 0) return 0;
    return font.widthOfTextAtSize(text, fontSize);
}

function splitOverlongToken(token: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
    if (!token || maxWidth <= 0) return [token];
    if (measureTextWidth(token, fontSize, font) <= maxWidth) return [token];

    if (/^_{4,}([.,;:?!)]*)$/.test(token)) {
        const suffix = token.replace(/^_+/, '');
        let underscores = '__________';
        while (underscores.length > 3 && measureTextWidth(underscores + suffix, fontSize, font) > Math.min(maxWidth, 90)) {
            underscores = underscores.slice(0, -1);
        }
        if (measureTextWidth(underscores + suffix, fontSize, font) <= maxWidth) {
            return [underscores + suffix];
        }
    }

    const chunks: string[] = [];
    let remaining = token;
    while (remaining.length > 0) {
        if (measureTextWidth(remaining, fontSize, font) <= maxWidth) {
            chunks.push(remaining);
            break;
        }
        let lo = 1;
        let hi = remaining.length;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (measureTextWidth(remaining.slice(0, mid), fontSize, font) <= maxWidth) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let splitAt = lo;
        const minNatural = Math.max(1, Math.floor(lo * 0.6));
        for (let idx = lo; idx >= minNatural; idx--) {
            const ch = remaining[idx - 1];
            if (ch === '-' || ch === '/' || ch === '_' || ch === '.' || ch === ',') {
                splitAt = idx;
                break;
            }
        }
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
    }
    return chunks.length > 0 ? chunks : [token];
}

/**
 * Splits text into wrapped lines that strictly fit within maxWidth points.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
    if (!text || text.trim().length === 0) return [''];

    const normalized = text.replace(/_{10,}/g, '________');
    const rawWords = normalized.trim().split(/\s+/);
    const words: string[] = [];
    for (const w of rawWords) {
        if (measureTextWidth(w, fontSize, font) > maxWidth) {
            words.push(...splitOverlongToken(w, maxWidth, fontSize, font));
        } else {
            words.push(w);
        }
    }

    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
        const width = measureTextWidth(testLine, fontSize, font);

        if (width <= maxWidth) {
            currentLine = testLine;
        } else {
            if (currentLine.length > 0) {
                lines.push(currentLine);
            }
            currentLine = word;
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
}

/**
 * Truncates a single line of text with an ellipsis ("...") so its rendered width
 * never exceeds maxWidth points.
 */
export function truncateTextToWidth(
    text: string,
    maxWidth: number,
    fontSize: number,
    font: PDFFont
): string {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean || maxWidth <= 0) return '';
    if (measureTextWidth(clean, fontSize, font) <= maxWidth) return clean;

    const ellipsis = '...';
    const ellipsisW = measureTextWidth(ellipsis, fontSize, font);
    if (ellipsisW >= maxWidth) return '';

    let lo = 0;
    let hi = clean.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = clean.slice(0, mid).trimEnd() + ellipsis;
        if (measureTextWidth(candidate, fontSize, font) <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo > 0 ? clean.slice(0, lo).trimEnd() + ellipsis : ellipsis;
}

/**
 * Fits a PDF header title/subtitle strictly inside `maxWidth` points so it never
 * overlaps adjacent SCORE boxes, QR codes, or page margins.
 *
 * 1. Keeps short titles at `preferredFontSize` on 1 line (unchanged).
 * 2. Slightly steps down up to 1.5 pt if that lets it stay on 1 crisp line.
 * 3. Wraps across up to `maxLines` lines, stepping font size down to `minFontSize` as needed.
 * 4. Caps to `maxLines` and ellipsis-truncates any overflow strictly within `maxWidth`.
 */
export function fitHeaderText(
    text: string,
    maxWidth: number,
    font: PDFFont,
    preferredFontSize: number,
    minFontSize: number = 9.5,
    maxLines: number = 2
): { lines: string[]; fontSize: number; lineHeight: number } {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
        return { lines: [''], fontSize: preferredFontSize, lineHeight: preferredFontSize * 1.2 };
    }

    // 1. Fits cleanly on 1 line at preferred size
    if (measureTextWidth(clean, preferredFontSize, font) <= maxWidth) {
        return {
            lines: [clean],
            fontSize: preferredFontSize,
            lineHeight: preferredFontSize * 1.2,
        };
    }

    // 2. Fits on 1 line with mild downscale (at most 1.5 pt smaller)
    const mildSize = Math.max(minFontSize, preferredFontSize - 1.5);
    if (mildSize < preferredFontSize && measureTextWidth(clean, mildSize, font) <= maxWidth) {
        return {
            lines: [clean],
            fontSize: mildSize,
            lineHeight: mildSize * 1.2,
        };
    }

    if (maxLines <= 1) {
        return {
            lines: [truncateTextToWidth(clean, maxWidth, mildSize, font)],
            fontSize: mildSize,
            lineHeight: mildSize * 1.2,
        };
    }

    // 3. Multi-line wrap trying descending sizes in 0.5 pt steps
    const startWrapSize = Math.max(minFontSize, preferredFontSize - 1.5);
    for (let sz = startWrapSize; sz >= minFontSize; sz -= 0.5) {
        const wrapped = wrapText(clean, maxWidth, sz, font);
        const allLinesFitWidth = wrapped.every((l) => measureTextWidth(l, sz, font) <= maxWidth);
        if (wrapped.length <= maxLines && allLinesFitWidth) {
            return {
                lines: wrapped,
                fontSize: sz,
                lineHeight: sz * 1.18,
            };
        }
    }

    // 4. Cap to maxLines at minFontSize and ellipsis-truncate strictly inside maxWidth
    const wrappedMin = wrapText(clean, maxWidth, minFontSize, font);
    const capped: string[] = [];
    for (let i = 0; i < Math.min(maxLines, wrappedMin.length); i++) {
        if (i === maxLines - 1 && wrappedMin.length > maxLines) {
            const remainder = wrappedMin.slice(i).join(' ');
            capped.push(truncateTextToWidth(remainder, maxWidth, minFontSize, font));
        } else {
            capped.push(truncateTextToWidth(wrappedMin[i], maxWidth, minFontSize, font));
        }
    }

    return {
        lines: capped,
        fontSize: minFontSize,
        lineHeight: minFontSize * 1.18,
    };
}

/**
 * Returns responsive line-height multiplier (tighter at smaller compact fonts
 * while preserving crisp 1.25x leading at standard 11pt).
 */
export function getLineHeightFactor(fontSize: number): number {
    if (fontSize >= 10.5) return FONT_CONFIG.LINE_HEIGHT_FACTOR; // 1.25
    if (fontSize >= 9.0) return 1.21;
    return 1.17;
}

/**
 * Checks whether a multiple-choice question's options (2-4 items) are all short enough
 * to render cleanly side-by-side in a 2-column grid (A/B on row 1, C/D on row 2)
 * without wrapping or overlapping.
 */
export function canPairMcOptions(
    options: string[] | undefined,
    availableWidth: number,
    fontSize: number,
    font: PDFFont
): boolean {
    if (!options || options.length < 2 || options.length > 4) return false;
    const halfColWidth = (availableWidth - 10) / 2;
    if (halfColWidth < 60) return false;

    for (let i = 0; i < options.length; i++) {
        const letter = String.fromCharCode(65 + i);
        const optText = options[i].replace(/^[A-D][.)]\s*/i, '').trim();
        const w = measureTextWidth(`${letter}) ${optText}`, fontSize, font);
        if (w > halfColWidth - 4) return false;
    }
    return true;
}

export type AllInOneBoxLayout = 'inline' | 'below_full' | 'below_grid2';

export interface ExpectedAnswerStats {
    hasExplicitAnswer: boolean;
    longestChars: number;
    longestWords: number;
    maxChars: number;
    subAnswers: string[];
}

export function getEnumerationBoxCount(
    question: ScannableQuestion,
    answerKey?: AnswerKeyItem[]
): number {
    if (question.type !== 'enumeration') return 1;
    const explicitBoxes =
        typeof question.answerBoxesRequired === 'number' && question.answerBoxesRequired > 0
            ? Math.round(question.answerBoxesRequired)
            : 0;

    let keyItemCount = 0;
    if (answerKey && answerKey.length > 0) {
        const keyObj = answerKey.find((k) => k.questionNumber === question.questionNumber);
        const raw = String(keyObj?.correctAnswer ?? (question as any).correctAnswer ?? '').trim();
        if (raw) {
            const parts = raw
                .split(/[,;\n/]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            if (parts.length > 1) {
                keyItemCount = Math.min(10, parts.length);
            }
        }
    }

    if (explicitBoxes > 1) {
        return Math.max(explicitBoxes, keyItemCount);
    }
    if (keyItemCount > 1) {
        return keyItemCount;
    }
    return explicitBoxes === 1 ? 1 : 3;
}

export function getExpectedAnswerStats(
    question: ScannableQuestion,
    answerKey?: AnswerKeyItem[]
): ExpectedAnswerStats {
    const keyObj = answerKey?.find((k) => k.questionNumber === question.questionNumber);
    const raw = String(keyObj?.correctAnswer ?? (question as any).correctAnswer ?? '').trim();

    if (!raw) {
        return {
            hasExplicitAnswer: false,
            longestChars: 16,
            longestWords: 2,
            maxChars: 25,
            subAnswers: [],
        };
    }

    if (question.type === 'enumeration') {
        const subs = raw
            .split(/[,;\n/]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        const list = subs.length > 0 ? subs : [raw];
        let longestChars = 0;
        let longestWords = 0;
        for (const item of list) {
            if (item.length > longestChars) longestChars = item.length;
            const wc = item.split(/\s+/).filter(Boolean).length;
            if (wc > longestWords) longestWords = wc;
        }
        return {
            hasExplicitAnswer: true,
            longestChars,
            longestWords,
            maxChars: Math.max(25, longestChars + 6),
            subAnswers: list,
        };
    }

    const words = raw.split(/\s+/).filter(Boolean).length;
    return {
        hasExplicitAnswer: true,
        longestChars: raw.length,
        longestWords: words,
        maxChars:
            question.type === 'multiple_choice' || question.type === 'true_false'
                ? 1
                : Math.max(25, raw.length + 6),
        subAnswers: [raw],
    };
}

export interface AllInOneItemMetrics {
    isLetter: boolean;
    isEnumeration: boolean;
    enumBoxes: number;
    boxLayout: AllInOneBoxLayout;
    badgeWidth: number;
    boxWidth: number;
    boxHeight: number;
    totalBoxHeight: number;
    numReserve: number;
    textWidth: number;
    itemGap: number;
    maxChars: number;
}

/**
 * Converts a 0-based index into a bijective spreadsheet-style uppercase letter label:
 * 0 -> "A", 25 -> "Z", 26 -> "AA", 27 -> "AB", ...
 */
export function indexToWordBankLabel(index: number): string {
    let n = Math.max(0, Math.floor(index));
    let label = '';
    while (n >= 0) {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    }
    return label;
}

/**
 * Inverse of indexToWordBankLabel: "A" -> 0, "Z" -> 25, "AA" -> 26, or -1 if invalid.
 */
export function wordBankLabelToIndex(label: string): number {
    const clean = (label || '').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(clean)) return -1;
    let acc = 0;
    for (let i = 0; i < clean.length; i++) {
        acc = acc * 26 + (clean.charCodeAt(i) - 64);
    }
    return acc - 1;
}

/**
 * Returns the maximum label character length needed for a word bank of `wordCount` items
 * (1 for <= 26 words, 2 for 27..702 words, etc.).
 */
export function getWordBankMaxChars(wordCount: number): number {
    if (wordCount <= 0) return 1;
    return indexToWordBankLabel(wordCount - 1).length;
}

/**
 * Strips a leading word-bank letter prefix like "A) " or "AA) " without stripping
 * abbreviations like "Dr. Smith" or numbers like "1.4".
 */
export function stripWordBankPrefix(raw: string): string {
    return (raw || '').trim().replace(/^[A-Za-z]{1,2}\)\s+/, '').trim();
}

/**
 * Aggregates all unique words across every `word_box` question in order of appearance,
 * deduplicating case-insensitively while preserving first-seen display casing.
 * Also guarantees that any word-form correctAnswer in `answerKey` is present in the bank.
 */
export function extractSharedWordBank(
    questions: ScannableQuestion[],
    answerKey?: AnswerKeyItem[]
): string[] {
    const wordBoxQuestions = questions.filter((q) => q.type === 'word_box');
    if (wordBoxQuestions.length === 0) return [];

    const seen = new Set<string>();
    const words: string[] = [];

    const addWord = (raw: string | undefined | null) => {
        if (!raw) return;
        const clean = stripWordBankPrefix(String(raw)).replace(/\s+/g, ' ').trim();
        if (!clean) return;
        const normKey = clean.toLowerCase();
        if (!seen.has(normKey)) {
            seen.add(normKey);
            words.push(clean);
        }
    };

    for (const q of wordBoxQuestions) {
        if (Array.isArray(q.options)) {
            for (const opt of q.options) {
                addWord(opt);
            }
        }
    }

    if (answerKey && answerKey.length > 0) {
        const keyMap = new Map(answerKey.map((k) => [k.questionNumber, k]));
        for (const q of wordBoxQuestions) {
            const rawAns = String(
                keyMap.get(q.questionNumber)?.correctAnswer ??
                    (q as ScannableQuestion & { correctAnswer?: string }).correctAnswer ??
                    ''
            ).trim();
            if (!rawAns) continue;
            const idx = wordBankLabelToIndex(rawAns);
            const isValidBankLetterRef = idx >= 0 && idx < words.length;
            if (!isValidBankLetterRef) {
                addWord(rawAns);
            }
        }
    }

    return words;
}

/**
 * Resolves a `word_box` answer (either a word like "Canva" or a bank label like "A"/"AA")
 * to its canonical bank label and word entry.
 */
export function resolveWordBankLabel(
    answer: string,
    words: string[]
): { label: string; word: string } | null {
    if (!answer || words.length === 0) return null;
    const trimmed = answer.trim();
    const cleaned = stripWordBankPrefix(trimmed).replace(/\s+/g, ' ').trim();

    if (cleaned) {
        const norm = cleaned.toLowerCase();
        const wordIdx = words.findIndex((w) => w.toLowerCase() === norm);
        if (wordIdx >= 0) {
            return {
                label: indexToWordBankLabel(wordIdx),
                word: words[wordIdx],
            };
        }
    }

    const letterIdx = wordBankLabelToIndex(trimmed);
    if (letterIdx >= 0 && letterIdx < words.length) {
        return {
            label: indexToWordBankLabel(letterIdx),
            word: words[letterIdx],
        };
    }

    return null;
}

export interface WordBankEntry {
    label: string;
    word: string;
    display: string;
}

export function formatWordBankEntries(words: string[]): WordBankEntry[] {
    return words.map((word, index) => {
        const label = indexToWordBankLabel(index);
        return {
            label,
            word,
            display: `${label}) ${word}`,
        };
    });
}

/**
 * Packs complete labeled Word Bank entries ("A) Word") onto lines separated by clear spacing
 * without splitting an entry between its label and its word.
 */
export function wrapWordBankLines(
    entries: WordBankEntry[],
    maxWidth: number,
    fontSize: number,
    font: PDFFont,
    prefix: string = ''
): string[] {
    if (entries.length === 0) return [];
    const sep = '   ';
    const lines: string[] = [];
    let currentLine = prefix;

    for (const entry of entries) {
        const token = entry.display;
        const candidate =
            currentLine.length === 0
                ? token
                : currentLine === prefix
                    ? `${prefix}${token}`
                    : `${currentLine}${sep}${token}`;

        if (measureTextWidth(candidate, fontSize, font) <= maxWidth) {
            currentLine = candidate;
        } else {
            if (currentLine.length > 0 && currentLine !== prefix) {
                lines.push(currentLine);
                currentLine = '';
            }
            const singleTarget = currentLine === prefix ? `${prefix}${token}` : token;
            if (measureTextWidth(singleTarget, fontSize, font) <= maxWidth) {
                currentLine = singleTarget;
            } else {
                const subLines = wrapText(singleTarget, maxWidth, fontSize, font);
                for (let i = 0; i < subLines.length - 1; i++) {
                    lines.push(subLines[i]);
                }
                currentLine = subLines[subLines.length - 1] || '';
            }
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

export interface WordBankLayoutMetrics {
    bankSize: number;
    lineHeight: number;
    padding: number;
    bottomGap: number;
    entries: WordBankEntry[];
    lines: string[];
    boxHeight: number;
    totalHeight: number;
}

/**
 * Single source of truth for Word Bank typography, wrapping, and vertical height across
 * fitDecision, allInOneRenderer, and bookletRenderer.
 */
export function measureWordBankLayout(
    words: string[],
    maxWidth: number,
    fontSize: number,
    font: PDFFont,
    mode: 'ALL_IN_ONE' | 'BOOKLET'
): WordBankLayoutMetrics {
    const entries = formatWordBankEntries(words);
    if (entries.length === 0) {
        return {
            bankSize: 8,
            lineHeight: 10,
            padding: 5,
            bottomGap: 0,
            entries: [],
            lines: [],
            boxHeight: 0,
            totalHeight: 0,
        };
    }

    let bankSize: number;
    let lineHeight: number;
    let padding: number;
    let bottomGap: number;
    let prefix = '';

    if (mode === 'ALL_IN_ONE') {
        bankSize =
            words.length > 26
                ? Math.max(7.0, Math.min(7.5, fontSize - 1.5))
                : words.length > 16
                    ? Math.max(7.2, Math.min(8.0, fontSize - 1.2))
                    : Math.max(7.5, Math.min(8.5, fontSize - 1));
        lineHeight = bankSize + (words.length > 16 ? 2.2 : 2.5);
        padding = 5;
        bottomGap = 8;
        prefix = 'WORD BANK:  ';
    } else {
        const isCompact = fontSize <= 9.5 || words.length > 16;
        bankSize = words.length > 26 ? 7.0 : isCompact ? 7.5 : 8.5;
        lineHeight = words.length > 26 ? 9.0 : isCompact ? 9.5 : 11.0;
        padding = isCompact ? 5 : 6;
        bottomGap = isCompact ? 6 : 8;
    }

    const innerWidth = Math.max(60, maxWidth - padding * 2);
    const lines = wrapWordBankLines(entries, innerWidth, bankSize, font, prefix);
    const boxHeight = lines.length * lineHeight + padding * 2;
    const totalHeight = boxHeight + bottomGap;

    return {
        bankSize,
        lineHeight,
        padding,
        bottomGap,
        entries,
        lines,
        boxHeight,
        totalHeight,
    };
}

export function getAllInOneItemMetrics(
    question: ScannableQuestion,
    fontSize: number,
    columnWidth: number,
    wordBoxMaxChars: number = 1,
    answerKey?: AnswerKeyItem[]
): AllInOneItemMetrics {
    const isLetter =
        question.type === 'multiple_choice' ||
        question.type === 'true_false' ||
        question.type === 'word_box';
    const isEnumeration = question.type === 'enumeration';
    const enumBoxes = isEnumeration ? getEnumerationBoxCount(question, answerKey) : 1;
    const ansStats = getExpectedAnswerStats(question, answerKey);
    const isCompact = fontSize <= 9.5;
    const itemGap = fontSize >= 10.5 ? 6 : fontSize >= 9.0 ? 4.5 : 3.5;

    if (isLetter) {
        const isWideWordBox = question.type === 'word_box' && wordBoxMaxChars > 1;
        const boxWidth = isWideWordBox ? (isCompact ? 26 : 28) : isCompact ? 20 : 22;
        const boxHeight = isCompact ? 17 : 20;
        const numReserve = question.questionNumber >= 10 ? 18 : 14;
        const textWidth = Math.max(70, columnWidth - boxWidth - numReserve);
        return {
            isLetter: true,
            isEnumeration: false,
            enumBoxes: 1,
            boxLayout: 'inline',
            badgeWidth: 0,
            boxWidth,
            boxHeight,
            totalBoxHeight: boxHeight,
            numReserve,
            textWidth,
            itemGap,
            maxChars: question.type === 'word_box' ? wordBoxMaxChars : 1,
        };
    }

    if (isEnumeration) {
        const useTwoColSubGrid =
            enumBoxes >= 2 &&
            ansStats.hasExplicitAnswer &&
            ansStats.longestChars <= 12 &&
            ansStats.longestWords <= 2;

        const enumGapY = 3;
        const isVeryLong = ansStats.longestChars > 32;
        const boxHeight = isVeryLong
            ? isCompact ? 21 : 23.5
            : isCompact ? 16.5 : 18.5;

        if (useTwoColSubGrid) {
            const subColGutter = 8;
            const cellWidth = (columnWidth - subColGutter) / 2;
            const badgeWidth = 25;
            const boxWidth = Math.max(60, cellWidth - badgeWidth);
            const rows = Math.ceil(enumBoxes / 2);
            const totalBoxHeight = rows * boxHeight + Math.max(0, rows - 1) * enumGapY;
            return {
                isLetter: false,
                isEnumeration: true,
                enumBoxes,
                boxLayout: 'below_grid2',
                badgeWidth,
                boxWidth,
                boxHeight,
                totalBoxHeight,
                numReserve: 0,
                textWidth: columnWidth,
                itemGap,
                maxChars: ansStats.maxChars,
            };
        }

        const badgeWidth = 28;
        const boxWidth = Math.max(120, columnWidth - badgeWidth);
        const totalBoxHeight = enumBoxes * boxHeight + Math.max(0, enumBoxes - 1) * enumGapY;
        return {
            isLetter: false,
            isEnumeration: true,
            enumBoxes,
            boxLayout: 'below_full',
            badgeWidth,
            boxWidth,
            boxHeight,
            totalBoxHeight,
            numReserve: 0,
            textWidth: columnWidth,
            itemGap,
            maxChars: ansStats.maxChars,
        };
    }

    const isShortInlineText =
        ansStats.hasExplicitAnswer &&
        ansStats.longestChars <= 10 &&
        ansStats.longestWords <= 2;

    if (isShortInlineText) {
        const boxWidth = isCompact ? 84 : 88;
        const boxHeight = isCompact ? 15.5 : 18;
        const numReserve = question.questionNumber >= 10 ? 18 : 14;
        const textWidth = Math.max(70, columnWidth - boxWidth - numReserve);
        return {
            isLetter: false,
            isEnumeration: false,
            enumBoxes: 1,
            boxLayout: 'inline',
            badgeWidth: 0,
            boxWidth,
            boxHeight,
            totalBoxHeight: boxHeight,
            numReserve,
            textWidth,
            itemGap,
            maxChars: ansStats.maxChars,
        };
    }

    const badgeWidth = 22;
    const boxWidth = Math.max(140, columnWidth - badgeWidth);
    const isVeryLong = ansStats.longestChars > 32;
    const boxHeight = isVeryLong
        ? isCompact ? 22 : 25
        : isCompact ? 17.5 : 19.5;

    return {
        isLetter: false,
        isEnumeration: false,
        enumBoxes: 1,
        boxLayout: 'below_full',
        badgeWidth,
        boxWidth,
        boxHeight,
        totalBoxHeight: boxHeight,
        numReserve: 0,
        textWidth: columnWidth,
        itemGap,
        maxChars: ansStats.maxChars,
    };
}

export function getAllInOneSectionBannerHeight(fontSize: number, isFirstInColumn: boolean): number {
    const bannerH = fontSize <= 9.5 ? 12.5 : 14;
    const topGap = isFirstInColumn ? 0 : fontSize <= 9.5 ? 3 : 4.5;
    const bottomGap = 3.5;
    return topGap + bannerH + bottomGap;
}

export function measureQuestionHeight(
    question: ScannableQuestion,
    fontSize: number,
    columnWidth: number,
    font: PDFFont,
    isAllInOne: boolean = false,
    allowCompactOptionPairing: boolean = false,
    wordBoxMaxChars: number = 1,
    answerKey?: AnswerKeyItem[],
    boldFont?: PDFFont
): number {
    const lineHeight = fontSize * getLineHeightFactor(fontSize);
    const metrics = isAllInOne
        ? getAllInOneItemMetrics(question, fontSize, columnWidth, wordBoxMaxChars, answerKey)
        : null;
    const itemGap = metrics ? metrics.itemGap : fontSize >= 10.5 ? 6 : fontSize >= 9.0 ? 4.5 : 3.5;

    const availableTextWidth = metrics ? metrics.textWidth : columnWidth;

    const prefix = `${question.questionNumber}. `;
    const prefixW = measureTextWidth(prefix, fontSize, boldFont || font);
    const stemLines = wrapText(question.questionText, Math.max(50, availableTextWidth - prefixW), fontSize, font);
    let height = stemLines.length * lineHeight;

    if (question.type === 'multiple_choice' && question.options && question.options.length > 0) {
        const optionIndent = isAllInOne ? 10 : fontSize >= 10.0 ? 14 : 11;
        const optFontSize = isAllInOne ? fontSize * 0.94 : fontSize;
        const optLineHeight = isAllInOne ? lineHeight * 0.94 : lineHeight;
        const optionWidth = Math.max(50, availableTextWidth - optionIndent);
        const pairThreshold = isAllInOne ? 10.0 : 9.5;

        if (
            allowCompactOptionPairing &&
            fontSize <= pairThreshold &&
            canPairMcOptions(question.options, optionWidth, optFontSize, font)
        ) {
            const pairedRows = Math.ceil(question.options.length / 2);
            height += pairedRows * optLineHeight;
        } else {
            for (let i = 0; i < question.options.length; i++) {
                const letter = String.fromCharCode(65 + i);
                const cleanOpt = question.options[i].replace(/^[A-D][.)]\s*/i, '');
                const optPrefixW = measureTextWidth(`${letter}) `, optFontSize, boldFont || font);
                const optLines = wrapText(cleanOpt, Math.max(40, optionWidth - optPrefixW), optFontSize, font);
                height += optLines.length * optLineHeight;
            }
        }
    }

    if (metrics) {
        if (metrics.boxLayout === 'inline') {
            height = Math.max(height, metrics.totalBoxHeight + 2);
        } else {
            height += 2.5 + metrics.totalBoxHeight;
        }
    }

    return height + itemGap;
}

function sumAllInOneSliceHeight(
    slice: ScannableQuestion[],
    itemHeights: number[],
    offset: number,
    hasMultipleTypes: boolean,
    fontSize: number,
    initialPrevType: ScannableQuestion['type'] | null = null
): number {
    let total = 0;
    let prevType = initialPrevType;
    for (let i = 0; i < slice.length; i++) {
        const q = slice[i];
        if (hasMultipleTypes && q.type !== prevType) {
            total += getAllInOneSectionBannerHeight(fontSize, i === 0);
            prevType = q.type;
        }
        total += itemHeights[offset + i];
    }
    return total;
}

export function measureAllInOneColumns(
    questions: ScannableQuestion[],
    fontSize: number,
    columnWidth: number,
    font: PDFFont,
    wordBoxMaxChars: number = 1,
    answerKey?: AnswerKeyItem[],
    boldFont?: PDFFont,
    paperSize: 'short' | 'long' = 'short'
): { col1Height: number; col2Height: number; maxHeight: number; splitIndex: number } {
    if (questions.length === 0) {
        return { col1Height: 0, col2Height: 0, maxHeight: 0, splitIndex: 0 };
    }
    const hasMultipleTypes = new Set(questions.map((q) => q.type)).size > 1;
    const allowPairing =
        paperSize === 'long'
            ? fontSize <= 10.0
            : fontSize <= 9.5 && questions.length <= 20;

    if (questions.length === 1) {
        const h = measureQuestionHeight(
            questions[0],
            fontSize,
            columnWidth,
            font,
            true,
            allowPairing,
            wordBoxMaxChars,
            answerKey,
            boldFont
        );
        return { col1Height: h, col2Height: 0, maxHeight: h, splitIndex: 1 };
    }

    const heights = questions.map((q) =>
        measureQuestionHeight(
            q,
            fontSize,
            columnWidth,
            font,
            true,
            allowPairing,
            wordBoxMaxChars,
            answerKey,
            boldFont
        )
    );

    let bestSplit = Math.ceil(questions.length / 2);
    let bestCol1 = 0;
    let bestCol2 = Infinity;
    let bestMax = Infinity;

    for (let i = 0; i < questions.length; i++) {
        const col1Slice = questions.slice(0, i + 1);
        const col2Slice = questions.slice(i + 1);
        const col1 = sumAllInOneSliceHeight(col1Slice, heights, 0, hasMultipleTypes, fontSize, null);
        const lastCol1Type = col1Slice[col1Slice.length - 1]?.type ?? null;
        const col2 =
            col2Slice.length > 0
                ? sumAllInOneSliceHeight(col2Slice, heights, i + 1, hasMultipleTypes, fontSize, lastCol1Type)
                : 0;
        const curMax = Math.max(col1, col2);
        if (curMax < bestMax - 0.5 || (Math.abs(curMax - bestMax) <= 0.5 && col1 >= col2 && bestCol1 < bestCol2)) {
            bestMax = curMax;
            bestSplit = i + 1;
            bestCol1 = col1;
            bestCol2 = col2;
        }
    }

    return {
        col1Height: bestCol1,
        col2Height: bestCol2,
        maxHeight: Math.max(bestCol1, bestCol2),
        splitIndex: bestSplit,
    };
}
