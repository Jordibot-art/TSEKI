import { LayoutJSON } from "./printEngine/types";

export type NormalizedBoxRegion = [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0..1000

export interface PixelCropRect {
    originX: number;
    originY: number;
    width: number;
    height: number;
}

/**
 * Validates and normalizes a bounding box returned by Vision AI into [ymin, xmin, ymax, xmax] in 0..1000.
 * Accepts either 0..1000 integers (Gemini native format) or 0..1 normalized floats.
 * Rejects invalid, inverted, or full-page boxes.
 */
export function sanitizeBoxRegion(raw: unknown): NormalizedBoxRegion | undefined {
    if (!Array.isArray(raw) || raw.length !== 4) return undefined;
    const nums = raw.map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n))) return undefined;

    let [ymin, xmin, ymax, xmax] = nums;

    // Support 0..1 normalized floats from backup vision providers
    const maxVal = Math.max(ymin, xmin, ymax, xmax);
    if (maxVal > 0 && maxVal <= 1.0) {
        ymin *= 1000;
        xmin *= 1000;
        ymax *= 1000;
        xmax *= 1000;
    }

    ymin = Math.max(0, Math.min(1000, Math.round(ymin)));
    xmin = Math.max(0, Math.min(1000, Math.round(xmin)));
    ymax = Math.max(0, Math.min(1000, Math.round(ymax)));
    xmax = Math.max(0, Math.min(1000, Math.round(xmax)));

    const h = ymax - ymin;
    const w = xmax - xmin;
    if (h < 8 || w < 8) return undefined;
    // Reject degenerate full-page boxes (> 85% width AND > 85% height)
    if (w > 850 && h > 850) return undefined;

    return [ymin, xmin, ymax, xmax];
}

/**
 * Validates a paper boundary region [ymin, xmin, ymax, xmax] in 0..1000.
 */
export function sanitizePaperRegion(raw: unknown): NormalizedBoxRegion | undefined {
    if (!Array.isArray(raw) || raw.length !== 4) return undefined;
    const nums = raw.map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n))) return undefined;

    let [ymin, xmin, ymax, xmax] = nums;
    const maxVal = Math.max(ymin, xmin, ymax, xmax);
    if (maxVal > 0 && maxVal <= 1.0) {
        ymin *= 1000;
        xmin *= 1000;
        ymax *= 1000;
        xmax *= 1000;
    }

    ymin = Math.max(0, Math.min(1000, Math.round(ymin)));
    xmin = Math.max(0, Math.min(1000, Math.round(xmin)));
    ymax = Math.max(0, Math.min(1000, Math.round(ymax)));
    xmax = Math.max(0, Math.min(1000, Math.round(xmax)));

    if (ymax - ymin < 250 || xmax - xmin < 250) return undefined;
    return [ymin, xmin, ymax, xmax];
}

/**
 * Computes a fallback 0..1000 bounding box for a question number by projecting its
 * Print Engine LayoutJSON rect onto the detected paper region in the photo.
 */
export function estimateBoxRegionFromLayout(
    questionNumber: number,
    layoutJson?: LayoutJSON,
    paperRegion?: NormalizedBoxRegion
): NormalizedBoxRegion | undefined {
    if (!layoutJson || !Array.isArray(layoutJson.pages) || layoutJson.pages.length === 0) {
        return undefined;
    }

    const pageW = layoutJson.pageSize?.width || 612;
    const pageH = layoutJson.pageSize?.height || 792;
    if (pageW <= 0 || pageH <= 0) return undefined;

    let matchingItems: LayoutJSON["pages"][number]["items"] = [];
    for (const page of layoutJson.pages) {
        const found = (page.items || []).filter(
            (it) => Number(it.questionNumber) === Number(questionNumber)
        );
        if (found.length > 0) {
            matchingItems = found;
            break;
        }
    }
    if (matchingItems.length === 0) return undefined;

    // Union of all rects for this question (handles multi-box enumerations)
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of matchingItems) {
        const r = item.rect;
        if (!r) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;

    const [pYmin, pXmin, pYmax, pXmax] = paperRegion || [55, 30, 955, 970];
    const pH = pYmax - pYmin;
    const pW = pXmax - pXmin;

    const ymin = Math.round(pYmin + (minY / pageH) * pH);
    const xmin = Math.round(pXmin + (minX / pageW) * pW);
    const ymax = Math.round(pYmin + (maxY / pageH) * pH);
    const xmax = Math.round(pXmin + (maxX / pageW) * pW);

    return sanitizeBoxRegion([ymin, xmin, ymax, xmax]);
}

/**
 * Converts a 0..1000 normalized boxRegion into a generously padded, strictly clamped
 * pixel crop rectangle so both the question number label and its handwritten answer box
 * appear large, sharp, and legible in the review card.
 */
