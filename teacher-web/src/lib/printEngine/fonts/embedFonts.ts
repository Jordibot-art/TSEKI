import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';

export interface EmbeddedPrintFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export async function embedPrintFonts(doc: PDFDocument): Promise<EmbeddedPrintFonts> {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold };
}
