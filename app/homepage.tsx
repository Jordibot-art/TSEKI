import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

// ── Seed data (the two existing cards) ────────────────────────────────────────
const CARD_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#EC4899"];

const initialCards: ClassCard[] = [
  {
    id: "1",
    schedule: "A - Destiny",
    title: "Grade 10 - Newton",
    room: "Room 301",
    color: "#3B82F6",
    students: 3,
    quizzes: 2,
    flagged: 1,
  },
  {
    id: "2",
    schedule: "MWF 12:30 - 1:30",
    title: "Grade 10 - Einstein",
    room: "Room 302",
    color: "#F59E0B",
    students: 2,
    quizzes: 2,
    flagged: 1,
  },
];

export default function HomePage() {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [cards, setCards] = useState<ClassCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // form fields
  const [classTitle, setClassTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("");
  const [room, setRoom] = useState("");

  // ── Load classrooms from Supabase ─────────────────────────────────────────
  useEffect(() => {
    loadClassrooms();
  }, []);

  async function loadClassrooms() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("classrooms")
      .select("*")
      .eq("teacher_id", user.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setCards(
        data.map((row: any, i: number) => ({
          id: row.id,
          schedule: row.subject || "No Subject",
          title: row.title,
          room: row.room ? `Room ${row.room}` : row.section || "No Room",
          color: CARD_COLORS[i % CARD_COLORS.length],
          students: row.student_count ?? 0,
          quizzes: row.quiz_count ?? 0,
          flagged: row.flagged_count ?? 0,
        }))
      );
    }
    setLoading(false);
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
    <View style={styles.root}>
      {/* ── Top App Bar ── */}
      <View style={styles.appBar}>
        <View style={styles.logoRow}>
          <View style={styles.logoIconBg}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.smallLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.appTitle}>Tseki</Text>
        </View>
        <Pressable onPress={() => { }}>
          <Ionicons name="notifications-outline" size={24} color="#4B5563" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section Header ── */}
        <View style={styles.sectionHeader}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.sectionTitle}>Your Classroom</Text>
            <Text style={styles.sectionSubtitle}>
              Select a course to manage quizzes &amp; scorecards
            </Text>
          </View>
          <Pressable style={styles.addBtn} onPress={openModal}>
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Loading indicator ── */}
        {loading && (
          <ActivityIndicator
            size="large"
            color="#F97316"
            style={{ marginVertical: 32 }}
          />
        )}

        {/* ── Class Cards (dynamic) ── */}
        {!loading && cards.map((card) => (
          <Pressable
            key={card.id}
            style={styles.classCard}
            onPress={() =>
              router.push({
                pathname: "/classroom",
                params: {
                  id: card.id,
                  title: card.title,
                  schedule: card.schedule,
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
            <View style={styles.cardBottom}>
              <View style={styles.statItem}>
                <Ionicons name="people-outline" size={16} color="#4B5563" />
                <Text style={styles.statText}>{card.students} Students</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="book-outline" size={16} color="#4B5563" />
                <Text style={styles.statText}>{card.quizzes} Quizzes</Text>
              </View>
              {card.flagged > 0 && (
                <View style={styles.flaggedBadge}>
                  <Ionicons name="warning-outline" size={14} color="#EF4444" />
                  <Text style={styles.flaggedText}>{card.flagged} FLAGGED</Text>
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
      <View style={styles.bottomNav}>
        <Pressable style={[styles.navItem, styles.navItemActive]}>
          <Ionicons name="school" size={26} color="#111827" />
          <Text style={styles.navTextActive}>My Classes</Text>
        </Pressable>
        {/* Temporarily using settings as logout to keep functionality */}
        <Pressable style={styles.navItem} onPress={handleLogout}>
          <Ionicons name="settings" size={26} color="#4B5563" />
          <Text style={styles.navText}>Settings</Text>
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

                  {/* SUBJECT / COURSE */}
                  <Text style={styles.fieldLabel}>
                    SUBJECT / COURSE <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Algebra 1"
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
});
