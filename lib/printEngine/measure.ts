// lib/printEngine/measure.ts

import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';
import { FONT_CONFIG } from './constants';
import { ScannableQuestion } from './types';

let cachedFont: PDFFont | null = null;

/**
 * Returns a shared Helvetica PDFFont instance for text measurement.
 */
export async function getMeasureFont(): Promise<PDFFont> {
    if (cachedFont) return cachedFont;
    const doc = await PDFDocument.create();
    cachedFont = await doc.embedFont(StandardFonts.Helvetica);
    return cachedFont;
}

/**
 * Measures the exact rendered width of a string in points using Helvetica metrics.
 */
export function measureTextWidth(text: string, fontSize: number, font: PDFFont): number {
    if (!text || text.length === 0) return 0;
    // Sanitize non-ASCII chars for standard Helvetica
    const sanitized = text.replace(/[^\x20-\x7E]/g, ' ');
    return font.widthOfTextAtSize(sanitized, fontSize);
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
 * Measures the vertical height required to render a single question and its options/boxes.
 */
export function measureQuestionHeight(
    question: ScannableQuestion,
    fontSize: number,
    columnWidth: number,
    font: PDFFont,
    isAllInOne: boolean = false
): number {
    const lineHeight = fontSize * FONT_CONFIG.LINE_HEIGHT_FACTOR;
    const itemGap = 6; // gap below question item

    // In ALL-IN-ONE layout, question text must leave space for the answer box on the right
    // Letter box: ~26 pt + 6 pt margin = 32 pt reserved on the right
    const availableTextWidth = isAllInOne && (question.type === 'multiple_choice' || question.type === 'true_false' || question.type === 'word_box')
        ? columnWidth - 34
        : columnWidth;

    // Measure question stem
    const qText = `${question.questionNumber}. ${question.questionText}`;
    const stemLines = wrapText(qText, availableTextWidth, fontSize, font);
    let height = stemLines.length * lineHeight;

    // Measure options (for multiple choice or word box)
    if (question.type === 'multiple_choice' && question.options && question.options.length > 0) {
        const optionIndent = 12;
        const optionWidth = availableTextWidth - optionIndent;
        for (let i = 0; i < question.options.length; i++) {
            const letter = String.fromCharCode(65 + i);
            const optText = `${letter}) ${question.options[i]}`;
            const optLines = wrapText(optText, optionWidth, fontSize, font);
            height += optLines.length * lineHeight;
        }
    }

    // In ALL-IN-ONE layout, make sure row height accommodates the answer box height
    if (isAllInOne) {
        const minBoxHeight = question.type === 'fill_blank' || question.type === 'identification' ? 24 : 26;
        height = Math.max(height, minBoxHeight);
    }

    return height + itemGap;
}

/**
 * Computes total vertical height for 2-column flow in ALL-IN-ONE layout.
 */
export function measureAllInOneColumns(
    questions: ScannableQuestion[],
    fontSize: number,
    columnWidth: number,
    font: PDFFont
): { col1Height: number; col2Height: number; maxHeight: number } {
    const half = Math.ceil(questions.length / 2);
    let col1Height = 0;
    let col2Height = 0;

    for (let i = 0; i < questions.length; i++) {
        const qHeight = measureQuestionHeight(questions[i], fontSize, columnWidth, font, true);
        if (i < half) {
            col1Height += qHeight;
        } else {
            col2Height += qHeight;
        }
    }

    return {
        col1Height,
        col2Height,
        maxHeight: Math.max(col1Height, col2Height),
    };
}
