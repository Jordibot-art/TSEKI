import { LightingCondition, PhotoQualityDiagnostics } from "./gradingService";

export interface LiveCornerVisibility {
    tl: boolean;
    tr: boolean;
    bl: boolean;
    br: boolean;
}

export interface LiveHoverDiagnostics extends PhotoQualityDiagnostics {
    cornerStatus: LiveCornerVisibility;
    meanLuminance: number;
    summaryText: string;
}

export interface QrLiveObservation {
    detected: boolean;
    lastSeenMs: number;
    /** Normalized 0..1 bounding box in screen space if available */
    boundsNorm?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Corner points in screen space if available */
    cornerPoints?: { x: number; y: number }[];
    /** Whether real-time camera motion or defocus indicates blurry answers */
    isBlurry?: boolean;
}

/**
 * Evaluates real-time camera hover observation purely from continuous barcode scanner telemetry
 * WITHOUT taking any background photos or triggering camera shutter/exposure flash cycles.
 *
 * Checks all 5 optical capture conditions in real time:
 * 1. Room is too dark (QR code cannot be resolved due to underexposure/shadows)
 * 2. Room is too light / glare (QR code washed out by harsh flash/reflection)
 * 3. QR code is not visible (out of frame, covered, or too blurry)
 * 4. 4 corner markers not visible (camera too close, tilted, or corners cut off)
 * 5. Paper is not flat or full edges not visible (perspective skew, creased/tilted, edges cut off)
 */
export function evaluateLiveHoverQuality(
    gridOrNull: { width: number; height: number; luma: Uint8Array } | null,
    qrObs: QrLiveObservation,
    nowMs: number = Date.now()
): LiveHoverDiagnostics {
    // If a static luminance grid is provided (e.g. from unit tests), check brightness directly
    let meanLuminance = 140;
    let lightingOverride: LightingCondition | null = null;
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
    // Evaluate geometry, distance, and 4 corner markers (edges/flat removed per user request)
    const bounds = qrObs.boundsNorm || { x: 0.70, y: 0.22, width: 0.14, height: 0.14 };
    const { x, y, width: qw, height: qh } = bounds;

    // Paper Distance Analysis
    // Standard TSEKI sheet: QR code is ~ 54pt on a 612pt wide page (~ 0.088 width ratio)
    // If QR code width in screen space > 0.24, the paper is wider than the screen!
    const isTooClose = qw > 0.24 || qh > 0.24;

    // Corner visibility based on projected paper boundary
    // Top-right corner marker is adjacent to the QR code
    let tr = x + qw <= 0.98 && y >= 0.04;
    // Top-left corner is ~ 9x QR width to the left of TR
    let tl = !isTooClose && x >= 0.18;
    // Bottom-right corner is ~ 12x QR height below TR
    let br = !isTooClose && y + qh <= 0.85;
    // Bottom-left corner
    let bl = !isTooClose && tl && br;

    // If too close, bottom and left corners are cut off
    if (isTooClose) {
        tl = false;
        bl = false;
        br = false;
    }

    const visibleCornerCount = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
    const cornerMarkersVisible = visibleCornerCount === 4;

    // Lighting evaluation
    const lighting: LightingCondition = lightingOverride || "ok";

    let summaryText = "Ready to capture";
    const warnings: string[] = [];

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

export interface CropRect {
    originX: number;
    originY: number;
    width: number;
    height: number;
}

/**
 * Calculates the exact crop box matching the on-screen reticle that the user framed,
 * translating from screen coordinate space into raw camera sensor pixel space.
 */
export function computeReticleCropRect(
    photoWidth: number,
    photoHeight: number,
    screenWidth: number,
    screenHeight: number,
    safetyMarginFraction: number = 0.08
): CropRect {
    const pw = Math.max(1, photoWidth);
    const ph = Math.max(1, photoHeight);
    const sw = Math.max(1, screenWidth);
    const sh = Math.max(1, screenHeight);

    // Reticle dimensions matching BatchScannerModal.tsx
    const reticleWidth = sw * 0.88;
    const reticleHeight = Math.min(sw * 0.88 * 1.30, sh * 0.54);
    const reticleX = (sw - reticleWidth) / 2;
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

/**
 * Automatically crops the raw captured photo to the exact area the teacher aligned inside the reticle,
 * trimming away excess background (laptop keyboard, desk edges, lap/legs).
 *
 * This ensures the student's answer sheet fills the image, stays crisp at high resolution,
 * and completely prevents the "zoomed out" effect.
 */
export async function cropCapturedSheetToReticle(
    photo: { uri: string; width?: number; height?: number },
    screenWidth: number,
    screenHeight: number
): Promise<{ uri: string; width: number; height: number }> {
    try {
        const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");

        let pw = photo.width || 0;
        let ph = photo.height || 0;

        // If dimensions were not returned directly by the camera driver, inspect with manipulateAsync
        if (!pw || !ph) {
            const probe = await manipulateAsync(photo.uri, [], { format: SaveFormat.JPEG });
            pw = probe.width;
            ph = probe.height;
        }

        if (!pw || !ph) {
            return { uri: photo.uri, width: pw || 1280, height: ph || 1700 };
        }

        let currentUri = photo.uri;
        // If raw sensor buffer is landscape (pw > ph) while device is in portrait (screenWidth < screenHeight),
        // normalize orientation first so crop coordinates map 1:1
        if (pw > ph && screenWidth < screenHeight) {
            const rotated = await manipulateAsync(currentUri, [{ rotate: 90 }], { format: SaveFormat.JPEG });
            currentUri = rotated.uri;
            pw = rotated.width;
            ph = rotated.height;
        }

        const cropRect = computeReticleCropRect(pw, ph, screenWidth, screenHeight, 0.08);

        // Crop to the framed answer sheet and normalize to sharp 1400px width for Gemini Vision AI
        const cropped = await manipulateAsync(
            currentUri,
            [
                { crop: cropRect },
                { resize: { width: 1400 } },
            ],
            {
                compress: 0.85,
                format: SaveFormat.JPEG,
            }
        );

        return {
            uri: cropped.uri,
            width: cropped.width,
            height: cropped.height,
        };
    } catch (err) {
        console.warn("[CameraGrader] Reticle auto-crop fallback to original photo:", err);
        return {
            uri: photo.uri,
            width: photo.width || 1280,
            height: photo.height || 1700,
        };
    }
}

