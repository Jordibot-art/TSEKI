// lib/printEngine/allInOneRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { COLORS, FONT_CONFIG, MARGINS, PAPER_DIMENSIONS } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { drawCornerMarkers } from './markers';
import { wrapText } from './measure';
import { drawQRCode } from './qrStamp';
import { GeneratedAssessment, LayoutItem, LayoutPage, PrintOptions, ScannableQuestion } from './types';

export interface AllInOneRenderResult {
    pdfBytes: Uint8Array;
    pages: LayoutPage[];
}

interface AllInOneContext {
    doc: PDFDocument;
    font: PDFFont;
    fontBold: PDFFont;
    width: number;
    height: number;
    printableWidth: number;
    fontSize: number;
    lineHeight: number;
    colWidth: number;
    colGutter: number;
    version: 'A' | 'B' | 'C';
    quizId: string;
    totalPoints: number;
}

/**
 * Builds a single-page ALL-IN-ONE scannable test paper containing both questions
 * and designated answer boxes on the same sheet.
 */
export async function renderAllInOnePDF(
    assessment: GeneratedAssessment,
    options: PrintOptions = {},
    selectedFontSize: number = 10.5
): Promise<AllInOneRenderResult> {
    const doc = await PDFDocument.create();
    const { regular: font, bold: fontBold } = await embedPrintFonts(doc);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    const printableWidth = dims.width - MARGINS.left - MARGINS.right;
    const colGutter = 20;
    const colWidth = (printableWidth - colGutter) / 2;

    const fontSize = selectedFontSize;
    const lineHeight = fontSize * FONT_CONFIG.LINE_HEIGHT_FACTOR;

    const totalPoints = assessment.questions.reduce((sum, q) => {
        if (q.type === 'enumeration') return sum + (q.answerBoxesRequired || 3);
        return sum + 1;
    }, 0);

    const ctx: AllInOneContext = {
        doc,
        font,
        fontBold,
        width: dims.width,
        height: dims.height,
        printableWidth,
        fontSize,
        lineHeight,
        colWidth,
        colGutter,
        version,
        quizId,
        totalPoints,
    };

    const page = doc.addPage([dims.width, dims.height]);

    // 1. Corner registration markers
    const markers = drawCornerMarkers(page, dims.width, dims.height);

    // 2. Header
    const { cursorY, qrPosition } = drawAllInOneHeader(page, ctx, options, assessment.quizTitle, assessment.questions.length);

    // 3. Questions & Answer Boxes in 2 Columns
    const layoutItems: LayoutItem[] = [];
    drawAllInOneColumns(page, ctx, cursorY, assessment.questions, layoutItems);

    // 4. Footer
    drawAllInOneFooter(page, ctx, assessment.questions.length);

    const layoutPages: LayoutPage[] = [
        {
            pageNumber: 1,
            markers,
            qrPosition,
            items: layoutItems,
        },
    ];

    const pdfBytes = await doc.save();

    return {
        pdfBytes,
        pages: layoutPages,
    };
}

