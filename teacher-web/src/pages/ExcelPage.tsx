import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import * as XLSX from "xlsx";
import styles from "./ExcelPage.module.css";
import { useNavigate } from "react-router-dom";
import { Loader2, UploadCloud, Download } from "lucide-react";

type StudentRecord = {
  id: string;
  full_name: string;
  average: number;
};

type Assessment = {
  id: string;
  quiz_title: string;
};

export default function ExcelPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentRecord[]>([]);
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
        .select("id, full_name, average")
        .order("full_name");
      setStudents(data as StudentRecord[]);
    } catch (err) {
      console.error("Failed to load students", err);
    } finally {
      setLoading(false);
    }
  }

  function exportToExcel() {
    const wsData = [
      ["Student Name", "Average Score"],
      ...students.map((s) => [s.full_name, s.average])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Student Scores");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student_scores.xlsx";
    a.click();
    URL.revokeObjectURL(url);
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
        const name = row[0];
        const avg = Number(row[1]);
        if (name && !isNaN(avg)) {
          imported.push({ id: "", full_name: name, average: avg });
        }
      }
      console.log("Imported students", imported);
      // TODO: upsert to Supabase if needed
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
            <Download size={18} /> Export Scores
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
