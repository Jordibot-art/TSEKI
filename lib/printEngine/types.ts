// lib/printEngine/types.ts

import { BondPaperSize } from './constants';
import { GeneratedAssessment, QuestionType, ScannableQuestion, AnswerKeyItem } from '../quizGeneratorService';

export type PrintMode = 'ALL_IN_ONE' | 'SEPARATE' | 'AUTO';
export type PrintTarget = 'ALL' | 'STUDENT_ONLY' | 'ANSWER_KEY_ONLY' | 'LAYOUT_ONLY';

export interface PrintOptions {
    mode?: PrintMode;             // default 'AUTO'
    target?: PrintTarget;         // default 'ALL' - controls which PDFs are compiled
    skipPdfSave?: boolean;        // if true, skips doc.save() compression when only layout coordinates are needed
    paperSize?: BondPaperSize;    // default 'short'
    version?: 'A' | 'B' | 'C';    // default 'A'
    forceSeparate?: boolean;      // overrides fit decision to separate
    gradeLevel?: string;          // controls minimum font size
    quizId?: string;
    classTitle?: string;
    subject?: string;
}

export interface Rect {
    x: number;
    /**
     * Vertical coordinate in points measured from the TOP edge of the page (y = 0 at top, increasing downward).
     * Note: Standard PDF coordinates measure from the bottom, but LayoutJSON standardizes on top-relative y
     * to match standard computer vision / camera image coordinate systems.
     */
    y: number;
    width: number;
    height: number;
}

export type BoxRect = Rect;

export interface MarkerRect extends Rect {
    corner: 'TL' | 'TR' | 'BL' | 'BR';
}

export interface QRRect extends Rect {
    content: string;
}

export interface LayoutItem {
    questionNumber: number;
    subIndex?: number;            // for enumeration sub-boxes: e.g. 1, 2, 3, 4
    type: 'letter' | 'tf' | 'word_box' | 'text';
    rect: Rect;                   // exact physical coordinates on page (points)
    maxChars: number;
    expectedAnswer?: string;
}

export interface LayoutPage {
    pageNumber: number;
    markers: MarkerRect[];        // 4 corner registration squares
    qr: QRRect;
    items: LayoutItem[];
}

export interface AnswerVariant {
    questionNumber: number;
    accepted: string[];
    maxChars: number;
    type: QuestionType;
}

export interface LayoutJSON {
    quizId: string;
    version: 'A' | 'B' | 'C';
    pageSize: { width: number; height: number }; // in points
    pages: LayoutPage[];
    answerVariants: AnswerVariant[];
    createdAt: string;
}

export interface FitResult {
    mode: 'ALL_IN_ONE' | 'SEPARATE';
    fontSize: number;
    lineHeight: number;
    pages: number;
    fitMessage: string;
}

export interface PrintPackage {
    studentPdf: Uint8Array;          // Booklet in SEPARATE mode, or single-page in ALL_IN_ONE mode
    answerSheetPdf?: Uint8Array;     // Only present in SEPARATE mode
    combinedStudentPdf?: Uint8Array; // In SEPARATE mode: single merged booklet + answer sheet PDF
    answerKeyPdf: Uint8Array;        // Teacher's Answer Key
    layoutJson: LayoutJSON;          // Coordinate map + answer variants for the grader
    mode: 'ALL_IN_ONE' | 'SEPARATE';
    fontSize: number;
    pages: number;
    fitMessage: string;
}

export { GeneratedAssessment, QuestionType, ScannableQuestion, AnswerKeyItem, BondPaperSize };
