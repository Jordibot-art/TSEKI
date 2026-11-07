export interface CropRect {
    originX: number;
    originY: number;
    width: number;
    height: number;
}

export function computeReticleCropRect(
    photoWidth: number,
    photoHeight: number,
    screenWidth: number,
    screenHeight: number,
    safetyMarginFraction: number = 0.08
): CropRect {
    // Ensure positive dimensions
    const pw = Math.max(1, photoWidth);
    const ph = Math.max(1, photoHeight);
    const sw = Math.max(1, screenWidth);
    const sh = Math.max(1, screenHeight);

    // Reticle dimensions matching BatchScannerModal.tsx
    const reticleWidth = sw * 0.88;
    const reticleHeight = Math.min(sw * 0.88 * 1.30, sh * 0.54);
    const reticleX = (sw - reticleWidth) / 2;
    // Reticle is centered with marginBottom: 20 -> shifted up ~10pt
    const reticleY = Math.max(0, (sh - reticleHeight) / 2 - 10);

    // CameraView with StyleSheet.absoluteFillObject uses aspectFill (centerCrop/cover)
    const scaleX = sw / pw;
    const scaleY = sh / ph;
    const scale = Math.max(scaleX, scaleY);

    const displayedWidth = pw * scale;
    const displayedHeight = ph * scale;

    const screenOffsetX = (displayedWidth - sw) / 2;
    const screenOffsetY = (displayedHeight - sh) / 2;

    // Convert reticle area on screen back to native photo pixel space
    const cropPhotoX = (reticleX + screenOffsetX) / scale;
    const cropPhotoY = (reticleY + screenOffsetY) / scale;
    const cropPhotoW = reticleWidth / scale;
    const cropPhotoH = reticleHeight / scale;

    // Safety padding so edges & corner markers are never clipped
    const padX = cropPhotoW * safetyMarginFraction;
    const padY = cropPhotoH * safetyMarginFraction;

    const originX = Math.max(0, Math.floor(cropPhotoX - padX));
    const originY = Math.max(0, Math.floor(cropPhotoY - padY));

    // Clamp width & height to stay strictly within photo pixel boundaries
    const maxAllowedW = pw - originX;
    const maxAllowedH = ph - originY;
    const width = Math.min(maxAllowedW, Math.ceil(cropPhotoW + padX * 2));
    const height = Math.min(maxAllowedH, Math.ceil(cropPhotoH + padY * 2));

    return { originX, originY, width, height };
}

// Verification checks
console.log("=== Testing computeReticleCropRect ===");
// Case 1: Standard 4:3 photo (3024x4032) on 9:20 screen (360x800)
const c1 = computeReticleCropRect(3024, 4032, 360, 800);
console.log("3024x4032 on 360x800:", c1);
if (c1.originX < 0 || c1.originY < 0 || c1.originX + c1.width > 3024 || c1.originY + c1.height > 4032) {
    throw new Error("Case 1 out of bounds!");
}

// Case 2: Standard 4:3 photo (3024x4032) on tall 9:21 screen (1080x2400)
const c2 = computeReticleCropRect(3024, 4032, 1080, 2400);
console.log("3024x4032 on 1080x2400:", c2);
if (c2.originX < 0 || c2.originY < 0 || c2.originX + c2.width > 3024 || c2.originY + c2.height > 4032) {
    throw new Error("Case 2 out of bounds!");
}

// Case 3: 16:9 photo (2160x3840) on 9:16 screen (1080x1920)
const c3 = computeReticleCropRect(2160, 3840, 1080, 1920);
console.log("2160x3840 on 1080x1920:", c3);
if (c3.originX < 0 || c3.originY < 0 || c3.originX + c3.width > 2160 || c3.originY + c3.height > 3840) {
    throw new Error("Case 3 out of bounds!");
}

console.log("All crop rect tests passed!");
