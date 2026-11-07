const assert = require("assert");

/**
 * Unit tests for TSEKI OCR & Handwriting Grader Scribble & Low-Confidence Detection
 */

function testScribbleAndLowConfidenceLogic() {
    console.log("=== Testing Accurate Scribble & Low-Confidence Detection ===");

    // Simulate grading post-processing logic from lib/gradingService.ts
    function evaluateItem(detected, officialCorrect, qNum = 1) {
        const rawStudentAnswer = String(detected.studentAnswer ?? detected.answer ?? "").trim();
        let confidence = typeof detected.confidence === "number" ? detected.confidence : 0.95;

        let flagReason = detected.flagReason || undefined;
        let flagDetails = detected.flagDetails || undefined;
        let detectedOptions = Array.isArray(detected.detectedOptions)
            ? detected.detectedOptions.map((o) => String(o).trim().toUpperCase()).filter(Boolean)
            : [];

        if (flagReason === "null" || flagReason === "none" || flagReason === "") {
            flagReason = undefined;
        }
        if (flagReason === "faint" || flagReason === "scribbled" || flagReason === "messy" || flagReason === "correction") {
            flagReason = "unclear";
        }
        if (flagReason === "multiple_answers" || flagReason === "overwritten") {
            flagReason = "double_mark";
        }

        // 1. Detect visual evidence of scribble, dark blob, scratch-out, or correction
        const visualText = [
            detected.visualObservations,
            detected.rawMarksDescription,
            detected.notes,
            detected.flagDetails,
            flagDetails,
        ].filter(Boolean).join(" ").toLowerCase();

        const hasScribbleEvidence = Boolean(
            detected.hasScribbleOrCorrection === true ||
            detected.isScribbled === true ||
            detected.hasCorrection === true ||
            (detected.scribbleType && detected.scribbleType !== "none") ||
            /\b(scribble|scribbled|scratch|scratched|crossed|cross-out|blob|shaded|blacked|correction|corrected|smudge|erasure|superimposed|overwritten|messy|double|stray ink)\b/i.test(visualText)
        );

        if (hasScribbleEvidence) {
            confidence = Math.min(confidence, 0.38);
            flagReason = flagReason || (detectedOptions.length >= 2 ? "double_mark" : "unclear");
            if (!flagDetails) {
                flagDetails = `Scribble, dark blob, or correction mark detected in box #${qNum}`;
            }
        }

        // 2. Deterministic detection of double-shaded / overwritten / multiple marked boxes
        const isSingleChoice = !officialCorrect.includes(",") && (officialCorrect.length === 1 || officialCorrect === "T" || officialCorrect === "F");
        const multipleMarkRegex = /^([A-D]|[T|F])\s*[,/&+\sor-]+\s*([A-D]|[T|F])$/i;
        const compactLetters = rawStudentAnswer.replace(/[^A-Za-z0-9]/g, "");

        if (
            multipleMarkRegex.test(rawStudentAnswer) ||
            (isSingleChoice && compactLetters.length >= 2 && compactLetters.length <= 4 && /^[A-D]+$/i.test(compactLetters)) ||
            (detectedOptions.length >= 2 && !flagReason)
        ) {
            flagReason = flagReason || "double_mark";
            flagDetails = flagDetails || `Multiple or overwritten marks detected (${rawStudentAnswer || detectedOptions.join(", ")})`;
            confidence = Math.min(confidence, 0.40);
            if (detectedOptions.length === 0) {
                detectedOptions = Array.from(new Set(rawStudentAnswer.toUpperCase().match(/[A-D]/g) || []));
            }
        }

        // 3. Detect uncertainty markers in rawStudentAnswer
        if (/[?*]|\b(unclear|scribble|illegible|messy|blob)\b/i.test(rawStudentAnswer)) {
            flagReason = flagReason || "unclear";
            flagDetails = flagDetails || `Unclear or scribbled mark detected inside box #${qNum}`;
            confidence = Math.min(confidence, 0.38);
        }

        // 4. If AI or visual scrutiny flagged double_mark, unclear, or low_confidence, strictly enforce low confidence (< 0.70)
        if (flagReason === "double_mark" || flagReason === "unclear" || flagReason === "low_confidence" || detected.flaggedForReview === true) {
            confidence = Math.min(confidence, 0.45);
            if (!flagDetails) {
                flagDetails =
                    flagReason === "double_mark"
                        ? `Overwritten or double-shaded mark in box #${qNum}`
                        : `Unclear or scribbled mark in box #${qNum}`;
            }
        }

        // 5. Automatic low confidence threshold (< 0.75)
        const isLowConfidence = confidence < 0.75;
        if (isLowConfidence && !flagReason) {
            flagReason = "low_confidence";
            flagDetails = flagDetails || `Low OCR confidence (${Math.round(confidence * 100)}%)`;
        }

        const isFlagged = Boolean(
            hasScribbleEvidence ||
            detected.flaggedForReview === true ||
            flagReason === "double_mark" ||
            flagReason === "unclear" ||
            flagReason === "low_confidence" ||
            isLowConfidence
        );

        let isMatch = false;
        let awarded = 0;
        if (flagReason === "double_mark" && isSingleChoice) {
            isMatch = false;
            awarded = 0;
        } else {
            isMatch = rawStudentAnswer.toUpperCase() === officialCorrect.toUpperCase();
            awarded = isMatch ? 1 : 0;
        }

        return {
            studentAnswer: rawStudentAnswer,
            confidence,
            flagReason,
            flagDetails,
            flaggedForReview: isFlagged,
            isCorrect: isMatch,
            pointsAwarded: awarded,
        };
    }

    let passed = 0;

    // Test 1: User's Box #2 — Dark circular blob + C (even if AI originally guessed high confidence 0.88)
    const resBox2 = evaluateItem({
        questionNumber: 2,
        hasScribbleOrCorrection: true,
        visualObservations: "Dark circular ink blob / scribble next to letter C",
        studentAnswer: "C",
        confidence: 0.88, // AI was overconfident
        flagReason: null,
    }, "C", 2);

    assert.strictEqual(resBox2.flaggedForReview, true, "Box #2 with scribble must be flagged for review");
    assert.ok(resBox2.confidence <= 0.45, `Box #2 confidence must be <= 0.45, got ${resBox2.confidence}`);
    assert.strictEqual(resBox2.flagReason, "unclear", "Box #2 flagReason must be 'unclear'");
    assert.ok(resBox2.flagDetails.includes("box #2"), "Flag details must mention box #2");
    console.log("  ✓ PASS: Box #2 with dark ink blob & letter C is accurately flagged (confidence lowered to " + resBox2.confidence + ")");
    passed++;

    // Test 2: User's Box #4 — Heavy scratch-outs / zig-zag strokes over letter A
    const resBox4 = evaluateItem({
        questionNumber: 4,
        hasScribbleOrCorrection: true,
        visualObservations: "Letter A with heavy scratch-out strokes covering box",
        studentAnswer: "A",
        confidence: 0.78,
    }, "A", 4);

    assert.strictEqual(resBox4.flaggedForReview, true, "Box #4 with scratch-outs must be flagged for review");
    assert.ok(resBox4.confidence <= 0.45, "Box #4 confidence must be <= 0.45");
    assert.strictEqual(resBox4.flagReason, "unclear", "Box #4 flagReason must be 'unclear'");
    console.log("  ✓ PASS: Box #4 with scratch-outs over letter A is accurately flagged");
    passed++;

    // Test 3: Box with double mark / overwritten letters e.g. "B, C"
    const resDouble = evaluateItem({
        questionNumber: 3,
        hasScribbleOrCorrection: true,
        visualObservations: "Two letters written: B and C",
        studentAnswer: "B, C",
        confidence: 0.50,
        flagReason: "double_mark",
    }, "B", 3);

    assert.strictEqual(resDouble.flaggedForReview, true, "Double mark must be flagged");
    assert.strictEqual(resDouble.flagReason, "double_mark", "Must have double_mark reason");
    assert.strictEqual(resDouble.isCorrect, false, "Double-marked single choice must not be auto-awarded points");
    console.log("  ✓ PASS: Double-marked answer 'B, C' is accurately flagged and awarded 0 points until teacher verifies");
    passed++;

    // Test 4: User's Box #1 — Clean letter B
    const resClean = evaluateItem({
        questionNumber: 1,
        hasScribbleOrCorrection: false,
        visualObservations: "Single clean letter B",
        studentAnswer: "B",
        confidence: 0.96,
        flagReason: null,
    }, "B", 1);

    assert.strictEqual(resClean.flaggedForReview, false, "Clean answer must NOT be flagged");
    assert.strictEqual(resClean.flagReason, undefined, "Clean answer must have no flagReason");
    assert.strictEqual(resClean.isCorrect, true, "Clean matching answer must be correct");
    assert.strictEqual(resClean.pointsAwarded, 1, "Must receive 1 point");
    console.log("  ✓ PASS: Clean letter B passes without flag (confidence " + resClean.confidence + ")");
    passed++;

    // Test 5: Compact letters "BC" in single box
    const resCompact = evaluateItem({
        questionNumber: 5,
        studentAnswer: "BC",
        confidence: 0.90,
    }, "B", 5);

    assert.strictEqual(resCompact.flaggedForReview, true, "Compact multiple letters 'BC' must be flagged");
    assert.strictEqual(resCompact.flagReason, "double_mark", "Must be flagged as double_mark");
    console.log("  ✓ PASS: Multiple compact letters 'BC' in single box detected as double_mark");
    passed++;

    // Test 6: Question mark or uncertainty in answer string
    const resUncertain = evaluateItem({
        questionNumber: 6,
        studentAnswer: "C?",
        confidence: 0.70,
    }, "C", 6);

    assert.strictEqual(resUncertain.flaggedForReview, true, "Uncertain mark 'C?' must be flagged");
    assert.strictEqual(resUncertain.flagReason, "unclear", "Must be flagged as unclear");
    console.log("  ✓ PASS: Question mark in answer 'C?' triggers review flag");
    passed++;

    console.log(`\nResults: ${passed} passed, 0 failed\n`);
}

testScribbleAndLowConfidenceLogic();
