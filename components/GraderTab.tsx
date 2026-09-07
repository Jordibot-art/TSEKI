import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
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
import { gradeStudentTest, GradingResponse, GradingResultItem } from "../lib/gradingService";
import { saveRosterAlert } from "../lib/alertStore";
import { getPublishedQuizzes, saveQuizPerformanceRecord, StoredQuiz } from "../lib/quizStore";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";

// ── Types ─────────────────────────────────────────────────────────────────────
export type Student = {
    id: string;
    full_name: string;
    email: string | null;
    average: number;
    attendance: number;
};

// ── Quiz Presets & Answer Keys ────────────────────────────────────────────────
const QUIZ_PRESETS: { title: string; answerKey: any[] }[] = [
    {
        title: "Standard Assessment (10 Questions)",
        answerKey: [
            { questionNumber: 1, correctAnswer: "A" },
            { questionNumber: 2, correctAnswer: "B" },
            { questionNumber: 3, correctAnswer: "C" },
            { questionNumber: 4, correctAnswer: "A" },
            { questionNumber: 5, correctAnswer: "D" },
            { questionNumber: 6, correctAnswer: "B" },
            { questionNumber: 7, correctAnswer: "C" },
            { questionNumber: 8, correctAnswer: "A" },
            { questionNumber: 9, correctAnswer: "D" },
            { questionNumber: 10, correctAnswer: "B" },
        ],
    },
];

