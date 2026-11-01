import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { ANSWER_BOX_CONFIG, COLORS, MARGINS, PAPER_DIMENSIONS } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { drawCornerMarkers } from './markers';
import { drawQRCode } from './qrStamp';
import { LayoutItem, LayoutPage, PrintOptions, ScannableQuestion } from './types';

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
}

/**
 * Builds the physical scannable Answer Sheet PDF with corner registration squares,
 * QR stamp, student information lines, score box, and segmented answer boxes.
 * Collects pixel-precise coordinates for LayoutJSON.
 */
export async function renderAnswerSheetPDF(
    questions: ScannableQuestion[],
    options: PrintOptions = {}
): Promise<AnswerSheetRenderResult> {
    const doc = await PDFDocument.create();
    const { regular: font, bold: fontBold } = await embedPrintFonts(doc);

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
    };

    const layoutPages: LayoutPage[] = [];

    // Add page 1
    const page = doc.addPage([dims.width, dims.height]);

    // 1. Draw corner registration markers
    const markers = drawCornerMarkers(page, dims.width, dims.height);

    // 2. Draw Header
    const { cursorY: headerBottomY, qrPosition } = drawAnswerSheetHeader(page, sheetCtx, options, questions.length);

    // 3. Draw Answer Sections & collect layout items
    const layoutItems: LayoutItem[] = [];
    drawAnswerSections(page, sheetCtx, headerBottomY, questions, layoutItems);

    // 4. Draw Footer
    drawAnswerSheetFooter(page, sheetCtx, questions.length);

    layoutPages.push({
        pageNumber: 1,
        markers,
        qrPosition,
        items: layoutItems,
    });

    const pdfBytes = options.skipPdfSave ? new Uint8Array() : await doc.save();

    return {
        pdfBytes,
        pages: layoutPages,
    };
}

