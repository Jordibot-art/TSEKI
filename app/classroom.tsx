import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import AIBuilderTab from "../components/AIBuilderTab";
import GraderTab from "../components/GraderTab";
import TrackerTab from "../components/TrackerTab";
import { useTheme } from "../context/ThemeContext";
import {
  clearAllAlerts,
  deleteClassroomAlerts,
  deleteStudentAlerts,
  getClearedAlertIds,
  getPersistedAlerts,
  getReadAlertIds,
  markAlertsAsRead,
  RosterAlert,
} from "../lib/alertStore";
import {
  deleteClassroomQuizzes,
  getPublishedQuizzes,
  StoredQuiz,
} from "../lib/quizStore";
import { supabase } from "../supabase";
import { generateStudentAdvice } from "../lib/pedagogicalAdvice";
import { getStudentResults, StudentQuizResult } from "../lib/questionAnalysis";

// ── Types ─────────────────────────────────────────────────────────────────────
type Student = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
  attendance?: number;
};

type Tab = "Record" | "AI Builder" | "Grader" | "Tracker";

// ── Theme Constants ───────────────────────────────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";
const ORANGE_BORDER = "#FFEDD5";
const TEXT_DARK = "#181920";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#FF6B00", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899",
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getStudentAvatar(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("sarah") || lower.includes("jenkins")) {
    return "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80";
  }
  if (lower.includes("michael") || lower.includes("chang")) {
    return "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80";
  }
  if (lower.includes("emily") || lower.includes("davis")) {
    return "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80";
  }
  return null;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ClassroomScreen() {
  const router = useRouter();
  const {
    id,
    title,
    schedule,
    room,
    color,
    subject,
    section,
    initialTab,
    openStudentId,
    openStudentName,
  } = useLocalSearchParams<{
    id: string;
    title: string;
    schedule?: string;
    room?: string;
    color: string;
    subject?: string;
    section?: string;
    initialTab?: Tab;
    openStudentId?: string;
    openStudentName?: string;
  }>();

  const classroomSubject = subject || "";
  const classroomSection = section || "";
  const classroomRoom = room || "";
  const classroomSchedule = schedule || "";

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab === "Tracker" || initialTab === "AI Builder" || initialTab === "Grader"
      ? initialTab
      : "Record"
  );
  const [selectedGradingQuiz, setSelectedGradingQuiz] = useState<string | undefined>(undefined);
  const [publishedQuizzes, setPublishedQuizzes] = useState<StoredQuiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add-student modal
  const [modalVisible, setModalVisible] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Student Profile Detail Modal
  const [selectedProfile, setSelectedProfile] = useState<Student | null>(null);
  const [studentQuizResults, setStudentQuizResults] = useState<StudentQuizResult[]>([]);

  // Notification Alert state for this classroom
  const [classroomAlerts, setClassroomAlerts] = useState<RosterAlert[]>([]);
  const [classroomUnreadCount, setClassroomUnreadCount] = useState<number>(0);
  const [notifModalVisible, setNotifModalVisible] = useState<boolean>(false);

  // Deletion Confirmation States
  const [confirmDeleteStudentModal, setConfirmDeleteStudentModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);

  const [confirmDeleteClassModal, setConfirmDeleteClassModal] = useState(false);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  const loadClassroomAlerts = useCallback(async () => {
    if (!id) return;
    try {
      const [persisted, clearedIds, readIds] = await Promise.all([
        getPersistedAlerts(),
        getClearedAlertIds(),
        getReadAlertIds(),
      ]);

      const activeAlerts: RosterAlert[] = [];

      // 1. From real students with a recorded average between 1% and 50%
      for (const s of students) {
        if (s.average !== null && s.average !== undefined && s.average > 0 && s.average <= 50) {
          const alertId = `flag_${s.id}`;
          if (!clearedIds.includes(alertId) && !clearedIds.includes(s.id)) {
            activeAlerts.push({
              id: alertId,
              studentId: s.id,
              studentName: s.full_name || "Student",
              classroomId: id,
              classroomTitle: (title as string) || "Classroom",
              classroomSchedule: (schedule as string) || "",
              classroomRoom: (room as string) || "",
              classroomColor: color || ORANGE,
              scorePercentage: s.average,
              alertType: s.average <= 40 ? "HIGH RISK" : "URGENT REVIEW",
              message: `${s.full_name || "Student"} has dropped to an average of ${s.average}%. Performance Flagged: At-Risk.`,
              createdAt: new Date().toISOString(),
              timeLabel: "Today",
              isRead:
                readIds.includes(alertId) ||
                readIds.includes(s.id) ||
                readIds.includes(`alert_${s.id}`),
            });
          }
        }
      }

      // 2. From persisted alerts specifically for this classroom
      for (const p of persisted) {
        if (
          p.classroomId === id &&
          !clearedIds.includes(p.id) &&
          !clearedIds.includes(p.studentId)
        ) {
          const isRead =
            readIds.includes(p.id) ||
            readIds.includes(p.studentId) ||
            readIds.includes(`flag_${p.studentId}`);
          const existingIdx = activeAlerts.findIndex((a) => a.studentId === p.studentId);
          if (existingIdx === -1) {
            activeAlerts.push({
              ...p,
              isRead,
            });
          } else {
            activeAlerts[existingIdx] = {
              ...p,
              isRead,
            };
          }
        }
      }

      setClassroomAlerts(activeAlerts);
      setClassroomUnreadCount(activeAlerts.filter((a) => !a.isRead).length);
    } catch (err) {
      console.error("Failed to load classroom alerts:", err);
    }
  }, [id, title, schedule, room, color, students]);

  useEffect(() => {
    loadClassroomAlerts();
  }, [loadClassroomAlerts]);

  // Load per-question results for selected student profile (for advice engine)
  useEffect(() => {
    if (selectedProfile && id) {
      getStudentResults(id, selectedProfile.id).then(setStudentQuizResults);
    } else {
      setStudentQuizResults([]);
    }
  }, [selectedProfile, id]);

  // ── Classroom Notification Handlers ────────────────────────────────────────
  function handleOpenNotifModal() {
    setNotifModalVisible(true);
  }

  async function handleClassroomAlertPress(alert: RosterAlert) {
    await markAlertsAsRead([alert.id, alert.studentId, `flag_${alert.studentId}`]);
    setClassroomAlerts((prev) =>
      prev.map((a) =>
        a.id === alert.id || a.studentId === alert.studentId ? { ...a, isRead: true } : a
      )
    );
    setClassroomUnreadCount((prev) => Math.max(0, prev - 1));
    setNotifModalVisible(false);

    // Switch to Tracker tab and open student profile
    setActiveTab("Tracker");
    const match = students.find(
      (s) =>
        s.id === alert.studentId ||
        s.full_name.toLowerCase() === alert.studentName.toLowerCase()
    );
    if (match) {
      setSelectedProfile(match);
    }
  }

  async function handleClearAllClassroomAlerts() {
    await clearAllAlerts(classroomAlerts);
    setClassroomAlerts([]);
    setClassroomUnreadCount(0);
  }

  // ── Remove Student Handlers ────────────────────────────────────────────────
  function promptDeleteStudent(student: Student | null) {
    if (!student) return;
    setStudentToDelete(student);
    setConfirmDeleteStudentModal(true);
  }

  async function handleConfirmDeleteStudent() {
    if (!studentToDelete || isDeletingStudent) return;
    setIsDeletingStudent(true);

    try {
      const studentId = studentToDelete.id;
      // 1. Delete student record from Supabase
      const { error } = await supabase.from("students").delete().eq("id", studentId);
      if (error) throw error;

      // 2. Delete related alerts in alertStore
      await deleteStudentAlerts(studentId);

      // 3. Update local state
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
      if (selectedProfile?.id === studentId) {
        setSelectedProfile(null);
      }
      setConfirmDeleteStudentModal(false);
      setStudentToDelete(null);
      loadClassroomAlerts();
    } catch (err: any) {
      console.error("Failed to delete student:", err);
      Alert.alert("Error Removing Student", err.message || "Failed to remove student from database.");
    } finally {
      setIsDeletingStudent(false);
    }
  }

  // ── Delete Classroom Handlers ──────────────────────────────────────────────
  function promptDeleteClassroom() {
    setConfirmDeleteClassModal(true);
  }

  async function handleConfirmDeleteClassroom() {
    if (!id || isDeletingClass) return;
    setIsDeletingClass(true);

    try {
      // 1. Delete all students enrolled in this classroom
      await supabase.from("students").delete().eq("classroom_id", id);

      // 2. Delete the classroom record
      const { error } = await supabase.from("classrooms").delete().eq("id", id);
      if (error) throw error;

      // 3. Purge related alerts and quiz storage
      await Promise.all([
        deleteClassroomAlerts(id),
        deleteClassroomQuizzes(id),
      ]);

      setConfirmDeleteClassModal(false);
      router.replace("/homepage");
    } catch (err: any) {
      console.error("Failed to delete classroom:", err);
      Alert.alert("Error Deleting Classroom", err.message || "Failed to delete classroom from database.");
      setIsDeletingClass(false);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadStudents();
  }, []);

  // Auto-switch to initialTab if param changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab as Tab);
    }
  }, [initialTab]);

  // Auto-open requested student profile preview when redirected from notification alert
  useEffect(() => {
    if ((openStudentId || openStudentName) && students.length > 0) {
      const match = students.find(
        (s) =>
          (openStudentId && s.id === openStudentId) ||
          (openStudentName && s.full_name.toLowerCase() === openStudentName.toLowerCase())
      );
      if (match) {
        setSelectedProfile(match);
        // Automatically mark as read when viewed
        const toMark = [
          match.id,
          `flag_${match.id}`,
          `alert_${match.id}`,
          ...(openStudentId ? [openStudentId, `flag_${openStudentId}`, `alert_${openStudentId}`] : []),
        ];
        markAlertsAsRead(toMark).then(() => {
          loadClassroomAlerts();
        });
      }
    }
  }, [students, openStudentId, openStudentName, loadClassroomAlerts]);

  useEffect(() => {
    if (id) {
      getPublishedQuizzes(id).then(setPublishedQuizzes);
    }
  }, [id, activeTab]);

  async function loadStudents() {
    setLoading(true);
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("classroom_id", id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setStudents(data as Student[]);
    } else {
      setStudents([]);
    }
    setLoading(false);
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────
  function openAddModal() {
    setFullName("");
    setEmail("");
    setModalVisible(true);
  }

  function handleCancel() {
    Keyboard.dismiss();
    setModalVisible(false);
  }

  async function handleAddStudent() {
    if (!fullName.trim() || saving) return;
    setSaving(true);

    const { data, error } = await supabase
      .from("students")
      .insert({
        classroom_id: id,
        full_name: fullName.trim(),
        email: email.trim() || null,
        attendance: 100,
        average: 0,
      })
      .select()
      .single();

    if (!error && data) {
      setStudents((prev) => [...prev, data as Student]);
    } else if (error) {
      Alert.alert("Error adding student", error.message);
    }

    Keyboard.dismiss();
    setSaving(false);
    setModalVisible(false);
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const tabs: Tab[] = ["Record", "AI Builder", "Grader", "Tracker"];
  const cardColor = color || ORANGE;
  const { darkMode } = useTheme();

  // ── Dynamic theme colors ──────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#F9FAFB";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#E5E7EB";
  const subBorder = darkMode ? "#374151" : "#F3F4F6";
  const inputBg = darkMode ? "#374151" : "#F9FAFB";
  const btnSecondaryBg = darkMode ? "#374151" : "#F3F4F6";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Top App Bar ── */}
      <View style={[styles.topBar, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <View style={[styles.backIconCircle, { backgroundColor: darkMode ? "#374151" : ORANGE_LIGHT }]}>
            <Ionicons name="chevron-back" size={18} color={ORANGE} />
          </View>
          <Text style={[styles.backText, { color: textMain }]}>Classrooms</Text>
        </TouchableOpacity>

        <Text style={[styles.topSubject, { color: textMain }]} numberOfLines={1}>
          {classroomSubject || title}
        </Text>

        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={[styles.topBarActionBtn, { backgroundColor: darkMode ? "#374151" : "#FEE2E2" }]}
            onPress={promptDeleteClassroom}
            activeOpacity={0.8}
            accessibilityLabel="Delete Classroom"
          >
            <Ionicons name="trash-outline" size={16} color="#EF4444" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.notifDot, { backgroundColor: darkMode ? "#374151" : ORANGE_LIGHT }]}
            onPress={handleOpenNotifModal}
            activeOpacity={0.8}
          >
            <Ionicons name="notifications" size={18} color={ORANGE} />
            {classroomUnreadCount > 0 && (
              <View
                style={[
                  styles.topBarBadge,
                  { borderColor: darkMode ? "#1F2937" : "#FFFFFF" },
                ]}
              >
                <Text style={styles.topBarBadgeText}>
                  {classroomUnreadCount > 9 ? "9+" : classroomUnreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={[styles.scroll, { backgroundColor: bg }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Class Banner ── */}
        <View style={[styles.banner, { backgroundColor: cardColor }]}>
          {/* subtle lighter overlay stripe */}
          <View style={styles.bannerStripe} />
          {classroomSubject ? (
            <View style={styles.bannerSubjectBadge}>
              <Text style={styles.bannerSubjectText}>{classroomSubject.toUpperCase()}</Text>
            </View>
          ) : null}
          <Text style={styles.bannerTitle}>{title}</Text>
          <View style={styles.bannerDetailsRow}>
            {classroomSection ? (
              <View style={styles.bannerDetailItem}>
                <Ionicons name="people-outline" size={13} color="rgba(255,255,255,0.9)" />
                <Text style={styles.bannerSubText}>{classroomSection}</Text>
              </View>
            ) : null}
            {(classroomSection && classroomRoom) ? (
              <Text style={styles.bannerDetailDot}>•</Text>
            ) : null}
            {classroomRoom ? (
              <View style={styles.bannerDetailItem}>
                <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.9)" />
                <Text style={styles.bannerSubText}>
                  {classroomRoom.toLowerCase().startsWith("room") ? classroomRoom : `Room ${classroomRoom}`}
                </Text>
              </View>
            ) : null}
            {(classroomSchedule && (classroomSection || classroomRoom)) ? (
              <Text style={styles.bannerDetailDot}>•</Text>
            ) : null}
            {classroomSchedule ? (
              <View style={styles.bannerDetailItem}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.95)" />
                <Text style={styles.bannerSubText}>{classroomSchedule}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Tab Bar ── */}
        <View style={[styles.tabBar, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tab,
                  {
                    backgroundColor: isActive
                      ? cardColor
                      : darkMode
                      ? "#374151"
                      : "#F8FAFC",
                  },
                  isActive && {
                    shadowColor: cardColor,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 5,
                    elevation: 3,
                  },
                ]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? "#FFFFFF" : textSub },
                    isActive && styles.tabTextActive,
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Tab Content ── */}
        {activeTab === "Record" && (
          <>
            {/* ── Action Row ── */}
            <View style={[styles.actionRow, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
              <TouchableOpacity
                style={[styles.importBtn, { backgroundColor: cardColor, shadowColor: cardColor }]}
                activeOpacity={0.85}
              >
                <Ionicons name="cloud-upload-outline" size={17} color="#FFFFFF" />
                <Text style={styles.importBtnText}>Import Record</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.exportBtn,
                  {
                    backgroundColor: darkMode ? "#374151" : ORANGE_LIGHT,
                    borderColor: darkMode ? "#4B5563" : ORANGE_BORDER,
                    borderWidth: 1,
                  },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="document-text-outline"
                  size={17}
                  color={darkMode ? "#F3F4F6" : ORANGE}
                />
                <Text style={[styles.exportBtnText, { color: darkMode ? "#F3F4F6" : ORANGE }]}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabSmall, { backgroundColor: cardColor, shadowColor: cardColor }]}
                onPress={openAddModal}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {activeTab === "AI Builder" && (
          <AIBuilderTab
            classroomId={id as string}
            classTitle={title as string}
            classSubject={classroomSubject}
            accentColor={cardColor}
            onQuizPublished={(quizTitle) => {
              setSelectedGradingQuiz(quizTitle);
              setActiveTab("Grader");
            }}
          />
        )}

        {activeTab === "Grader" && (
          <GraderTab
            classroomId={id as string}
            classTitle={title as string}
            accentColor={cardColor}
            students={students}
            defaultSelectedQuiz={selectedGradingQuiz}
            onScoreRecorded={(studentId, newAvg) => {
              setStudents((prev) =>
                prev.map((s) => (s.id === studentId ? { ...s, average: newAvg } : s))
              );
              loadClassroomAlerts();
            }}
            onStudentCreated={(newStudent) => {
              setStudents((prev) => [...prev, newStudent]);
              loadClassroomAlerts();
            }}
          />
        )}

        {activeTab === "Tracker" && (
          <TrackerTab
            classroomId={id as string}
            classTitle={title as string}
            classSubject={classroomSubject}
            students={students}
            publishedQuizzes={publishedQuizzes}
            selectedQuizTitle={selectedGradingQuiz}
            onOpenStudentProfile={(student) => setSelectedProfile(student)}
            onNavigateToAIBuilder={() => setActiveTab("AI Builder")}
            onNavigateToGrader={() => setActiveTab("Grader")}
          />
        )}

        {activeTab === "Record" && (
          <>
            {/* ── Search Bar ── */}
            <View style={[styles.searchBar, { backgroundColor: cardBg, borderColor: darkMode ? border : "#E5E7EB" }]}>
              <Ionicons name="search-outline" size={18} color={ORANGE} />
              <TextInput
                style={[styles.searchInput, { color: textMain }]}
                placeholder="Search students by name or email..."
                placeholderTextColor={textSub}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={17} color={textSub} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Roster Header ── */}
            <View style={styles.rosterHeader}>
              <Text style={[styles.rosterTitle, { color: textMain }]}>
                Student Rosters ({filtered.length})
              </Text>
              <Text style={[styles.rosterHint, { color: textSub }]}>Tap name to view details</Text>
            </View>

            {/* ── Student List ── */}
            {loading ? (
              <ActivityIndicator
                size="large"
                color={cardColor}
                style={{ marginVertical: 40 }}
              />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={52} color={darkMode ? "#4B5563" : "#D1D5DB"} />
                <Text style={[styles.emptyTitle, { color: textSub }]}>No students yet</Text>
                <Text style={[styles.emptySub, { color: textSub }]}>
                  Tap the{" "}
                  <Text style={{ color: cardColor, fontWeight: "700" }}>+</Text>{" "}
                  button to add your first student
                </Text>
              </View>
            ) : (
              filtered.map((student, i) => {
                const avg = student.average ?? 0;
                const isFlagged = avg <= 50;
                const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
                const isTop = !isFlagged && highestAvg > 50 && avg === highestAvg;
                const avatarUri = getStudentAvatar(student.full_name);

                return (
                  <TouchableOpacity
                    key={student.id}
                    style={[styles.studentRow, { backgroundColor: cardBg, borderColor: subBorder }]}
                    onPress={() => setSelectedProfile(student)}
                    activeOpacity={0.7}
                  >
                    {/* Avatar */}
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                    ) : (
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] },
                        ]}
                      >
                        <Text style={styles.avatarText}>
                          {getInitials(student.full_name)}
                        </Text>
                      </View>
                    )}

                    {/* Info */}
                    <View style={styles.studentInfo}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.studentName, { color: textMain }]} numberOfLines={1}>
                          {student.full_name}
                        </Text>
                        {isTop && (
                          <View style={[styles.topBadge, { backgroundColor: darkMode ? "#1E3A8A" : "#DBEAFE" }]}>
                            <Text style={[styles.topBadgeText, { color: darkMode ? "#93C5FD" : "#2563EB" }]}>Top</Text>
                          </View>
                        )}
                        {isFlagged && (
                          <View style={[styles.flaggedBadge, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}>
                            <Ionicons name="warning-outline" size={12} color={darkMode ? "#FCA5A5" : "#DC2626"} />
                            <Text style={[styles.flaggedBadgeText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>Flagged</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.studentEmail, { color: textSub }]} numberOfLines={1}>
                        {student.email ?? "No email"}
                      </Text>
                    </View>

                    {/* Stats */}
                    <View style={styles.studentStats}>
                      <View style={styles.statCol}>
                        <Text style={[styles.statValue, { color: textMain }]}>{avg}%</Text>
                        <Text style={[styles.statLabel, { color: textSub }]}>Average</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.deleteStudentRowBtn, { backgroundColor: darkMode ? "#374151" : "#FEE2E2" }]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          promptDeleteStudent(student);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                        accessibilityLabel="Remove student"
                      >
                        <Ionicons name="trash-outline" size={15} color="#EF4444" />
                      </TouchableOpacity>
                      <Ionicons name="arrow-forward" size={16} color={textSub} />
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* ── Add New Student Modal ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={handleCancel}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: textMain }]}>Add New Student</Text>
                    <TouchableOpacity
                      onPress={handleCancel}
                      style={[styles.modalCloseBtn, { backgroundColor: btnSecondaryBg }]}
                    >
                      <Ionicons name="close" size={22} color={textSub} />
                    </TouchableOpacity>
                  </View>

                  {/* Full Name */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    FULL NAME <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Liam Smith"
                    placeholderTextColor={textSub}
                    value={fullName}
                    onChangeText={setFullName}
                  />

                  {/* Email */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>EMAIL ADDRESS</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. liam.smith@school.edu"
                    placeholderTextColor={textSub}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  {/* Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: border, backgroundColor: btnSecondaryBg }]}
                      onPress={handleCancel}
                    >
                      <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
                        { backgroundColor: cardColor, shadowColor: cardColor },
                        (!fullName.trim() || saving) && styles.addBtnDisabled,
                      ]}
                      onPress={handleAddStudent}
                      disabled={!fullName.trim() || saving}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.addBtnText}>Add Student</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Student Profile Modal (Popup) ── */}
      <Modal
        visible={selectedProfile !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedProfile(null)}
      >
        <View style={styles.profileModalOverlay}>
          {/* Backdrop dismiss touchable */}
          <TouchableWithoutFeedback onPress={() => setSelectedProfile(null)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          {selectedProfile && (() => {
            const profileAvg = selectedProfile.average ?? 0;
            const profileIsFlagged = profileAvg <= 50;
            const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
            const profileIsTop = !profileIsFlagged && highestAvg > 50 && profileAvg === highestAvg;
            const firstName = selectedProfile.full_name.split(" ")[0];
            const profileAvatar = getStudentAvatar(selectedProfile.full_name);

            const quizTitleDisplay =
              publishedQuizzes[0]?.quizTitle ||
              selectedGradingQuiz ||
              classroomSubject ||
              (schedule !== "No Subject" ? schedule : "") ||
              "Assessment";

            const quizTotalPoints = publishedQuizzes[0]?.questions?.length || 10;
            const quizScore = Math.round((profileAvg / 100) * quizTotalPoints);

            return (
              <View style={[styles.profileModalCard, { backgroundColor: cardBg }]}>
                {/* Header (Pinned) */}
                <View style={[styles.profileHeader, { backgroundColor: cardColor }]}>
                  <View style={styles.profileHeaderLeft}>
                    {profileAvatar ? (
                      <Image source={{ uri: profileAvatar }} style={styles.profileAvatarImg} />
                    ) : (
                      <View style={styles.profileAvatarFallback}>
                        <Text style={styles.profileAvatarFallbackText}>
                          {getInitials(selectedProfile.full_name)}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.profileName} numberOfLines={1}>
                        {selectedProfile.full_name}
                      </Text>
                      <Text style={styles.profileEmail} numberOfLines={1}>
                        {selectedProfile.email || "No email registered"}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.profileCloseBtn}
                    onPress={() => setSelectedProfile(null)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                {/* Scrollable Body Content */}
                <ScrollView
                  style={[styles.profileScroll, { backgroundColor: bg }]}
                  contentContainerStyle={styles.profileBody}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled={true}
                >
                  {/* Stats Row */}
                  <View style={styles.profileStatsRow}>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>AVERAGE</Text>
                      <Text style={[styles.statBoxValue, { color: textMain }]}>{profileAvg}%</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>STATUS</Text>
                      {profileIsTop ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#1E3A8A" : "#EFF6FF" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#93C5FD" : "#2563EB" }]}>TOP TIER</Text>
                        </View>
                      ) : profileIsFlagged ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>AT RISK</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#064E3B" : "#ECFDF5" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#6EE7B7" : "#059669" }]}>ON TRACK</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* At-Risk Warning Flag (Only if profileIsFlagged) */}
                  {profileIsFlagged && (
                    <View style={[styles.atRiskCard, { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2", borderColor: darkMode ? "#7F1D1D" : "#FECACA" }]}>
                      <Ionicons name="warning-outline" size={20} color={darkMode ? "#FCA5A5" : "#DC2626"} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.atRiskTitle, { color: darkMode ? "#FCA5A5" : "#991B1B" }]}>At-Risk Behavioral Flag</Text>
                        <Text style={[styles.atRiskSub, { color: darkMode ? "#F87171" : "#DC2626" }]}>
                          {quizTitleDisplay} score below threshold
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Quiz Grade Sheet */}
                  <View style={styles.quizSheetSection}>
                    <View style={styles.quizSheetHeader}>
                      <Ionicons name="book-outline" size={14} color={textSub} />
                      <Text style={[styles.quizSheetTitle, { color: textSub }]}>QUIZ GRADE SHEET</Text>
                    </View>
                    <View style={[styles.quizScoreCard, { backgroundColor: cardBg, borderColor: border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.quizScoreName, { color: textMain }]} numberOfLines={1}>
                          {quizTitleDisplay}
                        </Text>
                        <Text style={[styles.quizScoreSub, { color: textSub }]}>Total weight: {quizTotalPoints} points</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <View style={styles.quizScoreNumRow}>
                          <Text style={[styles.quizScoreNum, { color: textMain }]}>
                            {quizScore} / {quizTotalPoints}
                          </Text>
                          <View
                            style={[
                              styles.quizScoreDot,
                              { backgroundColor: profileIsFlagged ? "#EF4444" : "#10B981" },
                            ]}
                          />
                        </View>
                        <Text style={[styles.quizScorePercent, { color: textSub }]}>({profileAvg}%)</Text>
                      </View>
                    </View>
                  </View>

                  {/* Tseki Pedagogical Advice */}
                  <View style={[styles.pedagogicalCard, { backgroundColor: darkMode ? "#292524" : "#FFFBEB", borderColor: darkMode ? "#44403C" : "#FED7AA" }]}>
                    <View style={styles.pedagogicalHeader}>
                      <Ionicons name="sparkles" size={15} color={darkMode ? "#34D399" : "#059669"} />
                      <Text style={[styles.pedagogicalTitle, { color: darkMode ? "#FDBA74" : "#9A3412" }]}>TSEKI PEDAGOGICAL ADVICE</Text>
                    </View>
                    <Text style={[styles.pedagogicalText, { color: darkMode ? "#D6D3D1" : "#475569" }]}>
                      {generateStudentAdvice({
                        studentName: selectedProfile.full_name,
                        average: profileAvg,
                        classAverage: students.length > 0 ? Math.round(students.reduce((sum, s) => sum + (s.average ?? 0), 0) / students.length) : 0,
                        highestAvg: highestAvg,
                        subject: classroomSubject || (schedule && schedule !== "No Subject" ? schedule : "") || "",
                        quizTitle: quizTitleDisplay,
                        difficulty: publishedQuizzes[0]?.difficulty,
                        totalStudents: students.length,
                        studentResults: studentQuizResults,
                      })}
                    </Text>
                  </View>
                </ScrollView>

                {/* Fixed Footer Action Buttons (Always Visible at bottom!) */}
                <View style={[styles.profileFooter, { backgroundColor: cardBg, borderTopColor: border }]}>
                  <TouchableOpacity
                    style={[styles.emailBtn, { backgroundColor: cardColor }]}
                    onPress={() => {
                      if (selectedProfile.email) {
                        Linking.openURL(`mailto:${selectedProfile.email}`);
                      } else {
                        Alert.alert("No Email", `${selectedProfile.full_name} does not have an email address recorded.`);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="mail" size={16} color="#FFFFFF" />
                    <Text style={styles.emailBtnText}>Email</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.removeStudentProfileBtn, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}
                    onPress={() => promptDeleteStudent(selectedProfile)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    <Text style={[styles.removeStudentProfileBtnText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>Remove</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.closeProfileBtn, { backgroundColor: btnSecondaryBg }]}
                    onPress={() => setSelectedProfile(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.closeProfileBtnText, { color: textSub }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* ── Classroom Active Roster Alerts Modal ── */}
      <Modal
        visible={notifModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifModalVisible(false)}
      >
        <View style={styles.alertsModalOverlay}>
          <TouchableWithoutFeedback onPress={() => setNotifModalVisible(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.alertsCard,
              {
                backgroundColor: cardBg,
                borderColor: darkMode ? "#4B5563" : "#0F172A",
              },
            ]}
          >
            {/* Header */}
            <View style={styles.alertsHeader}>
              <View style={styles.alertsHeaderLeft}>
                <Ionicons name="notifications" size={18} color={ORANGE} />
                <Text style={[styles.alertsTitle, { color: textMain }]}>Classroom Alerts</Text>
              </View>
              {classroomAlerts.length > 0 && (
                <TouchableOpacity onPress={handleClearAllClassroomAlerts} activeOpacity={0.7}>
                  <Text style={styles.alertsClearBtn}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Content */}
            {classroomAlerts.length === 0 ? (
              <View style={styles.alertsEmptyState}>
                <Ionicons name="shield-checkmark-outline" size={32} color="#10B981" />
                <Text style={[styles.alertsEmptyTitle, { color: textMain }]}>All Clear</Text>
                <Text style={[styles.alertsEmptySub, { color: textSub }]}>
                  No students currently flagged as at-risk in this classroom.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.alertsList} showsVerticalScrollIndicator={false}>
                {classroomAlerts.map((alert) => (
                  <TouchableOpacity
                    key={alert.id}
                    style={[
                      styles.alertCard,
                      {
                        backgroundColor: darkMode ? "#374151" : "#FFFFFF",
                        borderColor: alert.isRead ? (darkMode ? "#4B5563" : "#E5E7EB") : ORANGE,
                      },
                    ]}
                    onPress={() => handleClassroomAlertPress(alert)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.alertCardHeader}>
                      <View style={styles.alertCardTag}>
                        <Ionicons name="warning-outline" size={12} color="#DC2626" />
                        <Text style={styles.alertCardTagText}>{alert.alertType}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {alert.isRead ? (
                          <View style={styles.readBadge}>
                            <Ionicons name="checkmark-done" size={11} color="#10B981" />
                            <Text style={styles.readBadgeText}>READ</Text>
                          </View>
                        ) : (
                          <View style={styles.newBadge}>
                            <Text style={styles.newBadgeText}>NEW</Text>
                          </View>
                        )}
                        <Text style={styles.alertCardTime}>{alert.timeLabel}</Text>
                      </View>
                    </View>
                    <Text style={[styles.alertCardMessage, { color: textMain }]}>
                      {alert.message}
                    </Text>
                    <View style={styles.alertCardActionRow}>
                      <Text style={styles.alertCardActionText} numberOfLines={1}>
                        Tap to view student in Tracker & profile
                      </Text>
                      <Ionicons name="arrow-forward" size={12} color="#2563EB" />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Remove Student Confirmation Modal ── */}
      <Modal
        visible={confirmDeleteStudentModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isDeletingStudent && setConfirmDeleteStudentModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingStudent && setConfirmDeleteStudentModal(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View style={[styles.confirmModalCard, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.dangerIconWrap}>
              <Ionicons name="person-remove" size={30} color="#EF4444" />
            </View>

            <Text style={[styles.confirmModalTitle, { color: textMain }]}>Remove Student?</Text>
            <Text style={[styles.confirmModalDesc, { color: textSub }]}>
              Are you sure you want to remove{" "}
              <Text style={{ fontWeight: "700", color: textMain }}>"{studentToDelete?.full_name}"</Text>{" "}
              from this classroom?
              {"\n\n"}Their grades and quiz evaluation records will be permanently deleted.
            </Text>

            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={[styles.confirmCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}
                onPress={() => setConfirmDeleteStudentModal(false)}
                disabled={isDeletingStudent}
                activeOpacity={0.7}
              >
                <Text style={[styles.confirmCancelBtnText, { color: textMain }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmDeleteBtn, isDeletingStudent && styles.btnDisabled]}
                onPress={handleConfirmDeleteStudent}
                disabled={isDeletingStudent}
                activeOpacity={0.8}
              >
                {isDeletingStudent ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.confirmDeleteBtnText}>Remove</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete Classroom Confirmation Modal ── */}
      <Modal
        visible={confirmDeleteClassModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isDeletingClass && setConfirmDeleteClassModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingClass && setConfirmDeleteClassModal(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View style={[styles.confirmModalCard, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.dangerIconWrap}>
              <Ionicons name="trash" size={30} color="#EF4444" />
            </View>

            <Text style={[styles.confirmModalTitle, { color: textMain }]}>Delete Classroom?</Text>
            <Text style={[styles.confirmModalDesc, { color: textSub }]}>
              Are you sure you want to permanently delete{" "}
              <Text style={{ fontWeight: "700", color: textMain }}>"{title}"</Text>?
              {"\n\n"}All enrolled students, quizzes, answer keys, and grade tracking records for this classroom will be permanently deleted.
            </Text>

            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={[styles.confirmCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}
                onPress={() => setConfirmDeleteClassModal(false)}
                disabled={isDeletingClass}
                activeOpacity={0.7}
              >
                <Text style={[styles.confirmCancelBtnText, { color: textMain }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmDeleteBtn, isDeletingClass && styles.btnDisabled]}
                onPress={handleConfirmDeleteClassroom}
                disabled={isDeletingClass}
                activeOpacity={0.8}
              >
                {isDeletingClass ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.confirmDeleteBtnText}>Delete Class</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },

  /* ── Top Bar ── */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  backIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontSize: 15,
    color: "#181920",
    fontWeight: "700",
  },
  topSubject: {
    fontSize: 16,
    fontWeight: "800",
    color: "#181920",
    flex: 1,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  notifDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  /* ── Scroll ── */
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 48,
  },

  /* ── Banner ── */
  banner: {
    paddingHorizontal: 22,
    paddingVertical: 20,
    overflow: "hidden",
  },
  bannerStripe: {
    position: "absolute",
    right: -30,
    top: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  bannerSubjectBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  bannerSubjectText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  bannerDetailsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  bannerDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  bannerDetailDot: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
    fontWeight: "700",
  },
  bannerSubText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.95)",
    fontWeight: "600",
  },
  bannerSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    fontWeight: "500",
  },

  /* ── Tabs ── */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  tabActive: {
    backgroundColor: ORANGE,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
  },
  tabTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  /* ── Action Row ── */
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  importBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 12,
    gap: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  importBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  exportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ORANGE_LIGHT,
    borderRadius: 14,
    paddingVertical: 12,
    gap: 6,
  },
  exportBtnText: {
    color: ORANGE,
    fontWeight: "700",
    fontSize: 13,
  },
  fabSmall: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },

  /* ── Search ── */
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#1F2937",
  },

  /* ── Roster ── */
  rosterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  rosterTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1F2937",
  },
  rosterHint: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
  },

  /* ── Student Row ── */
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },
  studentInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  studentName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1F2937",
  },
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  topBadge: {
    backgroundColor: "#DBEAFE",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  topBadgeText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#2563EB",
  },
  flaggedBadge: {
    backgroundColor: "#FEE2E2",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  flaggedBadgeText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#DC2626",
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 8,
  },
  studentEmail: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  studentStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statCol: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1F2937",
  },
  statLabel: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "500",
  },

  /* ── Empty State ── */
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#6B7280",
  },
  emptySub: {
    fontSize: 13,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 20,
  },

  /* ── Modal ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1F2937",
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 14,
  },
  required: { color: "#EF4444" },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#1F2937",
    backgroundColor: "#F9FAFB",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 26,
  },
  cancelBtn: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4B5563",
  },
  addBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  addBtnDisabled: {
    backgroundColor: "#FED7AA",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* ── Student Profile Modal ── */
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  profileModalCard: {
    width: "100%",
    maxWidth: 390,
    maxHeight: "85%",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  profileHeader: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  profileAvatarImg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    marginRight: 14,
  },
  profileAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    marginRight: 14,
  },
  profileAvatarFallbackText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  profileName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  profileEmail: {
    fontSize: 12.5,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
  },
  profileCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  profileBody: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  profileStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  statBoxLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  statBoxValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 4,
  },
  statusPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 5,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "800",
  },
  atRiskCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  atRiskTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#991B1B",
  },
  atRiskSub: {
    fontSize: 11.5,
    color: "#DC2626",
    marginTop: 2,
    fontWeight: "500",
  },
  quizSheetSection: {
    marginBottom: 14,
  },
  quizSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  quizSheetTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.6,
  },
  quizScoreCard: {
    borderWidth: 1.5,
    borderColor: "#0F172A",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  quizScoreName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
  },
  quizScoreSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  quizScoreNumRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  quizScoreNum: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#0F172A",
  },
  quizScoreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  quizScorePercent: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "right",
    marginTop: 2,
  },
  pedagogicalCard: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  pedagogicalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  pedagogicalTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#9A3412",
    letterSpacing: 0.5,
  },
  pedagogicalText: {
    fontSize: 11.5,
    color: "#475569",
    lineHeight: 17,
    fontWeight: "500",
  },
  profileFooter: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  emailBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emailBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  closeProfileBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  closeProfileBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#334155",
  },
  topBarBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: ORANGE,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  topBarBadgeText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "800",
  },
  alertsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertsCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#0F172A",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 8,
    maxHeight: 480,
  },
  alertsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  alertsHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  alertsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  alertsClearBtn: {
    fontSize: 12.5,
    fontWeight: "700",
    color: ORANGE,
  },
  alertsEmptyState: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  alertsEmptyTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  alertsEmptySub: {
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  alertsList: {
    maxHeight: 390,
  },
  alertCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#0F172A",
    padding: 12,
    marginBottom: 10,
  },
  alertCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  alertCardTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  alertCardTagText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
    letterSpacing: 0.3,
  },
  alertCardTime: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
  },
  alertCardMessage: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#1E293B",
    lineHeight: 18,
  },
  alertCardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  alertCardActionText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: ORANGE,
    flex: 1,
  },
  readBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  readBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#10B981",
  },
  newBadge: {
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#EF4444",
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topBarActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteStudentRowBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  removeStudentProfileBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  removeStudentProfileBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  confirmModalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
    alignItems: "center",
  },
  dangerIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
  },
  confirmModalDesc: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 24,
  },
  confirmModalActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: "#EF4444",
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  confirmDeleteBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
