import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import {
  generateExcelTemplateBase64,
  generateExcelClasslistBase64,
  parseClasslistFile,
  formatStudentFullName,
  normalizeStudentRecord,
} from "../lib/classListParserService";

export interface ClassroomOnboardingModalProps {
  visible: boolean;
  onClose: () => void;
  classroom: {
    id: string;
    title: string;
    subject?: string;
    section?: string;
    room?: string;
    schedule?: string;
    color?: string;
  } | null;
  onEnterClassroom?: (classroom: any) => void;
  onStudentsUpdated?: () => void;
}

export function ClassroomOnboardingModal({
  visible,
  onClose,
  classroom,
  onEnterClassroom,
  onStudentsUpdated,
}: ClassroomOnboardingModalProps) {
  const { darkMode } = useTheme();

  // Mode: "MENU" | "MANUAL_ADD"
  const [mode, setMode] = useState<"MENU" | "MANUAL_ADD">("MENU");

  // Loading states
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  // Manual Add Form fields
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [addedCount, setAddedCount] = useState(0);

  const bg = darkMode ? "#18181B" : "#FFFFFF";
  const cardBg = darkMode ? "#27272A" : "#F4F4F5";
  const textPrimary = darkMode ? "#FAFAFA" : "#09090B";
  const textSecondary = darkMode ? "#A1A1AA" : "#71717A";
  const borderColor = darkMode ? "#3F3F46" : "#E4E4E7";
  const inputBg = darkMode ? "#18181B" : "#FFFFFF";
  const accentColor = classroom?.color || "#F97316";

  function handleReset() {
    setMode("MENU");
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setEmail("");
    setAddedCount(0);
  }

  function handleModalClose() {
    handleReset();
    onClose();
  }

  // ── 1. Download Excel Template (BSIT-4 Layout) ─────────────────────────────
  async function handleDownloadTemplate() {
    if (!classroom) return;
    setDownloadingTemplate(true);
    try {
      const base64Data = generateExcelTemplateBase64({
        classroomTitle: classroom.title,
        subject: classroom.subject || "",
        section: classroom.section || "",
        room: classroom.room || "",
        schedule: classroom.schedule || "",
      });

      const cleanTitle = (classroom.title || "Classroom")
        .replace(/[^a-zA-Z0-9_\-\s]/g, "")
        .replace(/\s+/g, "_");
      const fileName = `${cleanTitle}_BSIT4_Template.xlsx`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Download / Save BSIT-4 Excel Template",
          UTI: "com.microsoft.excel.xlsx",
        });
      } else {
        Alert.alert("Template Generated", `Saved to: ${fileUri}`);
      }
    } catch (err: any) {
      console.error("Error generating template:", err);
      Alert.alert("Error", err.message || "Failed to download Excel template.");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  // ── 2. Import Excel Roster ────────────────────────────────────────────────
  async function handleImportExcel() {
    if (!classroom) return;
    setImportingExcel(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv",
          "application/csv",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setImportingExcel(false);
        return;
      }

      const file = result.assets[0];
      const parsed = await parseClasslistFile(file.uri, file.name);

      if (parsed.students.length === 0) {
        Alert.alert(
          "No Students Detected",
          "Could not detect any student rows in this file. Please ensure the file has columns like 'Last Name', 'First Name', or 'Student\\'s Name'."
        );
        setImportingExcel(false);
        return;
      }

      // Insert students in batch into Supabase
      const insertRows = parsed.students.map((s) => ({
        classroom_id: classroom.id,
        last_name: s.lastName || null,
        first_name: s.firstName || null,
        middle_name: s.middleName || null,
        full_name: s.fullName,
        email: s.email || null,
        attendance: 100,
        average: 0,
      }));

      let { data, error } = await supabase.from("students").insert(insertRows).select();

      // Fallback for older database schemas without separate last_name/first_name columns
      if (
        error &&
        (error.code === "PGRST204" ||
          error.message?.includes("last_name") ||
          error.message?.includes("first_name"))
      ) {
        const fallbackRows = parsed.students.map((s) => ({
          classroom_id: classroom.id,
          full_name: s.fullName,
          email: s.email || null,
          attendance: 100,
          average: 0,
        }));
        const retry = await supabase.from("students").insert(fallbackRows).select();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        throw error;
      }

      const count = data?.length || parsed.students.length;
      setAddedCount((prev) => prev + count);
      onStudentsUpdated?.();

      Alert.alert(
        "Import Successful! 🎉",
        `Successfully imported ${count} students into "${classroom.title}".`
      );
    } catch (err: any) {
      console.error("Import error:", err);
      Alert.alert("Import Failed", err.message || "Failed to parse and import students.");
    } finally {
      setImportingExcel(false);
    }
  }

  // ── 3. Export Excel Roster & Scores ───────────────────────────────────────
  async function handleExportExcel() {
    if (!classroom) return;
    setExportingExcel(true);
    try {
      // Fetch latest students
      const { data: studs } = await supabase
        .from("students")
        .select("*")
        .eq("classroom_id", classroom.id);

      const normalizedStudents = (studs || []).map((s) => normalizeStudentRecord(s));

      // Fetch published quizzes
      const { data: qz } = await supabase
        .from("archived_assessments")
        .select("id, quiz_title, total_points")
        .eq("classroom_id", classroom.id);

      // Fetch quiz results
      const { data: qResults } = await supabase
        .from("student_quiz_results")
        .select("student_id, quiz_title, total_score")
        .eq("classroom_id", classroom.id);

      const base64Data = generateExcelClasslistBase64({
        classroomTitle: classroom.title,
        subject: classroom.subject || "",
        section: classroom.section || "",
        room: classroom.room || "",
        schedule: classroom.schedule || "",
        students: normalizedStudents,
        quizzes: (qz || []).map((q: any) => ({
          id: q.id,
          quizTitle: q.quiz_title || "Quiz",
          maxScore: q.total_points || 10,
        })),
        results: (qResults || []).map((r: any) => ({
          studentId: r.student_id,
          studentName: "",
          quizTitle: r.quiz_title,
          totalScore: r.total_score,
        })),
      });

      const cleanTitle = (classroom.title || "Classroom")
        .replace(/[^a-zA-Z0-9_\-\s]/g, "")
        .replace(/\s+/g, "_");
      const fileName = `${cleanTitle}_quiz_scores.xlsx`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Export Student Roster & Scores",
          UTI: "com.microsoft.excel.xlsx",
        });
      } else {
        Alert.alert("Exported", `Saved to: ${fileUri}`);
      }
    } catch (err: any) {
      console.error("Export error:", err);
      Alert.alert("Export Failed", err.message || "Failed to export Excel.");
    } finally {
      setExportingExcel(false);
    }
  }

  // ── 4. Manually Add Student ───────────────────────────────────────────────
  async function handleSaveManualStudent() {
    if (!classroom) return;
    const cleanLast = lastName.trim();
    const cleanFirst = firstName.trim();
    const cleanMiddle = middleName.trim() ? middleName.trim() : null;
    const cleanEmail = email.trim() ? email.trim() : null;

    if (!cleanLast || !cleanFirst) {
      Alert.alert("Missing Fields", "Please enter both Last Name and First Name.");
      return;
    }

    setSavingManual(true);
    try {
      const computedFull = formatStudentFullName({
        last_name: cleanLast,
        first_name: cleanFirst,
        middle_name: cleanMiddle,
      });

      let { data, error } = await supabase
        .from("students")
        .insert({
          classroom_id: classroom.id,
          last_name: cleanLast,
          first_name: cleanFirst,
          middle_name: cleanMiddle,
          full_name: computedFull,
          email: cleanEmail,
          attendance: 100,
          average: 0,
        })
        .select()
        .single();

      if (
        error &&
        (error.code === "PGRST204" ||
          error.message?.includes("last_name") ||
          error.message?.includes("first_name"))
      ) {
        const retry = await supabase
          .from("students")
          .insert({
            classroom_id: classroom.id,
            full_name: computedFull,
            email: cleanEmail,
            attendance: 100,
            average: 0,
          })
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      setAddedCount((prev) => prev + 1);
      setLastName("");
      setFirstName("");
      setMiddleName("");
      setEmail("");
      onStudentsUpdated?.();

      Alert.alert(
        "Student Added! ✅",
        `"${computedFull}" has been added to ${classroom.title}. You can add another or tap Done.`
      );
    } catch (err: any) {
      console.error("Save student error:", err);
      Alert.alert("Error", err.message || "Could not add student.");
    } finally {
      setSavingManual(false);
    }
  }

  if (!classroom) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleModalClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.container, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={[styles.headerRow, { borderBottomColor: borderColor }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeRow}>
                <View style={[styles.accentPill, { backgroundColor: accentColor }]}>
                  <Text style={styles.accentPillText}>NEW CLASSROOM</Text>
                </View>
                {addedCount > 0 && (
                  <View style={[styles.countPill, { backgroundColor: "#10B981" }]}>
                    <Text style={styles.countPillText}>{addedCount} enrolled</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.title, { color: textPrimary }]}>{classroom.title}</Text>
              <Text style={[styles.subtitle, { color: textSecondary }]}>
                {classroom.subject ? `${classroom.subject} • ` : ""}
                {classroom.section || "Manage Student Roster"}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleModalClose}
              style={[styles.closeButton, { backgroundColor: cardBg }]}
              accessibilityLabel="Close onboarding modal"
            >
              <Ionicons name="close" size={20} color={textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {mode === "MENU" ? (
              <View>
                <Text style={[styles.instruction, { color: textPrimary }]}>
                  How would you like to set up your student roster?
                </Text>

                {/* Action 1: Download Excel Template */}
                <TouchableOpacity
                  style={[styles.actionCard, { backgroundColor: cardBg, borderColor }]}
                  onPress={handleDownloadTemplate}
                  disabled={downloadingTemplate}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconCircle, { backgroundColor: "#3B82F6" + "1A" }]}>
                    {downloadingTemplate ? (
                      <ActivityIndicator size="small" color="#3B82F6" />
                    ) : (
                      <Ionicons name="cloud-download-outline" size={24} color="#3B82F6" />
                    )}
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]}>
                      Download Excel Template
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: textSecondary }]}>
                      Pre-formatted BSIT-4 format (Item, Student Name, Email Address)
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSecondary} />
                </TouchableOpacity>

                {/* Action 2: Import Excel */}
                <TouchableOpacity
                  style={[styles.actionCard, { backgroundColor: cardBg, borderColor }]}
                  onPress={handleImportExcel}
                  disabled={importingExcel}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconCircle, { backgroundColor: "#10B981" + "1A" }]}>
                    {importingExcel ? (
                      <ActivityIndicator size="small" color="#10B981" />
                    ) : (
                      <Ionicons name="document-text-outline" size={24} color="#10B981" />
                    )}
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]}>Import Excel Roster</Text>
                    <Text style={[styles.cardSubtitle, { color: textSecondary }]}>
                      Bulk upload student classlist from Excel (.xlsx) or CSV
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSecondary} />
                </TouchableOpacity>

                {/* Action 3: Export Excel */}
                <TouchableOpacity
                  style={[styles.actionCard, { backgroundColor: cardBg, borderColor }]}
                  onPress={handleExportExcel}
                  disabled={exportingExcel}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconCircle, { backgroundColor: "#8B5CF6" + "1A" }]}>
                    {exportingExcel ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : (
                      <Ionicons name="share-outline" size={24} color="#8B5CF6" />
                    )}
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]}>Export Excel</Text>
                    <Text style={[styles.cardSubtitle, { color: textSecondary }]}>
                      Download current student roster and quiz scores record
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSecondary} />
                </TouchableOpacity>

                {/* Action 4: Manually Add Student */}
                <TouchableOpacity
                  style={[styles.actionCard, { backgroundColor: cardBg, borderColor }]}
                  onPress={() => setMode("MANUAL_ADD")}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconCircle, { backgroundColor: "#F97316" + "1A" }]}>
                    <Ionicons name="person-add-outline" size={24} color="#F97316" />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={[styles.cardTitle, { color: textPrimary }]}>
                      Manually Add Student
                    </Text>
                    <Text style={[styles.cardSubtitle, { color: textSecondary }]}>
                      Form input for Last Name, First Name, Middle Name, and Email
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              /* Manual Add Student Form */
              <View>
                <View style={styles.formNavRow}>
                  <TouchableOpacity
                    onPress={() => setMode("MENU")}
                    style={styles.backButton}
                  >
                    <Ionicons name="arrow-back" size={18} color={accentColor} />
                    <Text style={[styles.backText, { color: accentColor }]}>All Actions</Text>
                  </TouchableOpacity>
                  <Text style={[styles.formHeaderTitle, { color: textPrimary }]}>
                    Manual Student Entry
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: textPrimary }]}>Last Name *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: inputBg, color: textPrimary, borderColor },
                    ]}
                    placeholder="e.g. Abellanosa"
                    placeholderTextColor={textSecondary}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: textPrimary }]}>First Name *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: inputBg, color: textPrimary, borderColor },
                    ]}
                    placeholder="e.g. Reymark"
                    placeholderTextColor={textSecondary}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: textPrimary }]}>
                    Middle Name / Initial (Optional)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: inputBg, color: textPrimary, borderColor },
                    ]}
                    placeholder="e.g. B."
                    placeholderTextColor={textSecondary}
                    value={middleName}
                    onChangeText={setMiddleName}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: textPrimary }]}>
                    Email Address (Optional)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: inputBg, color: textPrimary, borderColor },
                    ]}
                    placeholder="e.g. student@school.edu"
                    placeholderTextColor={textSecondary}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.saveStudentButton, { backgroundColor: accentColor }]}
                  onPress={handleSaveManualStudent}
                  disabled={savingManual}
                >
                  {savingManual ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.saveStudentButtonText}>Save Student to Roster</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Bottom Action Footer */}
          <View style={[styles.footerRow, { borderTopColor: borderColor }]}>
            <TouchableOpacity
              style={[styles.doneButton, { backgroundColor: accentColor }]}
              onPress={() => {
                handleModalClose();
                if (onEnterClassroom && classroom) {
                  onEnterClassroom(classroom);
                }
              }}
            >
              <Text style={styles.doneButtonText}>Done / Go to Classroom</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  accentPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  accentPillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  countPillText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  scrollContent: {
    padding: 20,
  },
  instruction: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 16,
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 3,
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  formNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  backText: {
    fontSize: 14,
    fontWeight: "700",
  },
  formHeaderTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  saveStudentButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  saveStudentButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  footerRow: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  doneButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});