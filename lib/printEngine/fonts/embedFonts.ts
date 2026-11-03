// lib/printEngine/fonts/embedFonts.ts

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';

export interface FontSingleton {
    regularBytes: Uint8Array;
    boldBytes: Uint8Array;
}

export interface EmbeddedPrintFonts {
    regular: PDFFont;
    bold: PDFFont;
}

let cachedFontSingleton: FontSingleton | null = null;
let loadingPromise: Promise<FontSingleton | null> | null = null;

function decodeBase64ToBytes(base64: string): Uint8Array {
    const clean = base64.replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(clean, 'base64'));
    }
    const binaryString = atob(clean);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

type NodeFontLoader = () => Promise<FontSingleton> | FontSingleton;

function getRegisteredNodeFontLoader(): NodeFontLoader | undefined {
    return (globalThis as any).__TSEKI_NODE_FONT_LOADER__ as NodeFontLoader | undefined;
}

async function readSingleAssetBytes(assetModule: any): Promise<Uint8Array | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Asset } = require('expo-asset') as typeof import('expo-asset');
        const asset = Asset.fromModule(assetModule);

        // Download asset with 2.5s timeout
        try {
            await Promise.race([
                asset.downloadAsync(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
            ]);
        } catch {
            // Ignore download timeout/error and proceed with available URI
        }

        const uri = asset.localUri || asset.uri;
        if (!uri) return null;

        // 1. Try FileSystem first if local file:// URI on Android/iOS (avoids 2.5s fetch timeout on native)
        if (typeof uri === 'string' && uri.startsWith('file://')) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
                const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                if (b64 && b64.length > 1000) {
                    return decodeBase64ToBytes(b64);
                }
            } catch {
                // Fall through to fetch
            }
        }

        // 2. Fallback to fetch(uri) — works on web and remote asset URIs
        try {
            const resp = await Promise.race([
                fetch(uri),
                new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('fetch timeout')), 2500)),
            ]);
            if (resp && resp.ok) {
                const buf = await resp.arrayBuffer();
                if (buf && buf.byteLength > 1000) {
                    return new Uint8Array(buf);
                }
            }
        } catch {
            // Ignore fetch error
        }
    } catch (e) {
        console.warn('Asset byte read error:', e);
    }
    return null;
}

async function loadFontBytesFromAssets(): Promise<FontSingleton | null> {
    const nodeLoader = getRegisteredNodeFontLoader();
    if (nodeLoader) {
        return await nodeLoader();
    }

    try {
        const [regularBytes, boldBytes] = await Promise.all([
            readSingleAssetBytes(require('../../../assets/fonts/NotoSans-Regular.ttf')),
            readSingleAssetBytes(require('../../../assets/fonts/NotoSans-Bold.ttf')),
        ]);

        if (regularBytes && boldBytes) {
            return { regularBytes, boldBytes };
        }
    } catch (err) {
        console.warn('Could not load custom Noto Sans font assets:', err);
    }
    return null;
}

export async function getFontSingleton(): Promise<FontSingleton | null> {
    if (cachedFontSingleton) {
        return cachedFontSingleton;
    }
    if (!loadingPromise) {
        loadingPromise = loadFontBytesFromAssets().then((res) => {
            if (res) cachedFontSingleton = res;
            return res;
        }).finally(() => {
            loadingPromise = null;
        });
    }
    return loadingPromise;
}

export async function embedPrintFonts(doc: PDFDocument): Promise<EmbeddedPrintFonts> {
    try {
        const fonts = await Promise.race([
            getFontSingleton(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);

        if (fonts && fonts.regularBytes && fonts.boldBytes) {
            doc.registerFontkit(fontkit);
            const regular = await doc.embedFont(fonts.regularBytes, { subset: false });
            const bold = await doc.embedFont(fonts.boldBytes, { subset: false });
            return { regular, bold };
        }
    } catch (err) {
        console.warn('Fontkit font embed note, falling back to standard Helvetica:', err);
    }

    // Standard PDF-native fallback (instant, 0ms, 0 bytes loaded, 100% reliable)
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { regular, bold };
}
