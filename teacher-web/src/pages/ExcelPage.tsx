import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";
import styles from "./ExcelPage.module.css";
import { useNavigate } from "react-router-dom";
import { Loader2, UploadCloud, Download } from "lucide-react";
import {
  downloadExcelTemplate,
  formatQuizColumnHeader,
  formatStudentFullName,
  normalizeStudentRecord,
  splitStudentFullName,
} from "../lib/studentNameUtils";

type StudentRecord = {
  id: string;
  classroom_id?: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string | null;
  full_name: string;
  email?: string;
  average: number;
};

type QuizInfo = {
  id: string;
  quiz_title: string;
  questions?: any[];
  answer_key?: any[];
};

type QuizResultRow = {
  student_id: string;
  quiz_id?: string | null;
  quiz_title: string;
  total_score: number;
  max_score: number;
};

export default function ExcelPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [quizzes, setQuizzes] = useState<QuizInfo[]>([]);
  const [quizResults, setQuizResults] = useState<QuizResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadStudents();
  }, [user]);

  async function loadStudents() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("students")
        .select("*");

      const normalized = ((data || []) as StudentRecord[])
        .map((s) => normalizeStudentRecord(s))
        .sort((a, b) =>
          (a.last_name || a.full_name).localeCompare(b.last_name || b.full_name)
        );
      setStudents(normalized);

      const { data: qz } = await supabase
        .from("archived_assessments")
        .select("id, quiz_title, questions, answer_key")
        .order("created_at", { ascending: true });
      setQuizzes((qz as QuizInfo[]) || []);

      const { data: qr } = await supabase
        .from("student_quiz_results")
        .select("student_id, quiz_id, quiz_title, total_score, max_score");
      setQuizResults((qr as QuizResultRow[]) || []);
    } catch (err) {
      console.error("Failed to load students", err);
    } finally {
      setLoading(false);
    }
  }

  function exportToExcel() {
    const chronologicalQuizzes = quizzes.map((q) => {
      const maxScore =
        (q.answer_key || []).reduce((sum: number, k: any) => sum + (Number(k?.points) || 1), 0) ||
        (q.questions?.length || 0);
      return { id: q.id, quizTitle: q.quiz_title, maxScore };
    });

    const knownTitles = new Set(chronologicalQuizzes.map((q) => q.quizTitle.toLowerCase().trim()));
    for (const r of quizResults) {
      const normTitle = (r.quiz_title || "").toLowerCase().trim();
      if (normTitle && !knownTitles.has(normTitle)) {
        knownTitles.add(normTitle);
        chronologicalQuizzes.push({
          id: r.quiz_id || r.quiz_title,
          quizTitle: r.quiz_title,
          maxScore: r.max_score || 0,
        });
      }
    }

    const quizHeaders = chronologicalQuizzes.map((q, idx) =>
      formatQuizColumnHeader(q.quizTitle, idx, q.maxScore)
    );

    const formattedDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const wsData = [
      ["TSEKI - CLASS ROSTER & PERFORMANCE RECORD"],
      ["Classroom:", "All Students", "", "Subject:", "Overview"],
      ["Section:", "N/A", "", "Room:", "N/A"],
      ["Schedule:", "N/A", "", "Teacher:", user?.user_metadata?.full_name || "N/A"],
      ["Export Date:", formattedDate, "", "Total Enrolled:", students.length],
      [], // Blank separator row
      ["Item", "Student Name", "Email Address", ...quizHeaders, "Average Scores"],
      ...students.map((s, idx) => {
        const norm = normalizeStudentRecord(s);
        const mergedStudentName = formatStudentFullName(norm);
        let sumEarned = 0;
        let sumMax = 0;
        let count = 0;
        const quizCells = chronologicalQuizzes.map((q) => {
          const match = quizResults.find(
            (r) =>
              r.student_id === s.id &&
              (r.quiz_id === q.id ||
                r.quiz_title.toLowerCase().trim() === q.quizTitle.toLowerCase().trim())
          );
          if (match !== undefined && typeof match.total_score === "number") {
            sumEarned += match.total_score;
            sumMax += q.maxScore || 100;
            count++;
            return Number(match.total_score);
          }
          return "";
        });

        let avgDisplay = "0%";
        if (typeof s.average === "number" && !isNaN(s.average)) {
          avgDisplay = `${Math.round(s.average)}%`;
        } else if (count > 0 && sumMax > 0) {
          avgDisplay = `${Math.round((sumEarned / sumMax) * 100)}%`;
        }

        return [
          idx + 1,
          mergedStudentName,
          s.email || "N/A",
          ...quizCells,
          avgDisplay,
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [
      { wch: 8 },  // Item
      { wch: 34 }, // Student Name
      { wch: 30 }, // Email Address
      ...chronologicalQuizzes.map((q, idx) => ({
        wch: Math.max(formatQuizColumnHeader(q.quizTitle, idx, q.maxScore).length + 4, 16),
      })),
      { wch: 18 }, // Average Scores
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Classlist");
    XLSX.writeFile(wb, "quiz scores.xlsx");
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const imported: StudentRecord[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawName = String(row[0] || "").trim();
        const avg = Number(row[1]);
        if (rawName && !isNaN(avg)) {
          const parts = splitStudentFullName(rawName);
          imported.push({
            id: "",
            last_name: parts.lastName,
            first_name: parts.firstName,
            middle_name: parts.middleName,
            full_name: formatStudentFullName({
              last_name: parts.lastName,
              first_name: parts.firstName,
              middle_name: parts.middleName,
              full_name: rawName,
            }),
            average: avg,
          });
        }
      }
      console.log("Imported students", imported);
    } catch (err) {
      console.error("Import error", err);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Excel Import / Export</h1>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Back
        </button>
      </header>

      {loading ? (
        <div className={styles.loader}>
          <Loader2 size={24} className="spinner" /> Loading students…
        </div>
      ) : (
        <section className={styles.actions}>
          <button
            className={styles.exportBtn}
            onClick={() => downloadExcelTemplate()}
            style={{ background: "#10B981" }}
          >
            <Download size={18} /> Download Excel Template
          </button>
          <button className={styles.exportBtn} onClick={exportToExcel}>
            <Download size={18} /> Export Quiz Scores
          </button>
          <label className={styles.importLabel}>
            <UploadCloud size={18} /> Import Scores
            <input
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={handleImport}
              disabled={importing}
            />
          </label>
        </section>
      )}
    </div>
  );
}
