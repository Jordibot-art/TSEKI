import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState, useMemo, useRef } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import { evaluateAndRecordStudentAlert } from "../lib/alertStore";
import {
    AUTO_DETECT_ASSESSMENT,
    getDisambiguatedQuizLabel,
    identifyAssessmentFromImage,
    matchAssessmentByQr,
} from "../lib/assessmentDetector";
import { gradeStudentTest, GradingResponse, isItemUnresolvedFlag } from "../lib/gradingService";
import { LowConfidenceReviewModal } from "./LowConfidenceReviewModal";
import { saveStudentQuizResult, recalculateStudentAverage } from "../lib/questionAnalysis";
import { getPublishedQuizzes, saveQuizPerformanceRecord, StoredQuiz } from "../lib/quizStore";
import {
    formatMiddleInitial,
    formatStudentFullName,
    normalizeStudentRecord,
    splitStudentFullName,
    toSmartTitleCase,
} from "../lib/classListParserService";
import { supabase } from "../supabase";
import { BatchScannerModal } from "./BatchScannerModal";
import { BatchReviewDashboard } from "./BatchReviewDashboard";
import { BatchGradingQueue, BatchSheetItem, matchStudentToRoster } from "../lib/batchGradingQueue";
import { PaperScanningAnimation } from "./PaperScanningAnimation";
import {
    SmoothBottomSheetModal,
    SmoothCenterModal,
    SmoothStageTransition,
    TRANSITION_EXIT_WAIT_MS,
    TRANSITION_HANDOFF_DELAY_MS,
    waitForTransition,
} from "./SmoothModalTransition";
import {
    getSkeuoPalette,
    skeuoButtonStyle,
    skeuoCardStyle,
    skeuoGrooveStyle,
    skeuoWellStyle,
} from "./skeuoTheme";

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
    label, value, options, onSelect, accentColor, placeholder, initialVisibleCount,
}: {
    label: string; value: string; options: string[];
    onSelect: (v: string) => void; accentColor: string;
    placeholder?: string;
    initialVisibleCount?: number;
}) {
    const { darkMode } = useTheme();
    const [open, setOpen] = useState(false);
    const pageSize = initialVisibleCount && initialVisibleCount > 0 ? initialVisibleCount : options.length;
    const [visibleCount, setVisibleCount] = useState<number>(pageSize);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const hasValue = Boolean(value && value.trim().length > 0);
    const skeuo = getSkeuoPalette(darkMode, accentColor);
    const textSub = skeuo.textSecondary;
    const textMain = skeuo.textPrimary;
    const borderCol = skeuo.border;

    const usePagination = Boolean(initialVisibleCount && options.length > initialVisibleCount);
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredOptions = usePagination && normalizedQuery
        ? options.filter((opt) => opt.toLowerCase().includes(normalizedQuery))
        : options;
    const displayedOptions = usePagination
        ? filteredOptions.slice(0, visibleCount)
        : filteredOptions;
    const remainingCount = Math.max(0, filteredOptions.length - displayedOptions.length);

    function openDropdown() {
        setVisibleCount(initialVisibleCount || options.length);
        setSearchQuery("");
        setOpen(true);
    }

    return (
        <View style={styles.dropdownContainer}>
            <TouchableOpacity
                style={[styles.dropdownBtn, skeuoWellStyle(skeuo, 12)]}
                onPress={openDropdown}
                activeOpacity={0.75}
            >
                <Text style={[styles.dropdownValue, { color: hasValue ? textMain : textSub }]} numberOfLines={1}>
                    {hasValue ? value : (placeholder || "Select option")}
                </Text>
                <Ionicons name="chevron-down" size={16} color={textSub} />
            </TouchableOpacity>

            <Modal
                visible={open}
                transparent
                animationType="fade"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setOpen(false)}
            >
                <View style={styles.ddOverlay}>
                    <Pressable
                        style={StyleSheet.absoluteFillObject}
                        onPress={() => setOpen(false)}
                    />
                    <View style={[styles.ddSheet, { backgroundColor: darkMode ? "#1F2937" : "#FFFFFF" }]}>
                        <View style={styles.ddHeaderRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.ddTitle, { color: accentColor, marginBottom: 0 }]}>{label}</Text>
                                {usePagination && (
                                    <Text style={{ fontSize: 11.5, color: textSub, marginTop: 2 }}>
                                        Showing {displayedOptions.length} of {filteredOptions.length}
                                    </Text>
                                )}
                            </View>
                            <TouchableOpacity
                                onPress={() => setOpen(false)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close" size={19} color={textSub} />
                            </TouchableOpacity>
                        </View>

                        {usePagination && (
                            <View
                                style={[
                                    styles.ddSearchBox,
                                    {
                                        backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                        borderColor: borderCol,
                                    },
                                ]}
                            >
                                <Ionicons name="search-outline" size={15} color={textSub} />
                                <TextInput
                                    style={[styles.ddSearchInput, { color: textMain }]}
                                    value={searchQuery}
                                    onChangeText={(txt) => {
                                        setSearchQuery(txt);
                                        setVisibleCount(initialVisibleCount || 5);
                                    }}
                                    placeholder="Search assessments..."
                                    placeholderTextColor={textSub}
                                    returnKeyType="search"
                                />
                                {searchQuery.length > 0 && (
                                    <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                                        <Ionicons name="close-circle" size={16} color={textSub} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

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
                        ) : displayedOptions.length === 0 ? (
                            <View style={{ paddingVertical: 22, alignItems: "center" }}>
                                <Text style={{ color: textSub, fontSize: 13 }}>
                                    No matching assessments found.
                                </Text>
                            </View>
                        ) : (
                            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
                                {displayedOptions.map((opt, idx) => (
                                    <TouchableOpacity
                                        key={`${opt}-${idx}`}
                                        style={[
                                            styles.ddItem,
                                            value === opt && { backgroundColor: accentColor + "18" },
                                        ]}
                                        onPress={() => { onSelect(opt); setOpen(false); }}
                                    >
                                        <Text
                                            style={[
                                                styles.ddItemText,
                                                { color: textMain, flex: 1, marginRight: 8 },
                                                value === opt && { color: accentColor, fontWeight: "700" },
                                            ]}
                                            numberOfLines={2}
                                        >
                                            {opt}
                                        </Text>
                                        {value === opt && (
                                            <Ionicons name="checkmark" size={16} color={accentColor} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}

                        {usePagination && filteredOptions.length > (initialVisibleCount || 5) && (
                            <View style={[styles.ddFooterActions, { borderTopColor: borderCol }]}>
                                {remainingCount > 0 ? (
                                    <>
                                        <TouchableOpacity
                                            style={[
                                                styles.ddFooterBtn,
                                                {
                                                    backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                                    borderColor: borderCol,
                                                },
                                            ]}
                                            onPress={() =>
                                                setVisibleCount((prev) => prev + (initialVisibleCount || 5))
                                            }
                                            activeOpacity={0.75}
                                        >
                                            <Text style={[styles.ddFooterBtnText, { color: textMain }]}>
                                                Show {Math.min(initialVisibleCount || 5, remainingCount)} More
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.ddFooterBtn,
                                                {
                                                    backgroundColor: accentColor + "16",
                                                    borderColor: accentColor + "40",
                                                },
                                            ]}
                                            onPress={() => setVisibleCount(filteredOptions.length)}
                                            activeOpacity={0.75}
                                        >
                                            <Text style={[styles.ddFooterBtnText, { color: accentColor }]}>
                                                View All ({filteredOptions.length})
                                            </Text>
                                        </TouchableOpacity>
                                    </>
                                ) : (
                                    <TouchableOpacity
                                        style={[
                                            styles.ddFooterBtn,
                                            {
                                                backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                                borderColor: borderCol,
                                            },
                                        ]}
                                        onPress={() => setVisibleCount(initialVisibleCount || 5)}
                                        activeOpacity={0.75}
                                    >
                                        <Text style={[styles.ddFooterBtnText, { color: textSub }]}>
                                            Show Less (Top {initialVisibleCount || 5})
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}
                    </View>
                </View>
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
    // 1. Grade against quiz (defaults to Auto-Detect from Test Paper unless explicitly launched for a quiz)
    const [publishedQuizzes, setPublishedQuizzes] = useState<StoredQuiz[]>([]);
    const [selectedQuiz, setSelectedQuiz] = useState(defaultSelectedQuiz || AUTO_DETECT_ASSESSMENT);
    const [gradedQuiz, setGradedQuiz] = useState<StoredQuiz | null>(null);
    const [wasAssessmentAutoDetected, setWasAssessmentAutoDetected] = useState(false);
    const [assessmentPickerOpen, setAssessmentPickerOpen] = useState(false);
    const [switchQuizVisibleCount, setSwitchQuizVisibleCount] = useState(5);
    const [switchQuizSearchQuery, setSwitchQuizSearchQuery] = useState("");
    const lastGradedImageRef = useRef<{ base64: string; mimeType: "image/jpeg" | "image/png" } | null>(null);

    // 2. Identify student sheet (functional with real database students)
    const [roster, setRoster] = useState<Student[]>(students);
    const [selectedStudent, setSelectedStudent] = useState("");
    const [matchedStudentId, setMatchedStudentId] = useState<string | null>(null);
    const [studentPickerOpen, setStudentPickerOpen] = useState(false);

    // ── Grading & Flow States ──────────────────────────────────────────────────
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [gradingLoading, setGradingLoading] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResponse | null>(null);
    const [scannedImageUri, setScannedImageUri] = useState<string | null>(null);
    const [reviewModalOpen, setReviewModalOpen] = useState(false);
    const [reviewInitialQNum, setReviewInitialQNum] = useState<number | undefined>(undefined);
    const [reviewFilterOnlyFlagged, setReviewFilterOnlyFlagged] = useState<boolean>(true);
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
    const skeuo = getSkeuoPalette(darkMode, accentColor);

    const bg = skeuo.canvas;
    const cardBg = skeuo.surface;
    const textMain = skeuo.textPrimary;
    const textSub = skeuo.textSecondary;
    const border = skeuo.border;
    const subBorder = skeuo.border;

    useEffect(() => {
        if (students !== undefined) {
            setRoster(students.map((s) => normalizeStudentRecord(s) as Student));
        } else if (classroomId) {
            supabase
                .from("students")
                .select("*")
                .eq("classroom_id", classroomId)
                .order("created_at", { ascending: true })
                .then(({ data }) => {
                    if (data) setRoster(data.map((row) => normalizeStudentRecord(row) as Student));
                });
        }
    }, [classroomId, students]);

    function toRosterMatchItems(list: Student[]) {
        return list.map((s) => ({
            id: s.id,
            full_name: s.full_name,
            last_name: s.last_name,
            first_name: s.first_name,
            middle_name: s.middle_name,
            email: s.email,
            average: s.average,
        }));
    }

    async function fetchLatestClassroomRoster(): Promise<Student[]> {
        const currentNormalized = roster.map((s) => normalizeStudentRecord(s) as Student);
        if (!classroomId) return currentNormalized;
        try {
            const { data, error } = await supabase
                .from("students")
                .select("*")
                .eq("classroom_id", classroomId)
                .order("created_at", { ascending: true });
            if (!error && Array.isArray(data)) {
                const dbStudents = data.map((row) => normalizeStudentRecord(row) as Student);
                // Merge any local entries not yet returned from Supabase
                const seenIds = new Set(dbStudents.map((s) => s.id));
                for (const local of currentNormalized) {
                    if (!seenIds.has(local.id)) {
                        dbStudents.push(local);
                    }
                }
                setRoster(dbStudents);
                return dbStudents;
            }
        } catch (err) {
            console.warn("[Grader] Could not refresh classroom roster from Supabase:", err);
        }
        return currentNormalized;
    }

    useEffect(() => {
        loadPublished();
    }, [classroomId, defaultSelectedQuiz]);

    async function loadPublished() {
        if (!classroomId) return;
        const stored = await getPublishedQuizzes(classroomId);
        setPublishedQuizzes(stored);
        if (defaultSelectedQuiz) {
            const matched = stored.find((q) => q.quizTitle === defaultSelectedQuiz);
            if (matched) {
                setSelectedQuiz(getDisambiguatedQuizLabel(matched, stored));
                return;
            }
        }
        if (stored.length > 0) {
            setSelectedQuiz((prev) => {
                if (!prev || prev === AUTO_DETECT_ASSESSMENT) return AUTO_DETECT_ASSESSMENT;
                const stillExists = stored.some(
                    (q) => q.quizTitle === prev || getDisambiguatedQuizLabel(q, stored) === prev
                );
                return stillExists ? prev : AUTO_DETECT_ASSESSMENT;
            });
        } else {
            setSelectedQuiz("");
        }
    }

    const quizOptionEntries = useMemo(
        () =>
            publishedQuizzes.map((q) => ({
                label: getDisambiguatedQuizLabel(q, publishedQuizzes),
                quiz: q,
            })),
        [publishedQuizzes]
    );

    const quizOptions = useMemo(() => {
        if (quizOptionEntries.length === 0) return [];
        return [
            AUTO_DETECT_ASSESSMENT,
            ...Array.from(new Set(quizOptionEntries.map((e) => e.label).filter(Boolean))),
        ];
    }, [quizOptionEntries]);

    const currentQuizValue =
        selectedQuiz && quizOptions.includes(selectedQuiz)
            ? selectedQuiz
            : quizOptions.length > 0
            ? AUTO_DETECT_ASSESSMENT
            : "";

    const isAutoDetectQuiz = currentQuizValue === AUTO_DETECT_ASSESSMENT;

    const activePublishedQuiz = useMemo(() => {
        if (isAutoDetectQuiz) {
            return gradedQuiz || publishedQuizzes[0];
        }
        const entry = quizOptionEntries.find(
            (e) => e.label === currentQuizValue || e.quiz.quizTitle === currentQuizValue
        );
        return entry?.quiz || publishedQuizzes[0];
    }, [isAutoDetectQuiz, gradedQuiz, quizOptionEntries, currentQuizValue, publishedQuizzes]);

    const studentOptions = Array.from(
        new Set([
            "Auto-Detect from Test Paper",
            ...(roster.length > 0
                ? roster.map((s) => `${s.full_name}${s.email ? ` (${s.email})` : ""}`)
                : []),
        ])
    );

    const currentStudentValue = selectedStudent || "Auto-Detect from Test Paper";

    // Count of items needing teacher review (unclear, crossed-out, double-marked, low confidence)
    const flaggedCount = useMemo(() => {
        if (!gradingResult || !Array.isArray(gradingResult.results)) return 0;
        return gradingResult.results.filter(isItemUnresolvedFlag).length;
    }, [gradingResult]);

    // ── Helper to optimize captured test paper for AI Vision ───────────────────
    async function prepareImageForGrading(asset: { uri: string; base64?: string | null }): Promise<{ base64: string; mimeType: "image/jpeg" }> {
        try {
            const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
            // Resize to 1800px width at 0.90 quality so tiny square answer boxes & cross-out strokes stay razor-sharp
            const manip = await manipulateAsync(
                asset.uri,
                [{ resize: { width: 1800 } }],
                { compress: 0.90, format: SaveFormat.JPEG, base64: true }
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
        const wasPickerOpen = sourceModalOpen;
        setSourceModalOpen(false);
        if (publishedQuizzes.length === 0) {
            if (wasPickerOpen) await waitForTransition(TRANSITION_EXIT_WAIT_MS);
            Alert.alert(
                "No Quizzes Available",
                "You haven't created any quizzes for this classroom yet. Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!"
            );
            return;
        }
        if (wasPickerOpen) {
            await waitForTransition(TRANSITION_HANDOFF_DELAY_MS);
        }
        setScannerMode("single");
        setBatchScannerOpen(true);
    }

    // Single sheet capture callback from Camera Grader (carries live scanned QR payload if seen)
    async function handleCaptureSingleSheet(uri: string, qrData?: string | null) {
        try {
            setScannedImageUri(uri);
            const [optimized] = await Promise.all([
                prepareImageForGrading({ uri }),
                waitForTransition(TRANSITION_HANDOFF_DELAY_MS),
            ]);
            if (optimized.base64) {
                void processGrading(optimized.base64, optimized.mimeType, qrData);
            } else {
                Alert.alert("Image Error", "Could not read camera capture data.");
            }
        } catch (err: any) {
            Alert.alert("Grading Error", err.message || "Failed to process captured test sheet.");
        }
    }

    // ── Choose from Library ────────────────────────────────────────────────────
    async function handlePickImage() {
        const wasPickerOpen = sourceModalOpen;
        setSourceModalOpen(false);
        try {
            if (wasPickerOpen) {
                await waitForTransition(TRANSITION_HANDOFF_DELAY_MS);
            }
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") {
                Alert.alert("Permission Required", "Photo library permission is required to select test papers.");
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.92,
                base64: true,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                setScannedImageUri(asset.uri);
                const optimized = await prepareImageForGrading(asset);
                if (optimized.base64) {
                    void processGrading(optimized.base64, optimized.mimeType);
                } else {
                    Alert.alert("Image Error", "Could not read photo data.");
                }
            }
        } catch (err: any) {
            Alert.alert("Picker Error", err.message || "Failed to select photo.");
        }
    }



    // ── Run AI Grading ─────────────────────────────────────────────────────────
    async function processGrading(
        base64Data: string,
        mimeType: "image/jpeg" | "image/png",
        qrData?: string | null,
        forcedQuiz?: StoredQuiz
    ) {
        setGradingLoading(true);
        setIsRecorded(false);
        setMatchedStudentId(null);
        lastGradedImageRef.current = { base64: base64Data, mimeType };
        try {
            if (publishedQuizzes.length === 0) {
                Alert.alert("No Quiz Selected", "Please select or create a quiz in the AI Builder tab first.");
                return;
            }

            // Resolve WHICH published assessment the paper belongs to (Auto-Detect or Manual)
            let published: StoredQuiz | undefined = forcedQuiz;
            let autoDetected = false;

            if (!published) {
                if (currentQuizValue === AUTO_DETECT_ASSESSMENT) {
                    const detected = await identifyAssessmentFromImage({
                        base64Image: base64Data,
                        mimeType,
                        publishedQuizzes,
                        qrData,
                    });
                    if (detected?.quiz) {
                        published = detected.quiz;
                        autoDetected = true;
                    } else {
                        published = publishedQuizzes[0];
                        autoDetected = false;
                    }
                } else {
                    const entry = quizOptionEntries.find(
                        (e) => e.label === currentQuizValue || e.quiz.quizTitle === currentQuizValue
                    );
                    published = entry?.quiz || publishedQuizzes[0];

                    // Even in manual mode, if the live camera QR code unmistakably identifies a different
                    // published assessment in this classroom, auto-switch so it never grades with the wrong key!
                    if (qrData) {
                        const qrMatch = matchAssessmentByQr(qrData, publishedQuizzes);
                        if (qrMatch?.quiz && qrMatch.quiz.id !== published?.id) {
                            published = qrMatch.quiz;
                            autoDetected = true;
                        }
                    }
                }
            }

            if (!published) {
                Alert.alert("No Quiz Selected", "Please select or create a quiz in the AI Builder tab first.");
                return;
            }

            setGradedQuiz(published);
            setWasAssessmentAutoDetected(autoDetected);

            const activeAnswerKey = published.answerKey;
            const latestRoster = await fetchLatestClassroomRoster();

            const result = await gradeStudentTest(
                base64Data,
                activeAnswerKey,
                mimeType,
                published.layoutJson,
                latestRoster
            );

            // Resolve against existing classroom roster (manual override first, otherwise smart fuzzy match)
            let resolvedStudent: Student | undefined;
            const isManualPick = Boolean(
                selectedStudent && selectedStudent !== "Auto-Detect from Test Paper"
            );
            if (isManualPick) {
                resolvedStudent = latestRoster.find(
                    (s) =>
                        selectedStudent === `${s.full_name}${s.email ? ` (${s.email})` : ""}` ||
                        selectedStudent === s.full_name
                );
            }

            if (!resolvedStudent && latestRoster.length > 0) {
                const fuzzyMatch = matchStudentToRoster(
                    result.studentName,
                    toRosterMatchItems(latestRoster),
                    {
                        lastName: result.lastName,
                        firstName: result.firstName,
                        middleName: result.middleName,
                    }
                );
                if (fuzzyMatch) {
                    resolvedStudent = latestRoster.find((s) => s.id === fuzzyMatch.student.id);
                }
            }

            if (resolvedStudent) {
                setMatchedStudentId(resolvedStudent.id);
                setGradingResult({
                    ...result,
                    studentName: resolvedStudent.full_name,
                    lastName: resolvedStudent.last_name || result.lastName,
                    firstName: resolvedStudent.first_name || result.firstName,
                    middleName: formatMiddleInitial(resolvedStudent.middle_name) || result.middleName || null,
                });
            } else {
                setMatchedStudentId(null);
                setGradingResult(result);
            }
            setGradingLoading(false);

            // Proactively alert the teacher if any answers were crossed out, scribbled, overwritten, or have low confidence
            const flaggedAnswers = (result.results || []).filter(isItemUnresolvedFlag);

            if (flaggedAnswers.length > 0) {
                await waitForTransition(TRANSITION_EXIT_WAIT_MS);
                const qListText = flaggedAnswers.map((f) => `Q#${f.questionNumber}`).join(", ");
                const firstFlaggedQ = flaggedAnswers[0].questionNumber;
                Alert.alert(
                    "⚠️ Answer Review Needed",
                    `Tseki detected ${flaggedAnswers.length} question${flaggedAnswers.length > 1 ? "s" : ""} (${qListText}) with crossed-out, overwritten, or low-confidence marks.\n\nInspect the zoomed photo of each flagged answer box and confirm the student's answer now?`,
                    [
                        {
                            text: "Review Now",
                            onPress: () => {
                                setReviewFilterOnlyFlagged(true);
                                setReviewInitialQNum(firstFlaggedQ);
                                setReviewModalOpen(true);
                            },
                        },
                        {
                            text: "Review Later",
                            style: "cancel",
                        },
                    ]
                );
            } else if (result.photoQuality?.hasWarnings && result.photoQuality.warnings.length > 0) {
                await waitForTransition(TRANSITION_EXIT_WAIT_MS);
                // Alert teacher if any of the photo quality conditions failed on this paper
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
        } catch (error: any) {
            console.error("Grading failed:", error);
            setGradingLoading(false);
            await waitForTransition(TRANSITION_EXIT_WAIT_MS);
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
                const maxPts = item.maxPoints || 1;
                return {
                    ...item,
                    isCorrect: nextCorrect,
                    pointsAwarded: nextCorrect ? maxPts : 0,
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

        if (flaggedCount > 0) {
            const firstFlagged = gradingResult.results.find(isItemUnresolvedFlag);
            const qList = gradingResult.results
                .filter(isItemUnresolvedFlag)
                .map((r) => `Q#${r.questionNumber}`)
                .join(", ");
            Alert.alert(
                "Unreviewed Flagged Answers",
                `${flaggedCount} question${flaggedCount > 1 ? "s" : ""} (${qList}) still need your verification before recording.`,
                [
                    {
                        text: "Review Now",
                        onPress: () => {
                            setReviewFilterOnlyFlagged(true);
                            setReviewInitialQNum(firstFlagged?.questionNumber);
                            setReviewModalOpen(true);
                        },
                    },
                    {
                        text: "Record Anyway",
                        style: "destructive",
                        onPress: () => {
                            void commitSingleRecord();
                        },
                    },
                    { text: "Cancel", style: "cancel" },
                ]
            );
            return;
        }

        await commitSingleRecord();
    }

    async function commitSingleRecord() {
        if (!gradingResult) return;
        setSavingScore(true);
        try {
            const percentage = Math.round((gradingResult.totalScore / (gradingResult.maxScore || 1)) * 100);
            const latestRoster = await fetchLatestClassroomRoster();

            // 1. Resolve matching student in existing classroom roster (NEVER create duplicate if registered)
            let student: Student | undefined;
            if (matchedStudentId) {
                student = latestRoster.find((s) => s.id === matchedStudentId);
            }

            if (!student && selectedStudent && selectedStudent !== "Auto-Detect from Test Paper") {
                student = latestRoster.find(
                    (s) =>
                        selectedStudent === `${s.full_name}${s.email ? ` (${s.email})` : ""}` ||
                        selectedStudent === s.full_name
                );
            }

            if (!student && latestRoster.length > 0) {
                const fuzzyMatch = matchStudentToRoster(
                    gradingResult.studentName,
                    toRosterMatchItems(latestRoster),
                    {
                        lastName: gradingResult.lastName,
                        firstName: gradingResult.firstName,
                        middleName: gradingResult.middleName,
                    }
                );
                if (fuzzyMatch) {
                    student = latestRoster.find((s) => s.id === fuzzyMatch.student.id);
                }
            }

            if (!student && classroomId) {
                // Genuinely new student not in classroom roster — format strictly as "Lastname, Firstname M."
                const rawNewName =
                    gradingResult.studentName &&
                    gradingResult.studentName !== "Unknown" &&
                    gradingResult.studentName !== "Student"
                        ? gradingResult.studentName
                        : `Student ${latestRoster.length + 1}`;
                const parsedParts = splitStudentFullName(rawNewName);
                const resolvedLastName = toSmartTitleCase(
                    gradingResult.lastName?.trim() || parsedParts.last_name || ""
                );
                const resolvedFirstName = toSmartTitleCase(
                    gradingResult.firstName?.trim() || parsedParts.first_name || ""
                );
                const resolvedMiddleInitial =
                    formatMiddleInitial(gradingResult.middleName ?? parsedParts.middle_name) || null;
                const formattedFullName = formatStudentFullName({
                    last_name: resolvedLastName,
                    first_name: resolvedFirstName,
                    middle_name: resolvedMiddleInitial,
                    full_name: rawNewName,
                }) || rawNewName;

                let { data, error } = await supabase
                    .from("students")
                    .insert({
                        classroom_id: classroomId,
                        last_name: resolvedLastName,
                        first_name: resolvedFirstName,
                        middle_name: resolvedMiddleInitial,
                        full_name: formattedFullName,
                        email: null,
                        attendance: 100,
                        average: percentage,
                    })
                    .select()
                    .single();

                if (error && (error.code === "PGRST204" || error.message?.includes("last_name") || error.message?.includes("first_name"))) {
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
                    setMatchedStudentId(newStudent.id);
                    setRoster((prev) => (prev.some((s) => s.id === newStudent.id) ? prev : [...prev, newStudent]));
                    onStudentCreated?.(newStudent);
                }
            } else if (student) {
                setMatchedStudentId(student.id);
            }

            // Record to quiz performance history for tracker trend
            const targetQuiz = gradedQuiz || activePublishedQuiz;
            const quizTitleToRecord =
                targetQuiz?.quizTitle ||
                (currentQuizValue && currentQuizValue !== AUTO_DETECT_ASSESSMENT
                    ? currentQuizValue
                    : "Assessment 1");
            if (classroomId) {
                await saveQuizPerformanceRecord(classroomId, quizTitleToRecord, percentage);

                // Persist per-question results for pedagogical analysis
                const resolvedStudentId = student ? student.id : (gradingResult.studentName || "student");
                const resolvedStudentName = student ? student.full_name : (gradingResult.studentName && gradingResult.studentName !== "Unknown" ? gradingResult.studentName : "Student");
                await saveStudentQuizResult({
                    studentId: resolvedStudentId,
                    studentName: resolvedStudentName,
                    classroomId,
                    quizId: targetQuiz?.id || null,
                    quizTitle: quizTitleToRecord,
                    scorePercentage: percentage,
                    totalScore: gradingResult.totalScore,
                    maxScore: gradingResult.maxScore,
                    results: gradingResult.results.map((r) => {
                        const matchedQuestion = targetQuiz?.questions?.find(
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

                // Capture prior average before recalculation for score-drop detection
                const priorAverage =
                    student && typeof student.average === "number" && student.average > 0
                        ? student.average
                        : undefined;

                // Automatically update student's cumulative average across all recorded assessments
                let finalAvg = percentage;
                if (student) {
                    const updatedCumulativeAvg = await recalculateStudentAverage(student.id, classroomId);
                    finalAvg = updatedCumulativeAvg >= 0 ? updatedCumulativeAvg : percentage;
                    if (updatedCumulativeAvg < 0) {
                        await supabase
                            .from("students")
                            .update({ average: finalAvg })
                            .eq("id", student.id);
                    }
                    setRoster((prev) =>
                        prev.map((s) => (s.id === student!.id ? { ...s, average: finalAvg } : s))
                    );
                }

                // Evaluate cumulative average & sudden score drop against teacher's alert preferences
                const alertStudentName = student
                    ? student.full_name
                    : gradingResult.studentName && gradingResult.studentName !== "Unknown"
                        ? gradingResult.studentName
                        : "Student";
                const alertStudentId = student ? student.id : gradingResult.studentName || "student";
                await evaluateAndRecordStudentAlert({
                    studentId: alertStudentId,
                    studentName: alertStudentName,
                    classroomId,
                    classroomTitle: classTitle || "Classroom",
                    classroomColor: accentColor || "#EA580C",
                    cumulativeAverage: finalAvg,
                    quizScorePercentage: percentage,
                    previousAverage: priorAverage,
                    rawScore: gradingResult.totalScore,
                    maxScore: gradingResult.maxScore,
                    quizTitle: quizTitleToRecord,
                });

                if (student) {
                    onScoreRecorded?.(student.id, finalAvg);
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
    const getOrCreateBatchQueue = (rosterOverride?: Student[]) => {
        const published = activePublishedQuiz;
        const activeAnswerKey = published?.answerKey || [];
        const matchRoster = toRosterMatchItems(rosterOverride || roster);

        if (!batchQueueRef.current) {
            batchQueueRef.current = new BatchGradingQueue({
                answerKey: activeAnswerKey,
                layoutJson: published?.layoutJson,
                selectedQuizId: published?.id,
                selectedQuizTitle: published?.quizTitle,
                autoDetectAssessment: isAutoDetectQuiz,
                publishedQuizzes,
                roster: matchRoster,
                onProgress: (updatedItems) => {
                    setBatchItems([...updatedItems]);
                },
                concurrency: 1,
            });
        } else {
            batchQueueRef.current.updateOptions({
                answerKey: activeAnswerKey,
                layoutJson: published?.layoutJson,
                selectedQuizId: published?.id,
                selectedQuizTitle: published?.quizTitle,
                autoDetectAssessment: isAutoDetectQuiz,
                publishedQuizzes,
                roster: matchRoster,
            });
        }
        return batchQueueRef.current;
    };

    const handleStartBatchScanner = async () => {
        if (publishedQuizzes.length === 0) {
            Alert.alert(
                "No Quizzes Available",
                "Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!"
            );
            return;
        }
        const latestRoster = await fetchLatestClassroomRoster();
        getOrCreateBatchQueue(latestRoster);
        setScannerMode("batch");
        setBatchScannerOpen(true);
    };

    const handleBatchCaptureSheet = (uri: string, qrData?: string | null) => {
        const q = getOrCreateBatchQueue();
        q.enqueueImages([{ uri, qrData }]);
    };

    const handleBatchImportSheets = (uris: string[]) => {
        const q = getOrCreateBatchQueue();
        q.enqueueImages(uris);
    };

    const handleFinishAndReview = async () => {
        const wasScannerOpen = batchScannerOpen;
        setBatchScannerOpen(false);
        if (wasScannerOpen) {
            await waitForTransition(TRANSITION_HANDOFF_DELAY_MS);
        }
        setBatchReviewOpen(true);

        const itemsWithWarnings = batchItems.filter(
            (i) => i.photoQuality?.hasWarnings && i.photoQuality.warnings.length > 0
        );
        if (itemsWithWarnings.length > 0) {
            await waitForTransition(220);
            const summaryLines = itemsWithWarnings.slice(0, 4).map((item, idx) => {
                const name = item.matchedStudentName || item.studentNameExtracted || `Sheet #${idx + 1}`;
                return `• ${name}: ${item.photoQuality!.warnings.join(" ")}`;
            });
            if (itemsWithWarnings.length > 4) {
                summaryLines.push(`...and ${itemsWithWarnings.length - 4} more sheet(s).`);
            }
            Alert.alert(
                "⚠️ Batch Scan Photo Quality Alert",
                `${itemsWithWarnings.length} scanned paper${itemsWithWarnings.length > 1 ? "s have" : " has"} lighting, QR code, or 4 corner marker warnings:\n\n` +
                    summaryLines.join("\n\n") +
                    "\n\nPlease inspect flagged sheets in the Batch Review Dashboard.",
                [{ text: "Review Sheets" }]
            );
        }
    };

    const handleScanMoreInBatch = async () => {
        setBatchReviewOpen(false);
        await waitForTransition(TRANSITION_HANDOFF_DELAY_MS);
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
        const fallbackQuiz = activePublishedQuiz;
        const fallbackQuizTitle =
            fallbackQuiz?.quizTitle ||
            (currentQuizValue && currentQuizValue !== AUTO_DETECT_ASSESSMENT
                ? currentQuizValue
                : "Assessment");

        try {
            let updatedRoster = await fetchLatestClassroomRoster();

            for (const item of approvedItems) {
                if (!item.gradingResult) continue;

                const percentage = Math.round(
                    (item.gradingResult.totalScore / (item.gradingResult.maxScore || 1)) * 100
                );

                let student: Student | undefined = item.matchedStudentId
                    ? updatedRoster.find((s) => s.id === item.matchedStudentId)
                    : undefined;

                if (!student && updatedRoster.length > 0) {
                    const fuzzyMatch = matchStudentToRoster(
                        item.matchedStudentName || item.studentNameExtracted,
                        toRosterMatchItems(updatedRoster),
                        {
                            lastName: item.gradingResult.lastName,
                            firstName: item.gradingResult.firstName,
                            middleName: item.gradingResult.middleName,
                        }
                    );
                    if (fuzzyMatch) {
                        student = updatedRoster.find((s) => s.id === fuzzyMatch.student.id);
                    }
                }

                if (!student && classroomId) {
                    const rawNewName =
                        item.matchedStudentName ||
                        (item.studentNameExtracted &&
                        item.studentNameExtracted !== "Unknown" &&
                        item.studentNameExtracted !== "Student"
                            ? item.studentNameExtracted
                            : `Student ${updatedRoster.length + 1}`);
                    const parsedParts = splitStudentFullName(rawNewName);
                    const resolvedLastName = toSmartTitleCase(
                        item.gradingResult.lastName?.trim() || parsedParts.last_name || ""
                    );
                    const resolvedFirstName = toSmartTitleCase(
                        item.gradingResult.firstName?.trim() || parsedParts.first_name || ""
                    );
                    const resolvedMiddleInitial =
                        formatMiddleInitial(item.gradingResult.middleName ?? parsedParts.middle_name) || null;
                    const formattedFullName = formatStudentFullName({
                        last_name: resolvedLastName,
                        first_name: resolvedFirstName,
                        middle_name: resolvedMiddleInitial,
                        full_name: rawNewName,
                    }) || rawNewName;

                    let { data, error } = await supabase
                        .from("students")
                        .insert({
                            classroom_id: classroomId,
                            last_name: resolvedLastName,
                            first_name: resolvedFirstName,
                            middle_name: resolvedMiddleInitial,
                            full_name: formattedFullName,
                            email: null,
                            attendance: 100,
                            average: percentage,
                        })
                        .select()
                        .single();

                    if (error && (error.code === "PGRST204" || error.message?.includes("last_name") || error.message?.includes("first_name"))) {
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
                    }
                }

                // Record quiz trend and question analysis (under each sheet's own auto-detected or selected assessment)
                if (classroomId && student) {
                    const itemQuiz =
                        (item.matchedQuizId && publishedQuizzes.find((q) => q.id === item.matchedQuizId)) ||
                        (item.matchedQuizTitle && publishedQuizzes.find((q) => q.quizTitle === item.matchedQuizTitle)) ||
                        fallbackQuiz;
                    const itemQuizTitle = item.matchedQuizTitle || itemQuiz?.quizTitle || fallbackQuizTitle;

                    await saveQuizPerformanceRecord(classroomId, itemQuizTitle, percentage);

                    await saveStudentQuizResult({
                        studentId: student.id,
                        studentName: student.full_name,
                        classroomId,
                        quizId: itemQuiz?.id || item.matchedQuizId || null,
                        quizTitle: itemQuizTitle,
                        scorePercentage: percentage,
                        totalScore: item.gradingResult.totalScore,
                        maxScore: item.gradingResult.maxScore,
                        results: item.gradingResult.results.map((r) => {
                            const matchedQuestion = itemQuiz?.questions?.find(
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

                    // Capture prior average before recalculation for score-drop detection
                    const priorAverage =
                        typeof student.average === "number" && student.average > 0
                            ? student.average
                            : undefined;

                    // Automatically update student's cumulative average across all assessments
                    const updatedCumulativeAvg = await recalculateStudentAverage(student.id, classroomId);
                    const finalAvg = updatedCumulativeAvg >= 0 ? updatedCumulativeAvg : percentage;
                    if (updatedCumulativeAvg < 0) {
                        await supabase
                            .from("students")
                            .update({ average: finalAvg })
                            .eq("id", student.id);
                    }
                    updatedRoster = updatedRoster.map((s) =>
                        s.id === student!.id ? { ...s, average: finalAvg } : s
                    );

                    await evaluateAndRecordStudentAlert({
                        studentId: student.id,
                        studentName: student.full_name,
                        classroomId,
                        classroomTitle: classTitle || "Classroom",
                        classroomColor: accentColor || "#EA580C",
                        cumulativeAverage: finalAvg,
                        quizScorePercentage: percentage,
                        previousAverage: priorAverage,
                        rawScore: item.gradingResult.totalScore,
                        maxScore: item.gradingResult.maxScore,
                        quizTitle: itemQuizTitle,
                    });

                    onScoreRecorded?.(student.id, finalAvg);
                }
            }

            setRoster(updatedRoster);
            setBatchReviewOpen(false);
            batchQueueRef.current?.clear();
            setBatchItems([]);

            await waitForTransition(TRANSITION_EXIT_WAIT_MS);

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
            <SmoothStageTransition transitionKey={gradingResult ? "graded" : "launcher"}>
            {/* ───────────────────────────────────────────────────────────────────
                CASE 1: SCANNED RESULTS VIEW (Inline, exactly matches user's images)
            ────────────────────────────────────────────────────────────────────── */}
            {gradingResult ? (
                <View style={styles.resultsContainer}>
                    {/* ── Action Buttons Row ── */}
                    <View style={styles.actionButtonsRow}>
                        {/* Left: Scan Another Sheet */}
                        <TouchableOpacity
                            style={[styles.scanAnotherBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 12 })]}
                            onPress={() => setSourceModalOpen(true)}
                            activeOpacity={0.75}
                        >
                            <Ionicons name="sync-outline" size={18} color={textMain} />
                            <Text style={[styles.scanAnotherBtnText, { color: textMain }]}>Scan Another Sheet</Text>
                        </TouchableOpacity>

                        {/* Right: Approve & Record OR Recorded to Class Record! */}
                        {isRecorded ? (
                            <View style={[styles.recordedBadge, darkMode && { backgroundColor: "#112921", borderColor: "#1E5B47" }]}>
                                <Ionicons name="checkmark" size={18} color={darkMode ? "#34D399" : "#059669"} />
                                <Text style={[styles.recordedBadgeText, darkMode && { color: "#A7F3D0" }]}>Recorded to Class Record!</Text>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={[styles.approveBtn, skeuoButtonStyle(skeuo, { fill: accentColor || "#EA580C", radius: 12 })]}
                                onPress={handleApproveAndRecord}
                                disabled={savingScore}
                                activeOpacity={0.85}
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
                        <View style={[styles.syncBanner, darkMode && { backgroundColor: "#112921", borderColor: "#1E5B47" }]}>
                            <Ionicons name="shield-checkmark-outline" size={24} color={darkMode ? "#34D399" : "#059669"} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.syncBannerTitle, darkMode && { color: "#A7F3D0" }]}>Roster Synchronized Successfully</Text>
                                <Text style={[styles.syncBannerSub, darkMode && { color: "#6EE7B7" }]}>Grades are mapped to the spreadsheet dynamically.</Text>
                            </View>
                        </View>
                    )}

                    {/* ── Scanned Student Sheet Card ── */}
                    <View style={[styles.scannedCard, skeuoCardStyle(skeuo, 18)]}>
                        {/* Dark Header Banner */}
                        <View style={[styles.darkCardHeader, { backgroundColor: darkMode ? "#16191F" : "#1C1917" }]}>
                            <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                                <Text style={styles.cardHeaderSub}>SCANNED STUDENT SHEET</Text>
                                <Text style={styles.cardStudentName} numberOfLines={1}>
                                    {(matchedStudentId && roster.find((s) => s.id === matchedStudentId)?.full_name) ||
                                        gradingResult.studentName ||
                                        "Student"}
                                </Text>
                                {(gradedQuiz || activePublishedQuiz) && (
                                    <TouchableOpacity
                                        onPress={() => {
                                            if (!isRecorded && publishedQuizzes.length > 1) {
                                                setSwitchQuizVisibleCount(5);
                                                setSwitchQuizSearchQuery("");
                                                setAssessmentPickerOpen(true);
                                            }
                                        }}
                                        disabled={isRecorded || publishedQuizzes.length <= 1}
                                        activeOpacity={0.75}
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            alignSelf: "flex-start",
                                            gap: 5,
                                            marginTop: 6,
                                            paddingHorizontal: 8,
                                            paddingVertical: 3,
                                            borderRadius: 6,
                                            backgroundColor: wasAssessmentAutoDetected
                                                ? "rgba(59, 130, 246, 0.22)"
                                                : "rgba(148, 163, 184, 0.18)",
                                            maxWidth: "100%",
                                        }}
                                    >
                                        <Ionicons
                                            name={wasAssessmentAutoDetected ? "sparkles" : "document-text-outline"}
                                            size={11}
                                            color={wasAssessmentAutoDetected ? "#93C5FD" : "#CBD5E1"}
                                        />
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: wasAssessmentAutoDetected ? "#BFDBFE" : "#E2E8F0",
                                                flexShrink: 1,
                                            }}
                                            numberOfLines={1}
                                        >
                                            {wasAssessmentAutoDetected ? "Auto-Detected: " : ""}
                                            {(gradedQuiz || activePublishedQuiz)?.quizTitle}
                                            {!isRecorded && publishedQuizzes.length > 1 ? " · Change" : ""}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                {roster.length > 0 && !isRecorded && (
                                    <TouchableOpacity
                                        onPress={() => setStudentPickerOpen(true)}
                                        activeOpacity={0.75}
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            alignSelf: "flex-start",
                                            gap: 5,
                                            marginTop: 5,
                                            paddingHorizontal: 8,
                                            paddingVertical: 3,
                                            borderRadius: 6,
                                            backgroundColor: matchedStudentId
                                                ? "rgba(16, 185, 129, 0.18)"
                                                : "rgba(245, 158, 11, 0.20)",
                                        }}
                                    >
                                        <Ionicons
                                            name={matchedStudentId ? "checkmark-circle" : "person-add-outline"}
                                            size={12}
                                            color={matchedStudentId ? "#34D399" : "#FBBF24"}
                                        />
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: matchedStudentId ? "#A7F3D0" : "#FDE68A",
                                            }}
                                            numberOfLines={1}
                                        >
                                            {matchedStudentId
                                                ? "Matched to Roster · Change"
                                                : "New Student · Link to Roster"}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            <View style={[styles.scoreBadgePill, { backgroundColor: accentColor || "#F97316" }]}>
                                <Text style={styles.scoreBadgePillText}>
                                    {gradingResult.totalScore} / {gradingResult.maxScore}
                                </Text>
                            </View>
                        </View>

                        {/* ── Alerts & Grading Log Header Section ── */}
                        <View style={styles.cardTopSection}>
                            {/* ── Photo Quality Alert Banner (Single Paper) ── */}
                            {gradingResult.photoQuality?.hasWarnings &&
                                gradingResult.photoQuality.warnings.length > 0 && (
                                    <View
                                        style={[
                                            styles.compactAlertBanner,
                                            {
                                                backgroundColor: darkMode ? "#450A0A30" : "#FEF2F2",
                                                borderColor: "#EF4444",
                                            },
                                        ]}
                                    >
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                                            <Ionicons name="warning" size={16} color="#DC2626" />
                                            <Text
                                                style={[
                                                    styles.compactAlertText,
                                                    { color: darkMode ? "#FCA5A5" : "#991B1B" },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                Photo Quality: {gradingResult.photoQuality.warnings[0] || "Markers not aligned"}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.compactAlertBtn, { backgroundColor: "#EF4444" }]}
                                            onPress={handleOpenCamera}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons name="camera-outline" size={13} color="#FFF" style={{ marginRight: 4 }} />
                                            <Text style={styles.compactAlertBtnText}>Retake</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}

                            {/* ── Flagged Items Banner ── */}
                            {flaggedCount > 0 && (
                                <View
                                    style={[
                                        styles.compactAlertBanner,
                                        {
                                            backgroundColor: darkMode ? "#78350F25" : "#FFFBEB",
                                            borderColor: "#F59E0B",
                                        },
                                    ]}
                                >
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                                        <Ionicons name="alert-circle" size={16} color="#D97706" />
                                        <Text
                                            style={[
                                                styles.compactAlertText,
                                                { color: darkMode ? "#FDE68A" : "#92400E" },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {flaggedCount} {flaggedCount === 1 ? "answer needs" : "answers need"} your review
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.compactAlertBtn, { backgroundColor: "#F59E0B" }]}
                                        onPress={() => {
                                            const firstFlagged = gradingResult?.results?.find(isItemUnresolvedFlag);
                                            setReviewFilterOnlyFlagged(true);
                                            setReviewInitialQNum(firstFlagged ? firstFlagged.questionNumber : undefined);
                                            setReviewModalOpen(true);
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.compactAlertBtnText}>Review →</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Section Header: Interactive Grading Log & Inspect Sheet CTA */}
                            <View style={[styles.gradingLogHeader, { gap: 10 }]}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={[styles.gradingLogTitle, { color: textSub }]} numberOfLines={1}>
                                        Interactive Grading Log
                                    </Text>
                                    <Text style={[styles.gradingLogCount, { color: darkMode ? "#94A3B8" : "#64748B", marginTop: 1 }]}>
                                        {gradingResult.results.length} {gradingResult.results.length === 1 ? "question" : "questions"}
                                    </Text>
                                </View>
                                {scannedImageUri && (
                                    <TouchableOpacity
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            gap: 5,
                                            paddingHorizontal: 10,
                                            paddingVertical: 6,
                                            borderRadius: 8,
                                            borderWidth: 1,
                                            borderColor: border,
                                            backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                                            flexShrink: 0,
                                        }}
                                        onPress={() => {
                                            setReviewFilterOnlyFlagged(false);
                                            setReviewInitialQNum(1);
                                            setReviewModalOpen(true);
                                        }}
                                        activeOpacity={0.75}
                                    >
                                        <Ionicons name="scan-outline" size={13} color={textSub} />
                                        <Text style={{ fontSize: 11.5, fontWeight: "600", color: textMain }}>
                                            Inspect Sheet
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>

                        {/* Flush Edge-to-Edge Q1–Q10 Table */}
                        <View
                            style={[
                                styles.gradingTableFlush,
                                {
                                    borderTopWidth: 1,
                                    borderTopColor: darkMode ? "#334155" : "#E2E8F0",
                                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                                },
                            ]}
                        >
                            {gradingResult.results.map((item, idx) => {
                                const isFlagged = isItemUnresolvedFlag(item);
                                const isLast = idx === gradingResult.results.length - 1;

                                let studentDisplay = item.studentAnswer || "—";
                                let studentColor = "#475569";
                                if (isFlagged) {
                                    const rawAns = (item.studentAnswer || "").trim();
                                    if (!rawAns || rawAns === "?") {
                                        studentDisplay =
                                            item.detectedOptions && item.detectedOptions.length >= 2
                                                ? `${item.detectedOptions.slice(0, 2).join("/")}?`
                                                : "Unclear";
                                    } else {
                                        studentDisplay = rawAns.endsWith("?") ? rawAns : `${rawAns}?`;
                                    }
                                    studentColor = "#D97706";
                                } else {
                                    studentColor = item.isCorrect ? "#16A34A" : "#DC2626";
                                }

                                return (
                                    <TouchableOpacity
                                        key={item.questionNumber}
                                        style={[
                                            styles.tableRow,
                                            !isLast && {
                                                borderBottomWidth: 1,
                                                borderBottomColor: darkMode ? "#334155" : "#F1F5F9",
                                            },
                                            isFlagged && {
                                                backgroundColor: darkMode ? "#78350F14" : "#FFFDF5",
                                                borderLeftWidth: 3,
                                                borderLeftColor: "#F59E0B",
                                            },
                                        ]}
                                        onPress={() => {
                                            if (isFlagged) {
                                                setReviewFilterOnlyFlagged(true);
                                                setReviewInitialQNum(item.questionNumber);
                                                setReviewModalOpen(true);
                                            } else {
                                                handleToggleQuestion(item.questionNumber);
                                            }
                                        }}
                                        activeOpacity={0.7}
                                    >
                                        {/* Left Column (width: 38px): Q1–Q10 */}
                                        <Text style={[styles.tableQNum, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                                            Q{item.questionNumber}
                                        </Text>

                                        {/* Middle Column (flex: 1): Student: B · Key: B */}
                                        <View style={styles.tableRowMiddle}>
                                            <Text style={[styles.tableAnswerText, { color: darkMode ? "#94A3B8" : "#475569" }]}>
                                                Student:{" "}
                                                <Text
                                                    style={{
                                                        fontWeight: "700",
                                                        color: studentColor,
                                                    }}
                                                >
                                                    {studentDisplay}
                                                </Text>
                                                {"  ·  "}
                                                Key:{" "}
                                                <Text style={{ fontWeight: "700", color: darkMode ? "#F8FAFC" : "#0F172A" }}>
                                                    {item.correctAnswer}
                                                </Text>
                                            </Text>
                                        </View>

                                        {/* Right Column (flexShrink: 0, alignItems: 'flex-end'): Check / Cross / Unclear › pill */}
                                        <View style={styles.tableRowRight}>
                                            {isFlagged ? (
                                                <View
                                                    style={[
                                                        styles.unclearGhostPill,
                                                        darkMode && { backgroundColor: "#78350F30", borderColor: "#92400E" },
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.unclearGhostPillText,
                                                            darkMode && { color: "#FDE68A" },
                                                        ]}
                                                    >
                                                        Unclear ›
                                                    </Text>
                                                </View>
                                            ) : item.isCorrect ? (
                                                <Ionicons name="checkmark" size={18} color="#16A34A" />
                                            ) : (
                                                <Ionicons name="close" size={18} color="#DC2626" />
                                            )}
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Tseki Approved Scan Banner (Only shown when all flags are resolved) */}
                        {flaggedCount === 0 && (
                            <View style={styles.cardBottomSection}>
                                <View style={[styles.approvedScanCard, { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border }]}>
                                    <Image
                                        source={require("../assets/images/logo.png")}
                                        style={styles.approvedScanMascot}
                                        resizeMode="contain"
                                    />
                                    <View style={styles.approvedScanInfo}>
                                        <Text style={[styles.approvedScanTitle, { color: textMain }]}>Tseki Approved Scan</Text>
                                        <Text style={[styles.approvedScanSub, { color: textSub }]}>
                                            This answer sheet has been verified against {(gradedQuiz || activePublishedQuiz)?.quizTitle || "the assessment"}. Ready for class record update.
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            ) : (
                /* ───────────────────────────────────────────────────────────────────
                    CASE 2: INITIAL SCAN LAUNCHER (Before scan)
                ────────────────────────────────────────────────────────────────────── */
                <View style={[styles.launcherCard, skeuoCardStyle(skeuo, 18)]}>
                    <View style={styles.launcherHeader}>
                        <View style={[styles.launcherIconCircle, skeuoWellStyle(skeuo, 12), { backgroundColor: skeuo.accentSoft, borderColor: skeuo.accentSoftBorder }]}>
                            <Ionicons name="camera" size={18} color={accentColor || "#EA580C"} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.launcherTitle, { color: textMain }]}>Tseki Smart Vision Grader</Text>
                        </View>
                    </View>

                    <View style={[skeuoGrooveStyle(skeuo), { marginVertical: 14 }]} />

                    {/* Mode Toggle Pills: Single vs Batch */}
                    <View style={[styles.modeToggleRow, skeuoWellStyle(skeuo, 12)]}>
                        <TouchableOpacity
                            style={[
                                styles.modePill,
                                gradingMode === "single" && skeuoButtonStyle(skeuo, { neutral: true, radius: 9 }),
                            ]}
                            onPress={() => setGradingMode("single")}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name="document-text-outline"
                                size={15}
                                color={gradingMode === "single" ? (accentColor || "#EA580C") : textSub}
                            />
                            <Text
                                style={[
                                    styles.modePillText,
                                    gradingMode === "single"
                                        ? { color: accentColor || "#EA580C", fontWeight: "800" }
                                        : { color: textSub },
                                ]}
                            >
                                Single Paper
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.modePill,
                                gradingMode === "batch" && skeuoButtonStyle(skeuo, { neutral: true, radius: 9 }),
                            ]}
                            onPress={() => setGradingMode("batch")}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name="flash"
                                size={15}
                                color={gradingMode === "batch" ? (accentColor || "#EA580C") : textSub}
                            />
                            <Text
                                style={[
                                    styles.modePillText,
                                    gradingMode === "batch"
                                        ? { color: accentColor || "#EA580C", fontWeight: "800" }
                                        : { color: textSub },
                                ]}
                            >
                                Batch Scan Class
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {gradingMode === "single" ? (
                        <>
                            {/* Select assessment */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>Select assessment</Text>
                                <Dropdown
                                    label="Select assessment"
                                    value={currentQuizValue}
                                    placeholder="No quizzes created yet"
                                    options={quizOptions}
                                    onSelect={setSelectedQuiz}
                                    accentColor={accentColor}
                                    initialVisibleCount={5}
                                />
                            </View>

                            {/* Student identification */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>Student identification</Text>
                                <Dropdown
                                    label="Student identification"
                                    value={currentStudentValue}
                                    options={studentOptions}
                                    onSelect={setSelectedStudent}
                                    accentColor={accentColor}
                                />
                            </View>

                            {/* Primary Scan Button */}
                            <TouchableOpacity
                                style={[styles.primaryScanBtn, skeuoButtonStyle(skeuo, { fill: accentColor || "#EA580C", radius: 14 })]}
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
                                activeOpacity={0.85}
                            >
                                <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryScanBtnText}>Open Camera & Scan</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            {/* Select assessment */}
                            <View style={styles.fieldGroup}>
                                <Text style={[styles.fieldLabel, { color: textSub }]}>Select assessment</Text>
                                <Dropdown
                                    label="Select assessment"
                                    value={currentQuizValue}
                                    placeholder="No quizzes created yet"
                                    options={quizOptions}
                                    onSelect={setSelectedQuiz}
                                    accentColor={accentColor}
                                    initialVisibleCount={5}
                                />
                            </View>

                            {/* Batch Info Card */}
                            <View style={[styles.batchInfoCard, skeuoWellStyle(skeuo, 12), { backgroundColor: skeuo.accentSoft, borderColor: skeuo.accentSoftBorder }]}>
                                <View style={[styles.batchInfoIconBg, { backgroundColor: (accentColor || "#EA580C") + "20" }]}>
                                    <Ionicons name="flash" size={20} color={accentColor || "#EA580C"} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.batchInfoTitle, { color: darkMode ? "#FDBA74" : "#9A3412" }]}>
                                        Continuous Batch Scanner
                                    </Text>
                                    <Text style={[styles.batchInfoSub, { color: darkMode ? "#FED7AA" : "#7C2D12" }]}>
                                        Keep the camera open and snap your entire stack of test papers without stopping. The AI grades in the background and auto-matches students from the {roster.length}-student roster.
                                    </Text>
                                </View>
                            </View>

                            {/* Start Continuous Batch Scanner Button */}
                            <TouchableOpacity
                                style={[styles.primaryScanBtn, skeuoButtonStyle(skeuo, { fill: accentColor || "#EA580C", radius: 14 })]}
                                onPress={handleStartBatchScanner}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="flash-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryScanBtnText}>Start Batch Scanner</Text>
                            </TouchableOpacity>

                            {/* View Current Batch If Exists */}
                            {batchItems.length > 0 && (
                                <TouchableOpacity
                                    style={[styles.batchViewBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 12 }), { borderColor: accentColor || "#EA580C" }]}
                                    onPress={handleFinishAndReview}
                                    activeOpacity={0.75}
                                >
                                    <Ionicons name="documents-outline" size={18} color={accentColor || "#EA580C"} />
                                    <Text style={[styles.batchViewBtnText, { color: accentColor || "#EA580C" }]}>
                                        View Scanned Batch ({batchItems.length} Papers)
                                    </Text>
                                    <Ionicons name="chevron-forward" size={16} color={accentColor || "#EA580C"} />
                                </TouchableOpacity>
                            )}
                        </>
                    )}

                </View>
            )}
            </SmoothStageTransition>

            {/* ── Source Picker Modal ── */}
            <SmoothBottomSheetModal
                visible={sourceModalOpen}
                onClose={() => setSourceModalOpen(false)}
                sheetStyle={[styles.actionSheet, skeuoCardStyle(skeuo, 22), { backgroundColor: cardBg }]}
            >
                <View style={[styles.sheetDragHandle, { backgroundColor: skeuo.borderStrong }]} />

                <View style={styles.actionSheetHeader}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[styles.actionSheetTitle, { color: textMain }]}>Scan Student Test Sheet</Text>
                        <Text style={[styles.actionSheetSub, { color: textSub }]}>Choose how to provide the handwritten test paper</Text>
                    </View>
                    <TouchableOpacity
                        onPress={() => setSourceModalOpen(false)}
                        style={[styles.sheetCloseBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 16 })]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="close" size={16} color={textSub} />
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={[styles.sheetBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 14 })]}
                    onPress={handleOpenCamera}
                    activeOpacity={0.75}
                >
                    <View style={[styles.neutralOptionIcon, skeuoWellStyle(skeuo, 10)]}>
                        <Ionicons name="camera-outline" size={18} color={textMain} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.sheetBtnTitle, { color: textMain }]}>Take Photo with Camera</Text>
                        <Text style={[styles.sheetBtnSub, { color: textSub }]}>{"Snap a photo of the student's test sheet"}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={textSub} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.sheetBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 14 })]}
                    onPress={handlePickImage}
                    activeOpacity={0.75}
                >
                    <View style={[styles.neutralOptionIcon, skeuoWellStyle(skeuo, 10)]}>
                        <Ionicons name="image-outline" size={18} color={textMain} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.sheetBtnTitle, { color: textMain }]}>Choose from Photo Library</Text>
                        <Text style={[styles.sheetBtnSub, { color: textSub }]}>Upload an existing photo from device</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={textSub} />
                </TouchableOpacity>
            </SmoothBottomSheetModal>

            {/* ── Full-Screen Grading Loading Overlay ── */}
            <SmoothCenterModal
                visible={gradingLoading}
                cardStyle={[
                    styles.loadingCard,
                    {
                        backgroundColor: darkMode ? cardBg : "#FFFFFF",
                        borderColor: darkMode ? border : "#E2E8F0",
                    },
                ]}
            >
                <PaperScanningAnimation
                    quizTitle={
                        isAutoDetectQuiz
                            ? "Auto-Detecting Assessment..."
                            : (activePublishedQuiz?.quizTitle || currentQuizValue)
                    }
                    accentColor={accentColor || "#EA580C"}
                    darkMode={darkMode}
                />
            </SmoothCenterModal>

            {/* ── Low Confidence / Double-Shaded Review Modal ── */}
            <LowConfidenceReviewModal
                visible={reviewModalOpen}
                onClose={() => setReviewModalOpen(false)}
                gradingResult={gradingResult}
                scannedImageUri={scannedImageUri}
                layoutJson={(gradedQuiz || activePublishedQuiz)?.layoutJson}
                studentName={
                    (matchedStudentId && roster.find((s) => s.id === matchedStudentId)?.full_name) ||
                    gradingResult?.studentName ||
                    undefined
                }
                accentColor={accentColor}
                initialQuestionNumber={reviewInitialQNum}
                initialFilterOnlyFlagged={reviewFilterOnlyFlagged}
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
                quizTitle={currentQuizValue || "Assessment"}
                publishedQuizzes={publishedQuizzes}
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
                roster={toRosterMatchItems(roster)}
                quizTitle={isAutoDetectQuiz ? "Auto-Detected Assessments" : (activePublishedQuiz?.quizTitle || currentQuizValue || "Assessment")}
                layoutJson={activePublishedQuiz?.layoutJson}
                classTitle={classTitle || "Classroom"}
                classroomId={classroomId}
                accentColor={accentColor}
                onCommitBatch={handleCommitBatch}
            />

            {/* ── Link / Switch Roster Student Modal (Single Paper) ── */}
            <Modal
                visible={studentPickerOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setStudentPickerOpen(false)}
            >
                <TouchableOpacity
                    style={styles.ddOverlay}
                    activeOpacity={1}
                    onPress={() => setStudentPickerOpen(false)}
                >
                    <View style={[styles.ddSheet, skeuoCardStyle(skeuo, 18), { backgroundColor: cardBg }]}>
                        <Text style={[styles.ddTitle, { color: accentColor }]}>
                            Link Sheet to Classroom Student
                        </Text>
                        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                            {roster.map((s) => {
                                const isSelected = matchedStudentId === s.id;
                                return (
                                    <TouchableOpacity
                                        key={s.id}
                                        style={[
                                            styles.ddItem,
                                            isSelected && { backgroundColor: accentColor + "18" },
                                        ]}
                                        onPress={() => {
                                            setMatchedStudentId(s.id);
                                            if (gradingResult) {
                                                setGradingResult({
                                                    ...gradingResult,
                                                    studentName: s.full_name,
                                                    lastName: s.last_name || gradingResult.lastName,
                                                    firstName: s.first_name || gradingResult.firstName,
                                                    middleName: formatMiddleInitial(s.middle_name) || gradingResult.middleName || null,
                                                });
                                            }
                                            setStudentPickerOpen(false);
                                        }}
                                    >
                                        <Text
                                            style={[
                                                styles.ddItemText,
                                                { color: textMain },
                                                isSelected && { color: accentColor, fontWeight: "700" },
                                            ]}
                                        >
                                            {s.full_name}
                                        </Text>
                                        {isSelected && (
                                            <Ionicons name="checkmark" size={16} color={accentColor} />
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ── Switch Assessment & Re-Grade Modal (Single Paper — 5 initially + Show More / View All) ── */}
            <Modal
                visible={assessmentPickerOpen}
                transparent
                animationType="fade"
                statusBarTranslucent
                navigationBarTranslucent
                onRequestClose={() => setAssessmentPickerOpen(false)}
            >
                <View style={styles.ddOverlay}>
                    <Pressable
                        style={StyleSheet.absoluteFillObject}
                        onPress={() => setAssessmentPickerOpen(false)}
                    />
                    {(() => {
                        const pageSize = 5;
                        const usePagination = quizOptionEntries.length > pageSize;
                        const qNorm = switchQuizSearchQuery.trim().toLowerCase();
                        const filteredEntries = usePagination && qNorm
                            ? quizOptionEntries.filter((e) => e.label.toLowerCase().includes(qNorm))
                            : quizOptionEntries;
                        const visibleEntries = usePagination
                            ? filteredEntries.slice(0, switchQuizVisibleCount)
                            : filteredEntries;
                        const remaining = Math.max(0, filteredEntries.length - visibleEntries.length);

                        return (
                            <View style={[styles.ddSheet, skeuoCardStyle(skeuo, 18), { backgroundColor: cardBg }]}>
                                <View style={styles.ddHeaderRow}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.ddTitle, { color: accentColor, marginBottom: 0 }]}>
                                            Switch Assessment &amp; Re-Grade Sheet
                                        </Text>
                                        {usePagination && (
                                            <Text style={{ fontSize: 11.5, color: textSub, marginTop: 2 }}>
                                                Showing {visibleEntries.length} of {filteredEntries.length}
                                            </Text>
                                        )}
                                    </View>
                                    <TouchableOpacity
                                        onPress={() => setAssessmentPickerOpen(false)}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Ionicons name="close" size={19} color={textSub} />
                                    </TouchableOpacity>
                                </View>

                                {usePagination && (
                                    <View
                                        style={[
                                            styles.ddSearchBox,
                                            skeuoWellStyle(skeuo, 10),
                                        ]}
                                    >
                                        <Ionicons name="search-outline" size={15} color={textSub} />
                                        <TextInput
                                            style={[styles.ddSearchInput, { color: textMain }]}
                                            value={switchQuizSearchQuery}
                                            onChangeText={(txt) => {
                                                setSwitchQuizSearchQuery(txt);
                                                setSwitchQuizVisibleCount(pageSize);
                                            }}
                                            placeholder="Search assessments..."
                                            placeholderTextColor={textSub}
                                            returnKeyType="search"
                                        />
                                        {switchQuizSearchQuery.length > 0 && (
                                            <TouchableOpacity
                                                onPress={() => setSwitchQuizSearchQuery("")}
                                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                            >
                                                <Ionicons name="close-circle" size={16} color={textSub} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}

                                <ScrollView style={{ maxHeight: 330 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
                                    {visibleEntries.length === 0 ? (
                                        <View style={{ paddingVertical: 22, alignItems: "center" }}>
                                            <Text style={{ color: textSub, fontSize: 13 }}>
                                                No matching assessments found.
                                            </Text>
                                        </View>
                                    ) : (
                                        visibleEntries.map(({ label, quiz }) => {
                                            const isSelected = (gradedQuiz || activePublishedQuiz)?.id === quiz.id;
                                            const itemCount = quiz.questions?.length || quiz.answerKey?.length || 0;
                                            return (
                                                <TouchableOpacity
                                                    key={quiz.id}
                                                    style={[
                                                        styles.ddItem,
                                                        isSelected && { backgroundColor: accentColor + "18" },
                                                    ]}
                                                    onPress={() => {
                                                        setAssessmentPickerOpen(false);
                                                        if (isSelected) return;
                                                        setGradedQuiz(quiz);
                                                        setWasAssessmentAutoDetected(false);
                                                        if (lastGradedImageRef.current) {
                                                            void processGrading(
                                                                lastGradedImageRef.current.base64,
                                                                lastGradedImageRef.current.mimeType,
                                                                null,
                                                                quiz
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <View style={{ flex: 1, marginRight: 8 }}>
                                                        <Text
                                                            style={[
                                                                styles.ddItemText,
                                                                { color: textMain },
                                                                isSelected && { color: accentColor, fontWeight: "700" },
                                                            ]}
                                                            numberOfLines={2}
                                                        >
                                                            {label}
                                                        </Text>
                                                        <Text style={{ fontSize: 11, color: textSub, marginTop: 2 }}>
                                                            {itemCount} {itemCount === 1 ? "item" : "items"}
                                                        </Text>
                                                    </View>
                                                    {isSelected && (
                                                        <Ionicons name="checkmark" size={16} color={accentColor} />
                                                    )}
                                                </TouchableOpacity>
                                            );
                                        })
                                    )}
                                </ScrollView>

                                {usePagination && filteredEntries.length > pageSize && (
                                    <View style={[styles.ddFooterActions, { borderTopColor: darkMode ? "#374151" : "#E5E7EB" }]}>
                                        {remaining > 0 ? (
                                            <>
                                                <TouchableOpacity
                                                    style={[
                                                        styles.ddFooterBtn,
                                                        {
                                                            backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                                            borderColor: darkMode ? "#374151" : "#E5E7EB",
                                                        },
                                                    ]}
                                                    onPress={() => setSwitchQuizVisibleCount((prev) => prev + pageSize)}
                                                    activeOpacity={0.75}
                                                >
                                                    <Text style={[styles.ddFooterBtnText, { color: textMain }]}>
                                                        Show {Math.min(pageSize, remaining)} More
                                                    </Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[
                                                        styles.ddFooterBtn,
                                                        {
                                                            backgroundColor: accentColor + "16",
                                                            borderColor: accentColor + "40",
                                                        },
                                                    ]}
                                                    onPress={() => setSwitchQuizVisibleCount(filteredEntries.length)}
                                                    activeOpacity={0.75}
                                                >
                                                    <Text style={[styles.ddFooterBtnText, { color: accentColor }]}>
                                                        View All ({filteredEntries.length})
                                                    </Text>
                                                </TouchableOpacity>
                                            </>
                                        ) : (
                                            <TouchableOpacity
                                                style={[
                                                    styles.ddFooterBtn,
                                                    {
                                                        backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                                        borderColor: darkMode ? "#374151" : "#E5E7EB",
                                                    },
                                                ]}
                                                onPress={() => setSwitchQuizVisibleCount(pageSize)}
                                                activeOpacity={0.75}
                                            >
                                                <Text style={[styles.ddFooterBtnText, { color: textSub }]}>
                                                    Show Less (Top {pageSize})
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                        );
                    })()}
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

    /* Compact Alert Banner */
    compactAlertBanner: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 10,
    },
    compactAlertText: {
        fontSize: 12.5,
        fontWeight: "600",
        flex: 1,
        marginRight: 8,
    },
    compactAlertBtn: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    compactAlertBtnText: {
        color: "#FFFFFF",
        fontSize: 11.5,
        fontWeight: "700",
    },

    /* Review Alert Banner (legacy fallback) */
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

    /* Card Top Section (Alerts & Section Header) */
    cardTopSection: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
    },
    gradingLogHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 4,
    },
    gradingLogTitle: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.8,
    },
    gradingLogCount: {
        fontSize: 12,
        fontWeight: "500",
    },

    /* Flush Edge-to-Edge Table */
    gradingTableFlush: {
        width: "100%",
    },
    tableRow: {
        height: 52,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    tableQNum: {
        fontSize: 14,
        fontWeight: "700",
        width: 38,
    },
    tableRowMiddle: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 8,
    },
    tableAnswerText: {
        fontSize: 14,
    },
    tableRowRight: {
        flexShrink: 0,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    unclearGhostPill: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: "#FEF3C7",
        borderWidth: 1,
        borderColor: "#FDE68A",
    },
    unclearGhostPillText: {
        color: "#B45309",
        fontSize: 12,
        fontWeight: "600",
    },
    cardBottomSection: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 20,
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
        gap: 10,
    },
    launcherIconCircle: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    launcherTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#0F172A",
    },
    launcherSub: {
        fontSize: 12.5,
        color: "#6B7280",
        marginTop: 1,
    },
    divider: {
        height: 1,
        backgroundColor: "#F3F4F6",
        marginVertical: 14,
    },
    fieldGroup: {
        marginBottom: 16,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: "500",
        color: "#334155",
        letterSpacing: 0,
        marginBottom: 6,
    },
    primaryScanBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 48,
        borderRadius: 12,
        marginTop: 6,
    },
    primaryScanBtnText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "600",
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
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 32,
        gap: 10,
    },
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
    neutralOptionIcon: {
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    actionSheetHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
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
        paddingHorizontal: 24,
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
    ddHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 10,
    },
    ddSearchBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        height: 38,
        marginBottom: 8,
    },
    ddSearchInput: {
        flex: 1,
        fontSize: 13,
        paddingVertical: 0,
    },
    ddFooterActions: {
        flexDirection: "row",
        gap: 8,
        paddingTop: 10,
        marginTop: 8,
        borderTopWidth: 1,
    },
    ddFooterBtn: {
        flex: 1,
        height: 38,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    ddFooterBtnText: {
        fontSize: 12.5,
        fontWeight: "700",
    },
});
