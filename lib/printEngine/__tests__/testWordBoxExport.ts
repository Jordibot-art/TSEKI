import './nodeIO';
import assert from 'assert';
import zlib from 'zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { PAPER_DIMENSIONS } from '../constants';
import { decideFit } from '../fitDecision';
import { generatePrintPackage } from '../index';
import {
    extractSharedWordBank,
    getMeasureBoldFont,
    getWordBankMaxChars,
    indexToWordBankLabel,
    measureTextWidth,
    measureWordBankLayout,
    resolveWordBankLabel,
    stripWordBankPrefix,
    wordBankLabelToIndex,
} from '../measure';
import { GeneratedAssessment, ScannableQuestion } from '../types';
import { quiz40ItemMixed } from './fixtures/sampleQuizzes';

/**
 * Extracts raw ASCII text operators from a pdf-lib PDF built with standard fonts.
 */
async function extractPdfAsciiText(pdfBytes: Uint8Array): Promise<string> {
    const doc = await PDFDocument.load(pdfBytes);
    const chunks: string[] = [];
    for (const obj of doc.context.enumerateIndirectObjects()) {
        const [, val] = obj;
        if (val instanceof PDFRawStream) {
            const filter = val.dict.get(PDFName.of('Filter'));
            let buf = Buffer.from(val.contents);
            if (filter && filter.toString().includes('FlateDecode')) {
                try {
                    buf = zlib.inflateSync(buf);
                } catch {
                    // ignore non-deflate streams
                }
            }
            const raw = buf.toString('latin1');
            // Collect literal parenthesized strings and hex strings used by Tj / TJ
            const parenMatches = raw.match(/\((?:\\.|[^\\()])*\)/g) || [];
            for (const m of parenMatches) {
                chunks.push(
                    m
                        .slice(1, -1)
                        .replace(/\\\)/g, ')')
                        .replace(/\\\(/g, '(')
                        .replace(/\\\\/g, '\\')
                );
            }
            const hexMatches = raw.match(/<[0-9A-Fa-f]+>/g) || [];
            for (const h of hexMatches) {
                const hex = h.slice(1, -1);
                if (hex.length >= 2 && hex.length % 2 === 0) {
                    const bytes = Buffer.from(hex, 'hex');
                    // Standard WinAnsi single-byte hex text
                    if (bytes.every((b) => b >= 32 && b <= 126)) {
                        chunks.push(bytes.toString('ascii'));
                    }
                }
            }
        }
    }
    return chunks.join('\n');
}

function makeAdventurerWordBoxQuiz(): GeneratedAssessment {
    const questions: ScannableQuestion[] = [
        { questionNumber: 1, type: 'word_box', questionText: 'The document title is ______.', options: ['ADVENTURER', 'EXPLORER', 'TRAVELER', 'NOMAD'], answerBoxesRequired: 1 },
        { questionNumber: 2, type: 'word_box', questionText: 'The creator tool used was ______.', options: ['Canva', 'Adobe', 'Word', 'PowerPoint'], answerBoxesRequired: 1 },
        { questionNumber: 3, type: 'word_box', questionText: 'The author listed is ______.', options: ['John Zamoras', 'Jane Doe', 'Alice Smith', 'Bob Lee'], answerBoxesRequired: 1 },
        { questionNumber: 4, type: 'word_box', questionText: 'The language code in the PDF metadata is ______.', options: ['en-AU', 'en-US', 'fr-FR', 'es-ES'], answerBoxesRequired: 1 },
        { questionNumber: 5, type: 'word_box', questionText: 'The creation date of the PDF is ______.', options: ['2026-08-19', '2025-07-15', '2024-01-01', '2023-12-31'], answerBoxesRequired: 1 },
        { questionNumber: 6, type: 'word_box', questionText: 'One of the keywords is ______.', options: ['DAHSdV_twFA', 'XYZ123', 'Keyword1', 'SampleTag'], answerBoxesRequired: 1 },
        { questionNumber: 7, type: 'word_box', questionText: 'Another keyword listed is ______.', options: ['BAE9GC-K-CI', 'ABCDEF', 'Keyword2', 'TestTag'], answerBoxesRequired: 1 },
        { questionNumber: 8, type: 'word_box', questionText: 'The PDF version specified is ______.', options: ['1.4', '1.7', '2.0', '1.3'], answerBoxesRequired: 1 },
        { questionNumber: 9, type: 'word_box', questionText: 'The PDF producer is ______.', options: ['Canva', 'Adobe', 'Foxit', 'Nitro'], answerBoxesRequired: 1 },
        { questionNumber: 10, type: 'word_box', questionText: "The PDF's modification date is ______.", options: ['2026-08-19', '2025-08-19', '2024-08-19', '2023-08-19'], answerBoxesRequired: 1 },
    ];

    const answerKey = [
        { questionNumber: 1, correctAnswer: 'ADVENTURER', points: 1 },
        { questionNumber: 2, correctAnswer: 'Canva', points: 1 },
        { questionNumber: 3, correctAnswer: 'John Zamoras', points: 1 },
        { questionNumber: 4, correctAnswer: 'en-AU', points: 1 },
        { questionNumber: 5, correctAnswer: '2026-08-19', points: 1 },
        { questionNumber: 6, correctAnswer: 'DAHSdV_twFA', points: 1 },
        { questionNumber: 7, correctAnswer: 'BAE9GC-K-CI', points: 1 },
        { questionNumber: 8, correctAnswer: '1.4', points: 1 },
        { questionNumber: 9, correctAnswer: 'Nitro', points: 1 },
        { questionNumber: 10, correctAnswer: '2023-08-19', points: 1 },
    ];

    return {
        quizTitle: 'ADVENTURER PDF Content Assessment',
        questions,
        answerKey,
    };
}

