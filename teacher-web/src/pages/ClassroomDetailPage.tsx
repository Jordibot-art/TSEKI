import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  Users,
  Plus,
  Search,
  X,
  Loader2,
  User,
  Mail,
  Trash2,
  TrendingUp,
  TrendingDown,
  FileText,
  Clock,
  BarChart3,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import styles from "./ClassroomDetailPage.module.css";

type Student = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
};

type Quiz = {
  id: string;
  quiz_title: string;
  subject: string;
  status: string;
  created_at: string;
  questions: any[];
};

type ClassroomInfo = {
  id: string;
  title: string;
  subject: string;
  section: string;
  room: string;
  schedule: string;
  color: string;
};

export default function ClassroomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [activeTab, setActiveTab] = useState<"roster" | "quizzes">("roster");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentEmail, setNewStudentEmail] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Excel import/export state
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportPreview, setBulkImportPreview] = useState<{ name: string; email: string }[]>([]);
  const [bulkImportFileName, setBulkImportFileName] = useState("");
  const [bulkImportResult, setBulkImportResult] = useState<{ success: number; failed: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user && id) loadData();
  }, [user, id]);

  async function loadData() {
    try {
      const { data: cls } = await supabase
        .from("classrooms")
        .select("*")
        .eq("id", id)
        .single();

      if (cls) {
        let section = cls.section || "";
        let schedule = cls.schedule || "";
        if (section.includes(" || ")) {
          const parts = section.split(" || ");
          section = parts[0] || "";
          schedule = parts[1] || "";
        }
        setClassroom({
          ...cls,
          section,
          schedule,
          color: cls.color || "#FF6B00",
        });
      }

      const { data: studs } = await supabase
        .from("students")
        .select("*")
        .eq("classroom_id", id)
        .order("full_name", { ascending: true });

      setStudents(studs || []);

      const { data: qz } = await supabase
        .from("archived_assessments")
        .select("*")
        .eq("classroom_id", id)
        .order("created_at", { ascending: false });

      setQuizzes(qz || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!newStudentName.trim()) return;
    setSaving(true);

    try {
      await supabase.from("students").insert({
        classroom_id: id,
        full_name: newStudentName.trim(),
        email: newStudentEmail.trim() || null,
        average: 0,
      });
      setShowAddModal(false);
      setNewStudentName("");
      setNewStudentEmail("");
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStudent(studentId: string) {
    if (!confirm("Remove this student from the roster?")) return;
    await supabase.from("students").delete().eq("id", studentId);
    await loadData();
    setSelectedStudent(null);
  }

  /* ── Excel Export ── */
  function exportToExcel() {
    setExporting(true);
    try {
      // Sheet 1: Student Roster with Scores
      const rosterData = [
        ["#", "Student Name", "Email", "Average Score (%)", "Status"],
        ...students.map((s, i) => [
          i + 1,
          s.full_name,
          s.email || "",
          s.average > 0 ? Number(s.average.toFixed(1)) : 0,
          s.average > 50 ? "On Track" : s.average > 0 ? "At Risk" : "No Data",
        ]),
      ];
      const rosterSheet = XLSX.utils.aoa_to_sheet(rosterData);
      // Set column widths
      rosterSheet["!cols"] = [
        { wch: 5 }, { wch: 30 }, { wch: 28 }, { wch: 18 }, { wch: 12 },
      ];

      // Sheet 2: Class Analytics Summary
      const passCount = students.filter((s) => s.average >= 50).length;
      const failCount = students.filter((s) => s.average > 0 && s.average < 50).length;
      const noDataCount = students.filter((s) => s.average === 0).length;
      const highest = students.length ? Math.max(...students.map((s) => s.average)) : 0;
      const lowest = students.length
        ? Math.min(...students.filter((s) => s.average > 0).map((s) => s.average))
        : 0;

      const analyticsData = [
        ["Class Analytics — " + (classroom?.title || "")],
        [],
        ["Metric", "Value"],
        ["Total Students", students.length],
        ["Class Average", classAverage > 0 ? Number(classAverage.toFixed(1)) + "%" : "—"],
        ["Highest Score", highest > 0 ? highest.toFixed(1) + "%" : "—"],
        ["Lowest Score", lowest > 0 ? lowest.toFixed(1) + "%" : "—"],
        ["On Track (≥50%)", passCount],
        ["At Risk (<50%)", failCount],
        ["No Data", noDataCount],
        [],
        ["Total Assessments", quizzes.length],
      ];
      const analyticsSheet = XLSX.utils.aoa_to_sheet(analyticsData);
      analyticsSheet["!cols"] = [{ wch: 20 }, { wch: 18 }];

      // Sheet 3: Assessment List
      const assessmentData = [
        ["Assessment Title", "Subject", "Status", "Questions", "Date Created"],
        ...quizzes.map((q) => [
          q.quiz_title,
          q.subject || "General",
          q.status,
          q.questions?.length || 0,
          new Date(q.created_at).toLocaleDateString(),
        ]),
      ];
      const assessmentSheet = XLSX.utils.aoa_to_sheet(assessmentData);
      assessmentSheet["!cols"] = [
        { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, rosterSheet, "Student Scores");
      XLSX.utils.book_append_sheet(wb, analyticsSheet, "Class Analytics");
      XLSX.utils.book_append_sheet(wb, assessmentSheet, "Assessments");

      const cleanTitle = (classroom?.title || "classroom").trim().replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const fileName = `${cleanTitle}_report.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("Export error", err);
    } finally {
      setExporting(false);
    }
  }

  /* ── Excel Bulk Import ── */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkImportFileName(file.name);
    setBulkImportResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const preview: { name: string; email: string }[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const name = String(row[0] || "").trim();
          const email = String(row[1] || "").trim();
          if (name) {
            preview.push({ name, email });
          }
        }
        setBulkImportPreview(preview);
      } catch (err) {
        console.error("Parse error", err);
        setBulkImportPreview([]);
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleBulkImport() {
    if (bulkImportPreview.length === 0) return;
    setBulkImporting(true);
    let success = 0;
    let failed = 0;

    try {
      const inserts = bulkImportPreview.map((s) => ({
        classroom_id: id,
        full_name: s.name,
        email: s.email || null,
        average: 0,
      }));

      const { error } = await supabase.from("students").insert(inserts);
      if (error) {
        console.error("Bulk insert error", error);
        failed = inserts.length;
      } else {
        success = inserts.length;
      }

      setBulkImportResult({ success, failed });
      if (success > 0) await loadData();
    } catch (err) {
      console.error(err);
      failed = bulkImportPreview.length;
      setBulkImportResult({ success, failed });
    } finally {
      setBulkImporting(false);
    }
  }

  function closeBulkImportModal() {
    setShowBulkImportModal(false);
    setBulkImportPreview([]);
    setBulkImportFileName("");
    setBulkImportResult(null);
  }

  function downloadTemplate() {
    const templateData = [
      ["Full Name", "Email (optional)"],
      ["Juan Dela Cruz", "juan@email.com"],
      ["Maria Santos", "maria@email.com"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws["!cols"] = [{ wch: 28 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "student_import_template.xlsx");
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  function getAvatarColor(name: string) {
    const colors = ["#FF6B00", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function getScoreColor(avg: number) {
    if (avg >= 80) return "var(--emerald-500)";
    if (avg >= 60) return "var(--amber-500)";
    if (avg > 0) return "var(--red-500)";
    return "var(--text-tertiary)";
  }

  const filteredStudents = students.filter((s) =>
    s.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const classAverage = students.length
    ? students.reduce((acc, s) => acc + (s.average || 0), 0) / students.length
    : 0;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={`skeleton`} style={{ height: 24, width: 120 }} />
        <div className={`skeleton`} style={{ height: 40, width: 280, marginTop: 12 }} />
        <div className={`skeleton`} style={{ height: 200, marginTop: 28, borderRadius: 14 }} />
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className={styles.page}>
        <p>Classroom not found.</p>
        <button onClick={() => navigate("/classrooms")}>Back to Classrooms</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <button className={styles.backBtn} onClick={() => navigate("/classrooms")}>
        <ArrowLeft size={18} />
        Back to Classrooms
      </button>

      <div className={styles.hero}>
        <div
          className={styles.heroAccent}
          style={{ background: classroom.color }}
        />
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>{classroom.title}</h1>
          <p className={styles.heroMeta}>
            {classroom.subject}
            {classroom.section ? ` · ${classroom.section}` : ""}
            {classroom.room ? ` · ${classroom.room}` : ""}
          </p>
          {classroom.schedule && (
            <p className={styles.heroSchedule}>
              <Clock size={14} />
              {classroom.schedule}
            </p>
          )}
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatValue}>{students.length}</span>
            <span className={styles.heroStatLabel}>Students</span>
          </div>
          <div className={styles.heroStatDivider} />
          <div className={styles.heroStat}>
            <span className={styles.heroStatValue}>{quizzes.length}</span>
            <span className={styles.heroStatLabel}>Quizzes</span>
          </div>
          <div className={styles.heroStatDivider} />
          <div className={styles.heroStat}>
            <span
              className={styles.heroStatValue}
              style={{ color: getScoreColor(classAverage) }}
            >
              {classAverage > 0 ? `${classAverage.toFixed(1)}%` : "—"}
            </span>
            <span className={styles.heroStatLabel}>Class Avg</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "roster" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("roster")}
        >
          <Users size={16} />
          Student Roster
          <span className={styles.tabCount}>{students.length}</span>
        </button>
        <button
          className={`${styles.tab} ${activeTab === "quizzes" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("quizzes")}
        >
          <FileText size={16} />
          Assessments
          <span className={styles.tabCount}>{quizzes.length}</span>
        </button>
      </div>

      {/* Roster Tab */}
      {activeTab === "roster" && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.searchBar}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search students..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <div className={styles.headerActions}>
              <button
                className={styles.excelBtn}
                onClick={exportToExcel}
                disabled={exporting || students.length === 0}
                title="Export student scores & analytics to Excel"
              >
                <Download size={15} />
                {exporting ? "Exporting…" : "Export"}
              </button>
              <button
                className={styles.excelBtnImport}
                onClick={() => setShowBulkImportModal(true)}
                title="Bulk import students from Excel"
              >
                <UploadCloud size={15} />
                Import
              </button>
              <button className={styles.addBtn} onClick={() => setShowAddModal(true)}>
                <Plus size={16} />
                Add Student
              </button>
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <div className={styles.emptyState}>
              <Users size={44} strokeWidth={1.2} />
              <h3>{searchQuery ? "No students match" : "No students yet"}</h3>
              <p>Add students to this classroom's roster</p>
            </div>
          ) : (
            <div className={styles.rosterTable}>
              <div className={styles.tableHeader}>
                <span style={{ flex: 1 }}>Student</span>
                <span style={{ width: 200 }}>Email</span>
                <span style={{ width: 100, textAlign: "center" }}>Average</span>
                <span style={{ width: 80, textAlign: "center" }}>Status</span>
              </div>
              {filteredStudents.map((student, idx) => (
                <div
                  key={student.id}
                  className={styles.tableRow}
                  style={{ animationDelay: `${idx * 30}ms` }}
                  onClick={() => setSelectedStudent(student)}
                >
                  <div className={styles.studentCell}>
                    <div
                      className={styles.studentAvatar}
                      style={{ background: getAvatarColor(student.full_name) }}
                    >
                      {getInitials(student.full_name)}
                    </div>
                    <span className={styles.studentName}>{student.full_name}</span>
                  </div>
                  <span className={styles.studentEmail}>
                    {student.email || "—"}
                  </span>
                  <span
                    className={styles.studentAvg}
                    style={{ color: getScoreColor(student.average) }}
                  >
                    {student.average > 0 ? `${student.average.toFixed(1)}%` : "—"}
                  </span>
                  <span className={styles.studentStatus}>
                    {student.average > 50 ? (
                      <span className={styles.statusGood}>
                        <TrendingUp size={13} />
                        OK
                      </span>
                    ) : student.average > 0 ? (
                      <span className={styles.statusRisk}>
                        <TrendingDown size={13} />
                        Risk
                      </span>
                    ) : (
                      <span className={styles.statusNone}>—</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quizzes Tab */}
      {activeTab === "quizzes" && (
        <div className={styles.section}>
          {quizzes.length === 0 ? (
            <div className={styles.emptyState}>
              <FileText size={44} strokeWidth={1.2} />
              <h3>No assessments yet</h3>
              <p>Generate assessments from the TSEKI mobile app</p>
            </div>
          ) : (
            <div className={styles.quizGrid}>
              {quizzes.map((quiz, idx) => (
                <div
                  key={quiz.id}
                  className={styles.quizCard}
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className={styles.quizCardHeader}>
                    <FileText size={20} className={styles.quizCardIcon} />
                    <span
                      className={`${styles.quizBadge} ${
                        quiz.status === "PUBLISHED"
                          ? styles.quizPublished
                          : styles.quizDraft
                      }`}
                    >
                      {quiz.status}
                    </span>
                  </div>
                  <h4 className={styles.quizCardTitle}>{quiz.quiz_title}</h4>
                  <p className={styles.quizCardMeta}>
                    {quiz.subject || "General"} ·{" "}
                    {quiz.questions?.length || 0} questions
                  </p>
                  <p className={styles.quizCardDate}>
                    <Clock size={12} />
                    {new Date(quiz.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Student Modal */}
      {showAddModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Add Student</h2>
              <button className={styles.modalClose} onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddStudent}>
              <div className={styles.modalBody}>
                <div className={styles.fieldGroup}>
                  <label>
                    <User size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    Full Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Juan Dela Cruz"
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    className={styles.input}
                    autoFocus
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label>
                    <Mail size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    Email (optional)
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. student@email.com"
                    value={newStudentEmail}
                    onChange={(e) => setNewStudentEmail(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={saving || !newStudentName.trim()}
                >
                  {saving ? <Loader2 size={16} className={styles.spinner} /> : null}
                  Add Student
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Student Detail Modal */}
      {selectedStudent && createPortal(
        <div className={styles.modalOverlay} onClick={() => setSelectedStudent(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Student Profile</h2>
              <button className={styles.modalClose} onClick={() => setSelectedStudent(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.profileHeader}>
                <div
                  className={styles.profileAvatar}
                  style={{ background: getAvatarColor(selectedStudent.full_name) }}
                >
                  {getInitials(selectedStudent.full_name)}
                </div>
                <div>
                  <h3 className={styles.profileName}>{selectedStudent.full_name}</h3>
                  <p className={styles.profileEmail}>
                    {selectedStudent.email || "No email provided"}
                  </p>
                </div>
              </div>
              <div className={styles.profileStats}>
                <div className={styles.profileStat}>
                  <BarChart3 size={18} />
                  <div>
                    <span className={styles.profileStatValue}>
                      {selectedStudent.average > 0
                        ? `${selectedStudent.average.toFixed(1)}%`
                        : "—"}
                    </span>
                    <span className={styles.profileStatLabel}>Average Score</span>
                  </div>
                </div>
                <div className={styles.profileStat}>
                  <TrendingUp size={18} />
                  <div>
                    <span className={styles.profileStatValue}>
                      {selectedStudent.average > 50 ? "On Track" : selectedStudent.average > 0 ? "At Risk" : "No Data"}
                    </span>
                    <span className={styles.profileStatLabel}>Performance</span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.deleteBtn}
                onClick={() => handleDeleteStudent(selectedStudent.id)}
              >
                <Trash2 size={14} />
                Remove Student
              </button>
              <button
                className={styles.cancelBtn}
                onClick={() => setSelectedStudent(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Bulk Import Modal */}
      {showBulkImportModal && createPortal(
        <div className={styles.modalOverlay} onClick={closeBulkImportModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className={styles.modalHeader}>
              <h2>Bulk Import Students</h2>
              <button className={styles.modalClose} onClick={closeBulkImportModal}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalBody}>
              {/* Upload area */}
              {bulkImportPreview.length === 0 && !bulkImportResult && (
                <>
                  <div className={styles.uploadZone}>
                    <UploadCloud size={36} strokeWidth={1.4} />
                    <p className={styles.uploadText}>
                      Drop an Excel file or <strong>click to browse</strong>
                    </p>
                    <p className={styles.uploadHint}>
                      File should have columns: <strong>Full Name</strong>, <strong>Email</strong> (optional)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileSelect}
                      className={styles.uploadInput}
                    />
                  </div>
                  <button className={styles.templateBtn} onClick={downloadTemplate}>
                    <Download size={14} />
                    Download Template
                  </button>
                </>
              )}

              {/* Preview */}
              {bulkImportPreview.length > 0 && !bulkImportResult && (
                <>
                  <div className={styles.importFileInfo}>
                    <FileText size={16} />
                    <span>{bulkImportFileName}</span>
                    <span className={styles.importCount}>{bulkImportPreview.length} students found</span>
                  </div>
                  <div className={styles.importPreviewList}>
                    {bulkImportPreview.slice(0, 10).map((s, i) => (
                      <div key={i} className={styles.importPreviewRow}>
                        <span className={styles.importPreviewName}>{s.name}</span>
                        <span className={styles.importPreviewEmail}>{s.email || "—"}</span>
                      </div>
                    ))}
                    {bulkImportPreview.length > 10 && (
                      <p className={styles.importPreviewMore}>
                        …and {bulkImportPreview.length - 10} more students
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Result */}
              {bulkImportResult && (
                <div className={styles.importResult}>
                  {bulkImportResult.success > 0 ? (
                    <>
                      <CheckCircle2 size={40} className={styles.importResultSuccess} />
                      <h3>{bulkImportResult.success} students imported successfully!</h3>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={40} className={styles.importResultError} />
                      <h3>Import failed</h3>
                      <p>{bulkImportResult.failed} students could not be imported.</p>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              {bulkImportResult ? (
                <button className={styles.saveBtn} onClick={closeBulkImportModal}>
                  Done
                </button>
              ) : (
                <>
                  <button className={styles.cancelBtn} onClick={closeBulkImportModal}>
                    Cancel
                  </button>
                  {bulkImportPreview.length > 0 && (
                    <button
                      className={styles.saveBtn}
                      onClick={handleBulkImport}
                      disabled={bulkImporting}
                    >
                      {bulkImporting ? <Loader2 size={16} className={styles.spinner} /> : null}
                      Import {bulkImportPreview.length} Students
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
