import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';

export interface EmbeddedPrintFonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface WebFontCache {
  regularBytes: Uint8Array;
  boldBytes: Uint8Array;
}

let cachedWebFonts: WebFontCache | null = null;
let loadingPromise: Promise<WebFontCache | null> | null = null;

const WIN_ANSI_EXTRA = new Set([
  0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A5, 0x00A7, 0x00A9, 0x00AB, 0x00AC, 0x00AE,
  0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B5, 0x00B7, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF,
  0x00D7, 0x00F7,
  0x2013, 0x2014,
  0x2018, 0x2019, 0x201C, 0x201D,
  0x2022, 0x2026,
]);

/**
 * Returns true if the provided text contains glyphs outside PDF Standard WinAnsi
 * (e.g., Greek letters, math operators >=/<=, arrows, infinity, square root)
 * that require embedding Noto Sans TTF via fontkit.
 */
export function textRequiresUnicodeFont(text?: string): boolean {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0A || code === 0x0D) continue;
    if (code >= 0x20 && code <= 0x7E) continue;
    if (
      (code >= 0x00C0 && code <= 0x00D6) ||
      (code >= 0x00D8 && code <= 0x00F6) ||
      (code >= 0x00F8 && code <= 0x00FF)
    ) {
      continue;
    }
    if (WIN_ANSI_EXTRA.has(code)) continue;
    return true;
  }
  return false;
}

async function fetchFontBytes(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 1000) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function loadWebUnicodeFonts(): Promise<WebFontCache | null> {
  if (cachedWebFonts) return cachedWebFonts;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const [regularBytes, boldBytes] = await Promise.all([
        fetchFontBytes('/fonts/NotoSans-Regular.ttf'),
        fetchFontBytes('/fonts/NotoSans-Bold.ttf'),
      ]);
      if (regularBytes && boldBytes) {
        cachedWebFonts = { regularBytes, boldBytes };
        return cachedWebFonts;
      }
      return null;
    })().finally(() => {
      loadingPromise = null;
    });
  }
  return loadingPromise;
}

export async function embedPrintFonts(
  doc: PDFDocument,
  textSample?: string
): Promise<EmbeddedPrintFonts> {
  // Fast WinAnsi path: 0ms overhead for standard ASCII / Latin-1 papers
  if (textSample !== undefined && !textRequiresUnicodeFont(textSample)) {
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { regular, bold };
  }

  try {
    const fonts = await Promise.race([
      loadWebUnicodeFonts(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]);

    if (fonts) {
      doc.registerFontkit(fontkit);
      try {
        const regular = await doc.embedFont(fonts.regularBytes, { subset: true });
        const bold = await doc.embedFont(fonts.boldBytes, { subset: true });
        return { regular, bold };
      } catch {
        const regular = await doc.embedFont(fonts.regularBytes, { subset: false });
        const bold = await doc.embedFont(fonts.boldBytes, { subset: false });
        return { regular, bold };
      }
    }
  } catch (err) {
    console.warn('[TeacherWeb PrintEngine] Unicode font embed fallback to Helvetica:', err);
  }

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold };
}
