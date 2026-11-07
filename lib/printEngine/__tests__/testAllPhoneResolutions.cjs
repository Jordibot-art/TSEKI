const { computeReticleCropRect } = require("./testReticleCrop.cjs");

const testDevices = [
    { name: "Samsung Galaxy S24 Ultra (19.5:9)", sw: 412, sh: 915, pw: 3000, ph: 4000 },
    { name: "Samsung Galaxy A54 (20:9)", sw: 360, sh: 800, pw: 3024, ph: 4032 },
    { name: "Oppo / Realme / Vivo (20:9 HD+)", sw: 360, sh: 800, pw: 2448, ph: 3264 },
    { name: "Xiaomi Redmi Note (20:9)", sw: 393, sh: 873, pw: 3000, ph: 4000 },
    { name: "iPhone 15 / 16 Pro (19.5:9)", sw: 393, sh: 852, pw: 3024, ph: 4032 },
    { name: "iPhone 15 / 16 Pro Max (19.5:9)", sw: 430, sh: 932, pw: 3024, ph: 4032 },
    { name: "iPhone SE / Older Android (16:9)", sw: 375, sh: 667, pw: 3024, ph: 4032 },
    { name: "iPad 10th Gen (4:3 tablet)", sw: 810, sh: 1080, pw: 3024, ph: 4032 },
    { name: "Android Tablet 16:10", sw: 800, sh: 1280, pw: 3024, ph: 4032 },
    { name: "50MP Android Camera (8160x6120)", sw: 390, sh: 844, pw: 6120, ph: 8160 },
    { name: "108MP Android Camera (12000x9000)", sw: 390, sh: 844, pw: 9000, ph: 12000 },
];

console.log("=== Testing Reticle Crop Across All Smartphone & Tablet Resolutions ===");

let passed = 0;
let failed = 0;

for (const d of testDevices) {
    const crop = computeReticleCropRect(d.pw, d.ph, d.sw, d.sh, 0.08);
    
    const valid = 
        crop.originX >= 0 &&
        crop.originY >= 0 &&
        crop.originX + crop.width <= d.pw &&
        crop.originY + crop.height <= d.ph &&
        crop.width > d.pw * 0.45 &&
        crop.height > d.ph * 0.45;

    if (valid) {
        passed++;
        console.log(`  ✓ PASS [${d.name}]: Crop [x=${crop.originX}, y=${crop.originY}, w=${crop.width}, h=${crop.height}] fits inside ${d.pw}x${d.ph}`);
    } else {
        failed++;
        console.error(`  ✗ FAIL [${d.name}]: Out of bounds or invalid!`, crop);
    }
}

console.log(`\nDevice Matrix Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
