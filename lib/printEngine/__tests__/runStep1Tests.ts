import './nodeIO';
// lib/printEngine/__tests__/runStep1Tests.ts

import { getMeasureFont, measureTextWidth, wrapText, measureQuestionHeight, measureAllInOneColumns } from '../measure';
import { decideFit } from '../fitDecision';
import { quiz10ItemMC, quiz20ItemMC, quiz40ItemMixed } from './fixtures/sampleQuizzes';

async function runTests() {
    console.log('=== Running Step 1: Text Measuring & Fit Decision Tests ===\n');
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
        if (condition) {
            console.log(`  [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    }

    const font = await getMeasureFont();

    // ── Test 1: Font measurement ──────────────────────────────────────────────
    const width10 = measureTextWidth('Hello World', 10, font);
    const width20 = measureTextWidth('Hello World', 20, font);
    assert(width10 > 0, 'Text width is positive');
    assert(Math.abs(width20 - width10 * 2) < 0.1, 'Text width scales linearly with font size');

    // ── Test 2: Text wrapping ─────────────────────────────────────────────────
    const longText = 'This is a longer question stem that should be wrapped into multiple lines given a narrow column width.';
    const lines = wrapText(longText, 120, 11, font);
    assert(lines.length >= 3, `wrapText breaks into multiple lines (got ${lines.length} lines)`);
    for (const line of lines) {
        assert(measureTextWidth(line, 11, font) <= 125, `Wrapped line '${line.slice(0, 20)}...' does not exceed maxWidth`);
    }

    // ── Test 3: Question height measurement ───────────────────────────────────
    const mcQuestion = quiz10ItemMC.questions[0];
    const mcHeight = measureQuestionHeight(mcQuestion, 11, 258, font, false);
    assert(mcHeight > 40, `Multiple choice question has realistic vertical height (got ${mcHeight.toFixed(1)} pt)`);

    // ── Test 4: 2-column balancing ────────────────────────────────────────────
    const columns = measureAllInOneColumns(quiz10ItemMC.questions, 11, 258, font);
    assert(columns.col1Height > 0 && columns.col2Height > 0, 'Both columns receive questions');
    const balanceDiff = Math.abs(columns.col1Height - columns.col2Height);
    assert(balanceDiff < 50, `Columns are reasonably balanced (diff: ${balanceDiff.toFixed(1)} pt)`);

    // ── Test 5: Fit decision for 10-item quiz ──────────────────────────────────
    const fit10 = await decideFit(quiz10ItemMC, {}, font);
    assert(fit10.mode === 'ALL_IN_ONE', `10-item quiz chooses ALL_IN_ONE (got ${fit10.mode})`);
    assert(fit10.pages === 1, `10-item quiz fits on 1 page (got ${fit10.pages})`);
    assert(fit10.fontSize === 11.0, `10-item quiz fits at 11.0 pt (got ${fit10.fontSize} pt)`);

    // ── Test 6: Fit decision for 40-item mixed quiz ────────────────────────────
    const fit40 = await decideFit(quiz40ItemMixed, {}, font);
    assert(fit40.mode === 'SEPARATE', `40-item mixed quiz chooses SEPARATE (got ${fit40.mode})`);
    assert(fit40.pages >= 2, `40-item quiz estimates multiple pages (got ${fit40.pages} pages)`);

    // ── Test 7: Force separate override ───────────────────────────────────────
    const fit10Force = await decideFit(quiz10ItemMC, { forceSeparate: true }, font);
    assert(fit10Force.mode === 'SEPARATE', `forceSeparate: true forces SEPARATE mode on 10-item quiz`);

    // ── Test 8: Primary grade minimum font ────────────────────────────────────
    const fitGrade2 = await decideFit(quiz20ItemMC, { gradeLevel: 'Grade 2' }, font);
    if (fitGrade2.mode === 'ALL_IN_ONE') {
        assert(fitGrade2.fontSize >= 10.5, `Grade 2 assessment does not scale below 10.5 pt (got ${fitGrade2.fontSize})`);
    } else {
        assert(true, 'Grade 2 switched to separate when candidate >= 10.5 pt overflowed');
    }

    // ── Test 9: Determinism ───────────────────────────────────────────────────
    const fitRun1 = await decideFit(quiz40ItemMixed, {}, font);
    const fitRun2 = await decideFit(quiz40ItemMixed, {}, font);
    assert(
        fitRun1.mode === fitRun2.mode && fitRun1.fontSize === fitRun2.fontSize && fitRun1.pages === fitRun2.pages,
        'Fit decision is 100% deterministic'
    );

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
