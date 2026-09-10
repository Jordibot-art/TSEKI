import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";
import { useTheme } from "../context/ThemeContext";
import {
  clearAllAlerts,
  deleteClassroomAlerts,
  getClearedAlertIds,
  getPersistedAlerts,
  getReadAlertIds,
  markAlertsAsRead,
  RosterAlert,
} from "../lib/alertStore";
import {
  deleteClassroomQuizzes,
  getPublishedQuizzes,
  getQuizPerformanceRecords,
} from "../lib/quizStore";
import { supabase } from "../supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
type ClassCard = {
  id: string;
  title: string;
  subject: string;
  section: string;
  room: string;
  schedule: string;
  color: string;
  students: number;
  quizzes: number;
  flagged: number;
};

const CARD_COLORS = ["#FF6B00", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"];

// ── Orange & White Theme Palette ────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";

/** Capitalizes the first letter of each word/token (after spaces, hyphens, slashes, or parentheses) */
function capitalizeWords(text: string): string {
  if (!text) return "";
  return text.replace(/(?:^|[\s\-_/()])[a-z]/g, (match) => match.toUpperCase());
}

/** Formats the greeting with the teacher's username/name */
function getTeacherGreeting(name: string): string {
  if (!name || !name.trim()) {
    return "Hi Teacher! I'm Tseki 👋";
  }
  const clean = name.trim();
  if (/^teacher\b/i.test(clean)) {
    return `Hi ${clean}! I'm Tseki 👋`;
  }
  return `Hi Teacher ${clean}! I'm Tseki 👋`;
}

export default function HomePage() {
  const router = useRouter();
  const { darkMode, themeColor } = useTheme();

  // ── Dynamic colors ──────────────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#FFFFFF";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#181920";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#F3F4F6";


  const [cards, setCards] = useState<ClassCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [alerts, setAlerts] = useState<RosterAlert[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Delete Classroom Confirmation State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [classToDelete, setClassToDelete] = useState<ClassCard | null>(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // form fields
  const [classTitle, setClassTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [room, setRoom] = useState("");
  const [schedule, setSchedule] = useState("");
  const [userName, setUserName] = useState("");

  // ── Load classrooms from Supabase ─────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadClassrooms();
    }, [])
  );

  async function loadClassrooms() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const teacherName =
      user.user_metadata?.full_name ||
      user.user_metadata?.username ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "";
    setUserName(teacherName);

    const { data: classrooms, error } = await supabase
      .from("classrooms")
      .select("*")
      .eq("teacher_id", user.id)
      .order("created_at", { ascending: true });

    if (!error && classrooms) {
      const classroomIds = classrooms.map((row: any) => row.id);
      const studentCounts: Record<string, number> = {};
      const flaggedCounts: Record<string, number> = {};
      const quizCounts: Record<string, number> = {};
      const activeAlerts: RosterAlert[] = [];

      if (classroomIds.length > 0) {
        // 1. Fetch real students and their averages from Supabase
        const { data: studentsData } = await supabase
          .from("students")
          .select("id, classroom_id, full_name, average")
          .in("classroom_id", classroomIds);

        const [clearedIds, readIds, persisted] = await Promise.all([
          getClearedAlertIds(),
          getReadAlertIds(),
          getPersistedAlerts(),
        ]);

        if (studentsData) {
          for (const s of studentsData) {
            studentCounts[s.classroom_id] = (studentCounts[s.classroom_id] || 0) + 1;
            // Student is flagged by the system if they have taken a quiz and have average > 0 and <= 50
            if (s.average !== null && s.average !== undefined && s.average > 0 && s.average <= 50) {
              flaggedCounts[s.classroom_id] = (flaggedCounts[s.classroom_id] || 0) + 1;

              const cIdx = classrooms.findIndex((c: any) => c.id === s.classroom_id);
              const c = classrooms[cIdx];
              const alertId = `flag_${s.id}`;

              let cSection = c?.section || "";
              let cSchedule = "";
              if (cSection.includes(" || ")) {
                const parts = cSection.split(" || ");
                cSection = parts[0] || "";
                cSchedule = parts[1] || "";
              }

              if (!clearedIds.includes(alertId) && !clearedIds.includes(s.id)) {
                activeAlerts.push({
                  id: alertId,
                  studentId: s.id,
                  studentName: s.full_name || "Student",
                  classroomId: s.classroom_id,
                  classroomTitle: c ? c.title : "Classroom",
                  classroomSchedule: cSchedule || (c ? (c.subject || "No Subject") : ""),
                  classroomRoom: c ? (c.room ? `Room ${c.room}` : cSection || "No Room") : "",
                  classroomColor: CARD_COLORS[cIdx >= 0 ? cIdx % CARD_COLORS.length : 0],
                  scorePercentage: s.average,
                  alertType: s.average <= 40 ? "HIGH RISK" : "URGENT REVIEW",
                  message: `${s.full_name || "Student"} has dropped to an average of ${s.average}%. Performance Flagged: At-Risk.`,
                  createdAt: new Date().toISOString(),
                  timeLabel: "Today",
                  isRead: readIds.includes(alertId) || readIds.includes(s.id),
                });
              }
            }
          }
        }

        // Incorporate any persisted alerts from GraderTab (strictly for the teacher's active classrooms)
        for (const p of persisted) {
          if (
            classroomIds.includes(p.classroomId) &&
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
              flaggedCounts[p.classroomId] = (flaggedCounts[p.classroomId] || 0) + 1;
            } else {
              activeAlerts[existingIdx] = {
                ...p,
                isRead,
              };
            }
          }
        }

        setAlerts(activeAlerts);

        // 2. Fetch real quizzes created and graded for each classroom
        await Promise.all(
          classroomIds.map(async (cId: string) => {
            try {
              const [published, perf] = await Promise.all([
                getPublishedQuizzes(cId),
                getQuizPerformanceRecords(cId),
              ]);
              const uniqueTitles = new Set([
                ...published.map((q) => q.quizTitle.trim().toLowerCase()),
                ...perf.map((p) => p.quizTitle.trim().toLowerCase()),
              ]);
              quizCounts[cId] = uniqueTitles.size;
            } catch (err) {
              console.error("Failed to load quizzes for classroom:", cId, err);
              quizCounts[cId] = 0;
            }
          })
        );
      }

      setCards(
        classrooms.map((row: any, i: number) => {
          const realStudentCount = studentCounts[row.id];
          const realFlaggedCount = flaggedCounts[row.id];
          const realQuizCount = quizCounts[row.id];

          const displayStudents = realStudentCount !== undefined ? realStudentCount : (row.student_count ?? 0);
          const displayFlagged = realFlaggedCount !== undefined ? realFlaggedCount : (row.flagged_count ?? 0);
          const displayQuizzes = realQuizCount !== undefined ? realQuizCount : (row.quiz_count ?? 0);

          let parsedSection = (row.section || "").toUpperCase();
          let parsedSchedule = "";
          if (parsedSection.includes(" || ")) {
            const parts = parsedSection.split(" || ");
            parsedSection = (parts[0] || "").toUpperCase();
            parsedSchedule = (parts[1] || "").toUpperCase();
          }

          return {
            id: row.id,
            title: (row.title || "").toUpperCase(),
            subject: (row.subject || "").toUpperCase(),
            section: parsedSection,
            room: (row.room || "").toUpperCase(),
            schedule: parsedSchedule,
            color: CARD_COLORS[i % CARD_COLORS.length],
            students: displayStudents,
            quizzes: displayQuizzes,
            flagged: displayFlagged,
          };
        })
      );
    }
    setLoading(false);
  }

  const unreadAlertsCount = alerts.filter((a) => !a.isRead).length;

  // ── Notification Alerts Handlers ─────────────────────────────────────────
  function handleOpenNotif() {
    setNotifOpen(true);
  }

  async function handleAlertPress(alert: RosterAlert) {
    // Automatically mark this alert as READ
    await markAlertsAsRead([alert.id, alert.studentId, `flag_${alert.studentId}`]);
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alert.id || a.studentId === alert.studentId ? { ...a, isRead: true } : a
      )
    );
    setNotifOpen(false);
    router.push({
      pathname: "/classroom",
      params: {
        id: alert.classroomId,
        title: alert.classroomTitle,
        schedule: alert.classroomSchedule,
        subject: alert.classroomSchedule !== "No Subject" ? alert.classroomSchedule : "",
        room: alert.classroomRoom,
        color: alert.classroomColor,
        initialTab: "Tracker",
        openStudentId: alert.studentId,
        openStudentName: alert.studentName,
      },
    });
  }

  async function handleClearAllAlerts() {
    await clearAllAlerts(alerts);
    setAlerts([]);
  }

  // ── Delete Classroom Handlers ───────────────────────────────────────────
  function promptDeleteClass(card: ClassCard) {
    setClassToDelete(card);
    setConfirmModalVisible(true);
  }

  async function handleConfirmDeleteClass() {
    if (!classToDelete || isDeletingClass) return;
    setIsDeletingClass(true);

    try {
      const classId = classToDelete.id;
      // 1. Delete all students enrolled in this classroom first to respect foreign keys
      await supabase.from("students").delete().eq("classroom_id", classId);

      // 2. Delete the classroom itself
      const { error } = await supabase.from("classrooms").delete().eq("id", classId);
      if (error) {
        throw error;
      }

      // 3. Purge related alerts and quiz records
      await Promise.all([
        deleteClassroomAlerts(classId),
        deleteClassroomQuizzes(classId),
      ]);

      // 4. Update UI state
      setCards((prev) => prev.filter((c) => c.id !== classId));
      setAlerts((prev) => prev.filter((a) => a.classroomId !== classId));
      setConfirmModalVisible(false);
      setClassToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete classroom:", err);
      Alert.alert("Error Deleting Classroom", err.message || "Failed to delete classroom from database.");
    } finally {
      setIsDeletingClass(false);
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleLogout() {
    await AsyncStorage.removeItem("tseki_remember_me");
    await supabase.auth.signOut();
    router.replace("/");
  }

  function openModal() {
    setClassTitle("");
    setSubject("");
    setSection("");
    setRoom("");
    setSchedule("");
    setModalVisible(true);
  }

  function handleCancel() {
    Keyboard.dismiss();
    setModalVisible(false);
  }

  async function handleBuildClass() {
    if (!classTitle.trim() || saving) return;

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const finalTitle = classTitle.trim().toUpperCase();
    const finalSubject = subject.trim() ? subject.trim().toUpperCase() : "";
    const finalSection = section.trim() ? section.trim().toUpperCase() : "";
    const finalRoom = room.trim() ? room.trim().toUpperCase() : "";
    const finalSchedule = schedule.trim() ? schedule.trim().toUpperCase() : "";

    let encodedSection = finalSection;
    if (finalSchedule) {
      encodedSection = encodedSection ? `${encodedSection} || ${finalSchedule}` : `|| ${finalSchedule}`;
    }

    const { data, error } = await supabase
      .from("classrooms")
      .insert({
        teacher_id: user.id,
        title: finalTitle,
        subject: finalSubject || null,
        section: encodedSection || null,
        room: finalRoom || null,
      })
      .select()
      .single();

    if (!error && data) {
      const newCard: ClassCard = {
        id: data.id,
        title: data.title,
        subject: data.subject || "",
        section: finalSection,
        room: data.room || "",
        schedule: finalSchedule,
        color: CARD_COLORS[cards.length % CARD_COLORS.length],
        students: 0,
        quizzes: 0,
        flagged: 0,
      };
      setCards((prev) => [...prev, newCard]);
    }

    Keyboard.dismiss();
    setSaving(false);
    setModalVisible(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Top App Bar ── */}
      <View style={[styles.appBar, { backgroundColor: cardBg, borderBottomColor: border }]}>
        <View style={styles.topBrandRow}>
          <View style={styles.brandMarkCircle}>
            <View style={styles.brandMarkInnerDot} />
          </View>
          <Text style={styles.brandMarkText}>TSEKI</Text>
        </View>
        <TouchableOpacity
          style={styles.notifBtn}
          onPress={handleOpenNotif}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={21} color={ORANGE} />
          {unreadAlertsCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>
                {unreadAlertsCount > 9 ? "9+" : unreadAlertsCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section Header ── */}
        <View style={styles.sectionHeader}>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.sectionTitle, { color: textMain }]}>Your Classrooms</Text>
            <Text style={[styles.sectionSubtitle, { color: textSub }]}>
              Select a course to manage quizzes &amp; scorecards
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
            onPress={openModal}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.addBtnText}>New Class</Text>
          </Pressable>
        </View>

        {/* ── Loading indicator ── */}
        {loading && (
          <ActivityIndicator
            size="large"
            color={themeColor}
            style={{ marginVertical: 32 }}
          />
        )}

        {/* ── Class Cards (dynamic) ── */}
        {!loading && cards.map((card) => (
          <Pressable
            key={card.id}
            style={[styles.classCard, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() =>
              router.push({
                pathname: "/classroom",
                params: {
                  id: card.id,
                  title: card.title,
                  subject: card.subject,
                  section: card.section,
                  room: card.room,
                  schedule: card.schedule,
                  color: card.color,
                },
              })
            }
          >
            <View style={[styles.cardTop, { backgroundColor: card.color }]}>
              <View style={styles.cardHeaderRow}>
                {card.subject ? (
                  <View style={styles.cardSubjectBadge}>
                    <Text style={styles.cardSubjectText} numberOfLines={1}>
                      {card.subject.toUpperCase()}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.cardSubjectBadge}>
                    <Text style={styles.cardSubjectText}>GENERAL</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.cardDeleteBtn}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    promptDeleteClass(card);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                  accessibilityLabel="Delete classroom"
                >
                  <Ionicons name="trash-outline" size={15} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <Text style={styles.cardTitle} numberOfLines={1}>{card.title.toUpperCase()}</Text>

              {/* Section & Room */}
              {(card.section || card.room) ? (
                <View style={styles.cardMetaRow}>
                  {card.section ? (
                    <View style={styles.cardMetaItem}>
                      <Ionicons name="people-outline" size={13} color="rgba(255,255,255,0.9)" />
                      <Text style={styles.cardMetaText}>{card.section.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  {(card.section && card.room) ? (
                    <Text style={styles.cardMetaDot}>•</Text>
                  ) : null}
                  {card.room ? (
                    <View style={styles.cardMetaItem}>
                      <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.9)" />
                      <Text style={styles.cardMetaText}>
                        {card.room.toUpperCase().startsWith("ROOM") ? card.room.toUpperCase() : `ROOM ${card.room.toUpperCase()}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Schedule */}
              {card.schedule ? (
                <View style={styles.cardScheduleRow}>
                  <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.95)" />
                  <Text style={styles.cardScheduleText}>{card.schedule.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.cardBottom, { backgroundColor: cardBg }]}>
              <View style={styles.statItem}>
                <Ionicons name="people-outline" size={16} color={textSub} />
                <Text style={[styles.statText, { color: textSub }]}>
                  {card.students} {card.students === 1 ? "student" : "students"}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="book-outline" size={16} color={textSub} />
                <Text style={[styles.statText, { color: textSub }]}>
                  {card.quizzes} {card.quizzes === 1 ? "Quiz" : "Quizzes"}
                </Text>
              </View>
              {card.flagged > 0 ? (
                <View style={styles.flaggedBadge}>
                  <Ionicons name="warning-outline" size={14} color="#EF4444" />
                  <Text style={styles.flaggedText}>{card.flagged} FLAGGED</Text>
                </View>
              ) : (
                <View style={styles.allClearBadge}>
                  <Ionicons name="shield-checkmark-outline" size={14} color="#10B981" />
                  <Text style={styles.allClearBadgeText}>0 FLAGGED</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}

        {/* ── Info Banner ── */}
        <View style={styles.infoBanner}>
          <View style={styles.bannerMascotWrap}>
            <AnimatedTsekiLogo size={64} />
          </View>
          <View style={styles.bannerTextContent}>
            <Text style={styles.bannerTitle}>{getTeacherGreeting(userName)}</Text>
            <Text style={styles.bannerBody}>
              I'm here to automate grading and flag struggling students! Open a class, tap the camera tab to grade sheets instantly, or use the AI Generator to build standard-based quizzes.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Bottom Navigation ── */}
      <View style={[styles.bottomNav, { backgroundColor: cardBg, borderTopColor: border }]}>
        <Pressable style={[styles.navItem, styles.navItemActive]}>
          <Ionicons name="school" size={22} color={ORANGE} />
          <Text style={styles.navTextActive}>My Classes</Text>
        </Pressable>
        {/* Settings nav */}
        <Pressable style={styles.navItem} onPress={() => router.push("/settings" as any)}>
          <Ionicons name="settings-outline" size={22} color={textSub} />
          <Text style={[styles.navText, { color: textSub }]}>Settings</Text>
        </Pressable>
      </View>

      {/* ── Build Classroom Modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCancel}
      >
        <View style={[styles.modalFullScreen, { backgroundColor: cardBg }]}>
          {/* Header */}
          <View
            style={[
              styles.modalFullScreenHeader,
              { borderBottomColor: border, backgroundColor: cardBg },
            ]}
          >
            <View style={styles.modalHeaderInfo}>
              <View style={styles.modalHeaderTag}>
                <Ionicons name="add-circle" size={16} color={ORANGE} />
                <Text style={styles.modalHeaderTagText}>NEW CLASSROOM</Text>
              </View>
              <Text style={[styles.modalTitle, { color: textMain }]}>Build Classroom</Text>
              <Text style={[styles.modalSubtitle, { color: textSub }]}>
                Set up course information &amp; schedule
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleCancel}
              style={[
                styles.modalCloseBtn,
                { backgroundColor: darkMode ? "#374151" : "#F3F4F6" },
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close modal"
            >
              <Ionicons name="close" size={22} color={textMain} />
            </TouchableOpacity>
          </View>

          {/* Form with KeyboardAvoidingView + ScrollView */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
              bounces={false}
            >
              {/* CLASS TITLE */}
              <Text style={[styles.fieldLabel, { color: textMain }]}>
                CLASS TITLE <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#374151" : "#FAFAFA",
                    borderColor: border,
                    color: textMain,
                  },
                ]}
                placeholder="e.g. Grade 10 - Mathematics"
                placeholderTextColor={textSub}
                value={classTitle}
                autoCapitalize="words"
                onChangeText={setClassTitle}
              />

              {/* SUBJECT */}
              <Text style={[styles.fieldLabel, { color: textMain }]}>
                SUBJECT <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#374151" : "#FAFAFA",
                    borderColor: border,
                    color: textMain,
                  },
                ]}
                placeholder="e.g. Mathematics"
                placeholderTextColor={textSub}
                value={subject}
                autoCapitalize="words"
                onChangeText={setSubject}
              />

              {/* SECTION + ROOM (side by side) */}
              <View style={styles.rowFields}>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: textMain }]}>SECTION</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: darkMode ? "#374151" : "#FAFAFA",
                        borderColor: border,
                        color: textMain,
                      },
                    ]}
                    placeholder="e.g. Section 5"
                    placeholderTextColor={textSub}
                    value={section}
                    autoCapitalize="words"
                    onChangeText={setSection}
                  />
                </View>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: textMain }]}>ROOM</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: darkMode ? "#374151" : "#FAFAFA",
                        borderColor: border,
                        color: textMain,
                      },
                    ]}
                    placeholder="e.g. CL1"
                    placeholderTextColor={textSub}
                    value={room}
                    autoCapitalize="characters"
                    onChangeText={setRoom}
                  />
                </View>
              </View>

              {/* SCHEDULE */}
              <Text style={[styles.fieldLabel, { color: textMain }]}>SCHEDULE</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#374151" : "#FAFAFA",
                    borderColor: border,
                    color: textMain,
                  },
                ]}
                placeholder="e.g. MWF 9:00 - 10:30 AM"
                placeholderTextColor={textSub}
                value={schedule}
                autoCapitalize="characters"
                onChangeText={setSchedule}
              />

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    { borderColor: border, backgroundColor: cardBg },
                  ]}
                  onPress={handleCancel}
                >
                  <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.buildBtn,
                    (!classTitle.trim() || saving) && styles.buildBtnDisabled,
                  ]}
                  onPress={handleBuildClass}
                  disabled={!classTitle.trim() || saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="add-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.buildBtnText}>Build Class</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Active Roster Alerts Modal (Image 2) ── */}
      <Modal
        visible={notifOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifOpen(false)}
      >
        <View style={styles.alertsModalOverlay}>
          <TouchableWithoutFeedback onPress={() => setNotifOpen(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View style={[styles.alertsCard, { backgroundColor: cardBg, borderColor: darkMode ? "#4B5563" : "#0F172A" }]}>
            {/* Header */}
            <View style={styles.alertsHeader}>
              <View style={styles.alertsHeaderLeft}>
                <Ionicons name="notifications" size={18} color="#F97316" />
                <Text style={[styles.alertsTitle, { color: textMain }]}>Active Roster Alerts</Text>
              </View>
              {alerts.length > 0 && (
                <TouchableOpacity onPress={handleClearAllAlerts} activeOpacity={0.7}>
                  <Text style={styles.alertsClearBtn}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Content */}
            {alerts.length === 0 ? (
              <View style={styles.alertsEmptyState}>
                <Ionicons name="shield-checkmark-outline" size={32} color="#10B981" />
                <Text style={[styles.alertsEmptyTitle, { color: textMain }]}>All Clear</Text>
                <Text style={[styles.alertsEmptySub, { color: textSub }]}>
                  No students currently flagged as at-risk across your classrooms.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.alertsList} showsVerticalScrollIndicator={false}>
                {alerts.map((alert) => (
                  <TouchableOpacity
                    key={alert.id}
                    style={[
                      styles.alertCard,
                      {
                        backgroundColor: darkMode ? "#374151" : "#FFFFFF",
                        borderColor: alert.isRead ? (darkMode ? "#4B5563" : "#E5E7EB") : "#F97316",
                      },
                    ]}
                    onPress={() => handleAlertPress(alert)}
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
                        {alert.classroomTitle} • Tap to view Tracker & profile
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

      {/* ── Delete Classroom Confirmation Modal ── */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isDeletingClass && setConfirmModalVisible(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingClass && setConfirmModalVisible(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View style={[styles.confirmModalCard, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.dangerIconWrap}>
              <Ionicons name="trash" size={30} color="#EF4444" />
            </View>

            <Text style={[styles.confirmModalTitle, { color: textMain }]}>Delete Classroom?</Text>
            <Text style={[styles.confirmModalDesc, { color: textSub }]}>
              Are you sure you want to permanently delete{" "}
              <Text style={{ fontWeight: "700", color: textMain }}>"{classToDelete?.title}"</Text>?
              {"\n\n"}This will permanently remove all enrolled students, quizzes, answer keys, and grade records.
            </Text>

            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={[styles.confirmCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}
                onPress={() => setConfirmModalVisible(false)}
                disabled={isDeletingClass}
                activeOpacity={0.7}
              >
                <Text style={[styles.confirmCancelBtnText, { color: textMain }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmDeleteBtn, isDeletingClass && styles.btnDisabled]}
                onPress={handleConfirmDeleteClass}
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },

  /* ── Top App Bar ── */
  appBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 54 : 44,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  topBrandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandMarkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.2,
    borderColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandMarkInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ORANGE,
  },
  brandMarkText: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2.5,
    color: "#181920",
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ORANGE_LIGHT,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: ORANGE,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  notifBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },

  /* ── Scroll Area ── */
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  /* ── Section Header ── */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#181920",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#6B7280",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 14,
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  /* ── Class Cards ── */
  classCard: {
    borderRadius: 18,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  cardTop: {
    padding: 16,
    paddingBottom: 18,
  },
  cardSubjectBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  cardSubjectText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginTop: 8,
    marginBottom: 2,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  cardMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardMetaText: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 12,
    fontWeight: "600",
  },
  cardMetaDot: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
    fontWeight: "700",
  },
  cardScheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  cardScheduleText: {
    color: "rgba(255, 255, 255, 0.95)",
    fontSize: 11.5,
    fontWeight: "600",
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  cardStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "600",
  },
  flaggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  flaggedText: {
    fontSize: 10,
    color: "#EF4444",
    fontWeight: "800",
  },
  allClearBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  allClearBadgeText: {
    fontSize: 10,
    color: "#10B981",
    fontWeight: "800",
  },

  /* ── Info Banner ── */
  infoBanner: {
    flexDirection: "row",
    backgroundColor: ORANGE_LIGHT,
    borderRadius: 20,
    padding: 16,
    marginTop: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#FFEDD5",
  },
  bannerMascotWrap: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  bannerTextContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#181920",
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 18,
  },

  /* ── Bottom Navigation ── */
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    paddingHorizontal: 20,
    gap: 16,
  },
  navItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 14,
  },
  navItemActive: {
    backgroundColor: ORANGE_LIGHT,
  },
  navText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },
  navTextActive: {
    fontSize: 13,
    fontWeight: "800",
    color: ORANGE,
  },

  /* ── Modal ── */
  modalFullScreen: {
    flex: 1,
  },
  modalFullScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 54 : 44,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  modalHeaderInfo: {
    flex: 1,
  },
  modalHeaderTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  modalHeaderTagText: {
    fontSize: 11,
    fontWeight: "800",
    color: ORANGE,
    letterSpacing: 0.8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  modalSubtitle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  required: {
    color: ORANGE,
  },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  rowFields: {
    flexDirection: "row",
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 28,
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  buildBtn: {
    flex: 1.4,
    height: 52,
    borderRadius: 14,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  buildBtnDisabled: {
    backgroundColor: "#FED7AA",
    shadowOpacity: 0,
    elevation: 0,
  },
  buildBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  /* ── Active Roster Alerts Popup (Image 2) ── */
  alertsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    paddingTop: 80,
    paddingHorizontal: 16,
  },
  alertsCard: {
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
    color: "#2563EB",
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
    color: "#2563EB",
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
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  cardDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0, 0, 0, 0.22)",
    alignItems: "center",
    justifyContent: "center",
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
