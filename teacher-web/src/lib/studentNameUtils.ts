import * as XLSX from "xlsx";

export interface StudentNameParts {
  lastName: string;
  firstName: string;
  middleName: string | null;
}

/**
 * Splits a combined full_name into { lastName, firstName, middleName }.
 * Supports both "Last, First Middle" and "First Middle Last".
 */
export function splitStudentFullName(fullName: string): StudentNameParts {
  const cleaned = (fullName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { lastName: "", firstName: "", middleName: null };
  }

  if (cleaned.includes(",")) {
    const [rawLast, ...restParts] = cleaned.split(",");
    const lastName = rawLast.trim();
    const rest = restParts.join(" ").trim();
    if (!rest) {
      return { lastName, firstName: "", middleName: null };
    }
    const tokens = rest.split(" ").filter(Boolean);
    if (tokens.length === 1) {
      return { lastName, firstName: tokens[0], middleName: null };
    }
    const firstName = tokens[0];
    const middleName = tokens.slice(1).join(" ") || null;
    return { lastName, firstName, middleName };
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 1) {
    return { lastName: tokens[0], firstName: "", middleName: null };
  }
  if (tokens.length === 2) {
    return { lastName: tokens[1], firstName: tokens[0], middleName: null };
  }
  const firstName = tokens[0];
  const lastName = tokens[tokens.length - 1];
  const middleName = tokens.slice(1, -1).join(" ") || null;
  return { lastName, firstName, middleName };
}

/**
 * Formats { last_name, first_name, middle_name, full_name } into a display string:
 * "Last Name, First Name Middle Name" (or fallback to full_name).
 */
export function formatStudentFullName(student: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  full_name?: string | null;
}): string {
  const ln = (student.last_name || "").trim();
  const fn = (student.first_name || "").trim();
  const mn = (student.middle_name || "").trim();

  if (ln && fn) {
    return `${ln}, ${fn}${mn ? ` ${mn}` : ""}`;
  }
  if (ln || fn) {
    return [ln, fn, mn].filter(Boolean).join(" ");
  }
  return (student.full_name || "").trim();
}

/**
 * Ensures a student record has populated last_name, first_name, middle_name, and full_name.
 */
export function normalizeStudentRecord<
  T extends {
    last_name?: string | null;
    first_name?: string | null;
    middle_name?: string | null;
    full_name?: string | null;
  }
>(
  student: T
): T & { last_name: string; first_name: string; middle_name: string | null; full_name: string } {
  const hasStructured = Boolean(
    (student.last_name && student.last_name.trim()) ||
      (student.first_name && student.first_name.trim())
  );
  if (hasStructured) {
    const last_name = (student.last_name || "").trim();
    const first_name = (student.first_name || "").trim();
    const middle_name = (student.middle_name || "").trim() || null;
    const full_name =
      formatStudentFullName({
        last_name,
        first_name,
        middle_name,
        full_name: student.full_name,
      }) || (student.full_name || "").trim();
    return { ...student, last_name, first_name, middle_name, full_name };
  }

  const parts = splitStudentFullName(student.full_name || "");
  const full_name =
    (student.full_name || "").trim() ||
    formatStudentFullName({
      last_name: parts.lastName,
      first_name: parts.firstName,
      middle_name: parts.middleName,
    });
  return {
    ...student,
    last_name: parts.lastName,
    first_name: parts.firstName,
    middle_name: parts.middleName,
    full_name,
  };
}

/**
 * Formats a quiz column header as "Quiz 1: Title (Max pts)" or "Quiz 1 (Max pts)"
 */
export function formatQuizColumnHeader(
  quizTitle: string,
  index: number,
  maxScore?: number
): string {
  const trimmed = (quizTitle || "").trim();
  const baseLabel = /^quiz\s*\d+/i.test(trimmed)
    ? trimmed
    : trimmed
    ? `Quiz ${index + 1}: ${trimmed}`
    : `Quiz ${index + 1}`;
  if (maxScore && maxScore > 0) {
    return `${baseLabel} (${maxScore} pts)`;
  }
  return baseLabel;
}

export interface ExcelTemplateMetadata {
  classroomTitle?: string;
  subject?: string;
  section?: string;
  room?: string;
  schedule?: string;
  teacher?: string;
}

/**
 * Builds an XLSX Workbook for the BSIT-4 blank template with sample student records.
 */
export function generateExcelTemplateWorkbook(meta?: ExcelTemplateMetadata): XLSX.WorkBook {
  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rows: any[][] = [
    ["TSEKI - CLASS ROSTER TEMPLATE"],
    ["Classroom:", meta?.classroomTitle || "BSIT-4", "", "Subject:", meta?.subject || "SAM"],
    ["Section:", meta?.section || "SECTION 5", "", "Room:", meta?.room || "CL2"],
    ["Schedule:", meta?.schedule || "MWF 3:30-4:30", "", "Teacher:", meta?.teacher || "N/A"],
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
  return wb;
}

/**
 * Downloads the BSIT-4 Excel template directly in the browser.
 */
export function downloadExcelTemplate(meta?: ExcelTemplateMetadata, fileName?: string): void {
  const wb = generateExcelTemplateWorkbook(meta);
  const cleanTitle = (meta?.classroomTitle || "Classroom")
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_");
  const actualFileName = fileName || `${cleanTitle}_BSIT4_Template.xlsx`;
  XLSX.writeFile(wb, actualFileName);
}
