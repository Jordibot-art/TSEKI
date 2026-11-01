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

export interface BoxRect {
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

export interface MarkerRect extends BoxRect {
    corner: 'TL' | 'TR' | 'BL' | 'BR';
}

export interface LayoutItem {
    questionNumber: number;
    subIndex?: number;            // for enumeration sub-boxes: e.g. 1, 2, 3
    type: 'letter' | 'tf' | 'text' | 'word_box';
    box: BoxRect;                 // exact physical coordinates on page (points)
    maxChars: number;
    expectedAnswer?: string;
}

export interface LayoutPage {
    pageNumber: number;
    markers: MarkerRect[];        // 4 corner registration squares
    qrPosition: BoxRect;
    items: LayoutItem[];
}

export interface LayoutJSON {
    quizId: string;
    version: 'A' | 'B' | 'C';
    pageSize: { width: number; height: number }; // in points
    pages: LayoutPage[];
    createdAt: string;
}

export interface AnswerVariant {
    questionNumber: number;
    accepted: string[];
    maxChars: number;
    type: QuestionType;
}

export interface FitResult {
    mode: 'ALL_IN_ONE' | 'SEPARATE';
    fontSize: number;
    lineHeight: number;
    pages: number;
    fitMessage: string;
}

export interface PrintPackage {
    pdfs: {
        studentPdf: Uint8Array;
        answerSheetPdf?: Uint8Array;   // in SEPARATE mode
        combinedStudentPdf?: Uint8Array; // in SEPARATE mode: single merged booklet + answer sheet PDF
        answerKeyPdf: Uint8Array;
    };
    layoutJson: LayoutJSON;
    mode: 'ALL_IN_ONE' | 'SEPARATE';
    fontSize: number;
    pages: number;
    fitMessage: string;
}

export { GeneratedAssessment, QuestionType, ScannableQuestion, AnswerKeyItem, BondPaperSize };
