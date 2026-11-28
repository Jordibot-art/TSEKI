// lib/printEngine/bookletRenderer.ts

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { abortableDelay, throwIfExportAborted } from './cancel';
import { COLORS, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { chooseBookletFontSize } from './fitDecision';
import { embedPrintFonts } from './fonts/embedFonts';
import {
    canPairMcOptions,
    extractSharedWordBank,
    fitHeaderText,
    getEnumerationBoxCount,
    getLineHeightFactor,
    measureQuestionHeight,
    measureWordBankLayout,
    truncateTextToWidth,
    wrapText,
} from './measure';
import { drawQRCode } from './qrStamp';
import { AnswerKeyItem, GeneratedAssessment, PrintOptions, ScannableQuestion } from './types';

interface BookletRenderContext {
    doc: PDFDocument;
    font: PDFFont;
    fontBold: PDFFont;
    assessment: GeneratedAssessment;
    options: PrintOptions;
    version: 'A' | 'B' | 'C';
    quizId: string;
    width: number;
    height: number;
    colWidth: number;
    colGutter: number;
    fontSize: number;
    lineHeight: number;
}

/**
 * Builds the standalone printable Question Booklet PDF in SEPARATE mode.
 */
export async function renderBookletPDF(
    assessment: GeneratedAssessment,
    options: PrintOptions = {},
    selectedFontSize?: number
): Promise<Uint8Array> {
    const { signal } = options;
    throwIfExportAborted(signal);
    const doc = await PDFDocument.create();
    const textSample = [
        assessment.quizTitle || '',
        options.classTitle || '',
        options.subject || '',
        ...assessment.questions.flatMap((q) => [q.questionText || '', ...(q.options || [])]),
        ...(assessment.answerKey || []).map((k) => k.correctAnswer || ''),
    ].join(' ');
    const { regular: font, bold: fontBold } = await embedPrintFonts(doc, textSample);
    throwIfExportAborted(signal);

    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const version = options.version || 'A';
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    const printableWidth = dims.width - MARGINS.left - MARGINS.right;
    const colGutter = 24;
    const colWidth = (printableWidth - colGutter) / 2;

    const fontSize =
        typeof selectedFontSize === 'number' && Number.isFinite(selectedFontSize)
            ? selectedFontSize
            : chooseBookletFontSize(
                  assessment.questions,
                  paperSize,
                  options.gradeLevel,
                  font,
                  assessment.answerKey,
                  fontBold
              ).fontSize;
    const lineHeight = fontSize * getLineHeightFactor(fontSize);

    const ctx: BookletRenderContext = {
        doc,
        font,
        fontBold,
        assessment,
        options,
        version,
        quizId,
        width: dims.width,
        height: dims.height,
        colWidth,
        colGutter,
        fontSize,
        lineHeight,
    };

    // First pass: render all pages and elements
    const pages = await layoutBookletPages(ctx);
    throwIfExportAborted(signal);

    // Second pass: stamp QR codes and footers with accurate total page count
    const totalPages = pages.length;
    const qrSize = QR_CODE_CONFIG.size;
    for (let i = 0; i < totalPages; i++) {
        throwIfExportAborted(signal);
        const page = pages[i];
        const qrX = dims.width - MARGINS.right - qrSize;
        const qrY = i === 0
            ? dims.height - MARGINS.top - qrSize + 4
            : dims.height - MARGINS.top - qrSize + 6;
        // Stamp QR codes & footers
        drawQRCode(
            page,
            {
                q: quizId,
                v: version,
                t: 'BOOKLET',
                p: i + 1,
                n: totalPages,
            },
            qrX,
            qrY,
            qrSize
        );
        drawBookletFooter(page, ctx, i + 1, totalPages);
        await abortableDelay(0, signal);
    }

    await abortableDelay(0, signal);
    return await doc.save();
}

async function layoutBookletPages(ctx: BookletRenderContext): Promise<PDFPage[]> {
    const { doc, width, height, colWidth, colGutter, fontSize } = ctx;
    const { signal } = ctx.options;
    const pages: PDFPage[] = [];

    let currentPage = doc.addPage([width, height]);
    pages.push(currentPage);

    // Page 1 header
    let currentY = drawBookletPage1Header(currentPage, ctx);

    const col1X = MARGINS.left;
    const col2X = MARGINS.left + colWidth + colGutter;

    let currentCol = 1;
    let cursorY = currentY;
    const bottomLimit = MARGINS.bottom + 28; // space above footer
    const allowPairing = fontSize <= 9.5;
    const partGap = fontSize <= 9.5 ? 5 : 8;

    const advanceColumnOrPage = async () => {
        if (currentCol === 1) {
            currentCol = 2;
            cursorY = currentY;
        } else {
            // Yield between pages so JS thread stays responsive & cancellation fires promptly
            await abortableDelay(0, signal);
            currentPage = doc.addPage([width, height]);
            pages.push(currentPage);
            currentY = drawBookletContinuationHeader(currentPage, ctx);
            currentCol = 1;
            cursorY = currentY;
        }
    };

    // Group questions by section/part in order of appearance (tick order)
    const parts = groupQuestionsByPart(ctx.assessment.questions, ctx.assessment.answerKey);
    let renderedCount = 0;

    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        throwIfExportAborted(signal);
        const part = parts[pIdx];
        const partRoman = toRoman(pIdx + 1);
        const isCompact = fontSize <= 9.5;
        const instFontSize = isCompact ? 7.5 : 8.5;
        const instLineH = isCompact ? 9.5 : 11;
        const instLinesCount = part.instructions
            ? wrapText(part.instructions, colWidth, instFontSize, ctx.font).length
            : 0;
        const partBannerHeight =
            (isCompact ? 14 : 16) +
            (isCompact ? 10 : 12) +
            (instLinesCount > 0 ? instLinesCount * instLineH + (isCompact ? 2 : 4) : 0);

        const wordBankLayout =
            part.type === 'word_box' && part.wordBank && part.wordBank.length > 0
                ? measureWordBankLayout(part.wordBank, colWidth, fontSize, ctx.fontBold, 'BOOKLET')
                : null;
        const firstQReserve = part.questions[0]
            ? Math.min(measureQuestionHeight(part.questions[0], fontSize, colWidth, ctx.font, false, allowPairing), 36)
            : 0;
        const blockNeed =
            partBannerHeight +
            (wordBankLayout ? Math.min(wordBankLayout.totalHeight, 180) : 0) +
            firstQReserve;

        // Check if part header (+ word bank) fits in current column; avoid skipping an already-empty column
        if (cursorY < currentY - 1 && cursorY - blockNeed < bottomLimit) {
            await advanceColumnOrPage();
        }

        const colX = currentCol === 1 ? col1X : col2X;

        // Draw Part Banner
        cursorY = drawPartBanner(currentPage, ctx, colX, cursorY, partRoman, part.title, part.pts, part.instructions);

        // If word box, draw the full shared Word Bank (splitting across columns/pages safely if very tall)
        if (wordBankLayout && wordBankLayout.lines.length > 0) {
            let lineIdx = 0;
            while (lineIdx < wordBankLayout.lines.length) {
                const availForBox = cursorY - bottomLimit;
                const minChunkH = wordBankLayout.lineHeight + wordBankLayout.padding * 2;
                if (availForBox < minChunkH) {
                    await advanceColumnOrPage();
                }

                const remainingLines = wordBankLayout.lines.length - lineIdx;
                const maxLinesHere = Math.max(
                    1,
                    Math.floor((cursorY - bottomLimit - wordBankLayout.padding * 2) / wordBankLayout.lineHeight)
                );
                const take = Math.min(remainingLines, maxLinesHere);
                const chunkLines = wordBankLayout.lines.slice(lineIdx, lineIdx + take);
                const activeBankColX = currentCol === 1 ? col1X : col2X;
                const isLastChunk = lineIdx + take >= wordBankLayout.lines.length;

                cursorY = drawWordBankLinesBox(
                    currentPage,
                    ctx,
                    activeBankColX,
                    cursorY,
                    chunkLines,
                    wordBankLayout.bankSize,
                    wordBankLayout.lineHeight,
                    wordBankLayout.padding,
                    isLastChunk ? wordBankLayout.bottomGap : 4
                );
                lineIdx += take;

                if (!isLastChunk) {
                    await advanceColumnOrPage();
                }
            }
        }

        // Render questions in this part
        for (const q of part.questions) {
            if (renderedCount > 0 && renderedCount % 12 === 0) {
                await abortableDelay(0, signal);
            } else {
                throwIfExportAborted(signal);
            }
            const neededHeight = measureQuestionHeight(q, fontSize, colWidth, ctx.font, false, allowPairing);

            if (cursorY - neededHeight < bottomLimit) {
                await advanceColumnOrPage();
            }

            const activeColX = currentCol === 1 ? col1X : col2X;
            cursorY = drawQuestionItem(currentPage, ctx, activeColX, cursorY, q);
            renderedCount += 1;
        }

        cursorY -= partGap; // spacing between parts
    }

    return pages;
}

