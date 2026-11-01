import * as fs from 'fs';
import * as path from 'path';
import { renderAnswerKeyPDF } from '../lib/printEngine/answerKeyRenderer';
import { renderAnswerSheetPDF } from '../lib/printEngine/answerSheetRenderer';
import { renderBookletPDF } from '../lib/printEngine/bookletRenderer';
import { quiz40ItemMixed } from '../lib/printEngine/__tests__/fixtures/sampleQuizzes';

async function main() {
    console.log('Re-rendering sample PDFs with embedded Noto Sans font...');
    const docsDir = path.join(__dirname, '../docs');

    // 1. Booklet PDF
    const bookletBytes = await renderBookletPDF(quiz40ItemMixed, { paperSize: 'short', version: 'A' });
    fs.writeFileSync(path.join(docsDir, 'Tseki_40Item_Question_Booklet.pdf'), Buffer.from(bookletBytes));
    console.log(`Rendered Tseki_40Item_Question_Booklet.pdf (${bookletBytes.length} bytes)`);

    // 2. Answer Sheet PDF
    const sheetResult = await renderAnswerSheetPDF(quiz40ItemMixed.questions, { paperSize: 'short', version: 'A' });
    fs.writeFileSync(path.join(docsDir, 'Tseki_40Item_Answer_Sheet.pdf'), Buffer.from(sheetResult.pdfBytes));
    console.log(`Rendered Tseki_40Item_Answer_Sheet.pdf (${sheetResult.pdfBytes.length} bytes)`);

    // 3. Answer Key PDF
    const keyBytes = await renderAnswerKeyPDF(quiz40ItemMixed, { paperSize: 'short', version: 'A' });
    fs.writeFileSync(path.join(docsDir, 'Tseki_40Item_Answer_Key.pdf'), Buffer.from(keyBytes));
    console.log(`Rendered Tseki_40Item_Answer_Key.pdf (${keyBytes.length} bytes)`);

    console.log('All sample PDFs successfully updated!');
}

main().catch((err) => {
    console.error('Error rendering sample PDFs:', err);
    process.exit(1);
});
