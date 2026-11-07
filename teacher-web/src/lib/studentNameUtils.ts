import * as XLSX from "xlsx";

export interface StudentNameParts {
  lastName: string;
  firstName: string;
  middleName: string | null;
}

/**
 * Converts a string to Smart Title Case.
 * e.g. "AYAP, RAMEL JR. M." → "Ayap, Ramel Jr. M."
 */
export function toSmartTitleCase(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/(?:^|[\s,.\-/()])[a-z]/g, (match) => match.toUpperCase())
    .replace(/\b(ii|iii|iv|v)\b/gi, (match) => match.toUpperCase())
    .replace(/\b(jr|sr)\.?/gi, (match) => {
      const base = match.replace(/\./g, "").toLowerCase();
      return base.charAt(0).toUpperCase() + base.slice(1) + ".";
    });
}

/**
 * Formats a middle name or middle initial into a single uppercase initial with period: "M."
 * Returns "" if empty or N/A.
 * e.g. "coran" -> "C.", "C." -> "C."
 */
export function formatMiddleInitial(middleName?: string | null): string {
  if (!middleName) return "";
  const cleaned = String(middleName)
    .replace(/\./g, " ")
    .trim();
  if (
    !cleaned ||
    cleaned.toUpperCase() === "N/A" ||
    cleaned === "-" ||
    cleaned === "—" ||
    cleaned.toUpperCase() === "NONE"
  ) {
    return "";
  }
  const match = cleaned.match(/[a-zA-Z]/);
  if (!match) return "";
  return `${match[0].toUpperCase()}.`;
}

const SUFFIX_SET = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

const COMMON_SECOND_GIVEN_NAMES = new Set([
  "ariel",
  "paul",
  "paulo",
  "paolo",
  "carlo",
  "carlos",
  "marie",
  "mae",
  "may",
  "joy",
  "ann",
  "anne",
  "rose",
  "jane",
  "grace",
  "mark",
  "marc",
  "john",
  "jon",
  "miguel",
  "gabriel",
  "louise",
  "louis",
  "nichollei",
  "nicole",
  "claire",
  "clara",
  "jean",
  "lynn",
  "lyn",
  "faye",
  "faith",
  "hope",
  "love",
  "dawn",
  "kay",
  "kaye",
  "ray",
  "rey",
  "roy",
  "lee",
  "jay",
  "jae",
  "dan",
  "dean",
  "neil",
  "noel",
  "joel",
  "kyle",
  "kent",
  "kurt",
  "luke",
  "jude",
  "james",
  "ivan",
  "ian",
  "ryan",
  "bryan",
  "brian",
  "kevin",
  "keith",
  "ken",
  "kim",
  "angel",
  "angelo",
  "angela",
  "therese",
  "teresa",
  "sofia",
  "sophia",
  "isabel",
  "isabella",
  "elizabeth",
  "victoria",
  "nicolas",
  "francis",
  "francisco",
  "antonio",
  "jose",
  "juan",
  "maria",
  "andrea",
  "andrei",
  "andre",
  "patrick",
  "patricia",
  "bea",
  "bianca",
  "denise",
  "dennis",
  "lance",
  "vince",
  "vincent",
  "charles",
  "christian",
  "christopher",
  "michael",
  "david",
  "daniel",
  "matthew",
  "joshua",
  "justin",
  "kenneth",
  "steven",
  "stephen",
  "edward",
  "anthony",
  "allen",
  "allan",
  "alvin",
]);

/**
 * Splits a combined full_name into { lastName, firstName, middleName }.
 * Supports both "Last, First [Middle]" and "First [Middle] Last",
 * handling common two-word first names (e.g., "John Ariel C. Ramos", "John Ariel Coran Ramos")
 * and compound surnames (e.g., "Dela Cruz", "De La Cruz", "De Guzman").
 */
