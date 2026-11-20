import assert from "assert";
import {
    evaluateGradedItem,
    isItemFlaggedForReview,
    isItemUnresolvedFlag,
    LOW_CONFIDENCE_THRESHOLD,
} from "../../gradingService";
import {
    computePaddedPixelCrop,
    estimateBoxRegionFromLayout,
    sanitizeBoxRegion,
    sanitizePaperRegion,
} from "../../questionCropService";
import type { LayoutJSON } from "../../printEngine/types";

const sampleLayout: LayoutJSON = {
    quizId: "QZ-TEST",
    version: "A",
    pageSize: { width: 612, height: 792 },
    pages: [
        {
            pageNumber: 1,
            markers: [],
            qr: { x: 480, y: 40, width: 80, height: 80, content: "QZ-TEST" },
            items: [
                {
                    questionNumber: 1,
                    type: "letter",
                    rect: { x: 255, y: 210, width: 24, height: 22 },
                    maxChars: 1,
                },
                {
                    questionNumber: 3,
                    type: "letter",
                    rect: { x: 255, y: 390, width: 24, height: 22 },
                    maxChars: 1,
                },
            ],
        },
        {
            pageNumber: 2,
            markers: [],
            qr: { x: 480, y: 40, width: 80, height: 80, content: "QZ-TEST" },
            items: [
                {
                    questionNumber: 12,
                    type: "letter",
                    rect: { x: 520, y: 180, width: 24, height: 22 },
                    maxChars: 1,
                },
            ],
        },
    ],
    answerVariants: [],
    createdAt: "2026-11-21T00:00:00Z",
};

let passed = 0;

function runTest(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
}

console.log("=== Testing Low-Confidence Detection & Question Box Cropping ===");

runTest("Clean single letter with negated visualObservations is NOT falsely flagged", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 1,
            visualObservations: "Single crisp letter B with zero cross-outs, overwrites, or smudges",
            inkCleanliness: "clean_single_mark",
            hasScribbleOrCorrection: false,
            detectedOptions: ["B"],
            studentAnswer: "B",
            confidence: 0.97,
            flagReason: null,
            flagDetails: null,
            boxRegion: [240, 415, 272, 455],
        },
        { questionNumber: 1, correctAnswer: "B", points: 1 },
        0,
        [],
        sampleLayout
    );

    assert.strictEqual(res.flaggedForReview, false);
    assert.strictEqual(isItemFlaggedForReview(res), false);
    assert.strictEqual(isItemUnresolvedFlag(res), false);
    assert.strictEqual(res.isCorrect, true);
    assert.strictEqual(res.pointsAwarded, 1);
    assert.deepStrictEqual(res.boxRegion, [240, 415, 272, 455]);
});

runTest("Cleanly blank answer box is NOT flagged and scores 0", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 2,
            visualObservations: "Empty square box, no handwriting or marks",
            inkCleanliness: "blank",
            hasScribbleOrCorrection: false,
            detectedOptions: [],
            studentAnswer: "",
            confidence: 0.96,
            flagReason: "blank",
            flagDetails: null,
        },
        { questionNumber: 2, correctAnswer: "C", points: 1 },
        1
    );

    assert.strictEqual(res.flaggedForReview, false);
    assert.strictEqual(isItemUnresolvedFlag(res), false);
    assert.strictEqual(res.isCorrect, false);
    assert.strictEqual(res.pointsAwarded, 0);
});

runTest("Crossed-out Q3 (C or B) is flagged, captures candidates, preserves boxRegion, and scores 0 pending review", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 3,
            visualObservations: "Dense crossed-out and overwritten strokes inside box; looks like C or B",
            inkCleanliness: "crossed_out",
            hasScribbleOrCorrection: true,
            detectedOptions: ["B", "C"],
            studentAnswer: "?",
            confidence: 0.28,
            flagReason: "unclear",
            flagDetails: "Crossed-out mark in box #3 — ambiguous between B and C",
            boxRegion: [452, 405, 488, 448],
        },
        { questionNumber: 3, correctAnswer: "A", points: 1 },
        2,
        [],
        sampleLayout
    );

    assert.strictEqual(res.flaggedForReview, true);
    assert.strictEqual(isItemFlaggedForReview(res), true);
    assert.strictEqual(isItemUnresolvedFlag(res), true);
    assert.ok((res.confidence ?? 1) <= 0.45);
    assert.deepStrictEqual(res.detectedOptions, ["B", "C"]);
    assert.strictEqual(res.isCorrect, false);
    assert.strictEqual(res.pointsAwarded, 0);
    assert.deepStrictEqual(res.boxRegion, [452, 405, 488, 448]);
});

runTest("Crossed-out box where AI overconfidently guesses correct key STILL flags and withholds points", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 3,
            visualObservations: "Letter A written over a scratched-out mark",
            inkCleanliness: "crossed_out",
            hasScribbleOrCorrection: true,
            detectedOptions: ["A"],
            studentAnswer: "A",
            confidence: 0.89,
            flagReason: null,
        },
        { questionNumber: 3, correctAnswer: "A", points: 1 },
        2
    );

    assert.strictEqual(res.flaggedForReview, true);
    assert.ok((res.confidence ?? 1) <= 0.45);
    assert.strictEqual(res.isCorrect, false, "Unverified flagged single-choice item must not auto-award points");
    assert.strictEqual(res.pointsAwarded, 0);
});

