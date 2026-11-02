// lib/printEngine/qrStamp.ts

import { PDFPage, rgb } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import { QR_CODE_CONFIG } from './constants';
import { topY } from './layoutJson';
import { QRRect } from './types';

export type QRDocType = 'SHEET' | 'BOOKLET' | 'ALL_IN_ONE' | 'KEY' | 'answer_sheet' | 'booklet' | 'all_in_one' | 'answer_key';

export interface QRStampPayload {
    q: string;                    // quiz ID
    v: 'A' | 'B' | 'C';          // version
    t: QRDocType;                 // document type
    p: number;                    // page number
    n: number;                    // total pages
}

function normalizeDocType(t: QRDocType): 'SHEET' | 'BOOKLET' | 'ALL_IN_ONE' | 'KEY' {
    switch (t) {
        case 'answer_sheet':
        case 'SHEET':
            return 'SHEET';
        case 'booklet':
        case 'BOOKLET':
            return 'BOOKLET';
        case 'all_in_one':
        case 'ALL_IN_ONE':
            return 'ALL_IN_ONE';
        case 'answer_key':
        case 'KEY':
            return 'KEY';
    }
}

/**
 * Formats the canonical QR payload string:
 * <quizId>|<version>|<docType>|<page>/<totalPages>
 * Example: QZ-20261101-40|A|SHEET|1/1
 */
export function formatQRContent(payload: QRStampPayload): string {
    const docType = normalizeDocType(payload.t);
    return `${payload.q}|${payload.v}|${docType}|${payload.p}/${payload.n}`;
}

/**
 * Generates and draws a vector QR code onto a PDF page using error correction 'M'.
 * Enforces minimum module size >= 1.5 pt and returns a QRRect with top-origin y coordinate.
 */
export function drawQRCode(
    page: PDFPage,
    payload: QRStampPayload,
    x: number,
    pdfBottomY: number,
    size: number = QR_CODE_CONFIG.size
): QRRect {
    const content = formatQRContent(payload);
    const qr = qrcode(0, QR_CODE_CONFIG.errorCorrectionLevel);
    qr.addData(content);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const minSizeForModules = moduleCount * QR_CODE_CONFIG.MODULE_MIN_PT;
    const effectiveSize = Math.max(size, minSizeForModules);
    const cellSize = effectiveSize / moduleCount;

    // Draw white background
    page.drawRectangle({
        x,
        y: pdfBottomY,
        width: effectiveSize,
        height: effectiveSize,
        color: rgb(1, 1, 1),
    });

    // Draw black QR modules (PDF coordinate system y starts from bottom)
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
                page.drawRectangle({
                    x: x + col * cellSize,
                    y: pdfBottomY + (moduleCount - 1 - row) * cellSize,
                    width: cellSize,
                    height: cellSize,
                    color: rgb(0, 0, 0),
                });
            }
        }
    }

    const pageHeight = page.getHeight();
    return {
        x,
        y: topY(pdfBottomY, effectiveSize, pageHeight),
        width: effectiveSize,
        height: effectiveSize,
        content,
    };
}
