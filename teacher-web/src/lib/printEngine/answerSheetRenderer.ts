// teacher-web/src/lib/printEngine/answerSheetRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { abortableDelay, throwIfExportAborted } from './cancel';
import { COLORS, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import {
    extractSharedWordBank,
    fitHeaderText,
    getMeasureBoldFont,
    getMeasureFont,
    getWordBankMaxChars,
    truncateTextToWidth,
} from './measure';
import { drawQRCode } from './qrStamp';
import type { LayoutItem, LayoutPage, MarkerRect, PrintOptions, QRRect, ScannableQuestion } from './types';

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
 * Enforces 1 page typical, hard max 2 pages ("Sheet 2 of 2") on overflow.
 * Collects pixel-precise top-origin coordinates for LayoutJSON.
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
        const textSample = [
            options.classTitle,
            options.subject,
            ...questions.map((q) => `${q.questionText || ''} ${(q.options || []).join(' ')}`),
        ].filter(Boolean).join('\n');
        const embedded = await embedPrintFonts(doc, textSample);
        font = embedded.regular;
        fontBold = embedded.bold;
    }
    throwIfExportAborted(options.signal);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${questions.length}`;

    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => {
        if (q.type === 'enumeration') {
            return sum + (q.answerBoxesRequired || 3);
        }
        return sum + 1;
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

    const startY = height - MARGINS.top - 4; // leave buffer from top markers
    const headerTextX = MARGINS.left + 24;

    // Score box on right (left of QR code)
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

    // Safe horizontal width strictly left of the SCORE box & QR code
    const maxHeaderWidth = Math.max(120, scoreBoxX - headerTextX - 12);

    // Small system title
    const eyebrowText = truncateTextToWidth(
        'TSEKI SMART ASSESSMENT SYSTEM | ANSWER SHEET',
        maxHeaderWidth,
        8.5,
        fontBold
    );
    page.drawText(eyebrowText, {
        x: headerTextX, // slightly indented from corner marker
        y: startY - 8,
        size: 8.5,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    // Title (auto-scales / wraps cleanly up to 2 lines strictly inside maxHeaderWidth)
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

    // Subtitle
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

    // Student Information lines (below 56pt QR code and wrapped subtitle)
    // Row 1: Last Name, First Name, Middle Name
    const nameY = Math.min(startY - 62, subtitleY - 12);
    page.drawText('Last Name: ___________________________, First Name: ___________________________, Middle Name: ___________________________', {
        x: MARGINS.left,
        y: nameY,
        size: 8.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    // Row 2: Date, Section
    const dateY = nameY - 11;
    page.drawText('Date: ___________________________________, Section: ___________________________________', {
        x: MARGINS.left,
        y: dateY,
        size: 8.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    // Dark ink instructions
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

    // Thin separator line
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

    // Keep full-width student name line cleanly below the 56pt QR code
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

    // Overflow to Page 2 (hard max 2 pages)
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

const SHEET_DENSITIES: AnswerSheetDensity[] = [
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

function estimateSheetSectionsHeight(
    byType: Map<ScannableQuestion['type'], ScannableQuestion[]>,
    seenTypes: ScannableQuestion['type'][],
    d: AnswerSheetDensity
): number {
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
            let maxRows: number;
            if (fb.length > 0 && id.length > 0) {
                maxRows = Math.max(fb.length, id.length);
            } else {
                const singleCount = Math.max(fb.length, id.length);
                maxRows = singleCount > 8 ? Math.ceil(singleCount / 2) : singleCount;
            }
            total += 21 + maxRows * (d.textBoxHeight + d.textSpacingY) + d.sectionGap;
        } else if (qType === 'enumeration') {
            processed.add('enumeration');
            const en = byType.get('enumeration') || [];
            const totalSubBoxes = en.reduce((acc, q) => acc + (q.answerBoxesRequired || 3), 0);
            const rowsPerCol = Math.ceil(totalSubBoxes / 3);
            total += 21 + rowsPerCol * (d.enumBoxHeight + d.enumSpacingY) + d.sectionGap;
        }
    }

    return total;
}

function drawAnswerSections(
    pageStates: PageState[],
    ctx: SheetContext,
    questions: ScannableQuestion[]
): void {
    const { printableWidth, font, fontBold } = ctx;

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
    let density = SHEET_DENSITIES[SHEET_DENSITIES.length - 1];
    for (const candidate of SHEET_DENSITIES) {
        if (estimateSheetSectionsHeight(byType, seenTypes, candidate) <= page1Available) {
            density = candidate;
            break;
        }
    }

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
            const sharedWordBank = extractSharedWordBank(questions);
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

            const colWidth = (printableWidth - 16) / 2;
            const col1X = MARGINS.left;
            const col2X = MARGINS.left + colWidth + 16;

            if (fb.length > 0 && id.length > 0) {
                const maxRows = Math.max(fb.length, id.length);
                const needed = 21 + maxRows * (density.textBoxHeight + density.textSpacingY);
                const st = ensureSheetSpace(pageStates, ctx, needed);

                let leftBottomY = st.cursorY;
                let rightBottomY = st.cursorY;

                if (qType === 'fill_blank') {
                    const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                    leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, colWidth, fbTitle, fontBold);
                    leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, colWidth, fb, font, fontBold, 'text', st.items, ctx.height, density);

                    const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                    rightBottomY = drawSectionBanner(st.pdfPage, col2X, st.cursorY, colWidth, idTitle, fontBold);
                    rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, rightBottomY, colWidth, id, font, fontBold, 'text', st.items, ctx.height, density);
                } else {
                    const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                    leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, colWidth, idTitle, fontBold);
                    leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, colWidth, id, font, fontBold, 'text', st.items, ctx.height, density);

                    const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                    rightBottomY = drawSectionBanner(st.pdfPage, col2X, st.cursorY, colWidth, fbTitle, fontBold);
                    rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, rightBottomY, colWidth, fb, font, fontBold, 'text', st.items, ctx.height, density);
                }

                st.cursorY = Math.min(leftBottomY, rightBottomY) - density.sectionGap;
            } else {
                const singleList = fb.length > 0 ? fb : id;
                const label = fb.length > 0 ? 'FILL IN THE BLANK' : 'IDENTIFICATION';
                const useTwoCols = singleList.length > 8;
                const rows = useTwoCols ? Math.ceil(singleList.length / 2) : singleList.length;
                const needed = 21 + rows * (density.textBoxHeight + density.textSpacingY);
                const st = ensureSheetSpace(pageStates, ctx, needed);

                const bannerTitle = `${toRoman(sectionNum++)}. ${label} (${singleList[0].questionNumber}-${singleList[singleList.length - 1].questionNumber})`;
                const contentStartY = drawSectionBanner(
                    st.pdfPage,
                    MARGINS.left,
                    st.cursorY,
                    useTwoCols ? printableWidth : colWidth,
                    bannerTitle,
                    fontBold
                );

                if (useTwoCols) {
                    const half = Math.ceil(singleList.length / 2);
                    const leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, contentStartY, colWidth, singleList.slice(0, half), font, fontBold, 'text', st.items, ctx.height, density);
                    const rightBottomY = drawTextBoxColumn(st.pdfPage, col2X, contentStartY, colWidth, singleList.slice(half), font, fontBold, 'text', st.items, ctx.height, density);
                    st.cursorY = Math.min(leftBottomY, rightBottomY) - density.sectionGap;
                } else {
                    const bottomY = drawTextBoxColumn(st.pdfPage, col1X, contentStartY, colWidth, singleList, font, fontBold, 'text', st.items, ctx.height, density);
                    st.cursorY = bottomY - density.sectionGap;
                }
            }
        } else if (qType === 'enumeration') {
            processed.add('enumeration');
            const en = byType.get('enumeration')!;
            const totalSubBoxes = en.reduce((acc, q) => acc + (q.answerBoxesRequired || 3), 0);
            const rowsPerCol = Math.ceil(totalSubBoxes / 3);
            const needed = 21 + rowsPerCol * (density.enumBoxHeight + density.enumSpacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);

            const title = `${toRoman(sectionNum++)}. ENUMERATION (${en[0].questionNumber}-${en[en.length - 1].questionNumber}) - one answer per box`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawEnumerationSection(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, en, font, fontBold, st.items, ctx.height, density);
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
    density: AnswerSheetDensity
): number {
    const boxHeight = density.textBoxHeight;
    const numWidth = 24;
    const spacingY = density.textSpacingY;
    const numFontSize = boxHeight <= 17 ? 7.2 : 8.0;

    let cursorY = startY;

    for (const q of questions) {
        const boxY = cursorY - boxHeight;

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
            maxChars: 25,
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
    questions: ScannableQuestion[],
    _font: PDFFont,
    fontBold: PDFFont,
    layoutItems: LayoutItem[],
    pageHeight: number,
    density: AnswerSheetDensity
): number {
    const colSpacing = 12;
    const colWidth = (totalWidth - colSpacing * 2) / 3;
    const boxHeight = density.enumBoxHeight;
    const numWidth = 32;
    const spacingY = density.enumSpacingY;
    const badgeFontSize = boxHeight <= 17 ? 7.0 : 7.5;

    const subBoxes: { qNum: number; subIdx: number }[] = [];
    for (const q of questions) {
        const count = q.answerBoxesRequired || 3;
        for (let sub = 1; sub <= count; sub++) {
            subBoxes.push({ qNum: q.questionNumber, subIdx: sub });
        }
    }

    const perCol = Math.ceil(subBoxes.length / 3);
    const cols = [
        subBoxes.slice(0, perCol),
        subBoxes.slice(perCol, perCol * 2),
        subBoxes.slice(perCol * 2),
    ];

    let maxBottomY = startY;

    for (let c = 0; c < 3; c++) {
        const colItems = cols[c];
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

            // Handwriting box
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
                maxChars: 25,
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
        x: MARGINS.left + 24, // buffer from bottom-left corner marker
        y,
        size: 7.8,
        font,
        color: rgb(0.35, 0.35, 0.35),
    });

    const rightText = `Do not fold  |  Sheet ${sheetNum} of ${totalSheets}`;
    const rightW = font.widthOfTextAtSize(rightText, 7.8);
    page.drawText(rightText, {
        x: width - MARGINS.right - 24 - rightW, // buffer from bottom-right corner marker
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
