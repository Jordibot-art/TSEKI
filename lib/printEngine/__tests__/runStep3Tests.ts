// lib/printEngine/__tests__/runStep3Tests.ts

import { generatePrintPackage } from '../index';
import { findLayoutItemBox, formatBoxesForGraderPrompt, generateAnswerVariants, validateAnswerLengths } from '../layoutJson';
import { GeneratedAssessment } from '../types';
import { quiz40ItemMixed } from './fixtures/sampleQuizzes';

async function runStep3Tests() {
    console.log('=== Running Step 3: Layout JSON & Answer Key Utilities Tests ===\n');
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

    // ── Test 1: Answer Length Validation ──────────────────────────────────────
    const testQuizWithLongAnswer: GeneratedAssessment = {
        quizTitle: 'Length Validation Test',
        questions: [
            { questionNumber: 1, type: 'identification', questionText: 'Q1', options: [], answerBoxesRequired: 1 },
            { questionNumber: 2, type: 'identification', questionText: 'Q2', options: [], answerBoxesRequired: 1 },
            { questionNumber: 3, type: 'enumeration', questionText: 'Q3', options: [], answerBoxesRequired: 2 },
        ],
        answerKey: [
            { questionNumber: 1, correctAnswer: 'CPU', points: 1 },
            { questionNumber: 2, correctAnswer: 'This is an excessively long identification answer that definitely exceeds twenty five chars', points: 1 },
            { questionNumber: 3, correctAnswer: 'RAM, Extremely long enumeration item description that should be flagged by the validator', points: 2 },
        ],
    };

    const flagged = validateAnswerLengths(testQuizWithLongAnswer);
    assert(flagged.length === 2, `Validator flags 2 long answers (got ${flagged.length})`);
    assert(flagged.some((f) => f.questionNumber === 2), 'Question 2 flagged for long text');
    assert(flagged.some((f) => f.questionNumber === 3), 'Question 3 flagged for long enumeration item');

    const cleanFlags = validateAnswerLengths(quiz40ItemMixed);
    assert(cleanFlags.length === 0, 'Clean 40-item quiz has zero flagged questions');

    // ── Test 2: Answer Variant Generation ─────────────────────────────────────
    const variants = generateAnswerVariants(quiz40ItemMixed);
    assert(variants.length === 40, `Generated variants for all 40 questions (got ${variants.length})`);

    // Check True/False variants
    const tfVar = variants.find((v) => v.type === 'true_false');
    assert(Boolean(tfVar && tfVar.accepted.includes('T') && tfVar.accepted.includes('TRUE')), 'True/False accepts both T and TRUE');

    // Check identification variant with space/punctuation
    const sampleAssessmentWithPunct: GeneratedAssessment = {
        quizTitle: 'Punctuation Test',
        questions: [{ questionNumber: 1, type: 'identification', questionText: 'Term', options: [], answerBoxesRequired: 1 }],
        answerKey: [{ questionNumber: 1, correctAnswer: 'Client-Server, Network.', points: 1 }],
    };
    const punctVariants = generateAnswerVariants(sampleAssessmentWithPunct);
    assert(punctVariants[0].accepted.includes('CLIENT SERVER NETWORK'), 'Strips punctuation in variant');
    assert(punctVariants[0].accepted.includes('CLIENTSERVERNETWORK'), 'Provides compressed variant');

    // ── Test 3: Layout JSON Prompt Formatting & Lookup ────────────────────────
    const pkg = await generatePrintPackage(quiz40ItemMixed);
    const promptText = formatBoxesForGraderPrompt(pkg.layoutJson);
    assert(promptText.includes('LAYOUT COORDINATE MAP'), 'Prompt text has header');
    assert(promptText.includes('Item 1 (letter): box at [x='), 'Prompt text includes item 1 box coordinates');
    assert(promptText.includes('Item 37.1 (text): box at [x='), 'Prompt text includes enumeration 37.1 box');

    const boxItem1 = findLayoutItemBox(pkg.layoutJson, 1);
    assert(Boolean(boxItem1 && boxItem1.box.width > 0), 'Found item 1 box via findLayoutItemBox');

    const boxItem37Sub2 = findLayoutItemBox(pkg.layoutJson, 37, 2);
    assert(Boolean(boxItem37Sub2 && boxItem37Sub2.subIndex === 2), 'Found item 37.2 box via findLayoutItemBox');

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
}

runStep3Tests().catch((err) => {
    console.error('Step 3 test execution failed:', err);
    process.exit(1);
});
