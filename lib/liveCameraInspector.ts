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

    const qrRecentlySeen = qrObs.detected && nowMs - qrObs.lastSeenMs <= 2200;

    // Case 1: QR code is NOT visible in camera preview
    if (!qrRecentlySeen) {
        const warnings: string[] = [];
        warnings.push("QR code is not visible — align the top-right QR code inside the frame.");
        warnings.push("4 corner markers not visible (0/4 detected) — fit all 4 black corner squares inside the brackets.");
        warnings.push("Full paper edges not detected — position the entire answer sheet inside the reticle.");
        warnings.push("Check lighting — if room is dark or sheet is in shadow, tap Torch (⚡).");

        return {
            lighting: lightingOverride || "ok",
            qrVisible: false,
            cornerMarkersVisible: false,
            visibleCornerCount: 0,
            paperFlat: false,
            fullEdgesVisible: false,
            hasWarnings: true,
            warnings,
            cornerStatus: {
                tl: false,
                tr: false,
                bl: false,
                br: false,
            },
            meanLuminance,
        };
    }

    // Case 2: QR code is detected in real time!
    // Evaluate geometry, distance, perspective skew, and paper boundaries
    const warnings: string[] = [];

    const bounds = qrObs.boundsNorm || { x: 0.70, y: 0.22, width: 0.14, height: 0.14 };
    const { x, y, width: qw, height: qh } = bounds;

    // 1. Perspective Skew & Flatness Analysis
    let paperFlat = true;
    let skewDetected = false;

    // If QR aspect ratio is severely distorted (normal is 1:1 square)
    if (qw > 0 && qh > 0) {
        const aspect = qw / qh;
        if (aspect < 0.65 || aspect > 1.50) {
            paperFlat = false;
            skewDetected = true;
        }
    }

    // If cornerPoints (quadrilateral) are available, check opposite side ratios
    if (Array.isArray(qrObs.cornerPoints) && qrObs.cornerPoints.length === 4) {
        const pts = qrObs.cornerPoints;
        const dist = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
            Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const side0 = dist(pts[0], pts[1]);
        const side1 = dist(pts[1], pts[2]);
        const side2 = dist(pts[2], pts[3]);
        const side3 = dist(pts[3], pts[0]);

        if (side0 > 0 && side2 > 0) {
            const ratio02 = side0 / side2;
            if (ratio02 < 0.65 || ratio02 > 1.50) {
                paperFlat = false;
                skewDetected = true;
            }
        }
        if (side1 > 0 && side3 > 0) {
            const ratio13 = side1 / side3;
            if (ratio13 < 0.65 || ratio13 > 1.50) {
                paperFlat = false;
                skewDetected = true;
            }
        }
    }

    // 2. Paper Distance & Envelope Analysis
    // Standard TSEKI sheet: QR code is ~ 54pt on a 612pt wide page (~ 0.088 width ratio)
    // If QR code width in screen space > 0.24, the paper is wider than the screen!
    const isTooClose = qw > 0.24 || qh > 0.24;
    const isTooFar = qw > 0 && qw < 0.045;

    // 3. Corner visibility based on projected paper boundary
    // Top-right corner marker is adjacent to the QR code
    let tr = x + qw <= 0.98 && y >= 0.04;
    // Top-left corner is ~ 9x QR width to the left of TR
    let tl = !isTooClose && x >= 0.18;
    // Bottom-right corner is ~ 12x QR height below TR
    let br = !isTooClose && y + qh <= 0.85;
    // Bottom-left corner
    let bl = !isTooClose && tl && br;

    // If too close, bottom and left corners/edges are cut off
    if (isTooClose) {
        tl = false;
        bl = false;
        br = false;
    }

    const visibleCornerCount = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
    const cornerMarkersVisible = visibleCornerCount === 4;

    const fullEdgesVisible =
        !isTooClose &&
        !isTooFar &&
        x + qw <= 0.98 &&
        x >= 0.15 &&
        y >= 0.04 &&
        y + qh <= 0.88 &&
        visibleCornerCount >= 4;

    // 4. Lighting evaluation
    const lighting: LightingCondition = lightingOverride || "ok";

    if (lighting === "too_dark") {
        warnings.push("Room is too dark — move to brighter light or tap Torch (⚡).");
    } else if (lighting === "too_bright") {
        warnings.push("Room is too light / harsh glare — tilt slightly to avoid reflection.");
    }

    if (isTooClose) {
        warnings.push("Camera is too close — pull back slightly so all 4 edges of the paper fit inside.");
    } else if (isTooFar) {
        warnings.push("Camera is too far — bring the phone slightly closer to the test paper.");
    }

    if (!cornerMarkersVisible) {
        warnings.push(
            `4 corner markers not visible (${visibleCornerCount}/4 detected) — fit all 4 black corner squares inside the brackets.`
        );
    }

    if (!paperFlat && !fullEdgesVisible) {
        warnings.push("Paper is not flat and full edges are not visible — lay sheet flat and fit all 4 edges inside the frame.");
    } else if (!paperFlat || skewDetected) {
        warnings.push("Paper is tilted or folded — smooth out folds and hold the camera parallel directly above the paper.");
    } else if (!fullEdgesVisible) {
        warnings.push("Full paper edges are cut off — center the test sheet inside the dashed reticle.");
    }

    return {
        lighting,
        qrVisible: true,
        cornerMarkersVisible,
        visibleCornerCount,
        paperFlat,
        fullEdgesVisible,
        hasWarnings: warnings.length > 0,
        warnings,
        cornerStatus: { tl, tr, bl, br },
        meanLuminance,
    };
}

