import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
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
import { useTheme } from "../context/ThemeContext";
import { AssessmentGeneratingAnimation } from "./AssessmentGeneratingAnimation";
import { PublishingQuizAnimation } from "./PublishingQuizAnimation";
import { PdfExportingAnimation } from "./PdfExportingAnimation";
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
    generateAdditionalQuestions,
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
    resetTeacherQuotaForTesting,
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
            <Text style={[styles.fieldLabel, { color: darkMode ? "#D1D5DB" : "#334155" }]}>{label}</Text>
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
    const insets = useSafeAreaInsets();
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
        if (mixedTypes.length === 0 || showResults) return;
        const base = Math.floor(totalCountNumeric / mixedTypes.length);
        const rem = totalCountNumeric % mixedTypes.length;
        const nextCounts: Record<string, number> = {};
        mixedTypes.forEach((key, idx) => {
            nextCounts[key] = base + (idx === 0 ? rem : 0);
        });
        setMixedPartCounts(nextCounts);
    }, [totalCountNumeric, mixedTypes.length, showResults]);

    function adjustMixedPartCount(partKey: string, delta: number, isPreviewModal: boolean = false) {
        const currentVal = mixedPartCounts[partKey] ?? 1;
        const nextVal = currentVal + delta;
        if (nextVal < 1) return;

        const nextCounts = {
            ...mixedPartCounts,
            [partKey]: nextVal,
        };
        setMixedPartCounts(nextCounts);

        const newTotal = mixedTypes.reduce((sum, key) => sum + (nextCounts[key] ?? 1), 0);
        if (isPreviewModal) {
            setAdjustTargetCount(newTotal);
        } else {
            setQuestionCount(`${newTotal} Questions`);
        }
    }

    function toggleMixedPart(partKey: string, isPreviewModal: boolean = false) {
        if (mixedTypes.includes(partKey)) {
            if (mixedTypes.length <= 2) {
                Alert.alert("Minimum Required", "Please keep at least 2 test types for a mixed assessment.");
                return;
            }
            const nextTypes = mixedTypes.filter((k) => k !== partKey);
            setMixedTypes(nextTypes);
            const newTotal = nextTypes.reduce((sum, k) => sum + (mixedPartCounts[k] ?? 1), 0);
            if (isPreviewModal) {
                setAdjustTargetCount(newTotal);
            } else {
                setQuestionCount(`${newTotal} Questions`);
            }
        } else {
            const nextTypes = [...mixedTypes, partKey];
            setMixedTypes(nextTypes);
            const defaultCount = mixedPartCounts[partKey] ?? 3;
            const nextCounts = {
                ...mixedPartCounts,
                [partKey]: defaultCount,
            };
            setMixedPartCounts(nextCounts);
            const newTotal = nextTypes.reduce((sum, k) => sum + (nextCounts[k] ?? 1), 0);
            if (isPreviewModal) {
                setAdjustTargetCount(newTotal);
            } else {
                setQuestionCount(`${newTotal} Questions`);
            }
        }
    }

    // ── Manual Add Question state ─────────────────────────────────────────────
    const [addQuestionModalOpen, setAddQuestionModalOpen] = useState(false);
    const [manualQType, setManualQType] = useState<QuestionType>("multiple_choice");
    const [manualQText, setManualQText] = useState("");
    const [manualChoices, setManualChoices] = useState<string[]>(["", "", "", ""]);
    const [manualCorrectAnswer, setManualCorrectAnswer] = useState("A");
    const [manualPoints, setManualPoints] = useState("1");
    const [manualEnumCount, setManualEnumCount] = useState("3");
    const addQScrollRef = useRef<ScrollView>(null);

    // ── Adjust Assessment Setup State (In Preview) ───────────────────────────
    const [adjustSetupModalOpen, setAdjustSetupModalOpen] = useState(false);
    const [adjustTargetCount, setAdjustTargetCount] = useState<number>(10);
    const [adjustTargetType, setAdjustTargetType] = useState<string>("Multiple Choice");
    const [adjustTargetDifficulty, setAdjustTargetDifficulty] = useState<string>(difficulty);
    const [adjustTargetGradeLevel, setAdjustTargetGradeLevel] = useState<string>(gradeLevel);
    const [generatingMore, setGeneratingMore] = useState(false);

    // ── Change Individual Question Type State ────────────────────────────────
    const [changeTypeModalOpen, setChangeTypeModalOpen] = useState(false);
    const [selectedQForTypeChange, setSelectedQForTypeChange] = useState<ScannableQuestion | null>(null);
    const [selectedNewType, setSelectedNewType] = useState<QuestionType>("multiple_choice");

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
            if (quotaCheck.reason === "DAILY_LIMIT") {
                Alert.alert(
                    "Daily Limit Reached",
                    `You have reached today's AI generation limit (${quotaCheck.usedToday}/${quotaCheck.dailyLimit} used today).\n\nWould you like to reset your quota to continue testing?`,
                    [
                        { text: "Cancel", style: "cancel" },
                        {
                            text: "Reset Quota (Testing)",
                            onPress: async () => {
                                const freshState = await resetTeacherQuotaForTesting(activeTeacherId);
                                setQuotaState(freshState);
                                Alert.alert("Quota Reset", `Daily AI quota reset to ${freshState.remainingToday} of ${freshState.dailyLimit}! You can now generate.`);
                            },
                        },
                    ]
                );
            } else {
                Alert.alert(
                    quotaCheck.reason === "COOLDOWN" ? "Please Wait" : "Notice",
                    quotaCheck.message ||
                        "Please wait before generating another quiz."
                );
            }
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

    function handleConfirmNewQuiz() {
        Alert.alert(
            "Start a new quiz?",
            "Discard this generated assessment and return to the AI builder setup? Any unsaved edits will be lost.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Discard & Start New",
                    style: "destructive",
                    onPress: () => handleReset(),
                },
            ]
        );
    }

    function handleOpenAdjustSetup() {
        if (!generatedAssessment) return;
        const currentCount = generatedAssessment.questions.length;
        setAdjustTargetCount(currentCount);
        setAdjustTargetType(questionType);
        setAdjustTargetDifficulty(difficulty);
        setAdjustTargetGradeLevel(gradeLevel);

        // Detect existing types in questions
        const typesInAssessment = Array.from(new Set(generatedAssessment.questions.map((q) => q.type)));
        const countsInAssessment: Record<string, number> = {};
        generatedAssessment.questions.forEach((q) => {
            countsInAssessment[q.type] = (countsInAssessment[q.type] || 0) + 1;
        });

        if (questionType === "Mixed Assessment" || typesInAssessment.length > 1) {
            setAdjustTargetType("Mixed Assessment");
            const validTypes = typesInAssessment.filter((t) => MIXED_TYPE_OPTIONS.some((o) => o.key === t));
            if (validTypes.length >= 2) {
                setMixedTypes(validTypes);
                setMixedPartCounts(countsInAssessment);
            } else if (mixedTypes.length >= 2) {
                const nextCounts: Record<string, number> = { ...mixedPartCounts };
                mixedTypes.forEach((k) => {
                    if (!nextCounts[k]) nextCounts[k] = Math.max(1, Math.floor(currentCount / mixedTypes.length));
                });
                setMixedPartCounts(nextCounts);
            }
        } else {
            const base = Math.max(1, Math.floor(currentCount / (mixedTypes.length || 3)));
            const nextCounts: Record<string, number> = {};
            mixedTypes.forEach((k) => {
                nextCounts[k] = base;
            });
            setMixedPartCounts(nextCounts);
        }

        setAdjustSetupModalOpen(true);
    }

    // ── Manual question helpers ────────────────────────────────────────────────
    function resetManualForm() {
        setManualQType("multiple_choice");
        setManualQText("");
        setManualChoices(["", "", "", ""]);
        setManualCorrectAnswer("A");
        setManualPoints("1");
        setManualEnumCount("3");
    }

    function openAddQuestionModal() {
        resetManualForm();
        setAddQuestionModalOpen(true);
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

    function addChoice() {
        setManualChoices((prev) => [...prev, ""]);
    }

    function removeChoice(index: number) {
        setManualChoices((prev) => prev.filter((_, i) => i !== index));
    }

    function handleAddManualQuestion() {
        if (!generatedAssessment) return;
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
        } else {
            const trimmedAnswer = manualCorrectAnswer.trim();
            if (!trimmedAnswer) {
                Alert.alert("Missing Answer", "Please specify the correct answer.");
                return;
            }
        }

        const nextNumber = generatedAssessment.questions.length + 1;
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
                return type.replace(/_/g, " ");
        }
    }

    function handleApplyTrim(targetCount: number) {
        if (!generatedAssessment) return;
        if (targetCount >= generatedAssessment.questions.length) return;

        Alert.alert(
            "Trim assessment questions?",
            `Keep questions #1 to #${targetCount} and remove questions #${targetCount + 1} to #${generatedAssessment.questions.length}.\n\n(Instant action · Zero AI quota consumed.)`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Trim Questions",
                    style: "destructive",
                    onPress: () => {
                        const trimmedQuestions = generatedAssessment.questions.slice(0, targetCount);
                        const trimmedAnswerKey = generatedAssessment.answerKey.slice(0, targetCount);
                        setGeneratedAssessment({
                            ...generatedAssessment,
                            questions: trimmedQuestions,
                            answerKey: trimmedAnswerKey,
                        });
                        setQuestionCount(`${targetCount} Questions`);
                        setAdjustSetupModalOpen(false);
                    },
                },
            ]
        );
    }

    async function handleGenerateMoreQuestions(countToAdd: number) {
        if (!generatedAssessment || generatingMore) return;
        setGeneratingMore(true);
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

            const result = await generateAdditionalQuestions({
                existingQuestions: generatedAssessment.questions,
                countToAdd,
                questionType: adjustTargetType || questionType,
                quizTitle: generatedAssessment.quizTitle,
                subject,
                gradeLevel: adjustTargetGradeLevel || gradeLevel,
                difficulty: adjustTargetDifficulty || difficulty,
                lessonNotes: lessonNotes.trim() || undefined,
                attachedPdfBase64,
                attachedPdfName: attachedFile ? attachedFile.name : undefined,
                attachedFileName: attachedFile ? attachedFile.name : undefined,
                attachedFileType,
                attachedFileText,
            });

            const updatedQuestions = [...generatedAssessment.questions, ...result.questions];
            const updatedAnswerKey = [...generatedAssessment.answerKey, ...result.answerKey];

            setGeneratedAssessment({
                ...generatedAssessment,
                questions: updatedQuestions,
                answerKey: updatedAnswerKey,
            });
            setQuestionCount(`${updatedQuestions.length} Questions`);
            setAdjustSetupModalOpen(false);

            Alert.alert(
                "Questions Added!",
                `Successfully added ${result.questions.length} new question(s) to "${generatedAssessment.quizTitle}". Total questions: ${updatedQuestions.length}.\n\n(Generated without consuming a full daily quiz quota session.)`
            );
        } catch (err: any) {
            console.error("Error generating additional questions:", err);
            Alert.alert("Addition Failed", err?.message || "Could not generate additional questions.");
        } finally {
            setGeneratingMore(false);
        }
    }

    function handleManualConvertType(questionNumber: number, newType: QuestionType) {
        if (!generatedAssessment) return;
        const updatedQ = generatedAssessment.questions.map((q) => {
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

        const updatedA = generatedAssessment.answerKey.map((ak) => {
            if (ak.questionNumber !== questionNumber) return ak;
            let defaultAns = "A";
            if (newType === "true_false") defaultAns = "T";
            else if (newType === "identification" || newType === "fill_blank") defaultAns = "Answer";
            else if (newType === "enumeration") defaultAns = "Item 1, Item 2, Item 3";
            else if (newType === "word_box") defaultAns = "Word1";
            return {
                ...ak,
                correctAnswer: defaultAns,
                points: newType === "enumeration" ? 3 : 1,
            };
        });

        setGeneratedAssessment({
            ...generatedAssessment,
            questions: updatedQ,
            answerKey: updatedA,
        });
        setChangeTypeModalOpen(false);
        setSelectedQForTypeChange(null);

        // Open inline editing for question text
        const targetQ = updatedQ.find((q) => q.questionNumber === questionNumber);
        if (targetQ) {
            setEditingQuestionQNum(questionNumber);
            setEditingQuestionText(targetQ.questionText);
        }
    }

    function handleSaveSetupSettings() {
        if (!generatedAssessment) return;
        setQuestionType(adjustTargetType);
        setDifficulty(adjustTargetDifficulty);
        setGradeLevel(adjustTargetGradeLevel);

        if (adjustTargetType === "Mixed Assessment" && mixedTypes.length >= 2) {
            const targetSequence: QuestionType[] = [];
            mixedTypes.forEach((t) => {
                const count = mixedPartCounts[t] ?? 1;
                for (let i = 0; i < count; i++) {
                    targetSequence.push(t as QuestionType);
                }
            });

            const updatedQ = generatedAssessment.questions.map((q, idx) => {
                const desiredType = targetSequence[idx] || q.type;
                if (desiredType === q.type) return q;

                let newOptions: string[] = [];
                let newBoxes = 1;
                if (desiredType === "multiple_choice") {
                    newOptions = q.options && q.options.length >= 4 ? q.options : ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"];
                } else if (desiredType === "true_false") {
                    newOptions = ["A) True", "B) False"];
                } else if (desiredType === "word_box") {
                    newOptions = q.options && q.options.length >= 2 ? q.options : ["Word1", "Word2", "Word3", "Word4"];
                } else if (desiredType === "enumeration") {
                    newBoxes = 3;
                }
                return {
                    ...q,
                    type: desiredType,
                    options: newOptions,
                    answerBoxesRequired: newBoxes,
                };
            });

            const updatedA = generatedAssessment.answerKey.map((ak, idx) => {
                const desiredType = targetSequence[idx] || (generatedAssessment.questions[idx]?.type ?? "multiple_choice");
                if (desiredType === generatedAssessment.questions[idx]?.type) return ak;

                let defaultAns = ak.correctAnswer || "A";
                if (desiredType === "true_false") defaultAns = "T";
                else if (desiredType === "identification" || desiredType === "fill_blank") defaultAns = ak.correctAnswer && ak.correctAnswer.length <= 25 ? ak.correctAnswer : "Answer";
                else if (desiredType === "enumeration") defaultAns = "Item 1, Item 2, Item 3";
                else if (desiredType === "word_box") defaultAns = "Word1";
                return {
                    ...ak,
                    correctAnswer: defaultAns,
                    points: desiredType === "enumeration" ? 3 : 1,
                };
            });

            setGeneratedAssessment({
                ...generatedAssessment,
                questions: updatedQ,
                answerKey: updatedA,
            });
            setQuestionCount(`${updatedQ.length} Questions`);
        } else if (adjustTargetType !== "Mixed Assessment") {
            const typeMap: Record<string, QuestionType> = {
                "Multiple Choice": "multiple_choice",
                "True / False": "true_false",
                "Identification": "identification",
                "Fill in the Blank": "fill_blank",
                "Enumeration": "enumeration",
                "Word Box": "word_box",
            };
            const targetQType = typeMap[adjustTargetType];
            if (targetQType && generatedAssessment.questions.some((q) => q.type !== targetQType)) {
                const updatedQ = generatedAssessment.questions.map((q) => {
                    if (q.type === targetQType) return q;
                    let newOptions: string[] = [];
                    let newBoxes = 1;
                    if (targetQType === "multiple_choice") {
                        newOptions = ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"];
                    } else if (targetQType === "true_false") {
                        newOptions = ["A) True", "B) False"];
                    } else if (targetQType === "word_box") {
                        newOptions = ["Word1", "Word2", "Word3", "Word4"];
                    } else if (targetQType === "enumeration") {
                        newBoxes = 3;
                    }
                    return {
                        ...q,
                        type: targetQType,
                        options: newOptions,
                        answerBoxesRequired: newBoxes,
                    };
                });
                const updatedA = generatedAssessment.answerKey.map((ak) => {
                    let defaultAns = ak.correctAnswer || "A";
                    if (targetQType === "true_false") defaultAns = "T";
                    else if (targetQType === "identification" || targetQType === "fill_blank") defaultAns = "Answer";
                    else if (targetQType === "enumeration") defaultAns = "Item 1, Item 2, Item 3";
                    else if (targetQType === "word_box") defaultAns = "Word1";
                    return {
                        ...ak,
                        correctAnswer: defaultAns,
                        points: targetQType === "enumeration" ? 3 : 1,
                    };
                });
                setGeneratedAssessment({
                    ...generatedAssessment,
                    questions: updatedQ,
                    answerKey: updatedA,
                });
            }
        }
        setAdjustSetupModalOpen(false);
    }

    function handleRegenerateQuestion(questionNumber: number, overrideType?: QuestionType) {
        if (!generatedAssessment || regeneratingQNum !== null) return;
        const targetQ = generatedAssessment.questions.find((q) => q.questionNumber === questionNumber);
        if (!targetQ) return;

        const effectiveType = overrideType || targetQ.type;
        const typeLabel = formatTypeLabel(effectiveType).toLowerCase();

        const confirmTitle = overrideType && overrideType !== targetQ.type
            ? `Convert question #${questionNumber} to ${typeLabel}?`
            : `Regenerate question #${questionNumber}?`;

        const confirmMsg = overrideType && overrideType !== targetQ.type
            ? `This will replace question #${questionNumber} with a new AI-generated ${typeLabel} question, keeping all other questions untouched.\n\n(Does not use your daily AI generation quota.)`
            : `This will replace question #${questionNumber} with a new AI-generated ${typeLabel} question, keeping all other questions untouched.\n\n(Does not use your daily AI generation quota.)`;

        Alert.alert(
            confirmTitle,
            confirmMsg,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: overrideType && overrideType !== targetQ.type ? "Convert" : "Regenerate",
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
                                questionType: effectiveType,
                                currentQuestionText: targetQ.questionText,
                                otherQuestions: generatedAssessment.questions,
                                quizTitle: generatedAssessment.quizTitle,
                                subject,
                                gradeLevel: adjustTargetGradeLevel || gradeLevel,
                                difficulty: adjustTargetDifficulty || difficulty,
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
                                `Question #${questionNumber} has been replaced with a fresh ${formatTypeLabel(effectiveType)} question.`
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

        // Dismiss the export options bottom sheet immediately so it does not render underneath the loading modal
        setExportModalOpen(false);
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
                await new Promise((r) => setTimeout(r, 600));
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
            showToast("✓ Saved to drafts");
        } catch (err: any) {
            Alert.alert("Save Failed", err.message || "Failed to save draft.");
        } finally {
            setSavingDraft(false);
        }
    }

    const assessmentSections = useMemo(() => {
        if (!generatedAssessment || !generatedAssessment.questions.length) return [];

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

        generatedAssessment.questions.forEach((q) => {
            if (currentType === null || q.type === currentType) {
                currentType = q.type;
                currentList.push(q);
            } else {
                const pNum = sections.length + 1;
                const roman = ROMANS[sections.length] || `${pNum}`;
                const pts = currentList.reduce((sum, item) => {
                    const a = generatedAssessment.answerKey.find((k) => k.questionNumber === item.questionNumber);
                    return sum + (a ? a.points : (item.type === "enumeration" ? (item.answerBoxesRequired || 3) : 1));
                }, 0);
                sections.push({
                    partNumber: pNum,
                    roman,
                    type: currentType,
                    title: `PART ${roman} · ${formatTypeLabel(currentType).toUpperCase()}`,
                    questions: currentList,
                    startNum: currentList[0].questionNumber,
                    endNum: currentList[currentList.length - 1].questionNumber,
                    totalPoints: pts,
                });
                currentType = q.type;
                currentList = [q];
            }
        });

        if (currentList.length > 0 && currentType !== null) {
            const pNum = sections.length + 1;
            const roman = ROMANS[sections.length] || `${pNum}`;
            const pts = currentList.reduce((sum, item) => {
                const a = generatedAssessment.answerKey.find((k) => k.questionNumber === item.questionNumber);
                return sum + (a ? a.points : (item.type === "enumeration" ? (item.answerBoxesRequired || 3) : 1));
            }, 0);
            sections.push({
                partNumber: pNum,
                roman,
                type: currentType,
                title: `PART ${roman} · ${formatTypeLabel(currentType).toUpperCase()}`,
                questions: currentList,
                startNum: currentList[0].questionNumber,
                endNum: currentList[currentList.length - 1].questionNumber,
                totalPoints: pts,
            });
        }

        return sections;
    }, [generatedAssessment]);

    function renderUnifiedMixedPicker(isPreviewModal: boolean = false) {
        const totalSelectedParts = mixedTypes.length;
        const currentTotalItems = mixedTypes.reduce((sum, key) => sum + (mixedPartCounts[key] ?? (isPreviewModal ? 1 : 3)), 0);
        const ROMANS = ["I", "II", "III", "IV", "V", "VI"];

        return (
            <View style={[styles.unifiedMixedCard, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", borderColor: border }]}>
                {/* Header: Title + Neutral summary pill */}
                <View style={styles.unifiedMixedHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={[styles.unifiedMixedTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                            Included exam parts
                        </Text>
                        <Text style={[styles.unifiedMixedSub, { color: darkMode ? textSub : "#64748B" }]}>
                            Tick parts in the order they should appear (I, II, III...).
                        </Text>
                    </View>
                    <View style={[styles.unifiedSummaryPill, { backgroundColor: darkMode ? "#111827" : "#F1F5F9" }]}>
                        <Text style={[styles.unifiedSummaryPillText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>
                            {totalSelectedParts} selected · {currentTotalItems} items
                        </Text>
                    </View>
                </View>

                {/* Unified 6-row list */}
                <View style={{ marginTop: 10 }}>
                    {MIXED_TYPE_OPTIONS.map((opt) => {
                        const orderIndex = mixedTypes.indexOf(opt.key);
                        const isSelected = orderIndex !== -1;
                        const roman = isSelected ? ROMANS[orderIndex] : null;
                        const countVal = mixedPartCounts[opt.key] ?? (isPreviewModal ? 1 : 3);

                        return (
                            <View
                                key={opt.key}
                                style={[
                                    styles.unifiedRow,
                                    {
                                        backgroundColor: isSelected
                                            ? (darkMode ? "#1E293B" : "#F8FAFC")
                                            : (darkMode ? "#111827" : "#FFFFFF"),
                                        borderColor: isSelected
                                            ? (darkMode ? "#475569" : "#CBD5E1")
                                            : (darkMode ? "#1F2937" : "#F1F5F9"),
                                    },
                                ]}
                            >
                                {/* Left: Tappable Checkbox + Roman badge + Type label */}
                                <TouchableOpacity
                                    style={styles.unifiedRowLeft}
                                    onPress={() => toggleMixedPart(opt.key, isPreviewModal)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={isSelected ? "checkbox" : "square-outline"}
                                        size={18}
                                        color={isSelected ? (accentColor || "#2563EB") : textSub}
                                        style={{ marginRight: 8 }}
                                    />
                                    <View
                                        style={[
                                            styles.unifiedRomanBadge,
                                            {
                                                backgroundColor: isSelected
                                                    ? (darkMode ? "#334155" : "#0F172A")
                                                    : (darkMode ? "#1E293B" : "#E2E8F0"),
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.unifiedRomanBadgeText,
                                                {
                                                    color: isSelected
                                                        ? "#FFFFFF"
                                                        : (darkMode ? textSub : "#94A3B8"),
                                                },
                                            ]}
                                        >
                                            {roman || "—"}
                                        </Text>
                                    </View>
                                    <Text
                                        style={[
                                            styles.unifiedRowLabel,
                                            {
                                                color: isSelected
                                                    ? (darkMode ? textMain : "#0F172A")
                                                    : (darkMode ? textSub : "#64748B"),
                                                fontWeight: isSelected ? "600" : "500",
                                            },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {opt.label}
                                    </Text>
                                </TouchableOpacity>

                                {/* Right: Compact stepper [ - ] count [ + ] if selected, else subtle hint */}
                                {isSelected ? (
                                    <View style={styles.unifiedStepper}>
                                        <TouchableOpacity
                                            onPress={() => adjustMixedPartCount(opt.key, -1, isPreviewModal)}
                                            style={[
                                                styles.unifiedStepBtn,
                                                {
                                                    backgroundColor: darkMode ? "#334155" : "#FFFFFF",
                                                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                                                },
                                            ]}
                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        >
                                            <Ionicons name="remove" size={14} color={darkMode ? textMain : "#0F172A"} />
                                        </TouchableOpacity>
                                        <Text style={[styles.unifiedStepCount, { color: darkMode ? textMain : "#0F172A" }]}>
                                            {countVal}
                                        </Text>
                                        <TouchableOpacity
                                            onPress={() => adjustMixedPartCount(opt.key, 1, isPreviewModal)}
                                            style={[
                                                styles.unifiedStepBtn,
                                                {
                                                    backgroundColor: darkMode ? "#334155" : "#FFFFFF",
                                                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                                                },
                                            ]}
                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        >
                                            <Ionicons name="add" size={14} color={darkMode ? textMain : "#0F172A"} />
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <TouchableOpacity
                                        onPress={() => toggleMixedPart(opt.key, isPreviewModal)}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    >
                                        <Text style={{ fontSize: 12, color: textSub, fontStyle: "italic" }}>
                                            Tap to add
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        );
                    })}
                </View>
            </View>
        );
    }

    const canGenerate = (attachedFile !== null || lessonNotes.trim().length > 0) && !generating;

    return (
        <View style={[styles.root, { backgroundColor: bg }]}>
            <ScrollView
                style={styles.root}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
            {!showResults ? (
                <>
                    {/* ── Header ── */}
                    <View style={styles.headerRow}>
                        <View style={[styles.headerIconBg, { backgroundColor: accentColor + "18" }]}>
                            <Ionicons name="sparkles" size={18} color={accentColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.headerTitle, { color: textMain }]}>Tseki AI Assessment Suite</Text>
                        </View>
                    </View>

                    {/* ── Attached File ── */}
                    <Text style={[styles.fieldLabel, { color: darkMode ? "#D1D5DB" : "#334155", marginTop: 4 }]}>Reference file (optional)</Text>
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
                                <Ionicons name="attach-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
                                <Text style={[styles.attachBtnText, { color: textMain, fontWeight: "500" }]}>
                                    Upload reference file
                                </Text>
                                <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "500" }}>
                                    DOC, PPT, PDF
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* ── Paste Lesson Notes or Syllabus Text (Optional) ── */}
                    <Text style={[styles.fieldLabel, { color: darkMode ? "#D1D5DB" : "#334155" }]}>
                        Lesson notes or syllabus (optional)
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
                            <Text style={[styles.fieldLabel, { color: darkMode ? "#D1D5DB" : "#334155" }]}>Subject</Text>
                            <View style={[styles.autoSubjectBtn, { backgroundColor: inputBg, borderColor: border }]}>
                                <Text style={[styles.autoSubjectText, { color: textMain }]} numberOfLines={1}>
                                    {subject}
                                </Text>
                                <Ionicons name="lock-closed" size={14} color={textSub} />
                            </View>
                        </View>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="Grade level"
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
                                label="Question type"
                                value={questionType}
                                options={QUESTION_TYPES}
                                onSelect={setQuestionType}
                                accentColor={accentColor}
                            />
                        </View>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="Questions count"
                                value={questionCount}
                                options={QUESTION_COUNTS}
                                onSelect={setQuestionCount}
                                accentColor={accentColor}
                            />
                        </View>
                    </View>

                    {/* ── Mixed Assessment Type Picker ── */}
                    {questionType === "Mixed Assessment" && renderUnifiedMixedPicker(false)}

                    {/* ── Difficulty Level ── */}
                    <Dropdown
                        label="Difficulty level"
                        value={difficulty}
                        options={BLOOM_DIFFICULTIES}
                        onSelect={setDifficulty}
                        accentColor={accentColor}
                    />

                    {/* ── Per-User Daily AI Quota Status Bar (resets 12:00 AM Manila) ── */}
                    {quotaState && (
                        <View
                            style={{
                                marginTop: 18,
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: quotaState.isDailyLimitReached
                                    ? "#FECACA"
                                    : (darkMode ? "#334155" : "#E2E8F0"),
                                backgroundColor: quotaState.isDailyLimitReached
                                    ? (darkMode ? "rgba(220, 38, 38, 0.12)" : "#FEF2F2")
                                    : (darkMode ? "#1E293B" : "#F8FAFC"),
                            }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: "500",
                                        color: quotaState.isDailyLimitReached ? "#DC2626" : (darkMode ? "#94A3B8" : "#475569"),
                                        flex: 1,
                                    }}
                                    numberOfLines={1}
                                >
                                    {`Daily AI quota: ${quotaState.remainingToday} of ${quotaState.dailyLimit} left · Resets 12:00 AM PHT`}
                                </Text>

                                {(quotaState.isDailyLimitReached || (typeof __DEV__ !== "undefined" && __DEV__)) && (
                                    <TouchableOpacity
                                        onPress={async () => {
                                            const activeTeacherId = currentTeacherId || (await resolveCurrentTeacherId());
                                            const freshState = await resetTeacherQuotaForTesting(activeTeacherId);
                                            setQuotaState(freshState);
                                            Alert.alert("Quota Reset", `Daily AI quota reset to ${freshState.remainingToday} of ${freshState.dailyLimit} for testing!`);
                                        }}
                                        style={{
                                            paddingHorizontal: 8,
                                            paddingVertical: 2,
                                            borderRadius: 6,
                                            backgroundColor: quotaState.isDailyLimitReached
                                                ? (darkMode ? "rgba(220, 38, 38, 0.25)" : "#FEE2E2")
                                                : (darkMode ? "#334155" : "#E2E8F0"),
                                            marginLeft: 8,
                                        }}
                                        activeOpacity={0.7}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: quotaState.isDailyLimitReached
                                                    ? "#DC2626"
                                                    : (darkMode ? "#F8FAFC" : "#0F172A"),
                                            }}
                                        >
                                            Reset
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            <View
                                style={{
                                    height: 4,
                                    borderRadius: 2,
                                    backgroundColor: darkMode ? "#334155" : "#E2E8F0",
                                    overflow: "hidden",
                                }}
                            >
                                <View
                                    style={{
                                        height: "100%",
                                        width: `${Math.min(100, Math.max(0, (quotaState.remainingToday / Math.max(1, quotaState.dailyLimit)) * 100))}%`,
                                        backgroundColor: quotaState.isDailyLimitReached ? "#DC2626" : accentColor,
                                        borderRadius: 2,
                                    }}
                                />
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
                            <View style={[styles.previewModeBadge, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                                <Text style={[styles.previewModeBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>Draft Preview</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <TouchableOpacity
                                    onPress={handleOpenAdjustSetup}
                                    style={[styles.previewAdjustBtn, { backgroundColor: inputBg, borderColor: border }]}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="options-outline" size={13} color={darkMode ? "#CBD5E1" : "#0F172A"} style={{ marginRight: 4 }} />
                                    <Text style={[styles.previewAdjustBtnText, { color: darkMode ? "#CBD5E1" : "#0F172A" }]}>Adjust Setup</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleConfirmNewQuiz}
                                    style={[styles.previewResetBtn, { backgroundColor: inputBg, borderColor: border }]}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="refresh" size={13} color={textSub} style={{ marginRight: 4 }} />
                                    <Text style={[styles.previewResetBtnText, { color: textSub }]}>New Quiz</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        <Text style={[styles.previewTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                            {generatedAssessment?.quizTitle || "Assessment Preview"}
                        </Text>

                        <Text style={[styles.previewSubtext, { color: darkMode ? textSub : "#64748B" }]}>
                            Review or edit items below before publishing to your class.
                        </Text>

                        <View style={[styles.previewStatsRow, { backgroundColor: inputBg, borderColor: border }]}>
                            <TouchableOpacity
                                style={styles.previewStatItem}
                                onPress={handleOpenAdjustSetup}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]} numberOfLines={1}>
                                    {generatedAssessment?.questions.length || questionCount}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]} numberOfLines={1}>
                                    Questions
                                </Text>
                            </TouchableOpacity>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <View style={styles.previewStatItem}>
                                <Text style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]} numberOfLines={1}>
                                    {generatedAssessment?.questions.reduce((sum, q) => sum + (q.type === "enumeration" ? (q.answerBoxesRequired || 3) : 1), 0) || questionCount}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]} numberOfLines={1}>
                                    Points
                                </Text>
                            </View>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <TouchableOpacity
                                style={styles.previewStatItem}
                                onPress={handleOpenAdjustSetup}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]} numberOfLines={1}>
                                    {difficulty.split(" ")[0]}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]} numberOfLines={1}>
                                    Difficulty
                                </Text>
                            </TouchableOpacity>
                            <View style={[styles.previewStatDivider, { backgroundColor: border }]} />
                            <TouchableOpacity
                                style={styles.previewStatItem}
                                onPress={handleOpenAdjustSetup}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.previewStatValue, { color: darkMode ? textMain : "#0F172A" }]} numberOfLines={1}>
                                    {gradeLevel.replace(/\s*\(.*?\)/g, "").replace(/Grade\s*/i, "Gr ")}
                                </Text>
                                <Text style={[styles.previewStatLabel, { color: darkMode ? textSub : "#64748B" }]} numberOfLines={1}>
                                    Grade
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* ── Scannable Question Cards Grouped by Section ── */}
                    {assessmentSections.map((section) => {
                        const showSectionHeader = questionType === "Mixed Assessment" || assessmentSections.length > 1;
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
                                        <Text style={[styles.sectionHeaderTitle, { color: darkMode ? "#CBD5E1" : "#475569" }]}>
                                            {section.title}
                                        </Text>
                                        <Text style={[styles.sectionHeaderMeta, { color: darkMode ? textSub : "#64748B" }]}>
                                            {section.startNum === section.endNum
                                                ? `Item ${section.startNum} (${section.totalPoints} ${section.totalPoints === 1 ? "pt" : "pts"})`
                                                : `Items ${section.startNum}–${section.endNum} (${section.totalPoints} pts)`}
                                        </Text>
                                    </View>
                                )}

                                {isWordBoxSection && sharedWords.length > 0 && (
                                    <View style={[styles.sharedWordBankCard, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", borderColor: border }]}>
                                        <View style={styles.sharedWordBankHeader}>
                                            <Ionicons name="grid-outline" size={14} color={accentColor} />
                                            <Text style={[styles.sharedWordBankTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                                                Word Bank for Part {section.roman}
                                            </Text>
                                        </View>
                                        <View style={styles.sharedWordBankChipsWrap}>
                                            {sharedWords.map((word, wIdx) => (
                                                <View
                                                    key={`swb_${wIdx}`}
                                                    style={[
                                                        styles.sharedWordChip,
                                                        { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: darkMode ? border : "#E2E8F0" },
                                                    ]}
                                                >
                                                    <Text style={[styles.sharedWordChipText, { color: darkMode ? textMain : "#334155" }]}>
                                                        {word}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                {section.questions.map((q) => {
                                    const answerObj = generatedAssessment?.answerKey.find((k) => k.questionNumber === q.questionNumber);
                                    const correctAnswer = answerObj ? answerObj.correctAnswer : "";
                                    const points = answerObj ? answerObj.points : 1;
                                    const hasOptions = Boolean(q.options && q.options.length > 0 && q.type !== "word_box");

                                    return (
                                        <View key={q.questionNumber} style={[styles.questionCard, { backgroundColor: cardBg, borderColor: border }]}>
                                            {/* Row 1 — Dedicated Card Header Bar */}
                                            <View style={styles.questionHeader}>
                                                <View style={styles.questionHeaderLeft}>
                                                    <View style={[styles.questionNumber, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                                                        <Text style={[styles.questionNumberText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                                                            Q{q.questionNumber}
                                                        </Text>
                                                    </View>
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
                                                        <Text style={[styles.typeSelectorChipText, { color: darkMode ? "#CBD5E1" : "#475569" }]} numberOfLines={1}>
                                                            {formatTypeLabel(q.type)}
                                                        </Text>
                                                        <Ionicons name="chevron-down" size={11} color={darkMode ? "#94A3B8" : "#64748B"} />
                                                    </TouchableOpacity>
                                                    <Text style={[styles.questionPointsLabel, { color: darkMode ? textSub : "#64748B" }]}>
                                                        {points} {points === 1 ? "pt" : "pts"}
                                                    </Text>
                                                </View>

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
                                                            <ActivityIndicator size="small" color={darkMode ? "#CBD5E1" : "#334155"} style={{ transform: [{ scale: 0.75 }] }} />
                                                        ) : (
                                                            <Ionicons name="refresh" size={14} color={darkMode ? "#CBD5E1" : "#334155"} />
                                                        )}
                                                    </TouchableOpacity>

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
                                                            size={18}
                                                            color={darkMode ? textSub : "#64748B"}
                                                        />
                                                    </TouchableOpacity>

                                                    {/* Delete question button */}
                                                    <TouchableOpacity
                                                        onPress={() => handleDeleteQuestion(q.questionNumber)}
                                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                        style={styles.deleteQBtn}
                                                    >
                                                        <Ionicons name="trash-outline" size={18} color={darkMode ? textSub : "#64748B"} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>

                                            {/* Row 2 — Full-Width Question Prompt */}
                                            {editingQuestionQNum === q.questionNumber ? (
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
                                                    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                                                        <TouchableOpacity
                                                            onPress={() => setEditingQuestionQNum(null)}
                                                            style={[styles.smallCancelBtn, { borderColor: border }]}
                                                        >
                                                            <Text style={{ fontSize: 12, fontWeight: "600", color: textSub }}>Cancel</Text>
                                                        </TouchableOpacity>
                                                        <TouchableOpacity
                                                            onPress={() => handleSaveQuestionTextEdit(q.questionNumber)}
                                                            style={[styles.smallSaveBtn, { backgroundColor: accentColor }]}
                                                        >
                                                            <Text style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>Save Question</Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                </View>
                                            ) : (
                                                <Text style={[styles.questionText, { color: darkMode ? textMain : "#0F172A" }]}>
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
                                                                        backgroundColor: "#F0FDF4",
                                                                        borderColor: "#16A34A",
                                                                    },
                                                                ]}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.choiceText,
                                                                        { color: darkMode ? textMain : "#334155" },
                                                                        isCorrect && { color: "#15803D", fontWeight: "600" },
                                                                    ]}
                                                                >
                                                                    {opt}
                                                                </Text>
                                                                {isCorrect && (
                                                                    <Ionicons name="checkmark" size={16} color="#16A34A" style={{ marginLeft: 8 }} />
                                                                )}
                                                            </View>
                                                        );
                                                    })}
                                                </View>
                                            )}

                                            {/* Compact Answer Key Row for non-MC questions */}
                                            {(!hasOptions || q.type === "word_box") && (() => {
                                                const isShortAnswerType =
                                                    q.type === "identification" ||
                                                    q.type === "fill_blank" ||
                                                    q.type === "enumeration" ||
                                                    q.type === "word_box";
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
                                                    <View style={[styles.answerWrap, { borderLeftColor: isTooLong ? "#D97706" : "#16A34A", marginTop: 4 }]}>
                                                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                                            <Text style={styles.answerLabel}>Answer Key</Text>
                                                            {isShortAnswerType && !isEditingThis && (
                                                                <TouchableOpacity
                                                                    onPress={() => {
                                                                        setEditingAnswerQNum(q.questionNumber);
                                                                        setEditingAnswerText(correctAnswer);
                                                                    }}
                                                                >
                                                                    <Text style={{ fontSize: 12, fontWeight: "600", color: isTooLong ? "#D97706" : "#475569" }}>
                                                                        Edit Answer
                                                                    </Text>
                                                                </TouchableOpacity>
                                                            )}
                                                        </View>

                                                        {isEditingThis ? (
                                                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                                                                <TextInput
                                                                    style={{
                                                                        flex: 1,
                                                                        borderWidth: 1,
                                                                        borderColor: "#CBD5E1",
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
                                                                    <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Save</Text>
                                                                </TouchableOpacity>
                                                            </View>
                                                        ) : (
                                                            <Text style={[styles.answerText, { color: isTooLong ? "#D97706" : "#15803D" }]}>
                                                                {correctAnswer}
                                                            </Text>
                                                        )}

                                                        {isTooLong && (
                                                            <Text style={{ fontSize: 11, fontWeight: "600", color: "#D97706", marginTop: 4 }}>
                                                                Exceeds 25 chars / 3 words — shorten so it fits inside the scannable answer box.
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

                    {/* ── Add Question Manually Button ── */}
                    <TouchableOpacity
                        style={[
                            styles.addQuestionBtn,
                            {
                                backgroundColor: darkMode ? cardBg : "#FFFFFF",
                                borderColor: darkMode ? border : "#CBD5E1",
                            },
                        ]}
                        onPress={openAddQuestionModal}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.addQuestionIconCircle, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                            <Ionicons name="add" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.addQuestionTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                                Add Question Manually
                            </Text>
                            <Text style={[styles.addQuestionSub, { color: darkMode ? textSub : "#64748B" }]}>
                                Add your own question to this assessment
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={darkMode ? textSub : "#64748B"} />
                    </TouchableOpacity>

                    {/* ── Primary CTA: Publish Quiz ── */}
                    <TouchableOpacity
                        style={[styles.publishBtn, { backgroundColor: "#EA580C", opacity: publishingQuiz ? 0.7 : 1 }]}
                        onPress={handlePublishQuiz}
                        disabled={publishingQuiz}
                        activeOpacity={0.85}
                    >
                        <Ionicons name="send-outline" size={16} color="#FFFFFF" />
                        <Text style={styles.publishText}>
                            {publishingQuiz ? "Publishing..." : "Publish Quiz"}
                        </Text>
                    </TouchableOpacity>

                    {/* ── Secondary Row: Save as Draft + Export / Print PDF ── */}
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
                            onPress={handleSaveDraft}
                            disabled={savingDraft}
                            activeOpacity={0.75}
                        >
                            {savingDraft ? (
                                <ActivityIndicator size="small" color={darkMode ? textMain : "#0F172A"} />
                            ) : (
                                <>
                                    <Ionicons name="save-outline" size={16} color={darkMode ? textMain : "#0F172A"} />
                                    <Text style={[styles.secondaryFooterBtnText, { color: darkMode ? textMain : "#0F172A" }]}>
                                        Save as Draft
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
                            onPress={() => setExportModalOpen(true)}
                            disabled={exportingPdf}
                            activeOpacity={0.75}
                        >
                            {exportingPdf ? (
                                <ActivityIndicator size="small" color={darkMode ? textMain : "#0F172A"} />
                            ) : (
                                <>
                                    <Ionicons name="print-outline" size={16} color={darkMode ? textMain : "#0F172A"} />
                                    <Text style={[styles.secondaryFooterBtnText, { color: darkMode ? textMain : "#0F172A" }]}>
                                        Export / Print PDF
                                    </Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
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
                    <View style={[styles.loadingCard, { backgroundColor: darkMode ? cardBg : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
                        <PublishingQuizAnimation
                            quizTitle={generatedAssessment?.quizTitle || "Assessment"}
                            accentColor={accentColor}
                            darkMode={darkMode}
                        />
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
                    <View style={[styles.loadingCard, { backgroundColor: darkMode ? cardBg : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
                        <AssessmentGeneratingAnimation
                            topicOrSubject={subject || classTitle || "Assessment"}
                            questionCount={typeof questionCount === "string" ? questionCount : `${questionCount} Items`}
                            difficulty={difficulty}
                            questionType={questionType}
                            isAiBusy={isAiBusy}
                            statusMessage={generatingStatus}
                            accentColor={accentColor}
                            darkMode={darkMode}
                        />
                    </View>
                </View>
            </Modal>

            {/* ── PDF Exporting Progress Overlay ── */}
            <Modal
                visible={exportingPdf}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => { }}
            >
                <View style={styles.loadingOverlay}>
                    <View style={[styles.loadingCard, { backgroundColor: darkMode ? cardBg : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
                        <PdfExportingAnimation
                            exportVersion={exportVersion}
                            quizTitle={generatedAssessment?.quizTitle || "Assessment"}
                            accentColor={accentColor}
                            darkMode={darkMode}
                        />
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
                        {/* Drag Handle */}
                        <View style={styles.sheetDragHandle} />

                        <View style={styles.exportSheetHeader}>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={[styles.exportSheetTitle, { color: textMain }]}>Export Paper Sheet Layout</Text>
                                <Text style={[styles.exportSheetSub, { color: textSub }]}>
                                    Download, print, or share the physical test sheet formatted with scannable answer boxes.
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setExportModalOpen(false)}
                                style={styles.sheetCloseBtn}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close" size={20} color={textSub} />
                            </TouchableOpacity>
                        </View>

                                {/* Anti-Cheating Version Selector (Set A / B / C) */}
                                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                    <Text style={{ fontSize: 14, fontWeight: "500", color: darkMode ? "#E2E8F0" : "#334155" }}>
                                        Test version
                                    </Text>
                                    <View style={[styles.segmentedTrack, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                                        {(["A", "B", "C"] as const).map((ver) => {
                                            const isActive = exportVersion === ver;
                                            return (
                                                <TouchableOpacity
                                                    key={ver}
                                                    onPress={() => setExportVersion(ver)}
                                                    activeOpacity={0.7}
                                                    style={[
                                                        styles.segmentBtn,
                                                        isActive && [
                                                            styles.segmentBtnActive,
                                                            {
                                                                backgroundColor: darkMode ? "#334155" : "#FFFFFF",
                                                                borderColor: darkMode ? "#475569" : "#CBD5E1",
                                                            },
                                                        ],
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.segmentBtnText,
                                                            {
                                                                color: isActive
                                                                    ? (darkMode ? "#F8FAFC" : "#0F172A")
                                                                    : "#64748B",
                                                                fontWeight: isActive ? "700" : "500",
                                                            },
                                                        ]}
                                                    >
                                                        Set {ver}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>

                                {/* Force Separate Answer Sheet Toggle */}
                                <TouchableOpacity
                                    onPress={() => setForceSeparateMode((prev) => !prev)}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        paddingVertical: 9,
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
                                    <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                                        <Ionicons name="document-text-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                            <Text style={[styles.exportOptionTitle, { color: textMain }]}>Short Bond Paper</Text>
                                            <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                                                <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>8.5" × 11"</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.exportOptionSub, { color: textSub }]}>
                                            {`1 single sheet (Letter size) • Set ${exportVersion} scannable layout for 1-shot camera scanning`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={18} color="#94A3B8" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportOptionBtn}
                                    onPress={() => handleExportPaper(false, "long")}
                                    disabled={exportingPdf}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                                        <Ionicons name="document-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                            <Text style={[styles.exportOptionTitle, { color: textMain }]}>Long Bond Paper</Text>
                                            <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                                                <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>8.5" × 13"</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.exportOptionSub, { color: textSub }]}>
                                            {`1 single sheet (Philippine Folio) • Fits all questions with Set ${exportVersion} spacing`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={18} color="#94A3B8" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.exportOptionBtn}
                                    onPress={() => handleExportPaper(true, "short")}
                                    disabled={exportingPdf}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                                        <Ionicons name="checkmark-done-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                            <Text style={[styles.exportOptionTitle, { color: textMain }]}>Teacher Answer Key</Text>
                                            <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                                                <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>PDF</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.exportOptionSub, { color: textSub }]}>
                                            {`1 single sheet with correct answers pre-printed in boxes for Set ${exportVersion}`}
                                        </Text>
                                    </View>
                                    <Ionicons name="download-outline" size={18} color="#94A3B8" />
                                </TouchableOpacity>
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
                            {/* Drag Handle */}
                            <View style={styles.sheetDragHandle} />

                            <ScrollView
                                ref={addQScrollRef}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                contentContainerStyle={{ paddingBottom: 16 }}
                            >
                                {/* Header */}
                                <View style={styles.addQHeader}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.addQTitle, { color: textMain }]}>Add Question Manually</Text>
                                        <Text style={[styles.addQSubTitle, { color: textSub }]}>Create a custom question for this assessment</Text>
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => setAddQuestionModalOpen(false)}
                                        style={styles.sheetCloseBtn}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Ionicons name="close" size={20} color={textSub} />
                                    </TouchableOpacity>
                                </View>

                                {/* Question Type Selector */}
                                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>Question type</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 20 }} style={{ marginBottom: 14 }}>
                                    {([
                                        { key: "multiple_choice" as QuestionType, label: "Multiple Choice", icon: "list" as const },
                                        { key: "true_false" as QuestionType, label: "True / False", icon: "checkmark-done" as const },
                                        { key: "identification" as QuestionType, label: "Identification", icon: "text" as const },
                                        { key: "fill_blank" as QuestionType, label: "Fill in the Blank", icon: "pencil" as const },
                                        { key: "enumeration" as QuestionType, label: "Enumeration", icon: "reorder-three" as const },
                                        { key: "word_box" as QuestionType, label: "Word Box", icon: "grid" as const },
                                    ]).map((t) => {
                                        const isActive = manualQType === t.key;
                                        return (
                                            <TouchableOpacity
                                                key={t.key}
                                                style={[
                                                    styles.addQTypeChip,
                                                    {
                                                        backgroundColor: isActive
                                                            ? "#0F172A"
                                                            : (darkMode ? "#1E293B" : "#F8FAFC"),
                                                        borderColor: isActive
                                                            ? "#0F172A"
                                                            : (darkMode ? "#475569" : "#CBD5E1"),
                                                    },
                                                ]}
                                                onPress={() => handleManualQTypeChange(t.key)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons
                                                    name={t.icon}
                                                    size={14}
                                                    color={isActive ? "#FFFFFF" : (darkMode ? "#94A3B8" : "#475569")}
                                                />
                                                <Text style={[
                                                    styles.addQTypeChipText,
                                                    { color: isActive ? "#FFFFFF" : (darkMode ? "#E2E8F0" : "#334155") },
                                                ]}>
                                                    {t.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>

                                {/* Question Text */}
                                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                                    Question prompt <Text style={styles.required}>*</Text>
                                </Text>
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

                                {/* Choices (for MC, T/F) */}
                                {(manualQType === "multiple_choice" || manualQType === "true_false") && (
                                    <>
                                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                            <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155", marginBottom: 0 }]}>Choices</Text>
                                            <Text style={{ fontSize: 12, color: "#64748B" }}>Tap letter to mark correct key</Text>
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
                                                                    : (darkMode ? "#334155" : "#F1F5F9"),
                                                            },
                                                        ]}
                                                        onPress={() => setManualCorrectAnswer(letter)}
                                                        activeOpacity={0.7}
                                                    >
                                                        <Text style={[
                                                            styles.choiceBadgeBtnText,
                                                            { color: isCorrect ? "#FFFFFF" : (darkMode ? "#94A3B8" : "#475569") },
                                                        ]}>
                                                            {letter}
                                                        </Text>
                                                    </TouchableOpacity>

                                                    <TextInput
                                                        style={[
                                                            styles.addQChoiceInput,
                                                            {
                                                                backgroundColor: isCorrect
                                                                    ? (darkMode ? "rgba(22, 163, 74, 0.15)" : "#F0FDF4")
                                                                    : inputBg,
                                                                borderColor: isCorrect
                                                                    ? "#16A34A"
                                                                    : (darkMode ? "#475569" : "#CBD5E1"),
                                                                color: textMain,
                                                            },
                                                        ]}
                                                        placeholder={manualQType === "true_false" ? (idx === 0 ? "True" : "False") : `Enter option ${letter}...`}
                                                        placeholderTextColor={textSub}
                                                        value={choice}
                                                        onChangeText={(v) => updateChoice(idx, v)}
                                                        editable={manualQType !== "true_false"}
                                                    />

                                                    {manualQType === "multiple_choice" && manualChoices.length > 2 && (
                                                        <TouchableOpacity
                                                            onPress={() => removeChoice(idx)}
                                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                            style={styles.choiceDeleteBtn}
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
                                                onPress={addChoice}
                                            >
                                                <Ionicons name="add" size={16} color={accentColor} />
                                                <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>Add Choice</Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}

                                {/* Word Box / Word Bank choices */}
                                {manualQType === "word_box" && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>Word Bank choices</Text>
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
                                                        <Ionicons name="close" size={18} color="#94A3B8" />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        ))}
                                        {manualChoices.length < 8 && (
                                            <TouchableOpacity
                                                style={[styles.addQAddChoiceBtn, { borderColor: border }]}
                                                onPress={addChoice}
                                            >
                                                <Ionicons name="add" size={16} color={accentColor} />
                                                <Text style={[styles.addQAddChoiceText, { color: accentColor }]}>Add Word</Text>
                                            </TouchableOpacity>
                                        )}

                                        <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155", marginTop: 12 }]}>
                                            Correct answer <Text style={styles.required}>*</Text>
                                        </Text>
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
                                )}

                                {/* Enumeration: how many items */}
                                {manualQType === "enumeration" && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>Number of items to enumerate</Text>
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

                                {/* Correct Answer for Identification, Fill Blank, Enumeration */}
                                {(manualQType === "identification" || manualQType === "fill_blank" || manualQType === "enumeration") && (
                                    <>
                                        <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                                            Correct answer <Text style={styles.required}>*</Text>
                                        </Text>
                                        <TextInput
                                            style={[styles.addQAnswerInput, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                                            placeholder={manualQType === "enumeration"
                                                ? "e.g. Carbon dioxide, Methane, Water vapor"
                                                : "Enter the correct answer..."}
                                            placeholderTextColor={textSub}
                                            value={manualCorrectAnswer}
                                            onChangeText={setManualCorrectAnswer}
                                        />
                                    </>
                                )}

                                {/* Points */}
                                <Text style={[styles.addQLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>Points</Text>
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
                            </ScrollView>

                            {/* Sticky Bottom Footer */}
                            <View style={[styles.addQStickyFooter, { borderTopColor: border }]}>
                                <TouchableOpacity
                                    style={[styles.addQSubmitBtn, { backgroundColor: accentColor }]}
                                    onPress={handleAddManualQuestion}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="add" size={18} color="#FFFFFF" />
                                    <Text style={styles.addQSubmitText}>Add to Assessment</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>

            {/* ── Adjust Assessment Setup Modal Sheet (In Preview) ── */}
            <Modal
                visible={adjustSetupModalOpen}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    if (!generatingMore) setAdjustSetupModalOpen(false);
                }}
            >
                <TouchableOpacity
                    style={styles.adjustOverlay}
                    activeOpacity={1}
                    onPress={() => {
                        if (!generatingMore) setAdjustSetupModalOpen(false);
                    }}
                >
                    <Pressable
                        style={[styles.adjustSheet, { backgroundColor: cardBg }]}
                        onPress={(e) => e.stopPropagation?.()}
                    >
                        <View style={styles.dragPill} />
                        <View style={styles.adjustHeader}>
                            <View style={[styles.adjustHeaderIcon, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                                <Ionicons name="options-outline" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.adjustTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                                    Adjust Assessment Setup
                                </Text>
                                <Text style={[styles.adjustSub, { color: darkMode ? textSub : "#64748B" }]}>
                                    Change question count or types without starting over or wasting daily AI quota.
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    if (!generatingMore) setAdjustSetupModalOpen(false);
                                }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close" size={22} color={darkMode ? textSub : "#64748B"} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 16 }}>
                            {/* Question Count Section */}
                            <Text style={[styles.adjustSectionLabel, { color: darkMode ? textSub : "#475569" }]}>
                                QUESTION COUNT
                            </Text>
                            <View style={styles.countChipsRow}>
                                {[5, 10, 15, 20, 25, 30, 40, 50].map((num) => {
                                    const isSelected = adjustTargetCount === num;
                                    return (
                                        <TouchableOpacity
                                            key={num}
                                            style={[
                                                styles.countChip,
                                                {
                                                    backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                                    borderColor: darkMode ? "#334155" : "#E2E8F0",
                                                },
                                                isSelected && {
                                                    backgroundColor: "#0F172A",
                                                    borderColor: "#0F172A",
                                                },
                                            ]}
                                            onPress={() => setAdjustTargetCount(num)}
                                        >
                                            <Text
                                                style={[
                                                    styles.countChipText,
                                                    { color: darkMode ? textMain : "#334155" },
                                                    isSelected && { color: "#FFFFFF", fontWeight: "700" },
                                                ]}
                                            >
                                                {num}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {/* Status and Action for Question Count */}
                            {(() => {
                                const currentCount = generatedAssessment?.questions.length || 0;
                                const diff = adjustTargetCount - currentCount;

                                if (diff < 0) {
                                    const trimCount = Math.abs(diff);
                                    return (
                                        <View style={[styles.adjustNoticeBox, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}>
                                            <Ionicons name="cut-outline" size={18} color="#D97706" style={{ marginTop: 2 }} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 13, fontWeight: "700", color: "#B45309" }}>
                                                    Reduce to {adjustTargetCount} Questions
                                                </Text>
                                                <Text style={{ fontSize: 12, color: "#92400E", marginTop: 2, lineHeight: 16 }}>
                                                    Trimming {trimCount} questions. Questions #{adjustTargetCount + 1} to #{currentCount} will be removed, keeping #{1} to #{adjustTargetCount}.
                                                </Text>
                                                <TouchableOpacity
                                                    style={styles.adjustTrimBtn}
                                                    onPress={() => handleApplyTrim(adjustTargetCount)}
                                                >
                                                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#FFFFFF" }}>
                                                        Trim to {adjustTargetCount} Questions (Instant - Zero Quota)
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    );
                                }

                                if (diff > 0) {
                                    return (
                                        <View style={[styles.adjustNoticeBox, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}>
                                            <Ionicons name="sparkles" size={18} color="#2563EB" style={{ marginTop: 2 }} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 13, fontWeight: "700", color: "#1D4ED8" }}>
                                                    Expand by +{diff} Questions
                                                </Text>
                                                <Text style={{ fontSize: 12, color: "#1E40AF", marginTop: 2, lineHeight: 16 }}>
                                                    Generate {diff} additional questions based on your reference materials without repeating existing questions.
                                                </Text>
                                                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                                                    <TouchableOpacity
                                                        style={[styles.adjustAddAiBtn, { opacity: generatingMore ? 0.7 : 1 }]}
                                                        onPress={() => handleGenerateMoreQuestions(diff)}
                                                        disabled={generatingMore}
                                                    >
                                                        {generatingMore ? (
                                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                                        ) : (
                                                            <>
                                                                <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                                                                <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>
                                                                    Generate +{diff} Questions
                                                                </Text>
                                                            </>
                                                        )}
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={styles.adjustAddManualBtn}
                                                        onPress={() => {
                                                            setAdjustSetupModalOpen(false);
                                                            openAddQuestionModal();
                                                        }}
                                                    >
                                                        <Text style={{ fontSize: 12, fontWeight: "600", color: "#334155" }}>
                                                            Add Manually
                                                        </Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        </View>
                                    );
                                }

                                return (
                                    <View style={[styles.adjustNoticeBox, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
                                        <Ionicons name="checkmark-circle-outline" size={18} color="#16A34A" />
                                        <Text style={{ fontSize: 12.5, color: "#15803D", fontWeight: "600", flex: 1 }}>
                                            Current quiz has {currentCount} questions.
                                        </Text>
                                    </View>
                                );
                            })()}

                            {/* Assessment Format Selection */}
                            <Text style={[styles.adjustSectionLabel, { color: darkMode ? textSub : "#475569", marginTop: 16 }]}>
                                Assessment format
                            </Text>
                            <Dropdown
                                label="Question type"
                                value={adjustTargetType}
                                options={QUESTION_TYPES}
                                onSelect={setAdjustTargetType}
                                accentColor={accentColor}
                            />
                            {adjustTargetType === "Mixed Assessment" && (
                                <View style={{ marginTop: 10 }}>
                                    {renderUnifiedMixedPicker(true)}
                                </View>
                            )}
                            <Text style={{ fontSize: 11.5, color: textSub, marginTop: 4, lineHeight: 16 }}>
                                Individual question types can also be changed directly on each question card below.
                            </Text>

                            {/* Difficulty Level */}
                            <Text style={[styles.adjustSectionLabel, { color: darkMode ? textSub : "#475569", marginTop: 14 }]}>
                                DIFFICULTY LEVEL
                            </Text>
                            <Dropdown
                                label="Difficulty level"
                                value={adjustTargetDifficulty}
                                options={BLOOM_DIFFICULTIES}
                                onSelect={setAdjustTargetDifficulty}
                                accentColor={accentColor}
                            />

                            {/* Grade Level */}
                            <Text style={[styles.adjustSectionLabel, { color: darkMode ? textSub : "#475569", marginTop: 14 }]}>
                                GRADE LEVEL
                            </Text>
                            <Dropdown
                                label="Grade level"
                                value={adjustTargetGradeLevel}
                                options={GRADE_LEVELS}
                                onSelect={setAdjustTargetGradeLevel}
                                accentColor={accentColor}
                            />

                            {/* Save Settings Button */}
                            <TouchableOpacity
                                style={styles.adjustSaveBtn}
                                onPress={handleSaveSetupSettings}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="checkmark-outline" size={18} color="#FFFFFF" />
                                <Text style={styles.adjustSaveBtnText}>Save Setup Changes</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </Pressable>
                </TouchableOpacity>
            </Modal>

            {/* ── Change Question Type Modal Sheet (In Preview) ── */}
            <Modal
                visible={changeTypeModalOpen && selectedQForTypeChange !== null}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    if (regeneratingQNum === null) {
                        setChangeTypeModalOpen(false);
                        setSelectedQForTypeChange(null);
                    }
                }}
            >
                <TouchableOpacity
                    style={styles.adjustOverlay}
                    activeOpacity={1}
                    onPress={() => {
                        if (regeneratingQNum === null) {
                            setChangeTypeModalOpen(false);
                            setSelectedQForTypeChange(null);
                        }
                    }}
                >
                    <Pressable
                        style={[styles.adjustSheet, { backgroundColor: cardBg }]}
                        onPress={(e) => e.stopPropagation?.()}
                    >
                        <View style={styles.dragPill} />
                        <View style={styles.adjustHeader}>
                            <View style={[styles.adjustHeaderIcon, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                                <Ionicons name="swap-horizontal" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.adjustTitle, { color: darkMode ? textMain : "#0F172A" }]}>
                                    Change Question #{selectedQForTypeChange?.questionNumber} Type
                                </Text>
                                <Text style={[styles.adjustSub, { color: darkMode ? textSub : "#64748B" }]}>
                                    Current: {selectedQForTypeChange ? formatTypeLabel(selectedQForTypeChange.type) : ""}
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

                        {/* Scrollable Compact Options List */}
                        <ScrollView
                            style={{ maxHeight: 330 }}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingVertical: 4 }}
                        >
                            <View style={styles.typeOptionsList}>
                                {([
                                    { key: "multiple_choice" as QuestionType, label: "Multiple Choice", desc: "4 options (A, B, C, D) with 1 answer box", icon: "list" as const },
                                    { key: "true_false" as QuestionType, label: "True / False", desc: "Binary choices (A) True, B) False)", icon: "checkmark-done" as const },
                                    { key: "identification" as QuestionType, label: "Identification", desc: "Short concept/term (1–3 words, max 25 chars)", icon: "text" as const },
                                    { key: "fill_blank" as QuestionType, label: "Fill in the Blank", desc: "Sentence with blank to fill in (1–3 words)", icon: "pencil" as const },
                                    { key: "enumeration" as QuestionType, label: "Enumeration", desc: "List 2–4 sequential items across boxes", icon: "reorder-three" as const },
                                    { key: "word_box" as QuestionType, label: "Word Box", desc: "Fill in blank using a randomized word bank", icon: "grid" as const },
                                ]).map((opt) => {
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
                                                    borderColor: "#0F172A",
                                                    backgroundColor: darkMode ? "#334155" : "#F8FAFC",
                                                },
                                            ]}
                                            onPress={() => setSelectedNewType(opt.key)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={[styles.typeOptionIcon, isSelected && { backgroundColor: "#0F172A" }]}>
                                                <Ionicons name={opt.icon} size={15} color={isSelected ? "#FFFFFF" : textSub} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.typeOptionTitle, { color: darkMode ? textMain : "#0F172A" }, isSelected && { fontWeight: "700" }]}>
                                                    {opt.label}
                                                </Text>
                                                <Text style={[styles.typeOptionDesc, { color: darkMode ? textSub : "#64748B" }]} numberOfLines={1}>
                                                    {opt.desc}
                                                </Text>
                                            </View>
                                            <Ionicons
                                                name={isSelected ? "radio-button-on" : "radio-button-off"}
                                                size={18}
                                                color={isSelected ? "#0F172A" : textSub}
                                            />
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </ScrollView>

                        {/* Sticky Action Footer */}
                        <View style={[styles.typeModalFooter, { borderTopColor: darkMode ? "#374151" : "#E2E8F0", paddingBottom: insets.bottom + 16 }]}>
                            <TouchableOpacity
                                style={styles.typeRegenAiBtn}
                                onPress={() => {
                                    if (!selectedQForTypeChange) return;
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
                                style={[styles.typeConvertManualBtn, { borderColor: darkMode ? "#334155" : "#CBD5E1", backgroundColor: darkMode ? cardBg : "#FFFFFF" }]}
                                onPress={() => {
                                    if (!selectedQForTypeChange) return;
                                    handleManualConvertType(selectedQForTypeChange.questionNumber, selectedNewType);
                                }}
                                activeOpacity={0.75}
                            >
                                <Ionicons name="pencil-outline" size={15} color={darkMode ? textMain : "#0F172A"} />
                                <Text style={[styles.typeConvertManualBtnText, { color: darkMode ? textMain : "#0F172A" }]}>
                                    Convert Manually (Edit Text Yourself)
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </TouchableOpacity>
            </Modal>
        </ScrollView>

        {/* Non-blocking Draft Toast */}
        {toastMessage && (
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.draftToast,
                    {
                        opacity: toastFadeAnim,
                        transform: [{
                            translateY: toastFadeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [12, 0],
                            }),
                        }],
                    },
                ]}
            >
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={styles.draftToastText}>{toastMessage}</Text>
            </Animated.View>
        )}
    </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },

    /* Header */
    headerRow: {
        flexDirection: "row", alignItems: "center", gap: 10,
        marginBottom: 16,
    },
    headerIconBg: {
        width: 34, height: 34, borderRadius: 10,
        alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
    headerSub: { fontSize: 12, color: "#64748B", marginTop: 2 },

    /* Fields */
    fieldLabel: {
        fontSize: 13, fontWeight: "500", color: "#334155",
        letterSpacing: 0, marginBottom: 6, marginTop: 14,
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
        height: 48, borderRadius: 12, marginTop: 20,
    },
    generateBtnText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },

    /* Info note */
    infoNote: {
        flexDirection: "row", alignItems: "center", gap: 6,
        marginTop: 14, paddingHorizontal: 4,
    },
    infoText: { fontSize: 11, color: "#9CA3AF", flex: 1 },

    /* Preview Screen Banner */
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
        marginBottom: 10,
    },
    previewModeBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    previewModeBadgeText: {
        fontSize: 12,
        fontWeight: "500",
    },
    previewAdjustBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
    },
    previewAdjustBtnText: {
        fontSize: 12,
        fontWeight: "600",
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
        fontSize: 12,
        fontWeight: "600",
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

    /* Regenerate single question */
    regenerateGhostPill: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    regenerateGhostPillText: {
        fontSize: 12,
        fontWeight: "600",
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
    regenerateIconBtn: {
        width: 28,
        height: 28,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },

    /* Results */
    resultsBanner: {
        flexDirection: "row", alignItems: "center",
        borderRadius: 14, padding: 14, marginBottom: 20,
        borderWidth: 1,
    },
    resultsBannerTitle: { fontSize: 15, fontWeight: "700" },
    resultsBannerSub: { fontSize: 11, color: "#6B7280", marginTop: 2 },

    /* Section Headers */
    sectionHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 18,
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

    /* Shared Word Bank Card */
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

    questionCard: {
        backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16,
        marginBottom: 12, borderWidth: 1, borderColor: "#E2E8F0",
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
    typeSelectorChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        maxWidth: 130,
    },
    typeSelectorChipText: {
        fontSize: 11.5,
        fontWeight: "600",
    },
    questionHeaderToolbar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
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
    questionNumberText: { fontSize: 12, fontWeight: "700" },
    questionPointsLabel: { fontSize: 12, fontWeight: "500" },
    questionText: {
        width: "100%",
        fontSize: 15,
        color: "#0F172A",
        lineHeight: 22,
        fontWeight: "600",
        marginBottom: 12,
    },

    choicesWrap: { marginTop: 0 },
    choiceItem: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#E2E8F0",
        backgroundColor: "#FFFFFF",
    },
    choiceText: { fontSize: 14, lineHeight: 20, color: "#334155", flex: 1 },

    answerWrap: {
        borderLeftWidth: 3, paddingLeft: 12, marginTop: 4,
    },
    answerLabel: { fontSize: 11, color: "#64748B", fontWeight: "600", marginBottom: 2 },
    answerText: { fontSize: 14, fontWeight: "600" },

    /* Result actions */
    publishBtn: {
        width: "100%",
        height: 46,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginTop: 4,
        marginBottom: 10,
    },
    publishText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
    resultActions: { flexDirection: "row", gap: 10, marginBottom: 8 },
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
    secondaryFooterBtnText: { fontSize: 14, fontWeight: "500" },

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
        paddingHorizontal: 24,
        zIndex: 9999,
    },
    loadingCard: {
        width: "100%",
        maxWidth: 344,
        backgroundColor: "#FFFFFF",
        borderRadius: 22,
        padding: 22,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#E2E8F0",
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.14,
        shadowRadius: 22,
        elevation: 14,
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

    /* ── Add Question Button ── */
    addQuestionBtn: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderStyle: "dashed",
        borderRadius: 12,
        padding: 14,
        gap: 12,
        marginBottom: 14,
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

    /* Adjust Setup Modal & Change Type Modal */
    adjustOverlay: {
        flex: 1,
        backgroundColor: "rgba(15, 23, 42, 0.55)",
        justifyContent: "flex-end",
    },
    adjustSheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 32,
        maxHeight: "88%",
    },
    dragPill: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#CBD5E1",
        alignSelf: "center",
        marginBottom: 12,
    },
    adjustHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
    },
    adjustHeaderIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    adjustTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    adjustSub: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: 2,
    },
    adjustSectionLabel: {
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    countChipsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 12,
    },
    countChip: {
        minWidth: 44,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    countChipText: {
        fontSize: 13,
        fontWeight: "600",
    },
    adjustNoticeBox: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 8,
    },
    adjustTrimBtn: {
        marginTop: 8,
        backgroundColor: "#D97706",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: "center",
    },
    adjustAddAiBtn: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: "#2563EB",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    adjustAddManualBtn: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#CBD5E1",
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
    },
    adjustSaveBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 46,
        borderRadius: 10,
        backgroundColor: "#0F172A",
        marginTop: 20,
    },
    adjustSaveBtnText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "600",
    },
    typeOptionsList: {
        gap: 8,
        marginTop: 4,
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
        backgroundColor: "#F1F5F9",
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

    /* Unified Mixed Assessment Picker */
    unifiedMixedCard: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        marginTop: 6,
        marginBottom: 10,
    },
    unifiedMixedHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    unifiedMixedTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    unifiedMixedSub: {
        fontSize: 12,
        marginTop: 2,
    },
    unifiedSummaryPill: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    unifiedSummaryPillText: {
        fontSize: 12,
        fontWeight: "600",
    },
    unifiedRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 6,
    },
    unifiedRowLeft: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
        marginRight: 8,
    },
    unifiedRomanBadge: {
        width: 22,
        height: 22,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 8,
    },
    unifiedRomanBadgeText: {
        fontSize: 11,
        fontWeight: "800",
    },
    unifiedRowLabel: {
        fontSize: 13.5,
    },
    unifiedStepper: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    unifiedStepBtn: {
        width: 28,
        height: 28,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    unifiedStepCount: {
        fontSize: 14,
        fontWeight: "700",
        minWidth: 24,
        textAlign: "center",
    },

    /* Sheet Chrome & Controls */
    sheetDragHandle: {
        width: 36,
        height: 4,
        borderRadius: 999,
        backgroundColor: "#CBD5E1",
        alignSelf: "center",
        marginBottom: 12,
    },
    sheetCloseBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
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
    choiceDeleteBtn: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    addQStickyFooter: {
        paddingTop: 12,
        borderTopWidth: 1,
        width: "100%",
    },
    segmentedTrack: {
        flexDirection: "row",
        borderRadius: 8,
        padding: 3,
        gap: 2,
    },
    segmentBtn: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 6,
    },
    segmentBtnActive: {
        borderWidth: 1,
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    segmentBtnText: {
        fontSize: 12.5,
    },
    neutralOptionIcon: {
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    dimBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
    },
    dimBadgeText: {
        fontSize: 11.5,
        fontWeight: "600",
    },
    draftToast: {
        position: "absolute",
        bottom: 30,
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
});
