// lib/printEngine/mobileShare.ts

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { uint8ArrayToBase64 } from './index';
import { GeneratedAssessment, PrintOptions } from './types';

const PDF_CACHE_SUBDIR = 'tseki_pdfs/';

// In-memory cache for ultra-fast (0ms) lookups across all platforms (iOS, Android, Web, Node)
const memoryPdfCache = new Map<string, Uint8Array>();
const memoryUriCache = new Map<string, string>();

/**
 * Computes a fast deterministic content hash for caching rendered PDFs by
 * {quizId}_{version}_{contentHash}_{docTag}.
 */
export function computeAssessmentCacheKey(
    assessment: GeneratedAssessment,
    options: PrintOptions = {},
    docTag?: 'student' | 'key'
): string {
    const version = options.version || 'A';
    const paperSize = options.paperSize || 'short';
    const forceSep = options.forceSeparate ? 'sep' : 'auto';
    // Use a stable identifier based on quiz title/id so cache keys are 100% deterministic
    const stableId = ((assessment as any).id || assessment.quizTitle || 'assessment')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 32);
    const resolvedDocTag = docTag || (options.target === 'ANSWER_KEY_ONLY' ? 'key' : 'student');

    const payload = JSON.stringify({
        t: assessment.quizTitle,
        q: assessment.questions.map((q) => [q.questionNumber, q.type, q.questionText, q.options, q.answerBoxesRequired]),
        k: assessment.answerKey?.map((a) => [a.questionNumber, a.correctAnswer, a.points]),
        v: version,
        p: paperSize,
        s: forceSep,
        d: resolvedDocTag,
    });

    // FNV-1a 32-bit hash
    let hash = 0x811c9dc5;
    for (let i = 0; i < payload.length; i++) {
        hash ^= payload.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    const hexHash = hash.toString(16).padStart(8, '0');
    return `${stableId}_${version}_${paperSize}_${forceSep}_${hexHash}_${resolvedDocTag}.pdf`;
}

async function ensureCacheDir(): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    if (!FileSystem.cacheDirectory) return null;
    const dir = `${FileSystem.cacheDirectory}${PDF_CACHE_SUBDIR}`;
    try {
        const info = await FileSystem.getInfoAsync(dir);
        if (!info.exists) {
            await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        }
    } catch {
        // Ignore directory creation errors
    }
    return dir;
}

/**
 * Checks whether a cached PDF already exists in memory or on disk for the given cacheFileName.
 * Returns the file URI if present, or null otherwise.
 */
export async function getCachedPdfUri(cacheFileName: string): Promise<string | null> {
    // 1. Instant in-memory check (0 ms) - Web (ObjectURL) or Mobile (fileUri)
    if (memoryUriCache.has(cacheFileName)) {
        return memoryUriCache.get(cacheFileName)!;
    }

    if (memoryPdfCache.has(cacheFileName)) {
        const bytes = memoryPdfCache.get(cacheFileName)!;
        if (Platform.OS === 'web' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
            const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            memoryUriCache.set(cacheFileName, url);
            return url;
        }

        // On native mobile, if bytes are in memory:
        const dir = (await ensureCacheDir()) || FileSystem.cacheDirectory || '';
        const fileUri = `${dir}${cacheFileName}`;
        memoryUriCache.set(cacheFileName, fileUri);
        try {
            const base64 = uint8ArrayToBase64(bytes);
            await FileSystem.writeAsStringAsync(fileUri, base64, {
                encoding: FileSystem.EncodingType.Base64,
            });
        } catch {
            // Ignore
        }
        return fileUri;
    }

    if (Platform.OS === 'web') return null;

    // 2. Disk check for mobile native if app was restarted
    const dir = await ensureCacheDir();
    if (!dir) return null;
    const fileUri = `${dir}${cacheFileName}`;
    try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (info.exists && (info.size ?? 0) > 100) {
            memoryUriCache.set(cacheFileName, fileUri);
            return fileUri;
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Writes a PDF Uint8Array into in-memory cache and FileSystem.cacheDirectory + 'tseki_pdfs/'
 * and returns its URI (or ObjectURL on Web).
 */
export async function writeCachedPdf(cacheFileName: string, bytes: Uint8Array): Promise<string> {
    memoryPdfCache.set(cacheFileName, bytes);

    if (Platform.OS === 'web') {
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
            const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            memoryUriCache.set(cacheFileName, url);
            return url;
        }
        return cacheFileName;
    }

    const dir = (await ensureCacheDir()) || FileSystem.cacheDirectory || '';
    const fileUri = `${dir}${cacheFileName}`;
    memoryUriCache.set(cacheFileName, fileUri);
    try {
        const base64 = uint8ArrayToBase64(bytes);
        await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
        });
        return fileUri;
    } catch (e) {
        console.warn('Could not write cached PDF to disk:', e);
        return fileUri;
    }
}

/**
 * Opens an already-cached PDF URI using the native sharing / printing sheet on mobile,
 * or downloads directly in the browser on Web.
 */
export async function shareCachedPdfUri(
    fileUri: string,
    dialogTitle: string = 'Export PDF',
    suggestedFileName: string = 'Tseki_Assessment.pdf'
): Promise<string> {
    if (Platform.OS === 'web') {
        if (typeof document !== 'undefined') {
            const link = document.createElement('a');
            link.href = fileUri;
            link.download = suggestedFileName.endsWith('.pdf') ? suggestedFileName : `${suggestedFileName}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        return fileUri;
    }

    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
            mimeType: 'application/pdf',
            dialogTitle,
            UTI: '.pdf',
        });
    }
    return fileUri;
}

/**
 * Saves a rendered PDF Uint8Array to the app cache and launches
 * native sharing / printing on iOS/Android, or direct browser download on Web.
 */
export async function sharePdfBytes(
    bytes: Uint8Array,
    fileName: string,
    dialogTitle: string = 'Export PDF'
): Promise<string> {
    if (Platform.OS === 'web') {
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
            const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return url;
        }
    }

    const tempUri = await writeCachedPdf(fileName, bytes);
    return await shareCachedPdfUri(tempUri, dialogTitle, fileName);
}
