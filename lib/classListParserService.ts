import * as XLSX from "xlsx";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedClasslistMetadata {
  institution?: string;
  academicYear?: string;
  semester?: string;
  edpCode?: string;
  subjectCode?: string;
  subjectName?: string;
  schedule?: string;
  room?: string;
  teacher?: string;
}

export interface ParsedStudentRow {
  studentId?: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  fullName: string;
  gender?: string;
  course?: string;
  yearLevel?: string;
  contactNo?: string;
  email?: string | null;
  selected: boolean;
}

export interface ParsedClasslistResult {
  metadata: ParsedClasslistMetadata;
  students: ParsedStudentRow[];
  totalDetected: number;
}

// ── Name Formatting & Splitting Helpers ─────────────────────────────────────

/**
 * Splits a combined full name string into { last_name, first_name, middle_name }.
 * Handles both "Lastname, Firstname [Middlename]" and "Firstname [Middlename] Lastname".
 */
export function splitStudentFullName(rawName: string): {
  last_name: string;
  first_name: string;
  middle_name: string | null;
} {
  const cleaned = (rawName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { last_name: "", first_name: "", middle_name: null };
  }

  if (cleaned.includes(",")) {
    const [lastPart, ...restParts] = cleaned.split(",");
    const last_name = lastPart.trim();
    const afterComma = restParts.join(",").trim();
    const tokens = afterComma.split(" ").filter(Boolean);
    if (tokens.length === 0) {
      return { last_name, first_name: "", middle_name: null };
    }
    if (tokens.length === 1) {
      return { last_name, first_name: tokens[0], middle_name: null };
    }
    const middle_name = tokens[tokens.length - 1];
    const first_name = tokens.slice(0, -1).join(" ");
    return { last_name, first_name, middle_name: middle_name || null };
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 1) {
    return { last_name: tokens[0], first_name: "", middle_name: null };
  }
  if (tokens.length === 2) {
    return { last_name: tokens[1], first_name: tokens[0], middle_name: null };
  }

  // Check for compound Filipino/Spanish surnames like "Dela Cruz", "De Guzman", "De Los Reyes", "San Jose"
  const compoundPrefixes = new Set(["dela", "de", "del", "delos", "san", "sta", "sta.", "st", "st."]);
  let lastStartIdx = tokens.length - 1;
  if (
    lastStartIdx >= 2 &&
    compoundPrefixes.has(tokens[lastStartIdx - 1].toLowerCase())
  ) {
    lastStartIdx -= 1;
    if (
      lastStartIdx >= 2 &&
      tokens[lastStartIdx - 1].toLowerCase() === "de" &&
      (tokens[lastStartIdx].toLowerCase() === "la" || tokens[lastStartIdx].toLowerCase() === "los" || tokens[lastStartIdx].toLowerCase() === "las")
    ) {
      lastStartIdx -= 1;
    }
  }

  const last_name = tokens.slice(lastStartIdx).join(" ");
  const beforeLast = tokens.slice(0, lastStartIdx);
  if (beforeLast.length === 1) {
    return { last_name, first_name: beforeLast[0], middle_name: null };
  }
  const first_name = beforeLast[0];
  const middle_name = beforeLast.slice(1).join(" ");
  return { last_name, first_name, middle_name: middle_name || null };
}

/**
 * Formats { last_name, first_name, middle_name } into "Last Name, First Name Middle Name".
 */
export function formatStudentFullName(student: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  full_name?: string | null;
}): string {
  const last = (student.last_name || "").trim();
  const first = (student.first_name || "").trim();
  const middle = (student.middle_name || "").trim();

  if (last && first) {
    return `${last}, ${first}${middle ? ` ${middle}` : ""}`;
  }
  if (last) {
    return `${last}${middle ? ` ${middle}` : ""}`;
  }
  if (first) {
    return `${first}${middle ? ` ${middle}` : ""}`;
  }
  return (student.full_name || "").trim();
}

