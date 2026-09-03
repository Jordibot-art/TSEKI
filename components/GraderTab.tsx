import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { gradeStudentTest, GradingResponse } from "../lib/gradingService";
import { getPublishedQuizzes, StoredQuiz } from "../lib/quizStore";
import { supabase } from "../supabase";

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
            { questionNumber: 2, correctAnswer: "Mitochondria" },
            { questionNumber: 3, correctAnswer: "T" },
            { questionNumber: 4, correctAnswer: "Osmosis" },
            { questionNumber: 5, correctAnswer: "C" },
            { questionNumber: 6, correctAnswer: "T" },
            { questionNumber: 7, correctAnswer: "D" },
            { questionNumber: 8, correctAnswer: "Nucleus" },
            { questionNumber: 9, correctAnswer: "T" },
            { questionNumber: 10, correctAnswer: "B" },
        ],
    },
    {
        title: "Quick Quiz (5 Questions)",
        answerKey: [
            { questionNumber: 1, correctAnswer: "B" },
            { questionNumber: 2, correctAnswer: "Photosynthesis" },
            { questionNumber: 3, correctAnswer: "T" },
            { questionNumber: 4, correctAnswer: "Meiosis" },
            { questionNumber: 5, correctAnswer: "A" },
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
    const [open, setOpen] = useState(false);
    return (
        <View style={styles.dropdownContainer}>
            <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setOpen(true)}
                activeOpacity={0.7}
            >
                <Text style={styles.dropdownValue}>{value}</Text>
                <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </TouchableOpacity>

            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <TouchableOpacity style={styles.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
                    <View style={styles.ddSheet}>
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
};

export default function GraderTab({
    classroomId,
    classTitle,
    accentColor,
    students = [],
    defaultSelectedQuiz,
}: Props) {
    // 1. Grade against quiz
    const [publishedQuizzes, setPublishedQuizzes] = useState<StoredQuiz[]>([]);
    const [selectedQuiz, setSelectedQuiz] = useState(defaultSelectedQuiz || QUIZ_PRESETS[0].title);

    // 2. Identify student sheet (functional with real database students)
    const [roster, setRoster] = useState<Student[]>(students);
    const [selectedStudent, setSelectedStudent] = useState("");

    // 3. Choose answer sheet sample
    const [sampleSheets, setSampleSheets] = useState<{ id: string; title: string; badge?: string }[]>([]);
    const [selectedSample, setSelectedSample] = useState("");

    // ── Grading & Camera States ────────────────────────────────────────────────
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [gradingLoading, setGradingLoading] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResponse | null>(null);
    const [savingScore, setSavingScore] = useState(false);

    useEffect(() => {
        if (students && students.length > 0) {
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
        ? [
            ...publishedQuizzes.map((q) => q.quizTitle),
            ...QUIZ_PRESETS.map((q) => `Preset: ${q.title}`),
          ]
        : QUIZ_PRESETS.map((q) => q.title);

    const studentOptions = roster.length > 0
        ? roster.map((s) => `${s.full_name}${s.email ? ` (${s.email})` : ""}`)
        : ["No students enrolled yet"];

    const currentStudentValue = selectedStudent || (roster.length > 0 ? studentOptions[0] : "Select a student...");

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

    // ── Run AI Grading ─────────────────────────────────────────────────────────
    async function processGrading(base64Data: string, mimeType: "image/jpeg" | "image/png") {
        setGradingLoading(true);
        try {
            const published = publishedQuizzes.find((q) => q.quizTitle === selectedQuiz);
            const preset = QUIZ_PRESETS.find((q) => q.title === selectedQuiz || `Preset: ${q.title}` === selectedQuiz) || QUIZ_PRESETS[0];
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

    // ── Save Graded Score to Supabase ──────────────────────────────────────────
    async function handleSaveScore() {
        if (!gradingResult) return;
        setSavingScore(true);
        try {
            const student = roster.find(
                (s) =>
                    (selectedStudent && selectedStudent.includes(s.full_name)) ||
                    (gradingResult.studentName && s.full_name.toLowerCase().includes(gradingResult.studentName.toLowerCase()))
            ) || roster[0];

            if (student) {
                const percentage = Math.round((gradingResult.totalScore / (gradingResult.maxScore || 1)) * 100);
                const { error } = await supabase
                    .from("students")
                    .update({ average: percentage })
                    .eq("id", student.id);

                if (error) throw error;

                setRoster((prev) =>
                    prev.map((s) => (s.id === student.id ? { ...s, average: percentage } : s))
                );
                Alert.alert("Score Saved", `Successfully recorded ${percentage}% for ${student.full_name}!`);
                setGradingResult(null);
            } else {
                Alert.alert("Notice", "Score calculated, but no student in the roster was selected.");
                setGradingResult(null);
            }
        } catch (err: any) {
            Alert.alert("Error Saving Score", err.message || "Failed to update student database record.");
        } finally {
            setSavingScore(false);
        }
    }

    return (
        <ScrollView
            style={styles.root}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.card}>
                {/* Header */}
                <View style={styles.header}>
                    <Ionicons name="camera-outline" size={20} color="#2563EB" />
                    <Text style={styles.headerTitle}>Tseki Smart Vision Grader</Text>
                </View>

                <View style={styles.divider} />

                {/* 1. GRADE AGAINST QUIZ */}
                <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>1. GRADE AGAINST QUIZ</Text>
                    <Dropdown
                        label="GRADE AGAINST QUIZ"
                        value={selectedQuiz}
                        options={quizOptions}
                        onSelect={setSelectedQuiz}
                        accentColor={accentColor}
                    />
                </View>

                {/* 2. IDENTIFY STUDENT SHEET */}
                <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>2. IDENTIFY STUDENT SHEET</Text>
                    <Dropdown
                        label="IDENTIFY STUDENT SHEET"
                        value={currentStudentValue}
                        options={studentOptions}
                        onSelect={setSelectedStudent}
                        accentColor={accentColor}
                    />
                </View>

                {/* 3. CHOOSE ANSWER SHEET SAMPLE */}
                <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>3. CHOOSE ANSWER SHEET SAMPLE</Text>
                    {sampleSheets.length > 0 ? (
                        <View style={styles.samplesList}>
                            {sampleSheets.map((sample) => {
                                const isSelected = selectedSample === sample.id;
                                return (
                                    <TouchableOpacity
                                        key={sample.id}
                                        style={[
                                            styles.sampleCard,
                                            isSelected && { borderColor: accentColor, backgroundColor: accentColor + "08" },
                                        ]}
                                        onPress={() => setSelectedSample(sample.id)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[
                                            styles.sampleTitle,
                                            isSelected && { color: "#1F2937", fontWeight: "700" }
                                        ]}>
                                            {sample.title}
                                        </Text>
                                        {sample.badge && (
                                            <View style={[
                                                styles.sampleBadge,
                                                isSelected && { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB" }
                                            ]}>
                                                <Text style={[
                                                    styles.sampleBadgeText,
                                                    isSelected && { color: accentColor }
                                                ]}>
                                                    {sample.badge}
                                                </Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.emptySampleBox}>
                            <Ionicons name="document-text-outline" size={24} color="#9CA3AF" />
                            <Text style={styles.emptySampleText}>No answer sheet samples available</Text>
                        </View>
                    )}
                </View>

                {/* Scan Button */}
                <TouchableOpacity
                    style={[styles.scanBtn, { backgroundColor: accentColor || "#2563EB" }]}
                    onPress={() => setSourceModalOpen(true)}
                    activeOpacity={0.8}
                >
                    <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.scanBtnText}>Open Camera & Scan</Text>
                </TouchableOpacity>
            </View>

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
                    <View style={styles.actionSheet}>
                        <View style={styles.actionSheetHeader}>
                            <Text style={styles.actionSheetTitle}>Scan Student Test Paper</Text>
                            <Text style={styles.actionSheetSub}>Choose how to provide the handwritten test sheet</Text>
                        </View>

                        <TouchableOpacity
                            style={styles.sheetBtn}
                            onPress={handleOpenCamera}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.sheetBtnIcon, { backgroundColor: (accentColor || "#2563EB") + "18" }]}>
                                <Ionicons name="camera" size={20} color={accentColor || "#2563EB"} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetBtnTitle}>Take Photo with Camera</Text>
                                <Text style={styles.sheetBtnSub}>Snap a photo of the printed paper</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sheetBtn}
                            onPress={handlePickImage}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.sheetBtnIcon, { backgroundColor: "#10B98118" }]}>
                                <Ionicons name="images" size={20} color="#10B981" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetBtnTitle}>Choose from Photo Library</Text>
                                <Text style={styles.sheetBtnSub}>Upload an existing photo from your device</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sheetCancelBtn}
                            onPress={() => setSourceModalOpen(false)}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.sheetCancelText}>Cancel</Text>
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
                    <View style={styles.loadingCard}>
                        <View style={[styles.loadingIconGlow, { backgroundColor: (accentColor || "#2563EB") + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: accentColor || "#2563EB" }]}>
                                <Ionicons name="scan-outline" size={28} color="#FFFFFF" />
                            </View>
                        </View>

                        <Text style={styles.loadingTitle}>Grading Assessment...</Text>
                        <Text style={styles.loadingSub}>
                            Tseki AI Vision is reading handwritten answers from the boxes and matching against the answer key.
                        </Text>

                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={accentColor || "#2563EB"} />
                        </View>

                        <View style={styles.loadingMetaPill}>
                            <Text style={styles.loadingMetaText} numberOfLines={1}>
                                {selectedQuiz}
                            </Text>
                        </View>

                        <View style={styles.loadingNoticeRow}>
                            <Ionicons name="hourglass-outline" size={14} color="#6B7280" />
                            <Text style={styles.loadingNoticeText}>Please wait and keep this screen open.</Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Grading Results Modal ── */}
            <Modal
                visible={gradingResult !== null}
                transparent
                animationType="slide"
                onRequestClose={() => setGradingResult(null)}
            >
                <View style={styles.resultsOverlay}>
                    <View style={styles.resultsCard}>
                        {/* Header */}
                        <View style={styles.resultsHeader}>
                            <View>
                                <Text style={styles.resultsTitle}>Grading Completed</Text>
                                <Text style={styles.resultsSubtitle}>
                                    Detected Student: <Text style={{ fontWeight: "700", color: "#1F2937" }}>{gradingResult?.studentName || "Unknown"}</Text>
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setGradingResult(null)} style={styles.closeBtn}>
                                <Ionicons name="close" size={20} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        {/* Score Hero Banner */}
                        {gradingResult && (
                            <View style={[styles.scoreBanner, { backgroundColor: (accentColor || "#2563EB") + "14", borderColor: (accentColor || "#2563EB") + "44" }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.scoreBannerLabel}>TOTAL SCORE</Text>
                                    <Text style={[styles.scoreBannerNumber, { color: accentColor || "#2563EB" }]}>
                                        {gradingResult.totalScore} <Text style={styles.scoreBannerMax}>/ {gradingResult.maxScore}</Text>
                                    </Text>
                                </View>
                                <View style={[styles.percentageBadge, { backgroundColor: accentColor || "#2563EB" }]}>
                                    <Text style={styles.percentageText}>
                                        {Math.round((gradingResult.totalScore / (gradingResult.maxScore || 1)) * 100)}%
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Roster Assignment Selector */}
                        <View style={styles.assignRow}>
                            <Text style={styles.assignLabel}>Record For:</Text>
                            <View style={{ flex: 1 }}>
                                <Dropdown
                                    label="SELECT ROSTER STUDENT"
                                    value={currentStudentValue}
                                    options={studentOptions}
                                    onSelect={setSelectedStudent}
                                    accentColor={accentColor}
                                />
                            </View>
                        </View>

                        {/* Breakdown Header */}
                        <Text style={styles.breakdownHeader}>QUESTION BREAKDOWN</Text>

                        {/* Questions List */}
                        <ScrollView style={styles.resultsScroll} showsVerticalScrollIndicator={false}>
                            {gradingResult?.results.map((item) => (
                                <View key={item.questionNumber} style={styles.resultItemRow}>
                                    <View style={[styles.itemNumBadge, { backgroundColor: item.isCorrect ? "#10B981" : "#EF4444" }]}>
                                        <Text style={styles.itemNumText}>#{item.questionNumber}</Text>
                                    </View>
                                    <View style={{ flex: 1, paddingHorizontal: 10 }}>
                                        <Text style={styles.itemAnswerText}>
                                            Answer: <Text style={{ fontWeight: "700", color: item.isCorrect ? "#059669" : "#DC2626" }}>{item.studentAnswer || "(Empty)"}</Text>
                                        </Text>
                                        <Text style={styles.itemKeyText}>Key: {item.correctAnswer}</Text>
                                    </View>
                                    <View style={styles.itemPointsWrap}>
                                        <Ionicons
                                            name={item.isCorrect ? "checkmark-circle" : "close-circle"}
                                            size={18}
                                            color={item.isCorrect ? "#10B981" : "#EF4444"}
                                        />
                                        <Text style={[styles.itemPointsText, { color: item.isCorrect ? "#059669" : "#DC2626" }]}>
                                            +{item.pointsAwarded}
                                        </Text>
                                    </View>
                                </View>
                            ))}
                        </ScrollView>

                        {/* Action Buttons */}
                        <View style={styles.resultsFooter}>
                            <TouchableOpacity
                                style={[styles.saveRecordBtn, { backgroundColor: accentColor || "#2563EB" }]}
                                onPress={handleSaveScore}
                                disabled={savingScore}
                                activeOpacity={0.8}
                            >
                                {savingScore ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark-done-outline" size={18} color="#FFFFFF" />
                                        <Text style={styles.saveRecordText}>Save to Student Record</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.scanNextBtn}
                                onPress={() => {
                                    setGradingResult(null);
                                    setSourceModalOpen(true);
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="camera-outline" size={16} color="#4B5563" />
                                <Text style={styles.scanNextText}>Scan Another Paper</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },

    card: {
        backgroundColor: "#FFFFFF",
        borderRadius: 20,
        padding: 24,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },

    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#1F2937",
    },

    divider: {
        height: 1,
        backgroundColor: "#F3F4F6",
        marginVertical: 20,
    },

    fieldGroup: {
        marginBottom: 24,
    },
    fieldLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#6B7280",
        letterSpacing: 0.6,
        marginBottom: 10,
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

    /* Samples */
    samplesList: {
        gap: 12,
    },
    sampleCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1.5,
        borderColor: "#F3F4F6",
        borderRadius: 12,
        backgroundColor: "#FFFFFF",
    },
    sampleTitle: {
        fontSize: 13,
        color: "#4B5563",
        fontWeight: "600",
        flex: 1,
        marginRight: 12,
    },
    sampleBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        backgroundColor: "#FFFFFF",
    },
    sampleBadgeText: {
        fontSize: 11,
        fontWeight: "600",
        color: "#6B7280",
    },

    /* Empty state */
    emptySampleBox: {
        borderWidth: 1.5,
        borderColor: "#E5E7EB",
        borderStyle: "dashed",
        borderRadius: 12,
        paddingVertical: 24,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F9FAFB",
        gap: 8,
    },
    emptySampleText: {
        fontSize: 13,
        color: "#9CA3AF",
        fontWeight: "500",
    },

    /* Scan Button */
    scanBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 56,
        borderRadius: 12,
        marginTop: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    scanBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "700",
    },

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

    /* Results Modal */
    resultsOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingVertical: 32,
    },
    resultsCard: {
        backgroundColor: "#FFFFFF",
        borderRadius: 24,
        padding: 20,
        maxHeight: "90%",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 12,
    },
    resultsHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    resultsTitle: {
        fontSize: 20,
        fontWeight: "800",
        color: "#1F2937",
    },
    resultsSubtitle: {
        fontSize: 13,
        color: "#6B7280",
        marginTop: 2,
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "#F3F4F6",
        alignItems: "center",
        justifyContent: "center",
    },
    scoreBanner: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 16,
    },
    scoreBannerLabel: {
        fontSize: 11,
        fontWeight: "700",
        color: "#6B7280",
        letterSpacing: 0.5,
    },
    scoreBannerNumber: {
        fontSize: 28,
        fontWeight: "800",
        marginTop: 2,
    },
    scoreBannerMax: {
        fontSize: 16,
        fontWeight: "600",
        color: "#6B7280",
    },
    percentageBadge: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
    },
    percentageText: {
        fontSize: 16,
        fontWeight: "800",
        color: "#FFFFFF",
    },
    assignRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
    },
    assignLabel: {
        fontSize: 12,
        fontWeight: "700",
        color: "#4B5563",
    },
    breakdownHeader: {
        fontSize: 12,
        fontWeight: "800",
        color: "#9CA3AF",
        letterSpacing: 0.6,
        marginBottom: 10,
    },
    resultsScroll: {
        maxHeight: 220,
        marginBottom: 16,
    },
    resultItemRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: "#F9FAFB",
        borderWidth: 1,
        borderColor: "#E5E7EB",
        marginBottom: 8,
    },
    itemNumBadge: {
        width: 34,
        height: 24,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    itemNumText: {
        fontSize: 11,
        fontWeight: "800",
        color: "#FFFFFF",
    },
    itemAnswerText: {
        fontSize: 13,
        color: "#374151",
    },
    itemKeyText: {
        fontSize: 11,
        color: "#6B7280",
        marginTop: 1,
    },
    itemPointsWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    itemPointsText: {
        fontSize: 13,
        fontWeight: "700",
    },
    resultsFooter: {
        gap: 8,
    },
    saveRecordBtn: {
        height: 50,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    saveRecordText: {
        fontSize: 15,
        fontWeight: "700",
        color: "#FFFFFF",
    },
    scanNextBtn: {
        height: 44,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: "#F3F4F6",
    },
    scanNextText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#4B5563",
    },
});
