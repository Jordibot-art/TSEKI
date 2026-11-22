import './nodeIO';
import assert from 'assert';
import { PDFDocument } from 'pdf-lib';
import { renderAllInOnePDF } from '../allInOneRenderer';
import { renderAnswerKeyPDF } from '../answerKeyRenderer';
import { renderAnswerSheetPDF } from '../answerSheetRenderer';
import { renderBookletPDF } from '../bookletRenderer';
import { MARGINS, PAPER_DIMENSIONS, QR_CODE_CONFIG } from '../constants';
import { embedPrintFonts } from '../fonts/embedFonts';
import { fitHeaderText, measureTextWidth, truncateTextToWidth } from '../measure';
import { GeneratedAssessment } from '../types';

async function main() {
    console.log('=== Testing Long PDF Header Fit & Zero QR / Score Box Overlap ===');

    const doc = await PDFDocument.create();
    const { regular, bold } = await embedPrintFonts(doc);

    const dims = PAPER_DIMENSIONS.short;
    const qrSize = QR_CODE_CONFIG.size;
    const allInOneQrX = dims.width - MARGINS.right - 24 - qrSize;
    const allInOneScoreBoxX = allInOneQrX - 12 - 80;
    const allInOneMaxHeaderW = allInOneScoreBoxX - (MARGINS.left + 24) - 12;

    // 1. Short title stays 1 line at preferred 13.5 pt
    const shortRes = fitHeaderText('Quiz 1: Fractions', allInOneMaxHeaderW, bold, 13.5, 9.5, 2);
    assert.strictEqual(shortRes.lines.length, 1);
    assert.strictEqual(shortRes.fontSize, 13.5);
    assert.strictEqual(shortRes.lines[0], 'Quiz 1: Fractions');
    console.log('  PASS: Short title preserves 1-line 13.5pt layout');

    // 2. Real long title from user report wraps cleanly within maxHeaderWidth
    const longTitle = 'Introduction to Client-Server Systems & Server Hardware Components';
    const longRes = fitHeaderText(longTitle, allInOneMaxHeaderW, bold, 13.5, 9.5, 2);
    assert.ok(longRes.lines.length >= 1 && longRes.lines.length <= 2);
    for (const line of longRes.lines) {
        const w = measureTextWidth(line, longRes.fontSize, bold);
        assert.ok(
            w <= allInOneMaxHeaderW + 0.01,
            `Line "${line}" (${w.toFixed(1)}pt) exceeded maxHeaderWidth (${allInOneMaxHeaderW}pt)`
        );
    }
    console.log(
        `  PASS: Long title fits cleanly in ${longRes.lines.length} lines at ${longRes.fontSize}pt -> ${JSON.stringify(longRes.lines)}`
    );

    // 3. Extremely long title (200+ chars) caps at 2 lines with ellipsis, zero overflow
    const extremeTitle =
        'Comprehensive Midterm Examination on Enterprise Client-Server Systems, Redundant Array of Independent Disks, Fault-Tolerant Server Hardware, and Distributed Data Center Architectures';
    const extremeRes = fitHeaderText(extremeTitle, allInOneMaxHeaderW, bold, 13.5, 9.5, 2);
    assert.strictEqual(extremeRes.lines.length, 2);
    assert.ok(extremeRes.lines[1].endsWith('...'));
    for (const line of extremeRes.lines) {
        const w = measureTextWidth(line, extremeRes.fontSize, bold);
        assert.ok(
            w <= allInOneMaxHeaderW + 0.01,
            `Extreme line "${line}" (${w.toFixed(1)}pt) exceeded maxHeaderWidth (${allInOneMaxHeaderW}pt)`
        );
    }
    console.log(
        `  PASS: Extreme 180+ char title capped at 2 lines with clean ellipsis at ${extremeRes.fontSize}pt`
    );

    // 4. Single unbroken giant token never overflows maxHeaderWidth
    const unbroken = 'SuperLongUnbrokenAssessmentTitleWithoutAnySpacesAtAllWhatsoever1234567890';
    const unbrokenRes = fitHeaderText(unbroken, allInOneMaxHeaderW, bold, 13.5, 9.5, 2);
    for (const line of unbrokenRes.lines) {
        const w = measureTextWidth(line, unbrokenRes.fontSize, bold);
        assert.ok(w <= allInOneMaxHeaderW + 0.01, `Unbroken token exceeded maxHeaderWidth: ${w}`);
    }
    const truncated = truncateTextToWidth(unbroken, 180, 9.0, regular);
    assert.ok(measureTextWidth(truncated, 9.0, regular) <= 180 + 0.01);
    console.log('  PASS: Unbroken giant tokens strictly bounded within maxWidth');

    // 5. Full end-to-end PDF generation across ALL 4 renderers with extreme titles & class names
    const sampleAssessment: GeneratedAssessment = {
        quizTitle: extremeTitle,
        questions: [
            {
                questionNumber: 1,
                type: 'multiple_choice',
                questionText: 'In the client-server model, what is the primary role of the client?',
                options: [
                    'Provides centralized resources',
                    'Requests services from servers',
                    'Manages RAID storage pools',
                    'Routes BGP internet packets',
                ],
                answerBoxesRequired: 1,
            },
            {
                questionNumber: 2,
                type: 'multiple_choice',
                questionText: 'Which of the following detects and fixes memory data corruption?',
                options: ['DDR4 Non-ECC', 'L1 Cache', 'ECC RAM', 'Flash ROM'],
                answerBoxesRequired: 1,
            },
        ],
        answerKey: [
            { questionNumber: 1, correctAnswer: 'B', points: 1 },
            { questionNumber: 2, correctAnswer: 'C', points: 1 },
        ],
    };

    const opts = {
        paperSize: 'short' as const,
        version: 'A' as const,
        classTitle: 'BSIT 4A - Advanced Networking & Enterprise Server Administration',
        quizId: 'QZ-LONG-IDENTIFIER-2026-SERVER-HARDWARE-ESSENTIALS-001',
    };

    const allInOne = await renderAllInOnePDF(sampleAssessment, opts, 10.5);
    assert.ok(allInOne.pdfBytes.length > 1000);
    const loadedAIO = await PDFDocument.load(allInOne.pdfBytes);
    assert.strictEqual(loadedAIO.getPageCount(), 1);

    const sheet = await renderAnswerSheetPDF(sampleAssessment.questions, opts);
    assert.ok(sheet.pdfBytes.length > 1000);
    const loadedSheet = await PDFDocument.load(sheet.pdfBytes);
    assert.strictEqual(loadedSheet.getPageCount(), 1);

    const bookletBytes = await renderBookletPDF(sampleAssessment, opts);
    assert.ok(bookletBytes.length > 1000);
    const loadedBooklet = await PDFDocument.load(bookletBytes);
    assert.strictEqual(loadedBooklet.getPageCount(), 1);

    const keyBytes = await renderAnswerKeyPDF(sampleAssessment, opts);
    assert.ok(keyBytes.length > 1000);
    const loadedKey = await PDFDocument.load(keyBytes);
    assert.strictEqual(loadedKey.getPageCount(), 1);

    console.log('  PASS: All 4 PDF renderers generated valid PDFs with extreme long titles');
    console.log('\nResults: 5 passed, 0 failed');
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
