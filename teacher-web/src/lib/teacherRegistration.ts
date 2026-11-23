// AUTO-SYNCED FROM /shared — edit the canonical file in /shared and run `npm run sync:shared`.
/**
 * Shared Teacher Registration Schema, Presets, Normalizers & Validators
 *
 * Canonical single source of truth shared between Mobile (Expo) and Teacher Web.
 */

export const TEACHER_VERIFICATION_BUCKET = "teacher-verification-docs";

/**
 * Scope-focused school list (Basak Community School).
 */
export const DEFAULT_SCHOOL_NAME = "Basak Community School";
export const SCHOOL_PRESETS: readonly string[] = [
  "Basak Community School",
];

export interface GradeLevelGroup {
  id: string;
  label: string;
  shortLabel: string;
  levels: readonly string[];
}

export const GRADE_LEVEL_GROUPS: readonly GradeLevelGroup[] = [
  {
    id: "elem",
    label: "Elementary",
    shortLabel: "Elem",
    levels: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"],
  },
  {
    id: "jhs",
    label: "Junior High School",
    shortLabel: "JHS",
    levels: ["Grade 7", "Grade 8", "Grade 9", "Grade 10"],
  },
  {
    id: "shs",
    label: "Senior High School (SHS)",
    shortLabel: "SHS",
    levels: ["Grade 11 (SHS)", "Grade 12 (SHS)"],
  },
];

export const ALL_GRADE_LEVELS: readonly string[] = GRADE_LEVEL_GROUPS.flatMap(
  (g) => g.levels
);

export const SUBJECT_PRESET_TAGS: readonly string[] = [
  "HUMSS",
  "STEM",
  "ABM",
  "GAS",
  "TVL",
  "MATH",
  "SCIENCE",
  "ENGLISH",
  "FILIPINO",
  "ARALING PANLIPUNAN",
  "ICT",
  "MAPEH",
  "ESP",
  "TLE",
  "RESEARCH",
];

export interface TeacherRegistrationStep1Data {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  schoolName: string;
  teacherId: string;
  gradeLevels: string[];
  subjects: string[];
  password: string;
  confirmPassword: string;
}

export interface TeacherRegistrationProfile {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  email: string;
  schoolName: string;
  teacherId: string;
  gradeLevels: string[];
  gradeLevelSummary: string;
  subjects: string[];
  subjectsSummary: string;
}

/**
 * Normalizes any subject/strand input to clean UPPERCASE automatically
 * (e.g., "humss" -> "HUMSS", "general math" -> "GENERAL MATH").
 */
export function normalizeSubjectTag(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Adds one or more comma-separated subject tags into the list, auto-uppercasing
 * and preventing case-insensitive duplicates.
 */
export function addSubjectTags(current: string[], rawInput: string): string[] {
  const existing = current.map(normalizeSubjectTag).filter(Boolean);
  const seen = new Set(existing);
  const parts = String(rawInput || "")
    .split(",")
    .map(normalizeSubjectTag)
    .filter(Boolean);

  const next = [...existing];
  for (const tag of parts) {
    if (!seen.has(tag)) {
      seen.add(tag);
      next.push(tag);
    }
  }
  return next;
}

/**
 * Builds a clean full name matching a physical ID card:
 * "First Middle Last" (omitting middle name if blank).
 */
export function buildTeacherFullName(parts: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}): string {
  const first = String(parts.firstName || "").replace(/\s+/g, " ").trim();
  const middle = String(parts.middleName || "").replace(/\s+/g, " ").trim();
  const last = String(parts.lastName || "").replace(/\s+/g, " ").trim();
  return [first, middle, last].filter(Boolean).join(" ");
}

/**
 * Sorts and formats multi-selected grade levels into a clean compact summary
 * for legacy `grade_level TEXT` columns and table badges.
 * Example: ["Grade 9", "Grade 10", "Grade 11 (SHS)", "Grade 12 (SHS)"]
 *       -> "Grade 9, Grade 10, Senior High (SHS)"
 */
export function formatGradeLevelsSummary(levels: string[]): string {
  const unique = Array.from(new Set(levels.map((l) => l.trim()).filter(Boolean)));
  if (unique.length === 0) return "";

  const orderIndex = (lvl: string) => {
    const idx = ALL_GRADE_LEVELS.indexOf(lvl);
    return idx >= 0 ? idx : 999;
  };
  const sorted = [...unique].sort((a, b) => orderIndex(a) - orderIndex(b));

  const hasG11 = sorted.includes("Grade 11 (SHS)");
  const hasG12 = sorted.includes("Grade 12 (SHS)");

  if (hasG11 && hasG12) {
    const nonShs = sorted.filter((l) => l !== "Grade 11 (SHS)" && l !== "Grade 12 (SHS)");
    return [...nonShs, "Senior High (SHS)"].join(", ");
  }

  return sorted.join(", ");
}

