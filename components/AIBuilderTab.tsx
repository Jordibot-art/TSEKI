import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { BondPaperSize, exportPaperSheet } from "../lib/paperSheetExporter";
import {
    GeneratedAssessment,
    generateScannableQuiz
} from "../lib/quizGeneratorService";
import { savePublishedQuiz } from "../lib/quizStore";

// ── Option lists ──────────────────────────────────────────────────────────────
const SUBJECTS = [
    "Mathematics", "Science", "English", "History", "Filipino",
    "Social Studies", "Physics", "Chemistry", "Biology", "Geography",
    "Economics", "Technology", "Physical Education", "Arts", "Music",
];
const GRADE_LEVELS = [
    "Grade 7", "Grade 8", "Grade 9", "Grade 10",
    "Grade 11", "Grade 12",
];
const QUESTION_TYPES = [
    "Multiple Choice", "True / False", "Fill in the Blank", "Enumeration", "Mixed Assessment",
];
const QUESTION_COUNTS = [
    "5 Questions", "10 Questions", "15 Questions", "20 Questions",
    "25 Questions", "30 Questions", "40 Questions", "50 Questions",
];

type Difficulty = "Easy" | "Medium" | "Hard";

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
    return (
        <>
            <Text style={styles.fieldLabel}>{label}</Text>
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
    const resolvedSubject = classSubject && classSubject.trim().length > 0 ? classSubject.trim() : "General";

    // ── Form state ─────────────────────────────────────────────────────────────
    const [topic, setTopic] = useState("");
    const [subject, setSubject] = useState(resolvedSubject);

    useEffect(() => {
        if (classSubject && classSubject.trim().length > 0) {
            setSubject(classSubject.trim());
        }
    }, [classSubject]);
    const [gradeLevel, setGradeLevel] = useState("Grade 11");
    const [questionType, setQuestionType] = useState("Multiple Choice");
    const [questionCount, setQuestionCount] = useState("20 Questions");
    const [difficulty, setDifficulty] = useState<Difficulty>("Hard");
    const [attachedFile, setAttachedFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);

    // ── Generation state ───────────────────────────────────────────────────────
    const [generating, setGenerating] = useState(false);
    const [generatedAssessment, setGeneratedAssessment] = useState<GeneratedAssessment | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);

    // ── File handler ───────────────────────────────────────────────────────────
    async function handleAttachFile() {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ["application/pdf"],
                copyToCacheDirectory: true,
            });
            if (result.canceled === false && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const mimeType = asset.mimeType && asset.mimeType.includes("pdf")
                    ? asset.mimeType
                    : "application/pdf";
                setAttachedFile({
                    uri: asset.uri,
                    name: asset.name,
                    mimeType,
                });
            }
        } catch (error) {
            console.error("Error picking document", error);
            Alert.alert("Error", "Failed to pick document");
        }
    }

    // ── Generate handler ───────────────────────────────────────────────────────
    async function handleGenerate() {
        const effectiveTopic = topic.trim() || (attachedFile ? `Content of ${attachedFile.name}` : "");
        if (!effectiveTopic || generating) return;
        setGenerating(true);
        setShowResults(false);

        try {
            let attachedPdfBase64: string | undefined;
            if (attachedFile) {
                attachedPdfBase64 = await FileSystem.readAsStringAsync(attachedFile.uri, {
                    encoding: "base64",
                });
            }

            const count = parseInt(questionCount.split(" ")[0], 10) || 10;
            const assessment = await generateScannableQuiz({
                topic: effectiveTopic,
                subject,
                gradeLevel,
                questionType,
                questionCount: count,
                difficulty,
                attachedPdfBase64,
                attachedPdfName: attachedFile ? attachedFile.name : undefined,
            });

            setGeneratedAssessment(assessment);
            setShowResults(true);
        } catch (error: any) {
            console.error("Generation error:", error);
            const is503 = error?.message?.includes("503") || error?.status === 503;
            if (is503) {
                Alert.alert(
                    "AI Server Busy",
                    "Google's Gemini service is currently experiencing temporary high demand spikes. Please wait a few moments and try generating again."
                );
            } else {
                Alert.alert("Error generating quiz", error.message);
            }
        } finally {
            setGenerating(false);
        }
    }

    function handleReset() {
        setShowResults(false);
        setGeneratedAssessment(null);
        setTopic("");
        setSubject(resolvedSubject);
        setAttachedFile(null);
    }

    async function handleExportPaper(includeKey: boolean = false, paperSize: BondPaperSize = "short") {
        setExportModalOpen(false);
        if (!generatedAssessment) return;
        setExportingPdf(true);
        try {
            await exportPaperSheet({
                assessment: generatedAssessment,
                classTitle,
                subject,
                includeAnswerKey: includeKey,
                paperSize,
            });
        } catch (err: any) {
            Alert.alert("Export Error", err.message || "Failed to export PDF test paper.");
        } finally {
            setExportingPdf(false);
        }
    }

    async function handlePublishQuiz() {
        if (!generatedAssessment) return;
        try {
            await savePublishedQuiz(classroomId, generatedAssessment);
            Alert.alert(
                "Quiz Published!",
                `"${generatedAssessment.quizTitle}" is published and ready for grading in the Grader tab!`,
                [
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
            Alert.alert("Publish Failed", err.message || "Failed to save quiz to grader.");
        }
    }

    const canGenerate = (topic.trim().length > 0 || attachedFile !== null) && !generating;

    return (
        <ScrollView
            style={styles.root}
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
                    <Text style={styles.headerTitle}>Tseki AI Assessment Suite</Text>
                    <Text style={styles.headerSub}>Auto-generate quizzes for {classTitle}</Text>
                </View>
            </View>

            {!showResults ? (
                <>
                    {/* ── Assessment Topic ── */}
                    <Text style={styles.fieldLabel}>
                        ASSESSMENT TOPIC {attachedFile ? <Text style={styles.optional}>(OPTIONAL WITH PDF)</Text> : <Text style={styles.required}>*</Text>}
                    </Text>
                    <TextInput
                        style={styles.input}
                        placeholder={
                            attachedFile
                                ? `e.g. Focus on specific chapter, or leave blank for whole document`
                                : "e.g. Cold War, Photosynthesis, Quadratic Equations..."
                        }
                        placeholderTextColor="#9CA3AF"
                        value={topic}
                        onChangeText={setTopic}
                    />

                    {/* ── Subject (Auto from Classroom) + Grade Level ── */}
                    <View style={styles.twoCol}>
                        <View style={styles.colHalf}>
                            <Text style={styles.fieldLabel}>SUBJECT</Text>
                            <View style={styles.autoSubjectBtn}>
                                <Text style={styles.autoSubjectText} numberOfLines={1}>
                                    {subject}
                                </Text>
                                <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
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

                    {/* ── Difficulty Level ── */}
                    <Text style={styles.fieldLabel}>DIFFICULTY LEVEL</Text>
                    <View style={styles.difficultyRow}>
                        {(["Easy", "Medium", "Hard"] as Difficulty[]).map((d) => (
                            <TouchableOpacity
                                key={d}
                                style={[
                                    styles.diffBtn,
                                    difficulty === d && { backgroundColor: accentColor, borderColor: accentColor },
                                ]}
                                onPress={() => setDifficulty(d)}
                            >
                                <Text style={[
                                    styles.diffBtnText,
                                    difficulty === d && { color: "#FFFFFF" },
                                ]}>
                                    {d}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* ── Attached File ── */}
                    <Text style={styles.fieldLabel}>ATTACH REFERENCE FILE <Text style={styles.optional}>(OPTIONAL)</Text></Text>
                    <TouchableOpacity
                        style={styles.attachBtn}
                        onPress={handleAttachFile}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="document-attach-outline" size={20} color="#6B7280" />
                        <Text style={styles.attachBtnText} numberOfLines={1}>
                            {attachedFile ? attachedFile.name : "Tap to attach a file"}
                        </Text>
                        {attachedFile && (
                            <TouchableOpacity onPress={() => setAttachedFile(null)} style={{ padding: 4 }}>
                                <Ionicons name="close-circle" size={20} color="#EF4444" />
                            </TouchableOpacity>
                        )}
                    </TouchableOpacity>

                    {/* ── Generate Button ── */}
                    <TouchableOpacity
                        style={[
                            styles.generateBtn,
                            { backgroundColor: canGenerate ? accentColor : "#D1D5DB" },
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
                        <Ionicons name="information-circle-outline" size={15} color="#9CA3AF" />
                        <Text style={styles.infoText}>
                            Questions are generated based on DepEd curriculum standards
                        </Text>
                    </View>
                </>
            ) : (
                <>
                    {/* ── Results Header ── */}
                    <View style={[styles.resultsBanner, { backgroundColor: accentColor + "18", borderColor: accentColor + "44" }]}>
                        <Ionicons name="checkmark-circle" size={24} color={accentColor} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.resultsBannerTitle, { color: accentColor }]} numberOfLines={1}>
                                {generatedAssessment?.quizTitle || "Assessment Generated!"}
                            </Text>
                            <Text style={styles.resultsBannerSub}>
                                {generatedAssessment?.questions.length || questionCount} Questions • {difficulty} • Scannable Paper Layout
                            </Text>
                        </View>
                        <TouchableOpacity onPress={handleReset}>
                            <Ionicons name="refresh" size={20} color={accentColor} />
                        </TouchableOpacity>
                    </View>

                    {/* ── Scannable Question Cards ── */}
                    {generatedAssessment?.questions.map((q) => {
                        const answerObj = generatedAssessment.answerKey.find((k) => k.questionNumber === q.questionNumber);
                        const correctAnswer = answerObj ? answerObj.correctAnswer : "";
                        const points = answerObj ? answerObj.points : 1;
                        const typeLabel = q.type.replace(/_/g, " ").toUpperCase();

                        return (
                            <View key={q.questionNumber} style={styles.questionCard}>
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
                                        <Text style={styles.questionText} numberOfLines={4}>{q.questionText}</Text>
                                    </View>
                                </View>

                                {q.options && q.options.length > 0 && (
                                    <View style={styles.choicesWrap}>
                                        {q.options.map((opt, cIdx) => {
                                            const isCorrect = isChoiceAnswer(opt, correctAnswer, cIdx);
                                            return (
                                                <View
                                                    key={`${opt}_${cIdx}`}
                                                    style={[
                                                        styles.choiceItem,
                                                        isCorrect && { backgroundColor: accentColor + "18", borderColor: accentColor },
                                                    ]}
                                                >
                                                    <Text style={[
                                                        styles.choiceText,
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
                                    <Ionicons name="create-outline" size={16} color="#6B7280" />
                                    <Text style={styles.answerBoxLabel}>Student Answer Box{q.answerBoxesRequired > 1 ? "es" : ""}:</Text>
                                    <View style={{ flexDirection: "row", gap: 6 }}>
                                        {Array.from({ length: Math.min(q.answerBoxesRequired, 5) }).map((_, bIdx) => (
                                            <View key={bIdx} style={styles.answerBoxItem}>
                                                <Text style={{ fontSize: 9, color: "#9CA3AF" }}>#{bIdx + 1}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>

                                {/* Official Answer Key Pill */}
                                <View style={[styles.answerWrap, { borderLeftColor: accentColor, marginTop: 10 }]}>
                                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                        <Text style={styles.answerLabel}>OFFICIAL ANSWER KEY</Text>
                                        <Text style={[styles.pointsBadge, { color: accentColor }]}>+{points} pt{points > 1 ? "s" : ""}</Text>
                                    </View>
                                    <Text style={[styles.answerText, { color: accentColor }]}>{correctAnswer}</Text>
                                </View>
                            </View>
                        );
                    })}

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
                            style={[styles.saveDraftBtn, { borderColor: accentColor }]}
                            onPress={() => Alert.alert("Draft Saved", `Saved "${generatedAssessment?.quizTitle}" to your drafts.`)}
                        >
                            <Ionicons name="save-outline" size={16} color={accentColor} />
                            <Text style={[styles.saveDraftText, { color: accentColor }]}>Save as Draft</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.publishBtn, { backgroundColor: accentColor }]}
                            onPress={handlePublishQuiz}
                        >
                            <Ionicons name="send-outline" size={16} color="#FFFFFF" />
                            <Text style={styles.publishText}>Publish Quiz</Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity style={styles.regenerateLink} onPress={handleReset}>
                        <Ionicons name="arrow-back-outline" size={14} color="#6B7280" />
                        <Text style={styles.regenerateLinkText}>Generate a new quiz</Text>
                    </TouchableOpacity>
                </>
            )}

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
                        <View style={[styles.loadingIconGlow, { backgroundColor: accentColor + "22" }]}>
                            <View style={[styles.loadingIconCircle, { backgroundColor: accentColor }]}>
                                <Ionicons name="sparkles" size={28} color="#FFFFFF" />
                            </View>
                        </View>

                        <Text style={styles.loadingTitle}>Generating Assessment</Text>

                        <Text style={styles.loadingSub}>
                            {attachedFile
                                ? `Tseki AI is analyzing "${attachedFile.name}" and extracting questions...`
                                : `Tseki AI is crafting DepEd-aligned questions for ${subject}...`}
                        </Text>

                        {/* Spinner */}
                        <View style={styles.spinnerWrap}>
                            <ActivityIndicator size="large" color={accentColor} />
                        </View>

                        {/* Parameter summary pill */}
                        <View style={styles.loadingMetaPill}>
                            <Text style={styles.loadingMetaText} numberOfLines={1}>
                                {questionCount} • {difficulty} • {questionType}
                            </Text>
                        </View>

                        {/* Do not close notice */}
                        <View style={styles.loadingNoticeRow}>
                            <Ionicons name="hourglass-outline" size={14} color="#6B7280" />
                            <Text style={styles.loadingNoticeText}>
                                Please wait and keep this screen open.
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
                onRequestClose={() => setExportModalOpen(false)}
            >
                <TouchableOpacity
                    style={styles.exportBackdrop}
                    activeOpacity={1}
                    onPress={() => setExportModalOpen(false)}
                >
                    <View style={styles.exportSheet}>
                        <View style={styles.exportSheetHeader}>
                            <Text style={styles.exportSheetTitle}>Export Paper Sheet Layout</Text>
                            <Text style={styles.exportSheetSub}>
                                Download, print, or share the physical test sheet formatted with scannable answer boxes.
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={styles.exportOptionBtn}
                            onPress={() => handleExportPaper(false, "short")}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.exportOptionIcon, { backgroundColor: (accentColor || "#2563EB") + "18" }]}>
                                <Ionicons name="document-text" size={22} color={accentColor || "#2563EB"} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.exportOptionTitle}>Short Bond Paper (8.5" × 11")</Text>
                                <Text style={styles.exportOptionSub}>
                                    1 single sheet (Letter size) • 2-column scannable layout for 1-shot camera scanning
                                </Text>
                            </View>
                            <Ionicons name="download-outline" size={20} color="#6B7280" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.exportOptionBtn}
                            onPress={() => handleExportPaper(false, "long")}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.exportOptionIcon, { backgroundColor: "#8B5CF618" }]}>
                                <Ionicons name="document-outline" size={22} color="#8B5CF6" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.exportOptionTitle}>Long Bond Paper (8.5" × 13")</Text>
                                <Text style={styles.exportOptionSub}>
                                    1 single sheet (Philippine Folio) • Fits all questions with extra spacing on 1 page
                                </Text>
                            </View>
                            <Ionicons name="download-outline" size={20} color="#6B7280" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.exportOptionBtn}
                            onPress={() => handleExportPaper(true, "short")}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.exportOptionIcon, { backgroundColor: "#10B98118" }]}>
                                <Ionicons name="checkmark-done-circle" size={22} color="#10B981" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.exportOptionTitle}>Teacher Answer Key Paper (PDF)</Text>
                                <Text style={styles.exportOptionSub}>
                                    1 single sheet with correct answers pre-printed in the boxes for grading reference
                                </Text>
                            </View>
                            <Ionicons name="download-outline" size={20} color="#6B7280" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.exportCancelBtn}
                            onPress={() => setExportModalOpen(false)}
                        >
                            <Text style={styles.exportCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
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

    /* Attach File */
    attachBtn: {
        height: 52, borderWidth: 1.5, borderColor: "#D1D5DB", borderStyle: "dashed",
        borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
        backgroundColor: "#F9FAFB", gap: 10,
    },
    attachBtnText: { fontSize: 14, color: "#6B7280", flex: 1 },

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
