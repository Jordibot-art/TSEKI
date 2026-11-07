// Unit test verifying the simplified, non-intrusive live hover summary, edge/flat removal, and live blur detection

function evaluateLiveHoverQuality(gridOrNull, qrObs, nowMs = Date.now()) {
    let meanLuminance = 140;
    let lightingOverride = null;
    if (gridOrNull && gridOrNull.luma && gridOrNull.luma.length > 0) {
        let sum = 0;
        const total = gridOrNull.luma.length;
        for (let i = 0; i < total; i++) {
            sum += gridOrNull.luma[i];
        }
        meanLuminance = Math.round(sum / total);
        if (meanLuminance < 75) {
            lightingOverride = "too_dark";
        } else if (meanLuminance > 235) {
            lightingOverride = "too_bright";
        }
    }

    const qrRecentlySeen = qrObs.detected && nowMs - qrObs.lastSeenMs <= 450;
    const isBlurry = Boolean(qrObs.isBlurry);

    // Case 1: QR code is NOT visible in camera preview
    if (!qrRecentlySeen) {
        const summaryText = isBlurry
            ? "Answers blurred — hold steady"
            : "Align QR code in frame";
        const warnings = [summaryText];

        return {
            lighting: lightingOverride || "ok",
            qrVisible: false,
            cornerMarkersVisible: false,
            visibleCornerCount: 0,
            paperFlat: true,
            fullEdgesVisible: true,
            isBlurry,
            hasWarnings: true,
            warnings,
            cornerStatus: {
                tl: false,
                tr: false,
                bl: false,
                br: false,
            },
            meanLuminance,
            summaryText,
        };
    }

    // Case 2: QR code is detected in real time!
    const bounds = qrObs.boundsNorm || { x: 0.70, y: 0.22, width: 0.14, height: 0.14 };
    const { x, y, width: qw, height: qh } = bounds;

    const isTooClose = qw > 0.24 || qh > 0.24;

    let tr = x + qw <= 0.98 && y >= 0.04;
    let tl = !isTooClose && x >= 0.18;
    let br = !isTooClose && y + qh <= 0.85;
    let bl = !isTooClose && tl && br;

    if (isTooClose) {
        tl = false;
        bl = false;
        br = false;
    }

    const visibleCornerCount = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
    const cornerMarkersVisible = visibleCornerCount === 4;

    const lighting = lightingOverride || "ok";

    let summaryText = "Ready to capture";
    const warnings = [];

    if (isBlurry) {
        summaryText = "Answers blurred — hold steady";
        warnings.push(summaryText);
    } else if (lighting === "too_dark") {
        summaryText = "Too dark — tap Torch (⚡)";
        warnings.push(summaryText);
    } else if (lighting === "too_bright") {
        summaryText = "Harsh glare — tilt slightly";
        warnings.push(summaryText);
    } else if (isTooClose) {
        summaryText = "Move camera back";
        warnings.push(summaryText);
    } else if (!cornerMarkersVisible) {
        summaryText = `Align all 4 corner markers (${visibleCornerCount}/4)`;
        warnings.push(summaryText);
    }

    return {
        lighting,
        qrVisible: true,
        cornerMarkersVisible,
        visibleCornerCount,
        paperFlat: true,
        fullEdgesVisible: true,
        isBlurry,
        hasWarnings: warnings.length > 0,
        warnings,
        cornerStatus: { tl, tr, bl, br },
        meanLuminance,
        summaryText,
    };
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
        console.log(`  ✓ PASS: ${msg}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL: ${msg}`);
    }
}

console.log("=== Testing Simplified Live Hover Guidance, Focus & Blur Detection ===");

// 1. QR code not visible (out of frame)
const res1 = evaluateLiveHoverQuality(null, { detected: false, lastSeenMs: 0 }, 10000);
assert(res1.qrVisible === false, "QR is marked not visible");
assert(res1.hasWarnings === true, "Has warnings is true");
assert(res1.summaryText === "Align QR code in frame", "Summary is single punchy line: 'Align QR code in frame'");
assert(res1.warnings.length === 1, "Only 1 single warning (no multi-line bullet list)");
assert(res1.paperFlat === true, "Edge/flat hassle disabled (paperFlat is always true)");

// 2. Aligned sheet with 4/4 markers and sharp focus
const res2 = evaluateLiveHoverQuality(
    null,
    { detected: true, lastSeenMs: 9800, boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 }, isBlurry: false },
    10000
);
assert(res2.qrVisible === true, "QR is detected");
assert(res2.cornerMarkersVisible === true, "All 4 corner markers visible");
assert(res2.isBlurry === false, "isBlurry is false");
assert(res2.hasWarnings === false, "No warnings when paper is aligned and sharp");
assert(res2.summaryText === "Ready to capture", "Summary is 'Ready to capture'");

// 3. Hovering over paper with blurred answers / camera motion
const resBlur = evaluateLiveHoverQuality(
    null,
    { detected: true, lastSeenMs: 9800, boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 }, isBlurry: true },
    10000
);
assert(resBlur.isBlurry === true, "Detects blurry / motion-blurred test paper");
assert(resBlur.hasWarnings === true, "Blurry sheet raises active warning");
assert(resBlur.summaryText === "Answers blurred — hold steady", "Summary specifically warns: 'Answers blurred — hold steady'");

// 4. Camera too close (cutting off corners)
const res3 = evaluateLiveHoverQuality(
    null,
    { detected: true, lastSeenMs: 9800, boundsNorm: { x: 0.65, y: 0.15, width: 0.28, height: 0.28 } },
    10000
);
assert(res3.hasWarnings === true, "Too close triggers warning");
assert(res3.summaryText === "Move camera back", "Summary is 'Move camera back'");

// 5. Room too dark
const res4 = evaluateLiveHoverQuality(
    { width: 10, height: 10, luma: new Uint8Array(100).fill(30) },
    { detected: true, lastSeenMs: 9800, boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 } },
    10000
);
assert(res4.lighting === "too_dark", "Detects underexposed / dark scene");
assert(res4.summaryText.includes("Too dark"), "Summary prompts torch: 'Too dark — tap Torch (⚡)'");

// 6. Room too bright / harsh glare
const res5 = evaluateLiveHoverQuality(
    { width: 10, height: 10, luma: new Uint8Array(100).fill(250) },
    { detected: true, lastSeenMs: 9800, boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 } },
    10000
);
assert(res5.lighting === "too_bright", "Detects overexposed / glare scene");
assert(res5.summaryText.includes("Harsh glare"), "Summary warns about glare: 'Harsh glare — tilt slightly'");

// 7. Fast reset when moving away to another paper (> 450ms without QR)
const resMoving = evaluateLiveHoverQuality(
    null,
    { detected: true, lastSeenMs: 9500, boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 } },
    10000 // 500ms later
);
assert(resMoving.qrVisible === false, "Instantly resets QR when moving away to another paper (no 3s delay)");
assert(resMoving.cornerMarkersVisible === false, "Markers reset to 0/4 immediately");
assert(resMoving.summaryText === "Align QR code in frame", "Promptly directs teacher to align next paper");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
