// lib/printEngine/index.ts

import { PDFDocument } from 'pdf-lib';
import { renderAllInOnePDF } from './allInOneRenderer';
import { renderAnswerKeyPDF } from './answerKeyRenderer';
import { renderAnswerSheetPDF } from './answerSheetRenderer';
import { renderBookletPDF } from './bookletRenderer';
import { PAPER_DIMENSIONS } from './constants';
import { decideFit } from './fitDecision';
import { buildLayoutJSON, generateAnswerVariants } from './layoutJson';
import { GeneratedAssessment, LayoutPage, PrintOptions, PrintPackage } from './types';
import { shuffleAssessmentForVersion } from './versionShuffle';

export * from './allInOneRenderer';
export * from './answerKeyRenderer';
export * from './answerSheetRenderer';
export * from './bookletRenderer';
export * from './constants';
export * from './fitDecision';
export * from './layoutJson';
export * from './markers';
export * from './measure';
export * from './qrStamp';
export * from './types';
export * from './versionShuffle';

/**
 * Encodes a Uint8Array to a base64 string safely across mobile, web, and node runtimes.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        for (let j = 0; j < chunk.length; j++) {
            binary += String.fromCharCode(chunk[j]);
        }
    }
    return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Merges multiple PDF byte arrays into a single sequential PDF document.
 * Useful for combining question booklet and answer sheet into one printable file.
 */
export async function mergePdfs(pdfBytesList: Uint8Array[]): Promise<Uint8Array> {
    const mergedDoc = await PDFDocument.create();
    for (const bytes of pdfBytesList) {
        if (!bytes || bytes.byteLength === 0) continue;
        const srcDoc = await PDFDocument.load(bytes);
        const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedDoc.addPage(page));
    }
    return await mergedDoc.save();
}

/**
 * Main public entry point for the printable paper layout engine.
 * Decides whether ALL-IN-ONE or SEPARATE is appropriate,
 * renders deterministic PDFs, and generates the layout JSON coordinate map.
 */
export async function generatePrintPackage(
    assessment: GeneratedAssessment,
    options: PrintOptions = {}
): Promise<PrintPackage> {
    const target = options.target || 'ALL';
    const version = options.version || 'A';
    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    // Apply deterministic version shuffle (Set A = original, Set B/C = shuffled)
    const activeAssessment = shuffleAssessmentForVersion(assessment, version, quizId);
    const answerVariants = generateAnswerVariants(activeAssessment);

    // 1. Run automatic fit decision
    const fit = await decideFit(activeAssessment, options);
    // Yield to the JS event loop to keep animations fluid
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 2. Handle fast 'LAYOUT_ONLY' target (used by quiz publishing)
    if (target === 'LAYOUT_ONLY') {
        const renderOpts: PrintOptions = {
            ...options,
            version,
            quizId,
            paperSize,
            skipPdfSave: true,
        };

        let layoutPages: LayoutPage[] = [];
        if (fit.mode === 'ALL_IN_ONE') {
            const { pages } = await renderAllInOnePDF(activeAssessment, renderOpts, fit.fontSize);
            layoutPages = pages;
        } else {
            const { pages } = await renderAnswerSheetPDF(activeAssessment.questions, renderOpts);
            layoutPages = pages;
        }

        const layoutJson = buildLayoutJSON({
            quizId,
            version,
            pageSize: { width: dims.width, height: dims.height },
            pages: layoutPages,
            answerVariants,
        });

        const emptyBytes = new Uint8Array();
        return {
            studentPdf: emptyBytes,
            answerKeyPdf: emptyBytes,
            layoutJson,
            mode: fit.mode,
            fontSize: fit.fontSize,
            pages: fit.mode === 'ALL_IN_ONE' ? 1 : fit.pages,
            fitMessage: fit.fitMessage,
        };
    }

    // 3. Render Answer Key PDF if requested
    let answerKeyPdf: Uint8Array = new Uint8Array();
    if (target === 'ALL' || target === 'ANSWER_KEY_ONLY') {
        answerKeyPdf = await renderAnswerKeyPDF(activeAssessment, {
            ...options,
            version,
            quizId,
            paperSize,
        });
    }

    if (target === 'ANSWER_KEY_ONLY') {
        const emptyBytes = new Uint8Array();
        return {
            studentPdf: emptyBytes,
            answerKeyPdf,
            layoutJson: buildLayoutJSON({
                quizId,
                version,
                pageSize: { width: dims.width, height: dims.height },
                pages: [],
                answerVariants,
            }),
            mode: fit.mode,
            fontSize: fit.fontSize,
            pages: 1,
            fitMessage: fit.fitMessage,
        };
    }

    // 4. Render Student Papers
    if (fit.mode === 'ALL_IN_ONE') {
        const { pdfBytes, pages } = await renderAllInOnePDF(
            activeAssessment,
            {
                ...options,
                version,
                quizId,
                paperSize,
            },
            fit.fontSize
        );

        const layoutJson = buildLayoutJSON({
            quizId,
            version,
            pageSize: { width: dims.width, height: dims.height },
            pages,
            answerVariants,
        });

        return {
            studentPdf: pdfBytes,
            answerKeyPdf,
            layoutJson,
            mode: 'ALL_IN_ONE',
            fontSize: fit.fontSize,
            pages: 1,
            fitMessage: fit.fitMessage,
        };
    } else {
        // Separate question booklet + scannable answer sheet
        const bookletPdf = await renderBookletPDF(activeAssessment, {
            ...options,
            version,
            quizId,
            paperSize,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        const { pdfBytes: answerSheetPdf, pages } = await renderAnswerSheetPDF(activeAssessment.questions, {
            ...options,
            version,
            quizId,
            paperSize,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Merge booklet + answer sheet into single printable document for teachers
        const combinedStudentPdf = await mergePdfs([bookletPdf, answerSheetPdf]);

        const layoutJson = buildLayoutJSON({
            quizId,
            version,
            pageSize: { width: dims.width, height: dims.height },
            pages,
            answerVariants,
        });

        return {
            studentPdf: bookletPdf,
            answerSheetPdf,
            combinedStudentPdf,
            answerKeyPdf,
            layoutJson,
            mode: 'SEPARATE',
            fontSize: fit.fontSize,
            pages: fit.pages,
            fitMessage: fit.fitMessage,
        };
    }
}
