import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  Plus,
  Search,
  Users,
  FileText,
  AlertTriangle,
  X,
  Loader2,
  Palette,
  GraduationCap,
  Clock,
} from "lucide-react";
import styles from "./ClassroomsPage.module.css";
import { ClassroomOnboardingModal } from "../components/ClassroomOnboardingModal";

type Classroom = {
  id: string;
  title: string;
  subject: string;
  section: string;
  room: string;
  schedule: string;
  color: string;
  created_at: string;
};

type ClassroomEnriched = Classroom & {
  studentCount: number;
  quizCount: number;
  flaggedCount: number;
};

const CARD_COLORS = ["#FF6B00", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"];

export default function ClassroomsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState<ClassroomEnriched[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Classroom Creation Onboarding Modal State
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingClassroom, setOnboardingClassroom] = useState<any | null>(null);

  // Form
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [room, setRoom] = useState("");
  const [schedule, setSchedule] = useState("");
  const [selectedColor, setSelectedColor] = useState(CARD_COLORS[0]);

  useEffect(() => {
    if (user) loadClassrooms();
  }, [user]);

  async function loadClassrooms() {
    try {
      const { data: cls } = await supabase
        .from("classrooms")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: true });

      const list = cls || [];
      const ids = list.map((c: any) => c.id);

      let studentCounts: Record<string, number> = {};
      let quizCounts: Record<string, number> = {};
      let flaggedCounts: Record<string, number> = {};

      if (ids.length > 0) {
        const { data: students } = await supabase
          .from("students")
          .select("id, classroom_id, average")
          .in("classroom_id", ids);

        (students || []).forEach((s: any) => {
          studentCounts[s.classroom_id] = (studentCounts[s.classroom_id] || 0) + 1;
          if (s.average !== null && s.average !== undefined && s.average > 0 && s.average <= 50) {
            flaggedCounts[s.classroom_id] = (flaggedCounts[s.classroom_id] || 0) + 1;
          }
        });

        const { data: quizzes } = await supabase
          .from("archived_assessments")
          .select("id, classroom_id")
          .in("classroom_id", ids);

        (quizzes || []).forEach((q: any) => {
          if (q.classroom_id) {
            quizCounts[q.classroom_id] = (quizCounts[q.classroom_id] || 0) + 1;
          }
        });
      }

      setClassrooms(
        list.map((c: any, i: number) => {
          let parsedSection = c.section || "";
          let parsedSchedule = c.schedule || "";
          if (parsedSection.includes(" || ")) {
            const parts = parsedSection.split(" || ");
            parsedSection = parts[0] || "";
            parsedSchedule = parts[1] || "";
          }

          return {
            ...c,
            title: c.title || "Untitled Classroom",
            subject: c.subject || "General Education",
            section: parsedSection,
            schedule: parsedSchedule,
            color: c.color || CARD_COLORS[i % CARD_COLORS.length],
            studentCount: studentCounts[c.id] || 0,
            quizCount: quizCounts[c.id] || 0,
            flaggedCount: flaggedCounts[c.id] || 0,
          };
        })
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);

    try {
      let encodedSection = section.trim();
      if (schedule.trim()) {
        encodedSection = encodedSection ? `${encodedSection} || ${schedule.trim()}` : `|| ${schedule.trim()}`;
      }

      const payload: any = {
        teacher_id: user!.id,
        title: title.trim(),
        subject: subject.trim() || null,
        section: encodedSection || null,
        room: room.trim() || null,
        color: selectedColor,
      };

      let createdClass: any = null;
      let { data, error } = await supabase.from("classrooms").insert(payload).select().single();
      if (error && (error.message?.includes("color") || error.code === "PGRST204" || error.message?.includes("schema cache"))) {
        delete payload.color;
        const retry = await supabase.from("classrooms").insert(payload).select().single();
        data = retry.data;
        error = retry.error;
      }
      if (data) {
        createdClass = data;
      }

      setShowModal(false);
      resetForm();
      await loadClassrooms();

      // Immediately open onboarding modal with the 4 actions
      if (createdClass) {
        setOnboardingClassroom({
          id: createdClass.id,
          title: createdClass.title,
          subject: createdClass.subject || "",
          section: section.trim(),
          room: createdClass.room || "",
          schedule: schedule.trim(),
          color: selectedColor,
        });
        setShowOnboarding(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setTitle("");
    setSubject("");
    setSection("");
    setRoom("");
    setSchedule("");
    setSelectedColor(CARD_COLORS[0]);
  }

  const filtered = classrooms.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.section.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Classrooms</h1>
          <p className={styles.subtitle}>
            Manage your classes, sections, and student rosters
          </p>
        </div>
        <button className={styles.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} />
          <span>Add Classroom</span>
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchToolbar}>
        <div className={styles.searchBar}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search classrooms by name, subject, or section..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className={styles.grid}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`skeleton ${styles.skeletonCard}`} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <GraduationCap size={44} strokeWidth={1.2} />
          <h3>{searchQuery ? "No classrooms match your search" : "No classrooms yet"}</h3>
          <p>
            {searchQuery
              ? "Try a different search term"
              : "Create your first classroom to start managing students and assessments."}
          </p>
          {!searchQuery && (
            <button className={styles.emptyBtn} onClick={() => setShowModal(true)}>
              <Plus size={15} />
              Create Classroom
            </button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((cls, idx) => (
            <div
              key={cls.id}
              className={styles.card}
              style={{ animationDelay: `${idx * 40}ms` }}
              onClick={() => navigate(`/classrooms/${cls.id}`)}
            >
              <div className={styles.cardHeaderRow}>
                <div className={styles.cardHeaderLeft}>
                  <span
                    className={styles.cardIndicator}
                    style={{ background: cls.color }}
                  />
                  <span className={styles.cardSubject}>{cls.subject}</span>
                </div>
                {cls.section && (
                  <span className={styles.sectionBadge}>{cls.section}</span>
                )}
              </div>

              <h3 className={styles.cardTitle}>{cls.title}</h3>

              {cls.schedule ? (
                <div className={styles.cardSchedule}>
                  <Clock size={13} className={styles.scheduleIcon} />
                  <span>{cls.schedule}</span>
                </div>
              ) : (
                <div className={styles.cardScheduleSpacer} />
              )}

              <div className={styles.cardFooter}>
                <div className={styles.footerBadges}>
                  <span className={styles.badge}>
                    <Users size={12} />
                    <span className="tabular-nums">{cls.studentCount} students</span>
                  </span>
                  <span className={styles.badge}>
                    <FileText size={12} />
                    <span className="tabular-nums">{cls.quizCount} quizzes</span>
                  </span>
                </div>
                {cls.flaggedCount > 0 && (
                  <span className={`${styles.badge} ${styles.badgeAlert}`}>
                    <AlertTriangle size={12} />
                    <span className="tabular-nums">{cls.flaggedCount} at-risk</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Add New Classroom</h2>
              <button
                className={styles.modalClose}
                onClick={() => setShowModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.modalBody}>
                <div className={styles.fieldGroup}>
                  <label>Class Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Mathematics 10"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={styles.input}
                    autoFocus
                  />
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.fieldGroup}>
                    <label>Subject</label>
                    <input
                      type="text"
                      placeholder="e.g. Mathematics"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label>Section</label>
                    <input
                      type="text"
                      placeholder="e.g. Section A"
                      value={section}
                      onChange={(e) => setSection(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.fieldGroup}>
                    <label>Room</label>
                    <input
                      type="text"
                      placeholder="e.g. Room 301"
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label>Schedule</label>
                    <input
                      type="text"
                      placeholder="e.g. MWF 8:00-9:00 AM"
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <label>
                    <Palette size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    Theme Color
                  </label>
                  <div className={styles.colorPicker}>
                    {CARD_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`${styles.colorDot} ${
                          selectedColor === c ? styles.colorDotActive : ""
                        }`}
                        style={{ background: c }}
                        onClick={() => setSelectedColor(c)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={saving || !title.trim()}
                >
                  {saving ? <Loader2 size={16} className={styles.spinner} /> : null}
                  Create Classroom
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Classroom Creation Onboarding Alert Modal */}
      <ClassroomOnboardingModal
        isOpen={showOnboarding}
        classroom={onboardingClassroom}
        onClose={() => setShowOnboarding(false)}
        onRosterUpdated={loadClassrooms}
      />
    </div>
  );
}
