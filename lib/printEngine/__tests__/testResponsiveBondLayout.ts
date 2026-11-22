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

    console.log('\nResults: 8 passed, 0 failed');
}

main().catch((err) => {
    console.error('Responsive bond layout test failed:', err);
    process.exit(1);
});
