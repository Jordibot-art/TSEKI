// lib/printEngine/__tests__/fontSymbolsTest.ts

import { generatePrintPackage } from '../index';
import { renderAllInOnePDF } from '../allInOneRenderer';
import { renderAnswerKeyPDF } from '../answerKeyRenderer';
import { renderAnswerSheetPDF } from '../answerSheetRenderer';
import { renderBookletPDF } from '../bookletRenderer';
import { GeneratedAssessment, ScannableQuestion } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
    if (condition) {
        console.log(`  ✓ ${msg}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
    }
}

const unicodeQuestions: ScannableQuestion[] = [
    {
        questionNumber: 1,
        type: 'multiple_choice',
        questionText: 'Which equation correctly satisfies x \u2265 10 and y \u2264 5? (“Sample quote”)',
        options: [
            'x \u2192 \u221E implies y \u2265 0',
            '\u03B1 + \u03B2 = \u03C0 / 2',
            'Resistance R = 100 \u03A9',
            'None of the above',
        ],
        correctAnswer: 'B',
        answerBoxesRequired: 1,
    },
    {
        questionNumber: 2,
        type: 'true_false',
        questionText: 'In physics, \u0394t \u2192 0 defines instantaneous velocity ‘v’.',
        options: ['True', 'False'],
        correctAnswer: 'True',
        answerBoxesRequired: 1,
    },
    {
        questionNumber: 3,
        type: 'fill_blank',
        questionText: 'The ratio of a circle’s circumference to diameter is \u03C0.',
        correctAnswer: 'PI',
        answerBoxesRequired: 1,
    },
    {
        questionNumber: 4,
        type: 'identification',
        questionText: 'Define the symbol \u2192 used in chemical reactions.',
        correctAnswer: 'YIELDS',
        answerBoxesRequired: 1,
    },
    {
        questionNumber: 5,
        type: 'enumeration',
        questionText: 'List 3 Greek letters used in mathematics: \u03B1, \u03B2, and \u03B3.',
        correctAnswer: 'ALPHA, BETA, GAMMA',
        answerBoxesRequired: 3,
    },
];

const unicodeAssessment: GeneratedAssessment = {
    title: 'Advanced Science & Math Quiz (Symbols: \u2265, \u2264, \u2192, \u03B1, \u03B2, \u03C0, “ ”)',
    instructions: 'Answer all questions carefully. Pay attention to mathematical symbols \u2265 and arrows \u2192.',
    questions: unicodeQuestions,
};

function isPdf(bytes: Uint8Array): boolean {
    const header = String.fromCharCode(...bytes.slice(0, 5));
    return header === '%PDF-';
}

async function runFontSymbolsTests() {
    console.log('--- RUNNING FONT UNICODE SYMBOLS TESTS ---');

    console.log('\n1. Question Booklet PDF with Unicode Symbols');
    const bookletBytes = await renderBookletPDF(unicodeAssessment, { paperSize: 'short', version: 'A' });
    assert(bookletBytes.length > 1000, `Booklet generated (${bookletBytes.length} bytes)`);
    assert(isPdf(bookletBytes), 'Booklet is valid PDF');

    console.log('\n2. Answer Sheet PDF with Unicode Symbols');
    const sheetResult = await renderAnswerSheetPDF(unicodeQuestions, { paperSize: 'short', version: 'A' });
    assert(sheetResult.pdfBytes.length > 1000, `Answer sheet generated (${sheetResult.pdfBytes.length} bytes)`);
    assert(isPdf(sheetResult.pdfBytes), 'Answer sheet is valid PDF');

    console.log('\n3. All-in-One PDF with Unicode Symbols');
    const allInOneResult = await renderAllInOnePDF(unicodeAssessment, { paperSize: 'short', version: 'A' });
    assert(allInOneResult.pdfBytes.length > 1000, `All-in-One generated (${allInOneResult.pdfBytes.length} bytes)`);
    assert(isPdf(allInOneResult.pdfBytes), 'All-in-One is valid PDF');

    console.log('\n4. Teacher Answer Key PDF with Unicode Symbols');
    const keyBytes = await renderAnswerKeyPDF(unicodeAssessment, { paperSize: 'short', version: 'A' });
    assert(keyBytes.length > 1000, `Teacher key generated (${keyBytes.length} bytes)`);
    assert(isPdf(keyBytes), 'Teacher key is valid PDF');

    console.log('\n5. Full generatePrintPackage with Unicode Symbols');
    const pkg = await generatePrintPackage(unicodeAssessment, { paperSize: 'short', version: 'A' });
    assert(pkg.allInOnePdf !== null || pkg.bookletPdf !== null, 'Print package generated');
    assert(pkg.answerSheetPdf !== null, 'Print package has answer sheet');
    assert(pkg.answerKeyPdf !== null, 'Print package has answer key');
    const totalItems = pkg.layoutJson.pages.reduce((acc, p) => acc + p.items.length, 0);
    assert(totalItems > 0, `Layout JSON has ${totalItems} items across ${pkg.layoutJson.pages.length} pages`);

    console.log(`\nFont Symbols Test Summary: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runFontSymbolsTests();
