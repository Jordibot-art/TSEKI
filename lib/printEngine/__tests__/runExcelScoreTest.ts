import './nodeIO';
// lib/printEngine/__tests__/runExcelScoreTest.ts

import * as XLSX from 'xlsx';
import { generateExcelClasslistBase64, generateScoreExportBase64 } from '../../classListParserService';

function runExcelScoreTests() {
    console.log('=== Running Scores-Only Excel Export Tests ===\n');
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

    const students = [
        { id: 's1', studentId: '2026-0001', full_name: 'Doe, John' },
        { id: 's2', studentId: '2026-0002', full_name: 'Smith, Jane' },
        { id: 's3', studentId: '2026-0003', full_name: 'Reyes, Carlo' },
    ];

    const quizzes = [
        { id: 'q1', quizTitle: 'Quiz 1: Network Concepts', maxScore: 25 },
        { id: 'q2', quizTitle: 'Quiz 2: Server Architecture', maxScore: 20 },
    ];

    const results = [
        { studentId: 's1', studentName: 'Doe, John', quizTitle: 'Quiz 1: Network Concepts', totalScore: 20 },
        { studentId: 's1', studentName: 'Doe, John', quizTitle: 'Quiz 2: Server Architecture', totalScore: 10 },
        { studentId: 's2', studentName: 'Smith, Jane', quizTitle: 'Quiz 1: Network Concepts', totalScore: 24 },
        // Jane hasn't taken Quiz 2 yet; Carlo hasn't taken either
    ];

    const base64 = generateScoreExportBase64({
        classroomTitle: 'BSIT-4 Networking',
        subject: 'Networking',
        section: 'BSIT 4A',
        students,
        quizzes,
        results,
    });

    assert(Boolean(base64 && base64.length > 500), 'Generated base64 string is valid and non-empty');

    const workbook = XLSX.read(base64, { type: 'base64' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: undefined });

    // Row 0 is the header row
    const headerRow = rows[0];
    assert(headerRow[0] === '#', `Header col 0 is "#" (got ${headerRow[0]})`);
    assert(headerRow[1] === 'Student ID', `Header col 1 is "Student ID" (got ${headerRow[1]})`);
    assert(headerRow[2] === 'Student Name', `Header col 2 is "Student Name" (got ${headerRow[2]})`);
    assert(headerRow[3] === 'Quiz 1: Network Concepts (25 pts)', `Header col 3 has quiz 1 + max pts (got ${headerRow[3]})`);
    assert(headerRow[4] === 'Quiz 2: Server Architecture (20 pts)', `Header col 4 has quiz 2 + max pts (got ${headerRow[4]})`);
    assert(headerRow.length === 5, `Exactly 5 columns (3 student cols + 2 quiz cols), got ${headerRow.length}`);

    // Verify NO forbidden columns/words anywhere in headers or cells
    const fullSheetString = JSON.stringify(rows).toLowerCase();
    for (const forbidden of ['%', 'grade', 'average', 'status', 'passing', 'at-risk', 'remark', 'rank']) {
        assert(!fullSheetString.includes(forbidden), `Workbook does NOT contain forbidden term "${forbidden}"`);
    }

    // Verify exact row count: 1 header + 3 students = 4 rows (no summary/total/average rows)
    assert(rows.length === 4, `Workbook has exactly 4 rows (1 header + 3 students), got ${rows.length}`);

    // Verify numeric cell types ({ t: 'n', v: score }) and blank cells (undefined)
    const d2Cell = sheet['D2']; // John Quiz 1 = 20
    const e2Cell = sheet['E2']; // John Quiz 2 = 10
    const d3Cell = sheet['D3']; // Jane Quiz 1 = 24
    const e3Cell = sheet['E3']; // Jane Quiz 2 = blank (undefined)

    assert(d2Cell && d2Cell.t === 'n' && d2Cell.v === 20, `John Quiz 1 cell is numeric 20 (got ${JSON.stringify(d2Cell)})`);
    assert(e2Cell && e2Cell.t === 'n' && e2Cell.v === 10, `John Quiz 2 cell is numeric 10 (got ${JSON.stringify(e2Cell)})`);
    assert(d3Cell && d3Cell.t === 'n' && d3Cell.v === 24, `Jane Quiz 1 cell is numeric 24 (got ${JSON.stringify(d3Cell)})`);
    assert(e3Cell === undefined, `Jane Quiz 2 cell is blank/undefined (got ${JSON.stringify(e3Cell)})`);

    // Verify existing roster export generateExcelClasslistBase64 remains intact
    const rosterBase64 = generateExcelClasslistBase64({
        classroomTitle: 'BSIT-4 Networking',
        students: [{ full_name: 'Doe, John', email: 'john@example.com', average: 85, attendance: 100 }],
    });
    assert(Boolean(rosterBase64 && rosterBase64.length > 500), 'Existing generateExcelClasslistBase64 roster export remains unchanged and working');

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
}

runExcelScoreTests();
