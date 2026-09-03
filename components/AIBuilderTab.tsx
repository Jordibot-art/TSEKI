import { Ionicons } from "@expo/vector-icons";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
};

type GeneratedQuestion = {
    number: number;
    question: string;
    choices?: string[];
    answer: string;
};

export default function AIBuilderTab({ classroomId, classTitle, classSubject, accentColor }: Props) {
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
            const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error("API Key not found. Please set EXPO_PUBLIC_GEMINI_API_KEY in .env");
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const count = parseInt(questionCount.split(" ")[0], 10);
            
            let promptText = "";
            if (attachedFile) {
                promptText = `
You are an expert AI assessment specialist.
CRITICAL INSTRUCTION - SOURCE MATERIAL GROUNDING:
A reference document ("${attachedFile.name}") is attached.
You MUST generate all questions, choices, and answers STRICTLY, SOLELY, AND EXCLUSIVELY based on the text, concepts, facts, and materials inside the attached PDF document.
- DO NOT generate generic questions about ${subject} or outside general knowledge.
- Every question MUST test direct comprehension, application, or recall of the information explicitly written in the attached PDF.
${topic.trim() ? `- Focus within the PDF: Focus specifically on topics related to "${topic.trim()}" found within this PDF document.` : `- Coverage: Cover key concepts and sections distributed across the entire document.`}

Quiz Parameters:
- Source Document: Attached PDF ("${attachedFile.name}")
- Subject Area: ${subject}
- Grade Level: ${gradeLevel}
- Question Type: ${questionType}
- Number of Questions: ${count}
- Difficulty Level: ${difficulty}

Return ONLY a JSON array of objects, where each object represents a question and has the following exact structure:
[
  {
    "number": 1,
    "question": "The question text here (derived directly from the attached document)",
    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"], // Only include this property if question type requires choices
    "answer": "Choice A" // IMPORTANT: For multiple choice, the answer MUST EXACTLY match one of the choices word-for-word
  }
]
No markdown wrapping like \`\`\`json, just the raw JSON array string.
`;
            } else {
                promptText = `
You are an expert AI quiz maker. Generate a test based on the following parameters:
- Topic: ${topic}
- Subject: ${subject}
- Grade Level: ${gradeLevel}
- Question Type: ${questionType}
- Number of Questions: ${count}
- Difficulty Level: ${difficulty}

Return ONLY a JSON array of objects, where each object represents a question and has the following exact structure:
[
  {
    "number": 1,
    "question": "The question text here",
    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"], // Only include this property if question type requires choices
    "answer": "Choice A" // IMPORTANT: For multiple choice, the answer MUST EXACTLY match one of the choices word-for-word
  }
]
No markdown wrapping like \`\`\`json, just the raw JSON array string.
`;
            }

            const parts: any[] = [];

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

            parts.push({ text: promptText });

            let result;
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    result = await model.generateContent(parts);
                    break;
                } catch (apiErr: any) {
                    const is503 = apiErr?.message?.includes("503") || apiErr?.status === 503;
                    if (is503 && attempt < maxRetries) {
                        console.warn(`[Gemini] Attempt ${attempt} hit 503 (high demand). Retrying in ${attempt * 1500}ms...`);
                        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
                        continue;
                    }
                    throw apiErr;
                }
            }

            if (!result) {
                throw new Error("No response received from AI model.");
            }

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
        setGeneratedQuestions([]);
        setTopic("");
        setSubject(resolvedSubject);
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
                                    {q.choices.map((c, cIdx) => {
                                        const isCorrect = isChoiceAnswer(c, q.answer, cIdx);
                                        return (
                                            <View
                                                key={`${c}_${cIdx}`}
                                                style={[
                                                    styles.choiceItem,
                                                    isCorrect && { backgroundColor: accentColor + "18", borderColor: accentColor },
                                                ]}
                                            >
                                                <Text style={[
                                                    styles.choiceText,
                                                    isCorrect && { color: accentColor, fontWeight: "700" },
                                                ]}>
                                                    {c}
                                                </Text>
                                                {isCorrect && (
                                                    <Ionicons name="checkmark-circle" size={14} color={accentColor} />
                                                )}
                                            </View>
                                        );
                                    })}
                                    {/* Fallback if no choice was highlighted */}
                                    {!q.choices.some((c, i) => isChoiceAnswer(c, q.answer, i)) && (
                                        <View style={[styles.answerWrap, { borderLeftColor: accentColor, marginTop: 8 }]}>
                                            <Text style={styles.answerLabel}>Answer:</Text>
                                            <Text style={[styles.answerText, { color: accentColor }]}>{q.answer}</Text>
                                        </View>
                                    )}
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

            {/* ── Full-Screen Generating Loading Overlay ── */}
            <Modal
                visible={generating}
                transparent
                animationType="fade"
                statusBarTranslucent
                onRequestClose={() => {}}
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