/**
 * Normalizes a database student row so that last_name, first_name, middle_name, and full_name
 * are always populated consistently.
 */
export function normalizeStudentRecord<T extends Record<string, any>>(
  row: T
): T & {
  last_name: string;
  first_name: string;
  middle_name: string | null;
  full_name: string;
} {
  const hasSplit = Boolean(
    (row.last_name && String(row.last_name).trim()) ||
      (row.first_name && String(row.first_name).trim())
  );
  const split = hasSplit
    ? {
        last_name: String(row.last_name || "").trim(),
        first_name: String(row.first_name || "").trim(),
        middle_name: row.middle_name ? String(row.middle_name).trim() || null : null,
      }
    : splitStudentFullName(String(row.full_name || ""));

  const full_name = formatStudentFullName({
    ...split,
    full_name: row.full_name,
  });

  return {
    ...row,
    last_name: split.last_name,
    first_name: split.first_name,
    middle_name: split.middle_name,
    full_name,
  };
}

/**
 * Converts an all-caps string to Smart Title Case.
 * e.g. "AYAP, RAMEL JR. M." → "Ayap, Ramel Jr. M."
 */
function toSmartTitleCase(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/(?:^|[\s,.\-/()])[a-z]/g, (match) => match.toUpperCase())
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, (match) => match.toUpperCase());
}

/**
 * Normalizes "N/A", empty, or whitespace-only values to null.
 */
function cleanNullable(value: any): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str || str.toUpperCase() === "N/A" || str === "-" || str === "—" || str === "NONE") {
    return null;
  }
  return str;
}

/**
 * Attempts to detect a cell's value as string from various possible formats.
 */
function cellToString(cell: any): string {
  if (cell === undefined || cell === null) return "";
  return String(cell).trim();
}

// ── Metadata Extraction ─────────────────────────────────────────────────────

/** Known metadata label patterns and their target field  mapping */
const METADATA_PATTERNS: Array<{
  pattern: RegExp;
  field: keyof ParsedClasslistMetadata;
}> = [
    { pattern: /edp\s*code/i, field: "edpCode" },
    { pattern: /subject\s*code/i, field: "subjectCode" },
    { pattern: /subject\s*name|descriptive\s*title/i, field: "subjectName" },
    { pattern: /schedule/i, field: "schedule" },
    { pattern: /room\s*(?:no\.?|number)?/i, field: "room" },
    { pattern: /teacher|instructor|faculty/i, field: "teacher" },
  ];

/**
 * Scans the header area (top ~20 rows) for key-value metadata pairs.
 * Also detects institution name, academic year, and semester from free text.
 */
function extractMetadata(
  rows: any[][],
  headerRowIndex: number
): ParsedClasslistMetadata {
  const meta: ParsedClasslistMetadata = {};
  const scanLimit = Math.min(headerRowIndex, 20);

  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r];
    if (!row) continue;

    // Concatenate all cell values for full-row text scanning
    const fullRowText = row.map((c) => cellToString(c)).join(" ");

    // Detect institution (usually the first non-empty row, all caps, contains "college" or "university")
    if (
      !meta.institution &&
      /\b(college|university|institute|school|academy)\b/i.test(fullRowText)
    ) {
      meta.institution = fullRowText.trim();
    }

    // Detect academic year + semester from "CLASS LIST FOR THE ACADEMIC YEAR: XXXX-XXXX, SEMESTER: X"
    const ayMatch = fullRowText.match(
      /academic\s*year[:\s]*(\d{4}[\s\-–]+\d{4})/i
    );
    if (ayMatch) {
      meta.academicYear = ayMatch[1].replace(/\s+/g, "").replace("–", "-");
    }
    const semMatch = fullRowText.match(/semester[:\s]*(\d+|first|second|third)/i);
    if (semMatch) {
      meta.semester = semMatch[1];
    }

    // Scan individual cells for label-value pairs (e.g. "EDP Code:" in one cell, value in next)
    for (let c = 0; c < row.length - 1; c++) {
      const label = cellToString(row[c]);
      const value = cellToString(row[c + 1]);

      for (const mp of METADATA_PATTERNS) {
        if (mp.pattern.test(label) && value && !meta[mp.field]) {
          meta[mp.field] = value;
          break;
        }
      }
    }

    // Also check "Label: Value" format within a single cell
    for (let c = 0; c < row.length; c++) {
      const text = cellToString(row[c]);
      if (!text.includes(":")) continue;

      const [rawLabel, ...rest] = text.split(":");
      const val = rest.join(":").trim();
      if (!val) continue;

      for (const mp of METADATA_PATTERNS) {
        if (mp.pattern.test(rawLabel) && !meta[mp.field]) {
          meta[mp.field] = val;
          break;
        }
      }
    }
  }

  return meta;
}

