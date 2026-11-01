// lib/printEngine/__tests__/runExcelScoreTest.ts

import * as XLSX from 'xlsx';
import { generateExcelClasslistBase64 } from '../../scoreExportService';

function runExcelScoreTests() {
    console.log('=== Running Excel Score Export Tests ===\n');
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
        { id: 's1', full_name: 'John Doe', email: 'john@example.com' },
        { id: 's2', full_name: 'Jane Smith', email: 'jane@example.com' },
    ];

    const quizzes = [
        { id: 'q1', quizTitle: 'Quiz 1: Network Concepts', maxScore: 25 },
        { id: 'q2', quizTitle: 'Quiz 2: Server Architecture', maxScore: 20 },
    ];

    const quizResults = [
        { studentId: 's1', studentName: 'John Doe', quizTitle: 'Quiz 1: Network Concepts', totalScore: 20, maxScore: 25 },
        { studentId: 's1', studentName: 'John Doe', quizTitle: 'Quiz 2: Server Architecture', totalScore: 10, maxScore: 20 },
        { studentId: 's2', studentName: 'Jane Smith', quizTitle: 'Quiz 1: Network Concepts', totalScore: 24, maxScore: 25 },
        // Jane hasn't taken Quiz 2 yet
    ];

    const base64 = generateExcelClasslistBase64({
        classroomTitle: 'BSIT-4 Networking',
        subject: 'Networking',
        students,
        quizzes,
        quizResults,
    });

    assert(Boolean(base64 && base64.length > 500), 'Generated base64 string is valid and non-empty');

    // Parse the generated workbook back using SheetJS to verify structure
    const workbook = XLSX.read(base64, { type: 'base64' });
    const sheetName = workbook.SheetNames[0];
    assert(sheetName === 'Assessment Scores', `Sheet name is "Assessment Scores" (got ${sheetName})`);

    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Row 6 (0-indexed) is the table header
    const headerRow = rows[6];
    assert(headerRow[0] === 'Item', 'Header column 0 is Item');
    assert(headerRow[1] === "Student's Name", "Header column 1 is Student's Name");
    assert(headerRow[2] === 'Quiz 1: Network Concepts', 'Header column 2 is Quiz 1');
    assert(headerRow[3] === 'Quiz 2: Server Architecture', 'Header column 3 is Quiz 2');
    assert(headerRow[4] === 'Total Score', 'Header column 4 is Total Score');

    // Verify NO grades, percentages, or status columns
    const allHeaders = headerRow.join(' ').toLowerCase();
    assert(!allHeaders.includes('grade'), 'Headers do NOT contain "grade"');
    assert(!allHeaders.includes('average'), 'Headers do NOT contain "average"');
    assert(!allHeaders.includes('status'), 'Headers do NOT contain "status"');
    assert(!allHeaders.includes('passing'), 'Headers do NOT contain "passing"');

    // Row 7: John Doe
    const johnRow = rows[7];
    assert(johnRow[1] === 'John Doe', 'Student 1 is John Doe');
    assert(johnRow[2] === 20, `John Quiz 1 score is 20 (got ${johnRow[2]})`);
    assert(johnRow[3] === 10, `John Quiz 2 score is 10 (got ${johnRow[3]})`);
    assert(johnRow[4] === 30, `John Total Score is 30 (got ${johnRow[4]})`);

    // Row 8: Jane Smith
    const janeRow = rows[8];
    assert(janeRow[1] === 'Jane Smith', 'Student 2 is Jane Smith');
    assert(janeRow[2] === 24, `Jane Quiz 1 score is 24 (got ${janeRow[2]})`);
    assert(janeRow[3] === '-', `Jane Quiz 2 score is "-" for unattempted quiz (got ${janeRow[3]})`);
    assert(janeRow[4] === 24, `Jane Total Score is 24 (got ${janeRow[4]})`);

    console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exit(1);
}

runExcelScoreTests();
