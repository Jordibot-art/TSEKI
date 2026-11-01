// lib/printEngine/markers.ts

import { PDFPage, rgb } from 'pdf-lib';
import { CORNER_MARKER } from './constants';
import { MarkerRect } from './types';

/**
 * Draws 4 solid black corner registration squares for OCR / optical alignment.
 * Returns the exact bounding rectangles of all 4 markers in PDF points.
 */
export function drawCornerMarkers(
    page: PDFPage,
    pageWidth: number,
    pageHeight: number
): MarkerRect[] {
    const size = CORNER_MARKER.size;
    const offset = CORNER_MARKER.offset;

    const markers: MarkerRect[] = [
        {
            corner: 'TL',
            x: offset,
            y: pageHeight - offset - size,
            width: size,
            height: size,
        },
        {
            corner: 'TR',
            x: pageWidth - offset - size,
            y: pageHeight - offset - size,
            width: size,
            height: size,
        },
        {
            corner: 'BL',
            x: offset,
            y: offset,
            width: size,
            height: size,
        },
        {
            corner: 'BR',
            x: pageWidth - offset - size,
            y: offset,
            width: size,
            height: size,
        },
    ];

    for (const m of markers) {
        page.drawRectangle({
            x: m.x,
            y: m.y,
            width: m.width,
            height: m.height,
            color: rgb(0, 0, 0),
        });
    }

    return markers;
}
