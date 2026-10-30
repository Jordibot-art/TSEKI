import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
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
            <button className={styles.addBtn} onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              Add Student
            </button>
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
    </div>
  );
}
