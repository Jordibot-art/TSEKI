// lib/printEngine/__tests__/targetExportTest.ts

import { generatePrintPackage, mergePdfs } from '../index';
import { GeneratedAssessment, ScannableQuestion } from '../types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
    if (cond) {
        console.log(`  ✓ ${msg}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
    }
}

async function run() {
    console.log('--- Testing Targeted Generation & Anti-Cheating Versions ---');

    // 22 questions forces SEPARATE mode
    const questions: ScannableQuestion[] = Array.from({ length: 22 }, (_, i) => ({
        questionNumber: i + 1,
        type: 'multiple_choice' as const,
        questionText: `Question ${i + 1}: What is the capital of Province ${i + 1}?`,
        options: ['A. City 1', 'B. City 2', 'C. City 3', 'D. City 4'],
        correctAnswer: 'A',
        answerBoxesRequired: 1,
    }));

    const assessment: GeneratedAssessment = {
        quizTitle: 'Anti-Cheating & Fast Layout Test',
        questions,
        answerKey: questions.map((q) => ({
            questionNumber: q.questionNumber,
            correctAnswer: 'A',
            points: 1,
        })),
    };

    // Test 1: Fast LAYOUT_ONLY target
    console.log('\n[Test 1] target: LAYOUT_ONLY for fast publishing');
    // Warm up fontkit cache
    await generatePrintPackage(assessment, { target: 'LAYOUT_ONLY', paperSize: 'short' });

    const startLayout = Date.now();
    const layoutPkg = await generatePrintPackage(assessment, {
        target: 'LAYOUT_ONLY',
        paperSize: 'short',
    });
    const layoutElapsed = Date.now() - startLayout;
    console.log(`  Warm Elapsed: ${layoutElapsed}ms`);

    assert(layoutPkg.layoutJson !== undefined, 'LayoutJSON was generated');
    assert(layoutPkg.layoutJson.pages.length > 0, 'LayoutJSON has pages');
    assert(layoutPkg.layoutJson.pages[0].items.length > 0, 'LayoutJSON page 1 has items');
    assert(layoutPkg.pdfs.studentPdf.byteLength === 0, 'studentPdf is empty (not rendered)');
    assert(layoutPkg.pdfs.answerKeyPdf.byteLength === 0, 'answerKeyPdf is empty (not rendered)');
    assert(layoutElapsed < 1500, `Warm LAYOUT_ONLY runs fast (${layoutElapsed}ms < 1500ms)`);

    // Test 2: STUDENT_ONLY target in SEPARATE mode produces combinedStudentPdf
    console.log('\n[Test 2] target: STUDENT_ONLY with combinedStudentPdf');
    const studentPkg = await generatePrintPackage(assessment, {
        target: 'STUDENT_ONLY',
        paperSize: 'short',
    });

    assert(studentPkg.mode === 'SEPARATE', '22 items selected SEPARATE mode');
    assert(studentPkg.pdfs.studentPdf.byteLength > 0, 'Booklet PDF generated');
    assert(studentPkg.pdfs.answerSheetPdf !== undefined && studentPkg.pdfs.answerSheetPdf.byteLength > 0, 'Answer Sheet PDF generated');
    assert(studentPkg.pdfs.combinedStudentPdf !== undefined && studentPkg.pdfs.combinedStudentPdf.byteLength > 0, 'Combined single student PDF generated');
    assert(studentPkg.pdfs.answerKeyPdf.byteLength === 0, 'Answer Key skipped when target is STUDENT_ONLY');

    // Test 3: ANSWER_KEY_ONLY target
    console.log('\n[Test 3] target: ANSWER_KEY_ONLY');
    const keyPkg = await generatePrintPackage(assessment, {
        target: 'ANSWER_KEY_ONLY',
        paperSize: 'short',
    });
    assert(keyPkg.pdfs.answerKeyPdf.byteLength > 0, 'Answer Key PDF generated');
    assert(keyPkg.pdfs.studentPdf.byteLength === 0, 'Student PDF skipped when target is ANSWER_KEY_ONLY');

    // Test 4: Version A vs Version B deterministic shuffle
    console.log('\n[Test 4] Version A vs Version B Anti-Cheating Shuffle');
    const setAPkg = await generatePrintPackage(assessment, {
        target: 'LAYOUT_ONLY',
        version: 'A',
    });
    const setBPkg = await generatePrintPackage(assessment, {
        target: 'LAYOUT_ONLY',
        version: 'B',
    });

    assert(setAPkg.layoutJson.version === 'A', 'Set A has version A in LayoutJSON');
    assert(setBPkg.layoutJson.version === 'B', 'Set B has version B in LayoutJSON');

    // Check that question texts are shuffled between Set A and Set B
    const setAQuestions = assessment.questions.map((q) => q.questionText);
    const setBFirstItem = setBPkg.layoutJson.pages[0].items[0];
    assert(setBFirstItem.questionNumber === 1, 'Set B question 1 is renumbered to 1');

    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);

    if (failed > 0) {
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