export function computePaddedPixelCrop(
    imgWidth: number,
    imgHeight: number,
    boxRegion: NormalizedBoxRegion
): PixelCropRect | null {
    if (!Number.isFinite(imgWidth) || !Number.isFinite(imgHeight) || imgWidth < 20 || imgHeight < 20) {
        return null;
    }

    const [ymin, xmin, ymax, xmax] = boxRegion;
    const boxW = xmax - xmin;
    const boxH = ymax - ymin;

    // Add generous left padding when box is tight around just the square answer box
    // so the teacher sees the question number & end of the prompt right next to the box,
    // while keeping the handwritten answer box large and legible.
    const isTightBox = boxW < 180;
    const padLeft = isTightBox ? 140 : 40;
    const padRight = isTightBox ? 50 : 40;
    const padTop = boxH < 90 ? 38 : 30;
    const padBottom = boxH < 90 ? 44 : 35;

    let cropYmin = Math.max(0, ymin - padTop);
    let cropXmin = Math.max(0, xmin - padLeft);
    let cropYmax = Math.min(1000, ymax + padBottom);
    let cropXmax = Math.min(1000, xmax + padRight);

    // Ensure a readable landscape crop frame (at least 190x95 in 0..1000 coords)
    if (cropXmax - cropXmin < 190) {
        const deficit = 190 - (cropXmax - cropXmin);
        cropXmin = Math.max(0, cropXmin - Math.round(deficit * 0.65));
        cropXmax = Math.min(1000, cropXmin + 190);
    }
    if (cropYmax - cropYmin < 95) {
        const deficit = 95 - (cropYmax - cropYmin);
        cropYmin = Math.max(0, cropYmin - Math.round(deficit * 0.5));
        cropYmax = Math.min(1000, cropYmin + 95);
    }

    const originX = Math.max(0, Math.min(imgWidth - 1, Math.floor((cropXmin / 1000) * imgWidth)));
    const originY = Math.max(0, Math.min(imgHeight - 1, Math.floor((cropYmin / 1000) * imgHeight)));
    const rightPx = Math.max(originX + 1, Math.min(imgWidth, Math.ceil((cropXmax / 1000) * imgWidth)));
    const bottomPx = Math.max(originY + 1, Math.min(imgHeight, Math.ceil((cropYmax / 1000) * imgHeight)));

    const width = rightPx - originX;
    const height = bottomPx - originY;
    if (width < 10 || height < 10) return null;

    return { originX, originY, width, height };
}

// In-memory cache so repeated modal opens / scrolls never re-crop the same question
const cropUriCache = new Map<string, string>();
const imageSizeCache = new Map<string, { width: number; height: number }>();

async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
    const cached = imageSizeCache.get(uri);
    if (cached) return cached;

    const { Image } = await import("react-native");
    return new Promise((resolve, reject) => {
        Image.getSize(
            uri,
            (width, height) => {
                const dims = { width, height };
                imageSizeCache.set(uri, dims);
                resolve(dims);
            },
            (err) => reject(err)
        );
    });
}

/**
 * Generates (and caches) a crisp zoomed crop URI for a specific question's answer box
 * from the captured test sheet image.
 */
export async function getCroppedQuestionImageUri(params: {
    imageUri: string;
    questionNumber: number;
    boxRegion?: NormalizedBoxRegion;
    layoutJson?: LayoutJSON;
    paperRegion?: NormalizedBoxRegion;
}): Promise<string | null> {
    const { imageUri, questionNumber, boxRegion, layoutJson, paperRegion } = params;
    if (!imageUri) return null;

    const resolvedRegion =
        sanitizeBoxRegion(boxRegion) ||
        estimateBoxRegionFromLayout(questionNumber, layoutJson, paperRegion);

    if (!resolvedRegion) return null;

    const cacheKey = `${imageUri}::Q${questionNumber}::${resolvedRegion.join(",")}`;
    const cached = cropUriCache.get(cacheKey);
    if (cached) return cached;

    try {
        const dims = await getImageDimensions(imageUri);
        const pixelCrop = computePaddedPixelCrop(dims.width, dims.height, resolvedRegion);
        if (!pixelCrop) return null;

        const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
        const result = await manipulateAsync(
            imageUri,
            [{ crop: pixelCrop }],
            { compress: 0.92, format: SaveFormat.JPEG }
        );

        if (result?.uri) {
            cropUriCache.set(cacheKey, result.uri);
            return result.uri;
        }
    } catch (err) {
        console.warn(`[QuestionCrop] Failed to crop Q${questionNumber}:`, err);
    }

    return null;
}
