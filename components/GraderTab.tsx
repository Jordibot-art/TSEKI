import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { supabase } from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────
export type Student = {
    id: string;
    full_name: string;
    email: string | null;
    average: number;
    attendance: number;
};

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
};

export default function GraderTab({ classroomId, classTitle, accentColor, students = [] }: Props) {
    // 1. Grade against quiz (placeholder without fixed mock quizzes)
    const [selectedQuiz, setSelectedQuiz] = useState("Select a quiz...");

    // 2. Identify student sheet (functional with real database students)
    const [roster, setRoster] = useState<Student[]>(students);
    const [selectedStudent, setSelectedStudent] = useState("");

    // 3. Choose answer sheet sample (without fixed data)
    const [sampleSheets, setSampleSheets] = useState<{ id: string; title: string; badge?: string }[]>([]);
    const [selectedSample, setSelectedSample] = useState("");

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

    const studentOptions = roster.length > 0
        ? roster.map((s) => `${s.full_name}${s.email ? ` (${s.email})` : ""}`)
        : ["No students enrolled yet"];

    const currentStudentValue = selectedStudent || (roster.length > 0 ? studentOptions[0] : "Select a student...");

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
                        options={["No quizzes available"]}
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
                    style={[styles.scanBtn, { backgroundColor: "#2563EB" }]}
                    activeOpacity={0.8}
                >
                    <Ionicons name="camera-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.scanBtnText}>Open Camera & Scan</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}

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
        shadowColor: "#2563EB",
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
});