runTest("Subtle ambiguity cue in visualObservations flags even if model omitted hasScribbleOrCorrection", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 3,
            visualObservations: "Heavy ink strokes, hard to read, could be B or C",
            studentAnswer: "C",
            confidence: 0.84,
        },
        { questionNumber: 3, correctAnswer: "C", points: 1 },
        2
    );

    assert.strictEqual(res.flaggedForReview, true);
    assert.ok((res.confidence ?? 1) <= 0.45);
    assert.strictEqual(res.pointsAwarded, 0);
});

runTest("Out-of-set MC OCR letter (e.g. garbled 'R' or 'K' from crossed-out mark) is automatically flagged", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 3,
            studentAnswer: "R",
            confidence: 0.86,
        },
        { questionNumber: 3, correctAnswer: "A", points: 1 },
        2
    );

    assert.strictEqual(res.flaggedForReview, true);
    assert.strictEqual(res.flagReason, "unclear");
    assert.ok((res.confidence ?? 1) <= 0.35);
    assert.strictEqual(res.pointsAwarded, 0);
});

runTest("Borderline OCR confidence (< 0.80) triggers low_confidence review flag and withholds points", () => {
    const res = evaluateGradedItem(
        {
            questionNumber: 4,
            studentAnswer: "B",
            confidence: LOW_CONFIDENCE_THRESHOLD - 0.04,
        },
        { questionNumber: 4, correctAnswer: "B", points: 1 },
        3
    );

    assert.strictEqual(res.flaggedForReview, true);
    assert.strictEqual(res.flagReason, "low_confidence");
    assert.strictEqual(res.pointsAwarded, 0);
});

runTest("Teacher resolution keeps historical AI flag while clearing unresolved state", () => {
    const flagged = evaluateGradedItem(
        {
            questionNumber: 3,
            inkCleanliness: "overwritten",
            detectedOptions: ["B", "C"],
            studentAnswer: "B/C",
            confidence: 0.32,
        },
        { questionNumber: 3, correctAnswer: "C", points: 1 },
        2
    );
    assert.strictEqual(isItemUnresolvedFlag(flagged), true);

    const resolved = {
        ...flagged,
        studentAnswer: "C",
        isCorrect: true,
        pointsAwarded: 1,
        isOverridden: true,
    };
    assert.strictEqual(isItemFlaggedForReview(resolved), true);
    assert.strictEqual(isItemUnresolvedFlag(resolved), false);
});

runTest("sanitizeBoxRegion handles 0..1000 ints, 0..1 floats, and rejects degenerate/full-page boxes", () => {
    assert.deepStrictEqual(sanitizeBoxRegion([445, 400, 488, 452]), [445, 400, 488, 452]);
    assert.deepStrictEqual(sanitizeBoxRegion([0.445, 0.4, 0.488, 0.452]), [445, 400, 488, 452]);
    assert.strictEqual(sanitizeBoxRegion([500, 400, 400, 450]), undefined);
    assert.strictEqual(sanitizeBoxRegion([0, 0, 990, 990]), undefined);
    assert.deepStrictEqual(sanitizePaperRegion([60, 20, 950, 960]), [60, 20, 950, 960]);
    assert.strictEqual(sanitizePaperRegion([0, 0, 100, 100]), undefined);
});

runTest("LayoutJSON fallback estimates Q3 and multi-page Q12 boxRegion when AI omits boxRegion", () => {
    const paperRegion: [number, number, number, number] = [80, 40, 940, 960];
    const q3Res = evaluateGradedItem(
        {
            questionNumber: 3,
            inkCleanliness: "crossed_out",
            studentAnswer: "?",
            confidence: 0.3,
        },
        { questionNumber: 3, correctAnswer: "A", points: 1 },
        2,
        [],
        sampleLayout,
        paperRegion
    );
    assert.ok(q3Res.boxRegion, "Q3 should fall back to LayoutJSON boxRegion");
    assert.ok(q3Res.boxRegion![0] > 450 && q3Res.boxRegion![0] < 550, `Unexpected Q3 ymin: ${q3Res.boxRegion![0]}`);

    const q12Box = estimateBoxRegionFromLayout(12, sampleLayout, paperRegion);
    assert.ok(q12Box, "Page 2 Q12 should be found by multi-page LayoutJSON lookup");
    assert.ok(q12Box![1] > 700, `Expected right-column Q12 xmin > 700, got ${q12Box![1]}`);
});

runTest("computePaddedPixelCrop pads tight boxes for legibility and clamps safely inside image bounds", () => {
    const crop = computePaddedPixelCrop(1800, 2400, [460, 405, 485, 445]);
    assert.ok(crop, "Should compute valid pixel crop");
    assert.ok(crop!.originX >= 0 && crop!.originY >= 0);
    assert.ok(crop!.originX + crop!.width <= 1800);
    assert.ok(crop!.originY + crop!.height <= 2400);
    assert.ok(crop!.width >= Math.floor(0.19 * 1800), "Tight box should receive generous horizontal context");
    assert.ok(crop!.originX < Math.floor(0.35 * 1800), "Left padding should include question number & stem context");

    // Top-left and bottom-right boundary clamping
    const tl = computePaddedPixelCrop(1200, 1600, [5, 5, 30, 35]);
    assert.ok(tl && tl.originX === 0 && tl.originY === 0);
    assert.ok(tl!.originX + tl!.width <= 1200 && tl!.originY + tl!.height <= 1600);

    const br = computePaddedPixelCrop(1200, 1600, [965, 955, 995, 995]);
    assert.ok(br && br.originX >= 0 && br.originY >= 0);
    assert.ok(br!.originX + br!.width <= 1200 && br!.originY + br!.height <= 1600);
});

console.log(`\nResults: ${passed} passed, 0 failed`);