function drawAnswerSheetHeader(
    page: PDFPage,
    ctx: SheetContext,
    options: PrintOptions,
    itemCount: number
): { cursorY: number; qrPosition: { x: number; y: number; width: number; height: number } } {
    const { width, height, font, fontBold, version, quizId, totalPoints } = ctx;

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
    const subText = `${classInfo}  |  Version ${version}  |  ${itemCount} items`;
    page.drawText(subText, {
        x: MARGINS.left + 24,
        y: startY - 41,
        size: 9.0,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    // Score box on right
    const scoreBoxWidth = 84;
    const scoreBoxHeight = 44;
    const scoreBoxX = width - MARGINS.right - 24 - 54 - 12 - scoreBoxWidth; // left of QR code
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

    // QR code next to score box
    const qrSize = 50;
    const qrX = width - MARGINS.right - 24 - qrSize;
    const qrY = startY - qrSize - 2;
    drawQRCode(page, {
        q: quizId,
        v: version,
        t: 'answer_sheet',
        p: 1,
        n: 1,
    }, qrX, qrY, qrSize);
    const qrPosition = {
        x: qrX,
        y: height - (qrY + qrSize),
        width: qrSize,
        height: qrSize,
    };

    // Student Information line
    const infoY = startY - 60;
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

    return { cursorY: instY - 16, qrPosition };
}

function drawAnswerSections(
    page: PDFPage,
    ctx: SheetContext,
    startY: number,
    questions: ScannableQuestion[],
    layoutItems: LayoutItem[]
): number {
    const { printableWidth, font, fontBold } = ctx;
    let cursorY = startY;

    // Group questions into sections
    const mc = questions.filter((q) => q.type === 'multiple_choice');
    const tf = questions.filter((q) => q.type === 'true_false');
    const wb = questions.filter((q) => q.type === 'word_box');
    const fb = questions.filter((q) => q.type === 'fill_blank');
    const id = questions.filter((q) => q.type === 'identification');
    const en = questions.filter((q) => q.type === 'enumeration');

    let sectionNum = 1;

    // ── Section: Multiple Choice ──────────────────────────────────────────────
    if (mc.length > 0) {
        const title = `${toRoman(sectionNum++)}. MULTIPLE CHOICE (items ${mc[0].questionNumber}-${mc[mc.length - 1].questionNumber}) - write A, B, C or D`;
        cursorY = drawSectionBanner(page, MARGINS.left, cursorY, printableWidth, title, fontBold);
        cursorY = drawLetterGrid(page, MARGINS.left, cursorY, mc, font, fontBold, 'letter', layoutItems, ctx.height);
        cursorY -= 8;
    }

    // ── Section: True or False ────────────────────────────────────────────────
    if (tf.length > 0) {
        const title = `${toRoman(sectionNum++)}. TRUE OR FALSE (items ${tf[0].questionNumber}-${tf[tf.length - 1].questionNumber}) - write T or F`;
        cursorY = drawSectionBanner(page, MARGINS.left, cursorY, printableWidth, title, fontBold);
        cursorY = drawLetterGrid(page, MARGINS.left, cursorY, tf, font, fontBold, 'tf', layoutItems, ctx.height);
        cursorY -= 8;
    }

    // ── Section: Word Box ─────────────────────────────────────────────────────
    if (wb.length > 0) {
        const title = `${toRoman(sectionNum++)}. WORD BOX (items ${wb[0].questionNumber}-${wb[wb.length - 1].questionNumber}) - write the LETTER from the word bank`;
        cursorY = drawSectionBanner(page, MARGINS.left, cursorY, printableWidth, title, fontBold);
        cursorY = drawLetterGrid(page, MARGINS.left, cursorY, wb, font, fontBold, 'word_box', layoutItems, ctx.height);
        cursorY -= 8;
    }

    // ── Sections: Fill in the Blank & Identification (2 columns) ─────────────
    if (fb.length > 0 || id.length > 0) {
        const colWidth = (printableWidth - 16) / 2;
        const col1X = MARGINS.left;
        const col2X = MARGINS.left + colWidth + 16;

        let leftBottomY = cursorY;
        let rightBottomY = cursorY;

        // Left Column (Fill in the blank, or half of ID if no FB)
        if (fb.length > 0) {
            const fbTitle = `${toRoman(sectionNum++)}. FILL IN THE BLANK (${fb[0].questionNumber}-${fb[fb.length - 1].questionNumber})`;
            leftBottomY = drawSectionBanner(page, col1X, cursorY, colWidth, fbTitle, fontBold);
            leftBottomY = drawTextBoxColumn(page, col1X, leftBottomY, colWidth, fb, font, fontBold, 'text', layoutItems, ctx.height);
        }

        // Right Column (Identification)
        if (id.length > 0) {
            const idTitle = `${toRoman(sectionNum++)}. IDENTIFICATION (${id[0].questionNumber}-${id[id.length - 1].questionNumber})`;
            rightBottomY = drawSectionBanner(page, col2X, cursorY, colWidth, idTitle, fontBold);
            rightBottomY = drawTextBoxColumn(page, col2X, rightBottomY, colWidth, id, font, fontBold, 'text', layoutItems, ctx.height);
        }

        cursorY = Math.min(leftBottomY, rightBottomY) - 8;
    }

    // ── Section: Enumeration (3 columns of sub-boxes) ─────────────────────────
    if (en.length > 0) {
        const title = `${toRoman(sectionNum++)}. ENUMERATION (${en[0].questionNumber}-${en[en.length - 1].questionNumber}) - one answer per box`;
        cursorY = drawSectionBanner(page, MARGINS.left, cursorY, printableWidth, title, fontBold);
        cursorY = drawEnumerationSection(page, MARGINS.left, cursorY, printableWidth, en, font, fontBold, layoutItems, ctx.height);
        cursorY -= 8;
    }

    return cursorY;
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
    font: PDFFont,
    fontBold: PDFFont,
    itemType: 'letter' | 'tf' | 'word_box',
    layoutItems: LayoutItem[],
    pageHeight: number
): number {
    const cfg = ANSWER_BOX_CONFIG.letter;
    let cursorY = startY;

    let col = 0;
    let rowY = cursorY;

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
            box: {
                x: boxX,
                y: pageHeight - (boxY + cfg.inputHeight),
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
    font: PDFFont,
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
            box: {
                x: inputX,
                y: pageHeight - (boxY + boxHeight),
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
    font: PDFFont,
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
                box: {
                    x: inputX,
                    y: pageHeight - (boxY + boxHeight),
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
    itemCount: number
): void {
    const { width, version, totalPoints, font } = ctx;
    const y = MARGINS.bottom;

    const leftText = `Tseki Vision Grader Answer Sheet  |  ${itemCount} items  |  ${totalPoints} points  |  Version ${version}`;
    page.drawText(leftText, {
        x: MARGINS.left + 24, // buffer from bottom-left corner marker
        y,
        size: 7.8,
        font,
        color: rgb(0.35, 0.35, 0.35),
    });

    const rightText = 'Do not fold  |  1 sheet per student';
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
