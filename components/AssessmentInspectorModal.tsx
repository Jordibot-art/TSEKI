import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AnswerKeyItem,
  QuestionType,
  regenerateSingleQuestion,
  ScannableQuestion,
} from "../lib/quizGeneratorService";
import { getDraftTimeRemaining, StoredQuiz } from "../lib/quizStore";
import { PdfExportingAnimation } from "./PdfExportingAnimation";
import { PublishingQuizAnimation } from "./PublishingQuizAnimation";
import { SmoothInlineOverlay } from "./SmoothModalTransition";

// ── Helpers ───────────────────────────────────────────────────────────────────
function isChoiceAnswer(choice: string, answer: string, choiceIndex: number): boolean {
  if (!choice || !answer) return false;
  const cClean = choice.trim();
  const aClean = answer.trim();
  if (cClean === aClean) return true;
  if (cClean.toLowerCase() === aClean.toLowerCase()) return true;

  const stripFormatting = (str: string) =>
    str
      .replace(/^['"`(]+|['"`) .]+$/g, "")
      .replace(/['"`*_]/g, "")
      .trim();

  const cNorm = stripFormatting(cClean).toLowerCase();
  const aNorm = stripFormatting(aClean).toLowerCase();
  if (cNorm === aNorm) return true;

  const optionLetter = String.fromCharCode(65 + choiceIndex);
  const letterMatch = aNorm.match(/^(?:option\s+)?([a-d])(?:\)|\.|\:|$)/i);
  if (letterMatch && letterMatch[1].toUpperCase() === optionLetter) {
    return true;
  }

  const stripPrefix = (str: string) =>
    str.replace(/^(?:[a-d]\s*[\)\.\:\-]|option\s+[a-d][\:\.]?)\s*/i, "").trim();

  const cStripped = stripFormatting(stripPrefix(cClean)).toLowerCase();
  const aStripped = stripFormatting(stripPrefix(aClean)).toLowerCase();

  if (cStripped.length > 0 && cStripped === aStripped) return true;
  if ((aStripped === "t" && cStripped === "true") || (aStripped === "f" && cStripped === "false")) {
    return true;
  }
  if (cStripped.length > 1 && aStripped.length > 1) {
    if (aStripped.includes(cStripped) || cStripped.includes(aStripped)) {
      return true;
    }
  }
  return false;
}

function formatTypeLabel(type: QuestionType | string): string {
  switch (type) {
    case "multiple_choice":
      return "Multiple Choice";
    case "true_false":
      return "True / False";
    case "identification":
      return "Identification";
    case "fill_blank":
      return "Fill in Blank";
    case "enumeration":
      return "Enumeration";
    case "word_box":
      return "Word Box";
    default:
      return String(type || "Question").replace(/_/g, " ");
  }
}

type Props = {
  visible: boolean;
  quiz: StoredQuiz | null;
  darkMode: boolean;
  themeColor: string;
  exportingPdf: boolean;
  cancellingExport?: boolean;
  exportModalVisible: boolean;
  exportVersion: "A" | "B" | "C";
  selectedExportQuizTitle?: string;
  onClose: () => void;
  onPublishDraft: (quiz: StoredQuiz) => void;
  onExportPdf: (quiz: StoredQuiz) => void;
  onCancelExportPdf?: () => void;
  onSaveDraft?: (quiz: StoredQuiz) => Promise<void> | void;
  onQuizUpdated?: (quiz: StoredQuiz) => Promise<void> | void;
  publishingDraft?: boolean;
  publishingQuizTitle?: string;
};

export function AssessmentInspectorModal({
  visible,
  quiz,
  darkMode,
  themeColor,
  exportingPdf,
  cancellingExport = false,
  exportModalVisible,
  exportVersion,
  selectedExportQuizTitle,
  onClose,
  onPublishDraft,
  onExportPdf,
  onCancelExportPdf,
  onSaveDraft,
  onQuizUpdated,
  publishingDraft = false,
  publishingQuizTitle,
}: Props) {
  const insets = useSafeAreaInsets();
  const isDraft = quiz?.status === "DRAFT";

  // ── Dynamic Colors (matching AIBuilderTab) ─────────────────────────────────
  const bg = darkMode ? "#111827" : "#F9FAFB";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#E2E8F0";
  const inputBg = darkMode ? "#374151" : "#F9FAFB";
  const accentColor = themeColor || "#EA580C";

  // ── Draft inline editing state ─────────────────────────────────────────────
  const [editingQuestionQNum, setEditingQuestionQNum] = useState<number | null>(null);
  const [editingQuestionText, setEditingQuestionText] = useState("");
  const [editingAnswerQNum, setEditingAnswerQNum] = useState<number | null>(null);
  const [editingAnswerText, setEditingAnswerText] = useState("");
  const [regeneratingQNum, setRegeneratingQNum] = useState<number | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  // ── Change Question Type sheet state (Drafts) ──────────────────────────────
  const [changeTypeModalOpen, setChangeTypeModalOpen] = useState(false);
  const [selectedQForTypeChange, setSelectedQForTypeChange] = useState<ScannableQuestion | null>(null);
  const [selectedNewType, setSelectedNewType] = useState<QuestionType>("multiple_choice");

  // ── Add Question Manually sheet state (Drafts) ─────────────────────────────
  const [addQuestionModalOpen, setAddQuestionModalOpen] = useState(false);
  const [manualQType, setManualQType] = useState<QuestionType>("multiple_choice");
  const [manualQText, setManualQText] = useState("");
  const [manualChoices, setManualChoices] = useState<string[]>(["", "", "", ""]);
  const [manualCorrectAnswer, setManualCorrectAnswer] = useState("A");
  const [manualPoints, setManualPoints] = useState("1");
  const [manualEnumCount, setManualEnumCount] = useState("3");

  // ── Toast state ────────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastFadeAnim = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    Animated.timing(toastFadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastFadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setToastMessage(null);
      });
    }, 2200);
  }

  // Reset transient editing states whenever modal closes, switches quiz, or leaves draft mode
  useEffect(() => {
    if (!visible || !isDraft) {
      setEditingQuestionQNum(null);
      setEditingQuestionText("");
      setEditingAnswerQNum(null);
      setEditingAnswerText("");
      setChangeTypeModalOpen(false);
      setSelectedQForTypeChange(null);
      setAddQuestionModalOpen(false);
    }
    if (!visible) {
      setToastMessage(null);
    }
  }, [visible, isDraft, quiz?.id]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ── Section grouping (identical to AIBuilderTab) ───────────────────────────
  const assessmentSections = useMemo(() => {
    const questions = quiz?.questions || [];
    const answerKey = quiz?.answerKey || [];
    if (!questions.length) return [];

    const sections: {
      partNumber: number;
      roman: string;
      type: QuestionType;
      title: string;
      questions: ScannableQuestion[];
      startNum: number;
      endNum: number;
      totalPoints: number;
    }[] = [];

    const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
    let currentType: QuestionType | null = null;
    let currentList: ScannableQuestion[] = [];

    const pushSection = (type: QuestionType, list: ScannableQuestion[]) => {
      const pNum = sections.length + 1;
      const roman = ROMANS[sections.length] || `${pNum}`;
      const pts = list.reduce((sum, item) => {
        const a = answerKey.find((k) => k.questionNumber === item.questionNumber);
        return sum + (a ? a.points : item.type === "enumeration" ? item.answerBoxesRequired || 3 : 1);
      }, 0);
      sections.push({
        partNumber: pNum,
        roman,
        type,
        title: `PART ${roman} · ${formatTypeLabel(type).toUpperCase()}`,
        questions: list,
        startNum: list[0].questionNumber,
        endNum: list[list.length - 1].questionNumber,
        totalPoints: pts,
      });
    };

    questions.forEach((q) => {
      if (currentType === null || q.type === currentType) {
        currentType = q.type;
        currentList.push(q);
      } else {
        pushSection(currentType, currentList);
        currentType = q.type;
        currentList = [q];
      }
    });

    if (currentList.length > 0 && currentType !== null) {
      pushSection(currentType, currentList);
    }

    return sections;
  }, [quiz]);

  const totalPoints = useMemo(() => {
    const questions = quiz?.questions || [];
    const answerKey = quiz?.answerKey || [];
    return questions.reduce((sum, q) => {
      const a = answerKey.find((k) => k.questionNumber === q.questionNumber);
      return sum + (a ? a.points : q.type === "enumeration" ? q.answerBoxesRequired || 3 : 1);
    }, 0);
  }, [quiz]);

  const formattedDate = useMemo(() => {
    if (!quiz?.createdAt) return "";
    return new Date(quiz.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [quiz?.createdAt]);

  const timeInfo = useMemo(() => {
    if (!quiz || !isDraft) return null;
    return getDraftTimeRemaining(quiz);
  }, [quiz, isDraft]);

  // ── Draft mutation helpers ─────────────────────────────────────────────────
  async function commitDraftUpdate(updated: StoredQuiz) {
    if (onQuizUpdated) {
      await onQuizUpdated(updated);
    }
  }

  function handleSaveQuestionTextEdit(questionNumber: number) {
    if (!quiz) return;
    const trimmed = editingQuestionText.trim();
    if (!trimmed) {
      setEditingQuestionQNum(null);
      return;
    }
    const updatedQ = quiz.questions.map((q) =>
      q.questionNumber === questionNumber ? { ...q, questionText: trimmed } : q
    );
    commitDraftUpdate({ ...quiz, questions: updatedQ });
    setEditingQuestionQNum(null);
    setEditingQuestionText("");
    showToast("✓ Question updated");
  }

  function handleSaveInlineAnswerEdit(questionNumber: number) {
    if (!quiz) return;
    const trimmed = editingAnswerText.trim();
    if (!trimmed) return;
    const updatedKey = quiz.answerKey.map((k) =>
      k.questionNumber === questionNumber ? { ...k, correctAnswer: trimmed } : k
    );
    commitDraftUpdate({ ...quiz, answerKey: updatedKey });
    setEditingAnswerQNum(null);
    setEditingAnswerText("");
    showToast("✓ Answer key updated");
  }

  function handleDeleteQuestion(questionNumber: number) {
    if (!quiz) return;
    if (quiz.questions.length <= 1) {
      Alert.alert("Cannot Delete", "An assessment must contain at least 1 question.");
      return;
    }
    Alert.alert(
      "Delete Question",
      `Remove question #${questionNumber}? Remaining questions will be renumbered.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const filteredQ = quiz.questions
              .filter((q) => q.questionNumber !== questionNumber)
              .map((q, idx) => ({ ...q, questionNumber: idx + 1 }));
            const filteredA = quiz.answerKey
              .filter((a) => a.questionNumber !== questionNumber)
              .map((a, idx) => ({ ...a, questionNumber: idx + 1 }));
            commitDraftUpdate({ ...quiz, questions: filteredQ, answerKey: filteredA });
            showToast("✓ Question removed");
          },
        },
      ]
    );
  }

  function handleManualConvertType(questionNumber: number, newType: QuestionType) {
    if (!quiz) return;
    const updatedQ = quiz.questions.map((q) => {
      if (q.questionNumber !== questionNumber) return q;
      let newOptions: string[] = [];
      let newBoxes = 1;
      if (newType === "multiple_choice") {
        newOptions = ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"];
      } else if (newType === "true_false") {
        newOptions = ["A) True", "B) False"];
      } else if (newType === "word_box") {
        newOptions = ["Word1", "Word2", "Word3", "Word4"];
      } else if (newType === "enumeration") {
        newBoxes = 3;
      }
      return {
        ...q,
        type: newType,
        options: newOptions,
        answerBoxesRequired: newBoxes,
      };
    });

    const updatedA = quiz.answerKey.map((ak) => {
      if (ak.questionNumber !== questionNumber) return ak;
      let defaultAns = "A";
      if (newType === "true_false") defaultAns = "A";
      else if (newType === "identification" || newType === "fill_blank") defaultAns = "Answer";
      else if (newType === "enumeration") defaultAns = "Item 1, Item 2, Item 3";
      else if (newType === "word_box") defaultAns = "Word1";
      return {
        ...ak,
        correctAnswer: defaultAns,
        points: newType === "enumeration" ? 3 : 1,
      };
    });

    commitDraftUpdate({ ...quiz, questions: updatedQ, answerKey: updatedA });
    setChangeTypeModalOpen(false);
    setSelectedQForTypeChange(null);

    const targetQ = updatedQ.find((q) => q.questionNumber === questionNumber);
    if (targetQ) {
      setEditingQuestionQNum(questionNumber);
      setEditingQuestionText(targetQ.questionText);
    }
  }

  function handleRegenerateQuestion(questionNumber: number, overrideType?: QuestionType) {
    if (!quiz || regeneratingQNum !== null) return;
    const targetQ = quiz.questions.find((q) => q.questionNumber === questionNumber);
    if (!targetQ) return;

    const effectiveType = overrideType || targetQ.type;
    const typeLabel = formatTypeLabel(effectiveType).toLowerCase();

    const confirmTitle =
      overrideType && overrideType !== targetQ.type
        ? `Convert question #${questionNumber} to ${typeLabel}?`
        : `Regenerate question #${questionNumber}?`;

    const confirmMsg = `This will replace question #${questionNumber} with a new AI-generated ${typeLabel} question, keeping all other questions untouched.\n\n(Does not use your daily AI generation quota.)`;

    Alert.alert(confirmTitle, confirmMsg, [
      { text: "Cancel", style: "cancel" },
      {
        text: overrideType && overrideType !== targetQ.type ? "Convert" : "Regenerate",
        onPress: async () => {
          setRegeneratingQNum(questionNumber);
          try {
            const result = await regenerateSingleQuestion({
              questionNumber,
              questionType: effectiveType,
              currentQuestionText: targetQ.questionText,
              otherQuestions: quiz.questions,
              quizTitle: quiz.quizTitle,
              subject: quiz.subject || "General",
              gradeLevel: quiz.gradeLevel || "Grade 11 (SHS)",
              difficulty: quiz.difficulty || "Medium (Application & Analysis)",
            });

            const updatedQuestions = quiz.questions.map((q) =>
              q.questionNumber === questionNumber ? result.question : q
            );
            const updatedAnswerKey = quiz.answerKey.map((ak) =>
              ak.questionNumber === questionNumber ? result.answerKey : ak
            );
            await commitDraftUpdate({
              ...quiz,
              questions: updatedQuestions,
              answerKey: updatedAnswerKey,
            });
            showToast(`✓ Question #${questionNumber} regenerated`);
          } catch (err: any) {
            console.error("Single question regeneration error:", err);
            Alert.alert(
              "Regeneration Failed",
              err?.message || "Could not regenerate question. Please try again."
            );
          } finally {
            setRegeneratingQNum(null);
          }
        },
      },
    ]);
  }

  // ── Manual Add Question helpers (Drafts) ───────────────────────────────────
  function resetManualForm() {
    setManualQType("multiple_choice");
    setManualQText("");
    setManualChoices(["", "", "", ""]);
    setManualCorrectAnswer("A");
    setManualPoints("1");
    setManualEnumCount("3");
  }

  function handleManualQTypeChange(type: QuestionType) {
    setManualQType(type);
    if (type === "multiple_choice") {
      setManualChoices(["", "", "", ""]);
      setManualCorrectAnswer("A");
    } else if (type === "true_false") {
      setManualChoices(["True", "False"]);
      setManualCorrectAnswer("A");
    } else if (type === "word_box") {
      setManualChoices(["", "", "", ""]);
      setManualCorrectAnswer("");
    } else {
      setManualChoices([]);
      setManualCorrectAnswer("");
    }
  }

  function updateChoice(index: number, value: string) {
    setManualChoices((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }

  function handleAddManualQuestion() {
    if (!quiz) return;
    const trimmedText = manualQText.trim();
    if (!trimmedText) {
      Alert.alert("Missing Question", "Please enter the question prompt.");
      return;
    }

    if (manualQType === "multiple_choice") {
      const filledChoices = manualChoices.filter((c) => c.trim().length > 0);
      if (filledChoices.length < 2) {
        Alert.alert("Missing Choices", "Please enter at least 2 choice options.");
        return;
      }
      if (!manualCorrectAnswer) {
        Alert.alert("Missing Correct Key", "Please tap a letter badge (A, B, C, D) to select the correct answer.");
        return;
      }
    } else if (manualQType === "true_false") {
      if (!manualCorrectAnswer) {
        Alert.alert("Missing Correct Key", "Please select whether the answer is True (A) or False (B).");
        return;
      }
    } else if (!manualCorrectAnswer.trim()) {
      Alert.alert("Missing Answer", "Please specify the correct answer.");
      return;
    }

    const nextNumber = quiz.questions.length + 1;
    const enumCount = parseInt(manualEnumCount, 10) || 3;

    let options: string[] = [];
    let finalCorrectAnswer = manualCorrectAnswer.trim();

    if (manualQType === "multiple_choice") {
      options = manualChoices
        .map((c, i) => {
          const trimmed = c.trim();
          if (!trimmed) return "";
          const letter = String.fromCharCode(65 + i);
          return trimmed.startsWith(`${letter})`) ? trimmed : `${letter}) ${trimmed}`;
        })
        .filter((c) => c.length > 0);
    } else if (manualQType === "true_false") {
      options = ["A) True", "B) False"];
      finalCorrectAnswer = manualCorrectAnswer === "B" || manualCorrectAnswer === "F" ? "B" : "A";
    } else if (manualQType === "word_box") {
      options = manualChoices.map((c) => c.trim()).filter((c) => c.length > 0);
    }

    const newQuestion: ScannableQuestion = {
      questionNumber: nextNumber,
      type: manualQType,
      questionText: trimmedText,
      options,
      answerBoxesRequired: manualQType === "enumeration" ? Math.min(Math.max(enumCount, 2), 6) : 1,
    };

    const newAnswerKey: AnswerKeyItem = {
      questionNumber: nextNumber,
      correctAnswer: finalCorrectAnswer,
      points: parseInt(manualPoints, 10) || 1,
    };

    commitDraftUpdate({
      ...quiz,
      questions: [...quiz.questions, newQuestion],
      answerKey: [...quiz.answerKey, newAnswerKey],
    });

    setAddQuestionModalOpen(false);
    resetManualForm();
    showToast("✓ Question added");
  }

  async function handleSaveDraftPress() {
    if (!quiz || savingDraft) return;
    setSavingDraft(true);
    try {
      if (onSaveDraft) {
        await onSaveDraft(quiz);
      }
      showToast("✓ Saved to drafts");
    } catch (err: any) {
      Alert.alert("Save Failed", err?.message || "Failed to save draft.");
    } finally {
      setSavingDraft(false);
    }
  }

  const difficultyShort = (quiz?.difficulty || "Standard").split(" ")[0];
  const hasGradeLevel = Boolean(quiz?.gradeLevel && quiz.gradeLevel.trim().length > 0);
  const fourthStatValue = hasGradeLevel
    ? quiz!.gradeLevel!.replace(/\s*\(.*?\)/g, "").replace(/Grade\s*/i, "Gr ")
    : quiz?.classTitle || "Class";
  const fourthStatLabel = hasGradeLevel ? "Grade" : "Class";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (exportingPdf && onCancelExportPdf) {
          onCancelExportPdf();
          showToast("Export cancelled");
          return;
        }
        if (addQuestionModalOpen) {
          setAddQuestionModalOpen(false);
          return;
        }
        if (changeTypeModalOpen) {
          setChangeTypeModalOpen(false);
          setSelectedQForTypeChange(null);
          return;
        }
        onClose();
      }}
    >
      <View style={[styles.container, { backgroundColor: bg }]}>
        {/* ── Clean Top Bar (short fixed label + non-overlapping status pill + close button) ── */}
        <View style={[styles.topBar, { backgroundColor: cardBg, borderBottomColor: border }]}>
          <View style={styles.topBarLeft}>
            <Text
              style={[styles.topBarTitle, { color: darkMode ? textMain : "#0F172A" }]}
              numberOfLines={1}
            >
              Assessment Preview
            </Text>
            <View
              style={[
                styles.statusBadge,
                isDraft
                  ? {
                      backgroundColor: darkMode ? "rgba(245, 158, 11, 0.16)" : "#FEF3C7",
                      borderColor: darkMode ? "rgba(245, 158, 11, 0.35)" : "#FDE68A",
                    }
                  : {
                      backgroundColor: darkMode ? "rgba(37, 99, 235, 0.18)" : "#DBEAFE",
                      borderColor: darkMode ? "rgba(59, 130, 246, 0.35)" : "#BFDBFE",
                    },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  {
                    color: isDraft
                      ? darkMode
                        ? "#FBBF24"
                        : "#B45309"
                      : darkMode
                        ? "#60A5FA"
                        : "#1D4ED8",
                  },
                ]}
              >
                {isDraft ? "DRAFT" : "ARCHIVE"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}
            onPress={onClose}
            accessibilityLabel="Close inspector"
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color={textMain} />
          </TouchableOpacity>
        </View>

        {/* ── Scrollable AI-Builder-Style Assessment Preview ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {quiz && (
            <>
              {/* ── Preview Screen Header Banner (matching AIBuilderTab) ── */}
              <View
                style={[
                  styles.previewScreenBanner,
                  {
                    backgroundColor: cardBg,
                    borderColor: border,
                  },
                ]}
              >
                <View style={styles.previewTopRow}>
                  <View
                    style={[
                      styles.previewModeBadge,
                      { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.previewModeBadgeText,
                        { color: darkMode ? "#CBD5E1" : "#475569" },
                      ]}
                    >
                      {isDraft ? "Draft Preview" : "Archived Preview"}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.classChip,
                      {
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#334155" : "#E2E8F0",
                      },
                    ]}
                  >
                    <Ionicons name="school-outline" size={12} color="#2563EB" />
                    <Text
                      style={[styles.classChipText, { color: darkMode ? "#93C5FD" : "#2563EB" }]}
                      numberOfLines={1}
                    >
                      {quiz.classTitle || "Classroom"}
                    </Text>
                  </View>
                </View>

                {/* Full Un-truncated Assessment Title */}
                <Text style={[styles.previewTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                  {quiz.quizTitle || "Assessment Preview"}
                </Text>

                <Text style={[styles.previewSubtext, { color: darkMode ? textSub : "#64748B" }]}>
                  {isDraft
                    ? `Review or edit items below before publishing · Saved ${formattedDate}${timeInfo ? ` · ${timeInfo.text}` : ""}`
                    : `Published to ${quiz.classTitle || "Classroom"} · ${formattedDate}`}
                </Text>

                {/* 4-Column Stats Row (matching AIBuilderTab) */}
                <View
                  style={[
                    styles.previewStatsRow,
                    { backgroundColor: inputBg, borderColor: border },
                  ]}
                >
                  <View style={styles.previewStatItem}>
                    <Text
                      style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]}
                      numberOfLines={1}
                    >
                      {quiz.questions.length}
                    </Text>
                    <Text
                      style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]}
                      numberOfLines={1}
                    >
                      Questions
                    </Text>
                  </View>

                  <View style={[styles.previewStatDivider, { backgroundColor: border }]} />

                  <View style={styles.previewStatItem}>
                    <Text
                      style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]}
                      numberOfLines={1}
                    >
                      {totalPoints}
                    </Text>
                    <Text
                      style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]}
                      numberOfLines={1}
                    >
                      Points
                    </Text>
                  </View>

                  <View style={[styles.previewStatDivider, { backgroundColor: border }]} />

                  <View style={styles.previewStatItem}>
                    <Text
                      style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]}
                      numberOfLines={1}
                    >
                      {difficultyShort}
                    </Text>
                    <Text
                      style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]}
                      numberOfLines={1}
                    >
                      Difficulty
                    </Text>
                  </View>

                  <View style={[styles.previewStatDivider, { backgroundColor: border }]} />

                  <View style={styles.previewStatItem}>
                    <Text
                      style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {fourthStatValue}
                    </Text>
                    <Text
                      style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]}
                      numberOfLines={1}
                    >
                      {fourthStatLabel}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Scannable Question Cards Grouped by Section (matching AIBuilderTab) ── */}
              {assessmentSections.map((section) => {
                const showSectionHeader =
                  quiz.questionType === "Mixed Assessment" || assessmentSections.length > 1;
                const isWordBoxSection = section.type === "word_box";
                const sharedWords = isWordBoxSection
                  ? Array.from(
                      new Set(
                        section.questions
                          .flatMap((q) => q.options || [])
                          .map((w) => w.trim())
                          .filter(Boolean)
                      )
                    )
                  : [];

                return (
                  <View key={`sec_${section.roman}_${section.type}`}>
                    {showSectionHeader && (
                      <View style={styles.sectionHeaderRow}>
                        <Text
                          style={[
                            styles.sectionHeaderTitle,
                            { color: darkMode ? "#CBD5E1" : "#475569" },
                          ]}
                        >
                          {section.title}
                        </Text>
                        <Text
                          style={[
                            styles.sectionHeaderMeta,
                            { color: darkMode ? textSub : "#64748B" },
                          ]}
                        >
                          {section.startNum === section.endNum
                            ? `Item ${section.startNum} (${section.totalPoints} ${section.totalPoints === 1 ? "pt" : "pts"})`
                            : `Items ${section.startNum}–${section.endNum} (${section.totalPoints} pts)`}
                        </Text>
                      </View>
                    )}

                    {isWordBoxSection && sharedWords.length > 0 && (
                      <View
                        style={[
                          styles.sharedWordBankCard,
                          {
                            backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                            borderColor: border,
                          },
                        ]}
                      >
                        <View style={styles.sharedWordBankHeader}>
                          <Ionicons name="grid-outline" size={14} color={accentColor} />
                          <Text
                            style={[
                              styles.sharedWordBankTitle,
                              { color: darkMode ? textMain : "#0F172A" },
                            ]}
                          >
                            Word Bank for Part {section.roman}
                          </Text>
                        </View>
                        <View style={styles.sharedWordBankChipsWrap}>
                          {sharedWords.map((word, wIdx) => (
                            <View
                              key={`swb_${wIdx}`}
                              style={[
                                styles.sharedWordChip,
                                {
                                  backgroundColor: darkMode ? "#374151" : "#F8FAFC",
                                  borderColor: darkMode ? border : "#E2E8F0",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.sharedWordChipText,
                                  { color: darkMode ? textMain : "#334155" },
                                ]}
                              >
                                {word}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {section.questions.map((q) => {
                      const answerObj = quiz.answerKey.find(
                        (k) => k.questionNumber === q.questionNumber
                      );
                      const correctAnswer = answerObj ? answerObj.correctAnswer : "";
                      const points = answerObj
                        ? answerObj.points
                        : q.type === "enumeration"
                          ? q.answerBoxesRequired || 3
                          : 1;
                      const hasOptions = Boolean(
                        q.options && q.options.length > 0 && q.type !== "word_box"
                      );

                      return (
                        <View
                          key={q.questionNumber}
                          style={[
                            styles.questionCard,
                            { backgroundColor: cardBg, borderColor: border },
                          ]}
                        >
                          {/* Row 1 — Dedicated Card Header Bar */}
                          <View style={styles.questionHeader}>
                            <View style={styles.questionHeaderLeft}>
                              <View
                                style={[
                                  styles.questionNumber,
                                  { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.questionNumberText,
                                    { color: darkMode ? "#F8FAFC" : "#0F172A" },
                                  ]}
                                >
                                  Q{q.questionNumber}
                                </Text>
                              </View>

                              {isDraft ? (
                                <TouchableOpacity
                                  style={[
                                    styles.typeSelectorChip,
                                    {
                                      backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                      borderColor: darkMode ? "#334155" : "#E2E8F0",
                                    },
                                  ]}
                                  onPress={() => {
                                    setSelectedQForTypeChange(q);
                                    setSelectedNewType(q.type);
                                    setChangeTypeModalOpen(true);
                                  }}
                                  activeOpacity={0.7}
                                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                                >
                                  <Text
                                    style={[
                                      styles.typeSelectorChipText,
                                      { color: darkMode ? "#CBD5E1" : "#475569" },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {formatTypeLabel(q.type)}
                                  </Text>
                                  <Ionicons
                                    name="chevron-down"
                                    size={11}
                                    color={darkMode ? "#94A3B8" : "#64748B"}
                                  />
                                </TouchableOpacity>
                              ) : (
                                <View
                                  style={[
                                    styles.typeSelectorChip,
                                    {
                                      backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                      borderColor: darkMode ? "#334155" : "#E2E8F0",
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.typeSelectorChipText,
                                      { color: darkMode ? "#CBD5E1" : "#475569" },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {formatTypeLabel(q.type)}
                                  </Text>
                                </View>
                              )}

                              <Text
                                style={[
                                  styles.questionPointsLabel,
                                  { color: darkMode ? textSub : "#64748B" },
                                ]}
                              >
                                {points} {points === 1 ? "pt" : "pts"}
                              </Text>
                            </View>

                            {isDraft && (
                              <View style={styles.questionHeaderToolbar}>
                                <TouchableOpacity
                                  style={[
                                    styles.regenerateIconBtn,
                                    {
                                      backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                      borderColor: darkMode ? "#334155" : "#E2E8F0",
                                    },
                                  ]}
                                  onPress={() => handleRegenerateQuestion(q.questionNumber)}
                                  disabled={regeneratingQNum !== null}
                                  activeOpacity={0.7}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  {regeneratingQNum === q.questionNumber ? (
                                    <ActivityIndicator
                                      size="small"
                                      color={darkMode ? "#CBD5E1" : "#334155"}
                                      style={{ transform: [{ scale: 0.75 }] }}
                                    />
                                  ) : (
                                    <Ionicons
                                      name="refresh"
                                      size={14}
                                      color={darkMode ? "#CBD5E1" : "#334155"}
                                    />
                                  )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                  onPress={() => {
                                    if (editingQuestionQNum === q.questionNumber) {
                                      setEditingQuestionQNum(null);
                                    } else {
                                      setEditingQuestionQNum(q.questionNumber);
                                      setEditingQuestionText(q.questionText);
                                    }
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={styles.actionIconBtn}
                                >
                                  <Ionicons
                                    name={
                                      editingQuestionQNum === q.questionNumber
                                        ? "close"
                                        : "pencil-outline"
                                    }
                                    size={18}
                                    color={darkMode ? textSub : "#64748B"}
                                  />
                                </TouchableOpacity>

                                <TouchableOpacity
                                  onPress={() => handleDeleteQuestion(q.questionNumber)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={styles.deleteQBtn}
                                >
                                  <Ionicons
                                    name="trash-outline"
                                    size={18}
                                    color={darkMode ? textSub : "#64748B"}
                                  />
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>

                          {/* Row 2 — Full-Width Question Prompt */}
                          {isDraft && editingQuestionQNum === q.questionNumber ? (
                            <View style={{ marginBottom: 12 }}>
                              <TextInput
                                style={[
                                  styles.questionEditInput,
                                  {
                                    backgroundColor: inputBg,
                                    borderColor: accentColor,
                                    color: textMain,
                                  },
                                ]}
                                value={editingQuestionText}
                                onChangeText={setEditingQuestionText}
                                multiline
                                autoFocus
                              />
                              <View
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "flex-end",
                                  gap: 8,
                                  marginTop: 8,
                                }}
                              >
                                <TouchableOpacity
                                  onPress={() => setEditingQuestionQNum(null)}
                                  style={[styles.smallCancelBtn, { borderColor: border }]}
                                >
                                  <Text
                                    style={{ fontSize: 12, fontWeight: "600", color: textSub }}
                                  >
                                    Cancel
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => handleSaveQuestionTextEdit(q.questionNumber)}
                                  style={[styles.smallSaveBtn, { backgroundColor: accentColor }]}
                                >
                                  <Text
                                    style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}
                                  >
                                    Save Question
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <Text
                              style={[
                                styles.questionText,
                                { color: darkMode ? textMain : "#0F172A" },
                              ]}
                            >
                              {q.questionText}
                            </Text>
                          )}

                          {/* Row 3 — Options List for Multiple Choice / True False */}
                          {hasOptions && (
                            <View style={styles.choicesWrap}>
                              {q.options.map((opt, cIdx) => {
                                const isCorrect = isChoiceAnswer(opt, correctAnswer, cIdx);
                                return (
                                  <View
                                    key={`${opt}_${cIdx}`}
                                    style={[
                                      styles.choiceItem,
                                      {
                                        backgroundColor: darkMode ? inputBg : "#FFFFFF",
                                        borderColor: darkMode ? border : "#E2E8F0",
                                      },
                                      isCorrect && {
                                        backgroundColor: darkMode
                                          ? "rgba(22, 163, 74, 0.16)"
                                          : "#F0FDF4",
                                        borderColor: "#16A34A",
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.choiceText,
                                        { color: darkMode ? textMain : "#334155" },
                                        isCorrect && {
                                          color: darkMode ? "#4ADE80" : "#15803D",
                                          fontWeight: "600",
                                        },
                                      ]}
                                    >
                                      {opt}
                                    </Text>
                                    {isCorrect && (
                                      <Ionicons
                                        name="checkmark"
                                        size={16}
                                        color={darkMode ? "#4ADE80" : "#16A34A"}
                                        style={{ marginLeft: 8 }}
                                      />
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          )}

                          {/* Row 4 — Compact Answer Key Strip for non-MC / Word Box questions */}
                          {(!hasOptions || q.type === "word_box") &&
                            (() => {
                              const isShortAnswerType =
                                q.type === "identification" ||
                                q.type === "fill_blank" ||
                                q.type === "enumeration" ||
                                q.type === "word_box";
                              const subItems =
                                q.type === "enumeration"
                                  ? correctAnswer
                                      .split(/[,;\n]/)
                                      .map((s) => s.trim())
                                      .filter(Boolean)
                                  : [correctAnswer.trim()];
                              const isTooLong =
                                isShortAnswerType &&
                                subItems.some(
                                  (item) =>
                                    item.length > 25 ||
                                    item.split(/\s+/).filter(Boolean).length > 3
                                );
                              const isEditingThis = isDraft && editingAnswerQNum === q.questionNumber;

                              return (
                                <View
                                  style={[
                                    styles.answerWrap,
                                    {
                                      borderLeftColor: isTooLong ? "#D97706" : "#16A34A",
                                      marginTop: 4,
                                    },
                                  ]}
                                >
                                  <View
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.answerLabel,
                                        { color: darkMode ? textSub : "#64748B" },
                                      ]}
                                    >
                                      Answer Key
                                    </Text>
                                    {isDraft && isShortAnswerType && !isEditingThis && (
                                      <TouchableOpacity
                                        onPress={() => {
                                          setEditingAnswerQNum(q.questionNumber);
                                          setEditingAnswerText(correctAnswer);
                                        }}
                                      >
                                        <Text
                                          style={{
                                            fontSize: 12,
                                            fontWeight: "600",
                                            color: isTooLong
                                              ? "#D97706"
                                              : darkMode
                                                ? "#CBD5E1"
                                                : "#475569",
                                          }}
                                        >
                                          Edit Answer
                                        </Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>

                                  {isEditingThis ? (
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        marginTop: 6,
                                      }}
                                    >
                                      <TextInput
                                        style={{
                                          flex: 1,
                                          borderWidth: 1,
                                          borderColor: darkMode ? "#475569" : "#CBD5E1",
                                          borderRadius: 8,
                                          paddingHorizontal: 10,
                                          paddingVertical: 6,
                                          fontSize: 13,
                                          color: textMain,
                                          backgroundColor: inputBg,
                                        }}
                                        value={editingAnswerText}
                                        onChangeText={setEditingAnswerText}
                                        placeholder="1–3 words, max 25 chars"
                                        placeholderTextColor={textSub}
                                      />
                                      <TouchableOpacity
                                        onPress={() => handleSaveInlineAnswerEdit(q.questionNumber)}
                                        style={{
                                          backgroundColor: "#0F172A",
                                          paddingHorizontal: 12,
                                          paddingVertical: 7,
                                          borderRadius: 8,
                                        }}
                                      >
                                        <Text
                                          style={{
                                            color: "#FFFFFF",
                                            fontSize: 12,
                                            fontWeight: "600",
                                          }}
                                        >
                                          Save
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  ) : (
                                    <Text
                                      style={[
                                        styles.answerText,
                                        {
                                          color: isTooLong
                                            ? "#D97706"
                                            : darkMode
                                              ? "#4ADE80"
                                              : "#15803D",
                                        },
                                      ]}
                                    >
                                      {correctAnswer || "—"}
                                    </Text>
                                  )}

                                  {isTooLong && (
                                    <Text
                                      style={{
                                        fontSize: 11,
                                        fontWeight: "600",
                                        color: "#D97706",
                                        marginTop: 4,
                                      }}
                                    >
                                      Exceeds 25 chars / 3 words — shorten so it fits inside the
                                      scannable answer box.
                                    </Text>
                                  )}
                                </View>
                              );
                            })()}
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {/* ── Add Question Manually Button (Drafts — matching AIBuilderTab) ── */}
              {isDraft && (
                <TouchableOpacity
                  style={[
                    styles.addQuestionBtn,
                    {
                      backgroundColor: darkMode ? cardBg : "#FFFFFF",
                      borderColor: darkMode ? border : "#CBD5E1",
                    },
                  ]}
                  onPress={() => {
                    resetManualForm();
                    setAddQuestionModalOpen(true);
                  }}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.addQuestionIconCircle,
                      { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" },
                    ]}
                  >
                    <Ionicons name="add" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.addQuestionTitle,
                        { color: darkMode ? textMain : "#0F172A" },
                      ]}
                    >
                      Add Question Manually
                    </Text>
                    <Text
                      style={[
                        styles.addQuestionSub,
                        { color: darkMode ? textSub : "#64748B" },
                      ]}
                    >
                      Add your own question to this assessment
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={darkMode ? textSub : "#64748B"}
                  />
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>

        {/* ── Sticky Action Footer (matching AIBuilderTab CTA hierarchy) ── */}
        {quiz && (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: cardBg,
                borderTopColor: border,
                paddingBottom: Platform.OS === "ios" ? Math.max(insets.bottom, 16) : 16,
              },
            ]}
          >
            {isDraft ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.publishBtn,
                    { backgroundColor: darkMode ? "#334155" : "#1E293B" },
                  ]}
                  onPress={() => onPublishDraft(quiz)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="send-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.publishText}>Publish Quiz</Text>
                </TouchableOpacity>

                <View style={styles.resultActions}>
                  <TouchableOpacity
                    style={[
                      styles.secondaryFooterBtn,
                      {
                        backgroundColor: darkMode ? cardBg : "#FFFFFF",
                        borderColor: darkMode ? border : "#CBD5E1",
                        opacity: savingDraft ? 0.6 : 1,
                      },
                    ]}
                    onPress={handleSaveDraftPress}
                    disabled={savingDraft}
                    activeOpacity={0.75}
                  >
                    {savingDraft ? (
                      <ActivityIndicator size="small" color={darkMode ? textMain : "#0F172A"} />
                    ) : (
                      <>
                        <Ionicons
                          name="save-outline"
                          size={16}
                          color={darkMode ? textMain : "#0F172A"}
                        />
                        <Text
                          style={[
                            styles.secondaryFooterBtnText,
                            { color: darkMode ? textMain : "#0F172A" },
                          ]}
                        >
                          Save Draft
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryFooterBtn,
                      {
                        backgroundColor: darkMode ? cardBg : "#FFFFFF",
                        borderColor: darkMode ? border : "#CBD5E1",
                        opacity: exportingPdf ? 0.6 : 1,
                      },
                    ]}
                    onPress={() => onExportPdf(quiz)}
                    disabled={exportingPdf}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name="print-outline"
                      size={16}
                      color={darkMode ? textMain : "#0F172A"}
                    />
                    <Text
                      style={[
                        styles.secondaryFooterBtnText,
                        { color: darkMode ? textMain : "#0F172A" },
                      ]}
                    >
                      Export / Print PDF
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity
                style={[
                  styles.publishBtn,
                  { backgroundColor: darkMode ? "#334155" : "#1E293B", marginBottom: 0 },
                ]}
                onPress={() => onExportPdf(quiz)}
                disabled={exportingPdf}
                activeOpacity={0.85}
              >
                <Ionicons name="print-outline" size={16} color="#FFFFFF" />
                <Text style={styles.publishText}>Export / Print PDF</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── In-Modal Change Question Type Sheet (Drafts) ── */}
        {changeTypeModalOpen && selectedQForTypeChange && (
          <View style={styles.sheetOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (regeneratingQNum === null) {
                  setChangeTypeModalOpen(false);
                  setSelectedQForTypeChange(null);
                }
              }}
            />
            <View
              style={[
                styles.bottomSheet,
                {
                  backgroundColor: cardBg,
                  paddingBottom: Platform.OS === "ios" ? Math.max(insets.bottom, 16) + 8 : 20,
                },
              ]}
            >
              <View style={styles.dragPill} />
              <View style={styles.sheetHeaderRow}>
                <View
                  style={[
                    styles.sheetHeaderIcon,
                    { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" },
                  ]}
                >
                  <Ionicons
                    name="swap-horizontal"
                    size={20}
                    color={darkMode ? "#F8FAFC" : "#0F172A"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.sheetHeaderTitle, { color: darkMode ? textMain : "#0F172A" }]}
                  >
                    Change Question #{selectedQForTypeChange.questionNumber} Type
                  </Text>
                  <Text style={[styles.sheetHeaderSub, { color: darkMode ? textSub : "#64748B" }]}>
                    Current: {formatTypeLabel(selectedQForTypeChange.type)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setChangeTypeModalOpen(false);
                    setSelectedQForTypeChange(null);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={darkMode ? textSub : "#64748B"} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 320 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
              >
                {(
                  [
                    {
                      key: "multiple_choice" as QuestionType,
                      label: "Multiple Choice",
                      desc: "4 options (A, B, C, D) with 1 answer box",
                      icon: "list" as const,
                    },
                    {
                      key: "true_false" as QuestionType,
                      label: "True / False",
                      desc: "Binary choices (A) True, B) False)",
                      icon: "checkmark-done" as const,
                    },
                    {
                      key: "identification" as QuestionType,
                      label: "Identification",
                      desc: "Short concept/term (1–3 words, max 25 chars)",
                      icon: "text" as const,
                    },
                    {
                      key: "fill_blank" as QuestionType,
                      label: "Fill in the Blank",
                      desc: "Sentence with blank to fill in (1–3 words)",
                      icon: "pencil" as const,
                    },
                    {
                      key: "enumeration" as QuestionType,
                      label: "Enumeration",
                      desc: "List 2–4 sequential items across boxes",
                      icon: "reorder-three" as const,
                    },
                    {
                      key: "word_box" as QuestionType,
                      label: "Word Box",
                      desc: "Fill in blank using a randomized word bank",
                      icon: "grid" as const,
                    },
                  ] as const
                ).map((opt) => {
                  const isSelected = selectedNewType === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.typeOptionRow,
                        {
                          backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                          borderColor: darkMode ? "#334155" : "#E2E8F0",
                        },
                        isSelected && {
                          borderColor: darkMode ? "#94A3B8" : "#0F172A",
                          backgroundColor: darkMode ? "#334155" : "#F8FAFC",
                        },
                      ]}
                      onPress={() => setSelectedNewType(opt.key)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.typeOptionIcon,
                          { backgroundColor: darkMode ? "#0F172A" : "#F1F5F9" },
                          isSelected && { backgroundColor: "#0F172A" },
                        ]}
                      >
                        <Ionicons
                          name={opt.icon}
                          size={15}
                          color={isSelected ? "#FFFFFF" : textSub}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.typeOptionTitle,
                            { color: darkMode ? textMain : "#0F172A" },
                            isSelected && { fontWeight: "700" },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text
                          style={[styles.typeOptionDesc, { color: darkMode ? textSub : "#64748B" }]}
                          numberOfLines={1}
                        >
                          {opt.desc}
                        </Text>
                      </View>
                      <Ionicons
                        name={isSelected ? "radio-button-on" : "radio-button-off"}
                        size={18}
                        color={isSelected ? (darkMode ? "#F8FAFC" : "#0F172A") : textSub}
                      />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View
                style={[
                  styles.typeModalFooter,
                  { borderTopColor: darkMode ? "#374151" : "#E2E8F0" },
                ]}
              >
                <TouchableOpacity
                  style={styles.typeRegenAiBtn}
                  onPress={() => {
                    const qNum = selectedQForTypeChange.questionNumber;
                    setChangeTypeModalOpen(false);
                    setSelectedQForTypeChange(null);
                    handleRegenerateQuestion(qNum, selectedNewType);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                  <Text style={styles.typeRegenAiBtnText}>
                    Regenerate as {formatTypeLabel(selectedNewType)} with AI
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeConvertManualBtn,
                    {
                      borderColor: darkMode ? "#334155" : "#CBD5E1",
                      backgroundColor: darkMode ? cardBg : "#FFFFFF",
                    },
                  ]}
                  onPress={() =>
                    handleManualConvertType(selectedQForTypeChange.questionNumber, selectedNewType)
                  }
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={15}
                    color={darkMode ? textMain : "#0F172A"}
                  />
                  <Text
                    style={[
                      styles.typeConvertManualBtnText,
                      { color: darkMode ? textMain : "#0F172A" },
                    ]}
                  >
                    Convert Manually (Edit Text Yourself)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── In-Modal Add Question Manually Sheet (Drafts) ── */}
        {addQuestionModalOpen && (
          <KeyboardAvoidingView
            style={styles.sheetOverlay}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                Keyboard.dismiss();
                setAddQuestionModalOpen(false);
              }}
            />
            <View
              style={[
                styles.bottomSheet,
                {
                  backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                  maxHeight: "90%",
                  paddingBottom: Platform.OS === "ios" ? Math.max(insets.bottom, 16) : 16,
                },
              ]}
            >
              <View style={styles.dragPill} />
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                <View style={styles.addQHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.addQTitle, { color: textMain }]}>
                      Add Question Manually
                    </Text>
                    <Text style={[styles.addQSubTitle, { color: textSub }]}>
                      Create a custom question for this draft
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setAddQuestionModalOpen(false)}
                    style={styles.sheetCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color={textSub} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                  Question type
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingRight: 20 }}
                  style={{ marginBottom: 14 }}
                >
                  {(
                    [
                      { key: "multiple_choice" as QuestionType, label: "Multiple Choice", icon: "list" as const },
                      { key: "true_false" as QuestionType, label: "True / False", icon: "checkmark-done" as const },
                      { key: "identification" as QuestionType, label: "Identification", icon: "text" as const },
                      { key: "fill_blank" as QuestionType, label: "Fill in the Blank", icon: "pencil" as const },
                      { key: "enumeration" as QuestionType, label: "Enumeration", icon: "reorder-three" as const },
                      { key: "word_box" as QuestionType, label: "Word Box", icon: "grid" as const },
                    ] as const
                  ).map((t) => {
                    const isActive = manualQType === t.key;
                    return (
                      <TouchableOpacity
                        key={t.key}
                        style={[
                          styles.addQTypeChip,
                          {
                            backgroundColor: isActive
                              ? "#0F172A"
                              : darkMode
                                ? "#1E293B"
                                : "#F8FAFC",
                            borderColor: isActive
                              ? "#0F172A"
                              : darkMode
                                ? "#475569"
                                : "#CBD5E1",
                          },
                        ]}
                        onPress={() => handleManualQTypeChange(t.key)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={t.icon}
                          size={14}
                          color={isActive ? "#FFFFFF" : darkMode ? "#94A3B8" : "#475569"}
                        />
                        <Text
                          style={[
                            styles.addQTypeChipText,
                            { color: isActive ? "#FFFFFF" : darkMode ? "#E2E8F0" : "#334155" },
                          ]}
                        >
                          {t.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                  Question prompt <Text style={{ color: "#EF4444" }}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.addQTextInput,
                    { backgroundColor: inputBg, borderColor: border, color: textMain },
                  ]}
                  placeholder="Enter your question here..."
                  placeholderTextColor={textSub}
                  value={manualQText}
                  onChangeText={setManualQText}
                  multiline
                  textAlignVertical="top"
                />

                {(manualQType === "multiple_choice" || manualQType === "true_false") && (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 14,
                        marginBottom: 8,
                      }}
                    >
                      <Text
                        style={[
                          styles.addQLabel,
                          { color: darkMode ? "#CBD5E1" : "#334155", marginTop: 0, marginBottom: 0 },
                        ]}
                      >
                        Choices
                      </Text>
                      <Text style={{ fontSize: 12, color: "#64748B" }}>
                        Tap letter to mark correct key
                      </Text>
                    </View>

                    {manualChoices.map((choice, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const isCorrect = manualCorrectAnswer === letter;
                      return (
                        <View key={idx} style={styles.addQChoiceRow}>
                          <TouchableOpacity
                            style={[
                              styles.choiceBadgeBtn,
                              {
                                backgroundColor: isCorrect
                                  ? "#16A34A"
                                  : darkMode
                                    ? "#334155"
                                    : "#F1F5F9",
                              },
                            ]}
                            onPress={() => setManualCorrectAnswer(letter)}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.choiceBadgeBtnText,
                                {
                                  color: isCorrect ? "#FFFFFF" : darkMode ? "#94A3B8" : "#475569",
                                },
                              ]}
                            >
                              {letter}
                            </Text>
                          </TouchableOpacity>

                          <TextInput
                            style={[
                              styles.addQChoiceInput,
                              {
                                backgroundColor: isCorrect
                                  ? darkMode
                                    ? "rgba(22, 163, 74, 0.15)"
                                    : "#F0FDF4"
                                  : inputBg,
                                borderColor: isCorrect
                                  ? "#16A34A"
                                  : darkMode
                                    ? "#475569"
                                    : "#CBD5E1",
                                color: textMain,
                              },
                            ]}
                            placeholder={
                              manualQType === "true_false"
                                ? idx === 0
                                  ? "True"
                                  : "False"
                                : `Enter option ${letter}...`
                            }
                            placeholderTextColor={textSub}
                            value={choice}
                            onChangeText={(v) => updateChoice(idx, v)}
                            editable={manualQType !== "true_false"}
                          />

                          {manualQType === "multiple_choice" && manualChoices.length > 2 && (
                            <TouchableOpacity
                              onPress={() =>
                                setManualChoices((prev) => prev.filter((_, i) => i !== idx))
                              }
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="close" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}

                    {manualQType === "multiple_choice" && manualChoices.length < 6 && (
                      <TouchableOpacity
                        style={[styles.addQAddChoiceBtn, { borderColor: border }]}
                        onPress={() => setManualChoices((prev) => [...prev, ""])}
                      >
                        <Ionicons name="add" size={16} color={accentColor} />
                        <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>
                          Add Choice
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {manualQType === "word_box" && (
                  <>
                    <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                      Word Bank choices
                    </Text>
                    {manualChoices.map((choice, idx) => (
                      <View key={idx} style={styles.addQChoiceRow}>
                        <TextInput
                          style={[
                            styles.addQChoiceInput,
                            { backgroundColor: inputBg, borderColor: border, color: textMain },
                          ]}
                          placeholder={`Word ${idx + 1}...`}
                          placeholderTextColor={textSub}
                          value={choice}
                          onChangeText={(v) => updateChoice(idx, v)}
                        />
                        {manualChoices.length > 2 && (
                          <TouchableOpacity
                            onPress={() =>
                              setManualChoices((prev) => prev.filter((_, i) => i !== idx))
                            }
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close" size={18} color="#94A3B8" />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    {manualChoices.length < 8 && (
                      <TouchableOpacity
                        style={[styles.addQAddChoiceBtn, { borderColor: border }]}
                        onPress={() => setManualChoices((prev) => [...prev, ""])}
                      >
                        <Ionicons name="add" size={16} color={accentColor} />
                        <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>
                          Add Word
                        </Text>
                      </TouchableOpacity>
                    )}
                    <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                      Correct word <Text style={{ color: "#EF4444" }}>*</Text>
                    </Text>
                    <TextInput
                      style={[
                        styles.addQAnswerInput,
                        { backgroundColor: inputBg, borderColor: border, color: textMain },
                      ]}
                      placeholder="Enter the exact word from the word bank..."
                      placeholderTextColor={textSub}
                      value={manualCorrectAnswer}
                      onChangeText={setManualCorrectAnswer}
                    />
                  </>
                )}

                {manualQType === "enumeration" && (
                  <>
                    <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                      Number of items to enumerate
                    </Text>
                    <View style={styles.addQPointsRow}>
                      {["2", "3", "4", "5", "6"].map((n) => (
                        <TouchableOpacity
                          key={n}
                          style={[
                            styles.addQPointBtn,
                            { backgroundColor: inputBg, borderColor: border },
                            manualEnumCount === n && {
                              backgroundColor: accentColor,
                              borderColor: accentColor,
                            },
                          ]}
                          onPress={() => setManualEnumCount(n)}
                        >
                          <Text
                            style={[
                              styles.addQPointBtnText,
                              { color: textSub },
                              manualEnumCount === n && { color: "#FFFFFF" },
                            ]}
                          >
                            {n}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {(manualQType === "identification" ||
                  manualQType === "fill_blank" ||
                  manualQType === "enumeration") && (
                  <>
                    <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                      Correct answer <Text style={{ color: "#EF4444" }}>*</Text>
                    </Text>
                    <TextInput
                      style={[
                        styles.addQAnswerInput,
                        { backgroundColor: inputBg, borderColor: border, color: textMain },
                      ]}
                      placeholder={
                        manualQType === "enumeration"
                          ? "e.g. Carbon dioxide, Methane, Water vapor"
                          : "Enter the correct answer..."
                      }
                      placeholderTextColor={textSub}
                      value={manualCorrectAnswer}
                      onChangeText={setManualCorrectAnswer}
                    />
                  </>
                )}

                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                  Points
                </Text>
                <View style={styles.addQPointsRow}>
                  {["1", "2", "3", "5"].map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.addQPointBtn,
                        { backgroundColor: inputBg, borderColor: border },
                        manualPoints === p && {
                          backgroundColor: accentColor,
                          borderColor: accentColor,
                        },
                      ]}
                      onPress={() => setManualPoints(p)}
                    >
                      <Text
                        style={[
                          styles.addQPointBtnText,
                          { color: textSub },
                          manualPoints === p && { color: "#FFFFFF" },
                        ]}
                      >
                        {p} pt{parseInt(p, 10) > 1 ? "s" : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={[styles.addQStickyFooter, { borderTopColor: border }]}>
                <TouchableOpacity
                  style={[styles.addQSubmitBtn, { backgroundColor: "#EA580C" }]}
                  onPress={handleAddManualQuestion}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.addQSubmitText}>Add to Draft</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ── Non-blocking Toast ── */}
        {toastMessage && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.draftToast,
              {
                opacity: toastFadeAnim,
                transform: [
                  {
                    translateY: toastFadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Ionicons
              name={/cancel/i.test(toastMessage) ? "close-circle" : "checkmark-circle"}
              size={16}
              color={/cancel/i.test(toastMessage) ? "#F87171" : "#10B981"}
            />
            <Text style={styles.draftToastText}>{toastMessage}</Text>
          </Animated.View>
        )}

        {/* ── Inspector Draft Publishing Loading Overlay ── */}
        <SmoothInlineOverlay
          visible={Boolean(publishingDraft)}
          cardStyle={[
            styles.loadingCard,
            {
              backgroundColor: darkMode ? cardBg : "#FFFFFF",
              borderColor: darkMode ? border : "#E2E8F0",
            },
          ]}
        >
          <PublishingQuizAnimation
            quizTitle={publishingQuizTitle || quiz?.quizTitle || "Assessment"}
            accentColor={accentColor}
            darkMode={darkMode}
          />
        </SmoothInlineOverlay>

        {/* ── Inspector Export Loading Overlay ── */}
        <SmoothInlineOverlay
          visible={Boolean(exportingPdf && !exportModalVisible)}
          cardStyle={[
            styles.loadingCard,
            {
              backgroundColor: darkMode ? cardBg : "#FFFFFF",
              borderColor: darkMode ? border : "#E2E8F0",
            },
          ]}
        >
          <PdfExportingAnimation
            exportVersion={exportVersion}
            quizTitle={selectedExportQuizTitle || quiz?.quizTitle || "Assessment"}
            accentColor={accentColor}
            darkMode={darkMode}
            isCancelling={cancellingExport}
            onCancel={
              onCancelExportPdf
                ? () => {
                    onCancelExportPdf();
                    showToast("PDF export cancelled");
                  }
                : undefined
            }
          />
        </SmoothInlineOverlay>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Top Bar */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 20 : 28,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  topBarLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 12,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },

  /* Preview Screen Banner (matching AIBuilderTab) */
  previewScreenBanner: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  previewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  previewModeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    flexShrink: 0,
  },
  previewModeBadgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  classChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: 170,
  },
  classChipText: {
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  previewSubtext: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  previewStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  previewStatItem: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    paddingHorizontal: 2,
  },
  previewStatValue: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 3,
  },
  previewStatLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.1,
  },
  previewStatDivider: {
    width: 1,
    height: 24,
  },

  /* Section Headers */
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sectionHeaderMeta: {
    fontSize: 12,
    fontWeight: "500",
  },

  /* Shared Word Bank */
  sharedWordBankCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  sharedWordBankHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  sharedWordBankTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  sharedWordBankChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sharedWordChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  sharedWordChipText: {
    fontSize: 12.5,
    fontWeight: "600",
  },

  /* Question Cards (matching AIBuilderTab) */
  questionCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  questionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  questionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  questionNumber: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  questionNumberText: {
    fontSize: 12,
    fontWeight: "700",
  },
  typeSelectorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    maxWidth: 140,
  },
  typeSelectorChipText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  questionPointsLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  questionHeaderToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  regenerateIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteQBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  questionText: {
    width: "100%",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    marginBottom: 12,
  },
  questionEditInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 64,
    textAlignVertical: "top",
  },
  smallCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  smallSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },

  /* Choices */
  choicesWrap: { marginTop: 0 },
  choiceItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  choiceText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },

  /* Answer Key Strip */
  answerWrap: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginTop: 4,
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 2,
  },
  answerText: {
    fontSize: 14,
    fontWeight: "600",
  },

  /* Add Question Manually Button */
  addQuestionBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 14,
    gap: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  addQuestionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  addQuestionTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  addQuestionSub: {
    fontSize: 12,
    marginTop: 2,
  },

  /* Footer */
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  publishBtn: {
    width: "100%",
    height: 46,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  publishText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  resultActions: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryFooterBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryFooterBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },

  /* In-Modal Bottom Sheets */
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
    zIndex: 100,
  },
  bottomSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sheetHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  sheetHeaderSub: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  typeOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  typeOptionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  typeOptionTitle: {
    fontSize: 13.5,
    fontWeight: "600",
  },
  typeOptionDesc: {
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 1,
  },
  typeModalFooter: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  typeRegenAiBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#EA580C",
  },
  typeRegenAiBtnText: {
    color: "#FFFFFF",
    fontSize: 13.5,
    fontWeight: "600",
  },
  typeConvertManualBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
  },
  typeConvertManualBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },

  /* Add Question Sheet */
  addQHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  addQTitle: {
    fontSize: 17,
    fontWeight: "800",
  },
  addQSubTitle: {
    fontSize: 12,
    marginTop: 2,
  },
  addQLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 14,
  },
  addQTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  addQTypeChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  addQTextInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    minHeight: 80,
  },
  addQChoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  choiceBadgeBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceBadgeBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  addQChoiceInput: {
    flex: 1,
    height: 44,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addQAddChoiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginBottom: 4,
  },
  addQAddChoiceText: {
    fontSize: 13,
    fontWeight: "600",
  },
  addQAnswerInput: {
    height: 48,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  addQPointsRow: {
    flexDirection: "row",
    gap: 10,
  },
  addQPointBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  addQPointBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  addQStickyFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    width: "100%",
  },
  addQSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
  },
  addQSubmitText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* Toast */
  draftToast: {
    position: "absolute",
    bottom: 96,
    alignSelf: "center",
    zIndex: 9999,
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  draftToastText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  /* Export Loading Overlay */
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    zIndex: 9999,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 344,
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 14,
  },
});