// ── Student Table Detection ─────────────────────────────────────────────────

/** Keywords that indicate a student roster table header row */
const HEADER_KEYWORDS = [
  "student id",
  "student's name",
  "student name",
  "last name",
  "first name",
  "middle name",
  "surname",
  "name",
  "gender",
  "course",
  "year level",
  "contact",
  "email",
  "item",
  "no.",
];

/**
 * Finds the row index that best matches the student table header.
 * Returns -1 if not found.
 */
function findHeaderRow(rows: any[][]): number {
  let bestIdx = -1;
  let bestScore = 0;

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;

    const cellTexts = row.map((c) => cellToString(c).toLowerCase());
    let score = 0;

    for (const kw of HEADER_KEYWORDS) {
      if (cellTexts.some((t) => t.includes(kw))) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  // Require at least 2 header keyword matches
  return bestScore >= 2 ? bestIdx : -1;
}

/**
 * Maps detected header labels to their column indices.
 */
function mapHeaderColumns(headerRow: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let c = 0; c < headerRow.length; c++) {
    const text = cellToString(headerRow[c]).toLowerCase();
    if (text.includes("student id") || text === "id") {
      map["studentId"] = c;
    } else if (text.includes("last name") || text === "lastname" || text.includes("surname") || text === "family name") {
      map["lastName"] = c;
    } else if (text.includes("first name") || text === "firstname" || text.includes("given name")) {
      map["firstName"] = c;
    } else if (text.includes("middle name") || text === "middlename" || text.includes("middle initial") || text === "m.i." || text === "mi") {
      map["middleName"] = c;
    } else if (
      text.includes("student's name") ||
      text.includes("student name") ||
      text === "full name" ||
      text === "name"
    ) {
      map["fullName"] = c;
    } else if (text.includes("gender") || text === "sex") {
      map["gender"] = c;
    } else if (text.includes("course") || text.includes("program") || text.includes("degree")) {
      map["course"] = c;
    } else if (text.includes("year") || text.includes("yr") || text.includes("level")) {
      map["yearLevel"] = c;
    } else if (text.includes("contact") || text.includes("phone") || text.includes("mobile")) {
      map["contactNo"] = c;
    } else if (text.includes("email") || text.includes("e-mail")) {
      map["email"] = c;
    } else if (text.includes("item") || text === "no." || text === "#") {
      map["item"] = c;
    }
  }
  return map;
}

// ── Core Parse Function ─────────────────────────────────────────────────────

/**
 * Parses a classlist file (xlsx, xls, or csv) from a local file URI.
 * Returns parsed metadata, student roster, and total count.
 */
