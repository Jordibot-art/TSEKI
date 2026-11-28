// teacher-web/src/lib/printEngine/fitDecision.ts

import type { PDFFont } from 'pdf-lib';
import { throwIfExportAborted } from './cancel';
import { type BondPaperSize, FONT_CONFIG, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { textRequiresUnicodeFont } from './fonts/embedFonts';
import {
    extractSharedWordBank,
    fitHeaderText,
    getLineHeightFactor,
    getMeasureBoldFont,
    getMeasureFont,
    getWordBankMaxChars,
    measureAllInOneColumns,
    measureQuestionHeight,
    measureWordBankLayout,
} from './measure';
import type { AnswerKeyItem, FitResult, GeneratedAssessment, PrintOptions, ScannableQuestion } from './types';

export interface BookletLayoutEstimate {
    pages: number;
    lastPageFillRatio: number;
}

export interface BookletFontSelection {
    fontSize: number;
    lineHeight: number;
    bookletPages: number;
    lastPageFillRatio: number;
}

function isPrimaryGrade(gradeLevel?: string): boolean {
    return Boolean(gradeLevel && /^(grade\s*[1-3]|1|2|3)$/i.test(gradeLevel.trim()));
}

export function estimateAllInOneAvailableHeight(
    title: string,
    pageWidth: number,
    pageHeight: number,
    boldFont: PDFFont
): number {
    const startY = pageHeight - MARGINS.top - 4;
    const headerTextX = MARGINS.left + 24;
    const qrX = pageWidth - MARGINS.right - 24 - QR_CODE_CONFIG.size;
    const scoreBoxX = qrX - 12 - 80;
    const maxHeaderWidth = Math.max(120, scoreBoxX - headerTextX - 12);

    const fittedTitle = fitHeaderText(title || 'Classroom Assessment', maxHeaderWidth, boldFont, 13.5, 9.5, 2);
    const titleStartY = fittedTitle.lines.length > 1 ? startY - 21 : startY - 24;
    const titleLineH = fittedTitle.fontSize * 1.24;
    const lastTitleY = titleStartY - (fittedTitle.lines.length - 1) * titleLineH;
    const subtitleY = fittedTitle.lines.length > 1 ? lastTitleY - 13.5 : startY - 39;
    const nameY = Math.min(startY - 63, subtitleY - 13.5);
    const dateY = nameY - 11;
    const instY = dateY - 13;
    const cursorY = instY - 12;

    const footerSafeBottomY = MARGINS.bottom + 16;
    return Math.max(120, cursorY - footerSafeBottomY);
}

function estimatePartOverhead(
    partType: ScannableQuestion['type'],
    sharedWordBank: string[],
    fontSize: number,
    columnWidth: number,
    font: PDFFont,
    boldFont?: PDFFont
): number {
    const isCompact = fontSize <= 9.5;
    const bannerHeight = isCompact ? 14 : 16;
    const instLineH = isCompact ? 9.5 : 11;
    const instLines = partType === 'multiple_choice' || partType === 'word_box' ? 2 : 1;
    let overhead = bannerHeight + (isCompact ? 10 : 12) + instLines * instLineH + (isCompact ? 2 : 4);

    if (partType === 'word_box') {
        const words =
            sharedWordBank.length > 0
                ? sharedWordBank
                : ['Option 1', 'Option 2', 'Option 3', 'Option 4'];
        const wbLayout = measureWordBankLayout(
            words,
            boldFont ? columnWidth : columnWidth * 0.94,
            fontSize,
            boldFont || font,
            'BOOKLET'
        );
        overhead += wbLayout.totalHeight;
    }

    return overhead;
}

export function estimateBookletLayout(
    questions: GeneratedAssessment['questions'],
    fontSize: number,
    columnWidth: number,
    pageHeight: number,
    font: PDFFont,
    answerKey?: AnswerKeyItem[],
    boldFont?: PDFFont
): BookletLayoutEstimate {
    if (questions.length === 0) {
        return { pages: 1, lastPageFillRatio: 0 };
    }

    const sharedWordBank = extractSharedWordBank(questions, answerKey);
    const printableHeight = pageHeight - MARGINS.top - MARGINS.bottom;
    const page1Reserved = 96 + 28;
    const pageNReserved = 70 + 28;

    const page1Capacity = Math.max(200, printableHeight - page1Reserved);
    const pageNCapacity = Math.max(200, printableHeight - pageNReserved);
    const allowPairing = fontSize <= 9.5;
    const partGap = fontSize <= 9.5 ? 5 : 8;

    let currentPage = 1;
    let currentCapacity = page1Capacity;
    let currentCol: 1 | 2 = 1;
    let col1Used = 0;
    let col2Used = 0;

    const advanceSlot = (needed: number) => {
        const used = currentCol === 1 ? col1Used : col2Used;
        if (used + needed <= currentCapacity) return;

        if (currentCol === 1) {
            currentCol = 2;
            if (col2Used + needed <= currentCapacity) return;
        }

        currentPage += 1;
        currentCapacity = pageNCapacity;
        currentCol = 1;
        col1Used = 0;
        col2Used = 0;
    };

    const addHeight = (h: number) => {
        if (currentCol === 1) col1Used += h;
        else col2Used += h;
    };

    let prevType: ScannableQuestion['type'] | null = null;

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (q.type !== prevType) {
            if (prevType !== null) {
                addHeight(partGap);
            }
            const partHeaderH = estimatePartOverhead(q.type, sharedWordBank, fontSize, columnWidth, font, boldFont);
            const firstItemH = measureQuestionHeight(
                q,
                fontSize,
                columnWidth,
                font,
                false,
                allowPairing,
                1,
                answerKey,
                boldFont
            );
            advanceSlot(Math.min(partHeaderH, currentCapacity) + Math.min(firstItemH, 40));
            addHeight(partHeaderH);
            prevType = q.type;
        }

        const qHeight = measureQuestionHeight(
            q,
            fontSize,
            columnWidth,
            font,
            false,
            allowPairing,
            1,
            answerKey,
            boldFont
        );
        advanceSlot(qHeight);
        addHeight(qHeight);
    }

    const lastPageUsed = col1Used + col2Used;
    const lastPageTotal = currentCapacity * 2;
    const lastPageFillRatio = lastPageTotal > 0 ? Math.min(1, lastPageUsed / lastPageTotal) : 1;

    return {
        pages: currentPage,
        lastPageFillRatio,
    };
}

