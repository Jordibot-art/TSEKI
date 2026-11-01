// lib/printEngine/qrStamp.ts

import { PDFPage, rgb } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import { QR_CODE_CONFIG } from './constants';
import { BoxRect } from './types';

export interface QRStampPayload {
    q: string;                    // quiz ID
    v: 'A' | 'B' | 'C';          // version
    t: 'answer_sheet' | 'booklet' | 'all_in_one' | 'answer_key'; // document type
    p: number;                    // page number
    n: number;                    // total pages
}

/**
 * Generates and draws a vector QR code onto a PDF page.
 * Returns the exact bounding rectangle of the QR code in points.
 */
export function drawQRCode(
    page: PDFPage,
    payload: QRStampPayload,
    x: number,
    y: number,
    size: number = QR_CODE_CONFIG.size
): BoxRect {
    const rawData = JSON.stringify(payload);
    const qr = qrcode(0, 'M');
    qr.addData(rawData);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = size / moduleCount;

    // Draw white background
    page.drawRectangle({
        x,
        y,
        width: size,
        height: size,
        color: rgb(1, 1, 1),
    });

    // Draw black QR modules
    // Note: PDF coordinate system y starts from bottom!
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
                page.drawRectangle({
                    x: x + col * cellSize,
                    y: y + (moduleCount - 1 - row) * cellSize,
                    width: cellSize,
                    height: cellSize,
                    color: rgb(0, 0, 0),
                });
            }
        }
    }

    return { x, y, width: size, height: size };
}
