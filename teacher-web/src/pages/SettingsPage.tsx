import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  User,
  FileText,
  CheckCircle2,
  Moon,
  Sun,
  School,
  Save,
  Cpu,
} from "lucide-react";
import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  const { user } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();

  const [fullName, setFullName] = useState(
    user?.user_metadata?.full_name ||
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "Teacher"
  );
  const [department, setDepartment] = useState("Science & Mathematics");
  const [facultyId, setFacultyId] = useState("CEC-FAC-2026-084");
  const [paperSize, setPaperSize] = useState<"short" | "long">("short");
  const [riskThreshold, setRiskThreshold] = useState<number>(50);
  const [defaultQuestionCount, setDefaultQuestionCount] = useState<number>(10);
  const [aiModel, setAiModel] = useState("gemini-3.5-flash-lite");
  const [savedNotice, setSavedNotice] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
    }, 3000);
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Account & System Settings</h1>
          <p className={styles.subtitle}>
            Manage your faculty profile, grading thresholds, and AI assessment parameters.
          </p>
        </div>
      </div>

      {savedNotice && (
        <div className={styles.savedBanner}>
          <CheckCircle2 size={18} />
          <span>Preferences updated and saved successfully!</span>
        </div>
      )}

      <form onSubmit={handleSave} className={styles.settingsGrid}>
        {/* Profile Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <User size={20} className={styles.cardIcon} />
            <div>
              <h3>Faculty Profile</h3>
              <p>Your institutional identification at Cebu Eastern College</p>
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.fieldGroup}>
              <label>Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={styles.input}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label>Email Address</label>
              <input
                type="email"
                value={user?.email || "teacher@cec.edu.ph"}
                disabled
                className={`${styles.input} ${styles.disabledInput}`}
              />
              <span className={styles.fieldHint}>Managed via Supabase Authentication</span>
            </div>

            <div className={styles.formRow}>
              <div className={styles.fieldGroup}>
                <label>Department</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label>Faculty ID Number</label>
                <input
                  type="text"
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                  className={styles.input}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Institutional Affiliation */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <School size={20} className={styles.cardIcon} />
            <div>
              <h3>Institutional Affiliation</h3>
              <p>Official school credentials</p>
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.institutionInfo}>
              <div className={styles.instLogo}>
                <School size={28} color="var(--orange-500)" />
              </div>
              <div>
                <h4>Cebu Eastern College</h4>
                <p>Leon Kilat St., Cebu City, 6000 Cebu, Philippines</p>
                <span className={styles.instBadge}>Verified Faculty Member</span>
              </div>
            </div>

            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Academic Year:</span>
              <span className={styles.infoVal}>2025 – 2026</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Current Term:</span>
              <span className={styles.infoVal}>2nd Semester / 3rd Quarter</span>
            </div>
          </div>
        </div>

        {/* Assessment & Optical Grading Defaults */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FileText size={20} className={styles.cardIcon} />
            <div>
              <h3>Assessment & Optical Grading Defaults</h3>
              <p>Configured for TSEKI mobile camera scanning</p>
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.fieldGroup}>
              <label>Default Bond Paper Size for Test Sheets</label>
              <div className={styles.radioGroup}>
                <label
                  className={`${styles.radioOption} ${
                    paperSize === "short" ? styles.radioSelected : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paperSize"
                    value="short"
                    checked={paperSize === "short"}
                    onChange={() => setPaperSize("short")}
                  />
                  <div>
                    <strong>Short Bond Paper (8.5" × 11")</strong>
                    <span>Standard Letter size format</span>
                  </div>
                </label>

                <label
                  className={`${styles.radioOption} ${
                    paperSize === "long" ? styles.radioSelected : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paperSize"
                    value="long"
                    checked={paperSize === "long"}
                    onChange={() => setPaperSize("long")}
                  />
                  <div>
                    <strong>Long Bond Paper (8.5" × 13")</strong>
                    <span>Philippine Folio legal format (extra question room)</span>
                  </div>
                </label>
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.fieldGroup}>
                <label>At-Risk Alert Threshold: {riskThreshold}%</label>
                <input
                  type="range"
                  min="40"
                  max="70"
                  step="5"
                  value={riskThreshold}
                  onChange={(e) => setRiskThreshold(Number(e.target.value))}
                  className={styles.rangeInput}
                />
                <span className={styles.fieldHint}>
                  Scores ≤{riskThreshold}% trigger high-risk pedagogical intervention alerts.
                </span>
              </div>

              <div className={styles.fieldGroup}>
                <label>Default Question Count</label>
                <select
                  value={defaultQuestionCount}
                  onChange={(e) => setDefaultQuestionCount(Number(e.target.value))}
                  className={styles.select}
                >
                  <option value={5}>5 Questions</option>
                  <option value={10}>10 Questions</option>
                  <option value={15}>15 Questions</option>
                  <option value={20}>20 Questions</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* AI Engine & Appearance */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Cpu size={20} className={styles.cardIcon} />
            <div>
              <h3>AI Engine & Appearance</h3>
              <p>Generative AI model & interface theme</p>
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.fieldGroup}>
              <label>Gemini Generative Engine</label>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className={styles.select}
              >
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Fastest, calibrated)</option>
                <option value="gemini-3.6-flash">gemini-3.6-flash (Deep Bloom's analysis)</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash (Standard fallback)</option>
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label>Theme Mode</label>
              <button
                type="button"
                className={styles.themeToggleBtn}
                onClick={toggleDarkMode}
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                <span>Current Mode: <strong>{darkMode ? "Dark Theme" : "Light Theme"}</strong></span>
              </button>
            </div>

            <div className={styles.versionBox}>
              <p>TSEKI Teacher Web Portal · Version 1.0.0</p>
              <span>Designed for Cebu Eastern College educators · Connected to Supabase Cloud</span>
            </div>
          </div>
        </div>

        {/* Save Bar */}
        <div className={styles.saveBar}>
          <button type="submit" className={styles.saveBtn}>
            <Save size={18} />
            Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
}
