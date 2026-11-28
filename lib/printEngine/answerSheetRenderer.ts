// lib/printEngine/answerSheetRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { abortableDelay, throwIfExportAborted } from './cancel';
import { COLORS, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import {
    extractSharedWordBank,
    fitHeaderText,
    getEnumerationBoxCount,
    getExpectedAnswerStats,
    getMeasureBoldFont,
    getMeasureFont,
    getWordBankMaxChars,
    truncateTextToWidth,
} from './measure';
import { drawQRCode } from './qrStamp';
import { AnswerKeyItem, LayoutItem, LayoutPage, MarkerRect, PrintOptions, QRRect, ScannableQuestion } from './types';

export interface AnswerSheetRenderResult {
    pdfBytes: Uint8Array;
    pages: LayoutPage[];
}

interface SheetContext {
    doc: PDFDocument;
    font: PDFFont;
    fontBold: PDFFont;
    width: number;
    height: number;
    printableWidth: number;
    version: 'A' | 'B' | 'C';
    quizId: string;
    totalPoints: number;
    options: PrintOptions;
    totalQuestions: number;
}

interface PageState {
    pdfPage: PDFPage;
    pageNumber: number;
    markers: MarkerRect[];
    qr?: QRRect;
    items: LayoutItem[];
    cursorY: number;
}

/**
 * Builds the physical scannable Answer Sheet PDF with corner registration squares,
 * QR stamp, student information lines, score box, and segmented answer boxes.
 * Responsively adapts box widths, column counts, and heights to Short / Long bond paper
 * and expected answer lengths so Identification and Enumeration answers always fit cleanly.
 */
export async function renderAnswerSheetPDF(
    questions: ScannableQuestion[],
    options: PrintOptions = {}
): Promise<AnswerSheetRenderResult> {
    throwIfExportAborted(options.signal);
    let doc: PDFDocument;
    let font: PDFFont;
    let fontBold: PDFFont;

    if (options.skipPdfSave) {
        font = await getMeasureFont();
        fontBold = await getMeasureBoldFont();
        doc = {
            addPage: ([w, h]: [number, number]) =>
                ({
                    getSize: () => ({ width: w, height: h }),
                    getWidth: () => w,
                    getHeight: () => h,
                    drawText() {},
                    drawRectangle() {},
                    drawLine() {},
                    drawCircle() {},
                }) as unknown as PDFPage,
        } as unknown as PDFDocument;
    } else {
        doc = await PDFDocument.create();
        const textSample = [options.quizId || '', options.classTitle || '', options.subject || ''].join(' ');
        const embedded = await embedPrintFonts(doc, textSample);
        font = embedded.regular;
        fontBold = embedded.bold;
    }
    throwIfExportAborted(options.signal);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${questions.length}`;

    const totalPoints = questions.reduce((sum, q) => {
        if (q.type === 'enumeration') {
            return sum + getEnumerationBoxCount(q, options.answerKey);
        }
        const keyItem = options.answerKey?.find((k) => k.questionNumber === q.questionNumber);
        return sum + (keyItem?.points || 1);
    }, 0);

    const sheetCtx: SheetContext = {
        doc,
        font,
        fontBold,
        width: dims.width,
        height: dims.height,
        printableWidth: dims.width - MARGINS.left - MARGINS.right,
        version,
        quizId,
        totalPoints,
        options,
        totalQuestions: questions.length,
    };

    const pageStates: PageState[] = [];

    // Create Page 1
    const page1 = doc.addPage([dims.width, dims.height]);
    const markers1 = drawCornerMarkers(page1, dims.width, dims.height);
    const headerBottomY = drawAnswerSheetHeader(page1, sheetCtx);

    const state1: PageState = {
        pdfPage: page1,
        pageNumber: 1,
        markers: markers1,
        items: [],
        cursorY: headerBottomY,
    };
    pageStates.push(state1);

    // Draw Answer Sections (with overflow support up to hard max 2 pages)
    drawAnswerSections(pageStates, sheetCtx, questions);
    if (!options.skipPdfSave) {
        await abortableDelay(0, options.signal);
    }
    throwIfExportAborted(options.signal);

    // Stamp QR codes & footers now that totalSheetPages (1 or 2) is known
    const totalSheetPages = pageStates.length;
    const layoutPages: LayoutPage[] = [];

    for (let i = 0; i < totalSheetPages; i++) {
        const st = pageStates[i];
        const qrSize = QR_CODE_CONFIG.size;
        const qrX = dims.width - MARGINS.right - 24 - qrSize;
        const startY = dims.height - MARGINS.top - 4;
        const qrY = startY - qrSize - 2;

        const qrRect = drawQRCode(
            st.pdfPage,
            {
                q: quizId,
                v: version,
                t: 'SHEET',
                p: i + 1,
                n: totalSheetPages,
            },
            qrX,
            qrY,
            qrSize
        );

        drawAnswerSheetFooter(st.pdfPage, sheetCtx, i + 1, totalSheetPages);

        layoutPages.push({
            pageNumber: st.pageNumber,
            markers: st.markers,
            qr: qrRect,
            items: st.items,
        });
    }

    if (!options.skipPdfSave) {
        await abortableDelay(0, options.signal);
    }
    throwIfExportAborted(options.signal);
    const pdfBytes = options.skipPdfSave ? new Uint8Array() : await doc.save();

    return {
        pdfBytes,
        pages: layoutPages,
    };
}

function drawAnswerSheetHeader(
    page: PDFPage,
    ctx: SheetContext
): number {
    const { width, height, font, fontBold, version, totalPoints, options, totalQuestions } = ctx;

    const startY = height - MARGINS.top - 4;
    const headerTextX = MARGINS.left + 24;

    const qrSize = QR_CODE_CONFIG.size;
    const scoreBoxWidth = 84;
    const scoreBoxHeight = 44;
    const scoreBoxX = width - MARGINS.right - 24 - qrSize - 12 - scoreBoxWidth;
    const scoreBoxY = startY - scoreBoxHeight - 2;

    page.drawRectangle({
        x: scoreBoxX,
        y: scoreBoxY,
        width: scoreBoxWidth,
        height: scoreBoxHeight,
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1.0,
        color: rgb(1, 1, 1),
    });

    page.drawText('SCORE', {
        x: scoreBoxX + 8,
        y: scoreBoxY + scoreBoxHeight - 12,
        size: 8.0,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
    });

    page.drawText(`_____ / ${totalPoints}`, {
        x: scoreBoxX + 10,
        y: scoreBoxY + 12,
        size: 11.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    const maxHeaderWidth = Math.max(120, scoreBoxX - headerTextX - 12);

    const paperLabel = options.paperSize === 'long' ? 'LONG BOND' : 'SHORT BOND';
    const eyebrowText = truncateTextToWidth(
        `TSEKI SMART ASSESSMENT SYSTEM | ANSWER SHEET (${paperLabel})`,
        maxHeaderWidth,
        8.5,
        fontBold
    );
    page.drawText(eyebrowText, {
        x: headerTextX,
        y: startY - 8,
        size: 8.5,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    const title = options.quizId ? `Assessment: ${options.quizId}` : 'Class Assessment';
    const fittedTitle = fitHeaderText(title, maxHeaderWidth, fontBold, 14.5, 9.5, 2);
    const titleStartY = fittedTitle.lines.length > 1 ? startY - 22 : startY - 26;
    for (let i = 0; i < fittedTitle.lines.length; i++) {
        page.drawText(fittedTitle.lines[i], {
            x: headerTextX,
            y: titleStartY - i * fittedTitle.lineHeight,
            size: fittedTitle.fontSize,
            font: fontBold,
            color: rgb(0.1, 0.12, 0.16),
        });
    }

    const lastTitleY = titleStartY - (fittedTitle.lines.length - 1) * fittedTitle.lineHeight;
    const subtitleY = fittedTitle.lines.length > 1 ? lastTitleY - 12 : startY - 41;
    const classInfo = options.classTitle || 'BSIT-4';
    const subText = truncateTextToWidth(
        `${classInfo}  |  Version ${version}  |  ${totalQuestions} items`,
        maxHeaderWidth,
        9.0,
        font
    );
    page.drawText(subText, {
        x: headerTextX,
        y: subtitleY,
        size: 9.0,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    const nameY = Math.min(startY - 62, subtitleY - 12);
    page.drawText('Last Name: ___________________________, First Name: ___________________________, Middle Name: ___________________________', {
        x: MARGINS.left,
        y: nameY,
        size: 8.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    const dateY = nameY - 11;
    page.drawText('Date: ___________________________________, Section: ___________________________________', {
        x: MARGINS.left,
        y: dateY,
        size: 8.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    const instY = dateY - 11;
    page.drawText(
        'Use DARK INK and CAPITAL LETTERS. One answer per box, kept inside the box. Do not fold this sheet or cover the black squares in the corners.',
        {
            x: MARGINS.left,
            y: instY,
            size: 7.2,
            font,
            color: rgb(0.25, 0.25, 0.25),
        }
    );

    page.drawLine({
        start: { x: MARGINS.left, y: instY - 6 },
        end: { x: width - MARGINS.right, y: instY - 6 },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.85),
    });

    return instY - 12;
}

function drawContinuationSheetHeader(
    page: PDFPage,
    ctx: SheetContext
): number {
    const { width, height, font, fontBold, version, quizId } = ctx;
    const startY = height - MARGINS.top - 4;
    const headerTextX = MARGINS.left + 24;
    const qrX = width - MARGINS.right - 24 - QR_CODE_CONFIG.size;
    const maxHeaderWidth = Math.max(120, qrX - headerTextX - 12);

    page.drawText(
        truncateTextToWidth('TSEKI SMART ASSESSMENT SYSTEM | ANSWER SHEET (CONTINUED)', maxHeaderWidth, 8.5, fontBold),
        {
            x: headerTextX,
            y: startY - 10,
            size: 8.5,
            font: fontBold,
            color: rgb(0.35, 0.38, 0.44),
        }
    );

    const contSub = truncateTextToWidth(
        `${quizId}  |  Version ${version}  |  Sheet 2 of 2`,
        maxHeaderWidth,
        10.5,
        fontBold
    );
    page.drawText(contSub, {
        x: headerTextX,
        y: startY - 26,
        size: 10.5,
        font: fontBold,
        color: rgb(0.1, 0.12, 0.16),
    });

    const nameY = startY - QR_CODE_CONFIG.size - 6;
    page.drawText('Last Name: ___________________________, First Name: ___________________________, Middle Name: ___________________________', {
        x: MARGINS.left,
        y: nameY,
        size: 8.0,
        font,
        color: rgb(0.2, 0.2, 0.2),
    });

    const sepY = nameY - 8;
    page.drawLine({
        start: { x: MARGINS.left, y: sepY },
        end: { x: width - MARGINS.right, y: sepY },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.85),
    });

    return sepY - 12;
}

function ensureSheetSpace(
    pageStates: PageState[],
    ctx: SheetContext,
    neededHeight: number
): PageState {
    const current = pageStates[pageStates.length - 1];
    const bottomLimit = MARGINS.bottom + 22;

    if (current.cursorY - neededHeight >= bottomLimit || pageStates.length >= 2) {
        return current;
    }

    const page2 = ctx.doc.addPage([ctx.width, ctx.height]);
    const markers2 = drawCornerMarkers(page2, ctx.width, ctx.height);
    const cursorY2 = drawContinuationSheetHeader(page2, ctx);

    const state2: PageState = {
        pdfPage: page2,
        pageNumber: 2,
        markers: markers2,
        items: [],
        cursorY: cursorY2,
    };
    pageStates.push(state2);
    return state2;
}

interface AnswerSheetDensity {
    letterCols: number;
    letterWidth: number;
    letterSpacingX: number;
    letterHeight: number;
    letterNumHeight: number;
    letterInputHeight: number;
    letterSpacingY: number;
    textBoxHeight: number;
    textSpacingY: number;
    enumBoxHeight: number;
    enumSpacingY: number;
    sectionGap: number;
}

interface AnswerSheetLayoutPlan {
    density: AnswerSheetDensity;
    enumCols: 1 | 2 | 3;
    stackPairedTextFullWidth: boolean;
    singleTextFullWidth: boolean;
}

const SHEET_DENSITIES: AnswerSheetDensity[] = [
    // Spacious: utilizes Long Bond (8.5x13") or lighter Short Bond quizzes with roomy handwriting boxes
    {
        letterCols: 10,
        letterWidth: 44,
        letterSpacingX: 11,
        letterHeight: 29,
        letterNumHeight: 10.0,
        letterInputHeight: 19.0,
        letterSpacingY: 6.5,
        textBoxHeight: 22.5,
        textSpacingY: 5.5,
        enumBoxHeight: 21.5,
        enumSpacingY: 5.0,
        sectionGap: 10,
    },
    // Normal: standard 10-col letter grid, comfortable text/enum boxes
    {
        letterCols: 10,
        letterWidth: 44,
        letterSpacingX: 11,
        letterHeight: 27,
        letterNumHeight: 9.5,
        letterInputHeight: 17.5,
        letterSpacingY: 6,
        textBoxHeight: 20,
        textSpacingY: 5,
        enumBoxHeight: 19,
        enumSpacingY: 4,
        sectionGap: 8,
    },
    // Compact: 12-col letter grid, tighter vertical spacing
    {
        letterCols: 12,
        letterWidth: 36,
        letterSpacingX: 9.8,
        letterHeight: 25,
        letterNumHeight: 8.5,
        letterInputHeight: 16.5,
        letterSpacingY: 5,
        textBoxHeight: 18,
        textSpacingY: 3.5,
        enumBoxHeight: 17.5,
        enumSpacingY: 3.5,
        sectionGap: 6,
    },
    // Dense: 15-col letter grid (fits 50 items cleanly on 1 short sheet)
    {
        letterCols: 15,
        letterWidth: 29,
        letterSpacingX: 7.5,
        letterHeight: 23.5,
        letterNumHeight: 8.0,
        letterInputHeight: 15.5,
        letterSpacingY: 4,
        textBoxHeight: 16.5,
        textSpacingY: 3,
        enumBoxHeight: 16.5,
        enumSpacingY: 3,
        sectionGap: 5,
    },
];

interface EnumSubBoxItem {
    qNum: number;
    subIdx: number;
    maxChars: number;
}

/**
 * Packs enumeration sub-boxes into `numCols` columns while keeping each question's
 * sub-boxes (e.g. 37.1, 37.2, 37.3) grouped together in the same column whenever
 * doing so adds at most 1 row compared to an even split.
 */
function partitionEnumerationColumns(
    questions: ScannableQuestion[],
    numCols: 1 | 2 | 3,
    answerKey?: AnswerKeyItem[]
): EnumSubBoxItem[][] {
    const groups: EnumSubBoxItem[][] = [];
    const flat: EnumSubBoxItem[] = [];

    for (const q of questions) {
        const count = getEnumerationBoxCount(q, answerKey);
        const stats = getExpectedAnswerStats(q, answerKey);
        const group: EnumSubBoxItem[] = [];
        for (let sub = 1; sub <= count; sub++) {
            const item: EnumSubBoxItem = { qNum: q.questionNumber, subIdx: sub, maxChars: stats.maxChars };
            group.push(item);
            flat.push(item);
        }
        groups.push(group);
    }

    if (numCols === 1 || flat.length === 0) {
        return [flat];
    }

    const idealPerCol = Math.ceil(flat.length / numCols);
    // Greedy sequential bin-packing of whole questions
    const groupedCols: EnumSubBoxItem[][] = Array.from({ length: numCols }, () => []);
    let colIdx = 0;
    let remainingItems = flat.length;

    for (let g = 0; g < groups.length; g++) {
        const grp = groups[g];
        const colsLeft = numCols - colIdx;
        const targetForThisCol = Math.ceil(remainingItems / colsLeft);
        if (
            groupedCols[colIdx].length > 0 &&
            colIdx < numCols - 1 &&
            groupedCols[colIdx].length + grp.length > targetForThisCol + 1
        ) {
            colIdx += 1;
        }
        groupedCols[colIdx].push(...grp);
        remainingItems -= grp.length;
    }

    const groupedMaxRows = Math.max(...groupedCols.map((c) => c.length));
    if (groupedMaxRows <= idealPerCol + 1) {
        return groupedCols;
    }

    // Fallback to even slicing if a single question has very many sub-boxes
    const evenCols: EnumSubBoxItem[][] = [];
    for (let c = 0; c < numCols; c++) {
        evenCols.push(flat.slice(c * idealPerCol, (c + 1) * idealPerCol));
    }
    return evenCols;
}

function estimateSheetPlanHeight(
    byType: Map<ScannableQuestion['type'], ScannableQuestion[]>,
    seenTypes: ScannableQuestion['type'][],
    plan: AnswerSheetLayoutPlan,
    answerKey?: AnswerKeyItem[]
): number {
    const d = plan.density;
    let total = 0;
    const processed = new Set<ScannableQuestion['type']>();

    for (const qType of seenTypes) {
        if (processed.has(qType)) continue;
        if (qType === 'multiple_choice' || qType === 'true_false' || qType === 'word_box') {
            processed.add(qType);
            const items = byType.get(qType) || [];
            const rows = Math.ceil(items.length / d.letterCols);
            total += 21 + rows * (d.letterHeight + d.letterSpacingY) + d.sectionGap;
        } else if (qType === 'fill_blank' || qType === 'identification') {
            const fb = !processed.has('fill_blank') ? (byType.get('fill_blank') || []) : [];
            const id = !processed.has('identification') ? (byType.get('identification') || []) : [];
            processed.add('fill_blank');
            processed.add('identification');

            if (fb.length > 0 && id.length > 0) {
                if (plan.stackPairedTextFullWidth) {
                    total +=
                        21 + fb.length * (d.textBoxHeight + d.textSpacingY) + d.sectionGap +
                        21 + id.length * (d.textBoxHeight + d.textSpacingY) + d.sectionGap;
                } else {
                    const maxRows = Math.max(fb.length, id.length);
                    total += 21 + maxRows * (d.textBoxHeight + d.textSpacingY) + d.sectionGap;
                }
            } else {
                const singleCount = Math.max(fb.length, id.length);
                const rows = plan.singleTextFullWidth ? singleCount : Math.ceil(singleCount / 2);
                total += 21 + rows * (d.textBoxHeight + d.textSpacingY) + d.sectionGap;
            }
        } else if (qType === 'enumeration') {
            processed.add('enumeration');
            const en = byType.get('enumeration') || [];
            const cols = partitionEnumerationColumns(en, plan.enumCols, answerKey);
            const maxRows = Math.max(1, ...cols.map((c) => c.length));
            total += 21 + maxRows * (d.enumBoxHeight + d.enumSpacingY) + d.sectionGap;
        }
    }

    return total;
}

function selectOptimalSheetPlan(
    byType: Map<ScannableQuestion['type'], ScannableQuestion[]>,
    seenTypes: ScannableQuestion['type'][],
    page1Available: number,
    answerKey?: AnswerKeyItem[]
): AnswerSheetLayoutPlan {
    const fb = byType.get('fill_blank') || [];
    const id = byType.get('identification') || [];
    const en = byType.get('enumeration') || [];

    const maxTextLen = [...fb, ...id].reduce((mx, q) => {
        const st = getExpectedAnswerStats(q, answerKey);
        return st.hasExplicitAnswer ? Math.max(mx, st.longestChars) : mx;
    }, 0);

    const maxEnumLen = en.reduce((mx, q) => {
        const st = getExpectedAnswerStats(q, answerKey);
        return st.hasExplicitAnswer ? Math.max(mx, st.longestChars) : mx;
    }, 0);

    const totalEnumBoxes = en.reduce((sum, q) => sum + getEnumerationBoxCount(q, answerKey), 0);
    const singleTextCount = Math.max(fb.length, id.length);
    const hasLongText = maxTextLen > 20;

    // Candidate enumeration column counts ordered from widest/most readable to most compact
    let enumColCandidates: (1 | 2 | 3)[];
    if (en.length === 0) {
        enumColCandidates = [2];
    } else if (maxEnumLen > 24 || totalEnumBoxes <= 4) {
        enumColCandidates = [1, 2, 3];
    } else if (maxEnumLen > 14 || totalEnumBoxes <= 16) {
        enumColCandidates = [2, 3];
    } else {
        enumColCandidates = [2, 3];
    }

    const singleTextCandidates =
        singleTextCount <= 8
            ? [true]
            : hasLongText
                ? [true, false]
                : [false];

    const stackPairedCandidates =
        fb.length > 0 && id.length > 0 && hasLongText
            ? [true, false]
            : [false];

    // Try roomiest density & widest box columns first so Short & Long bond both maximize readability
    for (const density of SHEET_DENSITIES) {
        for (const stackPairedTextFullWidth of stackPairedCandidates) {
            for (const singleTextFullWidth of singleTextCandidates) {
                for (const enumCols of enumColCandidates) {
                    const candidate: AnswerSheetLayoutPlan = {
                        density,
                        enumCols,
                        stackPairedTextFullWidth,
                        singleTextFullWidth,
                    };
                    if (estimateSheetPlanHeight(byType, seenTypes, candidate, answerKey) <= page1Available) {
                        return candidate;
                    }
                }
            }
        }
    }

    // Overflow fallback (will cleanly use Sheet 2 of 2 while still keeping wide boxes for long answers)
    return {
        density: SHEET_DENSITIES[SHEET_DENSITIES.length - 1],
        enumCols: maxEnumLen > 24 ? 1 : maxEnumLen > 14 ? 2 : 3,
        stackPairedTextFullWidth: false,
        singleTextFullWidth: singleTextCount <= 8,
    };
}

function drawAnswerSections(
    pageStates: PageState[],
    ctx: SheetContext,
    questions: ScannableQuestion[]
): void {
    const { printableWidth, font, fontBold } = ctx;
    const answerKey = ctx.options.answerKey;

    const seenTypes: ScannableQuestion['type'][] = [];
    const byType = new Map<ScannableQuestion['type'], ScannableQuestion[]>();
    for (const q of questions) {
        if (!byType.has(q.type)) {
            seenTypes.push(q.type);
            byType.set(q.type, []);
        }
        byType.get(q.type)!.push(q);
    }

    const page1Available = pageStates[0].cursorY - (MARGINS.bottom + 22);
    const plan = selectOptimalSheetPlan(byType, seenTypes, page1Available, answerKey);
    const density = plan.density;

    let sectionNum = 1;
    const processed = new Set<ScannableQuestion['type']>();

    for (const qType of seenTypes) {
        if (processed.has(qType)) continue;

        if (qType === 'multiple_choice') {
            processed.add('multiple_choice');
            const mc = byType.get('multiple_choice')!;
            const rows = Math.ceil(mc.length / density.letterCols);
            const needed = 21 + rows * (density.letterHeight + density.letterSpacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const title = `${toRoman(sectionNum++)}. MULTIPLE CHOICE (items ${mc[0].questionNumber}-${mc[mc.length - 1].questionNumber}) - write A, B, C or D`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(st.pdfPage, MARGINS.left, st.cursorY, mc, font, fontBold, 'letter', st.items, ctx.height, density);
            st.cursorY -= density.sectionGap;
        } else if (qType === 'true_false') {
            processed.add('true_false');
            const tf = byType.get('true_false')!;
            const rows = Math.ceil(tf.length / density.letterCols);
            const needed = 21 + rows * (density.letterHeight + density.letterSpacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const title = `${toRoman(sectionNum++)}. TRUE OR FALSE (items ${tf[0].questionNumber}-${tf[tf.length - 1].questionNumber}) - write T or F`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(st.pdfPage, MARGINS.left, st.cursorY, tf, font, fontBold, 'tf', st.items, ctx.height, density);
            st.cursorY -= density.sectionGap;
        } else if (qType === 'word_box') {
            processed.add('word_box');
            const wb = byType.get('word_box')!;
            const sharedWordBank = extractSharedWordBank(questions, answerKey);
            const wordBoxMaxChars = getWordBankMaxChars(sharedWordBank.length);
            const rows = Math.ceil(wb.length / density.letterCols);
            const needed = 21 + rows * (density.letterHeight + density.letterSpacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const letterPrompt = wordBoxMaxChars > 1 ? 'LETTER(S)' : 'LETTER';
            const title = `${toRoman(sectionNum++)}. WORD BOX (items ${wb[0].questionNumber}-${wb[wb.length - 1].questionNumber}) - write the ${letterPrompt} from the word bank`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(
                st.pdfPage,
                MARGINS.left,
                st.cursorY,
                wb,
                font,
                fontBold,
                'word_box',
                st.items,
                ctx.height,
                density,
                wordBoxMaxChars
            );
            st.cursorY -= density.sectionGap;
        } else if (qType === 'fill_blank' || qType === 'identification') {
            const fb = !processed.has('fill_blank') ? (byType.get('fill_blank') || []) : [];
            const id = !processed.has('identification') ? (byType.get('identification') || []) : [];
            processed.add('fill_blank');
            processed.add('identification');

            const halfColWidth = (printableWidth - 16) / 2;
            const col1X = MARGINS.left;
            const col2X = MARGINS.left + halfColWidth + 16;

            if (fb.length > 0 && id.length > 0) {
                if (plan.stackPairedTextFullWidth) {
                    const firstList = qType === 'fill_blank' ? fb : id;
                    const firstLabel = qType === 'fill_blank' ? 'FILL IN THE BLANK' : 'IDENTIFICATION';
                    const secondList = qType === 'fill_blank' ? id : fb;
                    const secondLabel = qType === 'fill_blank' ? 'IDENTIFICATION' : 'FILL IN THE BLANK';

                    for (const [list, lbl] of [
                        [firstList, firstLabel],
                        [secondList, secondLabel],
                    ] as const) {
                        const needed = 21 + list.length * (density.textBoxHeight + density.textSpacingY);
                        const st = ensureSheetSpace(pageStates, ctx, needed);
                        const title = `${toRoman(sectionNum++)}. ${lbl} (${list[0].questionNumber}-${list[list.length - 1].questionNumber})`;
                        st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
                        st.cursorY = drawTextBoxColumn(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, list, font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                        st.cursorY -= density.sectionGap;
                    }
                } else {
                    const maxRows = Math.max(fb.length, id.length);
                    const needed = 21 + maxRows * (density.textBoxHeight + density.textSpacingY);
                    const st = ensureSheetSpace(pageStates, ctx, needed);

                    let leftBottomY = st.cursorY;
                    let rightBottomY = st.cursorY;

                    if (qType === 'fill_blank') {
                        const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                        leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, halfColWidth, fbTitle, fontBold);
                        leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, halfColWidth, fb, font, fontBold, 'text', st.items, ctx.height, density, answerKey);

                        const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                        rightBottomY = drawSectionBanner(st.pdfPage, col2X, st.cursorY, halfColWidth, idTitle, fontBold);
                        rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, rightBottomY, halfColWidth, id, font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                    } else {
                        const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                        leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, halfColWidth, idTitle, fontBold);
                        leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, halfColWidth, id, font, fontBold, 'text', st.items, ctx.height, density, answerKey);

                        const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                        rightBottomY = drawSectionBanner(st.pdfPage, col2X, st.cursorY, halfColWidth, fbTitle, fontBold);
                        rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, rightBottomY, halfColWidth, fb, font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                    }

                    st.cursorY = Math.min(leftBottomY, rightBottomY) - density.sectionGap;
                }
            } else {
                const singleList = fb.length > 0 ? fb : id;
                const label = fb.length > 0 ? 'FILL IN THE BLANK' : 'IDENTIFICATION';
                const useTwoCols = !plan.singleTextFullWidth;
                const rows = useTwoCols ? Math.ceil(singleList.length / 2) : singleList.length;
                const needed = 21 + rows * (density.textBoxHeight + density.textSpacingY);
                const st = ensureSheetSpace(pageStates, ctx, needed);

                const bannerTitle = `${toRoman(sectionNum++)}. ${label} (${singleList[0].questionNumber}-${singleList[singleList.length - 1].questionNumber})`;
                // Always span the full printableWidth (540pt) so 1-column Identification gets full-width boxes (~516pt)!
                const contentStartY = drawSectionBanner(
                    st.pdfPage,
                    MARGINS.left,
                    st.cursorY,
                    printableWidth,
                    bannerTitle,
                    fontBold
                );

                if (useTwoCols) {
                    const half = Math.ceil(singleList.length / 2);
                    const leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, contentStartY, halfColWidth, singleList.slice(0, half), font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                    const rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, contentStartY, halfColWidth, singleList.slice(half), font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                    st.cursorY = Math.min(leftBottomY, rightBottomY) - density.sectionGap;
                } else {
                    const bottomY = drawTextBoxColumn(st.pdfPage, col1X, contentStartY, printableWidth, singleList, font, fontBold, 'text', st.items, ctx.height, density, answerKey);
                    st.cursorY = bottomY - density.sectionGap;
                }
            }
        } else if (qType === 'enumeration') {
            processed.add('enumeration');
            const en = byType.get('enumeration')!;
            const enumColsData = partitionEnumerationColumns(en, plan.enumCols, answerKey);
            const rowsPerCol = Math.max(1, ...enumColsData.map((c) => c.length));
            const needed = 21 + rowsPerCol * (density.enumBoxHeight + density.enumSpacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);

            const title = `${toRoman(sectionNum++)}. ENUMERATION (${en[0].questionNumber}-${en[en.length - 1].questionNumber}) - one answer per box`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawEnumerationSection(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, enumColsData, font, fontBold, st.items, ctx.height, density);
            st.cursorY -= density.sectionGap;
        }
    }
}

function drawSectionBanner(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    title: string,
    fontBold: PDFFont
): number {
    const bannerHeight = 15;

    page.drawRectangle({
        x,
        y: y - bannerHeight,
        width,
        height: bannerHeight,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    page.drawText(truncateTextToWidth(title, width - 12, 8.5, fontBold), {
        x: x + 6,
        y: y - bannerHeight + 4.5,
        size: 8.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    return y - bannerHeight - 6;
}

function drawLetterGrid(
    page: PDFPage,
    startX: number,
    startY: number,
    questions: ScannableQuestion[],
    _font: PDFFont,
    fontBold: PDFFont,
    itemType: 'letter' | 'tf' | 'word_box',
    layoutItems: LayoutItem[],
    pageHeight: number,
    density: AnswerSheetDensity,
    maxChars: number = 1
): number {
    let col = 0;
    let rowY = startY;

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const boxX = startX + col * (density.letterWidth + density.letterSpacingX);
        const boxY = rowY - density.letterHeight;

        page.drawRectangle({
            x: boxX,
            y: boxY + density.letterInputHeight,
            width: density.letterWidth,
            height: density.letterNumHeight,
            color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
            borderColor: rgb(COLORS.borderGray[0], COLORS.borderGray[1], COLORS.borderGray[2]),
            borderWidth: 0.6,
        });

        const numText = `${q.questionNumber}`;
        const numSize = density.letterCols >= 15 ? 7.0 : 7.5;
        const numW = fontBold.widthOfTextAtSize(numText, numSize);
        page.drawText(numText, {
            x: boxX + (density.letterWidth - numW) / 2,
            y: boxY + density.letterInputHeight + 1.8,
            size: numSize,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
        });

        page.drawRectangle({
            x: boxX,
            y: boxY,
            width: density.letterWidth,
            height: density.letterInputHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.15, 0.15, 0.15),
            borderWidth: 0.8,
        });

        layoutItems.push({
            questionNumber: q.questionNumber,
            type: itemType,
            rect: {
                x: boxX,
                y: topY(boxY, density.letterInputHeight, pageHeight),
                width: density.letterWidth,
                height: density.letterInputHeight,
            },
            maxChars,
        });

        col++;
        if (col >= density.letterCols) {
            col = 0;
            rowY -= (density.letterHeight + density.letterSpacingY);
        }
    }

    return col === 0 ? rowY : rowY - density.letterHeight - density.letterSpacingY;
}

function drawTextBoxColumn(
    page: PDFPage,
    startX: number,
    startY: number,
    colWidth: number,
    questions: ScannableQuestion[],
    _font: PDFFont,
    fontBold: PDFFont,
    itemType: 'text',
    layoutItems: LayoutItem[],
    pageHeight: number,
    density: AnswerSheetDensity,
    answerKey?: AnswerKeyItem[]
): number {
    const boxHeight = density.textBoxHeight;
    const numWidth = 24;
    const spacingY = density.textSpacingY;
    const numFontSize = boxHeight <= 17 ? 7.2 : 8.0;

    let cursorY = startY;

    for (const q of questions) {
        const boxY = cursorY - boxHeight;
        const stats = getExpectedAnswerStats(q, answerKey);

        page.drawRectangle({
            x: startX,
            y: boxY,
            width: numWidth,
            height: boxHeight,
            color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
            borderColor: rgb(0.3, 0.3, 0.3),
            borderWidth: 0.8,
        });

        const numText = `${q.questionNumber}`;
        const numW = fontBold.widthOfTextAtSize(numText, numFontSize);
        page.drawText(numText, {
            x: startX + (numWidth - numW) / 2,
            y: boxY + (boxHeight - numFontSize) / 2 + 1,
            size: numFontSize,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
        });

        const inputWidth = colWidth - numWidth;
        const inputX = startX + numWidth;

        page.drawRectangle({
            x: inputX,
            y: boxY,
            width: inputWidth,
            height: boxHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.2, 0.2, 0.2),
            borderWidth: 0.8,
        });

        layoutItems.push({
            questionNumber: q.questionNumber,
            type: itemType,
            rect: {
                x: inputX,
                y: topY(boxY, boxHeight, pageHeight),
                width: inputWidth,
                height: boxHeight,
            },
            maxChars: stats.maxChars,
        });

        cursorY -= (boxHeight + spacingY);
    }

    return cursorY;
}

function drawEnumerationSection(
    page: PDFPage,
    startX: number,
    startY: number,
    totalWidth: number,
    cols: EnumSubBoxItem[][],
    _font: PDFFont,
    fontBold: PDFFont,
    layoutItems: LayoutItem[],
    pageHeight: number,
    density: AnswerSheetDensity
): number {
    const numCols = Math.max(1, cols.length);
    const colSpacing = numCols === 1 ? 0 : numCols === 2 ? 16 : 12;
    const colWidth = (totalWidth - colSpacing * (numCols - 1)) / numCols;
    const boxHeight = density.enumBoxHeight;
    const numWidth = 32;
    const spacingY = density.enumSpacingY;
    const badgeFontSize = boxHeight <= 17 ? 7.0 : 7.5;

    let maxBottomY = startY;

    for (let c = 0; c < numCols; c++) {
        const colItems = cols[c] || [];
        const colX = startX + c * (colWidth + colSpacing);
        let cursorY = startY;

        for (const item of colItems) {
            const boxY = cursorY - boxHeight;

            page.drawRectangle({
                x: colX,
                y: boxY,
                width: numWidth,
                height: boxHeight,
                color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
                borderColor: rgb(0.3, 0.3, 0.3),
                borderWidth: 0.8,
            });

            const badgeText = `${item.qNum}.${item.subIdx}`;
            const badgeW = fontBold.widthOfTextAtSize(badgeText, badgeFontSize);
            page.drawText(badgeText, {
                x: colX + (numWidth - badgeW) / 2,
                y: boxY + (boxHeight - badgeFontSize) / 2 + 1,
                size: badgeFontSize,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1),
            });

            const inputX = colX + numWidth;
            const inputWidth = colWidth - numWidth;

            page.drawRectangle({
                x: inputX,
                y: boxY,
                width: inputWidth,
                height: boxHeight,
                color: rgb(1, 1, 1),
                borderColor: rgb(0.2, 0.2, 0.2),
                borderWidth: 0.8,
            });

            layoutItems.push({
                questionNumber: item.qNum,
                subIndex: item.subIdx,
                type: 'text',
                rect: {
                    x: inputX,
                    y: topY(boxY, boxHeight, pageHeight),
                    width: inputWidth,
                    height: boxHeight,
                },
                maxChars: item.maxChars,
            });

            cursorY -= (boxHeight + spacingY);
        }

        if (cursorY < maxBottomY) {
            maxBottomY = cursorY;
        }
    }

    return maxBottomY;
}

function drawAnswerSheetFooter(
    page: PDFPage,
    ctx: SheetContext,
    sheetNum: number,
    totalSheets: number
): void {
    const { width, version, totalPoints, font, totalQuestions } = ctx;
    const y = MARGINS.bottom;

    const leftText = `Tseki Vision Grader Answer Sheet  |  ${totalQuestions} items  |  ${totalPoints} points  |  Version ${version}`;
    page.drawText(leftText, {
        x: MARGINS.left + 24,
        y,
        size: 7.8,
        font,
        color: rgb(0.35, 0.35, 0.35),
    });

    const rightText = `Do not fold  |  Sheet ${sheetNum} of ${totalSheets}`;
    const rightW = font.widthOfTextAtSize(rightText, 7.8);
    page.drawText(rightText, {
        x: width - MARGINS.right - 24 - rightW,
        y,
        size: 7.8,
        font,
        color: rgb(0.35, 0.35, 0.35),
    });
}

function toRoman(num: number): string {
    const map = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return map[num - 1] || `${num}`;
}
