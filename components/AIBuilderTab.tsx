import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
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
import { useTheme } from "../context/ThemeContext";
import {
    detectDocType,
    getDocBadgeInfo,
    parseDocumentFile,
    SupportedDocType,
} from "../lib/documentParserService";
import { BondPaperSize } from "../lib/paperSheetExporter";
import { generatePrintPackage, validateAnswerLengths } from "../lib/printEngine";
import {
    computeAssessmentCacheKey,
    getCachedPdfUri,
    shareCachedPdfUri,
    writeCachedPdf,
} from "../lib/printEngine/mobileShare";
import {
    AnswerKeyItem,
    GeneratedAssessment,
    generateScannableQuiz,
    QuestionType,
    regenerateSingleQuestion,
    ScannableQuestion,
} from "../lib/quizGeneratorService";
import { saveDraftQuiz, savePublishedQuiz } from "../lib/quizStore";
import {
    checkCanGenerate,
    getManilaDateString,
    getTeacherQuotaState,
    QuotaState,
    recordGenerationFailure,
    recordGenerationSuccess,
    resolveCurrentTeacherId,
} from "../lib/ai/aiQuotaService";
import { supabase } from "../supabase";

// ── Option lists ──────────────────────────────────────────────────────────────
const GRADE_LEVELS = [
    "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
    "Grade 7", "Grade 8", "Grade 9", "Grade 10",
    "Grade 11 (SHS)", "Grade 12 (SHS)",
];
const BLOOM_DIFFICULTIES = [
    "Easy (Recall & Understanding)",
    "Medium (Application & Analysis)",
    "Hard (Evaluation & Synthesis)",
];
const QUESTION_TYPES = [
    "Multiple Choice", "True / False", "Identification", "Fill in the Blank", "Enumeration", "Word Box", "Mixed Assessment",
];
const MIXED_TYPE_OPTIONS = [
    { key: "multiple_choice", label: "Multiple Choice" },
    { key: "enumeration", label: "Enumeration" },
    { key: "true_false", label: "True / False" },
    { key: "identification", label: "Identification" },
    { key: "fill_blank", label: "Fill in the Blank" },
    { key: "word_box", label: "Word Box" },
];
const QUESTION_COUNTS = [
    "5 Questions", "10 Questions", "15 Questions", "20 Questions",
    "25 Questions", "30 Questions", "40 Questions", "50 Questions",
];

