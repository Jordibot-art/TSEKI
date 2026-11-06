import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";
import styles from "./ExcelPage.module.css";
import { useNavigate } from "react-router-dom";
import { Loader2, UploadCloud, Download } from "lucide-react";
import {
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

    const wsData = [
      ["#", "Last Name", "First Name", "Middle Name", ...quizHeaders],
      ...students.map((s, idx) => {
        const norm = normalizeStudentRecord(s);
        const quizCells = chronologicalQuizzes.map((q) => {
          const match = quizResults.find(
            (r) =>
              r.student_id === s.id &&
              (r.quiz_id === q.id ||
                r.quiz_title.toLowerCase().trim() === q.quizTitle.toLowerCase().trim())
          );
          return match !== undefined ? Number(match.total_score) : "";
        });
        return [
          idx + 1,
          norm.last_name || "",
          norm.first_name || "",
          norm.middle_name || "",
          ...quizCells,
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Student Scores");
    XLSX.writeFile(wb, "student_quiz_scores.xlsx");
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
