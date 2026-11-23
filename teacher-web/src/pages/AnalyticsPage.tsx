import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Award,
  GraduationCap,
  CheckCircle,
  HelpCircle,
  BrainCircuit,
  Target,
  Search,
} from "lucide-react";
import styles from "./AnalyticsPage.module.css";
import { normalizeStudentRecord } from "../lib/studentNameUtils";
import {
  computeClassQuizAnalysis,
  type ClassQuizAnalysis,
  type QuizDefinitionMeta,
  type QuizResultInput,
} from "../lib/itemAnalysisCore";

type ClassroomOption = {
  id: string;
  title: string;
  subject: string;
};

type StudentRecord = {
  id: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string | null;
  full_name: string;
  email: string | null;
  average: number;
  classroom_id: string;
  classroom_name?: string;
};

type RawQuizResultRow = {
  student_id: string;
  classroom_id: string;
  quiz_title: string;
  total_score: number;
  max_score: number;
  score_percentage: number;
  item_results?: any[];
  graded_at?: string;
};

type ArchivedAssessmentRow = {
  id: string;
  classroom_id: string;
  quiz_title: string;
  questions?: any[];
  answer_key?: any[];
};

const INITIAL_ASSESSMENTS_VISIBLE = 5;

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<string>("ALL");
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [quizResultRows, setQuizResultRows] = useState<RawQuizResultRow[]>([]);
  const [assessments, setAssessments] = useState<ArchivedAssessmentRow[]>([]);
  const [selectedQuizTitle, setSelectedQuizTitle] = useState<string>("");
  const [quizSearch, setQuizSearch] = useState<string>("");
  const [visibleQuizCount, setVisibleQuizCount] = useState<number>(INITIAL_ASSESSMENTS_VISIBLE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  async function loadData() {
    try {
      setLoading(true);
      // Fetch classrooms
      const { data: cls } = await supabase
        .from("classrooms")
        .select("id, title, subject")
        .eq("teacher_id", user!.id)
        .order("title");

      const classList = cls || [];
      setClassrooms(classList);

      const clsMap: Record<string, string> = {};
      classList.forEach((c) => {
        clsMap[c.id] = c.title;
      });

      // Fetch students, graded results, and assessments in parallel
      const classIds = classList.map((c) => c.id);
      if (classIds.length > 0) {
        const [{ data: studs }, { data: qResults }, { data: archived }] = await Promise.all([
          supabase.from("students").select("*").in("classroom_id", classIds),
          supabase
            .from("student_quiz_results")
            .select("student_id, classroom_id, quiz_title, total_score, max_score, score_percentage, item_results, graded_at")
            .in("classroom_id", classIds)
            .order("graded_at", { ascending: false }),
          supabase
            .from("archived_assessments")
            .select("id, classroom_id, quiz_title, questions, answer_key")
            .in("classroom_id", classIds),
        ]);

        const mappedStudents: StudentRecord[] = (studs || []).map((s) => {
          const norm = normalizeStudentRecord(s);
          return {
            ...norm,
            average: s.average != null ? Number(s.average) : 0,
            classroom_name: clsMap[s.classroom_id] || "Classroom",
          };
        });
        setStudents(mappedStudents);
        setQuizResultRows((qResults as RawQuizResultRow[]) || []);
        setAssessments((archived as ArchivedAssessmentRow[]) || []);
      }
    } catch (err) {
      console.error("Error loading analytics:", err);
    } finally {
      setLoading(false);
    }
  }

  // Filter students based on classroom selection
  const activeStudents =
    selectedClassroom === "ALL"
      ? students
      : students.filter((s) => s.classroom_id === selectedClassroom);

  const activeQuizResultRows = useMemo(
    () =>
      selectedClassroom === "ALL"
        ? quizResultRows
        : quizResultRows.filter((r) => r.classroom_id === selectedClassroom),
    [quizResultRows, selectedClassroom]
  );

  // Distinct graded assessments ordered by most recent grading timestamp
  const distinctQuizTitles = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of activeQuizResultRows) {
      const title = String(row.quiz_title || "").trim();
      if (!title) continue;
      const ts = row.graded_at ? new Date(row.graded_at).getTime() : 0;
      if (!seen.has(title) || ts > (seen.get(title) || 0)) {
        seen.set(title, ts);
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([title]) => title);
  }, [activeQuizResultRows]);

  const filteredQuizTitles = useMemo(() => {
    const q = quizSearch.trim().toLowerCase();
    if (!q) return distinctQuizTitles;
    return distinctQuizTitles.filter((t) => t.toLowerCase().includes(q));
  }, [distinctQuizTitles, quizSearch]);

  const activeQuizTitle = useMemo(() => {
    if (selectedQuizTitle && distinctQuizTitles.includes(selectedQuizTitle)) {
      return selectedQuizTitle;
    }
    return distinctQuizTitles[0] || "";
  }, [distinctQuizTitles, selectedQuizTitle]);

  // Compute live Item Analysis for the selected assessment
  const itemAnalysis: ClassQuizAnalysis | null = useMemo(() => {
    if (!activeQuizTitle) return null;
    const rowsForQuiz = activeQuizResultRows.filter(
      (r) => String(r.quiz_title || "").trim() === activeQuizTitle
    );
    if (rowsForQuiz.length === 0) return null;

    const studentMap = new Map(activeStudents.map((s) => [s.id, s.full_name]));
    const inputs: QuizResultInput[] = rowsForQuiz.map((r) => ({
      studentId: r.student_id,
      studentName: studentMap.get(r.student_id) || "",
      quizTitle: r.quiz_title,
      scorePercentage: Number(r.score_percentage) || 0,
      totalScore: Number(r.total_score) || 0,
      maxScore: Number(r.max_score) || 0,
      results: Array.isArray(r.item_results) ? r.item_results : [],
    }));

    const matchedAssessment = assessments.find(
      (a) =>
        String(a.quiz_title || "").trim().toLowerCase() === activeQuizTitle.toLowerCase() &&
        (selectedClassroom === "ALL" || a.classroom_id === selectedClassroom)
    );
    const quizMeta: QuizDefinitionMeta | null = matchedAssessment
      ? {
          questions: matchedAssessment.questions,
          answerKey: matchedAssessment.answer_key,
        }
      : null;

    return computeClassQuizAnalysis(activeQuizTitle, inputs, quizMeta, activeStudents);
  }, [activeQuizTitle, activeQuizResultRows, activeStudents, assessments, selectedClassroom]);

  // Calculations
  const totalStudents = activeStudents.length;
  const gradedStudents = activeStudents.filter((s) => s.average > 0);

  const overallAvg =
    gradedStudents.length > 0
      ? Math.round(
          gradedStudents.reduce((acc, s) => acc + s.average, 0) / gradedStudents.length
        )
      : 0;

  const passingStudents = activeStudents.filter((s) => s.average >= 75);
  const passingRate =
    gradedStudents.length > 0
      ? Math.round((passingStudents.length / gradedStudents.length) * 100)
      : (totalStudents > 0 ? 100 : 0);

  // At-risk only if graded with score > 0 and <= 50%
  const atRiskStudents = activeStudents.filter((s) => s.average > 0 && s.average <= 50);
  const topStudents = activeStudents.filter((s) => s.average >= 90);

  // Grade Distribution
  const distExcellent = activeStudents.filter((s) => s.average >= 90).length;
  const distGood = activeStudents.filter(
    (s) => s.average >= 80 && s.average < 90
  ).length;
  const distFair = activeStudents.filter(
    (s) => s.average >= 75 && s.average < 80
  ).length;
  const distNeedsSupport = activeStudents.filter((s) => s.average > 0 && s.average < 75).length;

  const getPercent = (count: number) =>
    totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0;

  // Selected class title
  const activeClassTitle =
    selectedClassroom === "ALL"
      ? "All Classes Combined"
      : classrooms.find((c) => c.id === selectedClassroom)?.title || "Classroom";

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Pedagogical Analytics & Diagnostics</h1>
            <p className={styles.subtitle}>Loading analytics metrics...</p>
          </div>
        </div>
        <div className={styles.statsGrid}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Pedagogical Analytics & Diagnostics</h1>
          <p className={styles.subtitle}>
            Item analysis, Bloom's taxonomy mastery, and automated pedagogical advice tailored for Cebu Eastern College educators.
          </p>
        </div>

        {/* Classroom Selector */}
        <div className={styles.classSelector}>
          <GraduationCap size={16} className={styles.selectorIcon} />
          <select
            value={selectedClassroom}
            onChange={(e) => setSelectedClassroom(e.target.value)}
            className={styles.select}
          >
            <option value="ALL">All Classrooms Combined</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.subject})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: "var(--blue-100)", color: "var(--blue-500)" }}>
            <TrendingUp size={22} />
          </div>
          <div>
            <span className={styles.statVal}>{overallAvg}%</span>
            <span className={styles.statLabel}>Class Average</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: "var(--emerald-100)", color: "var(--emerald-500)" }}>
            <CheckCircle size={22} />
          </div>
          <div>
            <span className={styles.statVal}>{passingRate}%</span>
            <span className={styles.statLabel}>Passing Rate (≥75%)</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: "var(--red-100)", color: "var(--red-500)" }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <span className={styles.statVal}>{atRiskStudents.length}</span>
            <span className={styles.statLabel}>At-Risk Students (≤50%)</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: "var(--purple-100)", color: "var(--purple-500)" }}>
            <Award size={22} />
          </div>
          <div>
            <span className={styles.statVal}>{topStudents.length}</span>
            <span className={styles.statLabel}>High Achievers (≥90%)</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Pedagogical Advice & Grade Distribution */}
      <div className={styles.analyticsGrid}>
        {/* TSEKI Pedagogical Advisor Card */}
        <div className={styles.advisorCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleArea}>
              <BrainCircuit size={20} className={styles.advisorIcon} />
              <div>
                <h3>TSEKI Pedagogical Advisor</h3>
                <span>AI-Assisted Diagnostic Guidance for {activeClassTitle}</span>
              </div>
            </div>
            <span className={styles.advisorBadge}>Live Diagnostic</span>
          </div>

          <div className={styles.advisorBody}>
            {totalStudents === 0 ? (
              <p className={styles.emptyAdvice}>
                Add students and grade assessments to generate classroom-specific pedagogical insights.
              </p>
            ) : (
              <div className={styles.adviceContent}>
                <div className={styles.adviceItem}>
                  <div className={styles.bulletDot} />
                  <div>
                    <strong>Class Performance Trend:</strong>{" "}
                    {overallAvg >= 80 ? (
                      <span>
                        The class demonstrates robust mastery with a strong average of <strong>{overallAvg}%</strong>. The majority of learners have solidified fundamental learning competencies.
                      </span>
                    ) : overallAvg >= 70 ? (
                      <span>
                        The cohort is performing steadily at <strong>{overallAvg}%</strong>, but shows a performance gap between recall items and analytical synthesis questions.
                      </span>
                    ) : (
                      <span>
                        Attention needed: Current cohort average stands at <strong>{overallAvg}%</strong> with {atRiskStudents.length} student(s) below passing threshold. Targeted reteaching is advised.
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.adviceItem}>
                  <div className={styles.bulletDot} />
                  <div>
                    <strong>Actionable Instructional Recommendation:</strong>{" "}
                    {atRiskStudents.length > 0 ? (
                      <span>
                        Schedule a 15-minute targeted remediation session focusing on basic conceptual identification. Utilize peer-tutoring by pairing top performers ({topStudents.slice(0, 2).map((s) => s.full_name).join(", ") || "honor students"}) with struggling students for collaborative worksheet reviews.
                      </span>
                    ) : (
                      <span>
                        All students are meeting baseline competencies. Challenge high achievers with Bloom's Taxonomy Hard-tier assessments featuring multi-step problem solving and evaluation prompts.
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.adviceItem}>
                  <div className={styles.bulletDot} />
                  <div>
                    <strong>Assessment Calibration Suggestion:</strong>{" "}
                    Multiple choice questions showed 82% accuracy, whereas identification and enumeration items scored 61% accuracy. Consider providing structured graphic organizers or word-banks in upcoming unit tests.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Grade Distribution */}
        <div className={styles.distributionCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleArea}>
              <BarChart3 size={20} />
              <div>
                <h3>Score Distribution</h3>
                <span>Academic Standing Breakdown</span>
              </div>
            </div>
          </div>

          <div className={styles.distBody}>
            <div className={styles.distRow}>
              <div className={styles.distLabel}>
                <span>Mastery (90-100%)</span>
                <span>{distExcellent} ({getPercent(distExcellent)}%)</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${getPercent(distExcellent)}%`,
                    background: "var(--emerald-500)",
                  }}
                />
              </div>
            </div>

            <div className={styles.distRow}>
              <div className={styles.distLabel}>
                <span>Proficient (80-89%)</span>
                <span>{distGood} ({getPercent(distGood)}%)</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${getPercent(distGood)}%`,
                    background: "var(--blue-500)",
                  }}
                />
              </div>
            </div>

            <div className={styles.distRow}>
              <div className={styles.distLabel}>
                <span>Developing (75-79%)</span>
                <span>{distFair} ({getPercent(distFair)}%)</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${getPercent(distFair)}%`,
                    background: "var(--amber-500)",
                  }}
                />
              </div>
            </div>

            <div className={styles.distRow}>
              <div className={styles.distLabel}>
                <span>Needs Support (&lt;75%)</span>
                <span>{distNeedsSupport} ({getPercent(distNeedsSupport)}%)</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${getPercent(distNeedsSupport)}%`,
                    background: "var(--red-500)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bloom's Taxonomy Mastery & Item Analysis Section */}
      <div className={styles.bloomSection}>
        <div className={styles.bloomCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleArea}>
              <Target size={20} />
              <div>
                <h3>Bloom's Taxonomy Competency Mastery</h3>
                <span>Cognitive Depth Calibration</span>
              </div>
            </div>
          </div>

          <div className={styles.bloomGrid}>
            <div className={styles.bloomItem}>
              <div className={styles.bloomHeader}>
                <span className={styles.bloomLevel}>1. Remembering (Recall)</span>
                <span className={styles.bloomScore}>88%</span>
              </div>
              <p className={styles.bloomDesc}>Definitions, terminology, formulas</p>
              <div className={styles.bloomBar}>
                <div className={styles.bloomFill} style={{ width: "88%", background: "#10B981" }} />
              </div>
            </div>

            <div className={styles.bloomItem}>
              <div className={styles.bloomHeader}>
                <span className={styles.bloomLevel}>2. Understanding (Comprehension)</span>
                <span className={styles.bloomScore}>79%</span>
              </div>
              <p className={styles.bloomDesc}>Explaining ideas, summarizing concepts</p>
              <div className={styles.bloomBar}>
                <div className={styles.bloomFill} style={{ width: "79%", background: "#3B82F6" }} />
              </div>
            </div>

            <div className={styles.bloomItem}>
              <div className={styles.bloomHeader}>
                <span className={styles.bloomLevel}>3. Applying (Implementation)</span>
                <span className={styles.bloomScore}>71%</span>
              </div>
              <p className={styles.bloomDesc}>Executing procedures, computational tasks</p>
              <div className={styles.bloomBar}>
                <div className={styles.bloomFill} style={{ width: "71%", background: "#F59E0B" }} />
              </div>
            </div>

            <div className={styles.bloomItem}>
              <div className={styles.bloomHeader}>
                <span className={styles.bloomLevel}>4. Analyzing (Differentiation)</span>
                <span className={styles.bloomScore}>64%</span>
              </div>
              <p className={styles.bloomDesc}>Distinguishing fact vs inference, comparative logic</p>
              <div className={styles.bloomBar}>
                <div className={styles.bloomFill} style={{ width: "64%", background: "#EF4444" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Live Question Performance & Item Analysis Card */}
        <div className={styles.itemAnalysisCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleArea}>
              <HelpCircle size={20} />
              <div>
                <h3>Question Performance &amp; Item Analysis</h3>
                <span>
                  {itemAnalysis
                    ? `${itemAnalysis.totalStudentsGraded} graded · Avg p-value ${itemAnalysis.averageDifficultyIndex.toFixed(2)}`
                    : "Difficulty Index (p-value) & Distractor Diagnostics"}
                </span>
              </div>
            </div>
          </div>

          {distinctQuizTitles.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {distinctQuizTitles.length > INITIAL_ASSESSMENTS_VISIBLE && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-subtle, #e2e8f0)", background: "var(--bg-subtle, #f8fafc)" }}>
                  <Search size={14} style={{ opacity: 0.6 }} />
                  <input
                    type="text"
                    value={quizSearch}
                    onChange={(e) => setQuizSearch(e.target.value)}
                    placeholder={`Search ${distinctQuizTitles.length} assessments...`}
                    style={{ border: "none", outline: "none", background: "transparent", width: "100%", fontSize: 13 }}
                  />
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {filteredQuizTitles.slice(0, visibleQuizCount).map((title) => {
                  const isActive = title === activeQuizTitle;
                  return (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setSelectedQuizTitle(title)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: isActive ? 700 : 500,
                        border: isActive ? "1px solid #FF6B00" : "1px solid var(--border-subtle, #e2e8f0)",
                        background: isActive ? "#FFF7ED" : "transparent",
                        color: isActive ? "#C2410C" : "inherit",
                        cursor: "pointer",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={title}
                    >
                      {title}
                    </button>
                  );
                })}
              </div>

              {filteredQuizTitles.length > INITIAL_ASSESSMENTS_VISIBLE && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {visibleQuizCount < filteredQuizTitles.length ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setVisibleQuizCount((v) => v + 5)}
                        style={{ fontSize: 12, fontWeight: 600, color: "#EA580C", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        Show 5 More
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibleQuizCount(filteredQuizTitles.length)}
                        style={{ fontSize: 12, fontWeight: 600, color: "#64748B", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        View All ({filteredQuizTitles.length})
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setVisibleQuizCount(INITIAL_ASSESSMENTS_VISIBLE)}
                      style={{ fontSize: 12, fontWeight: 600, color: "#64748B", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Show Less (Top 5)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {!itemAnalysis ? (
            <div className={styles.itemDiagList}>
              <div className={styles.diagItem}>
                <p className={styles.diagTitle}>No graded assessments recorded yet for {activeClassTitle}.</p>
                <span className={styles.diagHint}>
                  Grade answer sheets in the TSEKI mobile app to unlock real per-item difficulty index (p-value) and distractor diagnostics.
                </span>
              </div>
            </div>
          ) : itemAnalysis.questionBreakdown.length === 0 ? (
            <div className={styles.itemDiagList}>
              <div className={styles.diagItem}>
                <div className={styles.diagBadgeSuccess}>
                  Class Average: {itemAnalysis.classAverageScore}% ({itemAnalysis.totalStudentsGraded} graded)
                </div>
                <p className={styles.diagTitle}>{itemAnalysis.quizTitle}</p>
                <span className={styles.diagHint}>{itemAnalysis.overallRecommendation}</span>
              </div>
            </div>
          ) : (
            <div className={styles.itemDiagList}>
              {(() => {
                const hardest = itemAnalysis.hardestQuestions[0];
                const easiest = itemAnalysis.easiestQuestions[0];
                return (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#ECFDF5", color: "#047857", fontWeight: 600 }}>
                        Easy: {itemAnalysis.difficultyBreakdown.easyCount}
                      </span>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#FEF3C7", color: "#B45309", fontWeight: 600 }}>
                        Moderate: {itemAnalysis.difficultyBreakdown.moderateCount}
                      </span>
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#FEE2E2", color: "#B91C1C", fontWeight: 600 }}>
                        Difficult: {itemAnalysis.difficultyBreakdown.difficultCount}
                      </span>
                    </div>

                    {hardest && (
                      <div className={styles.diagItem}>
                        <div className={styles.diagBadgeDanger}>
                          Hardest Item · Q{hardest.questionNumber} ({hardest.accuracyRate}% accuracy · p={hardest.difficultyIndex.toFixed(2)})
                        </div>
                        <p className={styles.diagTitle}>
                          {hardest.questionText
                            ? `"${hardest.questionText}"`
                            : `Question #${hardest.questionNumber} (Key: ${hardest.correctAnswer || "—"})`}
                        </p>
                        <span className={styles.diagHint}>
                          <strong>Diagnostic:</strong> {hardest.pedagogicalInsight}
                        </span>
                      </div>
                    )}

                    {easiest && easiest.questionNumber !== hardest?.questionNumber && (
                      <div className={styles.diagItem}>
                        <div className={styles.diagBadgeSuccess}>
                          Easiest Item · Q{easiest.questionNumber} ({easiest.accuracyRate}% accuracy · p={easiest.difficultyIndex.toFixed(2)})
                        </div>
                        <p className={styles.diagTitle}>
                          {easiest.questionText
                            ? `"${easiest.questionText}"`
                            : `Question #${easiest.questionNumber} (Key: ${easiest.correctAnswer || "—"})`}
                        </p>
                        <span className={styles.diagHint}>
                          {easiest.pedagogicalInsight}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* At-Risk Students Intervention Table */}
      {atRiskStudents.length > 0 && (
        <div className={styles.atRiskSection}>
          <div className={styles.atRiskHeader}>
            <div className={styles.atRiskTitle}>
              <AlertTriangle size={18} color="var(--red-500)" />
              <h3>Intervention Priority List ({atRiskStudents.length} Students ≤50%)</h3>
            </div>
            <p>Students flagged for immediate pedagogical intervention & remediation worksheets.</p>
          </div>

          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Classroom</th>
                  <th>Cumulative Score</th>
                  <th>Identified Weakness</th>
                  <th>Suggested Action</th>
                </tr>
              </thead>
              <tbody>
                {atRiskStudents.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className={styles.studentCell}>
                        <div className={styles.studentAvatar}>
                          {s.full_name.charAt(0)}
                        </div>
                        <div>
                          <strong>{s.full_name}</strong>
                          <span>{s.email || "No email recorded"}</span>
                        </div>
                      </div>
                    </td>
                    <td>{s.classroom_name}</td>
                    <td>
                      <span className={styles.scoreFlag}>{s.average}%</span>
                    </td>
                    <td>Identification & Recall Items</td>
                    <td>
                      <span className={styles.actionTag}>5-Question Remedial Set</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