// ── Answer Matching Helper ────────────────────────────────────────────────────
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

    // Match single letter answers e.g. "A", "B", "Option B", "B)"
    const optionLetter = String.fromCharCode(65 + choiceIndex);
    const letterMatch = aNorm.match(/^(?:option\s+)?([a-d])(?:\)|\.|\:|$)/i);
    if (letterMatch && letterMatch[1].toUpperCase() === optionLetter) {
        return true;
    }

    // Strip leading "A)", "A.", "Option A:" from either choice or answer
    const stripPrefix = (str: string) =>
        str.replace(/^(?:[a-d]\s*[\)\.\:\-]|option\s+[a-d][\:\.]?)\s*/i, "").trim();

    const cStripped = stripFormatting(stripPrefix(cClean)).toLowerCase();
    const aStripped = stripFormatting(stripPrefix(aClean)).toLowerCase();

    if (cStripped.length > 0 && cStripped === aStripped) return true;

    // Check substring inclusion (e.g. choice `wait` in answer "The 'wait' cursor")
    if (cStripped.length > 1 && aStripped.length > 1) {
        if (aStripped.includes(cStripped) || cStripped.includes(aStripped)) {
            return true;
        }
    }

    return false;
}

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({
    label, value, options, onSelect, accentColor,
}: {
    label: string; value: string; options: string[];
    onSelect: (v: string) => void; accentColor: string;
}) {
    const [open, setOpen] = useState(false);
    const { darkMode } = useTheme();
    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#1F2937";
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const border = darkMode ? "#374151" : "#D1D5DB";
    const inputBg = darkMode ? "#374151" : "#F9FAFB";

    return (
        <>
            <Text style={[styles.fieldLabel, { color: textSub }]}>{label}</Text>
            <TouchableOpacity
                style={[styles.dropdownBtn, { backgroundColor: inputBg, borderColor: border }]}
                onPress={() => setOpen(true)}
                activeOpacity={0.7}
            >
                <Text style={[styles.dropdownValue, { color: textMain }]}>{value}</Text>
                <Ionicons name="chevron-down" size={16} color={textSub} />
            </TouchableOpacity>

            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <TouchableOpacity style={styles.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
                    <View style={[styles.ddSheet, { backgroundColor: cardBg }]}>
                        <Text style={[styles.ddTitle, { color: accentColor }]}>{label}</Text>
                        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                            {options.map((opt) => (
                                <TouchableOpacity
                                    key={opt}
                                    style={[
                                        styles.ddItem,
                                        { borderBottomColor: border },
                                        value === opt && { backgroundColor: accentColor + "18" },
                                    ]}
                                    onPress={() => { onSelect(opt); setOpen(false); }}
                                >
                                    <Text style={[
                                        styles.ddItemText,
                                        { color: textMain },
                                        value === opt && { color: accentColor, fontWeight: "700" },
                                    ]}>
                                        {opt}
                                    </Text>
                                    {value === opt && (
                                        <Ionicons name="checkmark" size={16} color={accentColor} />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </TouchableOpacity>
            </Modal>
        </>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
type Props = {
    classroomId: string;
    classTitle: string;
    classSubject?: string;
    accentColor: string;
    onQuizPublished?: (quizTitle: string) => void;
};

export default function AIBuilderTab({ classroomId, classTitle, classSubject, accentColor, onQuizPublished }: Props) {
    const router = useRouter();
    const { darkMode } = useTheme();
    const bg = darkMode ? "#111827" : "#F9FAFB";
    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#1F2937";
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const border = darkMode ? "#374151" : "#D1D5DB";
    const inputBg = darkMode ? "#374151" : "#F9FAFB";

    const resolvedSubject = classSubject && classSubject.trim().length > 0 ? classSubject.trim() : "General";

    // ── Form state ─────────────────────────────────────────────────────────────
    const [lessonNotes, setLessonNotes] = useState("");
    const [subject, setSubject] = useState(resolvedSubject);

    useEffect(() => {
        if (classSubject && classSubject.trim().length > 0) {
            setSubject(classSubject.trim());
        }
    }, [classSubject]);
    const [gradeLevel, setGradeLevel] = useState("Grade 11 (SHS)");
    const [questionType, setQuestionType] = useState("Multiple Choice");
    const [mixedTypes, setMixedTypes] = useState<string[]>(["multiple_choice", "enumeration", "true_false"]);
    const [mixedPartCounts, setMixedPartCounts] = useState<Record<string, number>>({});
    const [questionCount, setQuestionCount] = useState("20 Questions");
    const [difficulty, setDifficulty] = useState("Medium (Application & Analysis)");
    const [attachedFile, setAttachedFile] = useState<{
        uri: string;
        name: string;
        mimeType: string;
        type: SupportedDocType;
        size?: number;
    } | null>(null);

    // ── Generation state ───────────────────────────────────────────────────────
    const [generating, setGenerating] = useState(false);
    const [generatingStatus, setGeneratingStatus] = useState<string>("");
    const [isAiBusy, setIsAiBusy] = useState(false);
    const [generatedAssessment, setGeneratedAssessment] = useState<GeneratedAssessment | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const [exportVersion, setExportVersion] = useState<"A" | "B" | "C">("A");
    const [forceSeparateMode, setForceSeparateMode] = useState(false);
    const [exportingStage, setExportingStage] = useState<string>("");
    const [editingAnswerQNum, setEditingAnswerQNum] = useState<number | null>(null);
    const [editingAnswerText, setEditingAnswerText] = useState("");
    const [regeneratingQNum, setRegeneratingQNum] = useState<number | null>(null);
    const [editingQuestionQNum, setEditingQuestionQNum] = useState<number | null>(null);
    const [editingQuestionText, setEditingQuestionText] = useState("");
    const [savingDraft, setSavingDraft] = useState(false);
    const [publishingQuiz, setPublishingQuiz] = useState(false);
    const [publishingStage, setPublishingStage] = useState<string>("");

    // ── Per-User Daily AI Quota (10x/day, resets 12:00 AM Manila) ──────────────
    const [currentTeacherId, setCurrentTeacherId] = useState<string | null>(null);
    const [quotaState, setQuotaState] = useState<QuotaState | null>(null);

    async function refreshUserQuota(explicitId?: string | null) {
        const uid = explicitId !== undefined ? explicitId : await resolveCurrentTeacherId();
        setCurrentTeacherId(uid);
        const state = await getTeacherQuotaState(uid);
        setQuotaState(state);
    }

    useEffect(() => {
        let mounted = true;
        refreshUserQuota();

        const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return;
            const nextUid = session?.user?.id || null;
            refreshUserQuota(nextUid);
        });

        // Check every 15s for 12:00 AM midnight Asia/Manila rollover
        let lastManilaDate = getManilaDateString();
        const midnightTimer = setInterval(() => {
            const nowManilaDate = getManilaDateString();
            if (nowManilaDate !== lastManilaDate) {
                lastManilaDate = nowManilaDate;
                refreshUserQuota();
            }
        }, 15000);

        return () => {
            mounted = false;
            authSub?.subscription?.unsubscribe();
            clearInterval(midnightTimer);
        };
    }, []);

    // Keep per-part item split synchronized when questionCount or mixedTypes changes
    const totalCountNumeric = parseInt(questionCount.split(" ")[0], 10) || 20;
    useEffect(() => {
        if (mixedTypes.length === 0) return;
        const base = Math.floor(totalCountNumeric / mixedTypes.length);
        const rem = totalCountNumeric % mixedTypes.length;
        const nextCounts: Record<string, number> = {};
        mixedTypes.forEach((key, idx) => {
            nextCounts[key] = base + (idx === 0 ? rem : 0);
        });
        setMixedPartCounts(nextCounts);
    }, [totalCountNumeric, mixedTypes]);

    function adjustPartCount(partKey: string, delta: number) {
        const idx = mixedTypes.indexOf(partKey);
        if (idx === -1 || mixedTypes.length < 2) return;
        const currentVal = mixedPartCounts[partKey] ?? 1;
        const nextVal = currentVal + delta;
        if (nextVal < 1) return;
        const otherKey = mixedTypes[(idx + 1) % mixedTypes.length];
        const otherVal = mixedPartCounts[otherKey] ?? 1;
        if (otherVal - delta < 1) return;
        setMixedPartCounts((prev) => ({
            ...prev,
            [partKey]: nextVal,
            [otherKey]: otherVal - delta,
        }));
    }

    // ── Manual Add Question state ─────────────────────────────────────────────
    const [addQuestionModalOpen, setAddQuestionModalOpen] = useState(false);
    const [manualQType, setManualQType] = useState<QuestionType>("multiple_choice");
    const [manualQText, setManualQText] = useState("");
    const [manualChoices, setManualChoices] = useState<string[]>(["A) ", "B) ", "C) ", "D) "]);
    const [manualCorrectAnswer, setManualCorrectAnswer] = useState("");
    const [manualPoints, setManualPoints] = useState("1");
    const [manualEnumCount, setManualEnumCount] = useState("3");
    const addQScrollRef = useRef<ScrollView>(null);

    // ── File handler ───────────────────────────────────────────────────────────
    async function handleAttachFile() {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: [
                    "application/pdf",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "application/vnd.ms-powerpoint",
                    "text/plain",
                ],
                copyToCacheDirectory: true,
            });
            if (result.canceled === false && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const detectedType = detectDocType(asset.name, asset.mimeType);
                setAttachedFile({
                    uri: asset.uri,
                    name: asset.name,
                    mimeType: asset.mimeType || "application/octet-stream",
                    type: detectedType,
                    size: asset.size,
                });
            }
        } catch (error) {
            console.error("Error picking document", error);
            Alert.alert("Error", "Failed to pick document");
        }
    }

    // ── Generate handler ───────────────────────────────────────────────────────
    async function handleGenerate() {
        if ((!attachedFile && !lessonNotes.trim()) || generating) return;

        // 1. Check per-user 10x daily quota (resets 12:00 AM Manila time)
        const activeTeacherId = currentTeacherId || (await resolveCurrentTeacherId());
        if (activeTeacherId && activeTeacherId !== currentTeacherId) {
            setCurrentTeacherId(activeTeacherId);
        }
        const quotaCheck = await checkCanGenerate(activeTeacherId, false);
        if (!quotaCheck.allowed) {
            await refreshUserQuota(activeTeacherId);
            Alert.alert(
                quotaCheck.reason === "DAILY_LIMIT" ? "Daily Limit Reached" : "Please Wait",
                quotaCheck.message ||
                    "You have reached today's 10x AI generation limit. Your quota resets at 12:00 AM midnight (Manila, Philippines time)."
            );
            return;
        }

        setGenerating(true);
        setGeneratingStatus("");
        setIsAiBusy(false);
        setShowResults(false);

        try {
            let attachedPdfBase64: string | undefined;
            let attachedFileText: string | undefined;
            let attachedFileType: SupportedDocType | undefined;

            if (attachedFile) {
                const parsed = await parseDocumentFile({
                    uri: attachedFile.uri,
                    name: attachedFile.name,
                    mimeType: attachedFile.mimeType,
                });

                attachedFileType = parsed.type;
                if (parsed.type === "pdf") {
                    attachedPdfBase64 = parsed.base64;
                } else {
                    attachedFileText = parsed.text;
                }
            }

            const count = parseInt(questionCount.split(" ")[0], 10) || 10;

            // Build the effective question type string preserving exact tick order and per-part item split
            let effectiveQuestionType = questionType;
            if (questionType === "Mixed Assessment" && mixedTypes.length > 0) {
                const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
                const selectedLabels = mixedTypes.map((key, idx) => {
                    const opt = MIXED_TYPE_OPTIONS.find((o) => o.key === key);
                    const label = opt ? opt.label : key;
                    const partCount = mixedPartCounts[key] ?? Math.max(1, Math.floor(count / mixedTypes.length));
                    return `Part ${romanNumerals[idx]}. ${label} (${partCount} items)`;
                });
                effectiveQuestionType = `Mixed Assessment (include ONLY these parts sequentially in this exact order and count: ${selectedLabels.join(", ")})`;
            }

            const assessment = await generateScannableQuiz({
                lessonNotes: lessonNotes.trim() || undefined,
                subject,
                gradeLevel,
                questionType: effectiveQuestionType,
                questionCount: count,
                difficulty,
                attachedPdfBase64,
                attachedPdfName: attachedFile ? attachedFile.name : undefined,
                attachedFileName: attachedFile ? attachedFile.name : undefined,
                attachedFileType,
                attachedFileText,
                onStatusUpdate: (status, busy) => {
                    setGeneratingStatus(status);
                    if (busy !== undefined) setIsAiBusy(busy);
                },
            });

            // Record successful generation for this user in `public.ai_generation_logs`
            const updatedQuota = await recordGenerationSuccess(activeTeacherId, false);
            setQuotaState(updatedQuota);

            setGeneratedAssessment(assessment);
            setShowResults(true);
        } catch (error: any) {
            console.error("Generation error:", error);
            const errMsg = error?.message || "";
            recordGenerationFailure(activeTeacherId, errMsg).catch(() => {});
            const isBusy =
                errMsg.toLowerCase().includes("busy") ||
                errMsg.includes("429") ||
                errMsg.includes("503") ||
                errMsg.toLowerCase().includes("quota") ||
                errMsg.toLowerCase().includes("rate");

            if (isBusy) {
                Alert.alert(
                    "AI is Busy",
                    "The AI servers are currently experiencing high traffic or temporary rate limits.\n\nWe automatically retried with backoff and attempted backup AI. Please wait a moment and try tapping 'Generate Assessment' again.",
                    [
                        { text: "Dismiss", style: "cancel" },
                        {
                            text: "AI Settings",
                            onPress: () => router.push("/settings"),
                        },
                    ]
                );
            } else if (errMsg.includes("backup provider") || errMsg.includes("Backup AI")) {
                Alert.alert(
                    "AI Generation Failed",
                    `${errMsg}\n\nYou can review your backup provider or try another model in Settings.`,
                    [
                        { text: "OK", style: "cancel" },
                        {
                            text: "Open Settings",
                            onPress: () => router.push("/settings"),
                        },
                    ]
                );
            } else {
                Alert.alert("Error Generating Quiz", errMsg || "Unknown error occurred.");
            }
        } finally {
            setGenerating(false);
            setGeneratingStatus("");
            setIsAiBusy(false);
        }
    }

    function handleReset() {
        setShowResults(false);
        setGeneratedAssessment(null);
        setLessonNotes("");
        setSubject(resolvedSubject);
        setAttachedFile(null);
        setMixedTypes(["multiple_choice", "enumeration", "true_false"]);
    }

    // ── Manual question helpers ────────────────────────────────────────────────
    function resetManualForm() {
        setManualQType("multiple_choice");
        setManualQText("");
        setManualChoices(["A) ", "B) ", "C) ", "D) "]);
        setManualCorrectAnswer("");
        setManualPoints("1");
        setManualEnumCount("3");
    }

    function openAddQuestionModal() {
        resetManualForm();
        setAddQuestionModalOpen(true);
    }

    function handleManualQTypeChange(type: QuestionType) {
        setManualQType(type);
        setManualCorrectAnswer("");
        if (type === "multiple_choice") {
            setManualChoices(["A) ", "B) ", "C) ", "D) "]);
        } else if (type === "true_false") {
            setManualChoices(["A) True", "B) False"]);
        } else if (type === "word_box") {
            setManualChoices(["", "", "", ""]);
        } else {
            setManualChoices([]);
        }
    }

    function updateChoice(index: number, value: string) {
        setManualChoices((prev) => {
            const updated = [...prev];
            updated[index] = value;
            return updated;
        });
    }

    function addChoice() {
        if (manualQType === "word_box") {
            setManualChoices((prev) => [...prev, ""]);
        } else {
            const nextLetter = String.fromCharCode(65 + manualChoices.length);
            setManualChoices((prev) => [...prev, `${nextLetter}) `]);
        }
    }

    function removeChoice(index: number) {
        setManualChoices((prev) => prev.filter((_, i) => i !== index));
    }

    function handleAddManualQuestion() {
        if (!generatedAssessment) return;
        const trimmedText = manualQText.trim();
        if (!trimmedText) {
            Alert.alert("Missing Question", "Please enter the question text.");
            return;
        }
        const trimmedAnswer = manualCorrectAnswer.trim();
        if (!trimmedAnswer) {
            Alert.alert("Missing Answer", "Please enter the correct answer.");
            return;
        }

        const nextNumber = generatedAssessment.questions.length + 1;
        const enumCount = parseInt(manualEnumCount, 10) || 3;

        const newQuestion: ScannableQuestion = {
            questionNumber: nextNumber,
            type: manualQType,
            questionText: trimmedText,
            options: (manualQType === "multiple_choice" || manualQType === "true_false" || manualQType === "word_box")
                ? manualChoices.filter((c) => c.trim().length > 0)
                : [],
            answerBoxesRequired: manualQType === "enumeration" ? Math.min(Math.max(enumCount, 2), 6) : 1,
        };

        const newAnswerKey: AnswerKeyItem = {
            questionNumber: nextNumber,
            correctAnswer: trimmedAnswer,
            points: parseInt(manualPoints, 10) || 1,
        };

        setGeneratedAssessment({
            ...generatedAssessment,
            questions: [...generatedAssessment.questions, newQuestion],
            answerKey: [...generatedAssessment.answerKey, newAnswerKey],
        });

        setAddQuestionModalOpen(false);
        resetManualForm();
    }

    function handleDeleteQuestion(questionNumber: number) {
        if (!generatedAssessment) return;
        Alert.alert(
            "Delete Question",
            `Remove question #${questionNumber}? Remaining questions will be renumbered.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                        const filteredQ = generatedAssessment.questions
                            .filter((q) => q.questionNumber !== questionNumber)
                            .map((q, idx) => ({ ...q, questionNumber: idx + 1 }));
                        const filteredA = generatedAssessment.answerKey
                            .filter((a) => a.questionNumber !== questionNumber)
                            .map((a, idx) => ({ ...a, questionNumber: idx + 1 }));
                        setGeneratedAssessment({
                            ...generatedAssessment,
                            questions: filteredQ,
                            answerKey: filteredA,
                        });
                    },
                },
            ]
        );
    }

    function handleSaveInlineAnswerEdit(questionNumber: number) {
        if (!generatedAssessment) return;
        const trimmed = editingAnswerText.trim();
        if (!trimmed) return;
        const updatedKey = generatedAssessment.answerKey.map((k) =>
            k.questionNumber === questionNumber ? { ...k, correctAnswer: trimmed } : k
        );
        const updated = {
            ...generatedAssessment,
            answerKey: updatedKey,
        };
        setGeneratedAssessment(updated);
        setEditingAnswerQNum(null);
        setEditingAnswerText("");
    }

    function handleRegenerateQuestion(questionNumber: number) {
        if (!generatedAssessment || regeneratingQNum !== null) return;
        const targetQ = generatedAssessment.questions.find((q) => q.questionNumber === questionNumber);
        if (!targetQ) return;

        const typeLabel = targetQ.type.replace(/_/g, " ").toUpperCase();

        Alert.alert(
            `Regenerate Question #${questionNumber}?`,
            `This will replace Question #${questionNumber} with a new AI-generated ${typeLabel} question, keeping all other questions untouched.\n\n(Single-question regeneration does not consume your daily quiz quota.)`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Regenerate",
                    onPress: async () => {
                        setRegeneratingQNum(questionNumber);
                        try {
                            let attachedPdfBase64: string | undefined;
                            let attachedFileText: string | undefined;
                            let attachedFileType: SupportedDocType | undefined;

                            if (attachedFile) {
                                const parsed = await parseDocumentFile({
                                    uri: attachedFile.uri,
                                    name: attachedFile.name,
                                    mimeType: attachedFile.mimeType,
                                });
                                attachedFileType = parsed.type;
                                if (parsed.type === "pdf") {
                                    attachedPdfBase64 = parsed.base64;
                                } else if (parsed.text) {
                                    attachedFileText = parsed.text;
                                }
                            }

                            const result = await regenerateSingleQuestion({
                                questionNumber,
                                questionType: targetQ.type,
                                currentQuestionText: targetQ.questionText,
                                otherQuestions: generatedAssessment.questions,
                                quizTitle: generatedAssessment.quizTitle,
                                subject,
                                gradeLevel,
                                difficulty,
                                lessonNotes: lessonNotes.trim() || undefined,
                                attachedPdfBase64,
                                attachedPdfName: attachedFile ? attachedFile.name : undefined,
                                attachedFileName: attachedFile ? attachedFile.name : undefined,
                                attachedFileType,
                                attachedFileText,
                            });

                            setGeneratedAssessment((prev) => {
                                if (!prev) return null;
                                const updatedQuestions = prev.questions.map((q) =>
                                    q.questionNumber === questionNumber ? result.question : q
                                );
                                const updatedAnswerKey = prev.answerKey.map((ak) =>
                                    ak.questionNumber === questionNumber ? result.answerKey : ak
                                );
                                return {
                                    ...prev,
                                    questions: updatedQuestions,
                                    answerKey: updatedAnswerKey,
                                };
                            });

                            Alert.alert(
                                "Question Regenerated!",
                                `Question #${questionNumber} has been replaced with a fresh ${targetQ.type.replace(/_/g, " ")} question.`
                            );
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
            ]
        );
    }

    function handleSaveQuestionTextEdit(questionNumber: number) {
        if (!generatedAssessment) return;
        const trimmed = editingQuestionText.trim();
        if (!trimmed) {
            setEditingQuestionQNum(null);
            return;
        }
        const updatedQ = generatedAssessment.questions.map((q) =>
            q.questionNumber === questionNumber ? { ...q, questionText: trimmed } : q
        );
        setGeneratedAssessment({
            ...generatedAssessment,
            questions: updatedQ,
        });
        setEditingQuestionQNum(null);
        setEditingQuestionText("");
    }

    async function handleExportPaper(
        includeKey: boolean = false,
        paperSize: BondPaperSize = "short",
        versionOverride?: "A" | "B" | "C"
    ) {
        if (!generatedAssessment || exportingPdf) return;

        const activeVersion = versionOverride || exportVersion;
        const target = includeKey ? "ANSWER_KEY_ONLY" : "STUDENT_ONLY";
        const cacheKey = computeAssessmentCacheKey(
            generatedAssessment,
            {
                paperSize,
                version: activeVersion,
                target,
                forceSeparate: forceSeparateMode,
            },
            includeKey ? "key" : "student"
        );

        const safeTitle = (generatedAssessment.quizTitle || "Assessment").replace(/[^a-zA-Z0-9]/g, "_");
        const suggestedFileName = includeKey
            ? `${safeTitle}_Answer_Key_Set_${activeVersion}.pdf`
            : `${safeTitle}_Set_${activeVersion}_${paperSize.toUpperCase()}.pdf`;
        const dialogTitle = includeKey
            ? `${generatedAssessment.quizTitle} — Teacher Answer Key (Set ${activeVersion})`
            : `${generatedAssessment.quizTitle} — Student Paper (Set ${activeVersion})`;

        setExportingStage(
            includeKey
                ? `Preparing Teacher Answer Key for Set ${activeVersion}...`
                : `Formatting Set ${activeVersion} (${paperSize === "long" ? "Long Bond" : "Short Bond"})...`
        );
        setExportingPdf(true);

        try {
            // 1. Instant check in cache
            const cachedUri = await getCachedPdfUri(cacheKey);
            if (cachedUri) {
                setExportingStage(`Loading cached Set ${activeVersion} PDF...`);
                await new Promise((r) => setTimeout(r, 200));
                setExportModalOpen(false);
                setExportingPdf(false);
                await new Promise((r) => setTimeout(r, 120));
                await shareCachedPdfUri(cachedUri, dialogTitle, suggestedFileName).catch(console.warn);
                return;
            }

            // 2. Build PDF cleanly on demand and cache for subsequent exports
            setExportingStage(`Rendering scannable test sheet for Set ${activeVersion}...`);
            await new Promise((r) => setTimeout(r, 80));
            const printPkg = await generatePrintPackage(generatedAssessment, {
                paperSize,
                version: activeVersion,
                classTitle,
                subject,
                gradeLevel,
                forceSeparate: forceSeparateMode,
                quizId: `QZ-${Date.now().toString().slice(-6)}`,
                target,
            });

            const bytesToExport = includeKey
                ? printPkg.answerKeyPdf
                : (printPkg.combinedStudentPdf || printPkg.studentPdf);

            if (!bytesToExport || bytesToExport.length === 0) {
                throw new Error("Generated PDF has no content.");
            }

            setExportingStage("Ready! Preparing share options...");
            const fileUri = await writeCachedPdf(cacheKey, bytesToExport);
            const shareUri = await writeCachedPdf(suggestedFileName, bytesToExport);

            await new Promise((r) => setTimeout(r, 250));
            setExportModalOpen(false);
            setExportingPdf(false);

            await new Promise((r) => setTimeout(r, 120));
            await shareCachedPdfUri(
                shareUri || fileUri,
                includeKey
                    ? `${generatedAssessment.quizTitle} — Teacher Answer Key (Set ${activeVersion})`
                    : `${generatedAssessment.quizTitle} — Student Paper (${printPkg.fitMessage})`,
                suggestedFileName
            );
        } catch (err: any) {
            setExportingPdf(false);
            Alert.alert("Export Error", err.message || "Failed to export PDF test paper.");
        } finally {
            setExportingPdf(false);
            setExportingStage("");
        }
    }

    async function handlePublishQuiz() {
        if (!generatedAssessment || publishingQuiz) return;

        // Validate answer lengths before publishing
        const flaggedQuestions = validateAnswerLengths(generatedAssessment);
        if (flaggedQuestions.length > 0) {
            const flaggedDetails = flaggedQuestions
                .map((f) => `• Q#${f.questionNumber}: "${f.answer}" (${f.charCount} chars, ${f.wordCount} words)`)
                .join("\n");
            Alert.alert(
                "Long Answers Detected",
                `Some answers exceed the scannable box limit (max 25 chars / 3 words):\n\n${flaggedDetails}\n\nYou can edit them directly on the cards below or publish anyway.`,
                [
                    { text: "Shorten Answers", style: "cancel" },
                    { text: "Publish Anyway", onPress: () => executePublish() },
                ]
            );
            return;
        }

        await executePublish();
    }

    async function executePublish() {
        if (!generatedAssessment || publishingQuiz) return;
        setPublishingStage(`Mapping scannable answer boxes for "${generatedAssessment.quizTitle}"...`);
        setPublishingQuiz(true);
        try {
            // Allow the Publishing Loading Modal to mount & animate smoothly before computing
            await new Promise((r) => setTimeout(r, 60));

            const quizId = `QZ-${Date.now().toString().slice(-6)}`;

            // 1. Instant layout-only pass (< 5 ms using built-in font metrics, does not build PDF)
            const printPkg = await generatePrintPackage(generatedAssessment, {
                paperSize: "short",
                version: "A",
                classTitle,
                subject,
                gradeLevel,
                quizId,
                target: "LAYOUT_ONLY",
            });

            setPublishingStage(`Saving to ${classTitle} and syncing to your cloud archive...`);

            const quizWithMeta = {
                ...generatedAssessment,
                subject,
                difficulty,
                questionType,
                gradeLevel,
                layoutJson: printPkg.layoutJson,
                answerVariants: printPkg.layoutJson.answerVariants,
            };
            await savePublishedQuiz(classroomId, quizWithMeta, classTitle);

            setPublishingQuiz(false);
            setPublishingStage("");
            await new Promise((r) => setTimeout(r, 120));

            Alert.alert(
                "Quiz Published!",
                `"${generatedAssessment.quizTitle}" is published to ${classTitle} and saved to your Archive with scannable layout coordinates (${printPkg.fitMessage}). Ready for camera grading in the Grader tab!`,
                [
                    {
                        text: "Export PDF Now",
                        onPress: () => setExportModalOpen(true),
                    },
                    {
                        text: "Go to Grader to Scan",
                        onPress: () => onQuizPublished?.(generatedAssessment.quizTitle),
                    },
                    {
                        text: "Stay Here",
                        style: "cancel",
                    },
                ]
            );
        } catch (err: any) {
            setPublishingQuiz(false);
            setPublishingStage("");
            Alert.alert("Publish Failed", err.message || "Failed to save quiz to grader.");
        } finally {
            setPublishingQuiz(false);
            setPublishingStage("");
        }
    }

    async function handleSaveDraft() {
        if (!generatedAssessment || savingDraft) return;
        setSavingDraft(true);
        try {
            const draftWithMeta = {
                ...generatedAssessment,
                subject,
                difficulty,
                questionType,
                gradeLevel,
            };
            await saveDraftQuiz(classroomId, draftWithMeta, classTitle);
            Alert.alert(
                "Assessment Saved as Draft",
                `"${generatedAssessment.quizTitle}" has been saved to device drafts.\n\nDrafts are cached on this device and automatically delete after 7 days (like Instagram). You can inspect or publish it to your cloud archive anytime in Settings under "Drafts"!`,
                [{ text: "OK" }]
            );
        } catch (err: any) {
            Alert.alert("Save Failed", err.message || "Failed to save draft.");
        } finally {
            setSavingDraft(false);
        }
    }

    const canGenerate = (attachedFile !== null || lessonNotes.trim().length > 0) && !generating;

    return (
        <ScrollView
            style={[styles.root, { backgroundColor: bg }]}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
        >
            {/* ── Header ── */}
            <View style={styles.headerRow}>
                <View style={[styles.headerIconBg, { backgroundColor: accentColor + "22" }]}>
                    <Ionicons name="sparkles" size={20} color={accentColor} />
                </View>
                <View>
                    <Text style={[styles.headerTitle, { color: textMain }]}>Tseki AI Assessment Suite</Text>
                    <Text style={[styles.headerSub, { color: textSub }]}>Auto-generate quizzes for {classTitle}</Text>
                </View>
            </View>

            {!showResults ? (
                <>
                    {/* ── Attached File ── */}
                    <Text style={[styles.fieldLabel, { color: textSub }]}>ATTACH REFERENCE FILE <Text style={styles.optional}>(DOC, PPT, PDF - OPTIONAL)</Text></Text>
                    <TouchableOpacity
                        style={[
                            styles.attachBtn,
                            { backgroundColor: inputBg, borderColor: border },
                            attachedFile && {
                                borderColor: getDocBadgeInfo(attachedFile.type).color + "60",
                                backgroundColor: getDocBadgeInfo(attachedFile.type).bgColor + (darkMode ? "22" : "40"),
                                borderStyle: "solid",
                            },
                        ]}
                        onPress={handleAttachFile}
                        activeOpacity={0.7}
                    >
                        {attachedFile ? (
                            <>
                                <View style={[styles.docBadge, { backgroundColor: getDocBadgeInfo(attachedFile.type).bgColor }]}>
                                    <Ionicons
                                        name={getDocBadgeInfo(attachedFile.type).icon as any}
                                        size={16}
                                        color={getDocBadgeInfo(attachedFile.type).color}
                                    />
                                    <Text style={[styles.docBadgeText, { color: getDocBadgeInfo(attachedFile.type).color }]}>
                                        {getDocBadgeInfo(attachedFile.type).label}
                                    </Text>
                                </View>
                                <Text style={[styles.attachBtnTextActive, { color: textMain }]} numberOfLines={1}>
                                    {attachedFile.name}
                                </Text>
                                <TouchableOpacity
                                    onPress={() => setAttachedFile(null)}
                                    style={styles.attachRemoveBtn}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons name="close-circle" size={20} color="#EF4444" />
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <Ionicons name="document-attach-outline" size={20} color={textSub} />
                                <Text style={[styles.attachBtnText, { color: textSub }]} numberOfLines={1}>
                                    Tap to attach file (DOC, PPT, PDF)
                                </Text>
                                <View style={[styles.formatPill, { backgroundColor: darkMode ? "#374151" : "#E5E7EB" }]}>
                                    <Text style={[styles.formatPillText, { color: textSub }]}>Docs • PPT • PDF</Text>
                                </View>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── Paste Lesson Notes or Syllabus Text (Optional) ── */}
                    <Text style={[styles.fieldLabel, { color: textSub }]}>
                        PASTE LESSON NOTES OR SYLLABUS TEXT <Text style={styles.optional}>(OPTIONAL)</Text>
                    </Text>
                    <TextInput
                        style={[styles.textAreaInput, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                        placeholder="Paste textbook excerpts, lesson summary, or curriculum outline here for deeper contextual accuracy..."
                        placeholderTextColor={textSub}
                        value={lessonNotes}
                        onChangeText={setLessonNotes}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />

                    {/* ── Subject (Auto from Classroom) + Grade Level ── */}
                    <View style={styles.twoCol}>
                        <View style={styles.colHalf}>
                            <Text style={[styles.fieldLabel, { color: textSub }]}>SUBJECT</Text>
                            <View style={[styles.autoSubjectBtn, { backgroundColor: inputBg, borderColor: border }]}>
                                <Text style={[styles.autoSubjectText, { color: textMain }]} numberOfLines={1}>
                                    {subject}
                                </Text>
                                <Ionicons name="lock-closed" size={14} color={textSub} />
                            </View>
                        </View>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="GRADE LEVEL"
                                value={gradeLevel}
                                options={GRADE_LEVELS}
                                onSelect={setGradeLevel}
                                accentColor={accentColor}
                            />
                        </View>
                    </View>

                    {/* ── Question Type + Count ── */}
                    <View style={styles.twoCol}>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="QUESTION TYPE"
                                value={questionType}
                                options={QUESTION_TYPES}
                                onSelect={setQuestionType}
                                accentColor={accentColor}
                            />
                        </View>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="QUESTIONS COUNT"
                                value={questionCount}
                                options={QUESTION_COUNTS}
                                onSelect={setQuestionCount}
                                accentColor={accentColor}
                            />
                        </View>
                    </View>

                    {/* ── Mixed Assessment Type Picker ── */}
                    {questionType === "Mixed Assessment" && (
                        <View style={[styles.mixedPickerContainer, { backgroundColor: inputBg, borderColor: border }]}>
                            <View style={styles.mixedPickerHeader}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                    <Ionicons name="layers-outline" size={16} color={accentColor} />
                                    <Text style={[styles.mixedPickerTitle, { color: accentColor }]}>
                                        Select Test Types to Include
                                    </Text>
                                </View>
                                <View style={[styles.mixedCountBadge, { backgroundColor: accentColor + "18" }]}>
                                    <Text style={[styles.mixedCountText, { color: accentColor }]}>
                                        {mixedTypes.length} Selected
                                    </Text>
                                </View>
                            </View>

                            <Text style={[styles.mixedPickerHint, { color: textSub }]}>
                                Pick which test parts to include (e.g. I. Multiple Choice, II. Enumeration, III. True/False). Questions will be grouped into sequential parts.
                            </Text>

                            <View style={styles.mixedPickerGrid}>
                                {MIXED_TYPE_OPTIONS.map((opt) => {
                                    const orderIndex = mixedTypes.indexOf(opt.key);
                                    const isSelected = orderIndex !== -1;
                                    const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
                                    const roman = isSelected ? romanNumerals[orderIndex] : null;

                                    return (
                                        <TouchableOpacity
                                            key={opt.key}
                                            style={[
                                                styles.mixedChip,
                                                { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", borderColor: border },
                                                isSelected && { backgroundColor: accentColor + "15", borderColor: accentColor },
                                            ]}
                                            onPress={() => {
                                                if (isSelected) {
                                                    // Don't allow deselecting if only 2 remain
                                                    if (mixedTypes.length <= 2) {
                                                        Alert.alert("Minimum Required", "Please select at least 2 test types for a mixed assessment.");
                                                        return;
                                                    }
                                                    setMixedTypes(mixedTypes.filter((k) => k !== opt.key));
                                                } else {
                                                    setMixedTypes([...mixedTypes, opt.key]);
                                                }
                                            }}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons
                                                name={isSelected ? "checkbox" : "square-outline"}
                                                size={18}
                                                color={isSelected ? accentColor : textSub}
                                                style={{ marginRight: 6 }}
                                            />
                                            {roman && (
                                                <View style={[styles.mixedRomanBadge, { backgroundColor: accentColor }]}>
                                                    <Text style={styles.mixedRomanBadgeText}>{roman}</Text>
                                                </View>
                                            )}
                                            <Text style={[
                                                styles.mixedChipText,
                                                { color: isSelected ? accentColor : textMain },
                                                isSelected && { fontWeight: "700" },
                                            ]}>
                                                {opt.label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {/* Per-Part Item Split Editor (in exact tick order) */}
                            {mixedTypes.length >= 2 && (
                                <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: border }}>
                                    <Text style={{ fontSize: 11, fontWeight: "700", color: textSub, marginBottom: 6 }}>
                                        ITEMS PER PART (TICK ORDER)
                                    </Text>
                                    {mixedTypes.map((key, idx) => {
                                        const opt = MIXED_TYPE_OPTIONS.find((o) => o.key === key);
                                        const romanNumerals = ["I", "II", "III", "IV", "V", "VI"];
                                        const countVal = mixedPartCounts[key] ?? 1;
                                        return (
                                            <View
                                                key={`split_${key}`}
                                                style={{
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    paddingVertical: 5,
                                                }}
                                            >
                                                <Text style={{ fontSize: 12.5, fontWeight: "600", color: textMain }}>
                                                    Part {romanNumerals[idx]}. {opt?.label || key}
                                                </Text>
                                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                                    <TouchableOpacity
                                                        onPress={() => adjustPartCount(key, -1)}
                                                        style={{
                                                            width: 24,
                                                            height: 24,
                                                            borderRadius: 6,
                                                            borderWidth: 1,
                                                            borderColor: border,
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                                                        }}
                                                    >
                                                        <Ionicons name="remove" size={14} color={textMain} />
                                                    </TouchableOpacity>
                                                    <Text style={{ fontSize: 13, fontWeight: "700", color: accentColor, minWidth: 26, textAlign: "center" }}>
                                                        {countVal}
                                                    </Text>
                                                    <TouchableOpacity
                                                        onPress={() => adjustPartCount(key, 1)}
                                                        style={{
                                                            width: 24,
                                                            height: 24,
                                                            borderRadius: 6,
                                                            borderWidth: 1,
                                                            borderColor: border,
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                                                        }}
                                                    >
                                                        <Ionicons name="add" size={14} color={textMain} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                        </View>
                    )}

                    {/* ── Bloom's Taxonomy Difficulty ── */}
                    <Dropdown
                        label="BLOOM'S TAXONOMY DIFFICULTY"
                        value={difficulty}
                        options={BLOOM_DIFFICULTIES}
                        onSelect={setDifficulty}
                        accentColor={accentColor}
                    />

                    {/* ── Per-User Daily AI Quota Status Pill (10x/day, resets 12:00 AM Manila) ── */}
                    {quotaState && (
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginTop: 18,
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: quotaState.isDailyLimitReached
                                    ? "#FCA5A5"
                                    : accentColor + "40",
                                backgroundColor: quotaState.isDailyLimitReached
                                    ? (darkMode ? "rgba(220, 38, 38, 0.15)" : "#FEF2F2")
                                    : accentColor + "12",
                            }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                                <Ionicons
                                    name={quotaState.isDailyLimitReached ? "lock-closed" : "flash"}
                                    size={16}
                                    color={quotaState.isDailyLimitReached ? "#DC2626" : accentColor}
                                />
                                <View style={{ flex: 1 }}>
                                    <Text
                                        style={{
                                            fontSize: 12.5,
                                            fontWeight: "700",
                                            color: quotaState.isDailyLimitReached ? "#DC2626" : textMain,
                                        }}
                                    >
                                        {quotaState.isDailyLimitReached
                                            ? `Daily Limit Reached (${quotaState.usedToday}/${quotaState.dailyLimit} used)`
                                            : `Daily AI Generations: ${quotaState.remainingToday} / ${quotaState.dailyLimit} left`}
                                    </Text>
                                    <Text style={{ fontSize: 11, color: textSub, marginTop: 1 }}>
                                        {`${quotaState.usedToday} generated today • Resets 12:00 AM (Manila, PH)`}
                                    </Text>
                                </View>
                            </View>
                            <View
                                style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 8,
                                    backgroundColor: quotaState.isDailyLimitReached
                                        ? "#DC2626"
                                        : accentColor,
                                }}
                            >
                                <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>
                                    {`${quotaState.remainingToday}x`}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* ── Generate Button ── */}
                    <TouchableOpacity
                        style={[
                            styles.generateBtn,
                            { backgroundColor: canGenerate ? accentColor : (darkMode ? "#4B5563" : "#D1D5DB") },
                        ]}
                        onPress={handleGenerate}
                        disabled={!canGenerate}
                        activeOpacity={0.85}
                    >
                        {generating ? (
                            <>
                                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
                                <Text style={styles.generateBtnText}>Generating...</Text>
                            </>
                        ) : (
                            <>
                                <Ionicons name="sparkles" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                                <Text style={styles.generateBtnText}>Generate with Tseki AI</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── Info note ── */}
                    <View style={styles.infoNote}>
                        <Ionicons name="information-circle-outline" size={15} color={textSub} />
                        <Text style={[styles.infoText, { color: textSub }]}>
                            {!attachedFile && !lessonNotes.trim()
                                ? "Attach a reference file (DOC, PPT, PDF) or paste lesson notes to generate an assessment."
                                : "Questions are generated based on DepEd curriculum standards and your materials."}
                        </Text>
                    </View>
                </>
            ) : (
                <>
                    {/* ── Preview Screen Header Banner ── */}
                    <View style={[styles.previewScreenBanner, { backgroundColor: cardBg, borderColor: border }]}>
                        <View style={styles.previewTopRow}>
                            <View style={[styles.previewModeBadge, { backgroundColor: accentColor + "18", borderColor: accentColor + "33" }]}>
                                <Ionicons name="eye-outline" size={13} color={accentColor} />
                                <Text style={[styles.previewModeBadgeText, { color: accentColor }]}>PREVIEW BEFORE SAVING</Text>
                            </View>
                            <TouchableOpacity
                                onPress={handleReset}
                                style={[styles.previewResetBtn, { backgroundColor: inputBg, borderColor: border }]}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="refresh" size={13} color={textSub} style={{ marginRight: 4 }} />
                                <Text style={[styles.previewResetBtnText, { color: textSub }]}>New Quiz</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.previewTitle, { color: textMain }]} numberOfLines={2}>
                            {generatedAssessment?.quizTitle || "Assessment Preview"}
                        </Text>

                        <Text style={[styles.previewSubtext, { color: textSub }]}>
                            Review questions, edit answers, or tap "Regenerate this question only" on any card to replace it before saving or publishing.
                        </Text>

                        <View style={[styles.previewStatsRow, { backgroundColor: inputBg, borderColor: border }]}>
                            <View style={styles.previewStatItem}>
                                <Text style={[styles.previewStatValue, { color: accentColor }]}>
                                    {generatedAssessment?.questions.length || questionCount}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: textSub }]}>Questions</Text>
                            </View>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <View style={styles.previewStatItem}>
                                <Text style={[styles.previewStatValue, { color: accentColor }]}>
                                    {generatedAssessment?.questions.reduce((sum, q) => sum + (q.type === "enumeration" ? (q.answerBoxesRequired || 3) : 1), 0) || questionCount}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: textSub }]}>Points</Text>
                            </View>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <View style={styles.previewStatItem}>
                                <Text style={[styles.previewStatValue, { color: accentColor }]}>
                                    {difficulty.split(" ")[0]}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: textSub }]}>Difficulty</Text>
                            </View>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <View style={styles.previewStatItem}>
                                <Text style={[styles.previewStatValue, { color: accentColor }]}>
                                    {gradeLevel.replace(/Grade\s*/i, "Gr ")}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: textSub }]}>Grade</Text>
                            </View>
                        </View>
                    </View>

                    {/* ── Scannable Question Cards ── */}
                    {generatedAssessment?.questions.map((q) => {
                        const answerObj = generatedAssessment.answerKey.find((k) => k.questionNumber === q.questionNumber);
                        const correctAnswer = answerObj ? answerObj.correctAnswer : "";
                        const points = answerObj ? answerObj.points : 1;
                        const typeLabel = q.type.replace(/_/g, " ").toUpperCase();

                        return (
                            <View key={q.questionNumber} style={[styles.questionCard, { backgroundColor: cardBg, borderColor: border }]}>
                                <View style={styles.questionHeader}>
                                    <View style={[styles.questionNumber, { backgroundColor: accentColor }]}>
                                        <Text style={styles.questionNumberText}>{q.questionNumber}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                            <View style={styles.qTypeBadge}>
                                                <Text style={styles.qTypeBadgeText}>{typeLabel}</Text>
                                            </View>
                                            <View style={styles.boxesBadge}>
                                                <Text style={styles.boxesBadgeText}>
                                                    {q.answerBoxesRequired} {q.answerBoxesRequired > 1 ? "BOXES" : "BOX"}
                                                </Text>
                                            </View>
                                        </View>
                                        {editingQuestionQNum === q.questionNumber ? (
                                            <View style={{ marginTop: 4 }}>
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
                                                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                                                    <TouchableOpacity
                                                        onPress={() => setEditingQuestionQNum(null)}
                                                        style={[styles.smallCancelBtn, { borderColor: border }]}
                                                    >
                                                        <Text style={{ fontSize: 11, fontWeight: "600", color: textSub }}>Cancel</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        onPress={() => handleSaveQuestionTextEdit(q.questionNumber)}
                                                        style={[styles.smallSaveBtn, { backgroundColor: accentColor }]}
                                                    >
                                                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>Save Question</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        ) : (
                                            <Text style={[styles.questionText, { color: textMain }]} numberOfLines={6}>
                                                {q.questionText}
                                            </Text>
                                        )}
                                    </View>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                        {/* Edit question text button */}
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
                                                name={editingQuestionQNum === q.questionNumber ? "close" : "pencil-outline"}
                                                size={16}
                                                color={editingQuestionQNum === q.questionNumber ? textSub : accentColor}
                                            />
                                        </TouchableOpacity>
                                        {/* Delete question button */}
                                        <TouchableOpacity
                                            onPress={() => handleDeleteQuestion(q.questionNumber)}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                            style={styles.deleteQBtn}
                                        >
                                            <Ionicons name="trash-outline" size={16} color="#EF4444" />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                {/* Word Bank display for word_box questions */}
                                {q.type === "word_box" && q.options && q.options.length > 0 && (
                                    <View style={[styles.wordBankContainer, { backgroundColor: inputBg, borderColor: border }]}>
                                        <View style={styles.wordBankHeader}>
                                            <Ionicons name="grid" size={13} color={textSub} />
                                            <Text style={[styles.wordBankTitle, { color: textSub }]}>WORD BANK</Text>
                                        </View>
                                        <View style={styles.wordBankChipsWrap}>
                                            {q.options.map((opt, cIdx) => {
                                                const isCorrect = opt.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
                                                return (
                                                    <View
                                                        key={`wb_${cIdx}`}
                                                        style={[
                                                            styles.wordBankChip,
                                                            { backgroundColor: darkMode ? "#374151" : "#FFFFFF", borderColor: border },
                                                            isCorrect && { backgroundColor: accentColor + "18", borderColor: accentColor },
                                                        ]}
                                                    >
                                                        <Text style={[
                                                            styles.wordBankChipText,
                                                            { color: textMain },
                                                            isCorrect && { color: accentColor, fontWeight: "700" },
                                                        ]}>
                                                            {opt}
                                                        </Text>
                                                        {isCorrect && (
                                                            <Ionicons name="checkmark-circle" size={13} color={accentColor} />
                                                        )}
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    </View>
                                )}

                                {/* Standard choices for MC and T/F */}
                                {q.type !== "word_box" && q.options && q.options.length > 0 && (
                                    <View style={styles.choicesWrap}>
                                        {q.options.map((opt, cIdx) => {
                                            const isCorrect = isChoiceAnswer(opt, correctAnswer, cIdx);
                                            return (
                                                <View
                                                    key={`${opt}_${cIdx}`}
                                                    style={[
                                                        styles.choiceItem,
                                                        { backgroundColor: inputBg, borderColor: border },
                                                        isCorrect && { backgroundColor: accentColor + "18", borderColor: accentColor },
                                                    ]}
                                                >
                                                    <Text style={[
                                                        styles.choiceText,
                                                        { color: textMain },
                                                        isCorrect && { color: accentColor, fontWeight: "700" },
                                                    ]}>
                                                        {opt}
                                                    </Text>
                                                    {isCorrect && (
                                                        <Ionicons name="checkmark-circle" size={14} color={accentColor} />
                                                    )}
                                                </View>
                                            );
                                        })}
                                    </View>
                                )}

                                {/* Scannable Answer Boxes Preview */}
                                <View style={styles.answerBoxesPreviewRow}>
                                    <Ionicons name="create-outline" size={16} color={textSub} />
                                    <Text style={[styles.answerBoxLabel, { color: textSub }]}>Student Answer Box{q.answerBoxesRequired > 1 ? "es" : ""}:</Text>
                                    <View style={{ flexDirection: "row", gap: 6 }}>
                                        {Array.from({ length: Math.min(q.answerBoxesRequired, 5) }).map((_, bIdx) => (
                                            <View key={bIdx} style={[styles.answerBoxItem, { backgroundColor: inputBg, borderColor: border }]}>
                                                <Text style={{ fontSize: 9, color: textSub }}>#{bIdx + 1}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>

                                {/* Official Answer Key Pill + Answer Length Flagging */}
                                {(() => {
                                    const isShortAnswerType =
                                        q.type === "identification" ||
                                        q.type === "fill_blank" ||
                                        q.type === "enumeration";
                                    const subItems = q.type === "enumeration"
                                        ? correctAnswer.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
                                        : [correctAnswer.trim()];
                                    const isTooLong =
                                        isShortAnswerType &&
                                        subItems.some(
                                            (item) =>
                                                item.length > 25 ||
                                                item.split(/\s+/).filter(Boolean).length > 3
                                        );
                                    const isEditingThis = editingAnswerQNum === q.questionNumber;

                                    return (
                                        <View style={[styles.answerWrap, { borderLeftColor: isTooLong ? "#D97706" : accentColor, marginTop: 10 }]}>
                                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                                <Text style={styles.answerLabel}>OFFICIAL ANSWER KEY</Text>
                                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                                    {isShortAnswerType && !isEditingThis && (
                                                        <TouchableOpacity
                                                            onPress={() => {
                                                                setEditingAnswerQNum(q.questionNumber);
                                                                setEditingAnswerText(correctAnswer);
                                                            }}
                                                        >
                                                            <Text style={{ fontSize: 11, fontWeight: "700", color: isTooLong ? "#D97706" : accentColor }}>
                                                                Edit Answer
                                                            </Text>
                                                        </TouchableOpacity>
                                                    )}
                                                    <Text style={[styles.pointsBadge, { color: accentColor }]}>
                                                        +{points} pt{points > 1 ? "s" : ""}
                                                    </Text>
                                                </View>
                                            </View>

                                            {isEditingThis ? (
                                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                                                    <TextInput
                                                        style={{
                                                            flex: 1,
                                                            borderWidth: 1,
                                                            borderColor: accentColor,
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
                                                            backgroundColor: accentColor,
                                                            paddingHorizontal: 12,
                                                            paddingVertical: 7,
                                                            borderRadius: 8,
                                                        }}
                                                    >
                                                        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Save</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ) : (
                                                <Text style={[styles.answerText, { color: isTooLong ? "#D97706" : accentColor }]}>
                                                    {correctAnswer}
                                                </Text>
                                            )}

                                            {isTooLong && (
                                                <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706", marginTop: 4 }}>
                                                    ⚠ Exceeds 25 chars / 3 words — shorten so it fits inside the scannable answer box.
                                                </Text>
                                            )}
                                        </View>
                                    );
                                })()}

                                {/* ── Regenerate this question only button ── */}
                                <TouchableOpacity
                                    style={[
                                        styles.regenerateQBtn,
                                        {
                                            borderColor: accentColor + "35",
                                            backgroundColor: accentColor + "0D",
                                        },
                                        regeneratingQNum === q.questionNumber && {
                                            backgroundColor: accentColor + "1A",
                                            borderColor: accentColor,
                                        },
                                    ]}
                                    onPress={() => handleRegenerateQuestion(q.questionNumber)}
                                    disabled={regeneratingQNum !== null}
                                    activeOpacity={0.7}
                                >
                                    {regeneratingQNum === q.questionNumber ? (
                                        <View style={styles.regeneratingRow}>
                                            <ActivityIndicator size="small" color={accentColor} style={{ marginRight: 8 }} />
                                            <Text style={[styles.regenerateQBtnText, { color: accentColor, fontWeight: "700" }]}>
                                                Regenerating Question #{q.questionNumber} with AI...
                                            </Text>
                                        </View>
                                    ) : (
                                        <View style={styles.regeneratingRow}>
                                            <Ionicons name="sparkles" size={15} color={accentColor} style={{ marginRight: 6 }} />
                                            <Text style={[styles.regenerateQBtnText, { color: accentColor }]}>
                                                Regenerate this question only
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            </View>
                        );
                    })}

                    {/* ── Add Question Manually Button ── */}
                    <TouchableOpacity
                        style={[styles.addQuestionBtn, { borderColor: accentColor }]}
                        onPress={openAddQuestionModal}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.addQuestionIconCircle, { backgroundColor: accentColor + "18" }]}>
                            <Ionicons name="add" size={20} color={accentColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.addQuestionTitle, { color: accentColor }]}>Add Question Manually</Text>
                            <Text style={[styles.addQuestionSub, { color: textSub }]}>
                                Add your own question to this assessment
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={accentColor} />
                    </TouchableOpacity>

                    {/* ── Export / Print Test Paper Button ── */}
                    <TouchableOpacity
                        style={[styles.exportPdfBtn, { backgroundColor: accentColor || "#1F2937" }]}
                        onPress={() => setExportModalOpen(true)}
                        disabled={exportingPdf}
                        activeOpacity={0.85}
                    >
                        {exportingPdf ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <>
                                <Ionicons name="print-outline" size={18} color="#FFFFFF" />
                                <Text style={styles.exportPdfBtnText}>Export / Print Paper Sheet (PDF)</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── Action Buttons ── */}
                    <View style={styles.resultActions}>
                        <TouchableOpacity
                            style={[styles.saveDraftBtn, { borderColor: accentColor, opacity: savingDraft ? 0.6 : 1 }]}
                            onPress={handleSaveDraft}
                            disabled={savingDraft}
                        >
                            {savingDraft ? (
                                <ActivityIndicator size="small" color={accentColor} />
                            ) : (
                                <>
                                    <Ionicons name="save-outline" size={16} color={accentColor} />
                                    <Text style={[styles.saveDraftText, { color: accentColor }]}>Save as Draft</Text>
                                </>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.publishBtn, { backgroundColor: accentColor, opacity: publishingQuiz ? 0.7 : 1 }]}
                            onPress={handlePublishQuiz}
                            disabled={publishingQuiz}
                        >
                            <Ionicons name="send-outline" size={16} color="#FFFFFF" />
                            <Text style={styles.publishText}>
                                {publishingQuiz ? "Publishing..." : "Publish Quiz"}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity style={styles.regenerateLink} onPress={handleReset}>
                        <Ionicons name="arrow-back-outline" size={14} color="#6B7280" />
                        <Text style={styles.regenerateLinkText}>Generate a new quiz</Text>
                    </TouchableOpacity>
                </>
            )}

            {/* ── Publishing Quiz Loading Overlay ── */}
            <Modal
                visible={publishingQuiz}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => { }}
            >
                <View style={styles.loadingOverlay}>
                    <View style={[styles.loadingCard, { backgroundColor: cardBg }]}>
                        <View style={[styles.loadingIconGlow, { backgroundColor: accentColor + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: accentColor }]}>
                                <Ionicons name="cloud-upload" size={28} color="#FFFFFF" />
                            </View>
                        </View>
                        <Text style={[styles.loadingTitle, { color: textMain }]}>Publishing Quiz</Text>
                        <Text style={[styles.loadingSub, { color: textSub }]}>
                            {publishingStage || `Saving "${generatedAssessment?.quizTitle || "Assessment"}" to ${classTitle} and your cloud archive...`}
                        </Text>
                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={accentColor} />
                        </View>
                        <View style={[styles.loadingMetaPill, { backgroundColor: inputBg }]}>
                            <Text style={[styles.loadingMetaText, { color: textSub }]} numberOfLines={1}>
                                {classTitle} • {generatedAssessment?.questions.length || questionCount} Items • Archive & Grader
                            </Text>
                        </View>
                        <View style={styles.loadingNoticeRow}>
                            <Ionicons name="scan-outline" size={14} color={accentColor} />
                            <Text style={[styles.loadingNoticeText, { color: textSub }]}>
                                Preparing scannable layout for Camera Grader...
                            </Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Full-Screen Generating Loading Overlay ── */}
            <Modal
                visible={generating}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => { }}
            >
                <View style={styles.loadingOverlay}>
                    <View style={styles.loadingCard}>
                        {/* Glowing Icon Badge */}
                        <View style={[styles.loadingIconGlow, { backgroundColor: isAiBusy ? "#F59E0B22" : accentColor + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: isAiBusy ? "#F59E0B" : accentColor }]}>
                                <Ionicons name={isAiBusy ? "hourglass-outline" : "sparkles"} size={28} color="#FFFFFF" />
                            </View>
                        </View>

                        {isAiBusy && (
                            <View style={[styles.aiBusyBadge, { backgroundColor: "#FEF3C7", borderColor: "#F59E0B" }]}>
                                <Ionicons name="cloud-offline-outline" size={13} color="#D97706" />
                                <Text style={styles.aiBusyBadgeText}>AI is busy right now</Text>
                            </View>
                        )}

                        <Text style={styles.loadingTitle}>
                            {isAiBusy ? "AI is Busy — Auto-Retrying" : "Generating Assessment"}
                        </Text>

                        <Text style={[styles.loadingSub, isAiBusy && { color: "#D97706", fontWeight: "600" }]}>
                            {generatingStatus || (attachedFile
                                ? `Tseki AI is analyzing "${attachedFile.name}" and extracting questions...`
                                : `Tseki AI is crafting DepEd-aligned questions for ${subject}...`)}
                        </Text>

                        {/* Spinner */}
                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={isAiBusy ? "#F59E0B" : accentColor} />
                        </View>

                        {/* Parameter summary pill */}
                        <View style={styles.loadingMetaPill}>
                            <Text style={styles.loadingMetaText} numberOfLines={1}>
                                {questionCount} • {difficulty} • {questionType}
                            </Text>
                        </View>

                        {/* Do not close notice */}
                        <View style={[styles.loadingNoticeRow, isAiBusy && { backgroundColor: "#FFFBEB" }]}>
                            <Ionicons name={isAiBusy ? "sync-outline" : "hourglass-outline"} size={14} color={isAiBusy ? "#D97706" : "#6B7280"} />
                            <Text style={[styles.loadingNoticeText, isAiBusy && { color: "#92400E" }]}>
                                {isAiBusy
                                    ? "Retrying with backoff before switching to backup AI..."
                                    : "Please wait and keep this screen open."}
                            </Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── PDF Exporting Progress Overlay (shown only during uncached builds) ── */}
            <Modal
                visible={exportingPdf}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => { }}
            >
                <View style={styles.loadingOverlay}>
                    <View style={styles.loadingCard}>
                        <View style={[styles.loadingIconGlow, { backgroundColor: accentColor + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: accentColor }]}>
                                <Ionicons name="print" size={28} color="#FFFFFF" />
                            </View>
                        </View>
                        <Text style={styles.loadingTitle}>Preparing Scannable PDF</Text>
                        <Text style={styles.loadingSub}>
                            Formatting Set {exportVersion} test sheet and embedding scannable answer boxes...
                        </Text>
                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={accentColor} />
                        </View>
                        <View style={styles.loadingNoticeRow}>
                            <Ionicons name="document-text-outline" size={14} color="#6B7280" />
                            <Text style={styles.loadingNoticeText}>
                                Optimizing layout for one-shot camera scanning.
                            </Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Export Paper Sheet Modal ── */}
            <Modal
                visible={exportModalOpen}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    if (!exportingPdf) setExportModalOpen(false);
                }}
            >
                <TouchableOpacity
                    style={styles.exportBackdrop}
                    activeOpacity={1}
                    onPress={() => {
                        if (!exportingPdf) setExportModalOpen(false);
                    }}
                >
                    <Pressable
                        style={[styles.exportSheet, { backgroundColor: cardBg }]}
                        onPress={(e) => {
                            e.stopPropagation?.();
                        }}
                    >
                        {exportingPdf ? (
                            <View style={styles.sheetLoadingWrap}>
                                <View style={[styles.loadingIconGlow, { backgroundColor: (accentColor || "#2563EB") + "20" }]}>
                                    <View style={[styles.loadingIconCircle, { backgroundColor: accentColor || "#2563EB" }]}>
                                        <Ionicons name="print" size={28} color="#FFFFFF" />
                                    </View>
                                </View>

                                <Text style={[styles.loadingTitle, { color: textMain }]}>
                                    Generating Set {exportVersion} PDF
                                </Text>

                                <Text style={[styles.loadingSub, { color: textSub }]}>
                                    {exportingStage || `Formatting Set ${exportVersion} scannable test sheet...`}
                                </Text>

                                <View style={styles.spinnerWrap}>
                                    <ActivityIndicator size="large" color={accentColor || "#2563EB"} />
                                </View>

                                <View style={[styles.loadingNoticeRow, { backgroundColor: inputBg, marginTop: 14 }]}>
                                    <Ionicons name="shield-checkmark" size={16} color={accentColor || "#2563EB"} />
                                    <Text style={[styles.loadingNoticeText, { color: textSub }]}>
                                        Anti-cheating exam version • Optimizing for camera grading
                                    </Text>
                                </View>

                                <Text style={{ fontSize: 11.5, color: textSub, marginTop: 14, textAlign: "center" }}>
                                    Please wait a moment while TSEKI prepares your document...
                                </Text>
                            </View>
                        ) : (
                            <>
                                <View style={styles.exportSheetHeader}>
                                    <Text style={[styles.exportSheetTitle, { color: textMain }]}>Export Paper Sheet Layout</Text>
                                    <Text style={[styles.exportSheetSub, { color: textSub }]}>
                                        Download, print, or share the physical test sheet formatted with scannable answer boxes.
                                    </Text>
                                </View>

                                {/* Anti-Cheating Version Selector (Set A / B / C) */}
                                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                    <Text style={{ fontSize: 12, fontWeight: "700", color: textMain }}>TEST VERSION (SET):</Text>
                                    <View style={{ flexDirection: "row", gap: 6 }}>
                                        {(["A", "B", "C"] as const).map((ver) => (
                                            <TouchableOpacity
                                                key={ver}
                                                onPress={() => setExportVersion(ver)}
                                                activeOpacity={0.7}
                                                style={{
                                                    paddingHorizontal: 14,
                                                    paddingVertical: 6,
                                                    borderRadius: 8,
                                                    borderWidth: 1,
                                                    borderColor: exportVersion === ver ? accentColor : border,
                                                    backgroundColor: exportVersion === ver ? accentColor + "18" : inputBg,
                                                }}
                                            >
                                                <Text
                                                    style={{
                                                        fontSize: 12.5,
                                                        fontWeight: "700",
                                                        color: exportVersion === ver ? accentColor : textMain,
                                                    }}
                                                >
                                                    Set {ver}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>

                                {/* Force Separate Answer Sheet Toggle */}
                                <TouchableOpacity
                                    onPress={() => setForceSeparateMode((prev) => !prev)}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        paddingVertical: 8,
                                        paddingHorizontal: 12,
                                        borderRadius: 10,
                                        backgroundColor: inputBg,
                                        borderWidth: 1,
                                        borderColor: border,
                                        marginBottom: 12,
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Text style={{ fontSize: 12.5, fontWeight: "600", color: textMain, flex: 1 }}>
                                        Always use separate Question Booklet + Answer Sheet
                                    </Text>
                                    <Ionicons
                                        name={forceSeparateMode ? "checkbox" : "square-outline"}
                                        size={20}
                                        color={forceSeparateMode ? accentColor : textSub}
                                    />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportOptionBtn}
                                    onPress={() => handleExportPaper(false, "short")}
                                    disabled={exportingPdf}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.exportOptionIcon, { backgroundColor: (accentColor || "#2563EB") + "18" }]}>
                                        <Ionicons name="document-text" size={22} color={accentColor || "#2563EB"} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.exportOptionTitle}>{'Short Bond Paper (8.5" × 11")'}</Text>
                                        <Text style={styles.exportOptionSub}>
                                            {`1 single sheet (Letter size) • Set ${exportVersion} scannable layout for 1-shot camera scanning`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={20} color="#6B7280" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportOptionBtn}
                                    onPress={() => handleExportPaper(false, "long")}
                                    disabled={exportingPdf}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.exportOptionIcon, { backgroundColor: "#8B5CF618" }]}>
                                        <Ionicons name="document-outline" size={22} color="#8B5CF6" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.exportOptionTitle}>{'Long Bond Paper (8.5" × 13")'}</Text>
                                        <Text style={styles.exportOptionSub}>
                                            {`1 single sheet (Philippine Folio) • Fits all questions with Set ${exportVersion} spacing`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={20} color="#6B7280" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportOptionBtn}
                                    onPress={() => handleExportPaper(true, "short")}
                                    disabled={exportingPdf}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.exportOptionIcon, { backgroundColor: "#10B98118" }]}>
                                        <Ionicons name="checkmark-done-circle" size={22} color="#10B981" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.exportOptionTitle}>Teacher Answer Key Paper (PDF)</Text>
                                        <Text style={styles.exportOptionSub}>
                                            {`1 single sheet with correct answers pre-printed in boxes for Set ${exportVersion}`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={20} color="#6B7280" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportCancelBtn}
                                    onPress={() => setExportModalOpen(false)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.exportCancelText}>Cancel</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </Pressable>
                </TouchableOpacity>
            </Modal>

            {/* ── Add Question Manually Modal ── */}
            <Modal
                visible={addQuestionModalOpen}
                transparent
                animationType="slide"
                onRequestClose={() => setAddQuestionModalOpen(false)}
            >
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <TouchableOpacity
                        style={styles.addQOverlay}
                        activeOpacity={1}
                        onPress={() => { Keyboard.dismiss(); }}
                    >
                        <View style={[styles.addQSheet, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF" }]}>
                            <ScrollView
                                ref={addQScrollRef}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                contentContainerStyle={{ paddingBottom: 20 }}
                            >
                                {/* Header */}
                                <View style={styles.addQHeader}>
                                    <View style={[styles.addQIconBg, { backgroundColor: accentColor + "18" }]}>
                                        <Ionicons name="create" size={22} color={accentColor} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.addQTitle, { color: textMain }]}>Add Question Manually</Text>
                                        <Text style={[styles.addQSubTitle, { color: textSub }]}>Create a custom question for this assessment</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => setAddQuestionModalOpen(false)}>
                                        <Ionicons name="close" size={24} color={textSub} />
                                    </TouchableOpacity>
                                </View>

                                {/* Question Type Selector */}
                                <Text style={[styles.addQLabel, { color: textSub }]}>QUESTION TYPE</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                                    <View style={styles.addQTypeRow}>
                                        {([
                                            { key: "multiple_choice" as QuestionType, label: "Multiple Choice", icon: "list" as const },
                                            { key: "true_false" as QuestionType, label: "True / False", icon: "checkmark-done" as const },
                                            { key: "identification" as QuestionType, label: "Identification", icon: "text" as const },
                                            { key: "fill_blank" as QuestionType, label: "Fill in Blank", icon: "pencil" as const },
                                            { key: "enumeration" as QuestionType, label: "Enumeration", icon: "reorder-three" as const },
                                            { key: "word_box" as QuestionType, label: "Word Box", icon: "grid" as const },
                                        ]).map((t) => (
                                            <TouchableOpacity
                                                key={t.key}
                                                style={[
                                                    styles.addQTypeChip,
                                                    { backgroundColor: inputBg, borderColor: border },
                                                    manualQType === t.key && { backgroundColor: accentColor, borderColor: accentColor },
                                                ]}
                                                onPress={() => handleManualQTypeChange(t.key)}
                                            >
                                                <Ionicons
                                                    name={t.icon}
                                                    size={14}
                                                    color={manualQType === t.key ? "#FFFFFF" : textSub}
                                                />
                                                <Text style={[
                                                    styles.addQTypeChipText,
                                                    { color: textSub },
                                                    manualQType === t.key && { color: "#FFFFFF" },
                                                ]}>
                                                    {t.label}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </ScrollView>

                                {/* Question Text */}
                                <Text style={[styles.addQLabel, { color: textSub }]}>QUESTION TEXT <Text style={styles.required}>*</Text></Text>
                                <TextInput
                                    style={[styles.addQTextInput, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                                    placeholder={manualQType === "enumeration"
                                        ? "e.g. Name 3 greenhouse gases:"
                                        : manualQType === "word_box"
                                            ? "e.g. The national hero of the Philippines is ______."
                                            : "Enter your question here..."}
                                    placeholderTextColor={textSub}
                                    value={manualQText}
                                    onChangeText={setManualQText}
                                    multiline
                                    textAlignVertical="top"
                                />

                                {/* Choices (for MC, T/F, and Word Box) */}
                                {(manualQType === "multiple_choice" || manualQType === "true_false") && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: textSub }]}>CHOICES</Text>
                                        {manualChoices.map((choice, idx) => (
                                            <View key={idx} style={styles.addQChoiceRow}>
                                                <View style={[styles.addQChoiceLetter, { backgroundColor: accentColor + "18" }]}>
                                                    <Text style={[styles.addQChoiceLetterText, { color: accentColor }]}>
                                                        {String.fromCharCode(65 + idx)}
                                                    </Text>
                                                </View>
                                                <TextInput
                                                    style={[
                                                        styles.addQChoiceInput,
                                                        { backgroundColor: inputBg, borderColor: border, color: textMain },
                                                    ]}
                                                    placeholder={`Choice ${String.fromCharCode(65 + idx)}...`}
                                                    placeholderTextColor={textSub}
                                                    value={choice}
                                                    onChangeText={(v) => updateChoice(idx, v)}
                                                    editable={manualQType !== "true_false"}
                                                />
                                                {manualQType === "multiple_choice" && manualChoices.length > 2 && (
                                                    <TouchableOpacity onPress={() => removeChoice(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        ))}
                                        {manualQType === "multiple_choice" && manualChoices.length < 6 && (
                                            <TouchableOpacity
                                                style={[styles.addQAddChoiceBtn, { borderColor: border }]}
                                                onPress={addChoice}
                                            >
                                                <Ionicons name="add-circle-outline" size={16} color={accentColor} />
                                                <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>Add Choice</Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}

                                {/* Word Box / Word Bank choices */}
                                {manualQType === "word_box" && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: textSub }]}>WORD BANK CHOICES</Text>
                                        <Text style={[styles.wordBankHint, { color: textSub }]}>
                                            Add words to the word bank. Include the correct answer and distractors (no letter prefixes).
                                        </Text>
                                        {manualChoices.map((choice, idx) => (
                                            <View key={idx} style={styles.addQChoiceRow}>
                                                <View style={[styles.wordBankPill, { backgroundColor: accentColor + "14", borderColor: accentColor + "44" }]}>
                                                    <Ionicons name="cube-outline" size={12} color={accentColor} />
                                                </View>
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
                                                    <TouchableOpacity onPress={() => removeChoice(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        ))}
                                        {manualChoices.length < 8 && (
                                            <TouchableOpacity
                                                style={[styles.addQAddChoiceBtn, { borderColor: border }]}
                                                onPress={addChoice}
                                            >
                                                <Ionicons name="add-circle-outline" size={16} color={accentColor} />
                                                <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>Add Word</Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}

                                {/* Enumeration: how many items */}
                                {manualQType === "enumeration" && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: textSub }]}>NUMBER OF ITEMS TO ENUMERATE</Text>
                                        <View style={styles.addQEnumRow}>
                                            {["2", "3", "4", "5", "6"].map((n) => (
                                                <TouchableOpacity
                                                    key={n}
                                                    style={[
                                                        styles.addQEnumBtn,
                                                        { backgroundColor: inputBg, borderColor: border },
                                                        manualEnumCount === n && { backgroundColor: accentColor, borderColor: accentColor },
                                                    ]}
                                                    onPress={() => setManualEnumCount(n)}
                                                >
                                                    <Text style={[
                                                        styles.addQEnumBtnText,
                                                        { color: textSub },
                                                        manualEnumCount === n && { color: "#FFFFFF" },
                                                    ]}>{n}</Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </>
                                )}

                                {/* Correct Answer */}
                                <Text style={[styles.addQLabel, { color: textSub }]}>
                                    CORRECT ANSWER <Text style={styles.required}>*</Text>
                                </Text>
                                {manualQType === "true_false" ? (
                                    <View style={styles.addQTFRow}>
                                        {[{ label: "True", val: "T" }, { label: "False", val: "F" }].map((tf) => (
                                            <TouchableOpacity
                                                key={tf.val}
                                                style={[
                                                    styles.addQTFBtn,
                                                    { backgroundColor: inputBg, borderColor: border },
                                                    manualCorrectAnswer === tf.val && { backgroundColor: accentColor, borderColor: accentColor },
                                                ]}
                                                onPress={() => setManualCorrectAnswer(tf.val)}
                                            >
                                                <Text style={[
                                                    styles.addQTFBtnText,
                                                    { color: textSub },
                                                    manualCorrectAnswer === tf.val && { color: "#FFFFFF" },
                                                ]}>{tf.label}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : manualQType === "multiple_choice" ? (
                                    <View style={styles.addQMCAnswerRow}>
                                        {manualChoices.map((_, idx) => {
                                            const letter = String.fromCharCode(65 + idx);
                                            return (
                                                <TouchableOpacity
                                                    key={letter}
                                                    style={[
                                                        styles.addQMCAnswerBtn,
                                                        { backgroundColor: inputBg, borderColor: border },
                                                        manualCorrectAnswer === letter && { backgroundColor: accentColor, borderColor: accentColor },
                                                    ]}
                                                    onPress={() => setManualCorrectAnswer(letter)}
                                                >
                                                    <Text style={[
                                                        styles.addQMCAnswerBtnText,
                                                        { color: textSub },
                                                        manualCorrectAnswer === letter && { color: "#FFFFFF" },
                                                    ]}>{letter}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                ) : manualQType === "word_box" ? (
                                    <>
                                        <Text style={[styles.wordBankHint, { color: textSub, marginBottom: 8 }]}>
                                            Tap the correct word from your word bank:
                                        </Text>
                                        <View style={styles.wordBankAnswerGrid}>
                                            {manualChoices.filter((c) => c.trim().length > 0).map((word, idx) => {
                                                const trimmedWord = word.trim();
                                                const isSelected = manualCorrectAnswer === trimmedWord;
                                                return (
                                                    <TouchableOpacity
                                                        key={`wb_${idx}`}
                                                        style={[
                                                            styles.wordBankAnswerChip,
                                                            { backgroundColor: inputBg, borderColor: border },
                                                            isSelected && { backgroundColor: accentColor, borderColor: accentColor },
                                                        ]}
                                                        onPress={() => setManualCorrectAnswer(trimmedWord)}
                                                    >
                                                        <Ionicons
                                                            name={isSelected ? "checkmark-circle" : "cube-outline"}
                                                            size={14}
                                                            color={isSelected ? "#FFFFFF" : textSub}
                                                        />
                                                        <Text style={[
                                                            styles.wordBankAnswerChipText,
                                                            { color: textSub },
                                                            isSelected && { color: "#FFFFFF", fontWeight: "700" },
                                                        ]}>{trimmedWord}</Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    </>
                                ) : (
                                    <TextInput
                                        style={[styles.addQAnswerInput, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                                        placeholder={manualQType === "enumeration"
                                            ? "e.g. Carbon dioxide, Methane, Water vapor"
                                            : "Enter the correct answer..."}
                                        placeholderTextColor={textSub}
                                        value={manualCorrectAnswer}
                                        onChangeText={setManualCorrectAnswer}
                                    />
                                )}

                                {/* Points */}
                                <Text style={[styles.addQLabel, { color: textSub }]}>POINTS</Text>
                                <View style={styles.addQPointsRow}>
                                    {["1", "2", "3", "5"].map((p) => (
                                        <TouchableOpacity
                                            key={p}
                                            style={[
                                                styles.addQPointBtn,
                                                { backgroundColor: inputBg, borderColor: border },
                                                manualPoints === p && { backgroundColor: accentColor, borderColor: accentColor },
                                            ]}
                                            onPress={() => setManualPoints(p)}
                                        >
                                            <Text style={[
                                                styles.addQPointBtnText,
                                                { color: textSub },
                                                manualPoints === p && { color: "#FFFFFF" },
                                            ]}>{p} pt{parseInt(p) > 1 ? "s" : ""}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>

                                {/* Submit Button */}
                                <TouchableOpacity
                                    style={[styles.addQSubmitBtn, { backgroundColor: accentColor }]}
                                    onPress={handleAddManualQuestion}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="add-circle" size={18} color="#FFFFFF" />
                                    <Text style={styles.addQSubmitText}>Add to Assessment</Text>
                                </TouchableOpacity>

                                {/* Cancel */}
                                <TouchableOpacity
                                    style={styles.addQCancelBtn}
                                    onPress={() => setAddQuestionModalOpen(false)}
                                >
                                    <Text style={[styles.addQCancelText, { color: textSub }]}>Cancel</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>
        </ScrollView>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },

    /* Header */
    headerRow: {
        flexDirection: "row", alignItems: "center", gap: 12,
        marginBottom: 24,
    },
    headerIconBg: {
        width: 44, height: 44, borderRadius: 12,
        alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 17, fontWeight: "800", color: "#1F2937" },
    headerSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },

    /* Fields */
    fieldLabel: {
        fontSize: 11, fontWeight: "700", color: "#6B7280",
        letterSpacing: 0.6, marginBottom: 8, marginTop: 18,
    },
    required: { color: "#EF4444" },
    optional: { color: "#9CA3AF", fontWeight: "400" },

    input: {
        height: 52, borderWidth: 1.5, borderColor: "#D1D5DB",
        borderRadius: 12, paddingHorizontal: 14, fontSize: 15,
        color: "#1F2937", backgroundColor: "#F9FAFB",
    },
    textAreaInput: {
        minHeight: 100,
        maxHeight: 160,
        borderWidth: 1.5,
        borderColor: "#D1D5DB",
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 12,
        fontSize: 14,
        lineHeight: 20,
        color: "#1F2937",
        backgroundColor: "#F9FAFB",
    },

    /* Attach File */
    attachBtn: {
        height: 52, borderWidth: 1.5, borderColor: "#D1D5DB", borderStyle: "dashed",
        borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
        backgroundColor: "#F9FAFB", gap: 10,
    },
    attachBtnText: { fontSize: 13, color: "#6B7280", flex: 1 },
    attachBtnTextActive: { fontSize: 13, color: "#1F2937", fontWeight: "600", flex: 1 },
    attachRemoveBtn: { padding: 4 },
    docBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        gap: 4,
    },
    docBadgeText: {
        fontSize: 11,
        fontWeight: "700",
    },
    formatPill: {
        backgroundColor: "#E5E7EB",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    formatPillText: {
        fontSize: 11,
        color: "#6B7280",
        fontWeight: "600",
    },

    autoSubjectBtn: {
        height: 52, borderWidth: 1.5, borderColor: "#E5E7EB",
        borderRadius: 12, paddingHorizontal: 14,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        backgroundColor: "#F3F4F6",
    },
    autoSubjectText: {
        fontSize: 14, color: "#4B5563", fontWeight: "600", flex: 1, marginRight: 6,
    },

    /* Dropdown */
    dropdownBtn: {
        height: 52, borderWidth: 1.5, borderColor: "#D1D5DB",
        borderRadius: 12, paddingHorizontal: 14,
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        backgroundColor: "#F9FAFB",
    },
    dropdownValue: { fontSize: 14, color: "#1F2937", fontWeight: "500", flex: 1 },

    /* Dropdown modal */
    ddOverlay: {
        flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center", alignItems: "center", paddingHorizontal: 24,
    },
    ddSheet: {
        width: "100%", backgroundColor: "#FFFFFF",
        borderRadius: 20, padding: 20,
        shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
    },
    ddTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, marginBottom: 12 },
    ddItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10, marginBottom: 2 },
    ddItemText: { fontSize: 15, color: "#374151" },

    /* Two-column layout */
    twoCol: { flexDirection: "row", gap: 12 },
    colHalf: { flex: 1 },

    /* Mixed Assessment Picker */
    mixedPickerContainer: {
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 16,
        marginTop: 4,
        marginBottom: 12,
    },
    mixedPickerHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
    },
    mixedPickerTitle: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    mixedCountBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    mixedCountText: {
        fontSize: 11,
        fontWeight: "700",
    },
    mixedPickerHint: {
        fontSize: 12,
        lineHeight: 16,
        marginBottom: 12,
    },
    mixedPickerGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    mixedChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 10,
        borderWidth: 1.5,
    },
    mixedRomanBadge: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
        marginRight: 6,
    },
    mixedRomanBadgeText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "800",
    },
    mixedChipText: {
        fontSize: 13,
        fontWeight: "500",
    },

    /* Difficulty */
    difficultyRow: { flexDirection: "row", gap: 10 },
    diffBtn: {
        flex: 1, height: 44, borderRadius: 12,
        borderWidth: 1.5, borderColor: "#D1D5DB",
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#FFFFFF",
    },
    diffBtnText: { fontSize: 14, fontWeight: "600", color: "#6B7280" },

    /* Generate button */
    generateBtn: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        height: 56, borderRadius: 16, marginTop: 28,
        shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
    },
    generateBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

    /* Info note */
    infoNote: {
        flexDirection: "row", alignItems: "center", gap: 6,
        marginTop: 14, paddingHorizontal: 4,
    },
    infoText: { fontSize: 11, color: "#9CA3AF", flex: 1 },

    /* Preview Screen Banner */
    previewScreenBanner: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 5,
        elevation: 2,
    },
    previewTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    previewModeBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
        borderWidth: 1,
    },
    previewModeBadgeText: {
        fontSize: 10.5,
        fontWeight: "800",
        letterSpacing: 0.5,
    },
    previewResetBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
    },
    previewResetBtnText: {
        fontSize: 11.5,
        fontWeight: "600",
    },
    previewTitle: {
        fontSize: 16.5,
        fontWeight: "800",
        marginBottom: 5,
        letterSpacing: -0.2,
    },
    previewSubtext: {
        fontSize: 12,
        lineHeight: 17,
        marginBottom: 12,
    },
    previewStatsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    previewStatItem: {
        alignItems: "center",
        flex: 1,
    },
    previewStatValue: {
        fontSize: 14.5,
        fontWeight: "800",
        marginBottom: 2,
    },
    previewStatLabel: {
        fontSize: 10,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    previewStatDivider: {
        width: 1,
        height: 20,
    },

    /* Regenerate single question */
    regenerateQBtn: {
        marginTop: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1.2,
        alignItems: "center",
        justifyContent: "center",
    },
    regeneratingRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    regenerateQBtnText: {
        fontSize: 12.5,
        fontWeight: "700",
    },
    questionEditInput: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        fontSize: 13.5,
        lineHeight: 19,
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
    actionIconBtn: {
        padding: 5,
    },

    /* Results */
    resultsBanner: {
        flexDirection: "row", alignItems: "center",
        borderRadius: 14, padding: 14, marginBottom: 20,
        borderWidth: 1,
    },
    resultsBannerTitle: { fontSize: 15, fontWeight: "700" },
    resultsBannerSub: { fontSize: 11, color: "#6B7280", marginTop: 2 },

    questionCard: {
        backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16,
        marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB",
        shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    },
    questionHeader: { flexDirection: "row", gap: 12, marginBottom: 12 },
    questionNumber: {
        width: 28, height: 28, borderRadius: 8,
        alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    questionNumberText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
    questionText: { flex: 1, fontSize: 14, color: "#1F2937", lineHeight: 20, fontWeight: "500" },

    choicesWrap: { gap: 6 },
    choiceItem: {
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingVertical: 9, paddingHorizontal: 12,
        borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB",
        backgroundColor: "#F9FAFB",
    },
    choiceText: { fontSize: 13, color: "#374151", flex: 1 },

    answerWrap: {
        borderLeftWidth: 3, paddingLeft: 12, marginTop: 4,
    },
    answerLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", marginBottom: 2 },
    answerText: { fontSize: 14, fontWeight: "600" },

    /* Result actions */
    resultActions: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 4 },
    saveDraftBtn: {
        flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    },
    saveDraftText: { fontSize: 14, fontWeight: "600" },
    publishBtn: {
        flex: 1, height: 48, borderRadius: 12,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18, shadowRadius: 6, elevation: 4,
    },
    publishText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },

    regenerateLink: {
        flexDirection: "row", alignItems: "center", justifyContent: "center",
        gap: 6, marginTop: 16,
    },
    regenerateLinkText: { fontSize: 13, color: "#6B7280" },

    /* Scannable Question Elements */
    qTypeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: "#F3F4F6",
    },
    qTypeBadgeText: {
        fontSize: 10,
        fontWeight: "700",
        color: "#6B7280",
    },
    boxesBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: "#EEF2FF",
    },
    boxesBadgeText: {
        fontSize: 10,
        fontWeight: "700",
        color: "#4F46E5",
    },
    answerBoxesPreviewRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        padding: 8,
        backgroundColor: "#F9FAFB",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        borderStyle: "dashed",
    },
    answerBoxItem: {
        width: 32,
        height: 32,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: "#9CA3AF",
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
    },
    answerBoxLabel: {
        fontSize: 11,
        color: "#6B7280",
        fontWeight: "500",
    },
    pointsBadge: {
        fontSize: 11,
        fontWeight: "700",
    },

    /* Export PDF Styles */
    exportPdfBtn: {
        height: 52,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginTop: 14,
        marginBottom: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
    },
    exportPdfBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "700",
    },
    exportBackdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-end",
    },
    exportSheet: {
        backgroundColor: "#FFFFFF",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 36,
        gap: 12,
    },
    exportSheetHeader: {
        marginBottom: 8,
    },
    exportSheetTitle: {
        fontSize: 18,
        fontWeight: "800",
        color: "#1F2937",
        marginBottom: 4,
    },
    exportSheetSub: {
        fontSize: 13,
        color: "#6B7280",
        lineHeight: 18,
    },
    exportOptionBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: "#F9FAFB",
        borderWidth: 1,
        borderColor: "#E5E7EB",
        gap: 14,
    },
    exportOptionIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    exportOptionTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: "#1F2937",
        marginBottom: 2,
    },
    exportOptionSub: {
        fontSize: 12,
        color: "#6B7280",
        lineHeight: 16,
    },
    exportCancelBtn: {
        height: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 4,
    },
    exportCancelText: {
        fontSize: 15,
        fontWeight: "600",
        color: "#6B7280",
    },
    sheetLoadingWrap: {
        alignItems: "center",
        paddingVertical: 18,
        paddingHorizontal: 8,
    },

    /* Full-screen Loading Overlay */
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(17, 24, 39, 0.85)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 28,
        zIndex: 9999,
    },
    loadingCard: {
        width: "100%",
        maxWidth: 360,
        backgroundColor: "#FFFFFF",
        borderRadius: 24,
        paddingHorizontal: 24,
        paddingVertical: 32,
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
        elevation: 16,
    },
    loadingIconGlow: {
        width: 76,
        height: 76,
        borderRadius: 38,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 18,
    },
    loadingIconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    aiBusyBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 20,
        borderWidth: 1,
        marginBottom: 10,
    },
    aiBusyBadgeText: {
        fontSize: 12,
        fontWeight: "700",
        color: "#B45309",
    },
    loadingTitle: {
        fontSize: 19,
        fontWeight: "800",
        color: "#1F2937",
        textAlign: "center",
        marginBottom: 8,
    },
    loadingSub: {
        fontSize: 13,
        color: "#6B7280",
        textAlign: "center",
        lineHeight: 19,
        marginBottom: 16,
        paddingHorizontal: 8,
    },
    spinnerWrap: {
        marginVertical: 10,
        transform: [{ scale: 1.15 }],
    },
    loadingMetaPill: {
        backgroundColor: "#F3F4F6",
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginTop: 12,
        marginBottom: 14,
    },
    loadingMetaText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#4B5563",
    },
    loadingNoticeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    loadingNoticeText: {
        fontSize: 12,
        color: "#9CA3AF",
        fontWeight: "500",
    },

    /* ── Delete Question Button ── */
    deleteQBtn: {
        padding: 6,
        marginLeft: 4,
    },

    /* ── Add Question Button ── */
    addQuestionBtn: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 2,
        borderStyle: "dashed",
        borderRadius: 14,
        padding: 16,
        gap: 12,
        marginBottom: 12,
    },
    addQuestionIconCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    addQuestionTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    addQuestionSub: {
        fontSize: 11,
        marginTop: 2,
    },

    /* ── Add Question Modal ── */
    addQOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-end",
    },
    addQSheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 20,
        maxHeight: "90%",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 12,
    },
    addQHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
    },
    addQIconBg: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
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
        marginTop: 16,
    },
    addQTypeRow: {
        flexDirection: "row",
        gap: 8,
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
    addQChoiceLetter: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    addQChoiceLetterText: {
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
    addQEnumRow: {
        flexDirection: "row",
        gap: 8,
    },
    addQEnumBtn: {
        flex: 1,
        height: 40,
        borderRadius: 10,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
    },
    addQEnumBtnText: {
        fontSize: 15,
        fontWeight: "700",
    },
    addQTFRow: {
        flexDirection: "row",
        gap: 12,
    },
    addQTFBtn: {
        flex: 1,
        height: 48,
        borderRadius: 12,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
    },
    addQTFBtnText: {
        fontSize: 15,
        fontWeight: "700",
    },
    addQMCAnswerRow: {
        flexDirection: "row",
        gap: 10,
    },
    addQMCAnswerBtn: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
    },
    addQMCAnswerBtnText: {
        fontSize: 16,
        fontWeight: "700",
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
    addQSubmitBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 52,
        borderRadius: 14,
        marginTop: 24,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
    },
    addQSubmitText: {
        fontSize: 15,
        fontWeight: "700",
        color: "#FFFFFF",
    },
    addQCancelBtn: {
        alignItems: "center",
        justifyContent: "center",
        height: 44,
        marginTop: 8,
    },
    addQCancelText: {
        fontSize: 14,
        fontWeight: "600",
    },

    /* ── Word Box / Word Bank Styles ── */
    wordBankContainer: {
        borderWidth: 1.5,
        borderRadius: 12,
        padding: 12,
        borderStyle: "dashed",
    },
    wordBankHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
    },
    wordBankTitle: {
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.8,
    },
    wordBankChipsWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    wordBankChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1.5,
    },
    wordBankChipText: {
        fontSize: 13,
        fontWeight: "600",
    },
    wordBankPill: {
        width: 32,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    wordBankHint: {
        fontSize: 11,
        lineHeight: 16,
        marginBottom: 4,
    },
    wordBankAnswerGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    wordBankAnswerChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1.5,
    },
    wordBankAnswerChipText: {
        fontSize: 13,
        fontWeight: "600",
    },
});
