// teacher-web/src/lib/printEngine/fitDecision.ts

import { PDFFont } from 'pdf-lib';
import { FONT_CONFIG, MARGINS, PAPER_DIMENSIONS } from './constants';
import { getMeasureFont, measureAllInOneColumns, measureQuestionHeight } from './measure';
import type { FitResult, GeneratedAssessment, PrintOptions } from './types';

/**
 * Determines whether the assessment fits on a single ALL-IN-ONE page,
 * or requires a SEPARATE reusable question booklet and answer sheet.
 */
export async function decideFit(
    assessment: GeneratedAssessment,
    options: PrintOptions = {},
    measureFont?: PDFFont
): Promise<FitResult> {
    const font = measureFont || await getMeasureFont();
    const paperSize = options.paperSize || 'short';
    const dimensions = PAPER_DIMENSIONS[paperSize];

    const printableWidth = dimensions.width - MARGINS.left - MARGINS.right; // 540 pt
    const printableHeight = dimensions.height - MARGINS.top - MARGINS.bottom; // 720 pt (short) / 864 pt (long)

    // Two-column layout geometry
    const columnGutter = 24;
    const columnWidth = (printableWidth - columnGutter) / 2; // 258 pt each

    // If teacher explicitly requested SEPARATE
    if (options.forceSeparate || options.mode === 'SEPARATE') {
        const bookletPages = estimateBookletPages(assessment.questions, 11.0, columnWidth, dimensions.height, font);
        return {
            mode: 'SEPARATE',
            fontSize: FONT_CONFIG.DEFAULT_SIZE,
            lineHeight: FONT_CONFIG.DEFAULT_SIZE * FONT_CONFIG.LINE_HEIGHT_FACTOR,
            pages: bookletPages + 1, // booklet pages + 1 answer sheet
            fitMessage: `Separate question booklet (${bookletPages} pages) + 1 answer sheet`,
        };
    }

    // Determine minimum font allowed by grade level
    const isPrimary = options.gradeLevel && /^(grade\s*[1-3]|1|2|3)$/i.test(options.gradeLevel.trim());
    const minFont = isPrimary ? FONT_CONFIG.MIN_SIZE_PRIMARY : FONT_CONFIG.MIN_SIZE_DEFAULT;
    const candidates = FONT_CONFIG.CANDIDATES.filter((f) => f >= minFont);

    // Reserved heights on ALL-IN-ONE page:
    // Header (title, student name, score box, QR code): ~95 pt
    // Instructions banner: ~28 pt
    // Footer & bottom margin buffer: ~30 pt
    const reservedVertical = 95 + 28 + 30;
    const availableQuestionHeight = printableHeight - reservedVertical;

    // Check each candidate font size descending (11.0 -> 10.5 -> 10.0)
    for (const fontSize of candidates) {
        const { maxHeight } = measureAllInOneColumns(assessment.questions, fontSize, columnWidth, font);

        if (maxHeight <= availableQuestionHeight) {
            return {
                mode: 'ALL_IN_ONE',
                fontSize,
                lineHeight: fontSize * FONT_CONFIG.LINE_HEIGHT_FACTOR,
                pages: 1,
                fitMessage: `Fits on 1 page at ${fontSize} pt (ALL-IN-ONE)`,
            };
        }
    }

    // If it doesn't fit on a single page, switch to SEPARATE mode at 11 pt
    const bookletPages = estimateBookletPages(assessment.questions, 11.0, columnWidth, dimensions.height, font);
    return {
        mode: 'SEPARATE',
        fontSize: FONT_CONFIG.DEFAULT_SIZE,
        lineHeight: FONT_CONFIG.DEFAULT_SIZE * FONT_CONFIG.LINE_HEIGHT_FACTOR,
        pages: bookletPages + 1, // booklet pages + 1 answer sheet
        fitMessage: `Content requires ${bookletPages} booklet pages. Switched to separate reusable booklet + answer sheet`,
    };
}

/**
 * Estimates how many pages the question booklet will take in SEPARATE mode.
 */
export function estimateBookletPages(
    questions: GeneratedAssessment['questions'],
    fontSize: number,
    columnWidth: number,
    pageHeight: number,
    font: PDFFont
): number {
    const printableHeight = pageHeight - MARGINS.top - MARGINS.bottom;
    const page1Reserved = 110 + 30; // Page 1 header + footer
    const pageNReserved = 45 + 30;  // Continuation header + footer

    const page1Capacity = printableHeight - page1Reserved;
    const pageNCapacity = printableHeight - pageNReserved;

    let currentPage = 1;
    let currentCapacity = page1Capacity;
    let col1Used = 0;
    let col2Used = 0;

    for (const q of questions) {
        const qHeight = measureQuestionHeight(q, fontSize, columnWidth, font, false);

        if (col1Used + qHeight <= currentCapacity) {
            col1Used += qHeight;
        } else if (col2Used + qHeight <= currentCapacity) {
            col2Used += qHeight;
        } else {
            // Both columns full on current page, move to next page
            currentPage += 1;
            currentCapacity = pageNCapacity;
            col1Used = qHeight;
            col2Used = 0;
        }
    }

    return currentPage;
}
