import './nodeIO';
import assert from 'assert';
import { PDFDocument } from 'pdf-lib';
import { PAPER_DIMENSIONS } from '../constants';
import { decideFit } from '../fitDecision';
import { generatePrintPackage } from '../index';
import { GeneratedAssessment, ScannableQuestion } from '../types';

function makeMcQuestions(count: number, shortChoices = false): ScannableQuestion[] {
    return Array.from({ length: count }, (_, i) => ({
        questionNumber: i + 1,
        type: 'multiple_choice' as const,
        questionText: `Question ${i + 1}: Which architectural principle best governs reliable service delivery in system tier ${i + 1}?`,
        options: shortChoices
            ? ['A) Redundancy', 'B) Caching', 'C) Sharding', 'D) Failover']
            : [
                  'A) Horizontal load balancing across nodes',
                  'B) Synchronous single-node blocking',
                  'C) Unindexed full table scans',
                  'D) Disabling replication logs',
              ],
        answerBoxesRequired: 1,
    }));
}

function makeTfQuestions(count: number): ScannableQuestion[] {
    return Array.from({ length: count }, (_, i) => ({
        questionNumber: i + 1,
        type: 'true_false' as const,
        questionText: `Statement ${i + 1}: ECC memory detects and corrects single-bit data errors automatically.`,
        options: ['True', 'False'],
        answerBoxesRequired: 1,
    }));
}

function makeIdQuestions(count: number): ScannableQuestion[] {
    return Array.from({ length: count }, (_, i) => ({
        questionNumber: i + 1,
        type: 'identification' as const,
        questionText: `Term ${i + 1}: Name the protocol or hardware standard responsible for step ${i + 1}.`,
        options: [],
        answerBoxesRequired: 1,
    }));
}

