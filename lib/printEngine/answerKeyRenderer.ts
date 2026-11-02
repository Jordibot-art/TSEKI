// lib/printEngine/answerKeyRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { MARGINS, PAPER_DIMENSIONS } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { generateAnswerVariants } from './layoutJson';
import { wrapText } from './measure';
import { AnswerVariant, GeneratedAssessment, PrintOptions, ScannableQuestion } from './types';

interface TableColumns {
    num: number;
    type: number;
    answer: number;
    pts: number;
    rule: number;
}

/**
 * Builds the official Teacher Copy Answer Key PDF table with 5 columns:
 * # | Type | Correct answer | Points | Grader rule
 */
export async function renderAnswerKeyPDF(
    assessment: GeneratedAssessment,
    options: PrintOptions = {}
): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const { regular: font, bold: fontBold } = await embedPrintFonts(doc);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    const printableWidth = dims.width - MARGINS.left - MARGINS.right; // 540 pt
    const tableX = MARGINS.left;

    // 5 Column widths: #, Type, Correct answer, Points, Grader rule
    const colW: TableColumns = {
        num: 42,
        type: 90,
        answer: 205,
        pts: 43,
        rule: printableWidth - 42 - 90 - 205 - 43, // 160 pt
    };

    const totalPoints = assessment.questions.reduce((sum, q) => {
        if (q.type === 'enumeration') return sum + (q.answerBoxesRequired || 3);
        return sum + 1;
    }, 0);

    const pages: PDFPage[] = [];
    let currentPage = doc.addPage([dims.width, dims.height]);
    pages.push(currentPage);

    const quizTitle = assessment.quizTitle || (assessment as any).title || 'Assessment';

    // Header on Page 1
    let cursorY = drawAnswerKeyPageHeader(
        currentPage,
        dims.width,
        dims.height,
        quizTitle,
        quizId,
        version,
        assessment.questions.length,
        totalPoints,
        font,
        fontBold
    );

    // Table Header
    cursorY = drawTableHeader(currentPage, tableX, cursorY, colW, fontBold);

    // Build rows combining questions, answerKey, & answerVariants
    const variants = generateAnswerVariants(assessment);
    const rows = buildAnswerKeyRows(assessment.questions, assessment.answerKey, variants);

    const bottomLimit = MARGINS.bottom + 48;

    for (const r of rows) {
        const answerLines = wrapText(r.answer, colW.answer - 10, 8.2, fontBold);
        const ruleLines = wrapText(r.graderRule, colW.rule - 10, 7.8, font);
        const maxLines = Math.max(answerLines.length, ruleLines.length);
        const rowHeight = Math.max(17, maxLines * 10.5 + 5);

        if (cursorY - rowHeight < bottomLimit) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            currentPage = doc.addPage([dims.width, dims.height]);
            pages.push(currentPage);
            cursorY = dims.height - MARGINS.top - 16;

            // Repeat table header on continuation page
            cursorY = drawTableHeader(currentPage, tableX, cursorY, colW, fontBold);
        }

        drawTableRow(currentPage, tableX, cursorY, rowHeight, colW, r, answerLines, ruleLines, font, fontBold);
        cursorY -= rowHeight;
    }

    // Draw grading notes at end of table
    drawGradingGuidelines(currentPage, tableX, cursorY - 10, printableWidth, font, fontBold);

    // Footers
    for (let i = 0; i < pages.length; i++) {
        drawAnswerKeyFooter(pages[i], dims.width, i + 1, pages.length, font);
    }

    return await doc.save();
}

