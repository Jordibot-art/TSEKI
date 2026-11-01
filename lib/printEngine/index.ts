import { decideFit } from './fitDecision';
import { renderBookletPDF } from './bookletRenderer';
import { renderAnswerSheetPDF } from './answerSheetRenderer';
import { renderAllInOnePDF } from './allInOneRenderer';
import { renderAnswerKeyPDF } from './answerKeyRenderer';
import { PAPER_DIMENSIONS } from './constants';
import { GeneratedAssessment, LayoutJSON, PrintOptions, PrintPackage } from './types';

export * from './constants';
export * from './types';
export * from './measure';
export * from './fitDecision';
export * from './markers';
export * from './qrStamp';
export * from './bookletRenderer';
export * from './answerSheetRenderer';
export * from './allInOneRenderer';
export * from './answerKeyRenderer';
export * from './layoutJson';

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
 * Main public entry point for the printable paper layout engine.
 * Decides whether ALL-IN-ONE or SEPARATE is appropriate,
 * renders deterministic PDFs, and generates the layout JSON coordinate map.
 */
export async function generatePrintPackage(
    assessment: GeneratedAssessment,
    options: PrintOptions = {}
): Promise<PrintPackage> {
    const version = options.version || 'A';
    const paperSize = options.paperSize || 'short';
    const dims = PAPER_DIMENSIONS[paperSize];
    const quizId = options.quizId || `QZ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${assessment.questions.length}`;

    // 1. Run automatic fit decision
    const fit = await decideFit(assessment, options);

    // 2. Generate teacher answer key PDF
    const answerKeyPdf = await renderAnswerKeyPDF(assessment, {
        ...options,
        version,
        quizId,
        paperSize,
    });

    if (fit.mode === 'ALL_IN_ONE') {
        // Single page question + answer paper
        const { pdfBytes, pages } = await renderAllInOnePDF(assessment, {
            ...options,
            version,
            quizId,
            paperSize,
        }, fit.fontSize);

        const layoutJson: LayoutJSON = {
            quizId,
            version,
            pageSize: { width: dims.width, height: dims.height },
            pages,
            createdAt: new Date().toISOString(),
        };

        return {
            pdfs: {
                studentPdf: pdfBytes,
                answerKeyPdf,
            },
            layoutJson,
            mode: 'ALL_IN_ONE',
            fontSize: fit.fontSize,
            pages: 1,
            fitMessage: fit.fitMessage,
        };
    } else {
        // Separate question booklet + scannable answer sheet
        const bookletPdf = await renderBookletPDF(assessment, {
            ...options,
            version,
            quizId,
            paperSize,
        });

        const { pdfBytes: answerSheetPdf, pages } = await renderAnswerSheetPDF(assessment.questions, {
            ...options,
            version,
            quizId,
            paperSize,
        });

        const layoutJson: LayoutJSON = {
            quizId,
            version,
            pageSize: { width: dims.width, height: dims.height },
            pages,
            createdAt: new Date().toISOString(),
        };

        return {
            pdfs: {
                studentPdf: bookletPdf,
                answerSheetPdf,
                answerKeyPdf,
            },
            layoutJson,
            mode: 'SEPARATE',
            fontSize: fit.fontSize,
            pages: fit.pages,
            fitMessage: fit.fitMessage,
        };
    }
}
