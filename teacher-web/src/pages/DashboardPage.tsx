import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  GraduationCap,
  Users,
  FileText,
  AlertTriangle,
  TrendingUp,
  Clock,
  Plus,
  ArrowRight,
  BookOpen,
  Sparkles,
} from "lucide-react";
import styles from "./DashboardPage.module.css";

type ClassroomSummary = {
  id: string;
  title: string;
  subject: string;
  section: string;
  color: string;
  studentCount: number;
  quizCount: number;
};

type DashboardStats = {
  totalClassrooms: number;
  totalStudents: number;
  totalQuizzes: number;
  atRiskStudents: number;
};

const CARD_COLORS = ["#FF6B00", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"];

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalClassrooms: 0,
    totalStudents: 0,
    totalQuizzes: 0,
    atRiskStudents: 0,
  });
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [recentQuizzes, setRecentQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const teacherName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.username ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Teacher";

  useEffect(() => {
    if (user) loadDashboard();
  }, [user]);

  async function loadDashboard() {
    try {
      // Fetch classrooms from Supabase
      const { data: cls } = await supabase
        .from("classrooms")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: false });

      const classroomData = cls || [];
      const classroomIds = classroomData.map((c: any) => c.id);

      let studentCount = 0;
      let atRisk = 0;
      let quizCount = 0;
      const summaries: ClassroomSummary[] = [];

      if (classroomIds.length > 0) {
        // Fetch students
        const { data: students } = await supabase
          .from("students")
          .select("id, classroom_id, average")
          .in("classroom_id", classroomIds);

        const studentsByClass: Record<string, number> = {};
        (students || []).forEach((s: any) => {
          studentsByClass[s.classroom_id] = (studentsByClass[s.classroom_id] || 0) + 1;
          // Flagged only if they have taken a quiz with score > 0 and <= 50%
          if (s.average !== null && s.average !== undefined && s.average > 0 && s.average <= 50) {
            atRisk++;
          }
        });
        studentCount = (students || []).length;

        // Fetch assessments from archived_assessments (matching TSEKI mobile app)
        const { data: quizzes } = await supabase
          .from("archived_assessments")
          .select("id, classroom_id, quiz_title, subject, status, created_at")
          .or(`classroom_id.in.(${classroomIds.join(",")}),teacher_id.eq.${user!.id}`)
          .order("created_at", { ascending: false });

        const quizzesByClass: Record<string, number> = {};
        (quizzes || []).forEach((q: any) => {
          if (q.classroom_id) {
            quizzesByClass[q.classroom_id] = (quizzesByClass[q.classroom_id] || 0) + 1;
          }
        });
        quizCount = (quizzes || []).length;

        setRecentQuizzes((quizzes || []).slice(0, 5));

        classroomData.forEach((c: any, i: number) => {
          let section = c.section || "";
          let schedule = c.schedule || "";
          if (section.includes(" || ")) {
            const parts = section.split(" || ");
            section = parts[0] || "";
            schedule = parts[1] || "";
          }

          summaries.push({
            id: c.id,
            title: c.title || "Untitled Classroom",
            subject: c.subject || "General Education",
            section: section ? `${section}${schedule ? ` · ${schedule}` : ""}` : schedule,
            color: c.color || CARD_COLORS[i % CARD_COLORS.length],
            studentCount: studentsByClass[c.id] || 0,
            quizCount: quizzesByClass[c.id] || 0,
          });
        });
      }

      setClassrooms(summaries);
      setStats({
        totalClassrooms: classroomData.length,
        totalStudents: studentCount,
        totalQuizzes: quizCount,
        atRiskStudents: atRisk,
      });
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  const STAT_CARDS = [
    {
      label: "Classrooms",
      value: stats.totalClassrooms,
      icon: GraduationCap,
      isAtRisk: false,
    },
    {
      label: "Students",
      value: stats.totalStudents,
      icon: Users,
      isAtRisk: false,
    },
    {
      label: "Assessments",
      value: stats.totalQuizzes,
      icon: FileText,
      isAtRisk: false,
    },
    {
      label: "At-Risk Students",
      value: stats.atRiskStudents,
      icon: AlertTriangle,
      isAtRisk: true,
    },
  ];

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.greeting}>
          <div className={`skeleton ${styles.skeletonTitle}`} />
          <div className={`skeleton ${styles.skeletonSub}`} />
        </div>
        <div className={styles.statsGrid}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`skeleton ${styles.skeletonCard}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <div className={styles.greeting}>
        <div>
          <div className={styles.dateLabel}>
            Academic Year 2026 · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
          <h1 className={styles.greetingTitle}>
            {getGreeting()}, {teacherName}
          </h1>
          <p className={styles.greetingSub}>
            Here's an overview of your teaching activity
          </p>
        </div>
        <button
          className={styles.quickAction}
          onClick={() => navigate("/classrooms")}
        >
          <Plus size={16} />
          <span>New Classroom</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        {STAT_CARDS.map(({ label, value, icon: Icon, isAtRisk }) => {
          const hasRisk = isAtRisk && value > 0;
          return (
            <div key={label} className={styles.statCard}>
              <div className={styles.statTopRow}>
                <span className={styles.statLabel}>{label}</span>
                <Icon size={16} className={hasRisk ? styles.statIconAlert : styles.statIconMuted} />
              </div>
              <div
                className={`${styles.statValue} tabular-nums ${
                  hasRisk ? styles.statValueAlert : ""
                }`}
              >
                {value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Content Grid */}
      <div className={styles.contentGrid}>
        {/* Recent Classrooms */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>
              <GraduationCap size={16} className={styles.panelIcon} />
              Your Classrooms
            </h3>
            <button
              className={styles.viewAll}
              onClick={() => navigate("/classrooms")}
            >
              View All <ArrowRight size={13} />
            </button>
          </div>
          <div className={styles.cardBody}>
            {classrooms.length === 0 ? (
              <div className={styles.emptyState}>
                <BookOpen size={36} strokeWidth={1.2} />
                <p>No classrooms yet</p>
                <span>Create your first classroom to get started</span>
              </div>
            ) : (
              <div className={styles.classroomList}>
                {classrooms.slice(0, 5).map((cls, idx) => (
                  <div
                    key={cls.id}
                    className={styles.classroomRow}
                    style={{ animationDelay: `${idx * 50}ms` }}
                    onClick={() => navigate(`/classrooms/${cls.id}`)}
                  >
                    <div
                      className={styles.classroomDot}
                      style={{ background: cls.color }}
                    />
                    <div className={styles.classroomInfo}>
                      <span className={styles.classroomName}>{cls.title}</span>
                      <span className={styles.classroomMeta}>
                        {cls.subject}
                        {cls.section ? ` · ${cls.section}` : ""}
                      </span>
                    </div>
                    <div className={`${styles.classroomStats} tabular-nums`}>
                      <span>{cls.studentCount} students</span>
                      <span>{cls.quizCount} quizzes</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Assessments */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3>
              <Sparkles size={16} className={styles.panelIcon} />
              Recent Assessments
            </h3>
            <button
              className={styles.viewAll}
              onClick={() => navigate("/assessments")}
            >
              View All <ArrowRight size={13} />
            </button>
          </div>
          <div className={styles.cardBody}>
            {recentQuizzes.length === 0 ? (
              <div className={styles.emptyState}>
                <FileText size={36} strokeWidth={1.2} />
                <p>No assessments yet</p>
                <span>Generate quizzes from the mobile app</span>
              </div>
            ) : (
              <div className={styles.quizList}>
                {recentQuizzes.map((q: any, idx: number) => (
                  <div
                    key={q.id}
                    className={styles.quizRow}
                    style={{ animationDelay: `${idx * 50}ms`, cursor: "pointer" }}
                    onClick={() => navigate("/assessments")}
                  >
                    <div className={styles.quizInfo}>
                      <span className={styles.quizName}>{q.quiz_title}</span>
                      <div className={styles.quizMeta}>
                        <span className={styles.subjectBadge}>
                          {q.subject || "General"}
                        </span>
                        {q.status && (
                          <span
                            className={`${styles.statusBadge} ${
                              q.status === "PUBLISHED" || q.status === "ARCHIVE"
                                ? styles.published
                                : styles.draft
                            }`}
                          >
                            {q.status === "ARCHIVE" ? "PUBLISHED" : q.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`${styles.quizDate} tabular-nums`}>
                      <Clock size={12} />
                      {new Date(q.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Performance Banner */}
      {stats.atRiskStudents > 0 && (
        <div className={styles.alertBanner}>
          <div className={styles.alertIcon}>
            <AlertTriangle size={20} />
          </div>
          <div className={styles.alertText}>
            <strong>{stats.atRiskStudents} student{stats.atRiskStudents > 1 ? "s" : ""}</strong>{" "}
            scored below 50% and may need additional support.
          </div>
          <button
            className={styles.alertAction}
            onClick={() => navigate("/analytics")}
          >
            <TrendingUp size={16} />
            View Analytics
          </button>
        </div>
      )}
    </div>
  );
}
