function computeReticleCropRect(
    photoWidth,
    photoHeight,
    screenWidth,
    screenHeight,
    safetyMarginFraction
) {
    if (safetyMarginFraction === undefined) safetyMarginFraction = 0.08;
    var pw = Math.max(1, photoWidth);
    var ph = Math.max(1, photoHeight);
    var sw = Math.max(1, screenWidth);
    var sh = Math.max(1, screenHeight);

    // Reticle dimensions matching BatchScannerModal.tsx
    var reticleWidth = sw * 0.88;
    var reticleHeight = Math.min(sw * 0.88 * 1.30, sh * 0.54);
    var reticleX = (sw - reticleWidth) / 2;
    var reticleY = Math.max(0, (sh - reticleHeight) / 2 - 10);

    // CameraView with StyleSheet.absoluteFillObject uses aspectFill (centerCrop/cover)
    var scaleX = sw / pw;
    var scaleY = sh / ph;
    var scale = Math.max(scaleX, scaleY);

    var displayedWidth = pw * scale;
    var displayedHeight = ph * scale;

    var screenOffsetX = (displayedWidth - sw) / 2;
    var screenOffsetY = (displayedHeight - sh) / 2;

    // Convert reticle area on screen back to native photo pixel space
    var cropPhotoX = (reticleX + screenOffsetX) / scale;
    var cropPhotoY = (reticleY + screenOffsetY) / scale;
    var cropPhotoW = reticleWidth / scale;
    var cropPhotoH = reticleHeight / scale;

    // Safety padding so edges & corner markers are never clipped
    var padX = cropPhotoW * safetyMarginFraction;
    var padY = cropPhotoH * safetyMarginFraction;

    var originX = Math.max(0, Math.floor(cropPhotoX - padX));
    var originY = Math.max(0, Math.floor(cropPhotoY - padY));

    // Clamp width & height to stay strictly within photo pixel boundaries
    var maxAllowedW = pw - originX;
    var maxAllowedH = ph - originY;
    var width = Math.min(maxAllowedW, Math.ceil(cropPhotoW + padX * 2));
    var height = Math.min(maxAllowedH, Math.ceil(cropPhotoH + padY * 2));

    return { originX: originX, originY: originY, width: width, height: height };
}

// Verification checks
console.log("=== Testing computeReticleCropRect ===");
var c1 = computeReticleCropRect(3024, 4032, 360, 800);
console.log("3024x4032 on 360x800:", JSON.stringify(c1));
if (c1.originX < 0 || c1.originY < 0 || c1.originX + c1.width > 3024 || c1.originY + c1.height > 4032) {
    throw new Error("Case 1 out of bounds!");
}

var c2 = computeReticleCropRect(3024, 4032, 1080, 2400);
console.log("3024x4032 on 1080x2400:", JSON.stringify(c2));
if (c2.originX < 0 || c2.originY < 0 || c2.originX + c2.width > 3024 || c2.originY + c2.height > 4032) {
    throw new Error("Case 2 out of bounds!");
}

var c3 = computeReticleCropRect(2160, 3840, 1080, 1920);
console.log("2160x3840 on 1080x1920:", JSON.stringify(c3));
if (c3.originX < 0 || c3.originY < 0 || c3.originX + c3.width > 2160 || c3.originY + c3.height > 3840) {
    throw new Error("Case 3 out of bounds!");
}

console.log("All crop rect tests passed!");

module.exports = { computeReticleCropRect: computeReticleCropRect };
