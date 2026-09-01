import { Ionicons } from "@expo/vector-icons";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
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
    "Multiple Choice", "True or False", "Fill in the Blank",
    "Short Answer", "Enumeration", "Essay",
];
const QUESTION_COUNTS = [
    "5 Questions", "10 Questions", "15 Questions", "20 Questions",
    "25 Questions", "30 Questions", "40 Questions", "50 Questions",
];

type Difficulty = "Easy" | "Medium" | "Hard";

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
    accentColor: string;
};

type GeneratedQuestion = {
    number: number;
    question: string;
    choices?: string[];
    answer: string;
};

export default function AIBuilderTab({ classroomId, classTitle, accentColor }: Props) {
    // ── Form state ─────────────────────────────────────────────────────────────
    const [topic, setTopic] = useState("");
    const [subject, setSubject] = useState("Mathematics");
    const [gradeLevel, setGradeLevel] = useState("Grade 11");
    const [questionType, setQuestionType] = useState("Multiple Choice");
    const [questionCount, setQuestionCount] = useState("20 Questions");
    const [difficulty, setDifficulty] = useState<Difficulty>("Hard");
    const [customPrompt, setCustomPrompt] = useState("");
    const [attachedFile, setAttachedFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);

    // ── Generation state ───────────────────────────────────────────────────────
    const [generating, setGenerating] = useState(false);
    const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
    const [showResults, setShowResults] = useState(false);

    // ── File handler ───────────────────────────────────────────────────────────
    async function handleAttachFile() {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ["application/pdf"],
                copyToCacheDirectory: true,
            });
            if (result.canceled === false && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                setAttachedFile({
                    uri: asset.uri,
                    name: asset.name,
                    mimeType: asset.mimeType || "application/octet-stream",
                });
            }
        } catch (error) {
            console.error("Error picking document", error);
            Alert.alert("Error", "Failed to pick document");
        }
    }

    // ── Generate handler ───────────────────────────────────────────────────────
    async function handleGenerate() {
        if (!topic.trim() || generating) return;
        setGenerating(true);
        setShowResults(false);

        try {
            const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error("API Key not found. Please set EXPO_PUBLIC_GEMINI_API_KEY in .env");
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const count = parseInt(questionCount.split(" ")[0], 10);
            const promptText = `
You are an expert AI quiz maker. Generate a test based on the following parameters:
- Topic: ${topic}
- Subject: ${subject}
- Grade Level: ${gradeLevel}
- Question Type: ${questionType}
- Number of Questions: ${count}
- Difficulty Level: ${difficulty}
${customPrompt ? `- Custom Guidelines: ${customPrompt}` : ""}

Return ONLY a JSON array of objects, where each object represents a question and has the following exact structure:
[
  {
    "number": 1,
    "question": "The question text here",
    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"], // Only include this property if question type requires choices
    "answer": "The correct answer text here"
  }
]
No markdown wrapping like \`\`\`json, just the raw JSON array string.
`;

            const parts: any[] = [{ text: promptText }];

            if (attachedFile) {
                const base64Data = await FileSystem.readAsStringAsync(attachedFile.uri, {
                    encoding: "base64",
                });
                parts.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: attachedFile.mimeType,
                    },
                });
            }

            const result = await model.generateContent(parts);
            const responseText = result.response.text().trim();

            let parsedQuestions: GeneratedQuestion[] = [];
            try {
                const cleanedText = responseText.replace(/^```(json)?|```$/g, '').trim();
                parsedQuestions = JSON.parse(cleanedText);
            } catch (err) {
                console.error("Failed to parse JSON response:", responseText);
                throw new Error("Failed to parse AI response as JSON.");
            }

            setGeneratedQuestions(parsedQuestions);
            setShowResults(true);
        } catch (error: any) {
            console.error("Generation error:", error);
            Alert.alert("Error generating quiz", error.message);
        } finally {
            setGenerating(false);
        }
    }

    function handleReset() {
        setShowResults(false);
        setGeneratedQuestions([]);
        setTopic("");
        setCustomPrompt("");
        setAttachedFile(null);
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
                        ASSESSMENT TOPIC <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Cold War, Photosynthesis, Quadratic Equations..."
                        placeholderTextColor="#9CA3AF"
                        value={topic}
                        onChangeText={setTopic}
                    />

                    {/* ── Subject + Grade Level ── */}
                    <View style={styles.twoCol}>
                        <View style={styles.colHalf}>
                            <Dropdown
                                label="SUBJECT"
                                value={subject}
                                options={SUBJECTS}
                                onSelect={setSubject}
                                accentColor={accentColor}
                            />
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

                    {/* ── Custom Prompt ── */}
                    <Text style={styles.fieldLabel}>CUSTOM PROMPT GUIDELINES <Text style={styles.optional}>(OPTIONAL)</Text></Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder={"e.g. Include questions on plant respiration or emphasize fractional solving."}
                        placeholderTextColor="#9CA3AF"
                        value={customPrompt}
                        onChangeText={setCustomPrompt}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />

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
                        <Ionicons name="checkmark-circle" size={22} color={accentColor} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.resultsBannerTitle, { color: accentColor }]}>
                                Quiz Generated!
                            </Text>
                            <Text style={styles.resultsBannerSub}>
                                {questionCount} • {questionType} • {difficulty} • {subject}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={handleReset}>
                            <Ionicons name="refresh" size={20} color={accentColor} />
                        </TouchableOpacity>
                    </View>

                    {/* ── Question Cards ── */}
                    {generatedQuestions.map((q) => (
                        <View key={q.number} style={styles.questionCard}>
                            <View style={styles.questionHeader}>
                                <View style={[styles.questionNumber, { backgroundColor: accentColor }]}>
                                    <Text style={styles.questionNumberText}>{q.number}</Text>
                                </View>
                                <Text style={styles.questionText} numberOfLines={4}>{q.question}</Text>
                            </View>
                            {q.choices && (
                                <View style={styles.choicesWrap}>
                                    {q.choices.map((c) => (
                                        <View
                                            key={c}
                                            style={[
                                                styles.choiceItem,
                                                c === q.answer && { backgroundColor: accentColor + "18", borderColor: accentColor },
                                            ]}
                                        >
                                            <Text style={[
                                                styles.choiceText,
                                                c === q.answer && { color: accentColor, fontWeight: "700" },
                                            ]}>
                                                {c}
                                            </Text>
                                            {c === q.answer && (
                                                <Ionicons name="checkmark-circle" size={14} color={accentColor} />
                                            )}
                                        </View>
                                    ))}
                                </View>
                            )}
                            {!q.choices && (
                                <View style={[styles.answerWrap, { borderLeftColor: accentColor }]}>
                                    <Text style={styles.answerLabel}>Answer:</Text>
                                    <Text style={[styles.answerText, { color: accentColor }]}>{q.answer}</Text>
                                </View>
                            )}
                        </View>
                    ))}

                    {/* ── Action Buttons ── */}
                    <View style={styles.resultActions}>
                        <TouchableOpacity style={[styles.saveDraftBtn, { borderColor: accentColor }]}>
                            <Ionicons name="save-outline" size={16} color={accentColor} />
                            <Text style={[styles.saveDraftText, { color: accentColor }]}>Save as Draft</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.publishBtn, { backgroundColor: accentColor }]}>
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
    textArea: {
        height: 90, paddingTop: 12,
    },

    /* Attach File */
    attachBtn: {
        height: 52, borderWidth: 1.5, borderColor: "#D1D5DB", borderStyle: "dashed",
        borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
        backgroundColor: "#F9FAFB", gap: 10,
    },
    attachBtnText: { fontSize: 14, color: "#6B7280", flex: 1 },

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
});
