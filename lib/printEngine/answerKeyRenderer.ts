import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { MARGINS, PAPER_DIMENSIONS } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { wrapText } from './measure';
import { GeneratedAssessment, PrintOptions, ScannableQuestion } from './types';

/**
 * Builds the official Teacher Copy Answer Key PDF table.
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

    const printableWidth = dims.width - MARGINS.left - MARGINS.right;
    const tableX = MARGINS.left;

    // Column widths: #, Type, Correct Answer, Pts
    const colW = {
        num: 45,
        type: 110,
        answer: printableWidth - 45 - 110 - 45, // ~340 pt
        pts: 45,
    };

    const totalPoints = assessment.questions.reduce((sum, q) => {
        if (q.type === 'enumeration') return sum + (q.answerBoxesRequired || 3);
        return sum + 1;
    }, 0);

    const pages: PDFPage[] = [];
    let currentPage = doc.addPage([dims.width, dims.height]);
    pages.push(currentPage);

    // Header on Page 1
    let cursorY = drawAnswerKeyPageHeader(currentPage, dims.width, dims.height, assessment.quizTitle, quizId, version, assessment.questions.length, totalPoints, font, fontBold);

    // Table Header
    cursorY = drawTableHeader(currentPage, tableX, cursorY, colW, fontBold);

    // Build rows combining questions & answerKey
    const rows = buildAnswerKeyRows(assessment.questions, assessment.answerKey);

    const bottomLimit = MARGINS.bottom + 45;

    for (const r of rows) {
        // Measure row height needed for answer text
        const answerLines = wrapText(r.answer, colW.answer - 12, 8.5, font);
        const rowHeight = Math.max(18, answerLines.length * 11 + 6);

        if (cursorY - rowHeight < bottomLimit) {
            // New page
            currentPage = doc.addPage([dims.width, dims.height]);
            pages.push(currentPage);
            cursorY = dims.height - MARGINS.top - 20;

            // Repeat table header on continuation page
            cursorY = drawTableHeader(currentPage, tableX, cursorY, colW, fontBold);
        }

        drawTableRow(currentPage, tableX, cursorY, rowHeight, colW, r, answerLines, font, fontBold);
        cursorY -= rowHeight;
    }

    // Draw grading notes at end of table if space permits, or bottom
    drawGradingGuidelines(currentPage, tableX, cursorY - 14, printableWidth, font, fontBold);

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
    const sub = `${quizTitle || 'Assessment'}  |  ${quizId}  |  Version ${version}  |  ${itemCount} items  |  ${totalPoints} points`;
    const subW = font.widthOfTextAtSize(sub, 9.0);
    page.drawText(sub, {
        x: (pageWidth - subW) / 2,
        y: y - 26,
        size: 9.0,
        font,
        color: rgb(0.3, 0.35, 0.4),
    });

    return y - 44;
}

function drawTableHeader(
    page: PDFPage,
    x: number,
    y: number,
    colW: { num: number; type: number; answer: number; pts: number },
    fontBold: PDFFont
): number {
    const headerHeight = 18;
    const totalWidth = colW.num + colW.type + colW.answer + colW.pts;

    page.drawRectangle({
        x,
        y: y - headerHeight,
        width: totalWidth,
        height: headerHeight,
        color: rgb(0.15, 0.17, 0.22), // dark slate
    });

    const drawHText = (text: string, colX: number, w: number, alignRight: boolean = false) => {
        const textW = fontBold.widthOfTextAtSize(text, 8.5);
        const textX = alignRight ? colX + w - textW - 8 : colX + 8;
        page.drawText(text, {
            x: textX,
            y: y - headerHeight + 5,
            size: 8.5,
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
    drawHText('Pts', curX, colW.pts, true);

    return y - headerHeight;
}

interface AnswerRowData {
    numLabel: string;
    typeLabel: string;
    answer: string;
    pts: number;
    isShaded: boolean;
}

function buildAnswerKeyRows(
    questions: ScannableQuestion[],
    answerKey: GeneratedAssessment['answerKey']
): AnswerRowData[] {
    const keyMap = new Map((answerKey || []).map((k) => [k.questionNumber, k]));
    const rows: AnswerRowData[] = [];

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const keyItem = keyMap.get(q.questionNumber);
        const isShaded = i % 2 === 1;

        if (q.type === 'enumeration') {
            const boxes = q.answerBoxesRequired || 3;
            rows.push({
                numLabel: `${q.questionNumber}.1-${q.questionNumber}.${boxes}`,
                typeLabel: 'Enumeration',
                answer: keyItem?.correctAnswer || 'Required items',
                pts: boxes,
                isShaded,
            });
        } else {
            const typeLabel = formatType(q.type);
            rows.push({
                numLabel: `${q.questionNumber}`,
                typeLabel,
                answer: keyItem?.correctAnswer || 'Answer',
                pts: keyItem?.points || 1,
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
    colW: { num: number; type: number; answer: number; pts: number },
    row: AnswerRowData,
    answerLines: string[],
    font: PDFFont,
    fontBold: PDFFont
): void {
    const totalWidth = colW.num + colW.type + colW.answer + colW.pts;
    const rowY = y - rowHeight;

    // Background
    if (row.isShaded) {
        page.drawRectangle({
            x,
            y: rowY,
            width: totalWidth,
            height: rowHeight,
            color: rgb(0.96, 0.97, 0.98),
        });
    }

    // Border bottom
    page.drawLine({
        start: { x, y: rowY },
        end: { x: x + totalWidth, y: rowY },
        thickness: 0.5,
        color: rgb(0.88, 0.89, 0.91),
    });

    let curX = x;

    // #
    page.drawText(row.numLabel, {
        x: curX + 8,
        y: y - 12,
        size: 8.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });
    curX += colW.num;

    // Type
    page.drawText(row.typeLabel, {
        x: curX + 8,
        y: y - 12,
        size: 8.5,
        font,
        color: rgb(0.2, 0.2, 0.2),
    });
    curX += colW.type;

    // Correct Answer (wrapped)
    let ansY = y - 12;
    for (const line of answerLines) {
        page.drawText(line, {
            x: curX + 8,
            y: ansY,
            size: 8.5,
            font: fontBold,
            color: rgb(0.05, 0.05, 0.05),
        });
        ansY -= 11;
    }
    curX += colW.answer;

    // Pts (right-aligned)
    const ptsText = `${row.pts}`;
    const ptsW = fontBold.widthOfTextAtSize(ptsText, 8.5);
    page.drawText(ptsText, {
        x: curX + colW.pts - ptsW - 8,
        y: y - 12,
        size: 8.5,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });
}

function drawGradingGuidelines(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    font: PDFFont,
    fontBold: PDFFont
): void {
    if (y < MARGINS.bottom + 50) return; // not enough room on this page

    page.drawRectangle({
        x,
        y: y - 42,
        width,
        height: 42,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: rgb(0.85, 0.88, 0.94),
        borderWidth: 0.6,
    });

    page.drawText('GRADING RULES & TOLERANCES:', {
        x: x + 8,
        y: y - 12,
        size: 7.5,
        font: fontBold,
        color: rgb(0.15, 0.25, 0.45),
    });

    const rules = '• Student answers are case-insensitive and stripped of punctuation.  • For text answers with length >= 6 chars, 1-character typos (Levenshtein distance <= 1) are accepted.  • Low-confidence OCR results will be flagged for teacher review in GraderTab.';
    const lines = wrapText(rules, width - 16, 7.2, font);

    let lineY = y - 24;
    for (const l of lines.slice(0, 2)) {
        page.drawText(l, {
            x: x + 8,
            y: lineY,
            size: 7.2,
            font,
            color: rgb(0.25, 0.3, 0.35),
        });
        lineY -= 10;
    }
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
