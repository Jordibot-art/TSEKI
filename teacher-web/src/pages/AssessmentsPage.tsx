import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  FileText,
  Plus,
  Search,
  Sparkles,
  Printer,
  Trash2,
  X,
  Loader2,
  Clock,
  Eye,
  CheckCircle2,
  GraduationCap,
  Layers,
  UploadCloud,
  Shuffle,
  AlertCircle,
} from "lucide-react";
import {
  generateScannableQuiz,
  type ScannableQuestion,
  type AnswerKeyItem,
  type QuestionType,
} from "../lib/quizGeneratorService";
import {
  parseBrowserDocument,
  getDocBadgeInfo,
  type ParsedDocument,
} from "../lib/documentParserService";
import styles from "./AssessmentsPage.module.css";

type StoredQuiz = {
  id: string;
  classroom_id: string | null;
  quiz_title: string;
  subject: string | null;
  difficulty: string | null;
  question_type: string | null;
  grade_level: string | null;
  questions: ScannableQuestion[];
  answer_key: AnswerKeyItem[];
  status: "DRAFT" | "PUBLISHED" | "ARCHIVE";
  created_at: string;
  updated_at?: string;
  classroom_name?: string;
};

type ClassroomOption = {
  id: string;
  title: string;
  subject: string;
};

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export default function AssessmentsPage() {
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState<StoredQuiz[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PUBLISHED" | "DRAFT">("ALL");
  const [classroomFilter, setClassroomFilter] = useState<string>("ALL");

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [generatorLoading, setGeneratorLoading] = useState(false);
  const [targetClassroom, setTargetClassroom] = useState<string>("");
  const [quizTitle, setQuizTitle] = useState("");
  const [subject, setSubject] = useState("General Science");
  const [gradeLevel, setGradeLevel] = useState("Grade 10");
  const [difficulty, setDifficulty] = useState("Medium");
  const [questionType, setQuestionType] = useState<QuestionType | "mixed">("multiple_choice");
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [topicPrompt, setTopicPrompt] = useState("");
  const [lessonNotes, setLessonNotes] = useState("");

  // Attached Document State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedDoc, setAttachedDoc] = useState<ParsedDocument | null>(null);
  const [isParsingDoc, setIsParsingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Generated/Draft questions to review/edit
  const [draftQuestions, setDraftQuestions] = useState<ScannableQuestion[]>([]);
  const [draftAnswerKey, setDraftAnswerKey] = useState<AnswerKeyItem[]>([]);
  const [step, setStep] = useState<"config" | "preview">("config");

  // View / Print Modal
  const [selectedQuiz, setSelectedQuiz] = useState<StoredQuiz | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [paperSize, setPaperSize] = useState<"short" | "long">("short");
  const [includeKeyInPrint, setIncludeKeyInPrint] = useState(false);

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

      const clsMap: Record<string, string> = {};
      (cls || []).forEach((c) => {
        clsMap[c.id] = c.title;
      });
      setClassrooms(cls || []);

      // Fetch assessments from archived_assessments
      const { data: qz } = await supabase
        .from("archived_assessments")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("created_at", { ascending: false });

      const mapped = (qz || []).map((q: any) => ({
        ...q,
        questions: Array.isArray(q.questions) ? q.questions : [],
        answer_key: Array.isArray(q.answer_key) ? q.answer_key : [],
        classroom_name: q.classroom_id ? clsMap[q.classroom_id] || "Assigned" : (q.class_title || "Unassigned"),
      }));

      setQuizzes(mapped);
    } catch (err) {
      console.error("Error loading assessments:", err);
    } finally {
      setLoading(false);
    }
  }

  function getDraftCountdown(createdAt: string) {
    const createdTime = new Date(createdAt).getTime();
    const expiryTime = createdTime + DRAFT_TTL_MS;
    const remainingMs = Math.max(0, expiryTime - Date.now());
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingDays = Math.floor(remainingHours / 24);

    if (remainingDays >= 1) {
      return { text: `${remainingDays}d left`, isUrgent: remainingDays <= 2 };
    }
    if (remainingHours >= 1) {
      return { text: `${remainingHours}h left`, isUrgent: true };
    }
    const remainingMins = Math.max(1, Math.floor(remainingMs / (1000 * 60)));
    return { text: `${remainingMins}m left`, isUrgent: true };
  }

  // File selection handler
  async function handleFileSelected(file: File) {
    setDocError(null);
    setIsParsingDoc(true);
    try {
      const parsed = await parseBrowserDocument(file);
      setAttachedDoc(parsed);

      // Auto-suggest quiz title from filename if title is blank
      if (!quizTitle.trim()) {
        const cleanName = file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[-_]/g, " ")
          .trim();
        setQuizTitle(cleanName);
      }
    } catch (err: any) {
      console.error("Failed to parse document:", err);
      setDocError(err?.message || "Failed to parse document. Please check the file.");
    } finally {
      setIsParsingDoc(false);
    }
  }

  function handleRemoveFile() {
    setAttachedDoc(null);
    setDocError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Shuffle generated questions and synchronize answer key
  function handleShuffleQuestions() {
    if (draftQuestions.length <= 1) return;

    const pairs = draftQuestions.map((q) => {
      const keyItem = draftAnswerKey.find((k) => k.questionNumber === q.questionNumber);
      return { q, keyItem };
    });

    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }

    const newQuestions: ScannableQuestion[] = pairs.map((pair, idx) => ({
      ...pair.q,
      questionNumber: idx + 1,
    }));

    const newKey: AnswerKeyItem[] = pairs.map((pair, idx) => ({
      questionNumber: idx + 1,
      correctAnswer: pair.keyItem ? pair.keyItem.correctAnswer : "",
      points: pair.keyItem ? pair.keyItem.points : 1,
    }));

    setDraftQuestions(newQuestions);
    setDraftAnswerKey(newKey);
  }

  async function handleGenerateAI() {
    const effectiveTopic =
      topicPrompt.trim() ||
      (attachedDoc ? `Content of ${attachedDoc.name}` : quizTitle.trim());

    if (!effectiveTopic && !attachedDoc) {
      alert("Please enter a title, topic prompt, or attach a curriculum file.");
      return;
    }

    setGeneratorLoading(true);
    try {
      const generated = await generateScannableQuiz({
        topic: effectiveTopic || "Curriculum Assessment",
        subject,
        gradeLevel,
        difficulty,
        questionType,
        questionCount,
        attachedPdfBase64: attachedDoc?.type === "pdf" ? attachedDoc.base64 : undefined,
        attachedPdfName: attachedDoc?.type === "pdf" ? attachedDoc.name : undefined,
        attachedFileName: attachedDoc?.name,
        attachedFileType: attachedDoc?.type,
        attachedFileText: attachedDoc?.text,
        lessonNotes: lessonNotes.trim(),
      });

      if (!quizTitle.trim() && generated.quizTitle) {
        setQuizTitle(generated.quizTitle);
      }

      setDraftQuestions(generated.questions);
      setDraftAnswerKey(generated.answerKey);
      setStep("preview");
    } catch (err: any) {
      console.error("AI Generation error:", err);
      alert(
        err?.message?.includes("503")
          ? "AI Service is temporarily busy. Please wait a few seconds and try again."
          : `Failed to generate assessment: ${err?.message || "Unknown error"}`
      );
    } finally {
      setGeneratorLoading(false);
    }
  }

  async function handleSaveAssessment(targetStatus: "DRAFT" | "PUBLISHED") {
    if (!quizTitle.trim()) {
      alert("Please provide an assessment title.");
      return;
    }

    try {
      setLoading(true);
      const selectedClass = classrooms.find((c) => c.id === targetClassroom);
      const payload = {
        teacher_id: user!.id,
        classroom_id: targetClassroom || null,
        class_title: selectedClass ? selectedClass.title : null,
        quiz_title: quizTitle,
        subject,
        difficulty,
        question_type: questionType,
        grade_level: gradeLevel,
        questions: draftQuestions,
        answer_key: draftAnswerKey,
        status: targetStatus === "DRAFT" ? "DRAFT" : "PUBLISHED",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("archived_assessments").insert([payload]).select();

      if (error) {
        console.error("Save error:", error);
        alert("Failed to save assessment to Supabase.");
        return;
      }

      setShowCreateModal(false);
      resetCreateForm();
      await loadData();
    } catch (err) {
      console.error(err);
      alert("Unexpected error occurred while saving assessment.");
    } finally {
      setLoading(false);
    }
  }

  function resetCreateForm() {
    setQuizTitle("");
    setTopicPrompt("");
    setLessonNotes("");
    setTargetClassroom("");
    setDraftQuestions([]);
    setDraftAnswerKey([]);
    setAttachedDoc(null);
    setDocError(null);
    setStep("config");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDeleteQuiz(quizId: string) {
    if (!confirm("Are you sure you want to delete this assessment?")) return;
    try {
      const { error } = await supabase.from("archived_assessments").delete().eq("id", quizId);
      if (error) {
        alert("Failed to delete quiz.");
        return;
      }
      setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
      if (selectedQuiz?.id === quizId) {
        setSelectedQuiz(null);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Filter quizzes
  const filteredQuizzes = quizzes.filter((q) => {
    const matchesSearch =
      q.quiz_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.subject && q.subject.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (q.classroom_name && q.classroom_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "ALL"
        ? true
        : statusFilter === "DRAFT"
        ? q.status === "DRAFT"
        : q.status === "PUBLISHED" || q.status === "ARCHIVE";

    const matchesClass =
      classroomFilter === "ALL" ? true : q.classroom_id === classroomFilter;

    return matchesSearch && matchesStatus && matchesClass;
  });

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Assessments & AI Builder</h1>
          <p className={styles.subtitle}>
            Generate, calibrate, and print scannable bond-paper assessments for TSEKI optical camera grading.
          </p>
        </div>
        <button
          className={styles.createBtn}
          onClick={() => {
            resetCreateForm();
            setShowCreateModal(true);
          }}
        >
          <Sparkles size={18} />
          <span>New AI Assessment</span>
        </button>
      </div>

      {/* Control Bar: Search and Filters */}
      <div className={styles.controlBar}>
        <div className={styles.searchWrap}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search assessments, subjects, or classrooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filtersGroup}>
          <div className={styles.selectWrap}>
            <GraduationCap size={16} className={styles.selectIcon} />
            <select
              value={classroomFilter}
              onChange={(e) => setClassroomFilter(e.target.value)}
              className={styles.selectInput}
            >
              <option value="ALL">All Classrooms</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.subject})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.tabsToggle}>
            <button
              className={`${styles.tabBtn} ${statusFilter === "ALL" ? styles.tabActive : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              All ({quizzes.length})
            </button>
            <button
              className={`${styles.tabBtn} ${statusFilter === "PUBLISHED" ? styles.tabActive : ""}`}
              onClick={() => setStatusFilter("PUBLISHED")}
            >
              Published ({quizzes.filter((q) => q.status !== "DRAFT").length})
            </button>
            <button
              className={`${styles.tabBtn} ${statusFilter === "DRAFT" ? styles.tabActive : ""}`}
              onClick={() => setStatusFilter("DRAFT")}
            >
              Drafts ({quizzes.filter((q) => q.status === "DRAFT").length})
            </button>
          </div>
        </div>
      </div>

      {/* Assessment Grid */}
      {loading ? (
        <div className={styles.loadingGrid}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`skeleton ${styles.skeletonCard}`} />
          ))}
        </div>
      ) : filteredQuizzes.length === 0 ? (
        <div className={styles.emptyState}>
          <FileText size={48} strokeWidth={1.2} />
          <h3>No assessments found</h3>
          <p>Create an AI-calibrated test or adjust your active filters.</p>
          <button
            className={styles.emptyAction}
            onClick={() => {
              resetCreateForm();
              setShowCreateModal(true);
            }}
          >
            <Plus size={16} />
            Create First Assessment
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredQuizzes.map((quiz) => {
            const isDraft = quiz.status === "DRAFT";
            const draftTime = isDraft ? getDraftCountdown(quiz.created_at) : null;
            const questionCount = quiz.questions?.length || 0;
            const totalPoints = quiz.answer_key?.reduce((acc, k) => acc + (k.points || 1), 0) || questionCount;

            return (
              <div key={quiz.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.headerLeft}>
                    <span
                      className={`${styles.badge} ${
                        isDraft ? styles.draftBadge : styles.publishedBadge
                      }`}
                    >
                      {isDraft ? "DRAFT" : "PUBLISHED"}
                    </span>
                    {draftTime && (
                      <span
                        className={`${styles.draftTimer} ${
                          draftTime.isUrgent ? styles.urgentTimer : ""
                        }`}
                        title="Instagram-style 7-day auto-expiry lifespan"
                      >
                        <Clock size={12} />
                        {draftTime.text}
                      </span>
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => {
                        setSelectedQuiz(quiz);
                        setShowPrintModal(true);
                      }}
                      title="Print Scannable Bond Paper Sheet"
                    >
                      <Printer size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => setSelectedQuiz(quiz)}
                      title="View Questions & Answer Key"
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.dangerBtn}`}
                      onClick={() => handleDeleteQuiz(quiz.id)}
                      title="Delete Assessment"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className={styles.cardBody} onClick={() => setSelectedQuiz(quiz)}>
                  <h3 className={styles.quizTitle}>{quiz.quiz_title}</h3>
                  <p className={styles.subjectText}>
                    {quiz.subject || "General Education"}
                    {quiz.grade_level ? ` · ${quiz.grade_level}` : ""}
                  </p>

                  <div className={styles.metaRow}>
                    <div className={styles.metaChip}>
                      <Layers size={13} />
                      <span>{questionCount} Questions ({totalPoints} pts)</span>
                    </div>
                    {quiz.difficulty && (
                      <div className={styles.metaChip}>
                        <span>{quiz.difficulty}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <span className={styles.classInfo}>
                    <GraduationCap size={14} />
                    {quiz.classroom_name || "Unassigned"}
                  </span>
                  <button
                    className={styles.printActionBtn}
                    onClick={() => {
                      setSelectedQuiz(quiz);
                      setShowPrintModal(true);
                    }}
                  >
                    <Printer size={14} />
                    Print Sheet
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CREATE / AI GENERATOR MODAL ── */}
      {showCreateModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleArea}>
                <Sparkles size={20} className={styles.modalIcon} />
                <div>
                  <h2>AI Assessment Builder</h2>
                  <p>Calibrate according to Bloom's Taxonomy for optical grading</p>
                </div>
              </div>
              <button
                className={styles.closeBtn}
                onClick={() => setShowCreateModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {step === "config" ? (
              <div className={styles.modalBody}>
                <div className={styles.formRow}>
                  <div className={styles.fieldGroup}>
                    <label>Assessment Title *</label>
                    <input
                      type="text"
                      placeholder="e.g. Unit 3: Cellular Respiration & Genetics"
                      value={quizTitle}
                      onChange={(e) => setQuizTitle(e.target.value)}
                      className={styles.input}
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label>Assign to Classroom</label>
                    <select
                      value={targetClassroom}
                      onChange={(e) => setTargetClassroom(e.target.value)}
                      className={styles.select}
                    >
                      <option value="">Unassigned (General)</option>
                      {classrooms.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} — {c.subject}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid3}>
                  <div className={styles.fieldGroup}>
                    <label>Subject</label>
                    <select
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className={styles.select}
                    >
                      <option value="General Science">General Science</option>
                      <option value="Mathematics">Mathematics</option>
                      <option value="English & Literature">English & Literature</option>
                      <option value="Filipino">Filipino</option>
                      <option value="Araling Panlipunan">Araling Panlipunan</option>
                      <option value="MAPEH">MAPEH</option>
                      <option value="Computer Science">Computer Science</option>
                    </select>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label>Grade Level</label>
                    <select
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                      className={styles.select}
                    >
                      <option value="Grade 7">Grade 7</option>
                      <option value="Grade 8">Grade 8</option>
                      <option value="Grade 9">Grade 9</option>
                      <option value="Grade 10">Grade 10</option>
                      <option value="Grade 11">Grade 11 (SHS)</option>
                      <option value="Grade 12">Grade 12 (SHS)</option>
                    </select>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label>Question Count</label>
                    <select
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      className={styles.select}
                    >
                      <option value={5}>5 Questions (Quick Check)</option>
                      <option value={10}>10 Questions (Standard Quiz)</option>
                      <option value={15}>15 Questions (Unit Test)</option>
                      <option value={20}>20 Questions (Quarter Exam)</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formRow}>
                  <div className={styles.fieldGroup}>
                    <label>Question Type</label>
                    <select
                      value={questionType}
                      onChange={(e) => setQuestionType(e.target.value as any)}
                      className={styles.select}
                    >
                      <option value="multiple_choice">Multiple Choice (A, B, C, D)</option>
                      <option value="true_false">True / False (T/F)</option>
                      <option value="identification">Identification (Fill in)</option>
                      <option value="enumeration">Enumeration</option>
                      <option value="mixed">Mixed Assessment (Balanced)</option>
                    </select>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label>Bloom's Taxonomy Difficulty</label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className={styles.select}
                    >
                      <option value="Easy">Easy (Recall & Understanding)</option>
                      <option value="Medium">Medium (Application & Analysis)</option>
                      <option value="Hard">Hard (Evaluation & Synthesis)</option>
                    </select>
                  </div>
                </div>

                {/* ── Attach Reference File (Dropzone) ── */}
                <div className={styles.fieldGroup}>
                  <div className={styles.attachHeader}>
                    <label>
                      Attach Reference File
                      <span className={styles.optionalBadge}>OPTIONAL</span>
                    </label>
                    {attachedDoc && (
                      <button
                        className={styles.removeDocBtn}
                        onClick={handleRemoveFile}
                        type="button"
                      >
                        <X size={12} /> Remove
                      </button>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.csv"
                    className={styles.fileInputHidden}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                  />

                  {isParsingDoc ? (
                    <div className={styles.parsingIndicator}>
                      <Loader2 size={28} className={styles.spinner} />
                      <span>Parsing document content...</span>
                    </div>
                  ) : attachedDoc ? (
                    <div
                      className={styles.attachedFileCard}
                      style={{
                        borderColor: getDocBadgeInfo(attachedDoc.type).borderColor,
                        background: getDocBadgeInfo(attachedDoc.type).bgColor,
                      }}
                    >
                      <div className={styles.fileCardLeft}>
                        <span
                          className={styles.docTypeBadge}
                          style={{ background: getDocBadgeInfo(attachedDoc.type).color }}
                        >
                          {getDocBadgeInfo(attachedDoc.type).label}
                        </span>
                        <div className={styles.fileCardInfo}>
                          <span className={styles.fileName}>{attachedDoc.name}</span>
                          <span className={styles.fileSummary}>{attachedDoc.summaryText}</span>
                        </div>
                      </div>
                      <div className={styles.fileCardRight}>
                        <span className={styles.readyBadge}>
                          <CheckCircle2 size={13} /> Ready
                        </span>
                        <button
                          className={styles.changeFileBtn}
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleFileSelected(file);
                      }}
                    >
                      <div className={styles.uploadIconArea}>
                        <UploadCloud size={22} />
                      </div>
                      <div className={styles.dropZoneText}>
                        <strong>Click to upload</strong> or drag and drop
                        <p>Attach your lesson file and AI will generate questions from it</p>
                      </div>
                      <div className={styles.formatPills}>
                        <span className={styles.pillPdf}>PDF</span>
                        <span className={styles.pillDoc}>DOCX</span>
                        <span className={styles.pillPpt}>PPTX</span>
                        <span className={styles.pillTxt}>TXT</span>
                      </div>
                    </div>
                  )}

                  {docError && (
                    <div className={styles.docErrorAlert}>
                      <AlertCircle size={16} />
                      <span>{docError}</span>
                    </div>
                  )}
                </div>

                <div className={styles.fieldGroup}>
                  <label>
                    Curriculum Competency / Topic Prompt
                    {attachedDoc && <span className={styles.optionalBadge}>OPTIONAL WITH FILE</span>}
                  </label>
                  <textarea
                    rows={3}
                    placeholder={
                      attachedDoc
                        ? `e.g. Focus on Chapter 3 of ${attachedDoc.name}, or leave blank to cover the whole document`
                        : "Describe topics, concepts, or learning competencies (e.g. Mendelian genetics, Punnett squares, dominant and recessive alleles...)"
                    }
                    value={topicPrompt}
                    onChange={(e) => setTopicPrompt(e.target.value)}
                    className={styles.textarea}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label>Paste Lesson Notes or Syllabus Text (Optional)</label>
                  <textarea
                    rows={3}
                    placeholder="Paste textbook excerpts, lesson summary, or curriculum outline here for deeper contextual accuracy..."
                    value={lessonNotes}
                    onChange={(e) => setLessonNotes(e.target.value)}
                    className={styles.textarea}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.submitBtn}
                    disabled={generatorLoading || isParsingDoc}
                    onClick={handleGenerateAI}
                  >
                    {generatorLoading ? (
                      <>
                        <Loader2 size={18} className={styles.spinner} />
                        Generating with AI...
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        Generate AI Assessment
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* Step 2: Interactive Review & Edit */
              <div className={styles.modalBody}>
                <div className={styles.previewSummary}>
                  <div>
                    <h4>{quizTitle || topicPrompt}</h4>
                    <p>
                      {subject} · {gradeLevel} · {difficulty} Difficulty · {draftQuestions.length} Questions
                    </p>
                  </div>
                  <div className={styles.previewTopBar}>
                    <button
                      className={styles.shuffleBtn}
                      onClick={handleShuffleQuestions}
                      title="Randomize question order and sync answer key"
                      type="button"
                    >
                      <Shuffle size={14} /> Shuffle
                    </button>
                    <button
                      className={styles.backConfigBtn}
                      onClick={() => setStep("config")}
                    >
                      Adjust Parameters
                    </button>
                  </div>
                </div>

                <div className={styles.questionsList}>
                  {draftQuestions.map((q) => {
                    const ans = draftAnswerKey.find(
                      (k) => k.questionNumber === q.questionNumber
                    );
                    return (
                      <div key={q.questionNumber} className={styles.questionItem}>
                        <div className={styles.questionHeader}>
                          <span className={styles.qNum}>#{q.questionNumber}</span>
                          <span className={styles.qType}>{q.type.toUpperCase()}</span>
                          <span className={styles.qKey}>
                            Answer: <strong>{ans?.correctAnswer}</strong>
                          </span>
                        </div>
                        <p className={styles.qText}>{q.questionText}</p>
                        {q.options.length > 0 && (
                          <div className={styles.qOptions}>
                            {q.options.map((opt, oIdx) => (
                              <span key={oIdx} className={styles.optionPill}>
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setStep("config")}
                  >
                    Back
                  </button>
                  <div className={styles.saveActions}>
                    <button
                      type="button"
                      className={styles.draftBtn}
                      onClick={() => handleSaveAssessment("DRAFT")}
                    >
                      <Clock size={16} />
                      Save 7-Day Draft
                    </button>
                    <button
                      type="button"
                      className={styles.submitBtn}
                      onClick={() => handleSaveAssessment("PUBLISHED")}
                    >
                      <CheckCircle2 size={16} />
                      Publish to Classroom
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── VIEW ASSESSMENT MODAL ── */}
      {selectedQuiz && !showPrintModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => setSelectedQuiz(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>{selectedQuiz.quiz_title}</h2>
                <p>
                  {selectedQuiz.subject || "General"} · {selectedQuiz.grade_level || "Grade 10"} ·{" "}
                  {selectedQuiz.questions.length} Questions
                </p>
              </div>
              <button
                className={styles.closeBtn}
                onClick={() => setSelectedQuiz(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.actionBanner}>
                <span>
                  Ready to print scannable sheets with machine-readable optical boxes?
                </span>
                <button
                  className={styles.printActionBtn}
                  onClick={() => setShowPrintModal(true)}
                >
                  <Printer size={16} />
                  Print Scannable Sheet
                </button>
              </div>

              <div className={styles.questionsList}>
                {selectedQuiz.questions.map((q) => {
                  const keyItem = selectedQuiz.answer_key?.find(
                    (k) => k.questionNumber === q.questionNumber
                  );
                  return (
                    <div key={q.questionNumber} className={styles.questionItem}>
                      <div className={styles.questionHeader}>
                        <span className={styles.qNum}>Item {q.questionNumber}</span>
                        <span className={styles.qType}>{q.type}</span>
                        <span className={styles.qKey}>
                          Answer Key: <strong>{keyItem?.correctAnswer || "N/A"}</strong>
                        </span>
                      </div>
                      <p className={styles.qText}>{q.questionText}</p>
                      {q.options && q.options.length > 0 && (
                        <div className={styles.qOptions}>
                          {q.options.map((opt, i) => (
                            <span key={i} className={styles.optionPill}>
                              {opt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── PRINT SCANNABLE BOND PAPER MODAL ── */}
      {showPrintModal && selectedQuiz && createPortal(
        <div className={styles.printOverlay}>
          <div className={styles.printToolbar}>
            <div className={styles.toolbarLeft}>
              <button
                className={styles.backBtn}
                onClick={() => setShowPrintModal(false)}
              >
                <X size={18} /> Close Preview
              </button>
              <div className={styles.paperSelector}>
                <span>Paper Size:</span>
                <button
                  className={`${styles.sizeBtn} ${paperSize === "short" ? styles.sizeActive : ""}`}
                  onClick={() => setPaperSize("short")}
                >
                  Short (8.5×11")
                </button>
                <button
                  className={`${styles.sizeBtn} ${paperSize === "long" ? styles.sizeActive : ""}`}
                  onClick={() => setPaperSize("long")}
                >
                  Long (8.5×13")
                </button>
              </div>
              <label className={styles.checkKeyLabel}>
                <input
                  type="checkbox"
                  checked={includeKeyInPrint}
                  onChange={(e) => setIncludeKeyInPrint(e.target.checked)}
                />
                <span>Include Answer Key Sheet</span>
              </label>
            </div>

            <button
              className={styles.directPrintBtn}
              onClick={() => window.print()}
            >
              <Printer size={18} />
              Print / Save as PDF
            </button>
          </div>

          {/* Printable Bond Paper Document */}
          <div className={styles.sheetContainer}>
            <div
              className={`${styles.paperSheet} ${
                paperSize === "long" ? styles.longPaper : styles.shortPaper
              }`}
              id="printable-assessment-sheet"
            >
              {/* Header */}
              <div className={styles.sheetHeader}>
                <div className={styles.schoolBadge}>
                  <h4>CEBU EASTERN COLLEGE</h4>
                  <p>Basic Education Department · Cebu City, Philippines</p>
                </div>
                <div className={styles.examTitleArea}>
                  <h2 className={styles.sheetExamTitle}>{selectedQuiz.quiz_title}</h2>
                  <div className={styles.sheetSub}>
                    <span>Subject: <strong>{selectedQuiz.subject || "General Education"}</strong></span>
                    <span>Date: <strong>{new Date().toLocaleDateString()}</strong></span>
                  </div>
                </div>
              </div>

              {/* Student Demographics Form with Optical Box Info */}
              <div className={styles.studentHeaderGrid}>
                <div className={styles.studentField}>
                  <span className={styles.fieldLabel}>STUDENT NAME:</span>
                  <div className={styles.fieldLine} />
                </div>
                <div className={styles.studentField}>
                  <span className={styles.fieldLabel}>GRADE & SECTION:</span>
                  <div className={styles.fieldLine} />
                </div>
                <div className={styles.scoreBox}>
                  <span className={styles.scoreLabel}>SCORE</span>
                  <div className={styles.scoreValue}>
                    / {selectedQuiz.questions.length}
                  </div>
                </div>
              </div>

              {/* Optical Instructions */}
              <div className={styles.opticalNotice}>
                <strong>INSTRUCTIONS:</strong> Read each question carefully. Write your answer clearly inside the optical answer box on the right. For multiple choice, write the letter (A, B, C, or D). For True/False, write T or F.
              </div>

              {/* Scannable Question Rows */}
              <div className={styles.sheetQuestions}>
                {selectedQuiz.questions.map((q) => (
                  <div key={q.questionNumber} className={styles.sheetQuestionRow}>
                    <div className={styles.questionMain}>
                      <div className={styles.questionHeading}>
                        <span className={styles.sheetQNum}>{q.questionNumber}.</span>
                        <span className={styles.sheetQText}>{q.questionText}</span>
                      </div>
                      {q.options && q.options.length > 0 && (
                        <div className={styles.sheetChoices}>
                          {q.options.map((opt, i) => (
                            <span key={i} className={styles.sheetChoice}>
                              {opt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* TSEKI Optical Answer Box */}
                    <div className={styles.opticalBoxContainer}>
                      <span className={styles.boxTag}>#{q.questionNumber}</span>
                      <div className={styles.opticalBox} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Paper Footer with machine markers */}
              <div className={styles.sheetFooter}>
                <span>TSEKI VISION-READY FORM · FORM-ID: {selectedQuiz.id.slice(0, 8).toUpperCase()}</span>
                <span className={styles.alignmentMarker}>[ + TSEKI OPTICAL OCR ALIGNED + ]</span>
              </div>
            </div>

            {/* Optional Answer Key Sheet */}
            {includeKeyInPrint && (
              <div
                className={`${styles.paperSheet} ${styles.keySheet} ${
                  paperSize === "long" ? styles.longPaper : styles.shortPaper
                }`}
              >
                <div className={styles.sheetHeader}>
                  <h4>CEBU EASTERN COLLEGE — OFFICIAL ANSWER KEY</h4>
                  <h2>{selectedQuiz.quiz_title}</h2>
                </div>
                <div className={styles.keyGrid}>
                  {selectedQuiz.answer_key?.map((k) => (
                    <div key={k.questionNumber} className={styles.keyRow}>
                      <span className={styles.kNum}>Item {k.questionNumber}</span>
                      <span className={styles.kAnswer}>{k.correctAnswer}</span>
                      <span className={styles.kPts}>{k.points || 1} pt</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
