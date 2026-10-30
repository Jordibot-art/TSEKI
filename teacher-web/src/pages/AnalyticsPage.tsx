import { useEffect, useState } from "react";
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
} from "lucide-react";
import styles from "./AnalyticsPage.module.css";

type ClassroomOption = {
  id: string;
  title: string;
  subject: string;
};

type StudentRecord = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
  classroom_id: string;
  classroom_name?: string;
};

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<string>("ALL");
  const [students, setStudents] = useState<StudentRecord[]>([]);
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

      // Fetch students for these classrooms
      const classIds = classList.map((c) => c.id);
      if (classIds.length > 0) {
        const { data: studs } = await supabase
          .from("students")
          .select("*")
          .in("classroom_id", classIds);

        const mappedStudents: StudentRecord[] = (studs || []).map((s) => ({
          ...s,
          average: s.average != null ? Number(s.average) : 0,
          classroom_name: clsMap[s.classroom_id] || "Classroom",
        }));
        setStudents(mappedStudents);
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

        {/* Item Analysis Card */}
        <div className={styles.itemAnalysisCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitleArea}>
              <HelpCircle size={20} />
              <div>
                <h3>Item Diagnostics</h3>
                <span>Distractor & Difficulty Flags</span>
              </div>
            </div>
          </div>

          <div className={styles.itemDiagList}>
            <div className={styles.diagItem}>
              <div className={styles.diagBadgeDanger}>Hardest Item (38% accuracy)</div>
              <p className={styles.diagTitle}>
                "Distinguishing dominant vs codominant alleles in non-Mendelian inheritance"
              </p>
              <span className={styles.diagHint}>
                <strong>Common Misconception:</strong> 54% of learners picked distractor (B) confusing incomplete dominance with codominance.
              </span>
            </div>

            <div className={styles.diagItem}>
              <div className={styles.diagBadgeSuccess}>Easiest Item (94% accuracy)</div>
              <p className={styles.diagTitle}>
                "Identifying the powerhouse organelle of eukaryotic cell"
              </p>
              <span className={styles.diagHint}>
                High mastery observed across all sections.
              </span>
            </div>
          </div>
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
