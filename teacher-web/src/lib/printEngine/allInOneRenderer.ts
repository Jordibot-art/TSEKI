// teacher-web/src/lib/printEngine/allInOneRenderer.ts

import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import { abortableDelay, throwIfExportAborted } from './cancel';
import { COLORS, FONT_CONFIG, MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from './constants';
import { embedPrintFonts } from './fonts/embedFonts';
import { topY } from './layoutJson';
import { drawCornerMarkers } from './markers';
import {
    canPairMcOptions,
    extractSharedWordBank,
    fitHeaderText,
    getAllInOneItemMetrics,
    getAllInOneSectionBannerHeight,
    getEnumerationBoxCount,
    getLineHeightFactor,
    getMeasureBoldFont,
    getMeasureFont,
    getWordBankMaxChars,
    measureAllInOneColumns,
    measureWordBankLayout,
    truncateTextToWidth,
    wrapText,
} from './measure';
import { drawQRCode } from './qrStamp';
import type { AnswerKeyItem, GeneratedAssessment, LayoutItem, LayoutPage, PrintOptions, QRRect, ScannableQuestion } from './types';

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
    gradeLevel?: string;
}

interface ColumnSpacingBonus {
    boxHeightBonus: number;
    itemGapBonus: number;
}

function isPrimaryGrade(gradeLevel?: string): boolean {
    return Boolean(gradeLevel && /^(grade\s*[1-3]|1|2|3)$/i.test(gradeLevel.trim()));
}

function toRoman(num: number): string {
    const map = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return map[num - 1] || `${num}`;
}

function formatAllInOnePartTitle(type: ScannableQuestion['type'], partIndex: number, wordBoxMaxChars: number): string {
    const roman = toRoman(partIndex);
    switch (type) {
        case 'multiple_choice':
            return `PART ${roman} · MULTIPLE CHOICE (Write A, B, C, or D)`;
        case 'true_false':
            return `PART ${roman} · TRUE OR FALSE (Write T or F)`;
        case 'word_box':
            return wordBoxMaxChars > 1
                ? `PART ${roman} · WORD BOX (Write Word Bank letter(s))`
                : `PART ${roman} · WORD BOX (Write Word Bank letter)`;
        case 'fill_blank':
            return `PART ${roman} · FILL IN THE BLANK`;
        case 'identification':
            return `PART ${roman} · IDENTIFICATION`;
        case 'enumeration':
            return `PART ${roman} · ENUMERATION (One answer per numbered box)`;
        default:
            return `PART ${roman} · ASSESSMENT`;
    }
}

