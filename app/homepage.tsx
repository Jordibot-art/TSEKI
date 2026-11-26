import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  View,
} from "react-native";
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";
import { NotificationsModal } from "../components/NotificationsModal";
import {
  getSemanticTokens,
  getSkeuoPalette,
  skeuoButtonStyle,
  skeuoCardStyle,
  skeuoWellStyle,
  triggerSkeuoHaptic,
} from "../components/skeuoTheme";
import { useTheme } from "../context/ThemeContext";
import {
  AlertPreferences,
  buildReconciledAlerts,
  clearAllAlerts,
  DEFAULT_ALERT_PREFERENCES,
  deleteClassroomAlerts,
  dismissSingleAlert,
  markAlertsAsRead,
  markAllAlertsAsRead,
  ReconcileClassroomInput,
  ReconcileStudentInput,
  restoreDismissedAlerts,
  RosterAlert,
  StudentQuizSnapshot,
} from "../lib/alertStore";
import {
  deleteClassroomQuizzes,
  getPublishedQuizzes,
  getQuizPerformanceRecords,
} from "../lib/quizStore";
import { supabase } from "../supabase";
import { ClassroomOnboardingModal } from "../components/ClassroomOnboardingModal";
import { DeleteEmailVerificationModal } from "../components/DeleteEmailVerificationModal";

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

