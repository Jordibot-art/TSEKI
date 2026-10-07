import * as FileSystem from "expo-file-system/legacy";
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

// ── Name Formatting ─────────────────────────────────────────────────────────

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
    } else if (
      text.includes("student's name") ||
      text.includes("student name") ||
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
      "Could not detect a student roster table in this spreadsheet. Expected columns like 'Student ID', 'Student's Name', etc."
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

    // Get the full name — this is the required field
    const nameIdx = colMap["fullName"];
    if (nameIdx === undefined) continue;

    const rawName = cellToString(row[nameIdx]);
    if (!rawName || rawName.length < 2) continue;

    // Skip summary/total rows
    if (/^(total|subtotal|count|summary)/i.test(rawName)) continue;

    // Format name: Smart Title Case, preserving "LASTNAME, FIRSTNAME" order
    const formattedName = toSmartTitleCase(rawName);

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
      fullName: formattedName,
      gender: gender ?? undefined,
      course: course ?? undefined,
      yearLevel: yearLevel ?? undefined,
      contactNo: contactNo ?? undefined,
      email,
      selected: true,
    });
  }

  // 5. Sort students alphabetically by surname (since names are in "Lastname, Firstname" format)
  const sortedStudents = rawStudents.sort((a, b) =>
    a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" })
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
  existingRoster: Array<{ full_name: string; email?: string | null }>
): boolean {
  const newNameNorm = newStudent.fullName.toLowerCase().replace(/\s+/g, " ").trim();
  const newEmail = newStudent.email?.toLowerCase().trim();

  return existingRoster.some((existing) => {
    const existNameNorm = existing.full_name.toLowerCase().replace(/\s+/g, " ").trim();
    if (existNameNorm === newNameNorm) return true;

    if (newEmail && existing.email) {
      return existing.email.toLowerCase().trim() === newEmail;
    }

    return false;
  });
}