export function estimateBookletPages(
    questions: GeneratedAssessment['questions'],
    fontSize: number,
    columnWidth: number,
    pageHeight: number,
    font: PDFFont,
    answerKey?: AnswerKeyItem[],
    boldFont?: PDFFont
): number {
    return estimateBookletLayout(questions, fontSize, columnWidth, pageHeight, font, answerKey, boldFont).pages;
}

export function chooseBookletFontSize(
    questions: GeneratedAssessment['questions'],
    paperSize: BondPaperSize = 'short',
    gradeLevel: string | undefined,
    font: PDFFont,
    answerKey?: AnswerKeyItem[],
    boldFont?: PDFFont
): BookletFontSelection {
    const dimensions = PAPER_DIMENSIONS[paperSize];
    const printableWidth = dimensions.width - MARGINS.left - MARGINS.right;
    const columnGutter = 24;
    const columnWidth = (printableWidth - columnGutter) / 2;

    const isPrimary = isPrimaryGrade(gradeLevel);
    const minAllowed = isPrimary ? FONT_CONFIG.MIN_SIZE_PRIMARY : FONT_CONFIG.MIN_SIZE_DENSE;
    const allCandidates = FONT_CONFIG.BOOKLET_CANDIDATES.filter((sz) => sz >= minAllowed);

    const stdLayout = estimateBookletLayout(
        questions,
        FONT_CONFIG.DEFAULT_SIZE,
        columnWidth,
        dimensions.height,
        font,
        answerKey,
        boldFont
    );

    if (questions.length <= 30) {
        if (stdLayout.pages === 1) {
            return {
                fontSize: FONT_CONFIG.DEFAULT_SIZE,
                lineHeight: FONT_CONFIG.DEFAULT_SIZE * getLineHeightFactor(FONT_CONFIG.DEFAULT_SIZE),
                bookletPages: 1,
                lastPageFillRatio: stdLayout.lastPageFillRatio,
            };
        }

        if (paperSize === 'short' && stdLayout.pages === 2 && stdLayout.lastPageFillRatio >= 0.25) {
            return {
                fontSize: FONT_CONFIG.DEFAULT_SIZE,
                lineHeight: FONT_CONFIG.DEFAULT_SIZE * getLineHeightFactor(FONT_CONFIG.DEFAULT_SIZE),
                bookletPages: 2,
                lastPageFillRatio: stdLayout.lastPageFillRatio,
            };
        }

        const gentleMin = isPrimary ? FONT_CONFIG.MIN_SIZE_PRIMARY : 9.0;
        const gentleCandidates = allCandidates.filter((sz) => sz < FONT_CONFIG.DEFAULT_SIZE && sz >= gentleMin);
        for (const sz of gentleCandidates) {
            const sim = estimateBookletLayout(questions, sz, columnWidth, dimensions.height, font, answerKey, boldFont);
            if (sim.pages < stdLayout.pages) {
                return {
                    fontSize: sz,
                    lineHeight: sz * getLineHeightFactor(sz),
                    bookletPages: sim.pages,
                    lastPageFillRatio: sim.lastPageFillRatio,
                };
            }
        }

        return {
            fontSize: FONT_CONFIG.DEFAULT_SIZE,
            lineHeight: FONT_CONFIG.DEFAULT_SIZE * getLineHeightFactor(FONT_CONFIG.DEFAULT_SIZE),
            bookletPages: stdLayout.pages,
            lastPageFillRatio: stdLayout.lastPageFillRatio,
        };
    }

    const simulations = allCandidates.map((sz) => ({
        fontSize: sz,
        ...estimateBookletLayout(questions, sz, columnWidth, dimensions.height, font, answerKey, boldFont),
    }));

    const minPages = Math.min(...simulations.map((s) => s.pages));
    const best = simulations.find((s) => s.pages === minPages) || simulations[0];

    return {
        fontSize: best.fontSize,
        lineHeight: best.fontSize * getLineHeightFactor(best.fontSize),
        bookletPages: best.pages,
        lastPageFillRatio: best.lastPageFillRatio,
    };
}

