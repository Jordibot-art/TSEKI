export type BondPaperSize = 'short' | 'long';

export interface PageDimensions {
  width: number;
  height: number;
}

export const PAPER_DIMENSIONS: Record<BondPaperSize, PageDimensions> = {
  short: { width: 612, height: 792 },  // 8.5" x 11" (Letter)
  long: { width: 612, height: 936 },   // 8.5" x 13" (Philippine Long Bond / Folio)
};

export const MARGINS = {
  top: 36,
  bottom: 36,
  left: 36,
  right: 36,
};

export const CORNER_MARKER = {
  size: 14,       // 14x14 pt solid black square
  offset: 18,     // offset from page outer edges
};

export const QR_CODE_CONFIG = {
  size: 56,           // 56x56 pt (within 54-60 pt spec)
  MODULE_MIN_PT: 1.5, // minimum 1.5 pt per module to prevent print bleed
  errorCorrectionLevel: 'M' as const,
};

export const FONT_CONFIG = {
  DEFAULT_SIZE: 11.0,
  CANDIDATES: [11.0, 10.5, 10.0],
  MIN_SIZE_DEFAULT: 10.0,
  MIN_SIZE_PRIMARY: 10.5, // for Grade 1-3
  LINE_HEIGHT_FACTOR: 1.25,
  HEADER_TITLE_SIZE: 15.0,
  HEADER_SUBTITLE_SIZE: 9.0,
  SECTION_HEADER_SIZE: 10.0,
  INSTRUCTIONS_SIZE: 8.5,
  FOOTER_SIZE: 8.0,
};

export const ANSWER_BOX_CONFIG = {
  // Letter Grid (MC, TF, Word Box): 8 boxes per row
  letter: {
    width: 25,
    height: 27,
    numHeight: 9.5,
    inputHeight: 17.5,
    spacingX: 8,
    spacingY: 6,
    maxCols: 8,
  },
  // Text Box (Fill-in, Identification): 2 columns
  text: {
    width: 256,
    height: 22,
    numWidth: 26,
    spacingX: 16,
    spacingY: 6,
    maxCols: 2,
  },
  // Enumeration Box (Sub-items e.g. 37.1): 3 columns
  enumeration: {
    width: 168,
    height: 21,
    numWidth: 34,
    spacingX: 12,
    spacingY: 5,
    maxCols: 3,
  },
};

export const COLORS = {
  black: [0, 0, 0] as [number, number, number],
  darkGray: [0.2, 0.2, 0.2] as [number, number, number],
  lightGray: [0.93, 0.94, 0.96] as [number, number, number], // #edf0f5 / #f3f4f6
  borderGray: [0.75, 0.78, 0.82] as [number, number, number],
  white: [1, 1, 1] as [number, number, number],
};
