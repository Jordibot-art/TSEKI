import { normalizePhotoQuality } from "../../gradingService";
import {
    computeReticleCropRect,
    evaluateLiveHoverQuality,
} from "../../liveCameraInspector";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
    if (cond) {
        passed++;
        console.log(`  PASS: ${msg}`);
    } else {
        failed++;
        console.error(`  FAIL: ${msg}`);
    }
}

console.log("=== Testing PhotoQualityDiagnostics & Live Hover Summary (Edge/Flat Removed) ===");

// 1. Clean photo (post-capture validation)
const clean = normalizePhotoQuality({
    lighting: "ok",
    qrVisible: true,
    cornerMarkersVisible: true,
    visibleCornerCount: 4,
    paperFlat: true,
    fullEdgesVisible: true,
});
assert(clean.hasWarnings === false, "Clean photo has no warnings");
assert(clean.warnings.length === 0, "Clean photo warnings array is empty");

// 2. Live Hover — QR not visible in preview (summarized, no bullet list)
const hoverNoQr = evaluateLiveHoverQuality(
    null,
    { detected: false, lastSeenMs: 0 },
    10000
);
assert(hoverNoQr.qrVisible === false, "Live hover detects QR is not visible");
assert(hoverNoQr.hasWarnings === true, "Live hover warns when QR not visible");
assert(hoverNoQr.summaryText === "Align QR code in frame", "summaryText is short and punchy: 'Align QR code in frame'");
assert(hoverNoQr.warnings.length === 1, "Single concise warning, not a giant bullet list");

// 3. Live Hover — Perfect QR lock & 4/4 markers
const hoverAligned = evaluateLiveHoverQuality(
    null,
    {
        detected: true,
        lastSeenMs: 9800,
        boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 },
    },
    10000
);
assert(hoverAligned.qrVisible === true, "Live hover detects QR visible");
assert(hoverAligned.visibleCornerCount === 4, "Live hover detects all 4 corner markers in frame");
assert(hoverAligned.cornerMarkersVisible === true, "cornerMarkersVisible is true");
assert(hoverAligned.hasWarnings === false, "Zero warnings when paper is aligned");
assert(hoverAligned.summaryText === "Ready to capture", "summaryText is 'Ready to capture'");

// 4. Live Hover — Camera too close (QR > 24% of screen)
const hoverTooClose = evaluateLiveHoverQuality(
    null,
    {
        detected: true,
        lastSeenMs: 9800,
        boundsNorm: { x: 0.65, y: 0.15, width: 0.28, height: 0.28 },
    },
    10000
);
assert(hoverTooClose.hasWarnings === true, "Camera too close triggers warning");
assert(hoverTooClose.summaryText === "Move camera back", "summaryText summarizes to 'Move camera back'");

// 5. Live Hover — Low lighting
const hoverDark = evaluateLiveHoverQuality(
    { width: 10, height: 10, luma: new Uint8Array(100).fill(40) },
    {
        detected: true,
        lastSeenMs: 9800,
        boundsNorm: { x: 0.70, y: 0.20, width: 0.14, height: 0.14 },
    },
    10000
);
assert(hoverDark.hasWarnings === true, "Dark room triggers warning");
assert(hoverDark.summaryText.includes("Too dark"), "summaryText advises 'Too dark — tap Torch (⚡)'");

// 6. Reticle Auto-Crop to Prevent Zoomed-Out Capture (Trimming Laptop, Desk, Legs)
const crop1 = computeReticleCropRect(3024, 4032, 1080, 2400, 0.08);
assert(crop1.originX >= 0, "Crop originX >= 0");
assert(crop1.originY >= 0, "Crop originY >= 0");
assert(crop1.originX + crop1.width <= 3024, "Crop fits within photo width");
assert(crop1.originY + crop1.height <= 4032, "Crop fits within photo height");
assert(crop1.originY > 600, "Crop removes excess background/laptop at top (originY > 600)");
assert(crop1.originY + crop1.height < 3400, "Crop removes excess lap/legs at bottom");
assert(crop1.width >= 1600 && crop1.height >= 2100, "Crop preserves large high-resolution framed paper");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
