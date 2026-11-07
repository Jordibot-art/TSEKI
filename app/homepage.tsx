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
import { ClassroomOnboardingModal } from "../components/ClassroomOnboardingModal";

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

// Local persistence for classroom theme colors (graceful fallback if Supabase table lacks color column)
const CLASSROOM_COLORS_KEY = "tseki_classroom_colors";

async function getClassroomColors(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(CLASSROOM_COLORS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveClassroomColor(classroomId: string, color: string): Promise<void> {
  try {
    const map = await getClassroomColors();
    map[classroomId] = color;
    await AsyncStorage.setItem(CLASSROOM_COLORS_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("Failed to persist classroom color locally:", err);
  }
}

// ── Orange & White Theme Palette ────────────────────────────────
const ORANGE = "#EA580C";
const ORANGE_LIGHT = "#FFF7ED";

/** Capitalizes the first letter of each word/token (after spaces, hyphens, slashes, or parentheses) */
function capitalizeWords(text: string): string {
  if (!text) return "";
  return text.replace(/(?:^|[\s\-_/()])[a-z]/g, (match) => match.toUpperCase());
}

/** Formats the greeting with the teacher's username/name */
function getTeacherGreeting(name: string): string {
  if (!name || !name.trim()) {
    return "Hi Teacher! 👋";
  }
  const clean = name.trim();
  if (/^teacher\b/i.test(clean)) {
    return `Hi ${clean}! 👋`;
  }
  return `Hi Teacher ${clean}! 👋`;
}

export default function HomePage() {
  const router = useRouter();
  const { darkMode, themeColor } = useTheme();

  // ── Dynamic colors ──────────────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#FFFFFF";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#181920";
  const textSub = darkMode ? "#9CA3AF" : "#64748B";
  const border = darkMode ? "#374151" : "#E5E7EB";


  const [cards, setCards] = useState<ClassCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [alerts, setAlerts] = useState<RosterAlert[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Delete Classroom Confirmation State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [classToDelete, setClassToDelete] = useState<ClassCard | null>(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // Classroom Onboarding Alert Modal State
  const [onboardingClassroom, setOnboardingClassroom] = useState<ClassCard | null>(null);
  const [onboardingVisible, setOnboardingVisible] = useState(false);

  // form fields
  const [classTitle, setClassTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [room, setRoom] = useState("");
  const [schedule, setSchedule] = useState("");
  const [selectedColor, setSelectedColor] = useState(CARD_COLORS[0]);
  const [userName, setUserName] = useState("");

  // ── Load classrooms from Supabase ─────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadClassrooms();
    }, [])
  );

  async function loadClassrooms() {
    try {
      let user = (await supabase.auth.getUser()).data?.user;
      if (!user) {
        user = (await supabase.auth.getSession()).data?.session?.user ?? null;
      }
      if (!user) {
        setLoading(false);
        return;
      }

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

      if (error) {
        console.error("Failed to load classrooms from database:", error);
      }

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
                  classroomColor: c?.color || CARD_COLORS[cIdx >= 0 ? cIdx % CARD_COLORS.length : 0],
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

      const localColors = await getClassroomColors();

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

          const cardColor = row.color || localColors[row.id] || CARD_COLORS[i % CARD_COLORS.length];

          return {
            id: row.id,
            title: (row.title || "").toUpperCase(),
            subject: (row.subject || "").toUpperCase(),
            section: parsedSection,
            room: (row.room || "").toUpperCase(),
            schedule: parsedSchedule,
            color: cardColor,
            students: displayStudents,
            quizzes: displayQuizzes,
            flagged: displayFlagged,
          };
        })
      );
    }
  } catch (err) {
    console.error("Unexpected error in loadClassrooms:", err);
  } finally {
    setLoading(false);
  }
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
    setSelectedColor(CARD_COLORS[0]);
    setModalVisible(true);
  }

  function handleCancel() {
    Keyboard.dismiss();
    setModalVisible(false);
  }

  async function handleBuildClass() {
    if (!classTitle.trim() || saving) return;

    setSaving(true);
    try {
      // 1. Resolve authenticated teacher (with getSession fallback for AsyncStorage cached session)
      let user = (await supabase.auth.getUser()).data?.user;
      if (!user) {
        user = (await supabase.auth.getSession()).data?.session?.user ?? null;
      }

      if (!user) {
        Alert.alert(
          "Session Expired",
          "You must be signed in to create a class. Please log in again."
        );
        setSaving(false);
        return;
      }

      const finalTitle = classTitle.trim().toUpperCase();
      const finalSubject = subject.trim() ? subject.trim().toUpperCase() : "";
      const finalSection = section.trim() ? section.trim().toUpperCase() : "";
      const finalRoom = room.trim() ? room.trim().toUpperCase() : "";
      const finalSchedule = schedule.trim() ? schedule.trim().toUpperCase() : "";

      let encodedSection = finalSection;
      if (finalSchedule) {
        encodedSection = encodedSection ? `${encodedSection} || ${finalSchedule}` : `|| ${finalSchedule}`;
      }

      // 2. Insert into Supabase classrooms table
      const insertPayload: any = {
        teacher_id: user.id,
        title: finalTitle,
        subject: finalSubject || null,
        section: encodedSection || null,
        room: finalRoom || null,
        color: selectedColor,
      };

      let { data, error } = await supabase
        .from("classrooms")
        .insert(insertPayload)
        .select();

      // If 'color' column does not exist yet in Supabase schema cache, retry without 'color'
      if (
        error &&
        (error.message?.includes("color") ||
          error.code === "PGRST204" ||
          error.message?.includes("schema cache"))
      ) {
        delete insertPayload.color;
        const retryResult = await supabase
          .from("classrooms")
          .insert(insertPayload)
          .select();
        data = retryResult.data;
        error = retryResult.error;
      }

      if (error) {
        console.error("Failed to build class in Supabase:", error);
        Alert.alert(
          "Could Not Build Class",
          error.message || "Failed to save classroom to database."
        );
        setSaving(false);
        return;
      }

      const created = data && data.length > 0 ? data[0] : null;
      if (created) {
        await saveClassroomColor(created.id, selectedColor);

        const newCard: ClassCard = {
          id: created.id,
          title: created.title,
          subject: created.subject || "",
          section: finalSection,
          room: created.room || "",
          schedule: finalSchedule,
          color: selectedColor,
          students: 0,
          quizzes: 0,
          flagged: 0,
        };
        setCards((prev) => [...prev, newCard]);
        setOnboardingClassroom(newCard);
      }

      // 3. Re-sync with database to ensure counts and references are accurate
      await loadClassrooms();

      // 4. Reset form fields and close modal
      setClassTitle("");
      setSubject("");
      setSection("");
      setRoom("");
      setSchedule("");
      setSelectedColor(CARD_COLORS[0]);

      Keyboard.dismiss();
      setModalVisible(false);

      // 5. Open onboarding modal immediately for newly created classroom
      if (created) {
        setOnboardingVisible(true);
      }
    } catch (err: any) {
      console.error("Unexpected error in handleBuildClass:", err);
      Alert.alert(
        "Build Class Error",
        err.message || "An unexpected error occurred while building the class."
      );
    } finally {
      setSaving(false);
    }
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
            <Ionicons name="add" size={18} color="#FFFFFF" />
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
        {!loading && cards.map((card) => {
          const eyebrowParts: string[] = [];
          if (card.subject && card.subject.toUpperCase() !== card.title.toUpperCase()) {
            eyebrowParts.push(card.subject.toUpperCase());
          }
          if (card.section) {
            eyebrowParts.push(
              /^\d+$/.test(card.section.trim())
                ? `SECTION ${card.section.trim()}`
                : card.section.toUpperCase()
            );
          }
          const eyebrowLabel = eyebrowParts.length > 0 ? eyebrowParts.join(" · ") : (card.subject ? card.subject.toUpperCase() : "COURSE");

          const metaParts: string[] = [];
          if (card.room) {
            metaParts.push(
              card.room.toUpperCase().startsWith("ROOM")
                ? card.room.toUpperCase()
                : `ROOM ${card.room.toUpperCase()}`
            );
          }
          if (card.schedule) {
            metaParts.push(card.schedule.toUpperCase());
          }
          const metaLine = metaParts.join(" · ");

          return (
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
                  <Text style={styles.cardEyebrowText} numberOfLines={1}>
                    {eyebrowLabel}
                  </Text>
                  <TouchableOpacity
                    style={styles.cardMoreBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      Alert.alert(
                        card.title,
                        "Classroom options",
                        [
                          {
                            text: "Open Classroom",
                            onPress: () =>
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
                              }),
                          },
                          {
                            text: "Delete Classroom",
                            style: "destructive",
                            onPress: () => promptDeleteClass(card),
                          },
                          { text: "Cancel", style: "cancel" },
                        ]
                      );
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.7}
                    accessibilityLabel="Classroom options"
                  >
                    <Ionicons name="ellipsis-horizontal" size={16} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardTitle} numberOfLines={1}>{card.title.toUpperCase()}</Text>

                {metaLine ? (
                  <Text style={styles.cardMetaLineText} numberOfLines={1}>
                    {metaLine}
                  </Text>
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
                    <Ionicons name="warning-outline" size={13} color="#DC2626" />
                    <Text style={styles.flaggedText}>{card.flagged} FLAGGED</Text>
                  </View>
                ) : (
                  <View style={styles.allClearBadge}>
                    <Ionicons name="checkmark-circle-outline" size={13} color="#059669" />
                    <Text style={styles.allClearBadgeText}>ALL CLEAR</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}

        {/* ── Empty State ── */}
        {!loading && cards.length === 0 && (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: ORANGE + "18", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Ionicons name="school-outline" size={32} color={ORANGE} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: "700", color: textMain, marginBottom: 6 }}>No Classrooms Yet</Text>
            <Text style={{ fontSize: 13, color: textSub, textAlign: "center", lineHeight: 18, marginBottom: 20 }}>
              Tap &quot;New Class&quot; above or the button below to build your first course and start grading!
            </Text>
            <TouchableOpacity
              style={[styles.buildBtn, { backgroundColor: ORANGE, paddingHorizontal: 20, height: 44 }]}
              onPress={openModal}
            >
              <Ionicons name="add-circle" size={18} color="#FFFFFF" />
              <Text style={styles.buildBtnText}>Build Classroom</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── Fixed Bottom Info Banner ── */}
      {!bannerDismissed && (
        <View style={styles.fixedBannerContainer}>
          <View style={[styles.infoBanner, { backgroundColor: darkMode ? "#1F2937" : "#FFFBF5", borderColor: darkMode ? "#374151" : "#E5E7EB" }]}>
            <View style={styles.bannerMascotWrap}>
              <AnimatedTsekiLogo size={52} />
            </View>
            <View style={styles.bannerTextContent}>
              <View style={styles.bannerTitleRow}>
                <Text style={[styles.bannerTitle, { color: textMain }]}>{getTeacherGreeting(userName)}</Text>
                <TouchableOpacity
                  onPress={() => setBannerDismissed(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.bannerCloseBtn}
                  accessibilityLabel="Dismiss helper banner"
                >
                  <Ionicons name="close" size={16} color={textSub} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.bannerBody, { color: textSub }]}>
                Open a class to grade answer sheets with the camera or generate DepEd-aligned quizzes in seconds.
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Bottom Navigation ── */}
      <View style={[styles.bottomNav, { backgroundColor: cardBg, borderTopColor: border }]}>
        <Pressable style={styles.navItem}>
          <Ionicons name="school-outline" size={20} color={ORANGE} />
          <Text style={styles.navTextActive}>My Classes</Text>
        </Pressable>
        {/* Settings nav */}
        <Pressable style={styles.navItem} onPress={() => router.push("/settings" as any)}>
          <Ionicons name="settings-outline" size={20} color="#64748B" />
          <Text style={[styles.navText, { color: "#64748B" }]}>Settings</Text>
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
              <Ionicons name="close" size={20} color={textMain} />
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
              {/* Class title */}
              <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151", marginTop: 6 }]}>
                Class title <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#4B5563" : "#D1D5DB",
                    color: textMain,
                  },
                ]}
                placeholder="e.g. Grade 10 - Mathematics"
                placeholderTextColor={textSub}
                value={classTitle}
                autoCapitalize="words"
                onChangeText={setClassTitle}
              />

              {/* Subject */}
              <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151" }]}>
                Subject <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#4B5563" : "#D1D5DB",
                    color: textMain,
                  },
                ]}
                placeholder="e.g. Mathematics"
                placeholderTextColor={textSub}
                value={subject}
                autoCapitalize="words"
                onChangeText={setSubject}
              />

              {/* Section + Room (side by side) */}
              <View style={styles.rowFields}>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151" }]}>Section</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                        borderColor: darkMode ? "#4B5563" : "#D1D5DB",
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
                  <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151" }]}>Room</Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                        borderColor: darkMode ? "#4B5563" : "#D1D5DB",
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

              {/* Schedule */}
              <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151" }]}>Schedule</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#4B5563" : "#D1D5DB",
                    color: textMain,
                  },
                ]}
                placeholder="e.g. MWF 9:00 - 10:30 AM"
                placeholderTextColor={textSub}
                value={schedule}
                autoCapitalize="characters"
                onChangeText={setSchedule}
              />

              {/* Theme color */}
              <Text style={[styles.fieldLabel, { color: darkMode ? "#E5E7EB" : "#374151", marginBottom: 4 }]}>
                Theme color
              </Text>
              <Text style={[styles.colorSubtitle, { color: textSub }]}>
                Select an accent color for this classroom card &amp; banner
              </Text>

              <View style={styles.colorPickerContainer}>
                {CARD_COLORS.map((c) => {
                  const isSelected = selectedColor === c;
                  return (
                    <TouchableOpacity
                      key={c}
                      activeOpacity={0.8}
                      onPress={() => setSelectedColor(c)}
                      style={[
                        styles.colorRingOuter,
                        isSelected && { borderColor: c },
                      ]}
                      accessibilityLabel={`Select theme color ${c}`}
                    >
                      <View
                        style={[
                          styles.colorDot,
                          { backgroundColor: c },
                          isSelected && {
                            borderWidth: 2,
                            borderColor: darkMode ? "#1F2937" : "#FFFFFF",
                          },
                        ]}
                      >
                        {isSelected && (
                          <Ionicons name="checkmark-sharp" size={15} color="#FFFFFF" />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    { borderColor: darkMode ? "#4B5563" : "#D1D5DB", backgroundColor: cardBg },
                  ]}
                  onPress={handleCancel}
                >
                  <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.buildBtn,
                    { backgroundColor: selectedColor, shadowColor: selectedColor },
                    (!classTitle.trim() || saving) && styles.buildBtnDisabled,
                  ]}
                  onPress={handleBuildClass}
                  disabled={!classTitle.trim() || saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="add" size={18} color="#FFFFFF" />
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

          <View style={[styles.alertsCard, { backgroundColor: cardBg, borderColor: darkMode ? "#374151" : "#E5E7EB" }]}>
            {/* Header */}
            <View style={styles.alertsHeader}>
              <View style={styles.alertsHeaderLeft}>
                <Ionicons name="notifications-outline" size={18} color={ORANGE} />
                <Text style={[styles.alertsTitle, { color: textMain }]}>Active Roster Alerts</Text>
              </View>
              {alerts.length > 0 && (
                <TouchableOpacity onPress={handleClearAllAlerts} activeOpacity={0.7}>
                  <Text style={[styles.alertsClearBtn, { color: textSub }]}>Clear all</Text>
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
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#334155" : "#E5E7EB",
                      },
                    ]}
                    onPress={() => handleAlertPress(alert)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.alertCardHeader}>
                      <View style={styles.atRiskBadge}>
                        <Text style={styles.atRiskBadgeText}>At-Risk</Text>
                      </View>
                      <Text style={styles.alertCardTime}>{alert.timeLabel}</Text>
                    </View>
                    <Text style={[styles.alertCardMessage, { color: textMain }]}>
                      {alert.message}
                    </Text>
                    <View style={[styles.alertCardActionRow, { borderTopColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                      <Text style={[styles.alertCardActionText, { color: darkMode ? "#E2E8F0" : "#1E293B" }]}>
                        {alert.classroomTitle} · View student tracker
                      </Text>
                      <Ionicons name="arrow-forward" size={13} color={darkMode ? "#E2E8F0" : "#1E293B"} />
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
        statusBarTranslucent
        onRequestClose={() => !isDeletingClass && setConfirmModalVisible(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingClass && setConfirmModalVisible(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View style={[styles.confirmModalCard, { backgroundColor: cardBg, borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
            <Text style={[styles.confirmModalTitle, { color: textMain }]}>Delete Classroom?</Text>
            <Text style={[styles.confirmModalDesc, { color: textSub }]}>
              Are you sure you want to permanently delete{" "}
              <Text style={{ fontWeight: "700", color: textMain }}>&ldquo;{classToDelete?.title}&rdquo;</Text>?
              {"\n\n"}This will permanently remove all enrolled students, quizzes, answer keys, and grade records.
            </Text>

            <View style={styles.confirmModalActions}>
              <TouchableOpacity
                style={[
                  styles.confirmCancelBtn,
                  {
                    backgroundColor: cardBg,
                    borderColor: darkMode ? "#4B5563" : "#CBD5E1",
                  },
                ]}
                onPress={() => setConfirmModalVisible(false)}
                disabled={isDeletingClass}
                activeOpacity={0.7}
              >
                <Text style={[styles.confirmCancelBtnText, { color: darkMode ? "#E2E8F0" : "#334155" }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmDeleteBtn, isDeletingClass && styles.btnDisabled]}
                onPress={handleConfirmDeleteClass}
                disabled={isDeletingClass}
                activeOpacity={0.85}
              >
                {isDeletingClass ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmDeleteBtnText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Classroom Creation Onboarding Modal ── */}
      <ClassroomOnboardingModal
        visible={onboardingVisible}
        classroom={onboardingClassroom}
        onClose={() => setOnboardingVisible(false)}
        onStudentsUpdated={loadClassrooms}
        onEnterClassroom={(cls) => {
          setOnboardingVisible(false);
          router.push({
            pathname: "/classroom",
            params: {
              id: cls.id,
              title: cls.title,
              subject: cls.subject,
              section: cls.section,
              room: cls.room,
              schedule: cls.schedule,
              color: cls.color,
            },
          });
        }}
      />
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
    fontWeight: "800",
    color: "#181920",
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13.5,
    color: "#64748B",
    lineHeight: 19,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    backgroundColor: ORANGE,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },

  /* ── Class Cards ── */
  classCard: {
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardTop: {
    padding: 16,
    paddingBottom: 16,
  },
  cardEyebrowText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginTop: 4,
    marginBottom: 4,
  },
  cardMetaLineText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 12.5,
    fontWeight: "500",
    lineHeight: 18,
    marginTop: 4,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
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
    fontSize: 12.5,
    color: "#4B5563",
    fontWeight: "600",
  },
  flaggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  flaggedText: {
    fontSize: 10.5,
    color: "#DC2626",
    fontWeight: "700",
  },
  allClearBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  allClearBadgeText: {
    fontSize: 10.5,
    color: "#059669",
    fontWeight: "700",
  },

  /* ── Info Banner ── */
  fixedBannerContainer: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
  },
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "#FFFBF5",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  bannerMascotWrap: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  bannerTextContent: {
    flex: 1,
  },
  bannerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  bannerTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    color: "#181920",
    flex: 1,
    marginRight: 8,
  },
  bannerCloseBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerBody: {
    fontSize: 12.5,
    color: "#64748B",
    lineHeight: 18,
  },

  /* ── Bottom Navigation ── */
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingBottom: Platform.OS === "ios" ? 28 : 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingHorizontal: 20,
    gap: 16,
  },
  navItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  navText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  navTextActive: {
    fontSize: 13,
    fontWeight: "700",
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
    paddingTop: Platform.OS === "ios" ? 50 : 40,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  modalHeaderInfo: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
    lineHeight: 18,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 6,
    marginTop: 16,
  },
  required: {
    color: ORANGE,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14.5,
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
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  buildBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  buildBtnDisabled: {
    backgroundColor: "#FED7AA",
    shadowOpacity: 0,
    elevation: 0,
  },
  buildBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  colorSubtitle: {
    fontSize: 12.5,
    fontWeight: "400",
    lineHeight: 18,
    marginBottom: 12,
  },
  colorPickerContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 4,
    marginBottom: 4,
  },
  colorRingOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── Active Roster Alerts Popup (Image 2) ── */
  alertsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    paddingTop: 80,
    paddingHorizontal: 16,
  },
  alertsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
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
    fontWeight: "700",
    color: "#0F172A",
  },
  alertsClearBtn: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
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
    fontSize: 12.5,
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  alertsList: {
    maxHeight: 390,
  },
  alertCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderLeftWidth: 4,
    borderLeftColor: "#EF4444",
    padding: 14,
    marginBottom: 10,
  },
  alertCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  atRiskBadge: {
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  atRiskBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#DC2626",
  },
  alertCardTime: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
  },
  alertCardMessage: {
    fontSize: 13.5,
    fontWeight: "500",
    color: "#1E293B",
    lineHeight: 19,
  },
  alertCardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  alertCardActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E293B",
    flex: 1,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cardMoreBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  confirmModalCard: {
    width: "88%",
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 25,
    elevation: 12,
  },
  confirmModalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "left",
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  confirmModalDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "left",
  },
  confirmModalActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    marginTop: 18,
  },
  confirmCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: "#DC2626",
    height: 42,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  confirmDeleteBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