export async function decideFit(
    assessment: GeneratedAssessment,
    options: PrintOptions = {},
    measureFont?: PDFFont
): Promise<FitResult> {
    throwIfExportAborted(options.signal);
    const font = measureFont || (await getMeasureFont());
    const boldFont = measureFont ? font : await getMeasureBoldFont();
    throwIfExportAborted(options.signal);
    const paperSize = options.paperSize || 'short';
    const dimensions = PAPER_DIMENSIONS[paperSize];

    const printableWidth = dimensions.width - MARGINS.left - MARGINS.right;
    const allInOneColWidth = (printableWidth - 20) / 2;

    if (options.forceSeparate || options.mode === 'SEPARATE') {
        const bookletChoice = chooseBookletFontSize(
            assessment.questions,
            paperSize,
            options.gradeLevel,
            font,
            assessment.answerKey,
            boldFont
        );
        return {
            mode: 'SEPARATE',
            fontSize: bookletChoice.fontSize,
            lineHeight: bookletChoice.lineHeight,
            pages: bookletChoice.bookletPages + 1,
            fitMessage: `Separate question booklet (${bookletChoice.bookletPages} ${bookletChoice.bookletPages === 1 ? 'page' : 'pages'} at ${bookletChoice.fontSize} pt on ${paperSize} bond) + answer sheet`,
        };
    }

    const textSample = [
        assessment.quizTitle || '',
        options.classTitle || '',
        ...assessment.questions.flatMap((q) => [q.questionText || '', ...(q.options || [])]),
    ].join(' ');
    const unicodeWidthFactor = !measureFont && textRequiresUnicodeFont(textSample) ? 0.94 : 1.0;
    const effectiveMeasureColWidth = allInOneColWidth * unicodeWidthFactor;

    const isPrimary = isPrimaryGrade(options.gradeLevel);
    const maxSingleSheetItems = paperSize === 'long' ? 38 : 32;

    if (assessment.questions.length <= maxSingleSheetItems) {
        const rawAllInOneCandidates =
            paperSize === 'long'
                ? FONT_CONFIG.ALL_IN_ONE_LONG_CANDIDATES
                : FONT_CONFIG.ALL_IN_ONE_CANDIDATES;
        const minAllInOne = isPrimary
            ? FONT_CONFIG.MIN_SIZE_PRIMARY
            : paperSize === 'long'
                ? FONT_CONFIG.MIN_SIZE_LONG_BOND
                : FONT_CONFIG.MIN_SIZE_DEFAULT;
        const candidates = rawAllInOneCandidates.filter((f) => f >= minAllInOne);

        const title = assessment.quizTitle || (assessment as any).title || 'Classroom Assessment';
        const availableQuestionHeight = estimateAllInOneAvailableHeight(
            title,
            dimensions.width,
            dimensions.height,
            boldFont
        );

        const sharedWordBank = extractSharedWordBank(assessment.questions, assessment.answerKey);
        const wordBoxMaxChars = getWordBankMaxChars(sharedWordBank.length);

        for (const fontSize of candidates) {
            const wordBankReserve =
                sharedWordBank.length > 0
                    ? measureWordBankLayout(
                          sharedWordBank,
                          printableWidth * unicodeWidthFactor,
                          fontSize,
                          boldFont,
                          'ALL_IN_ONE'
                      ).totalHeight
                    : 0;
            const effectiveHeight = availableQuestionHeight - wordBankReserve;
            const { maxHeight } = measureAllInOneColumns(
                assessment.questions,
                fontSize,
                effectiveMeasureColWidth,
                font,
                wordBoxMaxChars,
                assessment.answerKey,
                boldFont,
                paperSize
            );

            if (effectiveHeight > 0 && maxHeight <= effectiveHeight) {
                return {
                    mode: 'ALL_IN_ONE',
                    fontSize,
                    lineHeight: fontSize * getLineHeightFactor(fontSize),
                    pages: 1,
                    fitMessage: `Fits on 1 ${paperSize} bond page at ${fontSize} pt (ALL-IN-ONE)`,
                };
            }
        }
    }

    const bookletChoice = chooseBookletFontSize(
        assessment.questions,
        paperSize,
        options.gradeLevel,
        font,
        assessment.answerKey,
        boldFont
    );
    return {
        mode: 'SEPARATE',
        fontSize: bookletChoice.fontSize,
        lineHeight: bookletChoice.lineHeight,
        pages: bookletChoice.bookletPages + 1,
        fitMessage: `Switched to separate booklet (${bookletChoice.bookletPages} ${bookletChoice.bookletPages === 1 ? 'page' : 'pages'} at ${bookletChoice.fontSize} pt on ${paperSize} bond) + answer sheet`,
    };
}