function makeAssessment(title: string, questions: ScannableQuestion[]): GeneratedAssessment {
    return {
        quizTitle: title,
        questions,
        answerKey: questions.map((q) => ({
            questionNumber: q.questionNumber,
            correctAnswer: q.type === 'true_false' ? 'True' : q.type === 'identification' ? 'TCP' : 'A',
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
    console.log('=== Testing Responsive Bond Paper Layout (Short & Long, 1-50+ Items) ===');

    // 1. 10 MC items fit at standard 11pt on Short & Long
    const q10 = makeAssessment('10-Item Standard Quiz', makeMcQuestions(10, true));
    const fit10Short = await decideFit(q10, { paperSize: 'short' });
    const fit10Long = await decideFit(q10, { paperSize: 'long' });
    assert.strictEqual(fit10Short.mode, 'ALL_IN_ONE');
    assert.strictEqual(fit10Short.fontSize, 11.0);
    assert.strictEqual(fit10Long.mode, 'ALL_IN_ONE');
    assert.strictEqual(fit10Long.fontSize, 11.0);
    console.log(`  PASS: 10 MC fits ALL_IN_ONE at 11.0pt on Short & Long`);

    // 2. 25 True/False items fit on 1 page at standard 11pt (Short & Long)
    const q25Tf = makeAssessment('25-Item True or False', makeTfQuestions(25));
    const fit25TfShort = await decideFit(q25Tf, { paperSize: 'short' });
    const fit25TfLong = await decideFit(q25Tf, { paperSize: 'long' });
    assert.strictEqual(fit25TfShort.mode, 'ALL_IN_ONE');
    assert.strictEqual(fit25TfShort.fontSize, 11.0);
    assert.strictEqual(fit25TfLong.mode, 'ALL_IN_ONE');
    assert.strictEqual(fit25TfLong.fontSize, 11.0);
    console.log(`  PASS: 25 True/False fits ALL_IN_ONE at 11.0pt standard font on Short & Long`);

    // 3. 30 Identification items fit on 1 page at 11pt on Long bond paper
    const q30Id = makeAssessment('30-Item Identification', makeIdQuestions(30));
    const fit30IdLong = await decideFit(q30Id, { paperSize: 'long' });
    assert.strictEqual(fit30IdLong.mode, 'ALL_IN_ONE');
    assert.strictEqual(fit30IdLong.fontSize, 11.0);
    console.log(`  PASS: 30 Identification fits ALL_IN_ONE at 11.0pt on Long bond paper`);

    // 4. Short vs Long responsiveness: 16 MC items fit on 1 Long sheet at larger font or fewer pages than Short
    const q16Mc = makeAssessment('16-Item Midterm MC', makeMcQuestions(16, true));
    const fit16Short = await decideFit(q16Mc, { paperSize: 'short' });
    const fit16Long = await decideFit(q16Mc, { paperSize: 'long' });
    assert.strictEqual(fit16Long.mode, 'ALL_IN_ONE');
    assert.ok(
        fit16Long.pages <= fit16Short.pages &&
            (fit16Long.mode === 'ALL_IN_ONE' && (fit16Short.mode === 'SEPARATE' || fit16Long.fontSize >= fit16Short.fontSize)),
        `Expected Long bond to utilize extra height vs Short (Short: ${fit16Short.mode} ${fit16Short.fontSize}pt, Long: ${fit16Long.mode} ${fit16Long.fontSize}pt)`
    );
    console.log(
        `  PASS: Short vs Long responsive on 16 MC -> Short: ${fit16Short.mode} (${fit16Short.fontSize}pt), Long: ${fit16Long.mode} (${fit16Long.fontSize}pt)`
    );

    // 5. 50 Multiple Choice items -> scales down font responsively to fit compactly on Short & Long bond paper!
    const q50McShortOpts = makeAssessment('50-Item Final Exam (Short Options)', makeMcQuestions(50, true));
    const pkg50Short = await generatePrintPackage(q50McShortOpts, { paperSize: 'short' });
    const pkg50Long = await generatePrintPackage(q50McShortOpts, { paperSize: 'long' });

    assert.strictEqual(pkg50Short.mode, 'SEPARATE');
    assert.ok(pkg50Short.fontSize < 11.0, `Expected compact font < 11pt for 50 MC on Short, got ${pkg50Short.fontSize}`);
    assert.ok(pkg50Long.fontSize < 11.0, `Expected compact font < 11pt for 50 MC on Long, got ${pkg50Long.fontSize}`);

    const booklet50ShortPages = (await PDFDocument.load(pkg50Short.studentPdf)).getPageCount();
    const booklet50LongPages = (await PDFDocument.load(pkg50Long.studentPdf)).getPageCount();
    const sheet50ShortPages = (await PDFDocument.load(pkg50Short.answerSheetPdf!)).getPageCount();
    const sheet50LongPages = (await PDFDocument.load(pkg50Long.answerSheetPdf!)).getPageCount();

    assert.ok(booklet50ShortPages <= 2, `Expected 50 MC booklet on Short <= 2 pages, got ${booklet50ShortPages}`);
    assert.ok(booklet50LongPages <= 2, `Expected 50 MC booklet on Long <= 2 pages, got ${booklet50LongPages}`);
    assert.strictEqual(sheet50ShortPages, 1, '50 MC Answer Sheet must fit on 1 Short page');
    assert.strictEqual(sheet50LongPages, 1, '50 MC Answer Sheet must fit on 1 Long page');
    assertAllBoxesInsideBounds(pkg50Short, 'short');
    assertAllBoxesInsideBounds(pkg50Long, 'long');
    console.log(
        `  PASS: 50 MC compact layout -> Short: ${booklet50ShortPages} booklet pg(s) @ ${pkg50Short.fontSize}pt + 1 sheet | Long: ${booklet50LongPages} booklet pg(s) @ ${pkg50Long.fontSize}pt + 1 sheet`
    );

    // 6. 50 Identification items -> Answer Sheet auto-splits 2 cols and fits ALL 50 on 1 page (Short & Long)
    const q50Id = makeAssessment('50-Item Identification Exam', makeIdQuestions(50));
    const pkg50IdShort = await generatePrintPackage(q50Id, { paperSize: 'short', forceSeparate: true });
    const pkg50IdLong = await generatePrintPackage(q50Id, { paperSize: 'long', forceSeparate: true });
    assert.strictEqual((await PDFDocument.load(pkg50IdShort.answerSheetPdf!)).getPageCount(), 1);
    assert.strictEqual((await PDFDocument.load(pkg50IdLong.answerSheetPdf!)).getPageCount(), 1);
    assert.strictEqual(pkg50IdShort.layoutJson.pages[0].items.length, 50);
    assert.strictEqual(pkg50IdLong.layoutJson.pages[0].items.length, 50);
    assertAllBoxesInsideBounds(pkg50IdShort, 'short');
    assertAllBoxesInsideBounds(pkg50IdLong, 'long');
    const idBookletLongPages = (await PDFDocument.load(pkg50IdLong.studentPdf)).getPageCount();
    assert.strictEqual(idBookletLongPages, 1, `50 Identification booklet should pack onto 1 Long bond page, got ${idBookletLongPages}`);
    console.log(
        `  PASS: 50 Identification -> Long booklet: ${idBookletLongPages} pg @ ${pkg50IdLong.fontSize}pt + 1 full-width 2-col sheet (50/50 boxes in bounds)`
    );

    // 7. 50 long-option MC items on Short vs Long -> compact & zero overflow
    const q50LongOpts = makeAssessment('50-Item Comprehensive Exam (Long Options)', makeMcQuestions(50, false));
    const pkg50LongOptsShort = await generatePrintPackage(q50LongOpts, { paperSize: 'short' });
    const pkg50LongOptsLong = await generatePrintPackage(q50LongOpts, { paperSize: 'long' });
    const pShort = (await PDFDocument.load(pkg50LongOptsShort.studentPdf)).getPageCount();
    const pLong = (await PDFDocument.load(pkg50LongOptsLong.studentPdf)).getPageCount();
    assert.ok(pLong <= pShort, `Long bond (${pLong}p) should use <= pages than Short bond (${pShort}p)`);
    assert.ok(pkg50LongOptsShort.fontSize < 11.0 && pkg50LongOptsLong.fontSize < 11.0);
    assertAllBoxesInsideBounds(pkg50LongOptsShort, 'short');
    assertAllBoxesInsideBounds(pkg50LongOptsLong, 'long');
    console.log(
        `  PASS: 50 Long-Option MC -> Short: ${pShort} pg @ ${pkg50LongOptsShort.fontSize}pt | Long: ${pLong} pg @ ${pkg50LongOptsLong.fontSize}pt`
    );

    // 8. Grade 2 primary floor respected even for 50 items
    const fit50Grade2 = await decideFit(q50McShortOpts, { paperSize: 'short', gradeLevel: 'Grade 2' });
    assert.ok(fit50Grade2.fontSize >= 10.5, `Grade 2 floor violated: ${fit50Grade2.fontSize}`);
    console.log(`  PASS: Grade 2 floor preserved (${fit50Grade2.fontSize}pt >= 10.5pt)`);

    // 9. Long Identification & Enumeration answers get wide full-column boxes in ALL_IN_ONE (Short & Long)
    const longAnswerMixed: GeneratedAssessment = {
        quizTitle: 'Cellular Biology Mixed Quiz (Long Answers)',
        questions: [
            {
                questionNumber: 1,
                type: 'multiple_choice',
                questionText: 'Which organelle synthesizes ATP energy in eukaryotic cells?',
                options: ['A) Ribosome', 'B) Mitochondrion', 'C) Golgi body', 'D) Lysosome'],
                answerBoxesRequired: 1,
            },
            {
                questionNumber: 2,
                type: 'true_false',
                questionText: 'Prokaryotic cells contain a membrane-bound nucleus.',
                options: ['True', 'False'],
                answerBoxesRequired: 1,
            },
            {
                questionNumber: 3,
                type: 'identification',
                questionText: 'Identify the biological macromolecule _______________ responsible for hereditary genetic blueprints:',
                options: [],
                answerBoxesRequired: 1,
            },
            {
                questionNumber: 4,
                type: 'enumeration',
                questionText: 'Enumerate the three major metabolic stages of aerobic cellular respiration:',
                options: [],
                // Intentionally set to 1 to verify AI-broken box count auto-heals from 3-item answerKey!
                answerBoxesRequired: 1,
            },
        ],
        answerKey: [
            { questionNumber: 1, correctAnswer: 'B', points: 1 },
            { questionNumber: 2, correctAnswer: 'F', points: 1 },
            { questionNumber: 3, correctAnswer: 'Deoxyribonucleic Acid (DNA)', points: 1 },
            {
                questionNumber: 4,
                correctAnswer: 'Glycolysis, Citric Acid (Krebs) Cycle, Electron Transport Chain',
                points: 3,
            },
        ],
    };

    for (const bond of ['short', 'long'] as const) {
        const pkgMixed = await generatePrintPackage(longAnswerMixed, { paperSize: bond });
        assert.strictEqual(pkgMixed.mode, 'ALL_IN_ONE', `4-item mixed quiz must fit ALL_IN_ONE on ${bond}`);
        const docMixed = await PDFDocument.load(pkgMixed.studentPdf);
        assert.strictEqual(docMixed.getPageCount(), 1);
        const { width: pw, height: ph } = docMixed.getPages()[0].getSize();
        assert.strictEqual(pw, PAPER_DIMENSIONS[bond].width);
        assert.strictEqual(ph, PAPER_DIMENSIONS[bond].height);
        assertAllBoxesInsideBounds(pkgMixed, bond);

        const items = pkgMixed.layoutJson.pages[0].items;
        // Q1 (1) + Q2 (1) + Q3 (1) + Q4 auto-healed enumeration (3) = 6 boxes
        assert.strictEqual(items.length, 6, `Expected 6 boxes (auto-healed 3 enum sub-boxes), got ${items.length}`);
        const idBox = items.find((i) => i.questionNumber === 3)!;
        const enumBoxes = items.filter((i) => i.questionNumber === 4);
        assert.strictEqual(enumBoxes.length, 3);
        assert.ok(idBox.rect.width >= 230, `Identification box too short (${idBox.rect.width}pt < 230pt)`);
        assert.ok(idBox.maxChars >= 30, `Identification maxChars should adapt to long answer (${idBox.maxChars})`);
        for (const eb of enumBoxes) {
            assert.ok(eb.rect.width >= 225, `Enumeration box too short (${eb.rect.width}pt < 225pt)`);
            assert.ok(eb.maxChars >= 30, `Enumeration maxChars should adapt to long sub-answer (${eb.maxChars})`);
        }
    }
    console.log('  PASS: Long Identification & Enumeration answers get wide (>=230pt) adaptive boxes & auto-healed sub-boxes on Short & Long');

    // 10. Separate Answer Sheet gives full-width (>=500pt) boxes for <=8 Identification & long Enumeration answers
    const separateLongAnsPkg = await generatePrintPackage(longAnswerMixed, {
        paperSize: 'long',
        forceSeparate: true,
    });
    assertAllBoxesInsideBounds(separateLongAnsPkg, 'long');
    const sepSheetItems = separateLongAnsPkg.layoutJson.pages[0].items;
    const sepIdBox = sepSheetItems.find((i) => i.questionNumber === 3)!;
    const sepEnumBoxes = sepSheetItems.filter((i) => i.questionNumber === 4);
    assert.ok(sepIdBox.rect.width >= 500, `Expected full-width (>=500pt) Answer Sheet ID box, got ${sepIdBox.rect.width}`);
    for (const eb of sepEnumBoxes) {
        assert.ok(eb.rect.width >= 500, `Expected full-width (>=500pt) Answer Sheet long Enum box, got ${eb.rect.width}`);
    }
    console.log(
        `  PASS: Separate Answer Sheet expands Identification (${sepIdBox.rect.width}pt) & long Enumeration (${sepEnumBoxes[0].rect.width}pt) to full width`
    );

    // 11. 22-item Mixed quiz (MC + ID + Enumeration) fits on 1 single Long Bond page while Short switches or uses smaller font
    const q22Mixed: GeneratedAssessment = {
        quizTitle: '22-Item Midterm Mixed Assessment',
        questions: [
            ...makeMcQuestions(12, true),
            ...Array.from({ length: 8 }, (_, i) => ({
                questionNumber: 13 + i,
                type: 'identification' as const,
                questionText: `Identify the networking concept or protocol described in item ${13 + i}:`,
                options: [],
                answerBoxesRequired: 1,
            })),
            {
                questionNumber: 21,
                type: 'enumeration' as const,
                questionText: 'List three private IPv4 address classes:',
                options: [],
                answerBoxesRequired: 3,
            },
            {
                questionNumber: 22,
                type: 'enumeration' as const,
                questionText: 'List two transport layer protocols:',
                options: [],
                answerBoxesRequired: 2,
            },
        ],
        answerKey: [
            ...Array.from({ length: 12 }, (_, i) => ({ questionNumber: i + 1, correctAnswer: 'A', points: 1 })),
            ...Array.from({ length: 8 }, (_, i) => ({
                questionNumber: 13 + i,
                correctAnswer: 'Domain Name System',
                points: 1,
            })),
            { questionNumber: 21, correctAnswer: 'Class A, Class B, Class C', points: 3 },
            { questionNumber: 22, correctAnswer: 'Transmission Control Protocol, User Datagram Protocol', points: 2 },
        ],
    };
    const pkg22Short = await generatePrintPackage(q22Mixed, { paperSize: 'short' });
    const pkg22Long = await generatePrintPackage(q22Mixed, { paperSize: 'long' });
    assert.strictEqual(pkg22Long.mode, 'ALL_IN_ONE', `22-item Mixed quiz should fit on 1 Long Bond sheet, got ${pkg22Long.mode}`);
    assert.strictEqual((await PDFDocument.load(pkg22Long.studentPdf)).getPageCount(), 1);
    assertAllBoxesInsideBounds(pkg22Short, 'short');
    assertAllBoxesInsideBounds(pkg22Long, 'long');
    console.log(
        `  PASS: 22-Item Mixed (MC+ID+Enum) -> Short: ${pkg22Short.mode} (${pkg22Short.pages}p @ ${pkg22Short.fontSize}pt) | Long: ${pkg22Long.mode} (1p @ ${pkg22Long.fontSize}pt)`
    );

    console.log('\nResults: 11 passed, 0 failed');
}

main().catch((err) => {
    console.error('Responsive bond layout test failed:', err);
    process.exit(1);
});