export function splitStudentFullName(fullName: string): StudentNameParts {
  const cleaned = (fullName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { lastName: "", firstName: "", middleName: null };
  }

  // Case 1: Comma present -> "Last Name, First Name [Middle Name]"
  if (cleaned.includes(",")) {
    const [rawLast, ...restParts] = cleaned.split(",");
    const lastName = toSmartTitleCase(rawLast.trim());
    const rest = restParts.join(" ").replace(/\s+/g, " ").trim();
    if (!rest) {
      return { lastName, firstName: "", middleName: null };
    }
    const tokens = rest.split(" ").filter(Boolean);
    if (tokens.length === 1) {
      return { lastName, firstName: toSmartTitleCase(tokens[0]), middleName: null };
    }

    const lastToken = tokens[tokens.length - 1];
    if (SUFFIX_SET.has(lastToken.toLowerCase())) {
      return {
        lastName,
        firstName: toSmartTitleCase(tokens.join(" ")),
        middleName: null,
      };
    }

    const middleName = toSmartTitleCase(lastToken) || null;
    const firstName = toSmartTitleCase(tokens.slice(0, -1).join(" "));
    return { lastName, firstName, middleName };
  }

  // Case 2: No comma -> "First Name [Middle Name] Last Name"
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 1) {
    return { lastName: toSmartTitleCase(tokens[0]), firstName: "", middleName: null };
  }
  if (tokens.length === 2) {
    return {
      lastName: toSmartTitleCase(tokens[1]),
      firstName: toSmartTitleCase(tokens[0]),
      middleName: null,
    };
  }

  const compoundSinglePrefixes = new Set([
    "dela",
    "de",
    "del",
    "delos",
    "delas",
    "san",
    "sta",
    "sta.",
    "sto",
    "sto.",
    "st",
    "st.",
  ]);
  const compoundMiddleParticles = new Set(["la", "los", "las"]);

  let lastStartIdx = tokens.length - 1;
  const prevLower = tokens[lastStartIdx - 1]?.toLowerCase();

  if (lastStartIdx >= 2 && compoundMiddleParticles.has(prevLower)) {
    if (lastStartIdx >= 3 && tokens[lastStartIdx - 2].toLowerCase() === "de") {
      lastStartIdx -= 2;
    } else {
      lastStartIdx -= 1;
    }
  } else if (lastStartIdx >= 2 && compoundSinglePrefixes.has(prevLower)) {
    lastStartIdx -= 1;
  }

  const lastName = toSmartTitleCase(tokens.slice(lastStartIdx).join(" "));
  const beforeLast = tokens.slice(0, lastStartIdx);

  if (beforeLast.length === 0) {
    return { lastName, firstName: "", middleName: null };
  }
  if (beforeLast.length === 1) {
    return {
      lastName,
      firstName: toSmartTitleCase(beforeLast[0]),
      middleName: null,
    };
  }

  if (beforeLast.length === 2) {
    const secondToken = beforeLast[1];
    const secondClean = secondToken.replace(/\./g, "").toLowerCase();
    const isInitial = secondClean.length === 1;

    if (isInitial) {
      return {
        lastName,
        firstName: toSmartTitleCase(beforeLast[0]),
        middleName: toSmartTitleCase(secondToken),
      };
    }

    if (SUFFIX_SET.has(secondToken.toLowerCase()) || COMMON_SECOND_GIVEN_NAMES.has(secondClean)) {
      return {
        lastName,
        firstName: toSmartTitleCase(beforeLast.join(" ")),
        middleName: null,
      };
    }

    return {
      lastName,
      firstName: toSmartTitleCase(beforeLast[0]),
      middleName: toSmartTitleCase(secondToken),
    };
  }

  // 3 or more tokens before surname: e.g. "John Ariel C. Ramos" or "John Ariel Coran Ramos"
  const middleToken = beforeLast[beforeLast.length - 1];
  const firstTokens = beforeLast.slice(0, -1);
  return {
    lastName,
    firstName: toSmartTitleCase(firstTokens.join(" ")),
    middleName: toSmartTitleCase(middleToken) || null,
  };
}

/**
 * Formats { last_name, first_name, middle_name, full_name } into:
 * "Last Name, First Name M." (Title Case, middle initial with period; omitted if middle_name is empty).
 * Example: { last_name: "ramos", first_name: "john ariel", middle_name: "coran" } -> "Ramos, John Ariel C."
 */
export function formatStudentFullName(student: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  full_name?: string | null;
}): string {
  const ln = toSmartTitleCase((student.last_name || "").trim());
  const fn = toSmartTitleCase((student.first_name || "").trim());
  const mi = formatMiddleInitial(student.middle_name);

  if (ln && fn) {
    return `${ln}, ${fn}${mi ? ` ${mi}` : ""}`;
  }
  if (ln) {
    return `${ln}${mi ? ` ${mi}` : ""}`;
  }
  if (fn) {
    return `${fn}${mi ? ` ${mi}` : ""}`;
  }

  const rawFull = (student.full_name || "").trim();
  if (!rawFull) return "";
  const parts = splitStudentFullName(rawFull);
  if (parts.lastName || parts.firstName) {
    const sLast = toSmartTitleCase(parts.lastName);
    const sFirst = toSmartTitleCase(parts.firstName);
    const sMid = formatMiddleInitial(parts.middleName);
    if (sLast && sFirst) {
      return `${sLast}, ${sFirst}${sMid ? ` ${sMid}` : ""}`;
    }
    return [sLast, sFirst, sMid].filter(Boolean).join(" ");
  }
  return toSmartTitleCase(rawFull);
}

/**
 * Ensures a student record has populated last_name, first_name, middle_name, and full_name
 * formatted as "Last Name, First Name M.".
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
    const last_name = toSmartTitleCase((student.last_name || "").trim());
    const first_name = toSmartTitleCase((student.first_name || "").trim());
    const middle_name = (student.middle_name || "").trim()
      ? toSmartTitleCase((student.middle_name || "").trim())
      : null;
    const full_name =
      formatStudentFullName({
        last_name,
        first_name,
        middle_name,
        full_name: student.full_name,
      }) || toSmartTitleCase((student.full_name || "").trim());
    return { ...student, last_name, first_name, middle_name, full_name };
  }

  const parts = splitStudentFullName(student.full_name || "");
  const full_name =
    formatStudentFullName({
      last_name: parts.lastName,
      first_name: parts.firstName,
      middle_name: parts.middleName,
    }) || toSmartTitleCase((student.full_name || "").trim());
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
 * Builds an XLSX Workbook for the BSIT-4 blank template with sample student records
 * using the merged "Student Name" ("Last Name, First Name M.") and "Email Address" columns.
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
    ["Item", "Student Name", "Email Address"],
    [1, "Abellanosa, Reymark B.", "reymark.abellanosa@example.com"],
    [2, "Abuhat, Louise Paulo T.", "louise.abuhat@example.com"],
    [3, "Ramos, John Ariel C.", "johnariel.ramos@example.com"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },  // Item
    { wch: 34 }, // Student Name
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