const CARD_COLORS = [
  "#C2410C", // Terracotta / Rust (Default Brand)
  "#4F46E5", // Slate Indigo
  "#047857", // Emerald Forest
  "#7C3AED", // Deep Amethyst
  "#D97706", // Warm Amber
  "#BE185D", // Rose Coral
];

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

  // ── Dynamic skeuomorphic colors ─────────────────────────────────────────────
  const skeuo = getSkeuoPalette(darkMode, themeColor || ORANGE);
  const bg = skeuo.canvas;
  const cardBg = skeuo.surface;
  const textMain = skeuo.textPrimary;
  const textSub = skeuo.textSecondary;
  const border = skeuo.border;


  const [cards, setCards] = useState<ClassCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [alerts, setAlerts] = useState<RosterAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<RosterAlert[]>([]);
  const [alertPrefs, setAlertPrefs] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifClassroomFilter, setNotifClassroomFilter] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Cached roster inputs so threshold/dismiss/restore updates reconcile instantly without a network round-trip
  const rosterCacheRef = useRef<{
    students: ReconcileStudentInput[];
    classrooms: ReconcileClassroomInput[];
    latestQuizByStudent: Record<string, StudentQuizSnapshot>;
  }>({
    students: [],
    classrooms: [],
    latestQuizByStudent: {},
  });

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
      let flaggedCounts: Record<string, number> = {};
      const quizCounts: Record<string, number> = {};
      const localColors = await getClassroomColors();

      const reconcileClassrooms: ReconcileClassroomInput[] = classrooms.map((row: any, i: number) => {
        let parsedSection = row.section || "";
        let parsedSchedule = "";
        if (parsedSection.includes(" || ")) {
          const parts = parsedSection.split(" || ");
          parsedSection = parts[0] || "";
          parsedSchedule = parts[1] || "";
        }
        return {
          id: row.id,
          title: row.title || "Classroom",
          subject: row.subject || "",
          section: parsedSection,
          room: row.room ? (String(row.room).toLowerCase().startsWith("room") ? row.room : `Room ${row.room}`) : parsedSection,
          schedule: parsedSchedule || row.subject || "",
          color: row.color || localColors[row.id] || CARD_COLORS[i % CARD_COLORS.length],
        };
      });

      if (classroomIds.length > 0) {
        // 1. Fetch real students and latest quiz results from Supabase in parallel
        const [{ data: studentsData }, recentResultsResp] = await Promise.all([
          supabase
            .from("students")
            .select("id, classroom_id, full_name, average")
            .in("classroom_id", classroomIds),
          Promise.resolve(
            supabase
              .from("student_quiz_results")
              .select("student_id, quiz_title, score_percentage, total_score, max_score, graded_at")
              .in("classroom_id", classroomIds)
              .order("graded_at", { ascending: false })
          ).catch(() => ({ data: null, error: null })),
        ]);

        const normalizedStudents: ReconcileStudentInput[] = (studentsData || []).map((s: any) => {
          studentCounts[s.classroom_id] = (studentCounts[s.classroom_id] || 0) + 1;
          return {
            id: s.id,
            classroom_id: s.classroom_id,
            full_name: s.full_name || "Student",
            average: s.average,
          };
        });

        const latestQuizByStudent: Record<string, StudentQuizSnapshot> = {};
        if (recentResultsResp?.data && Array.isArray(recentResultsResp.data)) {
          for (const r of recentResultsResp.data as any[]) {
            const sid = r.student_id;
            if (!sid) continue;
            if (!latestQuizByStudent[sid]) {
              latestQuizByStudent[sid] = {
                quizTitle: r.quiz_title || undefined,
                scorePercentage:
                  typeof r.score_percentage === "number" ? r.score_percentage : Number(r.score_percentage),
                totalScore: typeof r.total_score === "number" ? r.total_score : Number(r.total_score),
                maxScore: typeof r.max_score === "number" ? r.max_score : Number(r.max_score),
                gradedAt: r.graded_at || undefined,
                quizCount: 1,
              };
            } else {
              latestQuizByStudent[sid].quizCount = (latestQuizByStudent[sid].quizCount || 1) + 1;
            }
          }
        }

        rosterCacheRef.current = {
          students: normalizedStudents,
          classrooms: reconcileClassrooms,
          latestQuizByStudent,
        };

        const reconciled = await buildReconciledAlerts({
          students: normalizedStudents,
          classrooms: reconcileClassrooms,
          latestQuizByStudent,
        });

        setAlerts(reconciled.activeAlerts);
        setDismissedAlerts(reconciled.dismissedAlerts);
        setAlertPrefs(reconciled.preferences);
        flaggedCounts = reconciled.flaggedCountsByClassroom;

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
      } else {
        rosterCacheRef.current = { students: [], classrooms: [], latestQuizByStudent: {} };
        setAlerts([]);
        setDismissedAlerts([]);
      }

      setCards(
        classrooms.map((row: any, i: number) => {
          const realStudentCount = studentCounts[row.id];
          const realFlaggedCount = flaggedCounts[row.id] ?? 0;
          const realQuizCount = quizCounts[row.id];

          const displayStudents = realStudentCount !== undefined ? realStudentCount : (row.student_count ?? 0);
          const displayFlagged = realStudentCount !== undefined ? realFlaggedCount : (row.flagged_count ?? 0);
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

  async function reconcileCachedAlerts(prefsOverride?: AlertPreferences) {
    const cache = rosterCacheRef.current;
    const reconciled = await buildReconciledAlerts({
      students: cache.students,
      classrooms: cache.classrooms,
      latestQuizByStudent: cache.latestQuizByStudent,
      preferencesOverride: prefsOverride,
    });
    setAlerts(reconciled.activeAlerts);
    setDismissedAlerts(reconciled.dismissedAlerts);
    setAlertPrefs(reconciled.preferences);
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        flagged: reconciled.flaggedCountsByClassroom[c.id] ?? 0,
      }))
    );
  }

  // ── Notification Alerts Handlers ─────────────────────────────────────────
  function handleOpenNotif(classroomFilter: string | null = null) {
    setNotifClassroomFilter(classroomFilter);
    setNotifOpen(true);
  }

  async function handleAlertPress(alert: RosterAlert) {
    await markAlertsAsRead([alert.id, alert.studentId, `flag_${alert.studentId}`, `alert_${alert.studentId}`]);
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

  async function handleRemedialQuizPress(alert: RosterAlert) {
    await markAlertsAsRead([alert.id, alert.studentId, `flag_${alert.studentId}`, `alert_${alert.studentId}`]);
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
        initialTab: "AI Builder",
      },
    });
  }

  async function handleDismissAlert(alert: RosterAlert) {
    await dismissSingleAlert(alert);
    setAlerts((prev) => prev.filter((a) => a.studentId !== alert.studentId));
    setDismissedAlerts((prev) =>
      prev.some((a) => a.studentId === alert.studentId) ? prev : [alert, ...prev]
    );
  }

  async function handleRestoreAlerts(toRestore: RosterAlert[]) {
    await restoreDismissedAlerts(toRestore);
    await reconcileCachedAlerts();
  }

  async function handleMarkAllRead() {
    await markAllAlertsAsRead(alerts);
    setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
  }

  async function handleClearAllAlerts() {
    const clearedNow = [...alerts];
    await clearAllAlerts(clearedNow);
    setAlerts([]);
    setDismissedAlerts((prev) => {
      const existingIds = new Set(prev.map((p) => p.studentId));
      const merged = [...prev];
      for (const a of clearedNow) {
        if (!existingIds.has(a.studentId)) merged.unshift(a);
      }
      return merged;
    });
  }

  async function handleAlertPrefsChange(nextPrefs: AlertPreferences) {
    setAlertPrefs(nextPrefs);
    await reconcileCachedAlerts(nextPrefs);
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
      setDismissedAlerts((prev) => prev.filter((a) => a.classroomId !== classId));
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
      <View style={[styles.appBar, { backgroundColor: skeuo.chrome, borderBottomColor: skeuo.bevelBottom }]}>
        <View style={styles.topBrandRow}>
          <View style={[styles.brandMarkCircle, { backgroundColor: skeuo.surface }]}>
            <View style={styles.brandMarkInnerDot} />
          </View>
          <Text style={[styles.brandMarkText, { color: textMain }]}>TSEKI</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.notifBtn,
            skeuoButtonStyle(skeuo, { neutral: true, radius: 12 }),
            unreadAlertsCount > 0 && {
              backgroundColor: skeuo.accentSoft,
              borderTopColor: darkMode ? "#7C3A16" : "#FFFFFF",
              borderLeftColor: skeuo.accentSoftBorder,
              borderRightColor: skeuo.accentSoftBorder,
              borderBottomColor: darkMode ? "#3A1909" : "#D9A47F",
            },
          ]}
          onPress={() => {
            triggerSkeuoHaptic("light");
            handleOpenNotif(null);
          }}
          activeOpacity={0.75}
          accessibilityLabel={
            unreadAlertsCount > 0
              ? `Roster alerts, ${unreadAlertsCount} unread`
              : "Roster alerts"
          }
        >
          <Ionicons
            name={unreadAlertsCount > 0 ? "notifications" : "notifications-outline"}
            size={20}
            color={ORANGE}
          />
          {unreadAlertsCount > 0 ? (
            <View style={[styles.notifBadge, { borderColor: skeuo.chrome }]}>
              <Text style={styles.notifBadgeText}>
                {unreadAlertsCount > 9 ? "9+" : unreadAlertsCount}
              </Text>
            </View>
          ) : alerts.length > 0 ? (
            <View style={[styles.notifSubtleDot, { borderColor: skeuo.chrome }]} />
          ) : null}
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
              skeuoButtonStyle(skeuo, { fill: ORANGE, pressed, radius: 11 }),
            ]}
            onPress={() => {
              triggerSkeuoHaptic("light");
              openModal();
            }}
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
              style={({ pressed }) => [
                styles.classCard,
                skeuoCardStyle(skeuo, 18),
                pressed && { transform: [{ translateY: 1 }] },
              ]}
              onPress={() => {
                triggerSkeuoHaptic("light");
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
                });
              }}
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

              <View style={[styles.cardBottom, { backgroundColor: cardBg, borderTopColor: skeuo.grooveDark }]}>
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
                  <TouchableOpacity
                    style={[
                      styles.flaggedBadge,
                      darkMode && { backgroundColor: "#450A0A" },
                    ]}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleOpenNotif(card.id);
                    }}
                    activeOpacity={0.75}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityLabel={`View ${card.flagged} flagged students in ${card.title}`}
                  >
                    <Ionicons name="warning-outline" size={13} color={darkMode ? "#F87171" : "#DC2626"} />
                    <Text style={[styles.flaggedText, darkMode && { color: "#FCA5A5" }]}>
                      {card.flagged} FLAGGED
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.allClearBadge, darkMode && { backgroundColor: "#064E3B40" }]}>
                    <Ionicons name="checkmark-circle-outline" size={13} color={darkMode ? "#34D399" : "#059669"} />
                    <Text style={[styles.allClearBadgeText, darkMode && { color: "#6EE7B7" }]}>ALL CLEAR</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}

        {/* ── Empty State ── */}
        {!loading && cards.length === 0 && (
          <View style={[{ alignItems: "center", justifyContent: "center", paddingVertical: 40, paddingHorizontal: 24, marginTop: 8 }, skeuoCardStyle(skeuo, 18)]}>
            <View style={[{ width: 64, height: 64, alignItems: "center", justifyContent: "center", marginBottom: 16 }, skeuoWellStyle(skeuo, 32)]}>
              <Ionicons name="school-outline" size={30} color={ORANGE} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: "700", color: textMain, marginBottom: 6 }}>No Classrooms Yet</Text>
            <Text style={{ fontSize: 13, color: textSub, textAlign: "center", lineHeight: 18, marginBottom: 20 }}>
              Tap &quot;New Class&quot; above or the button below to build your first course and start grading!
            </Text>
            <TouchableOpacity
              style={[styles.buildBtn, skeuoButtonStyle(skeuo, { fill: ORANGE, radius: 12 }), { paddingHorizontal: 20, height: 44, flex: 0 }]}
              onPress={() => {
                triggerSkeuoHaptic("light");
                openModal();
              }}
            >
              <Ionicons name="add-circle" size={18} color="#FFFFFF" />
              <Text style={styles.buildBtnText}>Build Classroom</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── Fixed Bottom Skeuomorphic Helper Plaque ── */}
      {!bannerDismissed && (() => {
        const skeuo = getSkeuoPalette(darkMode, ORANGE);
        const sem = getSemanticTokens("confirm", darkMode, ORANGE);
        return (
          <View style={styles.fixedBannerContainer}>
            <View
              style={[
                styles.infoBanner,
                skeuoCardStyle(skeuo, 15),
                {
                  backgroundColor: darkMode ? skeuo.surface : "#FAF8F4",
                },
              ]}
            >
              <View
                style={[
                  styles.bannerLedStrip,
                  {
                    backgroundColor: sem.ledBar,
                    shadowColor: sem.led,
                  },
                ]}
              />
              <View
                style={[
                  styles.bannerMascotWrap,
                  skeuoWellStyle(skeuo, 12),
                  { backgroundColor: sem.socketBg, borderColor: sem.socketBorder },
                ]}
              >
                <AnimatedTsekiLogo size={46} />
              </View>
              <View style={styles.bannerTextContent}>
                <View style={styles.bannerTitleRow}>
                  <Text style={[styles.bannerTitle, { color: skeuo.textPrimary }]}>
                    {getTeacherGreeting(userName)}
                  </Text>
                  <Pressable
                    onPress={() => {
                      triggerSkeuoHaptic("light");
                      setBannerDismissed(true);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={({ pressed }) => [
                      styles.bannerCloseBtn,
                      skeuoButtonStyle(skeuo, { neutral: true, pressed, radius: 9 }),
                    ]}
                    accessibilityLabel="Dismiss helper banner"
                  >
                    <Ionicons name="close" size={14} color={skeuo.textSecondary} />
                  </Pressable>
                </View>
                <Text style={[styles.bannerBody, { color: skeuo.textSecondary }]}>
                  Open a class to grade answer sheets with the camera or generate DepEd-aligned quizzes in seconds.
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ── Bottom Navigation ── */}
      <View style={[styles.bottomNav, { backgroundColor: skeuo.chrome, borderTopColor: skeuo.bevelTop }]}>
        <Pressable style={[styles.navItem, skeuoWellStyle(skeuo, 12), { backgroundColor: skeuo.accentSoft, borderTopColor: skeuo.accentSoftBorder, borderLeftColor: skeuo.accentSoftBorder }]}>
          <Ionicons name="school-outline" size={20} color={ORANGE} />
          <Text style={styles.navTextActive}>My Classes</Text>
        </Pressable>
        {/* Settings nav */}
        <Pressable
          style={({ pressed }) => [
            styles.navItem,
            pressed && skeuoWellStyle(skeuo, 12),
          ]}
          onPress={() => {
            triggerSkeuoHaptic("selection");
            router.push("/settings" as any);
          }}
        >
          <Ionicons name="settings-outline" size={20} color={textSub} />
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
        <View style={[styles.modalFullScreen, { backgroundColor: skeuo.canvas }]}>
          {/* Top Drag Handle */}
          <View style={[styles.sheetDragHandle, { backgroundColor: skeuo.borderStrong }]} />

          {/* Header */}
          <View
            style={[
              styles.modalFullScreenHeader,
              { borderBottomColor: skeuo.bevelBottom, backgroundColor: skeuo.chrome },
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
                skeuoButtonStyle(skeuo, { neutral: true, radius: 16 }),
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close modal"
            >
              <Ionicons name="close" size={18} color={textMain} />
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
              <Text style={[styles.fieldLabel, { color: textMain, marginTop: 6 }]}>
                Class title <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  skeuoWellStyle(skeuo, 11),
                  { color: textMain },
                ]}
                placeholder="e.g. Grade 10 - Mathematics"
                placeholderTextColor={skeuo.textMuted}
                value={classTitle}
                autoCapitalize="words"
                onChangeText={setClassTitle}
              />

              {/* Subject */}
              <Text style={[styles.fieldLabel, { color: textMain }]}>
                Subject <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  skeuoWellStyle(skeuo, 11),
                  { color: textMain },
                ]}
                placeholder="e.g. Mathematics"
                placeholderTextColor={skeuo.textMuted}
                value={subject}
                autoCapitalize="words"
                onChangeText={setSubject}
              />

              {/* Section + Room (side by side) */}
              <View style={styles.rowFields}>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: textMain }]}>Section</Text>
                  <TextInput
                    style={[
                      styles.input,
                      skeuoWellStyle(skeuo, 11),
                      { color: textMain },
                    ]}
                    placeholder="e.g. Section 5"
                    placeholderTextColor={skeuo.textMuted}
                    value={section}
                    autoCapitalize="words"
                    onChangeText={setSection}
                  />
                </View>
                <View style={styles.halfField}>
                  <Text style={[styles.fieldLabel, { color: textMain }]}>Room</Text>
                  <TextInput
                    style={[
                      styles.input,
                      skeuoWellStyle(skeuo, 11),
                      { color: textMain },
                    ]}
                    placeholder="e.g. CL1"
                    placeholderTextColor={skeuo.textMuted}
                    value={room}
                    autoCapitalize="characters"
                    onChangeText={setRoom}
                  />
                </View>
              </View>

              {/* Schedule */}
              <Text style={[styles.fieldLabel, { color: textMain }]}>Schedule</Text>
              <TextInput
                style={[
                  styles.input,
                  skeuoWellStyle(skeuo, 11),
                  { color: textMain },
                ]}
                placeholder="e.g. MWF 9:00 - 10:30 AM"
                placeholderTextColor={skeuo.textMuted}
                value={schedule}
                autoCapitalize="characters"
                onChangeText={setSchedule}
              />

              {/* Theme color */}
              <Text style={[styles.fieldLabel, { color: textMain, marginBottom: 4 }]}>
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
                      onPress={() => {
                        triggerSkeuoHaptic("selection");
                        setSelectedColor(c);
                      }}
                      style={[
                        styles.colorSwatch,
                        {
                          backgroundColor: c,
                          borderWidth: 2,
                          borderColor: isSelected ? textMain : "rgba(255,255,255,0.45)",
                        },
                        isSelected && styles.colorSwatchSelected,
                      ]}
                      accessibilityLabel={`Select theme color ${c}`}
                    >
                      {isSelected && (
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    skeuoButtonStyle(skeuo, { neutral: true, radius: 11 }),
                  ]}
                  onPress={handleCancel}
                >
                  <Text
                    style={[
                      styles.cancelBtnText,
                      { color: textMain },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.buildBtn,
                    (!classTitle.trim() || saving)
                      ? [
                          styles.buildBtnDisabled,
                          skeuoWellStyle(skeuo, 11),
                        ]
                      : skeuoButtonStyle(skeuo, { fill: selectedColor || "#EA580C", radius: 11 }),
                  ]}
                  onPress={() => {
                    triggerSkeuoHaptic("light");
                    handleBuildClass();
                  }}
                  disabled={!classTitle.trim() || saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons
                        name="add"
                        size={18}
                        color={(!classTitle.trim() || saving) ? skeuo.textMuted : "#FFFFFF"}
                      />
                      <Text
                        style={[
                          styles.buildBtnText,
                          (!classTitle.trim() || saving) && { color: skeuo.textMuted },
                        ]}
                      >
                        Build Class
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Roster Alerts Bottom Sheet Modal ── */}
      <NotificationsModal
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        scope="global"
        alerts={alerts}
        dismissedAlerts={dismissedAlerts}
        preferences={alertPrefs}
        initialClassroomFilter={notifClassroomFilter}
        onAlertPress={handleAlertPress}
        onRemedialQuizPress={handleRemedialQuizPress}
        onDismissAlert={handleDismissAlert}
        onRestoreAlerts={handleRestoreAlerts}
        onMarkAllRead={handleMarkAllRead}
        onClearAll={handleClearAllAlerts}
        onPreferencesChange={handleAlertPrefsChange}
      />

      {/* ── Delete Classroom Email-Verified Confirmation Modal ── */}
      <DeleteEmailVerificationModal
        visible={confirmModalVisible}
        entityType="classroom"
        targetName={classToDelete?.title || "Classroom"}
        description="This will permanently remove all enrolled students, quizzes, answer keys, and grade records for this classroom."
        confirmActionLabel="Verify & Delete"
        onClose={() => {
          if (!isDeletingClass) {
            setConfirmModalVisible(false);
            setClassToDelete(null);
          }
        }}
        onVerifiedDelete={handleConfirmDeleteClass}
      />

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
    borderRadius: 12,
    backgroundColor: ORANGE_LIGHT,
    borderWidth: 1,
    borderColor: "#FED7AA",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notifBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#DC2626",
    minWidth: 19,
    height: 19,
    borderRadius: 9.5,
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
    fontVariant: ["tabular-nums"],
  },
  notifSubtleDot: {
    position: "absolute",
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ORANGE,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
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
    borderRadius: 15,
    paddingVertical: 12,
    paddingRight: 13,
    paddingLeft: 16,
    alignItems: "center",
    overflow: "hidden",
  },
  bannerLedStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    shadowOffset: { width: 1, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  bannerMascotWrap: {
    width: 52,
    height: 52,
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
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.2,
    flex: 1,
    marginRight: 8,
  },
  bannerCloseBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerBody: {
    fontSize: 12,
    lineHeight: 17.5,
    fontWeight: "500",
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
  sheetDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 2,
  },
  modalFullScreen: {
    flex: 1,
  },
  modalFullScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  modalHeaderInfo: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
    lineHeight: 18,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
    marginTop: 16,
  },
  required: {
    color: ORANGE,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    backgroundColor: "#FFFFFF",
    color: "#0F172A",
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
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#334155",
  },
  buildBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    shadowOpacity: 0,
    elevation: 0,
  },
  buildBtnDisabled: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowOpacity: 0,
    elevation: 0,
  },
  buildBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  buildBtnTextDisabled: {
    color: "#94A3B8",
  },
  colorSubtitle: {
    fontSize: 13,
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
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSwatchSelected: {
    transform: [{ scale: 1.08 }],
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