function makeLarge100WordQuiz(): GeneratedAssessment {
    const questions: ScannableQuestion[] = Array.from({ length: 25 }, (_, i) => ({
        questionNumber: i + 1,
        type: 'word_box',
        questionText: `Match concept number ${i + 1} with the correct technical term: ______.`,
        options: [
            `Term_${i + 1}_Alpha`,
            `Term_${i + 1}_Beta`,
            `Term_${i + 1}_Gamma`,
            `Term_${i + 1}_Delta`,
        ],
        answerBoxesRequired: 1,
    }));

    return {
        quizTitle: 'Large 100-Choice Word Box Stress Assessment',
        questions,
        answerKey: questions.map((q, i) => ({
            questionNumber: q.questionNumber,
            correctAnswer: `Term_${i + 1}_Alpha`,
            points: 1,
        })),
    };
}

function assertAllBoxesInsideBounds(
    pkg: Awaited<ReturnType<typeof generatePrintPackage>>,
    paperSize: 'short' | 'long'
) {
    const dims = PAPER_DIMENSIONS[paperSize];
    for (const page of pkg.layoutJson.pages) {
        for (const item of page.items) {
            const { x, y, width, height } = item.rect;
            assert.ok(
                x >= 35.5 && x + width <= dims.width - 35.5 && y >= 35.5 && y + height <= dims.height - 35.5,
                `Box Q${item.questionNumber} out of ${paperSize} bounds: (${x.toFixed(1)}, ${y.toFixed(1)}, ${width.toFixed(1)}x${height.toFixed(1)})`
            );
            for (const m of page.markers) {
                const overlap = !(x + width <= m.x || x >= m.x + m.width || y + height <= m.y || y >= m.y + m.height);
                assert.ok(!overlap, `Box Q${item.questionNumber} overlapped marker ${m.corner}`);
            }
        }
    }
}