export async function parseClasslistFile(
  fileUri: string,
  fileName: string
): Promise<ParsedClasslistResult> {
  // Read file as base64
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Parse workbook
  const workbook = XLSX.read(base64, { type: "base64" });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The uploaded file contains no worksheets.");
  }

  const sheet = workbook.Sheets[sheetName];

  // Convert sheet to 2D array (preserves all cells including merged regions)
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length < 2) {
    throw new Error("The spreadsheet appears empty or has insufficient data.");
  }

  // 1. Find the header row
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    throw new Error(
      "Could not detect a student roster table in this spreadsheet. Expected columns like 'Last Name', 'First Name', or 'Student's Name'."
    );
  }

  // 2. Extract metadata from rows above the header
  const metadata = extractMetadata(rows, headerIdx);

  // 3. Map header columns
  const colMap = mapHeaderColumns(rows[headerIdx]);

  // 4. Parse student rows (everything after the header)
  const rawStudents: ParsedStudentRow[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    let lastName = "";
    let firstName = "";
    let middleName: string | null = null;
    let formattedName = "";

    if (colMap["lastName"] !== undefined || colMap["firstName"] !== undefined) {
      const rawLast = colMap["lastName"] !== undefined ? cellToString(row[colMap["lastName"]]) : "";
      const rawFirst = colMap["firstName"] !== undefined ? cellToString(row[colMap["firstName"]]) : "";
      const rawMid = colMap["middleName"] !== undefined ? cleanNullable(row[colMap["middleName"]]) : null;

      if (!rawLast && !rawFirst) continue;
      if (/^(total|subtotal|count|summary)/i.test(rawLast || rawFirst)) continue;

      lastName = toSmartTitleCase(rawLast);
      firstName = toSmartTitleCase(rawFirst);
      middleName = rawMid ? toSmartTitleCase(rawMid) : null;
      formattedName = formatStudentFullName({
        last_name: lastName,
        first_name: firstName,
        middle_name: middleName,
      });
    } else {
      const nameIdx = colMap["fullName"];
      if (nameIdx === undefined) continue;

      const rawName = cellToString(row[nameIdx]);
      if (!rawName || rawName.length < 2) continue;

      // Skip summary/total rows
      if (/^(total|subtotal|count|summary)/i.test(rawName)) continue;

      formattedName = toSmartTitleCase(rawName);
      const split = splitStudentFullName(formattedName);
      lastName = split.last_name;
      firstName = split.first_name;
      middleName = split.middle_name;
      formattedName = formatStudentFullName(split) || formattedName;
    }

    const studentId = colMap["studentId"] !== undefined
      ? cleanNullable(row[colMap["studentId"]])
      : undefined;

    const gender = colMap["gender"] !== undefined
      ? cleanNullable(row[colMap["gender"]])
      : undefined;

    const course = colMap["course"] !== undefined
      ? cleanNullable(row[colMap["course"]])
      : undefined;

    const yearLevel = colMap["yearLevel"] !== undefined
      ? cleanNullable(row[colMap["yearLevel"]])
      : undefined;

    const contactNo = colMap["contactNo"] !== undefined
      ? cleanNullable(row[colMap["contactNo"]])
      : undefined;

    const email = colMap["email"] !== undefined
      ? cleanNullable(row[colMap["email"]])
      : null;

    rawStudents.push({
      studentId: studentId ?? undefined,
      lastName,
      firstName,
      middleName,
      fullName: formattedName,
      gender: gender ?? undefined,
      course: course ?? undefined,
      yearLevel: yearLevel ?? undefined,
      contactNo: contactNo ?? undefined,
      email,
      selected: true,
    });
  }

  // 5. Sort students alphabetically by surname
  const sortedStudents = rawStudents.sort((a, b) =>
    (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName, "en", { sensitivity: "base" })
  );

  return {
    metadata,
    students: sortedStudents,
    totalDetected: sortedStudents.length,
  };
}

/**
 * Derives a default section string from common course + year level fields.
 * e.g. course="BSIT", yearLevel="1ST" → "BSIT 1ST"
 */
export function deriveSection(students: ParsedStudentRow[]): string {
  if (students.length === 0) return "";

  // Find the most common course + yearLevel combination
  const comboCounts: Record<string, number> = {};
  for (const s of students) {
    if (s.course || s.yearLevel) {
      const key = [s.course || "", s.yearLevel || ""].filter(Boolean).join(" ");
      comboCounts[key] = (comboCounts[key] || 0) + 1;
    }
  }

  const entries = Object.entries(comboCounts);
  if (entries.length === 0) return "";

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0].toUpperCase();
}

