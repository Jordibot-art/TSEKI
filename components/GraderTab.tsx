import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState, useMemo, useRef } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { saveRosterAlert } from "../lib/alertStore";
import { gradeStudentTest, GradingResponse, GradingResultItem } from "../lib/gradingService";
import { LowConfidenceReviewModal } from "./LowConfidenceReviewModal";
import { saveStudentQuizResult } from "../lib/questionAnalysis";
import { getPublishedQuizzes, saveQuizPerformanceRecord, StoredQuiz } from "../lib/quizStore";
import { normalizeStudentRecord, splitStudentFullName } from "../lib/classListParserService";
import { supabase } from "../supabase";
import { BatchScannerModal } from "./BatchScannerModal";
import { BatchReviewDashboard } from "./BatchReviewDashboard";
import { BatchGradingQueue, BatchSheetItem } from "../lib/batchGradingQueue";

// ── Types ─────────────────────────────────────────────────────────────────────
export type Student = {
    id: string;
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
    full_name: string;
    email: string | null;
    average: number;
    attendance?: number;
};

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({
    label, value, options, onSelect, accentColor, placeholder,
}: {
    label: string; value: string; options: string[];
    onSelect: (v: string) => void; accentColor: string;
    placeholder?: string;
}) {
    const { darkMode } = useTheme();
    const [open, setOpen] = useState(false);
    const hasValue = Boolean(value && value.trim().length > 0);
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const textMain = darkMode ? "#F9FAFB" : "#374151";

    return (
        <View style={styles.dropdownContainer}>
            <TouchableOpacity
                style={[
                    styles.dropdownBtn,
                    {
                        backgroundColor: darkMode ? "#374151" : "#FFFFFF",
                        borderColor: darkMode ? "#4B5563" : "#E5E7EB",
                    },
                ]}
                onPress={() => setOpen(true)}
                activeOpacity={0.7}
            >
                <Text style={[styles.dropdownValue, { color: hasValue ? textMain : textSub }]}>
                    {hasValue ? value : (placeholder || "Select option")}
                </Text>
                <Ionicons name="chevron-down" size={16} color={textSub} />
            </TouchableOpacity>

            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <TouchableOpacity style={styles.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
                    <View style={[styles.ddSheet, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF" }]}>
                        <Text style={[styles.ddTitle, { color: accentColor }]}>{label}</Text>
                        {options.length === 0 ? (
                            <View style={{ paddingVertical: 24, alignItems: "center" }}>
                                <Ionicons name="document-text-outline" size={32} color={textSub} style={{ marginBottom: 8 }} />
                                <Text style={{ color: textMain, fontSize: 15, fontWeight: "700", textAlign: "center" }}>
                                    No Quizzes Created Yet
                                </Text>
                                <Text style={{ color: textSub, fontSize: 12.5, textAlign: "center", marginTop: 4, paddingHorizontal: 16, lineHeight: 18 }}>
                                    Create and publish a quiz in the AI Builder tab to grade against it.
                                </Text>
                            </View>
                        ) : (
                            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                                {options.map((opt) => (
                                    <TouchableOpacity
                                        key={opt}
                                        style={[
                                            styles.ddItem,
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
                        )}
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
type Props = {
    classroomId: string;
    classTitle: string;
    accentColor: string;
    students?: Student[];
    defaultSelectedQuiz?: string;
    onScoreRecorded?: (studentId: string, average: number) => void;
    onStudentCreated?: (newStudent: Student) => void;
};

export default function GraderTab({
    classroomId,
    classTitle,
    accentColor = "#F97316",
    students = [],
    defaultSelectedQuiz,
    onScoreRecorded,
    onStudentCreated,
}: Props) {
    // 1. Grade against quiz
    const [publishedQuizzes, setPublishedQuizzes] = useState<StoredQuiz[]>([]);
    const [selectedQuiz, setSelectedQuiz] = useState(defaultSelectedQuiz || "");

    // 2. Identify student sheet (functional with real database students)
    const [roster, setRoster] = useState<Student[]>(students);
    const [selectedStudent, setSelectedStudent] = useState("");

    // ── Grading & Flow States ──────────────────────────────────────────────────
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [gradingLoading, setGradingLoading] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResponse | null>(null);
    const [scannedImageUri, setScannedImageUri] = useState<string | null>(null);
    const [reviewModalOpen, setReviewModalOpen] = useState(false);
    const [reviewInitialQNum, setReviewInitialQNum] = useState<number | undefined>(undefined);
    const [savingScore, setSavingScore] = useState(false);
    const [isRecorded, setIsRecorded] = useState(false);

    // ── Batch Scanning States ──────────────────────────────────────────────────
    const [gradingMode, setGradingMode] = useState<"single" | "batch">("single");
    const [batchScannerOpen, setBatchScannerOpen] = useState(false);
    const [scannerMode, setScannerMode] = useState<"single" | "batch">("single");
    const [batchReviewOpen, setBatchReviewOpen] = useState(false);
    const [batchItems, setBatchItems] = useState<BatchSheetItem[]>([]);
    const batchQueueRef = useRef<BatchGradingQueue | null>(null);

    const { darkMode } = useTheme();

    const bg = darkMode ? "#111827" : "#F9FAFB";
    const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
    const textMain = darkMode ? "#F9FAFB" : "#1F2937";
    const textSub = darkMode ? "#9CA3AF" : "#6B7280";
    const border = darkMode ? "#374151" : "#E5E7EB";
    const subBorder = darkMode ? "#374151" : "#F3F4F6";

    useEffect(() => {
        if (students !== undefined) {
            setRoster(students);
        } else if (classroomId) {
            supabase
                .from("students")
                .select("*")
                .eq("classroom_id", classroomId)
                .order("created_at", { ascending: true })
                .then(({ data }) => {
                    if (data) setRoster(data as Student[]);
                });
        }
    }, [classroomId, students]);

    useEffect(() => {
        loadPublished();
    }, [classroomId, defaultSelectedQuiz]);

    async function loadPublished() {
        if (!classroomId) return;
        const stored = await getPublishedQuizzes(classroomId);
        setPublishedQuizzes(stored);
        if (defaultSelectedQuiz && stored.some((q) => q.quizTitle === defaultSelectedQuiz)) {
            setSelectedQuiz(defaultSelectedQuiz);
        } else if (stored.length > 0) {
            setSelectedQuiz(stored[0].quizTitle);
        } else {
            setSelectedQuiz("");
        }
    }

    const quizOptions = publishedQuizzes.map((q) => q.quizTitle);

    const currentQuizValue = selectedQuiz && quizOptions.includes(selectedQuiz)
        ? selectedQuiz
        : (quizOptions.length > 0 ? quizOptions[0] : "");

    const studentOptions = [
        "Auto-Detect from Test Paper",
        ...(roster.length > 0
            ? roster.map((s) => `${s.full_name}${s.email ? ` (${s.email})` : ""}`)
            : []),
    ];

    const currentStudentValue = selectedStudent || "Auto-Detect from Test Paper";

    // Count of items needing teacher review (unclear, double-shaded, low confidence)
    const flaggedCount = useMemo(() => {
        if (!gradingResult || !Array.isArray(gradingResult.results)) return 0;
        return gradingResult.results.filter(
            (r) =>
                (r.flaggedForReview ||
                    r.flagReason === "double_mark" ||
                    r.flagReason === "unclear" ||
                    r.flagReason === "low_confidence" ||
                    (r.confidence !== undefined && r.confidence < 0.75)) &&
                !r.isOverridden
        ).length;
    }, [gradingResult]);

    // ── Helper to optimize captured test paper for AI Vision ───────────────────
    async function prepareImageForGrading(asset: { uri: string; base64?: string | null }): Promise<{ base64: string; mimeType: "image/jpeg" }> {
        try {
            const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
            // Resize to max 1280px width (preserves legibility while shrinking payload ~50x)
            const manip = await manipulateAsync(
                asset.uri,
                [{ resize: { width: 1280 } }],
                { compress: 0.72, format: SaveFormat.JPEG, base64: true }
            );
            if (manip.base64) {
                return { base64: manip.base64, mimeType: "image/jpeg" };
            }
        } catch (e) {
            console.warn("[Grader] Image resize fallback:", e);
        }
        return {
            base64: asset.base64 || "",
            mimeType: "image/jpeg",
        };
    }

    // ── Open Camera (Single Paper with Photo Guidance) ─────────────────────────
    async function handleOpenCamera() {
        setSourceModalOpen(false);
        const activeQuizTitle = selectedQuiz || currentQuizValue;
        const published = publishedQuizzes.find((q) => q.quizTitle === activeQuizTitle || q.quizTitle === selectedQuiz);
        if (!published && publishedQuizzes.length === 0) {
            Alert.alert(
                "No Quizzes Available",
                "You haven't created any quizzes for this classroom yet. Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!"
            );
            return;
        }
        setScannerMode("single");
        setBatchScannerOpen(true);
    }

    // Single sheet capture callback from Camera Grader
    async function handleCaptureSingleSheet(uri: string) {
        try {
            setScannedImageUri(uri);
            const optimized = await prepareImageForGrading({ uri });
            if (optimized.base64) {
                processGrading(optimized.base64, optimized.mimeType);
            } else {
                Alert.alert("Image Error", "Could not read camera capture data.");
            }
        } catch (err: any) {
            Alert.alert("Grading Error", err.message || "Failed to process captured test sheet.");
        }
    }

    // ── Choose from Library ────────────────────────────────────────────────────
    async function handlePickImage() {
        setSourceModalOpen(false);
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") {
                Alert.alert("Permission Required", "Photo library permission is required to select test papers.");
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.8,
                base64: true,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                setScannedImageUri(asset.uri);
                const optimized = await prepareImageForGrading(asset);
                if (optimized.base64) {
                    processGrading(optimized.base64, optimized.mimeType);
                } else {
                    Alert.alert("Image Error", "Could not read photo data.");
                }
            }
        } catch (err: any) {
            Alert.alert("Picker Error", err.message || "Failed to select photo.");
        }
    }



    // ── Run AI Grading ─────────────────────────────────────────────────────────
    async function processGrading(base64Data: string, mimeType: "image/jpeg" | "image/png") {
        setGradingLoading(true);
        setIsRecorded(false);
        try {
            const activeQuizTitle = selectedQuiz || currentQuizValue;
            const published = publishedQuizzes.find((q) => q.quizTitle === activeQuizTitle || q.quizTitle === selectedQuiz);
            if (!published) {
                Alert.alert("No Quiz Selected", "Please select or create a quiz in the AI Builder tab first.");
                return;
            }
            const activeAnswerKey = published.answerKey;

            const result = await gradeStudentTest(base64Data, activeAnswerKey, mimeType, published.layoutJson);
            setGradingResult(result);

            // Match student if detected name matches a student in classroom roster
            if (result.studentName && roster.length > 0) {
                const match = roster.find(
                    (s) =>
                        s.full_name.toLowerCase().includes(result.studentName.toLowerCase()) ||
                        result.studentName.toLowerCase().includes(s.full_name.toLowerCase())
                );
                if (match) {
                    setSelectedStudent(`${match.full_name}${match.email ? ` (${match.email})` : ""}`);
                }
            }

            // Alert teacher if any of the 5 photo quality conditions failed on this paper
            if (result.photoQuality?.hasWarnings && result.photoQuality.warnings.length > 0) {
                Alert.alert(
                    "⚠️ Photo Scan Quality Alert",
                    "Tseki detected the following issues with the captured photo:\n\n" +
                        result.photoQuality.warnings.map((w) => `• ${w}`).join("\n\n"),
                    [
                        {
                            text: "Retake Photo",
                            onPress: () => handleOpenCamera(),
                        },
                        {
                            text: "Review Anyway",
                            style: "cancel",
                        },
                    ]
                );
            }

            // Keep user on the Scanned Student Sheet view first; teacher can tap "Review" on the alert banner when ready
        } catch (error: any) {
            console.error("Grading failed:", error);
            Alert.alert(
                "Grading Failed",
                error.message || "Could not analyze the paper. Please ensure the answers and student name are legible."
            );
        } finally {
            setGradingLoading(false);
        }
    }

    // ── Interactive Question Toggle (Teacher can override/adjust) ──────────────
    function handleToggleQuestion(qNum: number) {
        if (!gradingResult) return;
        const updated = gradingResult.results.map((item) => {
            if (item.questionNumber === qNum) {
                const nextCorrect = !item.isCorrect;
                return {
                    ...item,
                    isCorrect: nextCorrect,
                    pointsAwarded: nextCorrect ? 1 : 0,
                };
            }
            return item;
        });
        const newTotal = updated.reduce((sum, item) => sum + (item.pointsAwarded || 0), 0);
        setGradingResult({
            ...gradingResult,
            totalScore: newTotal,
            results: updated,
        });
        if (isRecorded) {
            setIsRecorded(false);
        }
    }

    // ── Approve & Record to Classroom Record ───────────────────────────────────
    async function handleApproveAndRecord() {
        if (!gradingResult) return;
        setSavingScore(true);
        try {
            const percentage = Math.round((gradingResult.totalScore / (gradingResult.maxScore || 1)) * 100);

            // Find matching student in roster
            let student = roster.find(
                (s) =>
                    (selectedStudent && selectedStudent.includes(s.full_name)) ||
                    (gradingResult.studentName && s.full_name.toLowerCase().includes(gradingResult.studentName.toLowerCase())) ||
                    (gradingResult.studentName && gradingResult.studentName.toLowerCase().includes(s.full_name.toLowerCase()))
            );

            if (student) {
                // Update existing student in Supabase
                const { error } = await supabase
                    .from("students")
                    .update({ average: percentage })
                    .eq("id", student.id);

                if (error) throw error;

                setRoster((prev) =>
                    prev.map((s) => (s.id === student!.id ? { ...s, average: percentage } : s))
                );
                onScoreRecorded?.(student.id, percentage);
            } else if (classroomId) {
                // Student not yet in roster, create new student record
                const newName = gradingResult.studentName && gradingResult.studentName !== "Unknown"
                    ? gradingResult.studentName
                    : `Student ${roster.length + 1}`;
                const parsedParts = splitStudentFullName(newName);
                const resolvedLastName = gradingResult.lastName?.trim() || parsedParts.last_name;
                const resolvedFirstName = gradingResult.firstName?.trim() || parsedParts.first_name;
                const resolvedMiddleName = (gradingResult.middleName ?? parsedParts.middle_name) || null;
                const formattedFullName = resolvedLastName && resolvedFirstName
                    ? `${resolvedLastName}, ${resolvedFirstName}${resolvedMiddleName ? ` ${resolvedMiddleName}` : ""}`
                    : newName;

                let { data, error } = await supabase
                    .from("students")
                    .insert({
                        classroom_id: classroomId,
                        last_name: resolvedLastName,
                        first_name: resolvedFirstName,
                        middle_name: resolvedMiddleName,
                        full_name: formattedFullName,
                        email: null,
                        attendance: 100,
                        average: percentage,
                    })
                    .select()
                    .single();

                if (error && (error.message?.includes("last_name") || error.message?.includes("first_name"))) {
                    const fallback = await supabase
                        .from("students")
                        .insert({
                            classroom_id: classroomId,
                            full_name: formattedFullName,
                            email: null,
                            attendance: 100,
                            average: percentage,
                        })
                        .select()
                        .single();
                    data = fallback.data;
                    error = fallback.error;
                }

                if (error) throw error;
                if (data) {
                    const newStudent = normalizeStudentRecord(data) as Student;
                    student = newStudent;
                    setRoster((prev) => [...prev, newStudent]);
                    onStudentCreated?.(newStudent);
                    onScoreRecorded?.(newStudent.id, percentage);
                }
            }

            // Record to quiz performance history for tracker trend
            const quizTitleToRecord = selectedQuiz || "Assessment 1";
            if (classroomId) {
                await saveQuizPerformanceRecord(classroomId, quizTitleToRecord, percentage);

                // Persist per-question results for pedagogical analysis
                const resolvedStudentId = student ? student.id : (gradingResult.studentName || "student");
                const resolvedStudentName = student ? student.full_name : (gradingResult.studentName && gradingResult.studentName !== "Unknown" ? gradingResult.studentName : "Student");
                const activePublished = publishedQuizzes.find((q) => q.quizTitle === quizTitleToRecord);
                await saveStudentQuizResult({
                    studentId: resolvedStudentId,
                    studentName: resolvedStudentName,
                    classroomId,
                    quizTitle: quizTitleToRecord,
                    scorePercentage: percentage,
                    totalScore: gradingResult.totalScore,
                    maxScore: gradingResult.maxScore,
                    results: gradingResult.results.map((r) => {
                        const matchedQuestion = activePublished?.questions?.find(
                            (q) => q.questionNumber === r.questionNumber
                        );
                        return {
                            questionNumber: r.questionNumber,
                            questionText: matchedQuestion?.questionText,
                            questionType: matchedQuestion?.type,
                            studentAnswer: r.studentAnswer,
                            correctAnswer: r.correctAnswer,
                            isCorrect: r.isCorrect,
                            pointsAwarded: r.pointsAwarded,
                        };
                    }),
                    gradedAt: new Date().toISOString(),
                });

                // If student score is 50% or below, trigger system at-risk notification alert
                if (percentage <= 50) {
                    const studentName = student ? student.full_name : (gradingResult.studentName && gradingResult.studentName !== "Unknown" ? gradingResult.studentName : "Student");
                    const studentId = student ? student.id : (gradingResult.studentName || "student");
                    await saveRosterAlert({
                        studentId,
                        studentName,
                        classroomId,
                        classroomTitle: classTitle || "Classroom",
                        classroomSchedule: "",
                        classroomRoom: "",
                        classroomColor: accentColor || "#3B82F6",
                        scorePercentage: percentage,
                        quizTitle: quizTitleToRecord,
                        alertType: percentage <= 40 ? "HIGH RISK" : "URGENT REVIEW",
                        message: `${studentName} has dropped to an average of ${percentage}%. Performance Flagged: At-Risk.`,
                    });
                }
            }

            // Successfully recorded!
            setIsRecorded(true);
        } catch (err: any) {
            console.error("Error saving score:", err);
            Alert.alert("Error Saving Score", err.message || "Failed to update student database record.");
        } finally {
            setSavingScore(false);
        }
    }

    // ── Batch Queue Management ────────────────────────────────────────────────
    const getOrCreateBatchQueue = () => {
        const activeQuizTitle = selectedQuiz || currentQuizValue;
        const published = publishedQuizzes.find((q) => q.quizTitle === activeQuizTitle || q.quizTitle === selectedQuiz);
        const activeAnswerKey = published?.answerKey || [];

        if (!batchQueueRef.current) {
            batchQueueRef.current = new BatchGradingQueue({
                answerKey: activeAnswerKey,
                layoutJson: published?.layoutJson,
                roster: roster.map((s) => ({
                    id: s.id,
                    full_name: s.full_name,
                    email: s.email,
                    average: s.average,
                })),
                onProgress: (updatedItems) => {
                    setBatchItems([...updatedItems]);
                },
                concurrency: 1,
            });
        } else {
            batchQueueRef.current.updateOptions({
                answerKey: activeAnswerKey,
                layoutJson: published?.layoutJson,
                roster: roster.map((s) => ({
                    id: s.id,
                    full_name: s.full_name,
                    email: s.email,
                    average: s.average,
                })),
            });
        }
        return batchQueueRef.current;
    };

    const handleStartBatchScanner = () => {
        if (publishedQuizzes.length === 0) {
            Alert.alert(
                "No Quizzes Available",
                "Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!"
            );
            return;
        }
        getOrCreateBatchQueue();
        setScannerMode("batch");
        setBatchScannerOpen(true);
    };

    const handleBatchCaptureSheet = (uri: string) => {
        const q = getOrCreateBatchQueue();
        q.enqueueImages([uri]);
    };

    const handleBatchImportSheets = (uris: string[]) => {
        const q = getOrCreateBatchQueue();
        q.enqueueImages(uris);
    };

    const handleFinishAndReview = () => {
        setBatchScannerOpen(false);
        setBatchReviewOpen(true);

        const itemsWithWarnings = batchItems.filter(
            (i) => i.photoQuality?.hasWarnings && i.photoQuality.warnings.length > 0
        );
        if (itemsWithWarnings.length > 0) {
            const summaryLines = itemsWithWarnings.slice(0, 4).map((item, idx) => {
                const name = item.matchedStudentName || item.studentNameExtracted || `Sheet #${idx + 1}`;
                return `• ${name}: ${item.photoQuality!.warnings.join(" ")}`;
            });
            if (itemsWithWarnings.length > 4) {
                summaryLines.push(`...and ${itemsWithWarnings.length - 4} more sheet(s).`);
            }
            Alert.alert(
                "⚠️ Batch Scan Photo Quality Alert",
                `${itemsWithWarnings.length} scanned paper${itemsWithWarnings.length > 1 ? "s have" : " has"} lighting, QR code, 4 corner markers, or paper edge/flatness warnings:\n\n` +
                    summaryLines.join("\n\n") +
                    "\n\nPlease inspect flagged sheets in the Batch Review Dashboard.",
                [{ text: "Review Sheets" }]
            );
        }
    };

    const handleScanMoreInBatch = () => {
        setBatchReviewOpen(false);
        setScannerMode("batch");
        setBatchScannerOpen(true);
    };

    const handleUpdateBatchItem = (id: string, updates: Partial<BatchSheetItem>) => {
        const q = getOrCreateBatchQueue();
        q.updateItem(id, updates);
    };

    const handleRemoveBatchItem = (id: string) => {
        const q = getOrCreateBatchQueue();
        q.removeItem(id);
    };

    const handleCommitBatch = async (approvedItems: BatchSheetItem[]) => {
        if (approvedItems.length === 0) return;
        const activeQuizTitle = selectedQuiz || currentQuizValue || "Assessment";
        const published = publishedQuizzes.find((q) => q.quizTitle === activeQuizTitle || q.quizTitle === selectedQuiz);

        try {
            let updatedRoster = [...roster];

            for (const item of approvedItems) {
                if (!item.gradingResult) continue;

                const percentage = Math.round(
                    (item.gradingResult.totalScore / (item.gradingResult.maxScore || 1)) * 100
                );

                let student = updatedRoster.find(
                    (s) =>
                        (item.matchedStudentId && s.id === item.matchedStudentId) ||
                        (item.matchedStudentName && s.full_name.toLowerCase() === item.matchedStudentName.toLowerCase()) ||
                        (item.studentNameExtracted && s.full_name.toLowerCase() === item.studentNameExtracted.toLowerCase())
                );

                if (student) {
                    await supabase
                        .from("students")
                        .update({ average: percentage })
                        .eq("id", student.id);

                    updatedRoster = updatedRoster.map((s) =>
                        s.id === student!.id ? { ...s, average: percentage } : s
                    );
                    onScoreRecorded?.(student.id, percentage);
                } else if (classroomId) {
                    const newName =
                        item.matchedStudentName ||
                        (item.studentNameExtracted && item.studentNameExtracted !== "Unknown"
                            ? item.studentNameExtracted
                            : `Student ${updatedRoster.length + 1}`);
                    const parsedParts = splitStudentFullName(newName);
                    const resolvedLastName = item.gradingResult.lastName?.trim() || parsedParts.last_name;
                    const resolvedFirstName = item.gradingResult.firstName?.trim() || parsedParts.first_name;
                    const resolvedMiddleName = (item.gradingResult.middleName ?? parsedParts.middle_name) || null;
                    const formattedFullName = resolvedLastName && resolvedFirstName
                        ? `${resolvedLastName}, ${resolvedFirstName}${resolvedMiddleName ? ` ${resolvedMiddleName}` : ""}`
                        : newName;

                    let { data, error } = await supabase
                        .from("students")
                        .insert({
                            classroom_id: classroomId,
                            last_name: resolvedLastName,
                            first_name: resolvedFirstName,
                            middle_name: resolvedMiddleName,
                            full_name: formattedFullName,
                            email: null,
                            attendance: 100,
                            average: percentage,
                        })
                        .select()
                        .single();

                    if (error && (error.message?.includes("last_name") || error.message?.includes("first_name"))) {
                        const fallback = await supabase
                            .from("students")
                            .insert({
                                classroom_id: classroomId,
                                full_name: formattedFullName,
                                email: null,
                                attendance: 100,
                                average: percentage,
                            })
                            .select()
                            .single();
                        data = fallback.data;
                    }

                    if (data) {
                        student = normalizeStudentRecord(data) as Student;
                        updatedRoster.push(student);
                        onStudentCreated?.(student);
                        onScoreRecorded?.(student.id, percentage);
                    }
                }

                // Record quiz trend and question analysis
                if (classroomId && student) {
                    await saveQuizPerformanceRecord(classroomId, activeQuizTitle, percentage);

                    await saveStudentQuizResult({
                        studentId: student.id,
                        studentName: student.full_name,
                        classroomId,
                        quizTitle: activeQuizTitle,
                        scorePercentage: percentage,
                        totalScore: item.gradingResult.totalScore,
                        maxScore: item.gradingResult.maxScore,
                        results: item.gradingResult.results.map((r) => {
                            const matchedQuestion = published?.questions?.find(
                                (q) => q.questionNumber === r.questionNumber
                            );
                            return {
                                questionNumber: r.questionNumber,
                                questionText: matchedQuestion?.questionText,
                                questionType: matchedQuestion?.type,
                                studentAnswer: r.studentAnswer,
                                correctAnswer: r.correctAnswer,
                                isCorrect: r.isCorrect,
                                pointsAwarded: r.pointsAwarded,
                            };
                        }),
                        gradedAt: new Date().toISOString(),
                    });

                    if (percentage <= 50) {
                        await saveRosterAlert({
                            studentId: student.id,
                            studentName: student.full_name,
                            classroomId,
                            classroomTitle: classTitle || "Classroom",
                            classroomSchedule: "",
                            classroomRoom: "",
                            classroomColor: accentColor || "#3B82F6",
                            scorePercentage: percentage,
                            quizTitle: activeQuizTitle,
                            alertType: percentage <= 40 ? "HIGH RISK" : "URGENT REVIEW",
                            message: `${student.full_name} has dropped to an average of ${percentage}%. Performance Flagged: At-Risk.`,
                        });
                    }
                }
            }

            setRoster(updatedRoster);
            setBatchReviewOpen(false);
            batchQueueRef.current?.clear();
            setBatchItems([]);

            Alert.alert(
                "Batch Grading Recorded!",
                `Successfully recorded grades for ${approvedItems.length} student(s) to ${classTitle || "the classroom"}.`,
                [{ text: "OK" }]
            );
        } catch (err: any) {
            console.error("Batch save error:", err);
            Alert.alert("Save Error", err.message || "Failed to commit batch records.");
        }
    };


    return (
        <ScrollView
            style={[styles.root, { backgroundColor: bg }]}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
        >
            {/* ───────────────────────────────────────────────────────────────────
                CASE 1: SCANNED RESULTS VIEW (Inline, exactly matches user's images)
            ────────────────────────────────────────────────────────────────────── */}
            {gradingResult ? (
                <View style={styles.resultsContainer}>
                    {/* ── Action Buttons Row ── */}
                    <View style={styles.actionButtonsRow}>
                        {/* Left: Scan Another Sheet */}
                        <TouchableOpacity
                            style={[styles.scanAnotherBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}
                            onPress={() => setSourceModalOpen(true)}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="sync-outline" size={18} color={darkMode ? "#F3F4F6" : "#334155"} />
                            <Text style={[styles.scanAnotherBtnText, { color: darkMode ? "#F3F4F6" : "#334155" }]}>Scan Another Sheet</Text>
                        </TouchableOpacity>

                        {/* Right: Approve & Record OR Recorded to Class Record! */}
                        {isRecorded ? (
                            <View style={[styles.recordedBadge, darkMode && { backgroundColor: "#064E3B", borderColor: "#059669" }]}>
                                <Ionicons name="checkmark" size={18} color={darkMode ? "#34D399" : "#059669"} />
                                <Text style={[styles.recordedBadgeText, darkMode && { color: "#A7F3D0" }]}>Recorded to Class Record!</Text>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={[styles.approveBtn, { backgroundColor: accentColor || "#F97316" }]}
                                onPress={handleApproveAndRecord}
                                disabled={savingScore}
                                activeOpacity={0.8}
                            >
                                {savingScore ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                                        <Text style={styles.approveBtnText}>Approve & Record</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* ── Roster Synchronized Successfully Banner (Visible after approval) ── */}
                    {isRecorded && (
                        <View style={[styles.syncBanner, darkMode && { backgroundColor: "#064E3B", borderColor: "#059669" }]}>
                            <Ionicons name="shield-checkmark-outline" size={24} color={darkMode ? "#34D399" : "#059669"} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.syncBannerTitle, darkMode && { color: "#A7F3D0" }]}>Roster Synchronized Successfully</Text>
                                <Text style={[styles.syncBannerSub, darkMode && { color: "#6EE7B7" }]}>Grades are mapped to the spreadsheet dynamically.</Text>
                            </View>
                        </View>
                    )}

                    {/* ── Scanned Student Sheet Card ── */}
                    <View style={[styles.scannedCard, { backgroundColor: cardBg, borderColor: border }]}>
                        {/* Dark Header Banner */}
                        <View style={[styles.darkCardHeader, darkMode && { backgroundColor: "#111827" }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.cardHeaderSub}>SCANNED STUDENT SHEET</Text>
                                <Text style={styles.cardStudentName} numberOfLines={1}>
                                    {gradingResult.studentName || "Student"}
                                </Text>
                            </View>
                            <View style={[styles.scoreBadgePill, { backgroundColor: accentColor || "#F97316" }]}>
                                <Text style={styles.scoreBadgePillText}>
                                    {gradingResult.totalScore} / {gradingResult.maxScore}
                                </Text>
                            </View>
                        </View>

                        {/* Interactive Grading Log Section */}
                        <View style={styles.cardBody}>
                            {/* ── Photo Quality Alert Banner (Single Paper) ── */}
                            {gradingResult.photoQuality?.hasWarnings &&
                                gradingResult.photoQuality.warnings.length > 0 && (
                                    <View
                                        style={[
                                            styles.reviewAlertBanner,
                                            {
                                                backgroundColor: darkMode ? "#7F1D1D30" : "#FEF2F2",
                                                borderColor: "#EF4444",
                                                flexDirection: "column",
                                                alignItems: "stretch",
                                                marginBottom: 14,
                                            },
                                        ]}
                                    >
                                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                                                <Ionicons name="warning" size={20} color="#EF4444" />
                                                <Text
                                                    style={[
                                                        styles.reviewAlertTitle,
                                                        { color: darkMode ? "#FCA5A5" : "#991B1B", flex: 1 },
                                                    ]}
                                                >
                                                    Photo Scan Quality Alert
                                                </Text>
                                            </View>
                                            <TouchableOpacity
                                                style={[styles.reviewAlertBtn, { backgroundColor: "#EF4444" }]}
                                                onPress={handleOpenCamera}
                                                activeOpacity={0.8}
                                            >
                                                <Ionicons name="camera-outline" size={14} color="#FFF" style={{ marginRight: 4 }} />
                                                <Text style={styles.reviewAlertBtnText}>Retake Photo</Text>
                                            </TouchableOpacity>
                                        </View>
                                        {gradingResult.photoQuality.warnings.map((warningText, wIdx) => (
                                            <Text
                                                key={wIdx}
                                                style={[
                                                    styles.reviewAlertSub,
                                                    {
                                                        color: darkMode ? "#FECACA" : "#B91C1C",
                                                        marginTop: 3,
                                                        lineHeight: 18,
                                                    },
                                                ]}
                                            >
                                                • {warningText}
                                            </Text>
                                        ))}
                                    </View>
                                )}

                            {/* ── Flagged Items Banner ── */}
                            {flaggedCount > 0 && (
                                <View style={[styles.reviewAlertBanner, { backgroundColor: darkMode ? "#78350F25" : "#FFFBEB", borderColor: "#F59E0B" }]}>
                                    <View style={styles.reviewAlertIconBg}>
                                        <Ionicons name="alert-circle" size={22} color="#D97706" />
                                    </View>
                                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                                        <Text style={[styles.reviewAlertTitle, { color: darkMode ? "#FDE68A" : "#92400E" }]}>
                                            {flaggedCount} Answer{flaggedCount > 1 ? "s" : ""} Need Your Review
                                        </Text>
                                        <Text style={[styles.reviewAlertSub, { color: darkMode ? "#FCD34D" : "#B45309" }]}>
                                            Double-shaded bubbles or low confidence marks detected.
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.reviewAlertBtn, { backgroundColor: "#F59E0B" }]}
                                        onPress={() => {
                                            const firstFlagged = gradingResult?.results?.find(
                                                (r) =>
                                                    (r.flaggedForReview ||
                                                        r.flagReason === "double_mark" ||
                                                        r.flagReason === "unclear" ||
                                                        r.flagReason === "low_confidence" ||
                                                        (r.confidence !== undefined && r.confidence < 0.75)) &&
                                                    !r.isOverridden
                                            );
                                            setReviewInitialQNum(firstFlagged ? firstFlagged.questionNumber : undefined);
                                            setReviewModalOpen(true);
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.reviewAlertBtnText}>Review</Text>
                                        <Ionicons name="chevron-forward" size={14} color="#FFF" style={{ marginLeft: 2 }} />
                                    </TouchableOpacity>
                                </View>
                            )}

                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                <Text style={[styles.gradingLogTitle, { color: textSub, marginBottom: 0 }]}>INTERACTIVE GRADING LOG</Text>
                                {flaggedCount > 0 && (
                                    <TouchableOpacity
                                        style={[styles.miniReviewChip, { backgroundColor: darkMode ? "#78350F40" : "#FEF3C7", borderColor: "#F59E0B" }]}
                                        onPress={() => {
                                            const firstFlagged = gradingResult?.results?.find(
                                                (r) =>
                                                    (r.flaggedForReview ||
                                                        r.flagReason === "double_mark" ||
                                                        r.flagReason === "unclear" ||
                                                        r.flagReason === "low_confidence" ||
                                                        (r.confidence !== undefined && r.confidence < 0.75)) &&
                                                    !r.isOverridden
                                            );
                                            setReviewInitialQNum(firstFlagged ? firstFlagged.questionNumber : undefined);
                                            setReviewModalOpen(true);
                                        }}
                                    >
                                        <Ionicons name="alert-circle" size={13} color="#D97706" style={{ marginRight: 4 }} />
                                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706" }}>
                                            {flaggedCount} Flagged
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* List of Questions */}
                            {gradingResult.results.map((item) => {
                                const isFlagged = Boolean(
                                    (item.flaggedForReview ||
                                        item.flagReason === "double_mark" ||
                                        item.flagReason === "unclear" ||
                                        item.flagReason === "low_confidence" ||
                                        (item.confidence !== undefined && item.confidence < 0.75)) &&
                                        !item.isOverridden
                                );
                                const isDouble = item.flagReason === "double_mark";
                                const isUnclear = item.flagReason === "unclear" || item.flagReason === "low_confidence";
                                const isOverridden = Boolean(item.isOverridden);

                                return (
                                    <TouchableOpacity
                                        key={item.questionNumber}
                                        style={[
                                            styles.logCard,
                                            item.isCorrect
                                                ? (darkMode ? { backgroundColor: "#064E3B20", borderColor: "#05966960" } : styles.logCardCorrect)
                                                : (darkMode ? { backgroundColor: "#7F1D1D20", borderColor: "#DC262660" } : styles.logCardWrong),
                                            isFlagged && {
                                                backgroundColor: darkMode ? "#78350F35" : "#FEF3C7",
                                                borderColor: "#F59E0B",
                                                borderWidth: 1.5,
                                            },
                                            isOverridden && {
                                                borderColor: "#10B981",
                                            },
                                        ]}
                                        onPress={() => {
                                            if (isFlagged) {
                                                setReviewInitialQNum(item.questionNumber);
                                                setReviewModalOpen(true);
                                            } else {
                                                handleToggleQuestion(item.questionNumber);
                                            }
                                        }}
                                        activeOpacity={0.7}
                                    >
                                        {/* Question Number Badge */}
                                        <View
                                            style={[
                                                styles.qBadge,
                                                item.isCorrect
                                                    ? (darkMode ? { backgroundColor: "#064E3B60" } : styles.qBadgeCorrect)
                                                    : (darkMode ? { backgroundColor: "#7F1D1D60" } : styles.qBadgeWrong),
                                                isFlagged && {
                                                    backgroundColor: "#F59E0B",
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.qBadgeText,
                                                    item.isCorrect
                                                        ? (darkMode ? { color: "#6EE7B7" } : styles.qBadgeTextCorrect)
                                                        : (darkMode ? { color: "#FCA5A5" } : styles.qBadgeTextWrong),
                                                    isFlagged && {
                                                        color: "#FFFFFF",
                                                        fontWeight: "900",
                                                    },
                                                ]}
                                            >
                                                Q{item.questionNumber}
                                            </Text>
                                        </View>

                                        {/* Information */}
                                        <View style={styles.logCardInfo}>
                                            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                                                <Text style={[styles.logAnswerText, { color: textMain }]}>
                                                    Answer:{" "}
                                                    <Text
                                                        style={{
                                                            fontWeight: "800",
                                                            color: item.isCorrect ? "#059669" : "#DC2626",
                                                        }}
                                                    >
                                                        {item.studentAnswer || "(Empty)"}
                                                    </Text>
                                                </Text>
                                                {isOverridden && (
                                                    <View style={[styles.miniStatusBadge, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}>
                                                        <Text style={{ fontSize: 10, color: "#059669", fontWeight: "700" }}>✓ Verified</Text>
                                                    </View>
                                                )}
                                            </View>

                                            <Text style={[styles.logKeyText, { color: textSub }]}>
                                                Key:{" "}
                                                <Text style={{ fontWeight: "700", color: textMain }}>
                                                    {item.correctAnswer}
                                                </Text>
                                            </Text>

                                            {/* Flagged Issue Details */}
                                            {isFlagged && (
                                                <View style={styles.logFlagNotice}>
                                                    <Ionicons name="alert-circle" size={13} color="#D97706" style={{ marginRight: 4 }} />
                                                    <Text style={styles.logFlagNoticeText}>
                                                        {isDouble
                                                            ? `Double-shaded bubbles (${item.studentAnswer || "A, C"}) — tap to fix`
                                                            : isUnclear
                                                            ? `Faint/unclear mark (${item.confidence ? Math.round(item.confidence * 100) : 55}%) — tap to fix`
                                                            : "Low confidence mark — tap to review"}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                        {/* Right Action */}
                                        {isFlagged ? (
                                            <View style={styles.logFixBtn}>
                                                <Text style={styles.logFixBtnText}>Fix</Text>
                                                <Ionicons name="create-outline" size={16} color="#D97706" style={{ marginLeft: 2 }} />
                                            </View>
                                        ) : (
                                            <Ionicons
                                                name={item.isCorrect ? "checkmark" : "close"}
                                                size={22}
                                                color={item.isCorrect ? "#34D399" : "#EF4444"}
                                            />
                                        )}
                                    </TouchableOpacity>
                                );
                            })}

                            {/* Tseki Approved Scan Banner */}
                            <View style={[styles.approvedScanCard, { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border }]}>
                                <Image
                                    source={require("../assets/images/logo.png")}
                                    style={styles.approvedScanMascot}
                                    resizeMode="contain"
                                />
                                <View style={styles.approvedScanInfo}>
                                    <Text style={[styles.approvedScanTitle, { color: textMain }]}>Tseki Approved Scan</Text>
                                    <Text style={[styles.approvedScanSub, { color: textSub }]}>
                                        This answer sheet has been verified against the standard {currentQuizValue || "assessment"}. Ready for class record update.
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>
                </View>
            ) : (
                /* ───────────────────────────────────────────────────────────────────
                    CASE 2: INITIAL SCAN LAUNCHER (Before scan)
                ────────────────────────────────────────────────────────────────────── */
                <View style={[styles.launcherCard, { backgroundColor: cardBg, borderColor: border, borderWidth: 1 }]}>
                    <View style={styles.launcherHeader}>
                        <View style={[styles.launcherIconCircle, { backgroundColor: (accentColor || "#F97316") + "15" }]}>
                            <Ionicons name="camera" size={22} color={accentColor || "#F97316"} />
                        </View>
                        <View>
                            <Text style={[styles.launcherTitle, { color: textMain }]}>Tseki Smart Vision Grader</Text>
                            <Text style={[styles.launcherSub, { color: textSub }]}>Fast, AI-powered automatic quiz grading</Text>
                        </View>
                    </View>

                    <View style={[styles.divider, { backgroundColor: subBorder }]}>
                    </View>

                    {/* Mode Toggle Pills: Single vs Batch */}
                    <View style={[styles.modeToggleRow, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}>
                        <TouchableOpacity
                            style={[
                                styles.modePill,
                                gradingMode === "single" && {
                                    backgroundColor: cardBg,
                                    shadowColor: "#000",
                                    shadowOffset: { width: 0, height: 1 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 2,
                                    elevation: 2,
                                },
                            ]}
                            onPress={() => setGradingMode("single")}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name="document-text-outline"
                                size={15}
                                color={gradingMode === "single" ? (accentColor || "#F97316") : textSub}
                            />
                            <Text
                                style={[
                                    styles.modePillText,
                                    gradingMode === "single"
                                        ? { color: accentColor || "#F97316", fontWeight: "800" }
                                        : { color: textSub },
                                ]}
                            >
                                Single Paper
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.modePill,
                                gradingMode === "batch" && {
                                    backgroundColor: cardBg,
                                    shadowColor: "#000",
                                    shadowOffset: { width: 0, height: 1 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 2,
                                    elevation: 2,
                                },
                            ]}
                            onPress={() => setGradingMode("batch")}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name="flash"
                                size={15}
                                color={gradingMode === "batch" ? (accentColor || "#F97316") : textSub}
                            />
                            <Text
                                style={[
                                    styles.modePillText,
                                    gradingMode === "batch"
                                        ? { color: accentColor || "#F97316", fontWeight: "800" }
                                        : { color: textSub },
                                ]}
                            >
                                Batch Scan Class
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {gradingMode === "single" ? (
                        <>
                            {/* 1. GRADE AGAINST QUIZ */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>1. GRADE AGAINST QUIZ</Text>
                                <Dropdown
                                    label="GRADE AGAINST QUIZ"
                                    value={currentQuizValue}
                                    placeholder="No quizzes created yet"
                                    options={quizOptions}
                                    onSelect={setSelectedQuiz}
                                    accentColor={accentColor}
                                />
                            </View>

                            {/* 2. IDENTIFY STUDENT SHEET */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>2. IDENTIFY STUDENT SHEET</Text>
                                <Dropdown
                                    label="IDENTIFY STUDENT SHEET"
                                    value={currentStudentValue}
                                    options={studentOptions}
                                    onSelect={setSelectedStudent}
                                    accentColor={accentColor}
                                />
                            </View>

                            {/* Primary Scan Button */}
                            <TouchableOpacity
                                style={[styles.primaryScanBtn, { backgroundColor: accentColor || "#F97316" }]}
                                onPress={() => {
                                    if (publishedQuizzes.length === 0) {
                                        Alert.alert(
                                            "No Quizzes Available",
                                            "You haven't created any quizzes for this classroom yet. Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!"
                                        );
                                        return;
                                    }
                                    setSourceModalOpen(true);
                                }}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryScanBtnText}>Open Camera & Scan</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            {/* 1. GRADE AGAINST QUIZ */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>1. SELECT ASSESSMENT TO GRADE</Text>
                                <Dropdown
                                    label="GRADE AGAINST QUIZ"
                                    value={currentQuizValue}
                                    placeholder="No quizzes created yet"
                                    options={quizOptions}
                                    onSelect={setSelectedQuiz}
                                    accentColor={accentColor}
                                />
                            </View>

                            {/* Batch Info Card */}
                            <View style={[styles.batchInfoCard, { backgroundColor: darkMode ? "#374151" : "#FFF7ED", borderColor: (accentColor || "#F97316") + "40" }]}>
                                <View style={[styles.batchInfoIconBg, { backgroundColor: (accentColor || "#F97316") + "20" }]}>
                                    <Ionicons name="flash" size={20} color={accentColor || "#F97316"} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.batchInfoTitle, { color: darkMode ? "#FED7AA" : "#9A3412" }]}>
                                        Continuous Batch Scanner
                                    </Text>
                                    <Text style={[styles.batchInfoSub, { color: darkMode ? "#FDBA74" : "#C2410C" }]}>
                                        Keep the camera open and snap your entire stack of test papers without stopping. The AI grades in the background and auto-matches students from the {roster.length}-student roster.
                                    </Text>
                                </View>
                            </View>

                            {/* Start Continuous Batch Scanner Button */}
                            <TouchableOpacity
                                style={[styles.primaryScanBtn, { backgroundColor: accentColor || "#F97316" }]}
                                onPress={handleStartBatchScanner}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="flash-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryScanBtnText}>Start Batch Scanner</Text>
                            </TouchableOpacity>

                            {/* View Current Batch If Exists */}
                            {batchItems.length > 0 && (
                                <TouchableOpacity
                                    style={[styles.batchViewBtn, { borderColor: accentColor || "#F97316" }]}
                                    onPress={handleFinishAndReview}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="documents-outline" size={18} color={accentColor || "#F97316"} />
                                    <Text style={[styles.batchViewBtnText, { color: accentColor || "#F97316" }]}>
                                        View Scanned Batch ({batchItems.length} Papers)
                                    </Text>
                                    <Ionicons name="chevron-forward" size={16} color={accentColor || "#F97316"} />
                                </TouchableOpacity>
                            )}
                        </>
                    )}

                </View>
            )}

            {/* ── Source Picker Modal ── */}
            <Modal
                visible={sourceModalOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setSourceModalOpen(false)}
            >
                <TouchableOpacity
                    style={styles.modalBackdrop}
                    activeOpacity={1}
                    onPress={() => setSourceModalOpen(false)}
                >
                    <View style={[styles.actionSheet, { backgroundColor: cardBg }]}>
                        <View style={styles.actionSheetHeader}>
                            <Text style={[styles.actionSheetTitle, { color: textMain }]}>Scan Student Test Sheet</Text>
                            <Text style={[styles.actionSheetSub, { color: textSub }]}>Choose how to provide the handwritten test paper</Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.sheetBtn, { backgroundColor: darkMode ? "#374151" : "#F9FAFB", borderColor: border }]}
                            onPress={handleOpenCamera}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.sheetBtnIcon, { backgroundColor: (accentColor || "#F97316") + "18" }]}>
                                <Ionicons name="camera" size={20} color={accentColor || "#F97316"} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.sheetBtnTitle, { color: textMain }]}>Take Photo with Camera</Text>
                                <Text style={[styles.sheetBtnSub, { color: textSub }]}>{"Snap a photo of the student's test sheet"}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.sheetBtn, { backgroundColor: darkMode ? "#374151" : "#F9FAFB", borderColor: border }]}
                            onPress={handlePickImage}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.sheetBtnIcon, { backgroundColor: "#10B98118" }]}>
                                <Ionicons name="images" size={20} color="#10B981" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.sheetBtnTitle, { color: textMain }]}>Choose from Photo Library</Text>
                                <Text style={[styles.sheetBtnSub, { color: textSub }]}>Upload an existing photo from device</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                        </TouchableOpacity>


                        <TouchableOpacity
                            style={styles.sheetCancelBtn}
                            onPress={() => setSourceModalOpen(false)}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.sheetCancelText, { color: textSub }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ── Full-Screen Grading Loading Overlay ── */}
            <Modal
                visible={gradingLoading}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => { }}
            >
                <View style={styles.loadingOverlay}>
                    <View style={[styles.loadingCard, { backgroundColor: cardBg }]}>
                        <View style={[styles.loadingIconGlow, { backgroundColor: (accentColor || "#F97316") + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: accentColor || "#F97316" }]}>
                                <Ionicons name="scan-outline" size={28} color="#FFFFFF" />
                            </View>
                        </View>

                        <Text style={[styles.loadingTitle, { color: textMain }]}>Grading Assessment...</Text>
                        <Text style={[styles.loadingSub, { color: textSub }]}>
                            Tseki AI Vision is reading handwritten answers from the sheet and matching against the answer key.
                        </Text>

                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={accentColor || "#F97316"} />
                        </View>

                        <View style={[styles.loadingMetaPill, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}>
                            <Text style={[styles.loadingMetaText, { color: textMain }]} numberOfLines={1}>
                                {currentQuizValue}
                            </Text>
                        </View>

                        <View style={styles.loadingNoticeRow}>
                            <Ionicons name="hourglass-outline" size={14} color="#6B7280" />
                            <Text style={[styles.loadingNoticeText, { color: textSub }]}>Please wait a moment while Tseki grades...</Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Low Confidence / Double-Shaded Review Modal ── */}
            <LowConfidenceReviewModal
                visible={reviewModalOpen}
                onClose={() => setReviewModalOpen(false)}
                gradingResult={gradingResult}
                scannedImageUri={scannedImageUri}
                accentColor={accentColor}
                initialQuestionNumber={reviewInitialQNum}
                onSaveReviewedResults={(updatedResults, newTotalScore) => {
                    if (!gradingResult) return;
                    setGradingResult({
                        ...gradingResult,
                        totalScore: newTotalScore,
                        results: updatedResults,
                    });
                    if (isRecorded) {
                        setIsRecorded(false);
                    }
                }}
            />

            {/* ── Camera Grader Scanner Modal (Single & Batch with Photo Guidance) ── */}
            <BatchScannerModal
                visible={batchScannerOpen}
                onClose={() => setBatchScannerOpen(false)}
                onCaptureSheet={handleBatchCaptureSheet}
                onBatchImportSheets={handleBatchImportSheets}
                onFinishAndReview={handleFinishAndReview}
                onRemoveSheet={handleRemoveBatchItem}
                items={batchItems}
                quizTitle={selectedQuiz || currentQuizValue || "Assessment"}
                classTitle={classTitle || "Classroom"}
                accentColor={accentColor}
                mode={scannerMode}
                onCaptureSingleSheet={handleCaptureSingleSheet}
            />

            {/* ── Batch Review & Approval Dashboard ── */}
            <BatchReviewDashboard
                visible={batchReviewOpen}
                onClose={() => setBatchReviewOpen(false)}
                onScanMore={handleScanMoreInBatch}
                items={batchItems}
                onUpdateItem={handleUpdateBatchItem}
                onRemoveItem={handleRemoveBatchItem}
                roster={roster.map((s) => ({
                    id: s.id,
                    full_name: s.full_name,
                    email: s.email,
                    average: s.average,
                }))}
                quizTitle={selectedQuiz || currentQuizValue || "Assessment"}
                classTitle={classTitle || "Classroom"}
                classroomId={classroomId}
                accentColor={accentColor}
                onCommitBatch={handleCommitBatch}
            />
        </ScrollView>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: "#F9FAFB",
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 48,
    },

    /* ── SCANNED RESULTS VIEW ── */
    resultsContainer: {
        width: "100%",
    },

    /* Review Alert Banner */
    reviewAlertBanner: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderRadius: 14,
        borderWidth: 1.5,
        marginBottom: 14,
    },
    reviewAlertIconBg: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "#FEF3C7",
        alignItems: "center",
        justifyContent: "center",
    },
    reviewAlertTitle: {
        fontSize: 13,
        fontWeight: "800",
    },
    reviewAlertSub: {
        fontSize: 11,
        fontWeight: "500",
        marginTop: 1,
    },
    reviewAlertBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 10,
    },
    reviewAlertBtnText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "800",
    },
    miniReviewChip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
    },
    miniStatusBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        marginLeft: 8,
    },
    logFlagNotice: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 4,
    },
    logFlagNoticeText: {
        fontSize: 11,
        fontWeight: "700",
        color: "#D97706",
    },
    logFixBtn: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FEF3C7",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#FCD34D",
    },
    logFixBtnText: {
        fontSize: 12,
        fontWeight: "800",
        color: "#D97706",
    },

    /* Action Buttons Row */
    actionButtonsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
    },
    scanAnotherBtn: {
        flex: 1,
        height: 50,
        borderRadius: 25,
        backgroundColor: "#F1F5F9",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 12,
    },
    scanAnotherBtnText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#334155",
    },
    approveBtn: {
        flex: 1,
        height: 50,
        borderRadius: 25,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 12,
        shadowColor: "#F97316",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 4,
    },
    approveBtnText: {
        fontSize: 14,
        fontWeight: "700",
        color: "#FFFFFF",
    },
    recordedBadge: {
        flex: 1.15,
        height: 50,
        borderRadius: 25,
        backgroundColor: "#ECFDF5",
        borderWidth: 1.5,
        borderColor: "#A7F3D0",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 12,
    },
    recordedBadgeText: {
        fontSize: 13,
        fontWeight: "700",
        color: "#059669",
    },

    /* Synchronized Banner */
    syncBanner: {
        backgroundColor: "#ECFDF5",
        borderWidth: 1.5,
        borderColor: "#A7F3D0",
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
    },
    syncBannerTitle: {
        fontSize: 14,
        fontWeight: "700",
        color: "#065F46",
    },
    syncBannerSub: {
        fontSize: 11.5,
        color: "#047857",
        marginTop: 2,
    },

    /* Scanned Card */
    scannedCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 24,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 14,
        elevation: 3,
        borderWidth: 1,
        borderColor: "#F1F5F9",
        marginBottom: 32,
    },
    darkCardHeader: {
        backgroundColor: "#0F172A",
        paddingHorizontal: 20,
        paddingVertical: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    cardHeaderSub: {
        fontSize: 10.5,
        fontWeight: "800",
        color: "#94A3B8",
        letterSpacing: 0.8,
        marginBottom: 4,
    },
    cardStudentName: {
        fontSize: 19,
        fontWeight: "800",
        color: "#FFFFFF",
    },
    scoreBadgePill: {
        paddingHorizontal: 16,
        paddingVertical: 7,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    scoreBadgePillText: {
        fontSize: 15,
        fontWeight: "800",
        color: "#FFFFFF",
    },

    /* Card Body */
    cardBody: {
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 24,
    },
    gradingLogTitle: {
        fontSize: 11.5,
        fontWeight: "800",
        color: "#64748B",
        letterSpacing: 0.8,
        marginBottom: 14,
    },

    /* Log Question Item */
    logCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderWidth: 1.5,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
        marginBottom: 10,
    },
    logCardCorrect: {
        backgroundColor: "#F0FDF4",
        borderColor: "#86EFAC",
    },
    logCardWrong: {
        backgroundColor: "#FEF2F2",
        borderColor: "#FECACA",
    },
    qBadge: {
        width: 38,
        height: 36,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    qBadgeCorrect: {
        backgroundColor: "#DCFCE7",
    },
    qBadgeWrong: {
        backgroundColor: "#FEE2E2",
    },
    qBadgeText: {
        fontSize: 13,
        fontWeight: "800",
    },
    qBadgeTextCorrect: {
        color: "#15803D",
    },
    qBadgeTextWrong: {
        color: "#B91C1C",
    },
    logCardInfo: {
        flex: 1,
        paddingHorizontal: 14,
    },
    logAnswerText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#1E293B",
    },
    logKeyText: {
        fontSize: 12.5,
        fontWeight: "500",
        color: "#64748B",
        marginTop: 2,
    },

    /* Mode Toggle Row */
    modeToggleRow: {
        flexDirection: "row",
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
    },
    modePill: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 9,
        borderRadius: 10,
    },
    modePillText: {
        fontSize: 13,
        fontWeight: "600",
    },

    /* Batch Info Card */
    batchInfoCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        marginBottom: 20,
    },
    batchInfoIconBg: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    batchInfoTitle: {
        fontSize: 13.5,
        fontWeight: "800",
    },
    batchInfoSub: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: 2,
    },
    batchViewBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderWidth: 1.5,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginTop: 10,
    },
    batchViewBtnText: {
        fontSize: 13.5,
        fontWeight: "700",
        flex: 1,
        marginHorizontal: 8,
    },

    /* Tseki Approved Scan Card */
    approvedScanCard: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F8FAFC",
        borderRadius: 18,
        padding: 14,
        gap: 14,
        marginTop: 12,
        borderWidth: 1,
        borderColor: "#F1F5F9",
    },
    approvedScanMascot: {
        width: 52,
        height: 52,
    },
    approvedScanInfo: {
        flex: 1,
    },
    approvedScanTitle: {
        fontSize: 14,
        fontWeight: "800",
        color: "#1E293B",
        marginBottom: 2,
    },
    approvedScanSub: {
        fontSize: 11.5,
        color: "#64748B",
        lineHeight: 16,
        fontWeight: "500",
    },

    /* ── LAUNCHER VIEW (Pre-scan) ── */
    launcherCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 20,
        padding: 22,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    launcherHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    launcherIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    launcherTitle: {
        fontSize: 17,
        fontWeight: "800",
        color: "#1F2937",
    },
    launcherSub: {
        fontSize: 12.5,
        color: "#6B7280",
        marginTop: 1,
    },
    divider: {
        height: 1,
        backgroundColor: "#F3F4F6",
        marginVertical: 18,
    },
    fieldGroup: {
        marginBottom: 20,
    },
    fieldLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#6B7280",
        letterSpacing: 0.6,
        marginBottom: 8,
    },
    primaryScanBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 54,
        borderRadius: 14,
        marginTop: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    primaryScanBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "700",
    },

    /* Dropdown */
    dropdownContainer: {},
    dropdownBtn: {
        height: 52,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        borderRadius: 12,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#FFFFFF",
    },
    dropdownValue: {
        fontSize: 14,
        color: "#374151",
        fontWeight: "500",
        flex: 1,
    },
    ddOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
    },
    ddSheet: {
        width: "100%",
        backgroundColor: "#FFFFFF",
        borderRadius: 20,
        padding: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 12,
    },
    ddTitle: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, marginBottom: 12 },
    ddItem: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 13,
        paddingHorizontal: 12,
        borderRadius: 10,
        marginBottom: 2,
    },
    ddItemText: { fontSize: 15, color: "#374151" },

    /* Action Sheet Modal */
    modalBackdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-end",
    },
    actionSheet: {
        backgroundColor: "#FFFFFF",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 36,
        gap: 12,
    },
    actionSheetHeader: {
        marginBottom: 8,
    },
    actionSheetTitle: {
        fontSize: 18,
        fontWeight: "800",
        color: "#1F2937",
        marginBottom: 4,
    },
    actionSheetSub: {
        fontSize: 13,
        color: "#6B7280",
    },
    sheetBtn: {
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
    sheetBtnIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetBtnTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: "#1F2937",
        marginBottom: 2,
    },
    sheetBtnSub: {
        fontSize: 12,
        color: "#6B7280",
    },
    sheetCancelBtn: {
        height: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 4,
    },
    sheetCancelText: {
        fontSize: 15,
        fontWeight: "600",
        color: "#6B7280",
    },

    /* Full-screen Loading Overlay */
    loadingOverlay: {
        flex: 1,
        backgroundColor: "rgba(17, 24, 39, 0.85)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 28,
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
});
