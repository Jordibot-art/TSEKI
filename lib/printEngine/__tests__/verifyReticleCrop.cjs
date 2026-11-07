const { computeReticleCropRect } = require("./testReticleCrop.cjs");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
        console.log(`  PASS: ${msg}`);
    } else {
        failed++;
        console.error(`  FAIL: ${msg}`);
    }
}

console.log("=== Testing Reticle Auto-Crop on Captured Photos ===");

// Check standard 3024x4032 photo on 1080x2400 screen
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