function drawAnswerKeyPageHeader(
    page: PDFPage,
    pageWidth: number,
    pageHeight: number,
    quizTitle: string,
    quizId: string,
    version: string,
    itemCount: number,
    totalPoints: number,
    font: PDFFont,
    fontBold: PDFFont
): number {
    const y = pageHeight - MARGINS.top;

    // Centered title
    const mainTitle = 'TEACHER COPY - ANSWER KEY';
    const mainW = fontBold.widthOfTextAtSize(mainTitle, 15);
    page.drawText(mainTitle, {
        x: (pageWidth - mainW) / 2,
        y: y - 10,
        size: 15,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    // Subtitle metadata
    const sub = `${quizTitle}  |  ${quizId}  |  Version ${version}  |  ${itemCount} items  |  ${totalPoints} points`;
    const subW = font.widthOfTextAtSize(sub, 9.0);
    page.drawText(sub, {
        x: (pageWidth - subW) / 2,
        y: y - 26,
        size: 9.0,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    return y - 42;
}

function drawTableHeader(
    page: PDFPage,
    x: number,
    y: number,
    colW: TableColumns,
    fontBold: PDFFont
): number {
    const headerHeight = 18;
    const totalWidth = colW.num + colW.type + colW.answer + colW.pts + colW.rule;

    page.drawRectangle({
        x,
        y: y - headerHeight,
        width: totalWidth,
        height: headerHeight,
        color: rgb(0.15, 0.17, 0.22),
    });

    const drawHText = (text: string, colX: number, w: number, alignRight: boolean = false) => {
        const textW = fontBold.widthOfTextAtSize(text, 8.2);
        const textX = alignRight ? colX + w - textW - 6 : colX + 6;
        page.drawText(text, {
            x: textX,
            y: y - headerHeight + 5,
            size: 8.2,
            font: fontBold,
            color: rgb(1, 1, 1),
        });
    };

    let curX = x;
    drawHText('#', curX, colW.num);
    curX += colW.num;
    drawHText('Type', curX, colW.type);
    curX += colW.type;
    drawHText('Correct answer', curX, colW.answer);
    curX += colW.answer;
    drawHText('Points', curX, colW.pts, true);
    curX += colW.pts;
    drawHText('Grader rule', curX, colW.rule);

    return y - headerHeight;
}

interface AnswerRowData {
    numLabel: string;
    typeLabel: string;
    answer: string;
    pts: number;
    graderRule: string;
    isShaded: boolean;
}

function buildAnswerKeyRows(
    questions: ScannableQuestion[],
    answerKey: GeneratedAssessment['answerKey'],
    variants: AnswerVariant[]
): AnswerRowData[] {
    const keyMap = new Map((answerKey || []).map((k) => [k.questionNumber, k]));
    const varMap = new Map(variants.map((v) => [v.questionNumber, v]));
    const rows: AnswerRowData[] = [];

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const keyItem = keyMap.get(q.questionNumber);
        const variant = varMap.get(q.questionNumber);
        const rawAns = keyItem?.correctAnswer || (q as any).correctAnswer || 'Answer';
        const isShaded = i % 2 === 1;

        if (q.type === 'enumeration') {
            const boxes = q.answerBoxesRequired || 3;
            rows.push({
                numLabel: `${q.questionNumber}.1-${q.questionNumber}.${boxes}`,
                typeLabel: 'Enumeration',
                answer: rawAns,
                pts: boxes,
                graderRule: '1 pt per box, no order, no repeats',
                isShaded,
            });
        } else {
            const typeLabel = formatType(q.type);
            let graderRule = 'Single letter';
            if (q.type === 'multiple_choice') {
                graderRule = 'Single letter';
            } else if (q.type === 'true_false') {
                graderRule = 'T or F only';
            } else if (q.type === 'word_box') {
                graderRule = 'Letter from bank';
            } else {
                const extraAccepted = (variant?.accepted || []).filter(
                    (a) => a !== rawAns.toUpperCase()
                );
                if (extraAccepted.length > 0) {
                    graderRule = `Accept ${extraAccepted.slice(0, 2).join(', ')}`;
                } else {
                    graderRule = 'Case-insensitive, <=1 typo (>=6 chars)';
                }
            }

            rows.push({
                numLabel: `${q.questionNumber}`,
                typeLabel,
                answer: rawAns,
                pts: keyItem?.points || 1,
                graderRule,
                isShaded,
            });
        }
    }

    return rows;
}

function drawTableRow(
    page: PDFPage,
    x: number,
    y: number,
    rowHeight: number,
    colW: TableColumns,
    row: AnswerRowData,
    answerLines: string[],
    ruleLines: string[],
    font: PDFFont,
    fontBold: PDFFont
): void {
    const totalWidth = colW.num + colW.type + colW.answer + colW.pts + colW.rule;
    const rowY = y - rowHeight;

    if (row.isShaded) {
        page.drawRectangle({
            x,
            y: rowY,
            width: totalWidth,
            height: rowHeight,
            color: rgb(0.96, 0.97, 0.98),
        });
    }

    page.drawLine({
        start: { x, y: rowY },
        end: { x: x + totalWidth, y: rowY },
        thickness: 0.5,
        color: rgb(0.88, 0.89, 0.91),
    });

    let curX = x;

    // #
    page.drawText(row.numLabel, {
        x: curX + 6,
        y: y - 11.5,
        size: 8.2,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });
    curX += colW.num;

    // Type
    page.drawText(row.typeLabel, {
        x: curX + 6,
        y: y - 11.5,
        size: 8.0,
        font,
        color: rgb(0.2, 0.2, 0.2),
    });
    curX += colW.type;

    // Correct Answer (wrapped)
    let ansY = y - 11.5;
    for (const line of answerLines) {
        page.drawText(line, {
            x: curX + 6,
            y: ansY,
            size: 8.2,
            font: fontBold,
            color: rgb(0.05, 0.05, 0.05),
        });
        ansY -= 10.5;
    }
    curX += colW.answer;

    // Points (right-aligned)
    const ptsText = `${row.pts}`;
    const ptsW = fontBold.widthOfTextAtSize(ptsText, 8.2);
    page.drawText(ptsText, {
        x: curX + colW.pts - ptsW - 6,
        y: y - 11.5,
        size: 8.2,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });
    curX += colW.pts;

    // Grader rule (wrapped)
    let ruleY = y - 11.5;
    for (const line of ruleLines) {
        page.drawText(line, {
            x: curX + 6,
            y: ruleY,
            size: 7.8,
            font,
            color: rgb(0.25, 0.28, 0.32),
        });
        ruleY -= 10.5;
    }
}

function drawGradingGuidelines(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    font: PDFFont,
    fontBold: PDFFont
): void {
    if (y < MARGINS.bottom + 42) return;

    page.drawRectangle({
        x,
        y: y - 38,
        width,
        height: 38,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: rgb(0.85, 0.88, 0.94),
        borderWidth: 0.6,
    });

    page.drawText('GRADING NOTES:', {
        x: x + 8,
        y: y - 11,
        size: 7.5,
        font: fontBold,
        color: rgb(0.15, 0.25, 0.45),
    });

    page.drawText(
        '• Spelling tolerance: 1 character difference is accepted for words >= 6 letters.',
        {
            x: x + 8,
            y: y - 22,
            size: 7.2,
            font,
            color: rgb(0.25, 0.3, 0.35),
        }
    );

    page.drawText(
        '• Flagged for teacher review when OCR confidence < 0.75.',
        {
            x: x + 8,
            y: y - 32,
            size: 7.2,
            font,
            color: rgb(0.25, 0.3, 0.35),
        }
    );
}

function drawAnswerKeyFooter(
    page: PDFPage,
    pageWidth: number,
    pageNum: number,
    totalPages: number,
    font: PDFFont
): void {
    const y = MARGINS.bottom - 10;
    const text = `Tseki Smart Assessment System  |  Teacher Answer Key  |  Page ${pageNum} of ${totalPages}`;
    const textW = font.widthOfTextAtSize(text, 7.5);

    page.drawText(text, {
        x: (pageWidth - textW) / 2,
        y,
        size: 7.5,
        font,
        color: rgb(0.45, 0.45, 0.45),
    });
}

function formatType(type: string): string {
    switch (type) {
        case 'multiple_choice':
            return 'Multiple Choice';
        case 'true_false':
            return 'True / False';
        case 'word_box':
            return 'Word Box';
        case 'fill_blank':
            return 'Fill in the Blank';
        case 'identification':
            return 'Identification';
        case 'enumeration':
            return 'Enumeration';
        default:
            return type;
    }
}
