// lib/printEngine/fonts/embedFonts.ts

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont } from 'pdf-lib';
import { getNotoSansBoldBytes, getNotoSansRegularBytes } from './notoSansFonts';

export interface EmbeddedFonts {
    regular: PDFFont;
    bold: PDFFont;
}

/**
 * Registers fontkit with the PDFDocument and embeds Noto Sans Regular and Bold.
 * Supports Unicode symbols (>=, <=, ->, Greek letters, curly quotes) without crashing.
 */
export async function embedPrintFonts(doc: PDFDocument): Promise<EmbeddedFonts> {
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(getNotoSansRegularBytes());
    const bold = await doc.embedFont(getNotoSansBoldBytes());
    return { regular, bold };
}