export function isValidEmailAddress(email: string): boolean {
  const clean = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

export interface Step1ValidationResult {
  ok: boolean;
  error?: string;
  profile?: TeacherRegistrationProfile;
}

export function validateRegistrationStep1(
  input: TeacherRegistrationStep1Data
): Step1ValidationResult {
  const firstName = input.firstName.replace(/\s+/g, " ").trim();
  const middleName = input.middleName.replace(/\s+/g, " ").trim();
  const lastName = input.lastName.replace(/\s+/g, " ").trim();
  const email = input.email.trim();
  const schoolName = input.schoolName.replace(/\s+/g, " ").trim();
  const teacherId = input.teacherId.replace(/\s+/g, " ").trim();
  const gradeLevels = Array.from(new Set(input.gradeLevels.map((g) => g.trim()).filter(Boolean)));
  const subjects = Array.from(new Set(input.subjects.map(normalizeSubjectTag).filter(Boolean)));

  if (!firstName || !lastName) {
    return {
      ok: false,
      error: "Please enter your First Name and Last Name exactly as shown on your physical Teacher ID.",
    };
  }

  if (!email || !isValidEmailAddress(email)) {
    return {
      ok: false,
      error: "Please enter a valid school email address or Gmail.",
    };
  }

  if (!schoolName) {
    return {
      ok: false,
      error: "Please select your school (Basak Community School).",
    };
  }

  if (!teacherId) {
    return {
      ok: false,
      error: "Please enter your Teacher / Employee ID number.",
    };
  }

  if (gradeLevels.length === 0) {
    return {
      ok: false,
      error: "Please select at least one Grade Level you handle.",
    };
  }

  if (subjects.length === 0) {
    return {
      ok: false,
      error: "Please select or add at least one Subject or Strand you handle.",
    };
  }

  if (!input.password || input.password.length < 6) {
    return {
      ok: false,
      error: "Password must be at least 6 characters long.",
    };
  }

  if (input.password !== input.confirmPassword) {
    return {
      ok: false,
      error: "Passwords do not match. Please verify and try again.",
    };
  }

  const fullName = buildTeacherFullName({ firstName, middleName, lastName });
  const gradeLevelSummary = formatGradeLevelsSummary(gradeLevels);
  const subjectsSummary = subjects.join(", ");

  return {
    ok: true,
    profile: {
      firstName,
      middleName,
      lastName,
      fullName,
      email,
      schoolName,
      teacherId,
      gradeLevels,
      gradeLevelSummary,
      subjects,
      subjectsSummary,
    },
  };
}

/**
 * Reconstructs a TeacherRegistrationProfile from Supabase auth user_metadata
 * (used when resuming Step 2 right after Email OTP verification or reopening the app).
 */
export function extractProfileFromUserMetadata(
  meta: Record<string, unknown> | null | undefined,
  fallbackEmail = ""
): TeacherRegistrationProfile | null {
  if (!meta) return null;

  const firstName = String(meta.first_name || "").trim();
  const middleName = String(meta.middle_name || "").trim();
  const lastName = String(meta.last_name || "").trim();
  const fullName =
    String(meta.full_name || "").trim() ||
    buildTeacherFullName({ firstName, middleName, lastName });
  const email = String(meta.email || fallbackEmail || "").trim();
  const schoolName = String(meta.school_name || DEFAULT_SCHOOL_NAME).trim();
  const teacherId = String(meta.teacher_id || "").trim();

  const rawGrades = Array.isArray(meta.grade_levels)
    ? meta.grade_levels.map((v) => String(v || "").trim()).filter(Boolean)
    : typeof meta.grade_level === "string" && meta.grade_level.trim()
      ? meta.grade_level
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

  const rawSubjects = Array.isArray(meta.subjects)
    ? meta.subjects.map((v) => normalizeSubjectTag(String(v || ""))).filter(Boolean)
    : typeof meta.subject === "string" && meta.subject.trim()
      ? meta.subject
          .split(",")
          .map((v) => normalizeSubjectTag(v))
          .filter(Boolean)
      : [];

  if (!fullName && !teacherId) return null;

  return {
    firstName,
    middleName,
    lastName,
    fullName: fullName || "Teacher",
    email,
    schoolName,
    teacherId,
    gradeLevels: rawGrades,
    gradeLevelSummary: formatGradeLevelsSummary(rawGrades) || String(meta.grade_level || ""),
    subjects: rawSubjects,
    subjectsSummary: rawSubjects.join(", ") || String(meta.subject || meta.strand || ""),
  };
}