function buildAllInOneInstructionLine(questions: ScannableQuestion[], paperSize: 'short' | 'long'): string {
    const uniqueTypes = Array.from(new Set(questions.map((q) => q.type)));
    if (uniqueTypes.length === 1) {
        const only = uniqueTypes[0];
        if (only === 'true_false') {
            return 'Write T if the statement is True, or F if False clearly inside each designated answer box.';
        }
        if (only === 'identification' || only === 'fill_blank') {
            return 'Write the exact term or phrase clearly inside each answer box. Keep handwriting inside the box.';
        }
        if (only === 'enumeration') {
            return 'Write one required answer inside each numbered box (e.g. 1.1, 1.2). Do not write outside the boxes.';
        }
        if (only === 'word_box') {
            return 'Choose the correct entry from the WORD BANK below and write its CAPITAL LETTER(S) inside each box.';
        }
        return 'Write the CAPITAL LETTER (A, B, C, or D) of your chosen answer clearly inside each answer box.';
    }

    const hints: string[] = [];
    if (uniqueTypes.includes('multiple_choice')) hints.push('MC: A-D');
    if (uniqueTypes.includes('true_false')) hints.push('T/F: T or F');
    if (uniqueTypes.includes('word_box')) hints.push('Word Box: Bank Letter');
    if (uniqueTypes.includes('identification') || uniqueTypes.includes('fill_blank')) hints.push('ID/Blank: Clear Term');
    if (uniqueTypes.includes('enumeration')) hints.push('Enum: 1 Item per Box');
    const paperTag = paperSize === 'long' ? 'Long Bond' : 'Short Bond';
    return `Write answers clearly inside boxes (${hints.join('  |  ')}). Keep ${paperTag} corner squares clear.`;
}

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
        const textSample = [
            assessment.quizTitle,
            options.classTitle,
            ...assessment.questions.map((q) => `${q.questionText || ''} ${(q.options || []).join(' ')}`),
            ...(assessment.answerKey || []).map((k) => k.correctAnswer || ''),
        ].filter(Boolean).join('\n');
        const embedded = await embedPrintFonts(doc, textSample);
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

    const totalPoints = assessment.questions.reduce((sum, q) => {
        if (q.type === 'enumeration') return sum + getEnumerationBoxCount(q, assessment.answerKey);
        const keyItem = assessment.answerKey?.find((k) => k.questionNumber === q.questionNumber);
        return sum + (keyItem?.points || 1);
    }, 0);

    const ctx: AllInOneContext = {
        doc,
        font,
        fontBold,
        width: dims.width,
        height: dims.height,
        printableWidth,
        fontSize: selectedFontSize,
        lineHeight: selectedFontSize * getLineHeightFactor(selectedFontSize),
        colWidth,
        colGutter,
        version,
        quizId,
        totalPoints,
        gradeLevel: options.gradeLevel,
    };

    const page = doc.addPage([dims.width, dims.height]);
    const markers = drawCornerMarkers(page, dims.width, dims.height);

    const title = assessment.quizTitle || (assessment as any).title || 'Classroom Assessment';
    const { cursorY, qr } = drawAllInOneHeader(
        page,
        ctx,
        options,
        title,
        assessment.questions,
        paperSize
    );
    if (!options.skipPdfSave) {
        await abortableDelay(0, options.signal);
    }

    const layoutItems: LayoutItem[] = [];
    drawAllInOneColumns(page, ctx, cursorY, assessment.questions, assessment.answerKey, layoutItems, paperSize);

    drawAllInOneFooter(page, ctx, assessment.questions.length, paperSize);

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
    questions: ScannableQuestion[],
    paperSize: 'short' | 'long'
): { cursorY: number; qr: QRRect } {
    const { width, height, font, fontBold, version, quizId, totalPoints } = ctx;
    const itemCount = questions.length;
    const startY = height - MARGINS.top - 4;
    const headerTextX = MARGINS.left + 24;

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

    const maxHeaderWidth = Math.max(120, scoreBoxX - headerTextX - 12);

    const paperLabel = paperSize === 'long' ? 'LONG BOND 8.5x13"' : 'SHORT BOND 8.5x11"';
    const eyebrowText = truncateTextToWidth(
        `TSEKI SMART ASSESSMENT SYSTEM | ${paperLabel}`,
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

    const nameY = Math.min(startY - 63, subtitleY - 13.5);
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

    const instY = dateY - 13;
    const instBoxWidth = width - MARGINS.left - MARGINS.right;
    page.drawRectangle({
        x: MARGINS.left,
        y: instY - 2,
        width: instBoxWidth,
        height: 14,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    const instText = truncateTextToWidth(
        buildAllInOneInstructionLine(questions, paperSize),
        instBoxWidth - 12,
        7.0,
        fontBold
    );
    page.drawText(instText, {
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
    answerKey: AnswerKeyItem[] | undefined,
    layoutItems: LayoutItem[],
    paperSize: 'short' | 'long'
): void {
    const { colWidth, colGutter, font, fontBold, printableWidth } = ctx;
    const footerSafeBottomY = MARGINS.bottom + 16;

    const sharedWordBank = extractSharedWordBank(questions, answerKey);
    const wordBoxMaxChars = getWordBankMaxChars(sharedWordBank.length);

    const minFontFloor = isPrimaryGrade(ctx.gradeLevel)
        ? FONT_CONFIG.MIN_SIZE_PRIMARY
        : paperSize === 'long'
            ? 7.5
            : 8.0;

    let activeFontSize = ctx.fontSize;
    let wbLayout =
        sharedWordBank.length > 0
            ? measureWordBankLayout(sharedWordBank, printableWidth, activeFontSize, fontBold, 'ALL_IN_ONE')
            : null;
    let colPlan = measureAllInOneColumns(
        questions,
        activeFontSize,
        colWidth,
        font,
        wordBoxMaxChars,
        answerKey,
        fontBold,
        paperSize
    );

    while (
        activeFontSize > minFontFloor &&
        colPlan.maxHeight > startY - (wbLayout ? wbLayout.totalHeight : 0) - footerSafeBottomY
    ) {
        activeFontSize = Math.max(minFontFloor, Math.round((activeFontSize - 0.5) * 10) / 10);
        wbLayout =
            sharedWordBank.length > 0
                ? measureWordBankLayout(sharedWordBank, printableWidth, activeFontSize, fontBold, 'ALL_IN_ONE')
                : null;
        colPlan = measureAllInOneColumns(
            questions,
            activeFontSize,
            colWidth,
            font,
            wordBoxMaxChars,
            answerKey,
            fontBold,
            paperSize
        );
    }

    ctx.fontSize = activeFontSize;
    ctx.lineHeight = activeFontSize * getLineHeightFactor(activeFontSize);

    let bodyStartY = startY;
    if (wbLayout && sharedWordBank.length > 0) {
        page.drawRectangle({
            x: MARGINS.left,
            y: bodyStartY - wbLayout.boxHeight,
            width: printableWidth,
            height: wbLayout.boxHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.75, 0.78, 0.82),
            borderWidth: 0.8,
        });

        let lineY = bodyStartY - wbLayout.padding - wbLayout.bankSize;
        for (const line of wbLayout.lines) {
            page.drawText(line, {
                x: MARGINS.left + wbLayout.padding,
                y: lineY,
                size: wbLayout.bankSize,
                font: fontBold,
                color: rgb(0.15, 0.15, 0.15),
            });
            lineY -= wbLayout.lineHeight;
        }
        bodyStartY -= wbLayout.totalHeight;
    }

    const col1X = MARGINS.left;
    const col2X = MARGINS.left + colWidth + colGutter;

    const col1Questions = questions.slice(0, colPlan.splitIndex);
    const col2Questions = questions.slice(colPlan.splitIndex);

    const hasMultipleTypes = new Set(questions.map((q) => q.type)).size > 1;
    const partIndexByQNum = new Map<number, number>();
    let pCounter = 0;
    let lastSeenType: ScannableQuestion['type'] | null = null;
    for (const q of questions) {
        if (q.type !== lastSeenType) {
            pCounter += 1;
            lastSeenType = q.type;
        }
        partIndexByQNum.set(q.questionNumber, pCounter);
    }

    const availableBodyHeight = Math.max(0, bodyStartY - footerSafeBottomY);
    const rawSlack = Math.max(0, availableBodyHeight - colPlan.maxHeight);

    const countBoxRowsInCol = (list: ScannableQuestion[]) =>
        list.reduce((acc, q) => {
            const m = getAllInOneItemMetrics(q, activeFontSize, colWidth, wordBoxMaxChars, answerKey);
            if (m.boxLayout === 'below_grid2') return acc + Math.ceil(m.enumBoxes / 2);
            if (m.boxLayout === 'below_full') return acc + m.enumBoxes;
            return acc + 1;
        }, 0);

    const maxBoxRows = Math.max(1, countBoxRowsInCol(col1Questions), countBoxRowsInCol(col2Questions));
    const maxColItems = Math.max(1, col1Questions.length, col2Questions.length);

    let boxHeightBonus = 0;
    let itemGapBonus = 0;
    if (rawSlack > 8 && questions.length > 0) {
        boxHeightBonus = Math.min(3.5, (rawSlack * 0.4) / maxBoxRows);
        const remainingSlack = Math.max(0, rawSlack - boxHeightBonus * maxBoxRows - 4);
        const maxGapBonus = paperSize === 'long' ? 6.5 : 4.5;
        itemGapBonus = Math.min(maxGapBonus, remainingSlack / maxColItems);
    }

    const bonus: ColumnSpacingBonus = { boxHeightBonus, itemGapBonus };
    const col1LastType = col1Questions.length > 0 ? col1Questions[col1Questions.length - 1].type : null;

    const allowOptionPairing =
        paperSize === 'long'
            ? activeFontSize <= 10.0
            : activeFontSize <= 9.5 && questions.length <= 20;

    renderQuestionColumn(
        page,
        ctx,
        col1X,
        bodyStartY,
        col1Questions,
        answerKey,
        layoutItems,
        wordBoxMaxChars,
        hasMultipleTypes,
        partIndexByQNum,
        null,
        bonus,
        allowOptionPairing
    );
    renderQuestionColumn(
        page,
        ctx,
        col2X,
        bodyStartY,
        col2Questions,
        answerKey,
        layoutItems,
        wordBoxMaxChars,
        hasMultipleTypes,
        partIndexByQNum,
        col1LastType,
        bonus,
        allowOptionPairing
    );
}

function drawAllInOneSectionBanner(
    page: PDFPage,
    ctx: AllInOneContext,
    x: number,
    cursorY: number,
    title: string,
    isFirstInColumn: boolean
): number {
    const { colWidth, fontBold, fontSize } = ctx;
    const isCompact = fontSize <= 9.5;
    const bannerH = isCompact ? 12.5 : 14;
    const topGap = isFirstInColumn ? 0 : isCompact ? 3 : 4.5;
    const bannerTopY = cursorY - topGap;

    page.drawRectangle({
        x,
        y: bannerTopY - bannerH,
        width: colWidth,
        height: bannerH,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
    });

    const bannerFontSize = isCompact ? 7.2 : 7.8;
    page.drawText(truncateTextToWidth(title, colWidth - 10, bannerFontSize, fontBold), {
        x: x + 5,
        y: bannerTopY - bannerH + (isCompact ? 3.5 : 4.0),
        size: bannerFontSize,
        font: fontBold,
        color: rgb(0.12, 0.14, 0.18),
    });

    return cursorY - getAllInOneSectionBannerHeight(fontSize, isFirstInColumn);
}

function drawLabeledTextBox(
    page: PDFPage,
    x: number,
    y: number,
    badgeWidth: number,
    boxWidth: number,
    boxHeight: number,
    badgeText: string,
    fontBold: PDFFont
): void {
    page.drawRectangle({
        x,
        y,
        width: badgeWidth,
        height: boxHeight,
        color: rgb(COLORS.lightGray[0], COLORS.lightGray[1], COLORS.lightGray[2]),
        borderColor: rgb(0.3, 0.3, 0.3),
        borderWidth: 0.8,
    });

    const maxBadgeFont = boxHeight <= 17 ? 6.8 : 7.4;
    let badgeFontSize = maxBadgeFont;
    while (badgeFontSize > 5.5 && fontBold.widthOfTextAtSize(badgeText, badgeFontSize) > badgeWidth - 4) {
        badgeFontSize -= 0.4;
    }
    const badgeW = fontBold.widthOfTextAtSize(badgeText, badgeFontSize);
    page.drawText(badgeText, {
        x: x + (badgeWidth - badgeW) / 2,
        y: y + (boxHeight - badgeFontSize) / 2 + 0.8,
        size: badgeFontSize,
        font: fontBold,
        color: rgb(0.12, 0.12, 0.12),
    });

    page.drawRectangle({
        x: x + badgeWidth,
        y,
        width: boxWidth,
        height: boxHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 0.8,
    });
}

function renderQuestionColumn(
    page: PDFPage,
    ctx: AllInOneContext,
    startX: number,
    startY: number,
    questions: ScannableQuestion[],
    answerKey: AnswerKeyItem[] | undefined,
    layoutItems: LayoutItem[],
    wordBoxMaxChars: number,
    hasMultipleTypes: boolean,
    partIndexByQNum: Map<number, number>,
    initialPrevType: ScannableQuestion['type'] | null,
    bonus: ColumnSpacingBonus,
    allowOptionPairing: boolean
): void {
    const { colWidth, fontSize, lineHeight, font, fontBold } = ctx;
    let cursorY = startY;
    let prevType = initialPrevType;

    for (let idx = 0; idx < questions.length; idx++) {
        const q = questions[idx];

        if (hasMultipleTypes && q.type !== prevType) {
            const pIdx = partIndexByQNum.get(q.questionNumber) || 1;
            const partTitle = formatAllInOnePartTitle(q.type, pIdx, wordBoxMaxChars);
            cursorY = drawAllInOneSectionBanner(page, ctx, startX, cursorY, partTitle, idx === 0);
            prevType = q.type;
        }

        const metrics = getAllInOneItemMetrics(q, fontSize, colWidth, wordBoxMaxChars, answerKey);
        const {
            isLetter,
            isEnumeration,
            enumBoxes,
            boxLayout,
            badgeWidth,
            boxWidth,
            textWidth,
            itemGap,
            maxChars,
        } = metrics;

        const boxHeight = metrics.boxHeight + bonus.boxHeightBonus;
        const effectiveItemGap = itemGap + bonus.itemGapBonus;

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

        if (q.type === 'multiple_choice' && q.options && q.options.length > 0) {
            const optFontSize = fontSize * 0.94;
            const optLineH = lineHeight * 0.94;
            const optIndent = 10;
            const optAvailWidth = Math.max(50, textWidth - optIndent);

            if (allowOptionPairing && canPairMcOptions(q.options, optAvailWidth, optFontSize, font)) {
                const halfColWidth = (optAvailWidth - 10) / 2;
                const secondColX = startX + optIndent + halfColWidth + 10;

                for (let row = 0; row < q.options.length; row += 2) {
                    for (let colIdx = 0; colIdx < 2; colIdx++) {
                        const optIdx = row + colIdx;
                        if (optIdx >= q.options.length) break;
                        const optLetter = String.fromCharCode(65 + optIdx);
                        const optPrefix = `${optLetter}) `;
                        const optPrefixW = fontBold.widthOfTextAtSize(optPrefix, optFontSize);
                        const optText = q.options[optIdx].replace(/^[A-D][.)]\s*/i, '').trim();
                        const cellX = colIdx === 0 ? startX + optIndent : secondColX;

                        page.drawText(optPrefix, {
                            x: cellX,
                            y: cursorY - optFontSize,
                            size: optFontSize,
                            font: fontBold,
                            color: rgb(0.1, 0.1, 0.1),
                        });
                        page.drawText(optText, {
                            x: cellX + optPrefixW,
                            y: cursorY - optFontSize,
                            size: optFontSize,
                            font,
                            color: rgb(0.15, 0.15, 0.15),
                        });
                    }
                    cursorY -= optLineH;
                }
            } else {
                for (let i = 0; i < q.options.length; i++) {
                    const optLetter = String.fromCharCode(65 + i);
                    const optPrefix = `${optLetter}) `;
                    const optPrefixW = fontBold.widthOfTextAtSize(optPrefix, optFontSize);
                    const optText = q.options[i].replace(/^[A-D][.)]\s*/i, '');
                    const optLines = wrapText(optText, Math.max(40, optAvailWidth - optPrefixW), optFontSize, font);

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
        }

        if (boxLayout === 'below_grid2') {
            cursorY -= 2.5;
            const enumGapY = 3;
            const subColGutter = 8;
            const cellWidth = (colWidth - subColGutter) / 2;
            const rows = Math.ceil(enumBoxes / 2);
            let subIdx = 1;

            for (let r = 0; r < rows; r++) {
                const rowBoxY = cursorY - boxHeight;
                for (let c = 0; c < 2 && subIdx <= enumBoxes; c++) {
                    const cellX = startX + c * (cellWidth + subColGutter);
                    const label = `${q.questionNumber}.${subIdx}`;
                    drawLabeledTextBox(page, cellX, rowBoxY, badgeWidth, boxWidth, boxHeight, label, fontBold);

                    layoutItems.push({
                        questionNumber: q.questionNumber,
                        subIndex: subIdx,
                        type: 'text',
                        rect: {
                            x: cellX + badgeWidth,
                            y: topY(rowBoxY, boxHeight, ctx.height),
                            width: boxWidth,
                            height: boxHeight,
                        },
                        maxChars,
                    });
                    subIdx += 1;
                }
                cursorY = rowBoxY - (r < rows - 1 ? enumGapY : 0);
            }
            cursorY -= effectiveItemGap;
        } else if (boxLayout === 'below_full') {
            cursorY -= 2.5;
            if (isEnumeration) {
                const enumGapY = 3;
                for (let b = 0; b < enumBoxes; b++) {
                    const rowBoxY = cursorY - boxHeight;
                    const label = `${q.questionNumber}.${b + 1}`;
                    drawLabeledTextBox(page, startX, rowBoxY, badgeWidth, boxWidth, boxHeight, label, fontBold);

                    layoutItems.push({
                        questionNumber: q.questionNumber,
                        subIndex: b + 1,
                        type: 'text',
                        rect: {
                            x: startX + badgeWidth,
                            y: topY(rowBoxY, boxHeight, ctx.height),
                            width: boxWidth,
                            height: boxHeight,
                        },
                        maxChars,
                    });
                    cursorY = rowBoxY - (b < enumBoxes - 1 ? enumGapY : 0);
                }
            } else {
                const rowBoxY = cursorY - boxHeight;
                const label = `${q.questionNumber}`;
                drawLabeledTextBox(page, startX, rowBoxY, badgeWidth, boxWidth, boxHeight, label, fontBold);

                layoutItems.push({
                    questionNumber: q.questionNumber,
                    type: 'text',
                    rect: {
                        x: startX + badgeWidth,
                        y: topY(rowBoxY, boxHeight, ctx.height),
                        width: boxWidth,
                        height: boxHeight,
                    },
                    maxChars,
                });
                cursorY = rowBoxY;
            }
            cursorY -= effectiveItemGap;
        } else {
            const boxX = startX + colWidth - boxWidth;
            const indicatorFontSize = 6.5;
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

            const numLabel = `${q.questionNumber}`;
            const numLabelW = fontBold.widthOfTextAtSize(numLabel, indicatorFontSize);
            page.drawText(numLabel, {
                x: boxX - numLabelW - 4,
                y: boxY + boxHeight / 2 - 2.5,
                size: indicatorFontSize,
                font: fontBold,
                color: rgb(0.4, 0.4, 0.4),
            });

            const itemType =
                q.type === 'true_false'
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
                maxChars,
            });

            cursorY = Math.min(cursorY, boxY) - effectiveItemGap;
        }
    }
}

function drawAllInOneFooter(
    page: PDFPage,
    ctx: AllInOneContext,
    itemCount: number,
    paperSize: 'short' | 'long'
): void {
    const { quizId, version, totalPoints, font } = ctx;
    const y = MARGINS.bottom;
    const bondTag = paperSize === 'long' ? 'Long Bond' : 'Short Bond';

    const text = `Tseki All-in-One (${bondTag})  |  ${quizId}  |  Version ${version}  |  ${itemCount} Items  |  ${totalPoints} Points`;
    page.drawText(text, {
        x: MARGINS.left + 24,
        y,
        size: 7.5,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });
}
