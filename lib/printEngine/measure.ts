// lib/printEngine/measure.ts

import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import { FONT_CONFIG } from './constants';
import { ScannableQuestion } from './types';

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
 * and fit decisions never block the JS thread loading/parsing 1.15 MB TTF files.
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
 * Measures the exact rendered width of a string in points using embedded Noto Sans metrics.
 */
export function measureTextWidth(text: string, fontSize: number, font: PDFFont): number {
    if (!text || text.length === 0) return 0;
    return font.widthOfTextAtSize(text, fontSize);
}

/**
 * Splits text into wrapped lines that fit within maxWidth points.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
    if (!text || text.trim().length === 0) return [''];

    const words = text.split(/\s+/);
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
            // If a single word is wider than maxWidth, keep it on its own line
            currentLine = word;
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
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

export interface AllInOneItemMetrics {
    isLetter: boolean;
    isEnumeration: boolean;
    enumBoxes: number;
    boxWidth: number;
    boxHeight: number;
    totalBoxHeight: number;
    numReserve: number;
    textWidth: number;
    itemGap: number;
}

/**
 * Shared exact geometry metrics used by both measurement (decideFit) and
 * rendering (allInOneRenderer) so ALL-IN-ONE pages never overflow or collide.
 */
export function getAllInOneItemMetrics(
    question: ScannableQuestion,
    fontSize: number,
    columnWidth: number
): AllInOneItemMetrics {
    const isLetter =
        question.type === 'multiple_choice' ||
        question.type === 'true_false' ||
        question.type === 'word_box';
    const isEnumeration = question.type === 'enumeration';
    const enumBoxes = isEnumeration ? Math.max(1, question.answerBoxesRequired || 3) : 1;

    const isCompact = fontSize <= 9.5;
    const boxWidth = isLetter ? (isCompact ? 20 : 22) : isCompact ? 80 : 88;
    const boxHeight = isLetter ? (isCompact ? 17 : 20) : isCompact ? 15.5 : 18;
    const enumGap = 3;
    const totalBoxHeight = isEnumeration
        ? enumBoxes * boxHeight + (enumBoxes - 1) * enumGap
        : boxHeight;

    // Reserve clear space for the small question-number indicator drawn left of the box
    const numReserve = question.questionNumber >= 10 ? 18 : 14;
    const textWidth = Math.max(70, columnWidth - boxWidth - numReserve);
    const itemGap = fontSize >= 10.5 ? 6 : fontSize >= 9.0 ? 4.5 : 3.5;

    return {
        isLetter,
        isEnumeration,
        enumBoxes,
        boxWidth,
        boxHeight,
        totalBoxHeight,
        numReserve,
        textWidth,
        itemGap,
    };
}

/**
 * Measures the vertical height required to render a single question and its options/boxes.
 */
export function measureQuestionHeight(
    question: ScannableQuestion,
    fontSize: number,
    columnWidth: number,
    font: PDFFont,
    isAllInOne: boolean = false,
    allowCompactOptionPairing: boolean = false
): number {
    const lineHeight = fontSize * getLineHeightFactor(fontSize);
    const metrics = isAllInOne ? getAllInOneItemMetrics(question, fontSize, columnWidth) : null;
    const itemGap = metrics ? metrics.itemGap : fontSize >= 10.5 ? 6 : fontSize >= 9.0 ? 4.5 : 3.5;

    const availableTextWidth = metrics ? metrics.textWidth : columnWidth;

    // Measure question stem
    const prefix = `${question.questionNumber}. `;
    const prefixW = measureTextWidth(prefix, fontSize, font);
    const stemLines = wrapText(question.questionText, Math.max(50, availableTextWidth - prefixW), fontSize, font);
    let height = stemLines.length * lineHeight;

    // Measure options (for multiple choice)
    if (question.type === 'multiple_choice' && question.options && question.options.length > 0) {
        const optionIndent = isAllInOne ? 10 : fontSize >= 10.0 ? 14 : 11;
        const optFontSize = isAllInOne ? fontSize * 0.94 : fontSize;
        const optLineHeight = isAllInOne ? lineHeight * 0.94 : lineHeight;
        const optionWidth = Math.max(50, availableTextWidth - optionIndent);

        if (
            allowCompactOptionPairing &&
            fontSize <= 9.5 &&
            canPairMcOptions(question.options, optionWidth, optFontSize, font)
        ) {
            const pairedRows = Math.ceil(question.options.length / 2);
            height += pairedRows * optLineHeight;
        } else {
            for (let i = 0; i < question.options.length; i++) {
                const letter = String.fromCharCode(65 + i);
                const cleanOpt = question.options[i].replace(/^[A-D][.)]\s*/i, '');
                const optPrefixW = measureTextWidth(`${letter}) `, optFontSize, font);
                const optLines = wrapText(cleanOpt, Math.max(40, optionWidth - optPrefixW), optFontSize, font);
                height += optLines.length * optLineHeight;
            }
        }
    }

    // In ALL-IN-ONE layout, ensure row height accommodates the answer box(es) height
    if (metrics) {
        height = Math.max(height, metrics.totalBoxHeight + 2);
    }

    return height + itemGap;
}

/**
 * Computes height-balanced 2-column split & dimensions for ALL-IN-ONE layout,
 * keeping sequential order (1..splitIndex left, splitIndex+1..N right) while
 * minimizing max(col1Height, col2Height) so both columns fill the bond paper evenly.
 */
export function measureAllInOneColumns(
    questions: ScannableQuestion[],
    fontSize: number,
    columnWidth: number,
    font: PDFFont
): { col1Height: number; col2Height: number; maxHeight: number; splitIndex: number } {
    if (questions.length === 0) {
        return { col1Height: 0, col2Height: 0, maxHeight: 0, splitIndex: 0 };
    }
    if (questions.length === 1) {
        const h = measureQuestionHeight(questions[0], fontSize, columnWidth, font, true);
        return { col1Height: h, col2Height: 0, maxHeight: h, splitIndex: 1 };
    }

    const heights = questions.map((q) =>
        measureQuestionHeight(q, fontSize, columnWidth, font, true)
    );
    const total = heights.reduce((acc, h) => acc + h, 0);

    let bestSplit = Math.ceil(questions.length / 2);
    let bestCol1 = 0;
    let bestCol2 = total;
    let bestMax = Infinity;
    let running = 0;

    for (let i = 0; i < questions.length; i++) {
        running += heights[i];
        const col1 = running;
        const col2 = total - running;
        const curMax = Math.max(col1, col2);
        // Prefer strictly lower maxHeight, or on tie prefer col1 >= col2 (natural reading balance)
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
