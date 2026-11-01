// lib/scoreExportService.ts

import * as XLSX from "xlsx";

export interface ExportClasslistOptions {
  classroomTitle: string;
  subject?: string;
  section?: string;
  room?: string;
  schedule?: string;
  teacher?: string;
  students: Array<{
    id?: string;
    full_name: string;
    email?: string | null;
    average?: number;
    attendance?: number;
  }>;
  quizzes?: Array<{
    id?: string;
    quizTitle: string;
    maxScore?: number;
  }>;
  quizResults?: Array<{
    studentId?: string;
    studentName?: string;
    quizTitle: string;
    totalScore: number;
    maxScore?: number;
  }>;
}

/**
 * Generates an Excel workbook (.xlsx) from classroom metadata, student roster,
 * and individual quiz assessment scores.
 * Only outputs raw scores per quiz (no percentage grades or status), e.g. Quiz 1: 20, Quiz 2: 10.
 */
export function generateExcelClasslistBase64(options: ExportClasslistOptions): string {
  const { classroomTitle, subject, section, room, schedule, teacher, students, quizzes = [], quizResults = [] } = options;

  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Extract distinct quiz titles
  const quizTitleSet = new Set<string>();
  for (const q of quizzes) {
    if (q.quizTitle) quizTitleSet.add(q.quizTitle.trim());
  }
  for (const r of quizResults) {
    if (r.quizTitle) quizTitleSet.add(r.quizTitle.trim());
  }
  const quizTitles = Array.from(quizTitleSet);

  // Build header row with quiz score columns
  const tableHeader = ["Item", "Student's Name"];
  if (quizTitles.length > 0) {
    for (const qt of quizTitles) {
      tableHeader.push(qt);
    }
    tableHeader.push("Total Score");
  } else {
    tableHeader.push("Score");
  }

  // Build rows array for SheetJS
  const rows: any[][] = [
    ["TSEKI - CLASS ASSESSMENT SCORES RECORD"],
    ["Classroom:", classroomTitle, "", "Subject:", subject || "N/A"],
    ["Section:", section || "N/A", "", "Room:", room || "N/A"],
    ["Schedule:", schedule || "N/A", "", "Teacher:", teacher || "N/A"],
    ["Export Date:", formattedDate, "", "Total Enrolled:", students.length],
    [], // Blank separator row
    tableHeader,
  ];

  // Map quiz results for fast lookup by (studentId:quizTitle) and (studentName:quizTitle)
  const scoreMap = new Map<string, number>();
  for (const res of quizResults) {
    const qTitle = res.quizTitle ? res.quizTitle.trim() : "";
    if (res.studentId) {
      scoreMap.set(`${res.studentId}:::${qTitle}`, res.totalScore);
    }
    if (res.studentName) {
      scoreMap.set(`${res.studentName.trim().toLowerCase()}:::${qTitle}`, res.totalScore);
    }
  }

  // Populate student records with quiz scores only (no percentage grades or status)
  students.forEach((s, idx) => {
    const studentRow: any[] = [idx + 1, s.full_name];

    if (quizTitles.length > 0) {
      let studentTotal = 0;
      let hasAnyScore = false;

      for (const qt of quizTitles) {
        let score: number | undefined;
        if (s.id && scoreMap.has(`${s.id}:::${qt}`)) {
          score = scoreMap.get(`${s.id}:::${qt}`);
        } else if (scoreMap.has(`${s.full_name.trim().toLowerCase()}:::${qt}`)) {
          score = scoreMap.get(`${s.full_name.trim().toLowerCase()}:::${qt}`);
        }

        if (score !== undefined) {
          studentRow.push(score);
          studentTotal += score;
          hasAnyScore = true;
        } else {
          studentRow.push("-");
        }
      }

      studentRow.push(hasAnyScore ? studentTotal : "-");
    } else {
      studentRow.push("-");
    }

    rows.push(studentRow);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  const colWidths = [
    { wch: 8 },  // Item
    { wch: 34 }, // Student's Name
  ];
  if (quizTitles.length > 0) {
    for (const qt of quizTitles) {
      colWidths.push({ wch: Math.max(16, qt.length + 4) });
    }
    colWidths.push({ wch: 14 }); // Total Score
  } else {
    colWidths.push({ wch: 16 });
  }
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Assessment Scores");

  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}
