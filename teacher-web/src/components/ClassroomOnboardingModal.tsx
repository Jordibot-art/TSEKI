import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  X,
  FileSpreadsheet,
  Upload,
  Download,
  UserPlus,
  ChevronRight,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  downloadExcelTemplate,
  formatStudentFullName,
  splitStudentFullName,
  normalizeStudentRecord,
  formatQuizColumnHeader,
} from "../lib/studentNameUtils";
import styles from "./ClassroomOnboardingModal.module.css";

export interface ClassroomOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  classroom: {
    id: string;
    title: string;
    subject?: string;
    section?: string;
    room?: string;
    schedule?: string;
    color?: string;
  } | null;
  onRosterUpdated?: () => void;
}

export function ClassroomOnboardingModal({
  isOpen,
  onClose,
  classroom,
  onRosterUpdated,
}: ClassroomOnboardingModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"MENU" | "MANUAL_ADD">("MENU");
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  // Manual Form
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");

  const [enrolledCount, setEnrolledCount] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  if (!isOpen || !classroom) return null;

  function handleReset() {
    setMode("MENU");
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setEmail("");
    setFeedback(null);
  }

  function handleModalClose() {
    handleReset();
    onClose();
  }

  // ── 1. Download BSIT-4 Excel Template ──────────────────────────────────────
  function handleDownloadTemplateClick() {
    setDownloadingTemplate(true);
    try {
      downloadExcelTemplate({
        classroomTitle: classroom?.title,
        subject: classroom?.subject,
        section: classroom?.section,
        room: classroom?.room,
        schedule: classroom?.schedule,
      });
      setFeedback({
        type: "success",
        message: "BSIT-4 template downloaded! Open in Excel to add your students.",
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", message: err.message || "Failed to download template." });
    } finally {
      setDownloadingTemplate(false);
    }
  }

  // ── 2. Import Excel Roster ────────────────────────────────────────────────
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !classroom) return;

    setImporting(true);
    setFeedback(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) {
          throw new Error("Spreadsheet contains insufficient rows.");
        }

        // Intelligently find header row
        const HEADER_KEYWORDS = [
          "last name",
          "student's name",
          "student name",
          "first name",
          "surname",
          "email",
          "item",
          "name",
        ];
        let headerRowIdx = 0;
        let bestScore = 0;

        for (let r = 0; r < Math.min(rows.length, 25); r++) {
          const rText = (rows[r] || []).map((c: any) => String(c || "").toLowerCase().trim());
          let score = 0;
          for (const kw of HEADER_KEYWORDS) {
            if (rText.some((t: string) => t.includes(kw))) score++;
          }
          if (score > bestScore) {
            bestScore = score;
            headerRowIdx = r;
          }
        }

        const headerRow = (rows[headerRowIdx] || []).map((c: any) =>
          String(c || "").toLowerCase().trim()
        );

        const lastIdx = headerRow.findIndex(
          (h: string) => h.includes("last") || h === "surname" || h === "family name"
        );
        const firstIdx = headerRow.findIndex(
          (h: string) => h.includes("first") || h === "given name"
        );
        const middleIdx = headerRow.findIndex(
          (h: string) => h.includes("middle") || h === "mi" || h === "m.i."
        );
        const emailIdx = headerRow.findIndex(
          (h: string) => h.includes("email") || h.includes("e-mail")
        );
        const fullNameIdx = headerRow.findIndex(
          (h: string) =>
            h.includes("student's name") ||
            h.includes("student name") ||
            h === "full name" ||
            h === "name"
        );

        const studentsToInsert: Array<{
          classroom_id: string;
          last_name: string | null;
          first_name: string | null;
          middle_name: string | null;
          full_name: string;
          email: string | null;
          attendance: number;
          average: number;
        }> = [];

        for (let r = headerRowIdx + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0) continue;

          let ln = "";
          let fn = "";
          let mn: string | null = null;
          let em: string | null = null;
          let computedFull = "";

          if (lastIdx !== -1 && firstIdx !== -1) {
            ln = String(row[lastIdx] || "").trim();
            fn = String(row[firstIdx] || "").trim();
            mn = middleIdx !== -1 ? String(row[middleIdx] || "").trim() || null : null;
            em = emailIdx !== -1 ? String(row[emailIdx] || "").trim() || null : null;
            if (!ln && !fn) continue;
            computedFull = formatStudentFullName({
              last_name: ln,
              first_name: fn,
              middle_name: mn,
            });
          } else {
            const rawCol = fullNameIdx !== -1 ? row[fullNameIdx] : row[1] || row[0];
            const rawName = String(rawCol || "").trim();
            if (!rawName || /^(total|subtotal|summary|item)/i.test(rawName)) continue;
            const parts = splitStudentFullName(rawName);
            ln = parts.lastName;
            fn = parts.firstName;
            mn = parts.middleName;
            em = emailIdx !== -1 ? String(row[emailIdx] || "").trim() || null : null;
            computedFull = formatStudentFullName({
              last_name: ln,
              first_name: fn,
              middle_name: mn,
              full_name: rawName,
            });
          }

          if (computedFull) {
            studentsToInsert.push({
              classroom_id: classroom.id,
              last_name: ln || null,
              first_name: fn || null,
              middle_name: mn || null,
              full_name: computedFull,
              email: em,
              attendance: 100,
              average: 0,
            });
          }
        }

        if (studentsToInsert.length === 0) {
          throw new Error("No student rows could be detected in this file.");
        }

        // Insert into Supabase
        let { data, error } = await supabase.from("students").insert(studentsToInsert).select();
        if (
          error &&
          (error.code === "PGRST204" ||
            error.message?.includes("last_name") ||
            error.message?.includes("first_name"))
        ) {
          const fallback = studentsToInsert.map((s) => ({
            classroom_id: s.classroom_id,
            full_name: s.full_name,
            email: s.email,
            attendance: 100,
            average: 0,
          }));
          const retry = await supabase.from("students").insert(fallback).select();
          data = retry.data;
          error = retry.error;
        }

        if (error) throw error;

        const count = data?.length || studentsToInsert.length;
        setEnrolledCount((prev) => prev + count);
        setFeedback({
          type: "success",
          message: `Successfully imported ${count} students into "${classroom.title}"!`,
        });
        onRosterUpdated?.();
      } catch (err: any) {
        console.error(err);
        setFeedback({ type: "error", message: err.message || "Failed to import students." });
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── 3. Export Excel Roster & Scores (BSIT-4 Layout) ────────────────────────
  async function handleExportExcelClick() {
    if (!classroom) return;
    setExporting(true);
    setFeedback(null);
    try {
      const { data: studs } = await supabase
        .from("students")
        .select("*")
        .eq("classroom_id", classroom.id);

      const normalizedStudents = (studs || []).map((s) => normalizeStudentRecord(s));

      const { data: qz } = await supabase
        .from("archived_assessments")
        .select("id, quiz_title, total_points")
        .eq("classroom_id", classroom.id);

      const { data: qResults } = await supabase
        .from("student_quiz_results")
        .select("student_id, quiz_title, total_score, score_percentage, max_score")
        .eq("classroom_id", classroom.id);

      const quizList = (qz || []).map((q: any) => ({
        id: q.id,
        quizTitle: q.quiz_title || "Quiz",
        maxScore: q.total_points || 10,
      }));

      const quizHeaders = quizList.map((q, idx) =>
        formatQuizColumnHeader(q.quizTitle, idx, q.maxScore)
      );

      const formattedDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const rows: any[][] = [
        ["TSEKI - CLASS ROSTER & PERFORMANCE RECORD"],
        ["Classroom:", classroom.title, "", "Subject:", classroom.subject || "N/A"],
        ["Section:", classroom.section || "N/A", "", "Room:", classroom.room || "N/A"],
        ["Schedule:", classroom.schedule || "N/A", "", "Teacher:", "N/A"],
        ["Export Date:", formattedDate, "", "Total Enrolled:", normalizedStudents.length],
        [], // Blank separator row
        ["Item", "Last Name", "First Name", "Middle Name", "Email Address", ...quizHeaders, "Average Scores"],
      ];

      normalizedStudents.forEach((s, idx) => {
        let sumEarned = 0;
        let sumMax = 0;
        let count = 0;

        const quizCells = quizList.map((q) => {
          const match = (qResults || []).find(
            (r: any) =>
              r.student_id === s.id &&
              (r.quiz_title || "").toLowerCase().trim() === q.quizTitle.toLowerCase().trim()
          );
          if (match !== undefined && typeof match.total_score === "number") {
            sumEarned += match.total_score;
            sumMax += q.maxScore || 100;
            count++;
            return match.total_score;
          }
          return "";
        });

        let avgDisplay = "0%";
        if (typeof s.average === "number" && !isNaN(s.average)) {
          avgDisplay = `${Math.round(s.average)}%`;
        } else if (count > 0 && sumMax > 0) {
          avgDisplay = `${Math.round((sumEarned / sumMax) * 100)}%`;
        }

        rows.push([
          idx + 1,
          s.last_name || "",
          s.first_name || "",
          s.middle_name || "",
          s.email || "N/A",
          ...quizCells,
          avgDisplay,
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
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

      const cleanTitle = classroom.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      XLSX.writeFile(wb, `${cleanTitle}_Roster_Scores.xlsx`);

      setFeedback({
        type: "success",
        message: `Exported gradebook for "${classroom.title}"!`,
      });
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", message: err.message || "Failed to export Excel." });
    } finally {
      setExporting(false);
    }
  }

  // ── 4. Manually Add Student ───────────────────────────────────────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!classroom) return;

    const cleanLast = lastName.trim();
    const cleanFirst = firstName.trim();
    const cleanMiddle = middleName.trim() || null;
    const cleanEmail = email.trim() || null;

    if (!cleanLast || !cleanFirst) {
      setFeedback({ type: "error", message: "Please enter both Last Name and First Name." });
      return;
    }

    setSavingManual(true);
    setFeedback(null);

    try {
      const computedFull = formatStudentFullName({
        last_name: cleanLast,
        first_name: cleanFirst,
        middle_name: cleanMiddle,
      });

      let { error } = await supabase
        .from("students")
        .insert({
          classroom_id: classroom.id,
          last_name: cleanLast,
          first_name: cleanFirst,
          middle_name: cleanMiddle,
          full_name: computedFull,
          email: cleanEmail,
          attendance: 100,
          average: 0,
        })
        .select()
        .single();

      if (
        error &&
        (error.code === "PGRST204" ||
          error.message?.includes("last_name") ||
          error.message?.includes("first_name"))
      ) {
        const retry = await supabase
          .from("students")
          .insert({
            classroom_id: classroom.id,
            full_name: computedFull,
            email: cleanEmail,
            attendance: 100,
            average: 0,
          })
          .select()
          .single();
        error = retry.error;
      }

      if (error) throw error;

      setEnrolledCount((prev) => prev + 1);
      setLastName("");
      setFirstName("");
      setMiddleName("");
      setEmail("");
      setFeedback({
        type: "success",
        message: `Student "${computedFull}" added to ${classroom.title}! Add another or click Enter Classroom.`,
      });
      onRosterUpdated?.();
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", message: err.message || "Failed to add student." });
    } finally {
      setSavingManual(false);
    }
  }

  return createPortal(
    <div className={styles.modalOverlay} onClick={handleModalClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Hidden file input for Excel Import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
        />

        {/* Modal Header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.badgeRow}>
              <span className={styles.tagPill} style={{ background: classroom.color || "#ff6b00" }}>
                CLASSROOM CREATED
              </span>
              {enrolledCount > 0 && (
                <span className={styles.countPill}>{enrolledCount} enrolled</span>
              )}
            </div>
            <h2 className={styles.modalTitle}>{classroom.title}</h2>
            <p className={styles.modalSubtitle}>
              {classroom.subject ? `${classroom.subject} • ` : ""}
              {classroom.section || "Manage Student Roster"}
            </p>
          </div>
          <button className={styles.modalClose} onClick={handleModalClose}>
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {feedback && (
            <div
              className={`${styles.feedbackBanner} ${
                feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError
              }`}
            >
              {feedback.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{feedback.message}</span>
            </div>
          )}

          {mode === "MENU" ? (
            <>
              <p className={styles.sectionPrompt}>
                How would you like to set up your student roster?
              </p>

              {/* Action 1: Download Excel Template */}
              <button
                type="button"
                className={styles.actionTile}
                onClick={handleDownloadTemplateClick}
                disabled={downloadingTemplate}
              >
                <div className={styles.actionIconBox} style={{ background: "rgba(59, 130, 246, 0.15)" }}>
                  {downloadingTemplate ? (
                    <Loader2 size={22} className="spinner" style={{ color: "#3B82F6" }} />
                  ) : (
                    <FileSpreadsheet size={22} style={{ color: "#3B82F6" }} />
                  )}
                </div>
                <div className={styles.actionText}>
                  <div className={styles.actionTitle}>Download Excel Template</div>
                  <div className={styles.actionSub}>
                    Pre-formatted BSIT-4 layout (Item, Last Name, First Name, Middle Name, Email Address)
                  </div>
                </div>
                <ChevronRight size={18} className={styles.actionChevron} />
              </button>

              {/* Action 2: Import Excel */}
              <button
                type="button"
                className={styles.actionTile}
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                <div className={styles.actionIconBox} style={{ background: "rgba(16, 185, 129, 0.15)" }}>
                  {importing ? (
                    <Loader2 size={22} className="spinner" style={{ color: "#10B981" }} />
                  ) : (
                    <Upload size={22} style={{ color: "#10B981" }} />
                  )}
                </div>
                <div className={styles.actionText}>
                  <div className={styles.actionTitle}>Import Excel Roster</div>
                  <div className={styles.actionSub}>
                    Bulk add/update students from template or existing classlist (.xlsx, .csv)
                  </div>
                </div>
                <ChevronRight size={18} className={styles.actionChevron} />
              </button>

              {/* Action 3: Export Excel */}
              <button
                type="button"
                className={styles.actionTile}
                onClick={handleExportExcelClick}
                disabled={exporting}
              >
                <div className={styles.actionIconBox} style={{ background: "rgba(139, 92, 246, 0.15)" }}>
                  {exporting ? (
                    <Loader2 size={22} className="spinner" style={{ color: "#8B5CF6" }} />
                  ) : (
                    <Download size={22} style={{ color: "#8B5CF6" }} />
                  )}
                </div>
                <div className={styles.actionText}>
                  <div className={styles.actionTitle}>Export Excel</div>
                  <div className={styles.actionSub}>
                    Download current student roster and quiz scores record
                  </div>
                </div>
                <ChevronRight size={18} className={styles.actionChevron} />
              </button>

              {/* Action 4: Manually Add Student */}
              <button
                type="button"
                className={styles.actionTile}
                onClick={() => {
                  setFeedback(null);
                  setMode("MANUAL_ADD");
                }}
              >
                <div className={styles.actionIconBox} style={{ background: "rgba(255, 107, 0, 0.15)" }}>
                  <UserPlus size={22} style={{ color: "#ff6b00" }} />
                </div>
                <div className={styles.actionText}>
                  <div className={styles.actionTitle}>Manually Add Student</div>
                  <div className={styles.actionSub}>
                    Form input for Last Name, First Name, Middle Name, and Email Address
                  </div>
                </div>
                <ChevronRight size={18} className={styles.actionChevron} />
              </button>
            </>
          ) : (
            /* Manual Student Entry Form */
            <form onSubmit={handleManualSubmit}>
              <div className={styles.formHeaderRow}>
                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={() => setMode("MENU")}
                >
                  <ArrowLeft size={16} /> All Actions
                </button>
                <span className={styles.formTitle}>Manual Student Entry</span>
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label>Last Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Abellanosa"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label>First Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Reymark"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label>Middle Name / Initial (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. B."
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label>Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. student@school.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className={styles.saveStudentBtn}
                disabled={savingManual || !lastName.trim() || !firstName.trim()}
              >
                {savingManual ? <Loader2 size={16} className="spinner" /> : <CheckCircle size={16} />}
                Save Student to Roster
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.enterBtn}
            onClick={() => {
              handleModalClose();
              navigate(`/classrooms/${classroom.id}`);
            }}
          >
            Enter Classroom <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}