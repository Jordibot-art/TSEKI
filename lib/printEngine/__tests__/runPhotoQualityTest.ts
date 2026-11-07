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

console.log("=== Testing PhotoQualityDiagnostics & Flash-Free Live Hover Inspector ===");

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

// 2. Flash-Free Live Hover — QR not visible in preview
const hoverNoQr = evaluateLiveHoverQuality(
    null,
    { detected: false, lastSeenMs: 0 },
    10000
);
assert(hoverNoQr.qrVisible === false, "Live hover detects QR is not visible");
assert(hoverNoQr.hasWarnings === true, "Live hover warns when QR not visible");
assert(hoverNoQr.warnings.some((w) => w.includes("QR code is not visible")), "Warning mentions QR code is not visible");
assert(hoverNoQr.warnings.some((w) => w.includes("4 corner markers not visible (0/4 detected)")), "Warning mentions 0/4 markers detected");

// 3. Flash-Free Live Hover — Perfect QR lock & paper alignment
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
assert(hoverAligned.paperFlat === true, "paperFlat is true");
assert(hoverAligned.fullEdgesVisible === true, "fullEdgesVisible is true");
assert(hoverAligned.hasWarnings === false, "Zero warnings when paper is well aligned");

// 4. Flash-Free Live Hover — Camera too close (QR > 24% of screen)
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
assert(hoverTooClose.warnings.some((w) => w.toLowerCase().includes("too close")), "Warning tells teacher camera is too close");
assert(hoverTooClose.fullEdgesVisible === false, "fullEdgesVisible is false when too close");

// 5. Flash-Free Live Hover — Paper tilted / folded (aspect skew)
const hoverTilted = evaluateLiveHoverQuality(
    null,
    {
        detected: true,
        lastSeenMs: 9800,
        boundsNorm: { x: 0.70, y: 0.20, width: 0.08, height: 0.16 }, // aspect ratio 0.5
    },
    10000
);
assert(hoverTilted.hasWarnings === true, "Tilted paper triggers warning");
assert(hoverTilted.paperFlat === false, "paperFlat is false when tilted");
assert(hoverTilted.warnings.some((w) => w.toLowerCase().includes("tilted")), "Warning tells teacher paper is tilted or folded");

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
