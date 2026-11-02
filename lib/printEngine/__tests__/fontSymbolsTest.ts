import './nodeIO';
// lib/printEngine/__tests__/fontSymbolsTest.ts

import { renderAllInOnePDF } from '../allInOneRenderer';
import { renderAnswerKeyPDF } from '../answerKeyRenderer';
import { renderAnswerSheetPDF } from '../answerSheetRenderer';
import { renderBookletPDF } from '../bookletRenderer';
import { generatePrintPackage } from '../index';
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
        answerBoxesRequired: 1,
    } as any,
    {
        questionNumber: 2,
        type: 'true_false',
        questionText: 'In physics, \u0394t \u2192 0 defines instantaneous velocity ‘v’.',
        options: ['True', 'False'],
        answerBoxesRequired: 1,
    } as any,
    {
        questionNumber: 3,
        type: 'fill_blank',
        questionText: 'The ratio of a circle’s circumference to diameter is \u03C0.',
        options: [],
        answerBoxesRequired: 1,
    } as any,
    {
        questionNumber: 4,
        type: 'identification',
        questionText: 'Define the symbol \u2192 used in chemical reactions.',
        options: [],
        answerBoxesRequired: 1,
    } as any,
    {
        questionNumber: 5,
        type: 'enumeration',
        questionText: 'List 3 Greek letters used in mathematics: \u03B1, \u03B2, and \u03B3.',
        options: [],
        answerBoxesRequired: 3,
    } as any,
];

const unicodeAssessment: GeneratedAssessment = {
    quizTitle: 'Advanced Science & Math Quiz (Symbols: \u2265, \u2264, \u2192, \u03B1, \u03B2, \u03C0, “ ”)',
    questions: unicodeQuestions,
    answerKey: [
        { questionNumber: 1, correctAnswer: 'B', points: 1 },
        { questionNumber: 2, correctAnswer: 'True', points: 1 },
        { questionNumber: 3, correctAnswer: 'PI', points: 1 },
        { questionNumber: 4, correctAnswer: 'YIELDS', points: 1 },
        { questionNumber: 5, correctAnswer: 'ALPHA, BETA, GAMMA', points: 3 },
    ],
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
    assert(pkg.studentPdf.byteLength > 0, 'Print package has student PDF');
    assert(pkg.answerKeyPdf.byteLength > 0, 'Print package has answer key');
    const totalItems = pkg.layoutJson.pages.reduce((acc, p) => acc + p.items.length, 0);
    assert(totalItems > 0, `Layout JSON has ${totalItems} items across ${pkg.layoutJson.pages.length} pages`);

    console.log(`\nFont Symbols Test Summary: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runFontSymbolsTests();
