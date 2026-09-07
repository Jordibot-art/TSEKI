import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import {
  clearAllAlerts,
  getClearedAlertIds,
  getPersistedAlerts,
  getReadAlertIds,
  markAlertsAsRead,
  RosterAlert,
} from "../lib/alertStore";
import { getPublishedQuizzes, getQuizPerformanceRecords } from "../lib/quizStore";
import { supabase } from "../supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
type ClassCard = {
  id: string;
  schedule: string;
  title: string;
  room: string;
  color: string;
  students: number;
  quizzes: number;
  flagged: number;
};

const CARD_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#EC4899"];

export default function HomePage() {
  const router = useRouter();
  const { darkMode, themeColor } = useTheme();

  // ── Dynamic colors ──────────────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#F9FAFB";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#E5E7EB";


  const [cards, setCards] = useState<ClassCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [alerts, setAlerts] = useState<RosterAlert[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // form fields
  const [classTitle, setClassTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [room, setRoom] = useState("");

  // ── Load classrooms from Supabase ─────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadClassrooms();
    }, [])
  );

  async function loadClassrooms() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

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

              if (!clearedIds.includes(alertId) && !clearedIds.includes(s.id)) {
                activeAlerts.push({
                  id: alertId,
                  studentId: s.id,
                  studentName: s.full_name || "Student",
                  classroomId: s.classroom_id,
                  classroomTitle: c ? c.title : "Classroom",
                  classroomSchedule: c ? (c.subject || "No Subject") : "",
                  classroomRoom: c ? (c.room ? `Room ${c.room}` : c.section || "No Room") : "",
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

          return {
            id: row.id,
            schedule: row.subject || "No Subject",
            title: row.title,
            room: row.room ? `Room ${row.room}` : row.section || "No Room",
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

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function openModal() {
    setClassTitle("");
    setSubject("");
    setSection("");
    setRoom("");
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

    const { data, error } = await supabase
      .from("classrooms")
      .insert({
        teacher_id: user.id,
        title: classTitle.trim(),
        subject: subject.trim() || null,
        section: section.trim() || null,
        room: room.trim() || null,
      })
      .select()
      .single();

    if (!error && data) {
      const newCard: ClassCard = {
        id: data.id,
        schedule: data.subject || "No Subject",
        title: data.title,
        room: data.room ? `Room ${data.room}` : data.section || "No Room",
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
        <View style={styles.logoRow}>
          <View style={[styles.logoIconBg, { backgroundColor: themeColor + "22" }]}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.smallLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.appTitle, { color: textMain }]}>Tseki</Text>
        </View>
        <TouchableOpacity
          style={styles.notifBtn}
          onPress={handleOpenNotif}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={24} color={textSub} />
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
            <Text style={[styles.sectionTitle, { color: textSub }]}>Your Classroom</Text>
            <Text style={[styles.sectionSubtitle, { color: textSub }]}>
              Select a course to manage quizzes &amp; scorecards
            </Text>
          </View>
          <Pressable style={[styles.addBtn, { backgroundColor: themeColor, shadowColor: themeColor }]} onPress={openModal}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
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
                  schedule: card.schedule,
                  subject: card.schedule !== "No Subject" ? card.schedule : "",
                  room: card.room,
                  color: card.color,
                },
              })
            }
          >
            <View style={[styles.cardTop, { backgroundColor: card.color }]}>
              <Text style={styles.cardSchedule}>{card.schedule}</Text>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardRoom}>{card.room}</Text>
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
          <Image
            source={require("../assets/images/logo.png")}
            style={styles.bannerMascot}
            resizeMode="contain"
          />
          <View style={styles.bannerTextContent}>
            <Text style={styles.bannerTitle}>Hi Teacher! I'm Tseki</Text>
            <Text style={styles.bannerBody}>
              I'm here to automate grading and flag struggling students!
              Open a class, tap the camera tab to grade sheets instantly,
              or use the AI Generator to build standard-based quizzes.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Bottom Navigation ── */}
      <View style={[styles.bottomNav, { backgroundColor: cardBg, borderTopColor: border }]}>
        <Pressable style={[styles.navItem, styles.navItemActive, { backgroundColor: themeColor + "22" }]}>
          <Ionicons name="school" size={26} color={themeColor} />
          <Text style={[styles.navTextActive, { color: themeColor }]}>My Classes</Text>
        </Pressable>
        {/* Settings nav */}
        <Pressable style={styles.navItem} onPress={() => router.push("/settings" as any)}>
          <Ionicons name="settings" size={26} color={textSub} />
          <Text style={[styles.navText, { color: textSub }]}>Settings</Text>
        </Pressable>
      </View>

      {/* ── Build Classroom Modal ── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
        >
          <TouchableWithoutFeedback onPress={handleCancel}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.modalCard}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Build Classroom</Text>
                    <TouchableOpacity onPress={handleCancel} style={styles.modalCloseBtn}>
                      <Ionicons name="close" size={24} color="#6B7280" />
                    </TouchableOpacity>
                  </View>

                  {/* CLASS TITLE */}
                  <Text style={styles.fieldLabel}>
                    CLASS TITLE <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Grade 10 - Mathematics"
                    placeholderTextColor="#9CA3AF"
                    value={classTitle}
                    onChangeText={setClassTitle}
                  />

                  {/* SUBJECT */}
                  <Text style={styles.fieldLabel}>
                    SUBJECT <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Mathematics"
                    placeholderTextColor="#9CA3AF"
                    value={subject}
                    onChangeText={setSubject}
                  />

                  {/* SECTION + ROOM (side by side) */}
                  <View style={styles.rowFields}>
                    <View style={styles.halfField}>
                      <Text style={styles.fieldLabel}>SECTION</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. Section 5"
                        placeholderTextColor="#9CA3AF"
                        value={section}
                        onChangeText={setSection}
                      />
                    </View>
                    <View style={styles.halfField}>
                      <Text style={styles.fieldLabel}>ROOM</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. CL1"
                        placeholderTextColor="#9CA3AF"
                        value={room}
                        onChangeText={setRoom}
                      />
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={handleCancel}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
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
                        <Text style={styles.buildBtnText}>Build Class</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
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
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoIconBg: {
    width: 36,
    height: 36,
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  smallLogo: {
    width: 24,
    height: 24,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2937",
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
    fontSize: 20,
    fontWeight: "800",
    color: "#4B5563",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6B7280",
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  /* ── Class Cards ── */
  classCard: {
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardTop: {
    padding: 16,
    paddingBottom: 24,
  },
  cardSchedule: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  cardRoom: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "500",
  },
  flaggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  flaggedText: {
    fontSize: 10,
    color: "#EF4444",
    fontWeight: "700",
  },
  allClearBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  allClearBadgeText: {
    fontSize: 10,
    color: "#10B981",
    fontWeight: "700",
  },

  /* ── Info Banner ── */
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "#FFFBEB",
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    alignItems: "center",
  },
  bannerMascot: {
    width: 60,
    height: 80,
    marginRight: 16,
  },
  bannerTextContent: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 11,
    color: "#4B5563",
    lineHeight: 16,
  },

  /* ── Bottom Navigation ── */
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingBottom: 30,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
  },
  navItemActive: {
    backgroundColor: "#FEF3C7",
    marginHorizontal: 16,
    borderRadius: 12,
  },
  navText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4B5563",
  },
  navTextActive: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },

  /* ── Modal ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",   // slide up from bottom like a bottom sheet
    alignItems: "center",
    paddingHorizontal: 0,
  },
  modalCard: {
    width: "100%",
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
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1F2937",
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 16,
  },
  required: {
    color: "#EF4444",
  },
  input: {
    height: 56,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 17,
    color: "#1F2937",
    backgroundColor: "#F9FAFB",
  },
  rowFields: {
    flexDirection: "row",
    gap: 14,
  },
  halfField: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 14,
    marginTop: 30,
  },
  cancelBtn: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#4B5563",
  },
  buildBtn: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  buildBtnDisabled: {
    backgroundColor: "#FCD9B6",
    shadowOpacity: 0,
    elevation: 0,
  },
  buildBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* ── Notification Bell & Badge (Image 1) ── */
  notifBtn: {
    position: "relative",
    padding: 6,
  },
  notifBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "#EF4444",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  notifBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
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
});
