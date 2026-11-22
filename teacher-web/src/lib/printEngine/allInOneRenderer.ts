// teacher-web/src/lib/printEngine/allInOneRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { abortableDelay, throwIfExportAborted } from './cancel';
import { COLORS, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import {
    fitHeaderText,
    getAllInOneItemMetrics,
    getLineHeightFactor,
    getMeasureBoldFont,
    getMeasureFont,
    measureAllInOneColumns,
    truncateTextToWidth,
    wrapText,
} from './measure';
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
        const embedded = await embedPrintFonts(doc);
        font = embedded.regular;
        fontBold = embedded.bold;
    }
    throwIfExportAborted(options.signal);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    const printableWidth = dims.width - MARGINS.left - MARGINS.right;
    const colGutter = 20;
    const colWidth = (printableWidth - colGutter) / 2;

    const fontSize = selectedFontSize;
    const lineHeight = fontSize * getLineHeightFactor(fontSize);

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
    if (!options.skipPdfSave) {
        await abortableDelay(0, options.signal);
    }

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

function drawAllInOneHeader(
    page: PDFPage,
    ctx: AllInOneContext,
    options: PrintOptions,
    title: string,
    itemCount: number
): { cursorY: number; qr: QRRect } {
    const { width, height, font, fontBold, version, quizId, totalPoints } = ctx;
    const startY = height - MARGINS.top - 4;
    const headerTextX = MARGINS.left + 24;

    // QR code (56 pt) — positioned first so header text width is bounded strictly to the left
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

    // Safe horizontal width strictly left of the SCORE box (and well clear of QR code)
    const maxHeaderWidth = Math.max(120, scoreBoxX - headerTextX - 12);

    // Small system title
    const eyebrowText = truncateTextToWidth(
        'TSEKI SMART ASSESSMENT SYSTEM | ALL-IN-ONE TEST PAPER',
        maxHeaderWidth,
        7.5,
        fontBold
    );
    page.drawText(eyebrowText, {
        x: headerTextX,
        y: startY - 7,
        size: 7.5,
        font: fontBold,
        color: rgb(0.35, 0.38, 0.44),
    });

    // Assessment title (auto-scales / wraps up to 2 lines strictly within maxHeaderWidth)
    const fittedTitle = fitHeaderText(title, maxHeaderWidth, fontBold, 13.5, 9.5, 2);
    const titleStartY = fittedTitle.lines.length > 1 ? startY - 21 : startY - 24;
    const titleLineH = fittedTitle.fontSize * 1.24;
    for (let i = 0; i < fittedTitle.lines.length; i++) {
        page.drawText(fittedTitle.lines[i], {
            x: headerTextX,
            y: titleStartY - i * titleLineH,
            size: fittedTitle.fontSize,
            font: fontBold,
            color: rgb(0.1, 0.12, 0.16),
        });
    }

    // Subtitle (positioned cleanly below 1- or 2-line title with crisp breathing room)
    const lastTitleY = titleStartY - (fittedTitle.lines.length - 1) * titleLineH;
    const subtitleY = fittedTitle.lines.length > 1 ? lastTitleY - 13.5 : startY - 39;
    const classInfo = options.classTitle || 'Class Assessment';
    const subText = truncateTextToWidth(
        `${classInfo}  |  Version ${version}  |  ${itemCount} Items`,
        maxHeaderWidth,
        8.5,
        font
    );
    page.drawText(subText, {
        x: headerTextX,
        y: subtitleY,
        size: 8.5,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    // Student information lines (always cleanly below both QR code and wrapped subtitle)
    // Row 1: Last Name, First Name, Middle Name
    const nameY = Math.min(startY - 63, subtitleY - 13.5);
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

    // Instruction strip
    const instY = dateY - 13;
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

    return { cursorY: instY - 12, qr };
}

function drawAllInOneColumns(
    page: PDFPage,
    ctx: AllInOneContext,
    startY: number,
    questions: ScannableQuestion[],
    layoutItems: LayoutItem[]
): void {
    const { colWidth, colGutter, fontSize, font, fontBold, printableWidth } = ctx;
    let bodyStartY = startY;

    const wordBoxQ = questions.find((q) => q.type === 'word_box' && q.options && q.options.length > 0);
    if (wordBoxQ && wordBoxQ.options) {
        const bankSize = Math.max(7.5, Math.min(8.5, fontSize - 1));
        const formattedWords = wordBoxQ.options.map((w, i) => {
            const trimmed = w.trim();
            if (/^[A-Z]\)\s/i.test(trimmed)) return trimmed;
            return `${String.fromCharCode(65 + i)}) ${trimmed}`;
        });
        const bankText = `WORD BANK:  ${formattedWords.join('    ')}`;
        const lines = wrapText(bankText, printableWidth - 14, bankSize, fontBold);
        const boxH = lines.length * (bankSize + 2.5) + 10;

        page.drawRectangle({
            x: MARGINS.left,
            y: bodyStartY - boxH,
            width: printableWidth,
            height: boxH,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.75, 0.78, 0.82),
            borderWidth: 0.8,
        });

        let lineY = bodyStartY - bankSize - 4;
        for (const line of lines) {
            page.drawText(line, {
                x: MARGINS.left + 7,
                y: lineY,
                size: bankSize,
                font: fontBold,
                color: rgb(0.15, 0.15, 0.15),
            });
            lineY -= bankSize + 2.5;
        }
        bodyStartY -= boxH + 8;
    }

    const col1X = MARGINS.left;
    const col2X = MARGINS.left + colWidth + colGutter;

    const { splitIndex } = measureAllInOneColumns(questions, fontSize, colWidth, font);
    const col1Questions = questions.slice(0, splitIndex);
    const col2Questions = questions.slice(splitIndex);

    renderQuestionColumn(page, ctx, col1X, bodyStartY, col1Questions, layoutItems);
    renderQuestionColumn(page, ctx, col2X, bodyStartY, col2Questions, layoutItems);
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
        const metrics = getAllInOneItemMetrics(q, fontSize, colWidth);
        const { isLetter, isEnumeration, enumBoxes, boxWidth, boxHeight, textWidth, itemGap } = metrics;

        const prefix = `${q.questionNumber}. `;
        const prefixW = fontBold.widthOfTextAtSize(prefix, fontSize);
        const stemLines = wrapText(q.questionText, Math.max(50, textWidth - prefixW), fontSize, font);

        const itemStartY = cursorY;

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

        if (q.type === 'multiple_choice' && q.options) {
            const optFontSize = fontSize * 0.94;
            const optLineH = lineHeight * 0.94;
            const optIndent = 10;
            for (let i = 0; i < q.options.length; i++) {
                const optLetter = String.fromCharCode(65 + i);
                const optPrefix = `${optLetter}) `;
                const optPrefixW = fontBold.widthOfTextAtSize(optPrefix, optFontSize);
                const optText = q.options[i].replace(/^[A-D][.)]\s*/i, '');
                const optLines = wrapText(optText, Math.max(40, textWidth - optIndent - optPrefixW), optFontSize, font);

                page.drawText(optPrefix, {
                    x: startX + optIndent,
                    y: cursorY - optFontSize,
                    size: optFontSize,
                    font: fontBold,
                    color: rgb(0.1, 0.1, 0.1),
                });

                if (optLines.length > 0) {
                    page.drawText(optLines[0], {
                        x: startX + optIndent + optPrefixW,
                        y: cursorY - optFontSize,
                        size: optFontSize,
                        font,
                        color: rgb(0.15, 0.15, 0.15),
                    });
                }
                cursorY -= optLineH;

                for (let j = 1; j < optLines.length; j++) {
                    page.drawText(optLines[j], {
                        x: startX + optIndent + optPrefixW,
                        y: cursorY - optFontSize,
                        size: optFontSize,
                        font,
                        color: rgb(0.15, 0.15, 0.15),
                    });
                    cursorY -= optLineH;
                }
            }
        }

        const boxX = startX + colWidth - boxWidth;
        const indicatorFontSize = 6.5;
        let lowestBoxY = itemStartY;

        if (isEnumeration && enumBoxes > 1) {
            const enumGap = 3;
            for (let b = 0; b < enumBoxes; b++) {
                const boxY = itemStartY - (b + 1) * boxHeight - b * enumGap - 2;
                lowestBoxY = boxY;
                page.drawRectangle({
                    x: boxX,
                    y: boxY,
                    width: boxWidth,
                    height: boxHeight,
                    color: rgb(1, 1, 1),
                    borderColor: rgb(0.2, 0.2, 0.2),
                    borderWidth: 0.8,
                });

                const label = `${q.questionNumber}.${b + 1}`;
                const labelW = fontBold.widthOfTextAtSize(label, 5.8);
                page.drawText(label, {
                    x: boxX - labelW - 3,
                    y: boxY + boxHeight / 2 - 2.5,
                    size: 5.8,
                    font: fontBold,
                    color: rgb(0.4, 0.4, 0.4),
                });

                layoutItems.push({
                    questionNumber: q.questionNumber,
                    subIndex: b + 1,
                    type: 'text',
                    rect: {
                        x: boxX,
                        y: topY(boxY, boxHeight, ctx.height),
                        width: boxWidth,
                        height: boxHeight,
                    },
                    maxChars: 20,
                });
            }
        } else {
            const boxY = itemStartY - boxHeight - 2;
            lowestBoxY = boxY;

            page.drawRectangle({
                x: boxX,
                y: boxY,
                width: boxWidth,
                height: boxHeight,
                color: rgb(1, 1, 1),
                borderColor: rgb(0.2, 0.2, 0.2),
                borderWidth: 0.8,
            });

            const numLabel = `${q.questionNumber}`;
            const numLabelW = fontBold.widthOfTextAtSize(numLabel, indicatorFontSize);
            page.drawText(numLabel, {
                x: boxX - numLabelW - 4,
                y: boxY + boxHeight / 2 - 2.5,
                size: indicatorFontSize,
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
        }

        cursorY = Math.min(cursorY, lowestBoxY) - itemGap;
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
