import './nodeIO';
// lib/printEngine/__tests__/runExcelScoreTest.ts

import * as XLSX from 'xlsx';
import { generateExcelClasslistBase64, generateScoreExportBase64, generateExcelTemplateBase64 } from '../../classListParserService';

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

    // Verify roster export generateExcelClasslistBase64 has Last Name, First Name, Middle Name, and Quiz 1, Quiz 2 scores (no Average %)
    const rosterBase64 = generateExcelClasslistBase64({
        classroomTitle: 'BSIT-4 Networking',
        students: [
            { id: 's1', last_name: 'Doe', first_name: 'John', middle_name: 'M.', full_name: 'Doe, John M.', email: 'john@example.com', average: 85, attendance: 100 },
        ],
        quizzes,
        results,
    });
    assert(Boolean(rosterBase64 && rosterBase64.length > 500), 'Existing generateExcelClasslistBase64 roster export remains unchanged and working');
    const rosterWb = XLSX.read(rosterBase64, { type: 'base64' });
    const rosterSheet = rosterWb.Sheets[rosterWb.SheetNames[0]];
    const rosterRows: any[][] = XLSX.utils.sheet_to_json(rosterSheet, { header: 1, defval: undefined });
    const rosterHeader = rosterRows.find((r) => r && r[0] === 'Item') || [];
    assert(rosterHeader[1] === 'Last Name', 'Classlist col 1 is "Last Name"');
    assert(rosterHeader[2] === 'First Name', 'Classlist col 2 is "First Name"');
    assert(rosterHeader[3] === 'Middle Name', 'Classlist col 3 is "Middle Name"');
    assert(rosterHeader[4] === 'Email Address', 'Classlist col 4 is "Email Address"');
    assert(rosterHeader[5] === 'Quiz 1: Network Concepts (25 pts)', 'Classlist col 5 is Quiz 1');
    assert(rosterHeader[6] === 'Quiz 2: Server Architecture (20 pts)', 'Classlist col 6 is Quiz 2');
    assert(rosterHeader[7] === 'Average Scores', 'Classlist col 7 is "Average Scores"');

    // Verify row 7 has 85% average score
    const studentRow = rosterRows[7] || [];
    assert(studentRow[7] === '85%', `Student row has 85% average score (got ${studentRow[7]})`);

    // Verify BSIT-4 template generation
    const templateBase64 = generateExcelTemplateBase64({
        classroomTitle: 'BSIT-4',
        subject: 'SAM',
        section: 'SECTION 5',
    });
    assert(Boolean(templateBase64 && templateBase64.length > 500), 'Template base64 is generated');
    const templateWb = XLSX.read(templateBase64, { type: 'base64' });
    const templateSheet = templateWb.Sheets[templateWb.SheetNames[0]];
    const templateRows: any[][] = XLSX.utils.sheet_to_json(templateSheet, { header: 1 });
    const templateHeader = templateRows[6] || [];
    assert(templateHeader[0] === 'Item', 'Template col 0 is "Item"');
    assert(templateHeader[1] === 'Last Name', 'Template col 1 is "Last Name"');
    assert(templateHeader[2] === 'First Name', 'Template col 2 is "First Name"');
    assert(templateHeader[3] === 'Middle Name', 'Template col 3 is "Middle Name"');
    assert(templateHeader[4] === 'Email Address', 'Template col 4 is "Email Address"');
    assert(templateRows.length >= 10, 'Template contains sample student rows');

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
}

runExcelScoreTests();
