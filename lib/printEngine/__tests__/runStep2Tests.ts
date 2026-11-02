import './nodeIO';
// lib/printEngine/__tests__/runStep2Tests.ts

import { renderAllInOnePDF } from '../allInOneRenderer';
import { renderAnswerKeyPDF } from '../answerKeyRenderer';
import { renderAnswerSheetPDF } from '../answerSheetRenderer';
import { renderBookletPDF } from '../bookletRenderer';
import { generatePrintPackage } from '../index';
import { quiz10ItemMC, quiz40ItemMixed } from './fixtures/sampleQuizzes';

async function runStep2Tests() {
    console.log('=== Running Step 2: PDF Renderers & Package Tests ===\n');
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
        if (condition) {
            console.log(`  [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    }

    // ── Test 1: Booklet PDF ───────────────────────────────────────────────────
    const bookletBytes = await renderBookletPDF(quiz40ItemMixed);
    assert(bookletBytes instanceof Uint8Array, 'Booklet PDF returned as Uint8Array');
    assert(bookletBytes.length > 5000, `Booklet PDF has realistic binary size (${bookletBytes.length} bytes)`);
    const bookletHeader = String.fromCharCode(...bookletBytes.slice(0, 5));
    assert(bookletHeader === '%PDF-', 'Booklet PDF contains valid %PDF- magic header');

    // ── Test 2: Answer Sheet PDF & Layout Coordinates ─────────────────────────
    const answerSheetResult = await renderAnswerSheetPDF(quiz40ItemMixed.questions, { quizId: 'QZ-20261101-40', version: 'A' });
    assert(answerSheetResult.pdfBytes.length > 5000, `Answer Sheet PDF has realistic size (${answerSheetResult.pdfBytes.length} bytes)`);
    assert(answerSheetResult.pages.length === 1, 'Answer Sheet renders on 1 page');

    const page1 = answerSheetResult.pages[0];
    assert(page1.markers.length === 4, 'Answer Sheet has exactly 4 corner registration markers');
    const corners = page1.markers.map((m) => m.corner).sort().join(',');
    assert(corners === 'BL,BR,TL,TR', `All 4 corners represented: ${corners}`);

    // Assert top-measured coordinates for markers (y=0 at top)
    const tl = page1.markers.find((m) => m.corner === 'TL')!;
    const bl = page1.markers.find((m) => m.corner === 'BL')!;
    assert(tl.y === 18, `TL marker has top-measured y=18 (got ${tl.y})`);
    assert(bl.y === 792 - 18 - 14, `BL marker has top-measured y=760 (got ${bl.y})`);

    assert(page1.qr.width === 56 && page1.qr.height === 56, `QR rect captured with 56x56 size (got ${page1.qr.width}x${page1.qr.height})`);
    assert(page1.qr.content === 'QZ-20261101-40|A|SHEET|1/1', `QR content matches pipe-delimited spec (got ${page1.qr.content})`);

    // 12 MC + 8 TF + 5 WB + 5 FB + 6 ID + (3 + 4 + 4 + 4) Enum = 51 layout items
    assert(page1.items.length === 51, `All answer boxes captured in layout items (got ${page1.items.length}, expected 51)`);

    // Verify top-down ordering: Item 1 near top has smaller y than Item 40 near bottom
    const item1 = page1.items.find((i) => i.questionNumber === 1)!;
    const item40 = page1.items.find((i) => i.questionNumber === 40)!;
    assert(item1.rect.y < item40.rect.y, `Item 1 y (${item1.rect.y.toFixed(1)}) < Item 40 y (${item40.rect.y.toFixed(1)}) for top-down coordinates`);

    // Verify all box coordinates are within page bounds and away from corner markers
    let allBoxesValid = true;
    for (const item of page1.items) {
        const { x, y, width, height } = item.rect;
        if (x < 36 || x + width > 612 - 36 || y < 36 || y + height > 792 - 36) {
            allBoxesValid = false;
            console.error('Box out of bounds:', item);
            break;
        }
        // Verify no overlap with corner markers
        for (const m of page1.markers) {
            const overlap = !(x + width <= m.x || x >= m.x + m.width || y + height <= m.y || y >= m.y + m.height);
            if (overlap) {
                allBoxesValid = false;
                console.error('Box overlaps marker:', item, m);
                break;
            }
        }
    }
    assert(allBoxesValid, 'All answer boxes are within printable bounds and clear of corner markers');

    // ── Test 3: Single-Page ALL-IN-ONE PDF ─────────────────────────────────────
    const allInOneResult = await renderAllInOnePDF(quiz10ItemMC, {}, 10.5);
    assert(allInOneResult.pdfBytes.length > 3000, `ALL-IN-ONE PDF has realistic size (${allInOneResult.pdfBytes.length} bytes)`);
    assert(allInOneResult.pages.length === 1, 'ALL-IN-ONE renders on 1 page');
    assert(allInOneResult.pages[0].items.length === 10, 'ALL-IN-ONE captures 10 answer boxes');

    // ── Test 4: Answer Key PDF ────────────────────────────────────────────────
    const answerKeyBytes = await renderAnswerKeyPDF(quiz40ItemMixed);
    assert(answerKeyBytes.length > 4000, `Answer Key PDF has realistic size (${answerKeyBytes.length} bytes)`);

    // ── Test 5: Full Print Package Generation (ALL-IN-ONE) ────────────────────
    const pkg10 = await generatePrintPackage(quiz10ItemMC);
    assert(pkg10.mode === 'ALL_IN_ONE', '10-item quiz produces ALL_IN_ONE package');
    assert(pkg10.studentPdf.byteLength > 0, 'Student PDF exists in ALL-IN-ONE package');
    assert(pkg10.answerSheetPdf === undefined, 'No separate answer sheet in ALL-IN-ONE mode');
    assert(pkg10.answerKeyPdf.byteLength > 0, 'Answer key PDF exists in ALL-IN-ONE package');
    assert(pkg10.layoutJson.pages[0].items.length === 10, 'LayoutJSON matches 10 items');
    assert(pkg10.layoutJson.answerVariants.length === 10, 'LayoutJSON includes 10 answerVariants');

    // ── Test 6: Full Print Package Generation (SEPARATE) ──────────────────────
    const pkg40 = await generatePrintPackage(quiz40ItemMixed);
    assert(pkg40.mode === 'SEPARATE', '40-item mixed quiz produces SEPARATE package');
    assert(pkg40.studentPdf.byteLength > 0, 'Booklet student PDF exists');
    assert(Boolean(pkg40.answerSheetPdf && pkg40.answerSheetPdf.byteLength > 0), 'Answer sheet PDF exists in SEPARATE mode');
    assert(pkg40.answerKeyPdf.byteLength > 0, 'Answer key PDF exists');
    assert(pkg40.layoutJson.pages[0].items.length === 51, 'LayoutJSON has 51 boxes for 40 items');
    assert(pkg40.layoutJson.answerVariants.length === 40, 'LayoutJSON includes 40 answerVariants');

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
}

runStep2Tests().catch((err) => {
    console.error('Step 2 test execution failed:', err);
    process.exit(1);
});
