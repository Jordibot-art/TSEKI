import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  addSubjectTags,
  GRADE_LEVEL_GROUPS,
  normalizeSubjectTag,
  SCHOOL_PRESETS,
  SUBJECT_PRESET_TAGS,
  type TeacherRegistrationStep1Data,
} from "../lib/teacherRegistration";
import styles from "./TeacherRegistrationWeb.module.css";

export interface TeacherRegistrationStep1WebProps {
  values: TeacherRegistrationStep1Data;
  onChange: (patch: Partial<TeacherRegistrationStep1Data>) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBackToLogin: () => void;
}

export function TeacherRegistrationStep1Web({
  values,
  onChange,
  loading,
  onSubmit,
  onBackToLogin,
}: TeacherRegistrationStep1WebProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [customSubjectInput, setCustomSubjectInput] = useState("");

  const filteredSchools = useMemo(() => {
    const q = schoolSearch.trim().toLowerCase();
    if (!q) return SCHOOL_PRESETS;
    return SCHOOL_PRESETS.filter((s) => s.toLowerCase().includes(q));
  }, [schoolSearch]);

  function toggleGrade(lvl: string) {
    const exists = values.gradeLevels.includes(lvl);
    onChange({
      gradeLevels: exists
        ? values.gradeLevels.filter((g) => g !== lvl)
        : [...values.gradeLevels, lvl],
    });
  }

  function toggleGradeGroup(levels: readonly string[]) {
    const allSelected = levels.every((l) => values.gradeLevels.includes(l));
    if (allSelected) {
      onChange({
        gradeLevels: values.gradeLevels.filter((g) => !levels.includes(g)),
      });
    } else {
      onChange({
        gradeLevels: Array.from(new Set([...values.gradeLevels, ...levels])),
      });
    }
  }

  function toggleSubject(tag: string) {
    const upper = normalizeSubjectTag(tag);
    const exists = values.subjects.includes(upper);
    onChange({
      subjects: exists
        ? values.subjects.filter((s) => s !== upper)
        : [...values.subjects, upper],
    });
  }

  function handleAddCustomSubject() {
    if (!customSubjectInput.trim()) return;
    onChange({ subjects: addSubjectTags(values.subjects, customSubjectInput) });
    setCustomSubjectInput("");
  }

  const customTags = values.subjects.filter((s) => !SUBJECT_PRESET_TAGS.includes(s));

  return (
    <div>
      <div className={styles.stepTopRow}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBackToLogin}
          aria-label="Back to login"
        >
          <ArrowLeft size={20} />
        </button>
        <span className={styles.stepPill}>Step 1 of 2 · Profile</span>
      </div>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: "50%" }} />
      </div>

      <h2 className={styles.heading}>Teacher Sign Up</h2>
      <p className={styles.subtext}>
        Enter your official teacher profile. Physical ID &amp; Face Selfie will follow right after email OTP verification.
      </p>

      <form onSubmit={onSubmit}>
        <div className={styles.formStack}>
          {/* 1. Full Name */}
          <div className={styles.fieldSection}>
            <span className={styles.sectionLabel}>
              Full Name <span className={styles.req}>*</span>
            </span>
            <p className={styles.helper}>Must match your physical Teacher ID card.</p>
            <div className={styles.gridTwo}>
              <input
                type="text"
                placeholder="First Name *"
                value={values.firstName}
                onChange={(e) => onChange({ firstName: e.target.value })}
                className={styles.input}
                autoFocus
                disabled={loading}
              />
              <input
                type="text"
                placeholder="Last Name *"
                value={values.lastName}
                onChange={(e) => onChange({ lastName: e.target.value })}
                className={styles.input}
                disabled={loading}
              />
            </div>
            <input
              type="text"
              placeholder="Middle Name (optional)"
              value={values.middleName}
              onChange={(e) => onChange({ middleName: e.target.value })}
              className={styles.input}
              disabled={loading}
            />
          </div>

          {/* 2. Email */}
          <div className={styles.fieldSection}>
            <label className={styles.sectionLabel} htmlFor="tw-reg-email">
              Email Address <span className={styles.req}>*</span>
            </label>
            <input
              id="tw-reg-email"
              type="email"
              placeholder="School email or Gmail"
              value={values.email}
              onChange={(e) => onChange({ email: e.target.value })}
              className={styles.input}
              disabled={loading}
            />
          </div>

          {/* 3. School Name (Searchable Dropdown) */}
          <div className={styles.fieldSection}>
            <label className={styles.sectionLabel} htmlFor="tw-reg-school">
              School Name <span className={styles.req}>*</span>
            </label>
            {SCHOOL_PRESETS.length > 1 && (
              <input
                type="text"
                placeholder="Search school..."
                value={schoolSearch}
                onChange={(e) => setSchoolSearch(e.target.value)}
                className={styles.input}
                disabled={loading}
              />
            )}
            <select
              id="tw-reg-school"
              value={values.schoolName}
              onChange={(e) => onChange({ schoolName: e.target.value })}
              className={styles.input}
              disabled={loading}
            >
              {filteredSchools.map((school) => (
                <option key={school} value={school}>
                  {school}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Teacher / Employee ID */}
          <div className={styles.fieldSection}>
            <label className={styles.sectionLabel} htmlFor="tw-reg-tid">
              Teacher / Employee ID <span className={styles.req}>*</span>
            </label>
            <input
              id="tw-reg-tid"
              type="text"
              placeholder="e.g. 102262 or BCS-2026-014"
              value={values.teacherId}
              onChange={(e) => onChange({ teacherId: e.target.value })}
              className={styles.input}
              disabled={loading}
            />
          </div>

          {/* 5. Grade Levels Handled (Multi-select Checkboxes) */}
          <div className={styles.fieldSection}>
            <div className={styles.labelRow}>
              <span className={styles.sectionLabel}>
                Grade Levels Handled <span className={styles.req}>*</span>
              </span>
              {values.gradeLevels.length > 0 && (
                <span className={styles.selectedCount}>
                  {values.gradeLevels.length} selected
                </span>
              )}
            </div>
            <p className={styles.helper}>
              Check all levels you teach (e.g., Grade 9, Grade 10 &amp; Senior High).
            </p>
            {GRADE_LEVEL_GROUPS.map((group) => {
              const allChecked = group.levels.every((l) =>
                values.gradeLevels.includes(l)
              );
              return (
                <div key={group.id} className={styles.gradeGroupCard}>
                  <div className={styles.gradeGroupHeader}>
                    <span className={styles.gradeGroupTitle}>{group.label}</span>
                    <button
                      type="button"
                      className={styles.selectAllBtn}
                      onClick={() => toggleGradeGroup(group.levels)}
                      disabled={loading}
                    >
                      {allChecked ? "Clear" : `Select all ${group.shortLabel}`}
                    </button>
                  </div>
                  <div className={styles.chipGrid}>
                    {group.levels.map((lvl) => {
                      const checked = values.gradeLevels.includes(lvl);
                      return (
                        <label
                          key={lvl}
                          className={`${styles.checkChip} ${
                            checked ? styles.checkChipActive : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGrade(lvl)}
                            disabled={loading}
                            style={{ accentColor: "#FF6B00", margin: 0 }}
                          />
                          {lvl}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 6. Subjects / Strands (Multi-select + Auto-UPPERCASE Custom Input) */}
          <div className={styles.fieldSection}>
            <div className={styles.labelRow}>
              <span className={styles.sectionLabel}>
                Subjects / Strands <span className={styles.req}>*</span>
              </span>
              {values.subjects.length > 0 && (
                <span className={styles.selectedCount}>
                  {values.subjects.length} selected
                </span>
              )}
            </div>
            <p className={styles.helper}>
              Select tags or type any custom subject — text automatically converts to UPPERCASE.
            </p>
            <div className={styles.customSubjectRow}>
              <input
                type="text"
                placeholder="TYPE SUBJECT (E.G. GENERAL MATH)"
                value={customSubjectInput}
                onChange={(e) => setCustomSubjectInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomSubject();
                  }
                }}
                className={styles.input}
                style={{ textTransform: "uppercase" }}
                disabled={loading}
              />
              <button
                type="button"
                className={styles.addBtn}
                onClick={handleAddCustomSubject}
                disabled={!customSubjectInput.trim() || loading}
              >
                <Plus size={15} />
                Add
              </button>
            </div>

            {customTags.length > 0 && (
              <div className={styles.chipGrid}>
                {customTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`${styles.subjectTag} ${styles.subjectTagActive}`}
                    onClick={() => toggleSubject(tag)}
                  >
                    {tag}
                    <X size={13} />
                  </button>
                ))}
              </div>
            )}

            <div className={styles.chipGrid}>
              {SUBJECT_PRESET_TAGS.map((tag) => {
                const active = values.subjects.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`${styles.subjectTag} ${
                      active ? styles.subjectTagActive : ""
                    }`}
                    onClick={() => toggleSubject(tag)}
                    disabled={loading}
                  >
                    {tag}
                    {active && <Check size={13} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 7. Password & Confirm */}
          <div className={styles.fieldSection}>
            <span className={styles.sectionLabel}>
              Password <span className={styles.req}>*</span>
            </span>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password (min. 6 characters)"
                value={values.password}
                onChange={(e) => onChange({ password: e.target.value })}
                className={styles.input}
                style={{ paddingRight: 38 }}
                disabled={loading}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <div className={styles.passwordWrap}>
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm password"
                value={values.confirmPassword}
                onChange={(e) => onChange({ confirmPassword: e.target.value })}
                className={styles.input}
                style={{ paddingRight: 38 }}
                disabled={loading}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowConfirm((p) => !p)}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div className={styles.infoBanner}>
            <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Next: Verify your email OTP, then upload your Physical Teacher ID (Front &amp; Back) and Face Selfie on Step 2.
            </span>
          </div>
        </div>

        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={loading}
          style={{ marginTop: 14 }}
        >
          {loading ? (
            <Loader2 size={18} className={styles.spinner} />
          ) : (
            "CONTINUE & VERIFY EMAIL"
          )}
        </button>

        <button
          type="button"
          className={styles.secondaryLinkBtn}
          onClick={onBackToLogin}
          disabled={loading}
        >
          Already have an account? <strong style={{ color: "#FF6B00" }}>Sign in</strong>
        </button>
      </form>
    </div>
  );
}
