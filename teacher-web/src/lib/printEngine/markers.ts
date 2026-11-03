// teacher-web/src/lib/printEngine/markers.ts

import { PDFPage, rgb } from 'pdf-lib';
import { CORNER_MARKER } from './constants';
import type { MarkerRect } from './types';

/**
 * Draws 4 solid black corner registration squares for OCR / optical alignment.
 * Draws on PDFPage using bottom-relative PDF coordinates, but returns
 * MarkerRect[] with y measured from the TOP of the page (y = 0 at top edge).
 */
export function drawCornerMarkers(
    page: PDFPage,
    pageWidth: number,
    pageHeight: number
): MarkerRect[] {
    const size = CORNER_MARKER.size;
    const offset = CORNER_MARKER.offset;

    // Draw on PDF page using native PDF coordinates (y = 0 at bottom)
    const pdfPositions = [
        { x: offset, y: pageHeight - offset - size },                          // Top-Left
        { x: pageWidth - offset - size, y: pageHeight - offset - size },        // Top-Right
        { x: offset, y: offset },                                               // Bottom-Left
        { x: pageWidth - offset - size, y: offset },                            // Bottom-Right
    ];

    for (const pos of pdfPositions) {
        page.drawRectangle({
            x: pos.x,
            y: pos.y,
            width: size,
            height: size,
            color: rgb(0, 0, 0),
        });
    }

    // Return markers with y measured from the TOP edge of the page (y = 0 at top)
    const markers: MarkerRect[] = [
        {
            corner: 'TL',
            x: offset,
            y: offset,
            width: size,
            height: size,
        },
        {
            corner: 'TR',
            x: pageWidth - offset - size,
            y: offset,
            width: size,
            height: size,
        },
        {
            corner: 'BL',
            x: offset,
            y: pageHeight - offset - size,
            width: size,
            height: size,
        },
        {
            corner: 'BR',
            x: pageWidth - offset - size,
            y: pageHeight - offset - size,
            width: size,
            height: size,
        },
    ];

    return markers;
}