async function main() {
    console.log('=== Testing Multi-Question Word Box PDF Export ===');

    // 1. Bijective base-26 label helpers
    assert.strictEqual(indexToWordBankLabel(0), 'A');
    assert.strictEqual(indexToWordBankLabel(25), 'Z');
    assert.strictEqual(indexToWordBankLabel(26), 'AA');
    assert.strictEqual(indexToWordBankLabel(27), 'AB');
    assert.strictEqual(indexToWordBankLabel(36), 'AK');
    assert.strictEqual(indexToWordBankLabel(51), 'AZ');
    assert.strictEqual(indexToWordBankLabel(52), 'BA');
    for (let i = 0; i <= 150; i++) {
        const lbl = indexToWordBankLabel(i);
        assert.match(lbl, /^[A-Z]+$/, `Label ${lbl} for index ${i} must be pure A-Z letters`);
        assert.strictEqual(wordBankLabelToIndex(lbl), i, `Round-trip failed for index ${i} (${lbl})`);
    }
    assert.strictEqual(getWordBankMaxChars(6), 1);
    assert.strictEqual(getWordBankMaxChars(26), 1);
    assert.strictEqual(getWordBankMaxChars(27), 2);
    assert.strictEqual(getWordBankMaxChars(37), 2);
    console.log('  PASS: Bijective A..Z, AA.. label helpers');

    // 2. Prefix stripping preserves abbreviations & numbers
    assert.strictEqual(stripWordBankPrefix('A) PROTOCOL'), 'PROTOCOL');
    assert.strictEqual(stripWordBankPrefix('AA) Nitro'), 'Nitro');
    assert.strictEqual(stripWordBankPrefix('Dr. Smith'), 'Dr. Smith');
    assert.strictEqual(stripWordBankPrefix('Mr. Lee'), 'Mr. Lee');
    assert.strictEqual(stripWordBankPrefix('1.4'), '1.4');
    assert.strictEqual(stripWordBankPrefix('en-US'), 'en-US');
    console.log('  PASS: Prefix stripping preserves titles, numbers, and locales');

    // 3. Shared Word Bank aggregation across all 10 questions (37 unique words) & legacy fixture (6 words)
    const adventurer = makeAdventurerWordBoxQuiz();
    const shared37 = extractSharedWordBank(adventurer.questions, adventurer.answerKey);
    assert.strictEqual(shared37.length, 37, `Expected 37 unique words across Q1-Q10, got ${shared37.length}`);
    assert.strictEqual(shared37[0], 'ADVENTURER');
    assert.strictEqual(shared37[4], 'Canva');
    assert.strictEqual(shared37[8], 'John Zamoras');
    assert.strictEqual(shared37[25], 'ABCDEF');
    assert.strictEqual(shared37[26], 'Keyword2');
    assert.strictEqual(shared37[33], 'Nitro');
    assert.strictEqual(shared37[36], '2023-08-19');

    const legacy6 = extractSharedWordBank(quiz40ItemMixed.questions, quiz40ItemMixed.answerKey);
    assert.deepStrictEqual(legacy6, ['PROTOCOL', 'SOCKET', 'PACKET', 'PORT', 'BUFFER', 'THREAD']);
    assert.deepStrictEqual(resolveWordBankLabel('A', legacy6), { label: 'A', word: 'PROTOCOL' });
    assert.deepStrictEqual(resolveWordBankLabel('Canva', shared37), { label: 'E', word: 'Canva' });
    assert.deepStrictEqual(resolveWordBankLabel('2023-08-19', shared37), { label: 'AK', word: '2023-08-19' });
    console.log('  PASS: Shared Word Bank aggregates all 37 unique choices and preserves legacy 6-word bank');

    // 4. Layout measurement wraps cleanly within maxWidth with no broken labels
    const boldFont = await getMeasureBoldFont();
    for (const [mode, width] of [
        ['ALL_IN_ONE', 540],
        ['BOOKLET', 258],
    ] as const) {
        const layout = measureWordBankLayout(shared37, width, 11, boldFont, mode);
        assert.strictEqual(layout.entries.length, 37);
        const joined = layout.lines.join('\n');
        assert.ok(joined.includes('A) ADVENTURER'), `${mode} missing A) ADVENTURER`);
        assert.ok(joined.includes('E) Canva'), `${mode} missing E) Canva`);
        assert.ok(joined.includes('I) John Zamoras'), `${mode} missing I) John Zamoras`);
        assert.ok(joined.includes('Z) ABCDEF'), `${mode} missing Z) ABCDEF`);
        assert.ok(joined.includes('AA) Keyword2'), `${mode} missing AA) Keyword2`);
        assert.ok(joined.includes('AH) Nitro'), `${mode} missing AH) Nitro`);
        assert.ok(joined.includes('AK) 2023-08-19'), `${mode} missing AK) 2023-08-19`);
        assert.ok(!joined.includes('[)'), `${mode} must never emit invalid ASCII [) label`);
        for (const line of layout.lines) {
            const w = measureTextWidth(line, layout.bankSize, boldFont);
            assert.ok(
                w <= width - layout.padding * 2 + 0.5,
                `${mode} wrapped line exceeded width (${w.toFixed(1)} > ${width - layout.padding * 2}): ${line}`
            );
        }
    }
    console.log('  PASS: Word Bank layout wraps all 37 entries inside bounds for ALL_IN_ONE & BOOKLET');

    // 5. All-in-One Short Bond PDF export contains ALL 37 word bank choices & valid answer variants
    const pkgAllInOne = await generatePrintPackage(adventurer, { paperSize: 'short' });
    assert.strictEqual(pkgAllInOne.mode, 'ALL_IN_ONE');
    assert.strictEqual((await PDFDocument.load(pkgAllInOne.studentPdf)).getPageCount(), 1);
    assertAllBoxesInsideBounds(pkgAllInOne, 'short');
    assert.ok(
        pkgAllInOne.layoutJson.pages[0].items.every((it) => it.maxChars === 2),
        'All-in-One word_box boxes must allow 2-char labels when > 26 words'
    );
    const allInOneText = await extractPdfAsciiText(pkgAllInOne.studentPdf);
    for (const expectedEntry of ['A) ADVENTURER', 'E) Canva', 'I) John Zamoras', 'AA) Keyword2', 'AH) Nitro', 'AK) 2023-08-19']) {
        assert.ok(allInOneText.includes(expectedEntry), `All-in-One PDF missing "${expectedEntry}"`);
    }
    const q2Variant = pkgAllInOne.layoutJson.answerVariants.find((v) => v.questionNumber === 2)!;
    const q10Variant = pkgAllInOne.layoutJson.answerVariants.find((v) => v.questionNumber === 10)!;
    assert.ok(q2Variant.accepted.includes('E') && q2Variant.accepted.includes('CANVA'), 'Q2 variant accepts E and CANVA');
    assert.ok(q10Variant.accepted.includes('AK') && q10Variant.accepted.includes('2023-08-19'), 'Q10 variant accepts AK and 2023-08-19');
    assert.strictEqual(q10Variant.maxChars, 2);

    const keyText = await extractPdfAsciiText(pkgAllInOne.answerKeyPdf);
    assert.ok(keyText.includes('E (Canva)'), 'Answer Key PDF should show letter + word for Q2');
    assert.ok(keyText.includes('AK (2023-08-19)'), 'Answer Key PDF should show letter + word for Q10');
    console.log('  PASS: All-in-One Short Bond PDF + Answer Key + LayoutJSON include all 37 choices');

    // 6. Separate Question Booklet + Answer Sheet PDF export contains ALL 37 word bank choices
    const pkgSeparate = await generatePrintPackage(adventurer, { paperSize: 'short', forceSeparate: true });
    assert.strictEqual(pkgSeparate.mode, 'SEPARATE');
    assert.ok(pkgSeparate.answerSheetPdf && pkgSeparate.answerSheetPdf.byteLength > 0);
    assertAllBoxesInsideBounds(pkgSeparate, 'short');
    assert.ok(
        pkgSeparate.layoutJson.pages[0].items.every((it) => it.maxChars === 2),
        'Separate Answer Sheet word_box boxes must allow 2-char labels when > 26 words'
    );
    const bookletText = await extractPdfAsciiText(pkgSeparate.studentPdf);
    for (const expectedEntry of ['A) ADVENTURER', 'E) Canva', 'I) John Zamoras', 'AA) Keyword2', 'AH) Nitro', 'AK) 2023-08-19']) {
        assert.ok(bookletText.includes(expectedEntry), `Separate Booklet PDF missing "${expectedEntry}"`);
    }
    const sheetText = await extractPdfAsciiText(pkgSeparate.answerSheetPdf!);
    assert.ok(sheetText.includes('LETTER(S)'), 'Answer Sheet banner should say LETTER(S) when > 26 words');
    console.log('  PASS: Separate Question Booklet + Answer Sheet PDFs include all 37 choices');

    // 7. Stress test: 25 word_box questions with 100 unique words across Short Bond (Auto + Separate)
    const quiz100 = makeLarge100WordQuiz();
    const fit100 = await decideFit(quiz100, { paperSize: 'short' });
    const pkg100Auto = await generatePrintPackage(quiz100, { paperSize: 'short' });
    const pkg100Sep = await generatePrintPackage(quiz100, { paperSize: 'short', forceSeparate: true });
    assertAllBoxesInsideBounds(pkg100Auto, 'short');
    assertAllBoxesInsideBounds(pkg100Sep, 'short');
    const booklet100Text = await extractPdfAsciiText(pkg100Sep.studentPdf);
    const last100Label = indexToWordBankLabel(99); // CV
    assert.ok(booklet100Text.includes('A) Term_1_Alpha'), '100-word booklet missing first entry');
    assert.ok(booklet100Text.includes(`${last100Label}) Term_25_Delta`), `100-word booklet missing 100th entry (${last100Label})`);
    console.log(`  PASS: 100-word stress test (auto=${fit100.mode}@${fit100.fontSize}pt, separate booklet ok, 100th label=${last100Label})`);

    console.log('\nResults: 7 passed, 0 failed');
}

main().catch((err) => {
    console.error('Word Box export test failed:', err);
    process.exit(1);
});
