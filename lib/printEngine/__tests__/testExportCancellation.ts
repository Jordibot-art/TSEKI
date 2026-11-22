import './nodeIO';
import {
    abortableDelay,
    ExportCancelledError,
    generatePrintPackage,
    isExportCancelledError,
} from '../index';
import type { GeneratedAssessment } from '../../quizGeneratorService';

function buildAssessment(count: number): GeneratedAssessment {
    const questions = Array.from({ length: count }, (_, idx) => {
        const n = idx + 1;
        return {
            questionNumber: n,
            type: 'multiple_choice' as const,
            questionText: `Question ${n}: Which architectural pattern best ensures resilient classroom assessment export workflows under load?`,
            options: [
                'A) Cooperative AbortSignal cancellation',
                'B) Blocking synchronous polling',
                'C) Unbounded memory buffering',
                'D) Ignoring user cancellation events',
            ],
            answerBoxesRequired: 1,
        };
    });

    return {
        quizTitle: 'Export Cancellation Verification Assessment',
        questions,
        answerKey: questions.map((q) => ({
            questionNumber: q.questionNumber,
            correctAnswer: 'A',
            points: 1,
        })),
    };
}

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        passed += 1;
        console.log(`  PASS  ${name}`);
    } catch (err: any) {
        failed += 1;
        console.error(`  FAIL  ${name}: ${err?.message || err}`);
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

async function main() {
    console.log('\n=== Export Cancellation Tests ===\n');

    await runTest('isExportCancelledError identifies ExportCancelledError and AbortError only', () => {
        assert(isExportCancelledError(new ExportCancelledError()), 'Expected true for ExportCancelledError');
        const domAbort = new Error('The operation was aborted');
        domAbort.name = 'AbortError';
        assert(isExportCancelledError(domAbort), 'Expected true for AbortError');
        assert(!isExportCancelledError(new Error('Network failure')), 'Expected false for generic Error');
        assert(!isExportCancelledError(null), 'Expected false for null');
    });

    await runTest('abortableDelay rejects immediately when signal aborts mid-wait', async () => {
        const controller = new AbortController();
        const start = Date.now();
        setTimeout(() => controller.abort(), 20);

        let caught: unknown = null;
        try {
            await abortableDelay(5000, controller.signal);
        } catch (err) {
            caught = err;
        }
        const elapsed = Date.now() - start;
        assert(isExportCancelledError(caught), 'Expected ExportCancelledError from abortableDelay');
        assert(elapsed < 500, `Expected quick cancellation (<500ms), got ${elapsed}ms`);
    });

    await runTest('pre-aborted signal cancels generatePrintPackage immediately across targets', async () => {
        const assessment = buildAssessment(10);
        const targets = ['ALL', 'STUDENT_ONLY', 'ANSWER_KEY_ONLY', 'LAYOUT_ONLY'] as const;

        for (const target of targets) {
            const controller = new AbortController();
            controller.abort();
            let caught: unknown = null;
            try {
                await generatePrintPackage(assessment, {
                    paperSize: 'short',
                    version: 'A',
                    target,
                    signal: controller.signal,
                });
            } catch (err) {
                caught = err;
            }
            assert(
                isExportCancelledError(caught),
                `Expected ExportCancelledError for pre-aborted target=${target}`
            );
        }
    });

    await runTest('mid-generation abort cancels 50-question SEPARATE export cleanly', async () => {
        const assessment = buildAssessment(50);
        const controller = new AbortController();
        // Trigger abort during the async fit/render cycle
        setTimeout(() => controller.abort(), 5);

        let caught: unknown = null;
        try {
            await generatePrintPackage(assessment, {
                paperSize: 'short',
                version: 'B',
                target: 'STUDENT_ONLY',
                forceSeparate: true,
                signal: controller.signal,
            });
        } catch (err) {
            caught = err;
        }
        assert(isExportCancelledError(caught), 'Expected ExportCancelledError when aborted mid-render');
    });

    await runTest('subsequent export after cancellation succeeds with valid PDF bytes', async () => {
        const assessment = buildAssessment(10);
        const cancelledController = new AbortController();
        cancelledController.abort();

        try {
            await generatePrintPackage(assessment, {
                paperSize: 'short',
                version: 'A',
                target: 'STUDENT_ONLY',
                signal: cancelledController.signal,
            });
        } catch {
            // Expected cancellation
        }

        const freshController = new AbortController();
        const pkg = await generatePrintPackage(assessment, {
            paperSize: 'short',
            version: 'A',
            target: 'STUDENT_ONLY',
            signal: freshController.signal,
        });

        assert(pkg.studentPdf.byteLength > 1000, 'Expected non-empty PDF after previous cancellation');
        assert(pkg.pages >= 1, 'Expected valid page count');
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
