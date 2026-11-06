// teacher-web/src/lib/printEngine/allInOneRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { COLORS, FONT_CONFIG, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import { getMeasureBoldFont, getMeasureFont, wrapText } from './measure';
import { drawQRCode } from './qrStamp';
import type { GeneratedAssessment, LayoutItem, LayoutPage, PrintOptions, QRRect, ScannableQuestion } from './types';

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
    const title = assessment.quizTitle || (assessment as any).title || 'Classroom Assessment';
    const { cursorY, qr } = drawAllInOneHeader(page, ctx, options, title, assessment.questions.length);

    // 3. Questions & Answer Boxes in 2 Columns
    const layoutItems: LayoutItem[] = [];
    drawAllInOneColumns(page, ctx, cursorY, assessment.questions, layoutItems);

    // 4. Footer
    drawAllInOneFooter(page, ctx, assessment.questions.length);

    const layoutPages: LayoutPage[] = [
        {
            pageNumber: 1,
            markers,
            qr,
            items: layoutItems,
        },
    ];

    const pdfBytes = options.skipPdfSave ? new Uint8Array() : await doc.save();

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
): { cursorY: number; qr: QRRect } {
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
    page.drawText(title, {
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

    // QR code (56 pt)
    const qrSize = QR_CODE_CONFIG.size;
    const qrX = width - MARGINS.right - 24 - qrSize;
    const qrY = startY - qrSize - 2;
    const qr = drawQRCode(
        page,
        {
            q: quizId,
            v: version,
            t: 'ALL_IN_ONE',
            p: 1,
            n: 1,
        },
        qrX,
        qrY,
        qrSize
    );

    // Score box to the left of QR code
    const scoreBoxWidth = 80;
    const scoreBoxHeight = 40;
    const scoreBoxX = qrX - 12 - scoreBoxWidth;
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

    // Student information line
    const infoY = startY - 62;
    page.drawText('Last Name: ____________, First Name: ____________, Middle Name: _________   Date: _________   Section: _______', {
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

    return { cursorY: instY - 14, qr };
}

function drawAllInOneColumns(
    page: PDFPage,
    ctx: AllInOneContext,
    startY: number,
    questions: ScannableQuestion[],
    layoutItems: LayoutItem[]
): void {
    const { colWidth, colGutter } = ctx;
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
                const optText = q.options[i].replace(/^[A-D][.)]\s*/i, '');
                const optLines = wrapText(optText, textWidth - 12 - optPrefixW, fontSize * 0.95, font);

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

        const itemType = q.type === 'true_false'
            ? 'tf'
            : q.type === 'word_box'
                ? 'word_box'
                : isLetter
                    ? 'letter'
                    : 'text';

        layoutItems.push({
            questionNumber: q.questionNumber,
            type: itemType,
            rect: {
                x: boxX,
                y: topY(boxY, boxHeight, ctx.height),
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
    const { quizId, version, totalPoints, font } = ctx;
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