// ── Reusable Dropdown ─────────────────────────────────────────────────────────
function Dropdown({
    label, value, options, onSelect, accentColor,
}: {
    label: string; value: string; options: string[];
    onSelect: (v: string) => void; accentColor: string;
}) {
    const { darkMode } = useTheme();
    const [open, setOpen] = useState(false);
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
                <Text style={[styles.dropdownValue, { color: darkMode ? "#F9FAFB" : "#374151" }]}>{value}</Text>
                <Ionicons name="chevron-down" size={16} color={darkMode ? "#9CA3AF" : "#6B7280"} />
            </TouchableOpacity>

            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <TouchableOpacity style={styles.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
                    <View style={[styles.ddSheet, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF" }]}>
                        <Text style={[styles.ddTitle, { color: accentColor }]}>{label}</Text>
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
                                        { color: darkMode ? "#F3F4F6" : "#374151" },
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
    const [savingScore, setSavingScore] = useState(false);
    const [isRecorded, setIsRecorded] = useState(false);
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
        if (defaultSelectedQuiz) {
            setSelectedQuiz(defaultSelectedQuiz);
        } else if (stored.length > 0) {
            setSelectedQuiz(stored[0].quizTitle);
        }
    }

    const quizOptions = publishedQuizzes.length > 0
        ? publishedQuizzes.map((q) => q.quizTitle)
        : ["Standard Assessment (10 Questions)"];

    const currentQuizValue = selectedQuiz || (publishedQuizzes.length > 0 ? publishedQuizzes[0].quizTitle : quizOptions[0]);

    const studentOptions = [
        "Auto-Detect from Test Paper",
        ...(roster.length > 0
            ? roster.map((s) => `${s.full_name}${s.email ? ` (${s.email})` : ""}`)
            : []),
    ];

    const currentStudentValue = selectedStudent || "Auto-Detect from Test Paper";

    // ── Open Camera ────────────────────────────────────────────────────────────
    async function handleOpenCamera() {
        setSourceModalOpen(false);
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== "granted") {
                Alert.alert("Permission Required", "Camera permission is required to scan student test papers.");
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.85,
                base64: true,
            });

            if (!result.canceled && result.assets && result.assets.length > 0 && result.assets[0].base64) {
                const asset = result.assets[0];
                const mimeType = asset.mimeType && asset.mimeType.includes("png") ? "image/png" : "image/jpeg";
                processGrading(asset.base64!, mimeType);
            }
        } catch (err: any) {
            Alert.alert("Camera Error", err.message || "Failed to launch camera.");
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
                quality: 0.85,
                base64: true,
            });

            if (!result.canceled && result.assets && result.assets.length > 0 && result.assets[0].base64) {
                const asset = result.assets[0];
                const mimeType = asset.mimeType && asset.mimeType.includes("png") ? "image/png" : "image/jpeg";
                processGrading(asset.base64!, mimeType);
            }
        } catch (err: any) {
            Alert.alert("Picker Error", err.message || "Failed to select photo.");
        }
    }

    // ── Load Demo Student Sheet (Matches User Reference) ───────────────────────
    function handleLoadDemo() {
        setSourceModalOpen(false);
        setGradingLoading(true);
        setTimeout(() => {
            setGradingLoading(false);
            setIsRecorded(false);
            setGradingResult({
                studentName: "Sarah Jenkins",
                totalScore: 10,
                maxScore: 10,
                results: [
                    { questionNumber: 1, studentAnswer: "A", correctAnswer: "A", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 2, studentAnswer: "B", correctAnswer: "B", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 3, studentAnswer: "C", correctAnswer: "C", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 4, studentAnswer: "A", correctAnswer: "A", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 5, studentAnswer: "D", correctAnswer: "D", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 6, studentAnswer: "B", correctAnswer: "B", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 7, studentAnswer: "C", correctAnswer: "C", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 8, studentAnswer: "A", correctAnswer: "A", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 9, studentAnswer: "D", correctAnswer: "D", isCorrect: true, pointsAwarded: 1 },
                    { questionNumber: 10, studentAnswer: "B", correctAnswer: "B", isCorrect: true, pointsAwarded: 1 },
                ],
            });
        }, 700);
    }

    // ── Run AI Grading ─────────────────────────────────────────────────────────
    async function processGrading(base64Data: string, mimeType: "image/jpeg" | "image/png") {
        setGradingLoading(true);
        setIsRecorded(false);
        try {
            const activeQuizTitle = selectedQuiz || currentQuizValue;
            const published = publishedQuizzes.find((q) => q.quizTitle === activeQuizTitle || q.quizTitle === selectedQuiz);
            const preset = QUIZ_PRESETS.find((q) => q.title === selectedQuiz) || QUIZ_PRESETS[0];
            const activeAnswerKey = published ? published.answerKey : preset.answerKey;

            const result = await gradeStudentTest(base64Data, activeAnswerKey, mimeType);
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
                    : "Sarah Jenkins";

                const { data, error } = await supabase
                    .from("students")
                    .insert({
                        classroom_id: classroomId,
                        full_name: newName,
                        email: null,
                        attendance: 100,
                        average: percentage,
                    })
                    .select()
                    .single();

                if (error) throw error;
                if (data) {
                    const newStudent = data as Student;
                    setRoster((prev) => [...prev, newStudent]);
                    onStudentCreated?.(newStudent);
                    onScoreRecorded?.(newStudent.id, percentage);
                }
            }

            // Record to quiz performance history for tracker trend
            const quizTitleToRecord = selectedQuiz || "Assessment 1";
            if (classroomId) {
                await saveQuizPerformanceRecord(classroomId, quizTitleToRecord, percentage);

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
                                    {gradingResult.studentName || "Sarah Jenkins"}
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
                            <Text style={[styles.gradingLogTitle, { color: textSub }]}>INTERACTIVE GRADING LOG</Text>

                            {/* List of Questions */}
                            {gradingResult.results.map((item) => (
                                <TouchableOpacity
                                    key={item.questionNumber}
                                    style={[
                                        styles.logCard,
                                        item.isCorrect
                                            ? (darkMode ? { backgroundColor: "#064E3B20", borderColor: "#05966960" } : styles.logCardCorrect)
                                            : (darkMode ? { backgroundColor: "#7F1D1D20", borderColor: "#DC262660" } : styles.logCardWrong),
                                    ]}
                                    onPress={() => handleToggleQuestion(item.questionNumber)}
                                    activeOpacity={0.7}
                                >
                                    {/* Question Number Badge */}
                                    <View
                                        style={[
                                            styles.qBadge,
                                            item.isCorrect
                                                ? (darkMode ? { backgroundColor: "#064E3B60" } : styles.qBadgeCorrect)
                                                : (darkMode ? { backgroundColor: "#7F1D1D60" } : styles.qBadgeWrong),
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.qBadgeText,
                                                item.isCorrect
                                                    ? (darkMode ? { color: "#6EE7B7" } : styles.qBadgeTextCorrect)
                                                    : (darkMode ? { color: "#FCA5A5" } : styles.qBadgeTextWrong),
                                            ]}
                                        >
                                            Q{item.questionNumber}
                                        </Text>
                                    </View>

                                    {/* Information */}
                                    <View style={styles.logCardInfo}>
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
                                        <Text style={[styles.logKeyText, { color: textSub }]}>
                                            Key:{" "}
                                            <Text style={{ fontWeight: "700", color: textMain }}>
                                                {item.correctAnswer}
                                            </Text>
                                        </Text>
                                    </View>

                                    {/* Right Checkmark / Close Icon */}
                                    <Ionicons
                                        name={item.isCorrect ? "checkmark" : "close"}
                                        size={22}
                                        color={item.isCorrect ? "#34D399" : "#EF4444"}
                                    />
                                </TouchableOpacity>
                            ))}

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

                    {/* 1. GRADE AGAINST QUIZ */}
                    <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: textSub }]}>1. GRADE AGAINST QUIZ</Text>
                        <Dropdown
                            label="GRADE AGAINST QUIZ"
                            value={currentQuizValue}
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
                        onPress={() => setSourceModalOpen(true)}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.primaryScanBtnText}>Open Camera & Scan</Text>
                    </TouchableOpacity>
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
                                <Text style={[styles.sheetBtnSub, { color: textSub }]}>Snap a photo of the student's test sheet</Text>
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

                        {/* Demo Sheet Option */}
                        <TouchableOpacity
                            style={[styles.sheetBtn, { backgroundColor: darkMode ? "#374151" : "#F9FAFB", borderColor: border }]}
                            onPress={handleLoadDemo}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.sheetBtnIcon, { backgroundColor: "#6366F118" }]}>
                                <Ionicons name="sparkles" size={20} color="#6366F1" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.sheetBtnTitle, { color: textMain }]}>Load Demo (Sarah Jenkins - 10/10)</Text>
                                <Text style={[styles.sheetBtnSub, { color: textSub }]}>Instant test preview of the scanned quiz UI</Text>
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
                onRequestClose={() => {}}
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
