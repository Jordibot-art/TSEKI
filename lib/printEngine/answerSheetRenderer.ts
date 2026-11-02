// lib/printEngine/answerSheetRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { ANSWER_BOX_CONFIG, COLORS, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import { getMeasureBoldFont, getMeasureFont } from './measure';
import { drawQRCode } from './qrStamp';
import { LayoutItem, LayoutPage, MarkerRect, PrintOptions, QRRect, ScannableQuestion } from './types';

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
        const embedded = await embedPrintFonts(doc);
        font = embedded.regular;
        fontBold = embedded.bold;
    }

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

    // Small system title
    page.drawText('TSEKI SMART ASSESSMENT SYSTEM | ANSWER SHEET', {
        x: MARGINS.left + 24, // slightly indented from corner marker
        y: startY - 8,
        size: 8.5,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    // Title
    const title = options.quizId ? `Assessment: ${options.quizId}` : 'Class Assessment';
    page.drawText(title, {
        x: MARGINS.left + 24,
        y: startY - 26,
        size: 14.5,
        font: fontBold,
        color: rgb(0.1, 0.12, 0.16),
    });

    // Subtitle
    const classInfo = options.classTitle || 'BSIT-4';
    const subText = `${classInfo}  |  Version ${version}  |  ${totalQuestions} items`;
    page.drawText(subText, {
        x: MARGINS.left + 24,
        y: startY - 41,
        size: 9.0,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

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

    // Student Information line (below 56pt QR code)
    const infoY = startY - 64;
    page.drawText('Name: _____________________________________________   Date: ________________   Section: ____________', {
        x: MARGINS.left,
        y: infoY,
        size: 8.5,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    // Dark ink instructions
    const instY = infoY - 14;
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
        start: { x: MARGINS.left, y: instY - 8 },
        end: { x: width - MARGINS.right, y: instY - 8 },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.85),
    });

    return instY - 16;
}

function drawContinuationSheetHeader(
    page: PDFPage,
    ctx: SheetContext
): number {
    const { width, height, font, fontBold, version, quizId } = ctx;
    const startY = height - MARGINS.top - 4;

    page.drawText('TSEKI SMART ASSESSMENT SYSTEM | ANSWER SHEET (CONTINUED)', {
        x: MARGINS.left + 24,
        y: startY - 10,
        size: 8.5,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    page.drawText(`${quizId}  |  Version ${version}  |  Sheet 2 of 2`, {
        x: MARGINS.left + 24,
        y: startY - 26,
        size: 10.5,
        font: fontBold,
        color: rgb(0.1, 0.12, 0.16),
    });

    page.drawText('Name: _____________________________________________', {
        x: MARGINS.left + 24,
        y: startY - 44,
        size: 8.5,
        font,
        color: rgb(0.2, 0.2, 0.2),
    });

    const sepY = startY - QR_CODE_CONFIG.size - 8;
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

function drawAnswerSections(
    pageStates: PageState[],
    ctx: SheetContext,
    questions: ScannableQuestion[]
): void {
    const { printableWidth, font, fontBold } = ctx;

    // Group questions into distinct type buckets in order of first appearance (preserving tick order)
    const seenTypes: ScannableQuestion['type'][] = [];
    const byType = new Map<ScannableQuestion['type'], ScannableQuestion[]>();
    for (const q of questions) {
        if (!byType.has(q.type)) {
            seenTypes.push(q.type);
            byType.set(q.type, []);
        }
        byType.get(q.type)!.push(q);
    }

    let sectionNum = 1;
    const processed = new Set<ScannableQuestion['type']>();

    for (const qType of seenTypes) {
        if (processed.has(qType)) continue;

        if (qType === 'multiple_choice') {
            processed.add('multiple_choice');
            const mc = byType.get('multiple_choice')!;
            const rows = Math.ceil(mc.length / ANSWER_BOX_CONFIG.letter.maxCols);
            const needed = 21 + rows * (ANSWER_BOX_CONFIG.letter.height + ANSWER_BOX_CONFIG.letter.spacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const title = `${toRoman(sectionNum++)}. MULTIPLE CHOICE (items ${mc[0].questionNumber}-${mc[mc.length - 1].questionNumber}) - write A, B, C or D`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(st.pdfPage, MARGINS.left, st.cursorY, mc, font, fontBold, 'letter', st.items, ctx.height);
            st.cursorY -= 8;
        } else if (qType === 'true_false') {
            processed.add('true_false');
            const tf = byType.get('true_false')!;
            const rows = Math.ceil(tf.length / ANSWER_BOX_CONFIG.letter.maxCols);
            const needed = 21 + rows * (ANSWER_BOX_CONFIG.letter.height + ANSWER_BOX_CONFIG.letter.spacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const title = `${toRoman(sectionNum++)}. TRUE OR FALSE (items ${tf[0].questionNumber}-${tf[tf.length - 1].questionNumber}) - write T or F`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(st.pdfPage, MARGINS.left, st.cursorY, tf, font, fontBold, 'tf', st.items, ctx.height);
            st.cursorY -= 8;
        } else if (qType === 'word_box') {
            processed.add('word_box');
            const wb = byType.get('word_box')!;
            const rows = Math.ceil(wb.length / ANSWER_BOX_CONFIG.letter.maxCols);
            const needed = 21 + rows * (ANSWER_BOX_CONFIG.letter.height + ANSWER_BOX_CONFIG.letter.spacingY);
            const st = ensureSheetSpace(pageStates, ctx, needed);
            const title = `${toRoman(sectionNum++)}. WORD BOX (items ${wb[0].questionNumber}-${wb[wb.length - 1].questionNumber}) - write the LETTER from the word bank`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawLetterGrid(st.pdfPage, MARGINS.left, st.cursorY, wb, font, fontBold, 'word_box', st.items, ctx.height);
            st.cursorY -= 8;
        } else if (qType === 'fill_blank' || qType === 'identification') {
            // Pair fill_blank and identification side-by-side in 2 columns if both exist
            const fb = !processed.has('fill_blank') ? (byType.get('fill_blank') || []) : [];
            const id = !processed.has('identification') ? (byType.get('identification') || []) : [];
            processed.add('fill_blank');
            processed.add('identification');

            const maxRows = Math.max(fb.length, id.length);
            const needed = 21 + maxRows * 25;
            const st = ensureSheetSpace(pageStates, ctx, needed);

            const colWidth = (printableWidth - 16) / 2;
            const col1X = MARGINS.left;
            const col2X = MARGINS.left + colWidth + 16;

            let leftBottomY = st.cursorY;
            let rightBottomY = st.cursorY;

            if (qType === 'fill_blank') {
                if (fb.length > 0) {
                    const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                    leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, colWidth, fbTitle, fontBold);
                    leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, colWidth, fb, font, fontBold, 'text', st.items, ctx.height);
                }
                if (id.length > 0) {
                    const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                    const rightColX = fb.length > 0 ? col2X : col1X;
                    rightBottomY = drawSectionBanner(st.pdfPage, rightColX, st.cursorY, colWidth, idTitle, fontBold);
                    rightBottomY = drawTextBoxColumn(st.pdfPage, rightColX, rightBottomY, colWidth, id, font, fontBold, 'text', st.items, ctx.height);
                }
            } else {
                // identification came first in tick order
                if (id.length > 0) {
                    const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
                    leftBottomY = drawSectionBanner(st.pdfPage, col1X, st.cursorY, colWidth, idTitle, fontBold);
                    leftBottomY = drawTextBoxColumn(st.pdfPage, col1X, leftBottomY, colWidth, id, font, fontBold, 'text', st.items, ctx.height);
                }
                if (fb.length > 0) {
                    const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
                    const rightColX = id.length > 0 ? col2X : col1X;
                    rightBottomY = drawSectionBanner(st.pdfPage, rightColX, st.cursorY, colWidth, fbTitle, fontBold);
                    rightBottomY = drawTextBoxColumn(st.pdfPage, rightColX, rightBottomY, colWidth, fb, font, fontBold, 'text', st.items, ctx.height);
                }
            }

            st.cursorY = Math.min(leftBottomY, rightBottomY) - 8;
        } else if (qType === 'enumeration') {
            processed.add('enumeration');
            const en = byType.get('enumeration')!;
            const totalSubBoxes = en.reduce((acc, q) => acc + (q.answerBoxesRequired || 3), 0);
            const rowsPerCol = Math.ceil(totalSubBoxes / 3);
            const needed = 21 + rowsPerCol * 23;
            const st = ensureSheetSpace(pageStates, ctx, needed);

            const title = `${toRoman(sectionNum++)}. ENUMERATION (${en[0].questionNumber}-${en[en.length - 1].questionNumber}) - one answer per box`;
            st.cursorY = drawSectionBanner(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, title, fontBold);
            st.cursorY = drawEnumerationSection(st.pdfPage, MARGINS.left, st.cursorY, printableWidth, en, font, fontBold, st.items, ctx.height);
            st.cursorY -= 8;
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

    page.drawText(title, {
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
    pageHeight: number
): number {
    const cfg = ANSWER_BOX_CONFIG.letter;
    let col = 0;
    let rowY = startY;

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const boxX = startX + col * (cfg.width + cfg.spacingX);
        const boxY = rowY - cfg.height;

        // Top number label cell
        page.drawRectangle({
            x: boxX,
            y: boxY + cfg.inputHeight,
            width: cfg.width,
            height: cfg.numHeight,
            color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
            borderColor: rgb(COLORS.borderGray[0], COLORS.borderGray[1], COLORS.borderGray[2]),
            borderWidth: 0.6,
        });

        const numText = `${q.questionNumber}`;
        const numW = fontBold.widthOfTextAtSize(numText, 7.5);
        page.drawText(numText, {
            x: boxX + (cfg.width - numW) / 2,
            y: boxY + cfg.inputHeight + 2.0,
            size: 7.5,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
        });

        // Bottom writing box (where student writes letter)
        page.drawRectangle({
            x: boxX,
            y: boxY,
            width: cfg.width,
            height: cfg.inputHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.15, 0.15, 0.15),
            borderWidth: 0.8,
        });

        // Record physical box coordinates for optical OCR / Grader (y measured from top of page)
        layoutItems.push({
            questionNumber: q.questionNumber,
            type: itemType,
            rect: {
                x: boxX,
                y: topY(boxY, cfg.inputHeight, pageHeight),
                width: cfg.width,
                height: cfg.inputHeight,
            },
            maxChars: 1,
        });

        col++;
        if (col >= cfg.maxCols) {
            col = 0;
            rowY -= (cfg.height + cfg.spacingY);
        }
    }

    return col === 0 ? rowY : rowY - cfg.height - cfg.spacingY;
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
    pageHeight: number
): number {
    const boxHeight = 20;
    const numWidth = 24;
    const spacingY = 5;

    let cursorY = startY;

    for (const q of questions) {
        const boxY = cursorY - boxHeight;

        // Left number badge
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
        const numW = fontBold.widthOfTextAtSize(numText, 8.0);
        page.drawText(numText, {
            x: startX + (numWidth - numW) / 2,
            y: boxY + 6.0,
            size: 8.0,
            font: fontBold,
            color: rgb(0.1, 0.1, 0.1),
        });

        // Right handwriting area
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
    pageHeight: number
): number {
    // 3 columns layout for enumeration items
    const colSpacing = 12;
    const colWidth = (totalWidth - colSpacing * 2) / 3;
    const boxHeight = 19;
    const numWidth = 32;
    const spacingY = 4;

    // Collect all sub-boxes needed
    const subBoxes: Array<{ qNum: number; subIdx: number }> = [];
    for (const q of questions) {
        const count = q.answerBoxesRequired || 3;
        for (let sub = 1; sub <= count; sub++) {
            subBoxes.push({ qNum: q.questionNumber, subIdx: sub });
        }
    }

    // Split sub-boxes across 3 columns
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

            // Sub-number badge: e.g. "37.1"
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
            const badgeW = fontBold.widthOfTextAtSize(badgeText, 7.5);
            page.drawText(badgeText, {
                x: colX + (numWidth - badgeW) / 2,
                y: boxY + 5.5,
                size: 7.5,
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