function drawBookletPage1Header(page: PDFPage, ctx: BookletRenderContext): number {
    const { width, height, assessment, options, version, font, fontBold } = ctx;

    const y = height - MARGINS.top;
    const qrX = width - MARGINS.right - QR_CODE_CONFIG.size;
    const maxHeaderWidth = Math.max(160, qrX - MARGINS.left - 14);

    // Small system title
    page.drawText(
        truncateTextToWidth('TSEKI SMART ASSESSMENT SYSTEM | QUESTION BOOKLET', maxHeaderWidth, 8.5, fontBold),
        {
            x: MARGINS.left,
            y: y - 8,
            size: 8.5,
            font: fontBold,
            color: rgb(0.35, 0.38, 0.44),
        }
    );

    // Assessment title (auto-scales / wraps cleanly up to 2 lines strictly left of QR code)
    const titleText = assessment.quizTitle || (assessment as any).title || 'Assessment';
    const fittedTitle = fitHeaderText(titleText, maxHeaderWidth, fontBold, 15, 10.0, 2);
    const titleStartY = fittedTitle.lines.length > 1 ? y - 23 : y - 28;
    for (let i = 0; i < fittedTitle.lines.length; i++) {
        page.drawText(fittedTitle.lines[i], {
            x: MARGINS.left,
            y: titleStartY - i * fittedTitle.lineHeight,
            size: fittedTitle.fontSize,
            font: fontBold,
            color: rgb(0.1, 0.12, 0.16),
        });
    }

    // Subtitle: Class / Subject | Quiz | Version
    const lastTitleY = titleStartY - (fittedTitle.lines.length - 1) * fittedTitle.lineHeight;
    const subtitleY = fittedTitle.lines.length > 1 ? lastTitleY - 12.5 : y - 44;
    const classInfo = options.classTitle || 'Class Assessment';
    const subText = truncateTextToWidth(`${classInfo}  |  Version ${version}`, maxHeaderWidth, 9.5, font);
    page.drawText(subText, {
        x: MARGINS.left,
        y: subtitleY,
        size: 9.5,
        font: font,
        color: rgb(0.3, 0.35, 0.4),
    });

    // Warning strip: "Do NOT write on this booklet. Write every answer on your ANSWER SHEET."
    const stripHeight = 22;
    const stripY = Math.min(y - 78, subtitleY - stripHeight - 6);
    const stripWidth = width - MARGINS.left - MARGINS.right;

    page.drawRectangle({
        x: MARGINS.left,
        y: stripY,
        width: stripWidth,
        height: stripHeight,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    page.drawText('Do NOT write on this booklet. Write every answer on your ANSWER SHEET.', {
        x: MARGINS.left + 10,
        y: stripY + 6.5,
        size: 9.0,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    return stripY - 16;
}

function drawBookletContinuationHeader(page: PDFPage, ctx: BookletRenderContext): number {
    const { width, height, assessment, version, font, fontBold } = ctx;
    const y = height - MARGINS.top;
    const qrX = width - MARGINS.right - QR_CODE_CONFIG.size;
    const maxHeaderWidth = Math.max(160, qrX - MARGINS.left - 14);

    page.drawText(
        truncateTextToWidth('TSEKI SMART ASSESSMENT SYSTEM | QUESTION BOOKLET', maxHeaderWidth, 8.5, fontBold),
        {
            x: MARGINS.left,
            y: y - 8,
            size: 8.5,
            font: fontBold,
            color: rgb(0.35, 0.38, 0.44),
        }
    );

    const titleText = assessment.quizTitle || (assessment as any).title || 'Assessment';
    const fittedCont = fitHeaderText(`${titleText}  |  Version ${version}`, maxHeaderWidth, font, 9.5, 8.5, 2);
    for (let i = 0; i < fittedCont.lines.length; i++) {
        page.drawText(fittedCont.lines[i], {
            x: MARGINS.left,
            y: y - 22 - i * fittedCont.lineHeight,
            size: fittedCont.fontSize,
            font,
            color: rgb(0.25, 0.28, 0.32),
        });
    }

    // Thin separator line below QR code height
    const sepY = y - QR_CODE_CONFIG.size + 2;
    page.drawLine({
        start: { x: MARGINS.left, y: sepY },
        end: { x: width - MARGINS.right, y: sepY },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
    });

    return sepY - 14;
}

function drawPartBanner(
    page: PDFPage,
    ctx: BookletRenderContext,
    x: number,
    y: number,
    roman: string,
    title: string,
    pts: number,
    instructions: string
): number {
    const { colWidth, fontBold, font, fontSize } = ctx;
    const isCompact = fontSize <= 9.5;
    const bannerHeight = isCompact ? 14 : 16;
    const bannerFontSize = isCompact ? 8.2 : 9.0;
    const instFontSize = isCompact ? 7.5 : 8.5;
    const instLineH = isCompact ? 9.5 : 11;

    // Gray background banner
    page.drawRectangle({
        x,
        y: y - bannerHeight,
        width: colWidth,
        height: bannerHeight,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    const bannerText = truncateTextToWidth(
        `TEST ${roman}  |  ${title.toUpperCase()} (${pts} pts)`,
        colWidth - 12,
        bannerFontSize,
        fontBold
    );
    page.drawText(bannerText, {
        x: x + 6,
        y: y - bannerHeight + (isCompact ? 4.0 : 4.5),
        size: bannerFontSize,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
    });

    let nextY = y - bannerHeight - (isCompact ? 10 : 12);

    // Instructions
    if (instructions) {
        const lines = wrapText(instructions, colWidth, instFontSize, font);
        for (const line of lines) {
            page.drawText(line, {
                x,
                y: nextY,
                size: instFontSize,
                font,
                color: rgb(0.25, 0.25, 0.25),
            });
            nextY -= instLineH;
        }
        nextY -= isCompact ? 2 : 4;
    }

    return nextY;
}

function drawWordBankLinesBox(
    page: PDFPage,
    ctx: BookletRenderContext,
    x: number,
    y: number,
    lines: string[],
    bankSize: number,
    bankLineH: number,
    padding: number,
    bottomGap: number
): number {
    const { colWidth, fontBold } = ctx;
    const boxHeight = lines.length * bankLineH + padding * 2;

    page.drawRectangle({
        x,
        y: y - boxHeight,
        width: colWidth,
        height: boxHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.8,
    });

    let lineY = y - padding - bankSize;
    for (const line of lines) {
        page.drawText(line, {
            x: x + padding,
            y: lineY,
            size: bankSize,
            font: fontBold,
            color: rgb(0.15, 0.15, 0.15),
        });
        lineY -= bankLineH;
    }

    return y - boxHeight - bottomGap;
}

function drawQuestionItem(
    page: PDFPage,
    ctx: BookletRenderContext,
    x: number,
    y: number,
    q: ScannableQuestion
): number {
    const { colWidth, fontSize, lineHeight, font, fontBold } = ctx;
    const itemGap = fontSize >= 10.5 ? 6 : fontSize >= 9.0 ? 4.5 : 3.5;

    // Stem: number bold, text regular
    const numPrefix = `${q.questionNumber}. `;
    const numWidth = fontBold.widthOfTextAtSize(numPrefix, fontSize);

    const stemLines = wrapText(q.questionText, Math.max(50, colWidth - numWidth), fontSize, font);

    // Draw first line with number
    page.drawText(numPrefix, {
        x,
        y: y - fontSize,
        size: fontSize,
        font: fontBold,
        color: rgb(0, 0, 0),
    });

    if (stemLines.length > 0) {
        page.drawText(stemLines[0], {
            x: x + numWidth,
            y: y - fontSize,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
        });
    }

    let cursorY = y - lineHeight;

    // Subsequent stem lines indented
    for (let i = 1; i < stemLines.length; i++) {
        page.drawText(stemLines[i], {
            x: x + numWidth,
            y: cursorY - fontSize,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
        });
        cursorY -= lineHeight;
    }

    // Multiple choice options (uses compact 2x2 grid for short choices when fontSize <= 9.5)
    if (q.type === 'multiple_choice' && q.options && q.options.length > 0) {
        const optIndent = fontSize >= 10.0 ? 14 : 11;
        const optAvailWidth = Math.max(50, colWidth - optIndent);

        if (fontSize <= 9.5 && canPairMcOptions(q.options, optAvailWidth, fontSize, font)) {
            const halfColWidth = (optAvailWidth - 10) / 2;
            const secondColX = x + optIndent + halfColWidth + 10;

            for (let row = 0; row < q.options.length; row += 2) {
                for (let colIdx = 0; colIdx < 2; colIdx++) {
                    const optIdx = row + colIdx;
                    if (optIdx >= q.options.length) break;
                    const letter = String.fromCharCode(65 + optIdx);
                    const letterPrefix = `${letter}) `;
                    const letterWidth = fontBold.widthOfTextAtSize(letterPrefix, fontSize);
                    const optText = q.options[optIdx].replace(/^[A-D][.)]\s*/i, '').trim();
                    const cellX = colIdx === 0 ? x + optIndent : secondColX;

                    page.drawText(letterPrefix, {
                        x: cellX,
                        y: cursorY - fontSize,
                        size: fontSize,
                        font: fontBold,
                        color: rgb(0, 0, 0),
                    });
                    page.drawText(optText, {
                        x: cellX + letterWidth,
                        y: cursorY - fontSize,
                        size: fontSize,
                        font,
                        color: rgb(0.1, 0.1, 0.1),
                    });
                }
                cursorY -= lineHeight;
            }
        } else {
            for (let i = 0; i < q.options.length; i++) {
                const letter = String.fromCharCode(65 + i);
                const letterPrefix = `${letter}) `;
                const letterWidth = fontBold.widthOfTextAtSize(letterPrefix, fontSize);
                const optText = q.options[i].replace(/^[A-D][.)]\s*/i, '');
                const optLines = wrapText(optText, Math.max(40, optAvailWidth - letterWidth), fontSize, font);

                page.drawText(letterPrefix, {
                    x: x + optIndent,
                    y: cursorY - fontSize,
                    size: fontSize,
                    font: fontBold,
                    color: rgb(0, 0, 0),
                });

                if (optLines.length > 0) {
                    page.drawText(optLines[0], {
                        x: x + optIndent + letterWidth,
                        y: cursorY - fontSize,
                        size: fontSize,
                        font,
                        color: rgb(0.1, 0.1, 0.1),
                    });
                }

                cursorY -= lineHeight;

                for (let j = 1; j < optLines.length; j++) {
                    page.drawText(optLines[j], {
                        x: x + optIndent + letterWidth,
                        y: cursorY - fontSize,
                        size: fontSize,
                        font,
                        color: rgb(0.1, 0.1, 0.1),
                    });
                    cursorY -= lineHeight;
                }
            }
        }
    }

    return cursorY - itemGap; // gap between questions
}

function drawBookletFooter(
    page: PDFPage,
    ctx: BookletRenderContext,
    pageNum: number,
    totalPages: number
): void {
    const { width, quizId, version, assessment, font } = ctx;
    const y = MARGINS.bottom;

    const leftText = `Tseki Question Booklet | ${quizId} | Version ${version} | ${assessment.questions.length} items`;
    page.drawText(leftText, {
        x: MARGINS.left,
        y,
        size: 8.0,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });

    const rightText = `Do not write on this booklet | Page ${pageNum} of ${totalPages}`;
    const rightWidth = font.widthOfTextAtSize(rightText, 8.0);
    page.drawText(rightText, {
        x: width - MARGINS.right - rightWidth,
        y,
        size: 8.0,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });
}

interface QuestionPart {
    type: string;
    title: string;
    instructions: string;
    pts: number;
    wordBank?: string[];
    questions: ScannableQuestion[];
}

function groupQuestionsByPart(
    questions: ScannableQuestion[],
    answerKey?: AnswerKeyItem[]
): QuestionPart[] {
    const sharedWordBank = extractSharedWordBank(questions, answerKey);
    const effectiveWordBank =
        sharedWordBank.length > 0
            ? sharedWordBank
            : ['Option 1', 'Option 2', 'Option 3', 'Option 4'];
    const parts: QuestionPart[] = [];
    let currentPart: QuestionPart | null = null;

    for (const q of questions) {
        if (!currentPart || currentPart.type !== q.type) {
            const config = getPartConfig(q.type, effectiveWordBank.length);
            currentPart = {
                type: q.type,
                title: config.title,
                instructions: config.instructions,
                pts: 0,
                wordBank: q.type === 'word_box' ? effectiveWordBank : undefined,
                questions: [],
            };
            parts.push(currentPart);
        }
        currentPart.questions.push(q);
        currentPart.pts += q.type === 'enumeration' ? getEnumerationBoxCount(q, answerKey) : 1;
    }

    return parts;
}

function getPartConfig(type: string, wordBankCount: number = 0): { title: string; instructions: string } {
    switch (type) {
        case 'multiple_choice':
            return {
                title: 'Multiple Choice',
                instructions: 'Choose the best answer. Write only the LETTER (A, B, C, or D) on the answer sheet.',
            };
        case 'true_false':
            return {
                title: 'True or False',
                instructions: 'Write T if the statement is true, or F if it is false.',
            };
        case 'word_box':
            return {
                title: 'Word Box',
                instructions:
                    wordBankCount > 26
                        ? 'Pick the best word from the WORD BANK. Write the corresponding letter(s).'
                        : 'Pick the best word from the WORD BANK. Write the corresponding letter.',
            };
        case 'fill_blank':
            return {
                title: 'Fill in the Blank',
                instructions: 'Write the correct word or phrase to complete the statement.',
            };
        case 'identification':
            return {
                title: 'Identification',
                instructions: 'Identify the concept, term, or device described.',
            };
        case 'enumeration':
            return {
                title: 'Enumeration',
                instructions: 'List the required items. Write one answer per box.',
            };
        default:
            return {
                title: 'Assessment',
                instructions: 'Answer the following questions carefully.',
            };
    }
}

function toRoman(num: number): string {
    const map = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return map[num - 1] || `${num}`;
}
