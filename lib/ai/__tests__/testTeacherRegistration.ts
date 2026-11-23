import assert from "node:assert/strict";
import {
  addSubjectTags,
  buildTeacherFullName,
  DEFAULT_SCHOOL_NAME,
  extractProfileFromUserMetadata,
  formatGradeLevelsSummary,
  normalizeSubjectTag,
  SCHOOL_PRESETS,
  validateRegistrationStep1,
} from "../../../shared/teacherRegistration";
import { evaluateTeacherApprovalRow } from "../../../shared/teacherApproval";

console.log("=== Testing 2-Step Verified Teacher Registration Logic ===");

// 1. Scope School Preset check
assert.equal(DEFAULT_SCHOOL_NAME, "Basak Community School");
assert.deepEqual([...SCHOOL_PRESETS], ["Basak Community School"]);

// 2. Full Name formatting
assert.equal(
  buildTeacherFullName({ firstName: "  Christian  ", middleName: "John", lastName: "Amaquin " }),
  "Christian John Amaquin"
);
assert.equal(
  buildTeacherFullName({ firstName: "Maria", middleName: "", lastName: "Santos" }),
  "Maria Santos"
);

// 3. Auto-UPPERCASE Subjects / Strands normalization & deduplication
assert.equal(normalizeSubjectTag("  humss  "), "HUMSS");
assert.equal(normalizeSubjectTag("general   math"), "GENERAL MATH");
assert.deepEqual(
  addSubjectTags(["HUMSS"], "math, science, humss, contemporary arts"),
  ["HUMSS", "MATH", "SCIENCE", "CONTEMPORARY ARTS"]
);

// 4. Multi-select Grade Levels summary formatting
assert.equal(
  formatGradeLevelsSummary(["Grade 12 (SHS)", "Grade 9", "Grade 10", "Grade 11 (SHS)"]),
  "Grade 9, Grade 10, Senior High (SHS)"
);
assert.equal(
  formatGradeLevelsSummary(["Grade 10", "Grade 7"]),
  "Grade 7, Grade 10"
);

// 5. Step 1 Validation
const missingGrades = validateRegistrationStep1({
  firstName: "Juan",
  middleName: "Dela",
  lastName: "Cruz",
  email: "juan@gmail.com",
  schoolName: DEFAULT_SCHOOL_NAME,
  teacherId: "102262",
  gradeLevels: [],
  subjects: ["MATH"],
  password: "password123",
  confirmPassword: "password123",
});
assert.equal(missingGrades.ok, false, "Should require at least one grade level");

const validStep1 = validateRegistrationStep1({
  firstName: "Christian",
  middleName: "John",
  lastName: "Amaquin",
  email: "lalovesheand@gmail.com",
  schoolName: "Basak Community School",
  teacherId: "102262",
  gradeLevels: ["Grade 9", "Grade 10", "Grade 11 (SHS)", "Grade 12 (SHS)"],
  subjects: ["humss", "general math"],
  password: "secretpassword",
  confirmPassword: "secretpassword",
});
assert.equal(validStep1.ok, true, "Valid Step 1 payload should succeed");
assert.equal(validStep1.profile?.fullName, "Christian John Amaquin");
assert.equal(validStep1.profile?.gradeLevelSummary, "Grade 9, Grade 10, Senior High (SHS)");
assert.deepEqual(validStep1.profile?.subjects, ["HUMSS", "GENERAL MATH"]);
assert.equal(validStep1.profile?.subjectsSummary, "HUMSS, GENERAL MATH");

// 6. Metadata recovery for resuming Step 2 after OTP / app reopen
const recovered = extractProfileFromUserMetadata({
  full_name: "Christian John Amaquin",
  first_name: "Christian",
  middle_name: "John",
  last_name: "Amaquin",
  school_name: "Basak Community School",
  teacher_id: "102262",
  grade_levels: ["Grade 9", "Grade 10", "Grade 11 (SHS)", "Grade 12 (SHS)"],
  subjects: ["humss", "math"],
}, "lalovesheand@gmail.com");
assert.ok(recovered);
assert.equal(recovered?.schoolName, "Basak Community School");
assert.deepEqual(recovered?.subjects, ["HUMSS", "MATH"]);

// 7. Approval evaluation for incomplete Step 2 vs completed Pending vs Legacy
const needsStep2 = evaluateTeacherApprovalRow(null, { needs_identity_verification: true });
assert.equal(needsStep2.allowed, false);
assert.equal(needsStep2.needsIdentityVerification, true);
assert.equal(needsStep2.status, "needs_verification");

const pendingComplete = evaluateTeacherApprovalRow(
  {
    status: "pending",
    school_id_url: "teacher-verification-docs/u1/id-front.jpg",
    school_id_back_url: "teacher-verification-docs/u1/id-back.jpg",
    facial_verification_url: "teacher-verification-docs/u1/selfie.jpg",
  },
  { needs_identity_verification: false }
);
assert.equal(pendingComplete.allowed, false);
assert.equal(pendingComplete.needsIdentityVerification, undefined);
assert.equal(pendingComplete.status, "pending");

const legacyTeacher = evaluateTeacherApprovalRow(null, {});
assert.equal(legacyTeacher.allowed, true);
assert.equal(legacyTeacher.status, "legacy");

console.log("ALL 2-STEP VERIFIED TEACHER REGISTRATION TESTS PASSED!");
