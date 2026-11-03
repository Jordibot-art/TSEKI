import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  FileText,
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
import {
  getTeacherQuotaState,
  checkCanGenerate,
  recordGenerationSuccess,
  recordGenerationFailure,
  type QuotaState,
} from "../lib/aiQuotaService";
import { validateAnswerLengths } from "../lib/answerValidator";
import { shuffleAssessmentForVersion } from "../lib/versionShuffle";
import { showAlert, showConfirm } from "../components/CustomAlertModal";
import { ExportPdfModal } from "../components/ExportPdfModal";
import type { GeneratedAssessment } from "../lib/printEngine";
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

  // Daily Quota Tracking (10x limit resetting at 12:00 AM Manila)
  const [quota, setQuota] = useState<QuotaState | null>(null);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [generatorLoading, setGeneratorLoading] = useState(false);
  const [generatorStatus, setGeneratorStatus] = useState<string>("");
  const [isAiBusy, setIsAiBusy] = useState(false);

  // Publishing Loading Modal State
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingStage, setPublishingStage] = useState<string>("");

  const [targetClassroom, setTargetClassroom] = useState<string>("");
  const [quizTitle, setQuizTitle] = useState("");
  const [subject, setSubject] = useState("General Science");
  const [gradeLevel, setGradeLevel] = useState("Grade 10");
  const [difficulty, setDifficulty] = useState("Medium (Application & Analysis)");
  const [questionType, setQuestionType] = useState<QuestionType | "mixed">("multiple_choice");
  const [mixedTypes, setMixedTypes] = useState<string[]>(["multiple_choice", "enumeration", "true_false"]);
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
  const [printSet, setPrintSet] = useState<"A" | "B" | "C">("A");

  // Export Paper Sheet Layout Modal (matching mobile TSEKI PDF format)
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportAssessment, setExportAssessment] = useState<GeneratedAssessment | null>(null);
  const [exportClassTitle, setExportClassTitle] = useState<string>("");
  const [exportSubject, setExportSubject] = useState<string>("");
  const [exportGradeLevel, setExportGradeLevel] = useState<string>("");
  const [exportQuizId, setExportQuizId] = useState<string>("");

  const handleOpenExportModal = (
    quiz: StoredQuiz | GeneratedAssessment,
    classroomName?: string
  ) => {
    if ("quizTitle" in quiz && "questions" in quiz) {
      const gen = quiz as GeneratedAssessment;
      setExportAssessment(gen);
      setExportClassTitle(
        classroomName ||
          classrooms.find((c) => c.id === targetClassroom)?.title ||
          "Classroom Assessment"
      );
      setExportSubject(subject || "General Education");
      setExportGradeLevel(gradeLevel || gen.gradeLevel || "Grade 10");
      setExportQuizId(`QZ-${Date.now().toString().slice(-6)}`);
    } else {
      const stored = quiz as StoredQuiz;
      setExportAssessment({
        quizTitle: stored.quiz_title,
        gradeLevel: stored.grade_level || undefined,
        difficulty: stored.difficulty || undefined,
        questions: stored.questions,
        answerKey: stored.answer_key,
      });
      setExportClassTitle(stored.classroom_name || "Classroom Assessment");
      setExportSubject(stored.subject || "General Education");
      setExportGradeLevel(stored.grade_level || "Grade 10");
      setExportQuizId(stored.id || `QZ-${Date.now().toString().slice(-6)}`);
    }
    setShowExportModal(true);
  };

  useEffect(() => {
    if (user) {
      loadData();
      refreshQuota();
    }
  }, [user]);

  async function refreshQuota() {
    if (!user) return;
    try {
      const q = await getTeacherQuotaState(user.id);
      setQuota(q);
    } catch (err) {
      console.warn("Could not load quota state:", err);
    }
  }

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
      showAlert({
        title: "Missing Topic or File",
        message: "Please enter an assessment title, topic prompt, or attach a curriculum document.",
        type: "info",
      });
      return;
    }

    // 1. Enforce Per-Teacher 10x Daily Limit (Resets 12:00 AM Manila)
    const canGen = await checkCanGenerate(user?.id);
    if (!canGen.allowed) {
      showAlert({
        title: "Daily Limit Reached",
        message:
          canGen.message ||
          "You have used all 10 of your daily AI generations. Limit resets at 12:00 AM Manila time.",
        type: "limit",
      });
      return;
    }

    setGeneratorLoading(true);
    setGeneratorStatus("Initializing AI assessment generator...");
    setIsAiBusy(false);

    try {
      let effectiveQuestionType: any = questionType;
      if (questionType === "mixed" && mixedTypes.length > 0) {
        const typeLabels: Record<string, string> = {
          multiple_choice: "Multiple Choice",
          enumeration: "Enumeration",
          true_false: "True / False",
          identification: "Identification",
          word_box: "Word Box",
        };
        const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
        const selectedLabels = mixedTypes.map(
          (k, idx) => `Part ${romanNumerals[idx]}. ${typeLabels[k] || k}`
        );
        effectiveQuestionType = `Mixed Assessment (include ONLY these parts sequentially: ${selectedLabels.join(
          ", "
        )})`;
      }

      const generated = await generateScannableQuiz({
        topic: effectiveTopic || "Curriculum Assessment",
        subject,
        gradeLevel,
        difficulty,
        questionType: effectiveQuestionType,
        questionCount,
        attachedPdfBase64: attachedDoc?.type === "pdf" ? attachedDoc.base64 : undefined,
        attachedPdfName: attachedDoc?.type === "pdf" ? attachedDoc.name : undefined,
        attachedFileName: attachedDoc?.name,
        attachedFileType: attachedDoc?.type,
        attachedFileText: attachedDoc?.text,
        lessonNotes: lessonNotes.trim(),
        onStatusUpdate: (status, busy) => {
          setGeneratorStatus(status);
          setIsAiBusy(Boolean(busy));
        },
      });

      // Record successful generation in `public.ai_generation_logs`
      if (user?.id) {
        const updatedQuota = await recordGenerationSuccess(user.id);
        setQuota(updatedQuota);
      }

      if (!quizTitle.trim() && generated.quizTitle) {
        setQuizTitle(generated.quizTitle);
      }

      setDraftQuestions(generated.questions);
      setDraftAnswerKey(generated.answerKey);
      setStep("preview");
    } catch (err: any) {
      console.error("AI Generation error:", err);
      if (user?.id) {
        await recordGenerationFailure(user.id, err?.message);
        await refreshQuota();
      }
      showAlert({
        title: "Generation Error",
        message: err?.message?.includes("503")
          ? "AI Service is temporarily busy. Please wait a moment and try again."
          : `Failed to generate assessment: ${err?.message || "Unknown error"}`,
        type: "error",
      });
    } finally {
      setGeneratorLoading(false);
      setGeneratorStatus("");
      setIsAiBusy(false);
    }
  }

  async function handleSaveAssessment(targetStatus: "DRAFT" | "PUBLISHED") {
    if (!quizTitle.trim()) {
      showAlert({
        title: "Assessment Title Required",
        message: "Please provide an assessment title before saving.",
        type: "info",
      });
      return;
    }

    // 2. Paper Answer Box Length Validation (max 25 chars / 3 words)
    if (targetStatus === "PUBLISHED") {
      const flagged = validateAnswerLengths({
        quizTitle,
        questions: draftQuestions,
        answerKey: draftAnswerKey,
      });

      if (flagged.length > 0) {
        const flaggedDetails = flagged
          .slice(0, 5)
          .map(
            (f) =>
              `• Q#${f.questionNumber}: "${f.answer}" (${f.charCount} chars, ${f.wordCount} words)`
          )
          .join("\n");

        const proceed = await showConfirm({
          title: "Long Answers Detected",
          message: `Some answers exceed the scannable box limit (max 25 chars / 3 words):\n\n${flaggedDetails}${
            flagged.length > 5 ? `\n...and ${flagged.length - 5} more.` : ""
          }\n\nYou can shorten them on the preview cards or publish anyway.`,
          confirmText: "Publish Anyway",
          cancelText: "Shorten Answers",
          isDestructive: false,
        });

        if (!proceed) return;
      }
    }

    // 3. Smooth Publishing Loading Feedback
    setIsPublishing(true);
    setPublishingStage(
      targetStatus === "PUBLISHED"
        ? `Mapping scannable answer boxes for "${quizTitle}"...`
        : `Saving draft to cloud archive...`
    );

    // Yield execution for the loading overlay to paint smoothly
    await new Promise((r) => setTimeout(r, 60));

    try {
      const selectedClass = classrooms.find((c) => c.id === targetClassroom);
      setPublishingStage(
        targetStatus === "PUBLISHED"
          ? `Publishing to ${selectedClass ? selectedClass.title : "Classroom"} and archiving...`
          : `Updating assessment records...`
      );

      const quizId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });

      const payload = {
        id: quizId,
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
        showAlert({
          title: "Save Failed",
          message: "Failed to save assessment to Supabase: " + error.message,
          type: "error",
        });
        return;
      }

      setShowCreateModal(false);
      resetCreateForm();
      await loadData();

      showAlert({
        title: targetStatus === "PUBLISHED" ? "Quiz Published!" : "Draft Saved!",
        message: `"${quizTitle}" is saved to your Archive and ready for student test printing.`,
        type: "success",
      });
    } catch (err: any) {
      console.error(err);
      showAlert({
        title: "Save Error",
        message: "An unexpected error occurred while saving the assessment.",
        type: "error",
      });
    } finally {
      setIsPublishing(false);
      setPublishingStage("");
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
    setGeneratorStatus("");
    setIsAiBusy(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDeleteQuiz(quizId: string) {
    const confirmed = await showConfirm({
      title: "Delete Assessment?",
      message:
        "Are you sure you want to permanently delete this assessment? All associated answer keys will be removed.",
      confirmText: "Delete",
      cancelText: "Cancel",
      isDestructive: true,
    });

    if (!confirmed) return;

    try {
      const { error } = await supabase.from("archived_assessments").delete().eq("id", quizId);
      if (error) {
        showAlert({
          title: "Delete Failed",
          message: "Failed to delete quiz: " + error.message,
          type: "error",
        });
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

  // Active Print Quiz computed with deterministic anti-cheating Set A, Set B, Set C
  const activePrintQuiz = useMemo(() => {
    if (!selectedQuiz) return null;
    if (printSet === "A") return selectedQuiz;
    const shuffled = shuffleAssessmentForVersion(
      {
        quizTitle: selectedQuiz.quiz_title,
        questions: selectedQuiz.questions,
        answerKey: selectedQuiz.answer_key,
      },
      printSet,
      selectedQuiz.id
    );
    return {
      ...selectedQuiz,
      questions: shuffled.questions,
      answer_key: shuffled.answerKey,
    };
  }, [selectedQuiz, printSet]);

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
          <h1 className={styles.title}>Assessments & Tests</h1>
          <p className={styles.subtitle}>
            Design, calibrate, and print paper assessments formatted for optical camera grading.
          </p>
        </div>
        <button
          className={styles.createBtn}
          onClick={() => {
            resetCreateForm();
            setShowCreateModal(true);
            refreshQuota();
          }}
        >
          <Sparkles size={18} />
          Create with AI Builder
        </button>
      </div>

      {/* ── Daily AI Generation Quota Banner ── */}
      {quota && (
        <div className={styles.quotaBanner}>
          <div className={styles.quotaLeft}>
            <div className={styles.quotaIcon}>
              <Sparkles size={18} />
            </div>
            <div>
              <div className={styles.quotaTitle}>
                <span>Daily AI Quota:</span>
                <span
                  className={`${styles.quotaCountBadge} ${
                    quota.remainingToday <= 0 ? styles.quotaCountBadgeZero : ""
                  }`}
                >
                  {quota.remainingToday} / {quota.dailyLimit} remaining today
                </span>
              </div>
              <div className={styles.quotaSub}>
                Each teacher has 10 AI quiz generations per day.
              </div>
            </div>
          </div>
          <div className={styles.quotaResetNote}>
            Resets daily at <strong>12:00 AM midnight</strong> (Manila, Philippines)
          </div>
        </div>
      )}

      {/* Control Bar: Filters & Search */}
      <div className={styles.controlBar}>
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by quiz title, subject, or classroom..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filtersGroup}>
          <div className={styles.filterItem}>
            <label>Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={styles.select}
            >
              <option value="ALL">All Status</option>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Drafts</option>
            </select>
          </div>

          <div className={styles.filterItem}>
            <label>Classroom:</label>
            <select
              value={classroomFilter}
              onChange={(e) => setClassroomFilter(e.target.value)}
              className={styles.select}
            >
              <option value="ALL">All Classrooms</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quizzes List */}
      {loading ? (
        <div className={styles.loadingState}>
          <Loader2 size={32} className="spinner" />
          <p>Loading your assessments...</p>
        </div>
      ) : filteredQuizzes.length === 0 ? (
        <div className={styles.emptyState}>
          <FileText size={48} strokeWidth={1} />
          <h3>No assessments found</h3>
          <p>
            {searchQuery
              ? "No quizzes match your search criteria."
              : "Generate an assessment using AI or create one from your curriculum docs."}
          </p>
          {!searchQuery && (
            <button
              className={styles.emptyBtn}
              onClick={() => {
                resetCreateForm();
                setShowCreateModal(true);
              }}
            >
              <Sparkles size={16} />
              Open AI Builder
            </button>
          )}
        </div>
      ) : (
        <div className={styles.quizGrid}>
          {filteredQuizzes.map((quiz) => {
            const isDraft = quiz.status === "DRAFT";
            const countdown = isDraft ? getDraftCountdown(quiz.created_at) : null;

            return (
              <div key={quiz.id} className={styles.quizCard}>
                <div className={styles.cardTopRow}>
                  <div className={styles.quizIconSquare}>
                    <FileText size={20} />
                  </div>
                  <div className={styles.cardHeaderRight}>
                    <div className={styles.badgeRow}>
                      <span
                        className={`${styles.statusBadge} ${
                          isDraft ? styles.statusDraft : styles.statusPublished
                        }`}
                      >
                        {isDraft ? (
                          <>
                            <Clock size={12} />
                            Draft {countdown ? `(${countdown.text})` : ""}
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={12} />
                            Published
                          </>
                        )}
                      </span>
                      <span className={styles.gradeBadge}>
                        {quiz.grade_level || "Grade 10"}
                      </span>
                    </div>

                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDeleteQuiz(quiz.id)}
                      title="Delete assessment"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <h3 className={styles.cardTitle}>{quiz.quiz_title}</h3>

                <div className={styles.metaRow}>
                  <span className={styles.subjectText}>{quiz.subject || "General Science"}</span>
                  <span className={styles.dot}>•</span>
                  <span>{quiz.difficulty || "Medium"}</span>
                </div>

                <div className={styles.cardDetails}>
                  <div className={styles.detailItem}>
                    <GraduationCap size={14} />
                    <span>{quiz.classroom_name || "Unassigned"}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <Layers size={14} />
                    <span>{quiz.questions.length} Questions</span>
                  </div>
                </div>

                <div className={styles.cardActions}>
                  <button
                    className={styles.actionBtnOutline}
                    onClick={() => setSelectedQuiz(quiz)}
                  >
                    <Eye size={15} />
                    View & Questions
                  </button>
                  <button
                    className={styles.actionBtnSolid}
                    onClick={() => handleOpenExportModal(quiz, quiz.classroom_name)}
                  >
                    <Printer size={15} />
                    Print Sheets
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CREATE ASSESSMENT MODAL (AI BUILDER) ── */}
      {showCreateModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => !generatorLoading && !isPublishing && setShowCreateModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.headerTitleWrap}>
                <div className={styles.modalIconWrap}>
                  <Sparkles size={20} />
                </div>
                <div>
                  <h2>AI Assessment Builder</h2>
                  <p>Calibrated to Bloom's Taxonomy & Optical Paper Sheet Layout</p>
                </div>
              </div>
              <button
                className={styles.closeBtn}
                onClick={() => !generatorLoading && !isPublishing && setShowCreateModal(false)}
                disabled={generatorLoading || isPublishing}
              >
                <X size={20} />
              </button>
            </div>

            {/* Quota Indicator inside modal */}
            {quota && (
              <div style={{ padding: "0 28px", marginTop: "12px" }}>
                <div className={styles.quotaBanner} style={{ margin: 0, padding: "8px 14px" }}>
                  <div className={styles.quotaLeft}>
                    <Sparkles size={15} color="var(--orange-500)" />
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>
                      Daily Generations: {quota.remainingToday} / {quota.dailyLimit} remaining
                    </span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "var(--text-tertiary)" }}>
                    Resets 12:00 AM Manila
                  </span>
                </div>
              </div>
            )}

            {step === "config" ? (
              /* Step 1: Configuration Form */
              <div className={styles.modalBody}>
                {/* Topic / Title */}
                <div className={styles.formGroup}>
                  <label>Assessment Title / Primary Topic *</label>
                  <input
                    type="text"
                    placeholder="e.g. Cellular Respiration and Photosynthesis"
                    value={topicPrompt}
                    onChange={(e) => setTopicPrompt(e.target.value)}
                    className={styles.input}
                    autoFocus
                  />
                </div>

                {/* Grade & Subject */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Grade Level</label>
                    <select
                      value={gradeLevel}
                      onChange={(e) => setGradeLevel(e.target.value)}
                      className={styles.select}
                    >
                      <option>Grade 7</option>
                      <option>Grade 8</option>
                      <option>Grade 9</option>
                      <option>Grade 10</option>
                      <option>Grade 11 (SHS)</option>
                      <option>Grade 12 (SHS)</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Subject</label>
                    <input
                      type="text"
                      placeholder="e.g. Science / Biology"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                </div>

                {/* Bloom's Difficulty & Question Count */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Bloom's Difficulty</label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className={styles.select}
                    >
                      <option value="Easy (Recall & Understanding)">Easy (Recall & Understanding)</option>
                      <option value="Medium (Application & Analysis)">Medium (Application & Analysis)</option>
                      <option value="Hard (Evaluation & Synthesis)">Hard (Evaluation & Synthesis)</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Number of Questions</label>
                    <select
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      className={styles.select}
                    >
                      <option value={5}>5 Questions</option>
                      <option value={10}>10 Questions</option>
                      <option value={15}>15 Questions</option>
                      <option value={20}>20 Questions</option>
                      <option value={25}>25 Questions</option>
                      <option value={30}>30 Questions</option>
                      <option value={40}>40 Questions</option>
                    </select>
                  </div>
                </div>

                {/* Target Classroom */}
                <div className={styles.formGroup}>
                  <label>Assign to Classroom (Optional)</label>
                  <select
                    value={targetClassroom}
                    onChange={(e) => setTargetClassroom(e.target.value)}
                    className={styles.select}
                  >
                    <option value="">No Classroom (Draft / Unassigned)</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} — {c.subject}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Question Type Selection */}
                <div className={styles.formGroup}>
                  <label>Question Type</label>
                  <div className={styles.typeGrid}>
                    {[
                      { key: "multiple_choice", label: "Multiple Choice" },
                      { key: "true_false", label: "True / False" },
                      { key: "identification", label: "Identification" },
                      { key: "enumeration", label: "Enumeration" },
                      { key: "word_box", label: "Word Box" },
                      { key: "mixed", label: "Mixed Assessment" },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`${styles.typeBtn} ${
                          questionType === t.key ? styles.typeBtnActive : ""
                        }`}
                        onClick={() => setQuestionType(t.key as any)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Mixed Type Checklist */}
                  {questionType === "mixed" && (
                    <div className={styles.mixedTypesContainer}>
                      <span className={styles.mixedTypesTitle}>
                        Select question types to include in sequential parts:
                      </span>
                      <div className={styles.mixedChecklist}>
                        {[
                          { key: "multiple_choice", label: "Multiple Choice" },
                          { key: "enumeration", label: "Enumeration" },
                          { key: "true_false", label: "True / False" },
                          { key: "identification", label: "Identification" },
                          { key: "word_box", label: "Word Box" },
                        ].map((item) => {
                          const checked = mixedTypes.includes(item.key);
                          return (
                            <label key={item.key} className={styles.mixedCheckLabel}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  if (checked && mixedTypes.length <= 1) {
                                    showAlert({
                                      title: "Minimum Selection",
                                      message: "Please keep at least one question type selected.",
                                      type: "info",
                                    });
                                    return;
                                  }
                                  setMixedTypes(
                                    checked
                                      ? mixedTypes.filter((k) => k !== item.key)
                                      : [...mixedTypes, item.key]
                                  );
                                }}
                              />
                              <span>{item.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Curriculum Document Attachment */}
                <div className={styles.formGroup}>
                  <label>Attach Curriculum Document (Optional)</label>
                  <p className={styles.helpText}>
                    Supports PDF, DOCX, PPTX, or TXT. Questions will be strictly grounded in its contents.
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.pptx,.ppt,.txt"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                  />

                  {attachedDoc ? (
                    <div className={styles.attachedDocCard}>
                      <div className={styles.docInfo}>
                        <div
                          className={styles.docBadge}
                          style={{ background: getDocBadgeInfo(attachedDoc.type).color }}
                        >
                          {getDocBadgeInfo(attachedDoc.type).label}
                        </div>
                        <div className={styles.docDetails}>
                          <span className={styles.docName}>{attachedDoc.name}</span>
                          <span className={styles.docMeta}>
                            {(attachedDoc.size / 1024).toFixed(1)} KB · Content extracted
                          </span>
                        </div>
                      </div>
                      <div className={styles.docActions}>
                        <button
                          type="button"
                          className={styles.changeFileBtn}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          className={styles.removeFileBtn}
                          onClick={handleRemoveFile}
                          title="Remove file"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleFileSelected(file);
                      }}
                    >
                      {isParsingDoc ? (
                        <div className={styles.dropZoneLoading}>
                          <Loader2 size={24} className="spinner" />
                          <span>Extracting text & curriculum concepts...</span>
                        </div>
                      ) : (
                        <>
                          <UploadCloud size={28} className={styles.uploadIcon} />
                          <span className={styles.dropTitle}>Click or drag curriculum file here</span>
                          <span className={styles.dropSub}>PDF, DOCX, PPTX, or TXT up to 10MB</span>
                        </>
                      )}
                    </div>
                  )}

                  {docError && (
                    <div className={styles.docErrorAlert}>
                      <AlertCircle size={14} />
                      <span>{docError}</span>
                    </div>
                  )}
                </div>

                {/* Additional Lesson Notes */}
                <div className={styles.formGroup}>
                  <label>Teacher Notes / Key Focus Points (Optional)</label>
                  <textarea
                    rows={3}
                    placeholder="e.g. Focus specifically on the light-dependent reactions; exclude anaerobic fermentation..."
                    value={lessonNotes}
                    onChange={(e) => setLessonNotes(e.target.value)}
                    className={styles.textarea}
                  />
                </div>

                {/* Live Generator Status Box */}
                {generatorLoading && generatorStatus && (
                  <div
                    className={`${styles.generatorStatusBox} ${
                      isAiBusy ? styles.generatorStatusBusy : ""
                    }`}
                  >
                    <Loader2 size={16} className="spinner" />
                    <span>{generatorStatus}</span>
                  </div>
                )}

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setShowCreateModal(false)}
                    disabled={generatorLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.generateSubmitBtn}
                    onClick={handleGenerateAI}
                    disabled={generatorLoading}
                  >
                    {generatorLoading ? (
                      <>
                        <Loader2 size={18} className="spinner" />
                        Generating Assessment...
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
                      {subject} · {gradeLevel} · {difficulty} · {draftQuestions.length} Questions
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
                    disabled={isPublishing}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.exportPaperBtn}
                    onClick={() => {
                      if (draftQuestions.length > 0) {
                        handleOpenExportModal({
                          quizTitle: quizTitle.trim() || topicPrompt.trim() || "Assessment",
                          questions: draftQuestions,
                          answerKey: draftAnswerKey,
                          gradeLevel,
                          difficulty,
                        });
                      }
                    }}
                    disabled={isPublishing}
                  >
                    <Printer size={16} />
                    Export Paper Sheet (PDF)
                  </button>
                  <div className={styles.saveActions}>
                    <button
                      type="button"
                      className={styles.draftBtn}
                      onClick={() => handleSaveAssessment("DRAFT")}
                      disabled={isPublishing}
                    >
                      <Clock size={16} />
                      Save 7-Day Draft
                    </button>
                    <button
                      type="button"
                      className={styles.submitBtn}
                      onClick={() => handleSaveAssessment("PUBLISHED")}
                      disabled={isPublishing}
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

      {/* ── PUBLISHING FULL-SCREEN LOADING OVERLAY ── */}
      {isPublishing && createPortal(
        <div className={styles.publishingOverlay}>
          <div className={styles.publishingCard}>
            <div className={styles.publishingSpinnerWrap}>
              <Loader2 size={32} className="spinner" />
            </div>
            <h3 className={styles.publishingTitle}>Publishing Assessment</h3>
            <p className={styles.publishingStage}>
              {publishingStage || "Processing assessment and syncing with your classroom..."}
            </p>
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
                  onClick={() => handleOpenExportModal(selectedQuiz, selectedQuiz.classroom_name)}
                >
                  <Printer size={16} />
                  Print Scannable Sheet (PDF)
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
      {showPrintModal && activePrintQuiz && createPortal(
        <div className={styles.printOverlay}>
          <div className={styles.printToolbar}>
            <div className={styles.toolbarLeft}>
              <button
                className={styles.backBtn}
                onClick={() => setShowPrintModal(false)}
              >
                <X size={18} /> Close Preview
              </button>

              {/* Anti-Cheating Set Selector (Set A / B / C) */}
              <div className={styles.setButtons}>
                {(["A", "B", "C"] as const).map((ver) => (
                  <button
                    key={ver}
                    type="button"
                    className={`${styles.setPill} ${printSet === ver ? styles.setPillActive : ""}`}
                    onClick={() => setPrintSet(ver)}
                  >
                    Set {ver}
                  </button>
                ))}
              </div>

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
                  <h2 className={styles.sheetExamTitle}>
                    {activePrintQuiz.quiz_title} — SET {printSet}
                  </h2>
                  <div className={styles.sheetSub}>
                    <span>Subject: <strong>{activePrintQuiz.subject || "General Education"}</strong></span>
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
                    / {activePrintQuiz.questions.length}
                  </div>
                </div>
              </div>

              {/* Optical Instructions */}
              <div className={styles.opticalNotice}>
                <strong>INSTRUCTIONS:</strong> Read each question carefully. Write your answer clearly inside the optical answer box on the right. For multiple choice, write the letter (A, B, C, or D). For True/False, write T or F.
              </div>

              {/* Scannable Question Rows */}
              <div className={styles.sheetQuestions}>
                {activePrintQuiz.questions.map((q) => (
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
                <span>
                  TSEKI VISION-READY FORM · FORM-ID: {activePrintQuiz.id?.slice(0, 8).toUpperCase() || "TSEKI"} · SET {printSet}
                </span>
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
                  <h4>CEBU EASTERN COLLEGE — OFFICIAL ANSWER KEY (SET {printSet})</h4>
                  <h2>{activePrintQuiz.quiz_title}</h2>
                </div>
                <div className={styles.keyGrid}>
                  {activePrintQuiz.answer_key?.map((k) => (
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

      {/* ── EXPORT PAPER SHEET LAYOUT MODAL (MATCHING MOBILE TSEKI) ── */}
      <ExportPdfModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        assessment={exportAssessment}
        classTitle={exportClassTitle}
        subject={exportSubject}
        gradeLevel={exportGradeLevel}
        quizId={exportQuizId}
      />
    </div>
  );
}