function drawAllInOneHeader(
    page: PDFPage,
    ctx: AllInOneContext,
    options: PrintOptions,
    title: string,
    itemCount: number
): { cursorY: number; qrPosition: { x: number; y: number; width: number; height: number } } {
    const { width, height, font, fontBold, version, quizId, totalPoints } = ctx;
    const startY = height - MARGINS.top - 4;

    // Small system title
    page.drawText('TSEKI SMART ASSESSMENT SYSTEM | ALL-IN-ONE TEST PAPER', {
        x: MARGINS.left + 24,
        y: startY - 8,
        size: 8.0,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    // Assessment title
    page.drawText(title || 'Classroom Assessment', {
        x: MARGINS.left + 24,
        y: startY - 24,
        size: 13.5,
        font: fontBold,
        color: rgb(0.1, 0.12, 0.16),
    });

    // Subtitle
    const classInfo = options.classTitle || 'Class Assessment';
    page.drawText(`${classInfo}  |  Version ${version}  |  ${itemCount} Items`, {
        x: MARGINS.left + 24,
        y: startY - 38,
        size: 8.5,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    // Score box
    const scoreBoxWidth = 80;
    const scoreBoxHeight = 40;
    const scoreBoxX = width - MARGINS.right - 24 - 48 - 12 - scoreBoxWidth;
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
        x: scoreBoxX + 6,
        y: scoreBoxY + scoreBoxHeight - 11,
        size: 7.5,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
    });

    page.drawText(`_____ / ${totalPoints}`, {
        x: scoreBoxX + 8,
        y: scoreBoxY + 10,
        size: 10.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    // QR code
    const qrSize = 48;
    const qrX = width - MARGINS.right - 24 - qrSize;
    const qrY = startY - qrSize - 2;
    drawQRCode(page, {
        q: quizId,
        v: version,
        t: 'all_in_one',
        p: 1,
        n: 1,
    }, qrX, qrY, qrSize);
    const qrPosition = {
        x: qrX,
        y: height - (qrY + qrSize),
        width: qrSize,
        height: qrSize,
    };

    // Student information line
    const infoY = startY - 54;
    page.drawText('Name: _____________________________________________   Date: ________________   Section: ____________', {
        x: MARGINS.left,
        y: infoY,
        size: 8.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    // Instruction strip
    const instY = infoY - 14;
    page.drawRectangle({
        x: MARGINS.left,
        y: instY - 2,
        width: width - MARGINS.left - MARGINS.right,
        height: 14,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    page.drawText('Write your final answers clearly in the designated answer boxes. Use CAPITAL LETTERS for multiple choice/T&F.', {
        x: MARGINS.left + 6,
        y: instY + 2,
        size: 7.0,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
    });

    return { cursorY: instY - 14, qrPosition };
}

function drawAllInOneColumns(
    page: PDFPage,
    ctx: AllInOneContext,
    startY: number,
    questions: ScannableQuestion[],
    layoutItems: LayoutItem[]
): void {
    const { colWidth, colGutter, fontSize, lineHeight, font, fontBold } = ctx;
    const col1X = MARGINS.left;
    const col2X = MARGINS.left + colWidth + colGutter;

    const half = Math.ceil(questions.length / 2);
    const col1Questions = questions.slice(0, half);
    const col2Questions = questions.slice(half);

    renderQuestionColumn(page, ctx, col1X, startY, col1Questions, layoutItems);
    renderQuestionColumn(page, ctx, col2X, startY, col2Questions, layoutItems);
}

function renderQuestionColumn(
    page: PDFPage,
    ctx: AllInOneContext,
    startX: number,
    startY: number,
    questions: ScannableQuestion[],
    layoutItems: LayoutItem[]
): void {
    const { colWidth, fontSize, lineHeight, font, fontBold } = ctx;
    let cursorY = startY;

    for (const q of questions) {
        const isLetter = q.type === 'multiple_choice' || q.type === 'true_false' || q.type === 'word_box';
        const boxWidth = isLetter ? 22 : 90;
        const boxHeight = isLetter ? 20 : 18;

        const textWidth = colWidth - boxWidth - 8;

        // Question stem
        const prefix = `${q.questionNumber}. `;
        const prefixW = fontBold.widthOfTextAtSize(prefix, fontSize);
        const stemLines = wrapText(q.questionText, textWidth - prefixW, fontSize, font);

        const itemStartY = cursorY;

        // Draw prefix
        page.drawText(prefix, {
            x: startX,
            y: cursorY - fontSize,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
        });

        if (stemLines.length > 0) {
            page.drawText(stemLines[0], {
                x: startX + prefixW,
                y: cursorY - fontSize,
                size: fontSize,
                font,
                color: rgb(0.1, 0.1, 0.1),
            });
        }

        cursorY -= lineHeight;

        for (let i = 1; i < stemLines.length; i++) {
            page.drawText(stemLines[i], {
                x: startX + prefixW,
                y: cursorY - fontSize,
                size: fontSize,
                font,
                color: rgb(0.1, 0.1, 0.1),
            });
            cursorY -= lineHeight;
        }

        // Draw multiple choice options
        if (q.type === 'multiple_choice' && q.options) {
            for (let i = 0; i < q.options.length; i++) {
                const optLetter = String.fromCharCode(65 + i);
                const optPrefix = `${optLetter}) `;
                const optPrefixW = fontBold.widthOfTextAtSize(optPrefix, fontSize * 0.95);
                const optLines = wrapText(q.options[i], textWidth - 12 - optPrefixW, fontSize * 0.95, font);

                page.drawText(optPrefix, {
                    x: startX + 12,
                    y: cursorY - fontSize * 0.95,
                    size: fontSize * 0.95,
                    font: fontBold,
                    color: rgb(0.1, 0.1, 0.1),
                });

                if (optLines.length > 0) {
                    page.drawText(optLines[0], {
                        x: startX + 12 + optPrefixW,
                        y: cursorY - fontSize * 0.95,
                        size: fontSize * 0.95,
                        font,
                        color: rgb(0.15, 0.15, 0.15),
                    });
                }
                cursorY -= lineHeight * 0.95;

                for (let j = 1; j < optLines.length; j++) {
                    page.drawText(optLines[j], {
                        x: startX + 12 + optPrefixW,
                        y: cursorY - fontSize * 0.95,
                        size: fontSize * 0.95,
                        font,
                        color: rgb(0.15, 0.15, 0.15),
                    });
                    cursorY -= lineHeight * 0.95;
                }
            }
        }

        // Draw Answer Box on the right side of this item
        const boxX = startX + colWidth - boxWidth;
        const boxY = itemStartY - boxHeight - 2;

        page.drawRectangle({
            x: boxX,
            y: boxY,
            width: boxWidth,
            height: boxHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.2, 0.2, 0.2),
            borderWidth: 0.8,
        });

        // Small indicator
        page.drawText(`${q.questionNumber}`, {
            x: boxX - 10,
            y: boxY + boxHeight / 2 - 3,
            size: 6.5,
            font: fontBold,
            color: rgb(0.4, 0.4, 0.4),
        });

        layoutItems.push({
            questionNumber: q.questionNumber,
            type: isLetter ? 'letter' : 'text',
            box: {
                x: boxX,
                y: ctx.height - (boxY + boxHeight),
                width: boxWidth,
                height: boxHeight,
            },
            maxChars: isLetter ? 1 : 25,
        });

        cursorY = Math.min(cursorY, boxY) - 6; // gap
    }
}

function drawAllInOneFooter(
    page: PDFPage,
    ctx: AllInOneContext,
    itemCount: number
): void {
    const { width, quizId, version, totalPoints, font } = ctx;
    const y = MARGINS.bottom;

    const text = `Tseki All-in-One Paper  |  ${quizId}  |  Version ${version}  |  ${itemCount} Items  |  ${totalPoints} Points`;
    page.drawText(text, {
        x: MARGINS.left + 24,
        y,
        size: 7.5,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });
}