/**
 * Checks if a student already exists in the roster by matching name or email.
 */
export function isDuplicateStudent(
  newStudent: ParsedStudentRow,
  existingRoster: Array<{ full_name?: string; last_name?: string; first_name?: string; middle_name?: string | null; email?: string | null }>
): boolean {
  const newNameNorm = newStudent.fullName.toLowerCase().replace(/\s+/g, " ").trim();
  const newEmail = newStudent.email?.toLowerCase().trim();

  return existingRoster.some((existing) => {
    const existFull = formatStudentFullName(existing) || existing.full_name || "";
    const existNameNorm = existFull.toLowerCase().replace(/\s+/g, " ").trim();
    if (existNameNorm === newNameNorm) return true;

    if (
      existing.last_name &&
      existing.first_name &&
      newStudent.lastName &&
      newStudent.firstName &&
      existing.last_name.trim().toLowerCase() === newStudent.lastName.trim().toLowerCase() &&
      existing.first_name.trim().toLowerCase() === newStudent.firstName.trim().toLowerCase()
    ) {
      return true;
    }

    if (newEmail && existing.email) {
      return existing.email.toLowerCase().trim() === newEmail;
    }

    return false;
  });
}

// ── Excel Export Generator ──────────────────────────────────────────────────

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
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
    email?: string | null;
    average?: number;
    attendance?: number;
  }>;
  quizzes?: Array<{ id?: string; quizTitle: string; maxScore?: number }>;
  results?: Array<{ studentId?: string; studentName: string; quizTitle: string; totalScore: number }>;
}

/**
 * Formats a quiz column header as "Quiz 1: <Title> (<Max> pts)" or "Quiz 1"
 */
export function formatQuizColumnHeader(
  quiz: { quizTitle: string; maxScore?: number },
  index: number
): string {
  const rawTitle = (quiz.quizTitle || "").trim();
  const hasQuizPrefix = /^quiz\s*\d+/i.test(rawTitle);
  const baseTitle = rawTitle
    ? hasQuizPrefix
      ? rawTitle
      : `Quiz ${index + 1}: ${rawTitle}`
    : `Quiz ${index + 1}`;
  if (typeof quiz.maxScore === "number" && quiz.maxScore > 0) {
    return `${baseTitle} (${quiz.maxScore} pts)`;
  }
  return baseTitle;
}

/**
 * Generates an Excel workbook (.xlsx) following the BSIT4 format from classroom metadata,
 * student roster (Last Name, First Name, Middle Name, Email Address), individual Quiz 1, Quiz 2,
 * Quiz 3... scores, and Average Scores.
 */
export function generateExcelClasslistBase64(options: ExportClasslistOptions): string {
  const { classroomTitle, subject, section, room, schedule, teacher, students, quizzes = [], results = [] } = options;

  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Determine quiz columns: use provided quizzes, or derive from results, or default to Quiz 1, Quiz 2, Quiz 3
  const effectiveQuizzes: Array<{ quizTitle: string; maxScore?: number }> =
    quizzes.length > 0
      ? quizzes
      : results.length > 0
        ? Array.from(new Set(results.map((r) => r.quizTitle.trim()).filter(Boolean))).map((qt) => ({
            quizTitle: qt,
          }))
        : [
            { quizTitle: "Quiz 1" },
            { quizTitle: "Quiz 2" },
            { quizTitle: "Quiz 3" },
          ];

  const quizHeaders = effectiveQuizzes.map((q, idx) => formatQuizColumnHeader(q, idx));

  // Build fast lookup map by studentId:::quizTitle and studentName:::quizTitle
  const scoreById = new Map<string, number>();
  const scoreByName = new Map<string, number>();

  for (const r of results) {
    const qTitle = (r.quizTitle || "").trim().toLowerCase();
    if (r.studentId) {
      scoreById.set(`${r.studentId}:::${qTitle}`, r.totalScore);
    }
    if (r.studentName) {
      scoreByName.set(`${r.studentName.trim().toLowerCase()}:::${qTitle}`, r.totalScore);
    }
  }

  // Build rows array for SheetJS (BSIT4 layout)
  const rows: any[][] = [
    ["TSEKI - CLASS ROSTER & PERFORMANCE RECORD"],
    ["Classroom:", classroomTitle, "", "Subject:", subject || "N/A"],
    ["Section:", section || "N/A", "", "Room:", room || "N/A"],
    ["Schedule:", schedule || "N/A", "", "Teacher:", teacher || "N/A"],
    ["Export Date:", formattedDate, "", "Total Enrolled:", students.length],
    [], // Blank separator row
    ["Item", "Last Name", "First Name", "Middle Name", "Email Address", ...quizHeaders, "Average Scores"],
  ];

  // Populate student records with individual quiz scores and calculated average score
  students.forEach((s, idx) => {
    const norm = normalizeStudentRecord(s);
    const normFull = (norm.full_name || "").trim().toLowerCase();
    const normSimple = `${norm.first_name} ${norm.last_name}`.trim().toLowerCase();

    let earnedTotal = 0;
    let maxTotal = 0;
    let scoredCount = 0;

    const quizScoreCells = effectiveQuizzes.map((q) => {
      const qTitle = (q.quizTitle || "").trim().toLowerCase();
      let score: number | undefined;
      if (s.id && scoreById.has(`${s.id}:::${qTitle}`)) {
        score = scoreById.get(`${s.id}:::${qTitle}`);
      } else if (scoreByName.has(`${normFull}:::${qTitle}`)) {
        score = scoreByName.get(`${normFull}:::${qTitle}`);
      } else if (scoreByName.has(`${normSimple}:::${qTitle}`)) {
        score = scoreByName.get(`${normSimple}:::${qTitle}`);
      }

      if (typeof score === "number" && !Number.isNaN(score)) {
        earnedTotal += score;
        const qMax = (q.maxScore && q.maxScore > 0) ? q.maxScore : 100;
        maxTotal += qMax;
        scoredCount++;
        return { t: "n", v: score };
      }
      return "";
    });

    // Compute average score display: database average preferred, otherwise derived from quiz scores
    let averageDisplay = "0%";
    if (typeof s.average === "number" && !Number.isNaN(s.average)) {
      averageDisplay = `${Math.round(s.average)}%`;
    } else if (scoredCount > 0 && maxTotal > 0) {
      averageDisplay = `${Math.round((earnedTotal / maxTotal) * 100)}%`;
    }

    rows.push([
      idx + 1,
      norm.last_name,
      norm.first_name,
      norm.middle_name || "",
      s.email || "N/A",
      ...quizScoreCells,
      averageDisplay,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set standard column widths so text is nicely readable in Excel
  ws["!cols"] = [
    { wch: 8 },  // Item
    { wch: 22 }, // Last Name
    { wch: 22 }, // First Name
    { wch: 18 }, // Middle Name
    { wch: 30 }, // Email Address
    ...quizHeaders.map((h) => ({ wch: Math.max(16, h.length + 4) })),
    { wch: 18 }, // Average Scores
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Classlist");

  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

// ── Teacher Excel Blank Template Generator (BSIT4 Format) ───────────────────

export interface ExcelTemplateOptions {
  classroomTitle?: string;
  subject?: string;
  section?: string;
  room?: string;
  schedule?: string;
  teacher?: string;
}

/**
 * Generates a pre-formatted blank BSIT4 Excel template for teachers with column headers:
 * Item | Last Name | First Name | Middle Name | Email Address
 * includes sample rows for reference.
 */
export function generateExcelTemplateBase64(options?: ExcelTemplateOptions): string {
  const meta = options || {};
  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rows: any[][] = [
    ["TSEKI - CLASS ROSTER TEMPLATE"],
    ["Classroom:", meta.classroomTitle || "BSIT-4", "", "Subject:", meta.subject || "SAM"],
    ["Section:", meta.section || "SECTION 5", "", "Room:", meta.room || "CL2"],
    ["Schedule:", meta.schedule || "MWF 3:30-4:30", "", "Teacher:", meta.teacher || "N/A"],
    ["Export Date:", formattedDate, "", "Total Enrolled:", 3],
    [], // Blank separator row
    ["Item", "Last Name", "First Name", "Middle Name", "Email Address"],
    [1, "Abellanosa", "Reymark", "B.", "reymark.abellanosa@example.com"],
    [2, "Abuhat", "Louise Paulo", "T.", "louise.abuhat@example.com"],
    [3, "Aguanta", "Sheme Nichollei John", "A.", "shememyst@gmail.com"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },  // Item
    { wch: 22 }, // Last Name
    { wch: 22 }, // First Name
    { wch: 18 }, // Middle Name
    { wch: 32 }, // Email Address
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Classlist");

  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}


// ── Scores-Only Excel Export Generator ──────────────────────────────────────

export interface ScoreExportOptions {
  classroomTitle: string;
  subject?: string;
  section?: string;
  students: Array<{
    id?: string;
    full_name: string;
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
    studentId?: string;
  }>;
  quizzes: Array<{ id: string; quizTitle: string; maxScore: number }>;
  results: Array<{ studentId?: string; studentName: string; quizTitle: string; totalScore: number }>;
}

/**
 * Generates a scores-only Excel workbook (.xlsx) with one row per student
 * and one column per quiz ("Quiz Title (N pts)").
 * Each quiz cell is strictly a numeric cell ({ t: 'n', v: score }) or blank (undefined).
 * Does NOT include percentages, averages, academic status, remarks, ranks, or total rows.
 */
export function generateScoreExportBase64(options: ScoreExportOptions): string {
  const { students, quizzes, results } = options;

  const headerRow: string[] = [
    "#",
    "Student ID",
    "Student Name",
    ...quizzes.map((q, idx) => formatQuizColumnHeader(q, idx)),
  ];

  // Build fast lookup map by studentId:::quizTitle and studentName:::quizTitle
  const scoreById = new Map<string, number>();
  const scoreByName = new Map<string, number>();

  for (const r of results) {
    const qTitle = (r.quizTitle || "").trim().toLowerCase();
    if (r.studentId) {
      scoreById.set(`${r.studentId}:::${qTitle}`, r.totalScore);
    }
    if (r.studentName) {
      scoreByName.set(`${r.studentName.trim().toLowerCase()}:::${qTitle}`, r.totalScore);
    }
  }

  const rows: any[][] = [headerRow];

  students.forEach((student, idx) => {
    const norm = normalizeStudentRecord(student);
    const displayName = norm.full_name || student.full_name;
    const row: any[] = [
      { t: "n", v: idx + 1 },
      student.studentId || "",
      displayName,
    ];

    const normName = (displayName || "").trim().toLowerCase();
    const normAlt = `${norm.first_name} ${norm.last_name}`.trim().toLowerCase();

    for (const q of quizzes) {
      const qTitle = (q.quizTitle || "").trim().toLowerCase();
      let score: number | undefined;

      if (student.id && scoreById.has(`${student.id}:::${qTitle}`)) {
        score = scoreById.get(`${student.id}:::${qTitle}`);
      } else if (scoreByName.has(`${normName}:::${qTitle}`)) {
        score = scoreByName.get(`${normName}:::${qTitle}`);
      } else if (scoreByName.has(`${normAlt}:::${qTitle}`)) {
        score = scoreByName.get(`${normAlt}:::${qTitle}`);
      }

      if (typeof score === "number" && !Number.isNaN(score)) {
        row.push({ t: "n", v: score });
      } else {
        row.push(undefined);
      }
    }

    rows.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
    { wch: 6 },  // #
    { wch: 16 }, // Student ID
    { wch: 34 }, // Student Name
    ...quizzes.map((q, idx) => ({ wch: Math.max(18, formatQuizColumnHeader(q, idx).length + 4) })),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Quiz Scores");

  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}
