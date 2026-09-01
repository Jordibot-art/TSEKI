import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  View,
} from "react-native";
import { supabase } from "../supabase";
import AIBuilderTab from "../components/AIBuilderTab";

// ── Types ─────────────────────────────────────────────────────────────────────
type Student = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
  attendance: number;
};

type Tab = "Record" | "AI Builder" | "Grader" | "Tracker";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#6366F1", "#F59E0B", "#10B981", "#EF4444", "#EC4899", "#3B82F6",
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ClassroomScreen() {
  const router = useRouter();
  const { id, title, schedule, room, color } = useLocalSearchParams<{
    id: string;
    title: string;
    schedule: string;
    room: string;
    color: string;
  }>();

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("Record");
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add-student modal
  const [modalVisible, setModalVisible] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [attendance, setAttendance] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadStudents();
  }, []);

  async function loadStudents() {
    setLoading(true);
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("classroom_id", id)
      .order("created_at", { ascending: true });

    if (!error && data) setStudents(data as Student[]);
    setLoading(false);
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────
  function openAddModal() {
    setFullName("");
    setEmail("");
    setAttendance("");
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
        attendance: parseFloat(attendance) || 0,
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
  const cardColor = color || "#6366F1";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* ── Top App Bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={20} color="#1F2937" />
          <Text style={styles.backText}>Classrooms</Text>
        </TouchableOpacity>

        <Text style={styles.topSubject} numberOfLines={1}>
          {schedule === "No Subject" ? title : schedule}
        </Text>

        <View style={[styles.notifDot, { backgroundColor: cardColor }]}>
          <Ionicons name="notifications" size={16} color="#FFFFFF" />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Class Banner ── */}
        <View style={[styles.banner, { backgroundColor: cardColor }]}>
          {/* subtle lighter overlay stripe */}
          <View style={styles.bannerStripe} />
          <Text style={styles.bannerTitle}>{title}</Text>
          <Text style={styles.bannerSub}>
            {schedule === "No Subject" ? "" : `${schedule} • `}
            {room}
          </Text>
        </View>

        {/* ── Tab Bar ── */}
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tab Content ── */}
        {activeTab === "Record" && (
          <>
            {/* ── Action Row ── */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.importBtn}>
                <Ionicons name="cloud-upload-outline" size={17} color="#FFFFFF" />
                <Text style={styles.importBtnText}>Import Record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportBtn}>
                <Ionicons
                  name="document-text-outline"
                  size={17}
                  color="#4B5563"
                />
                <Text style={styles.exportBtnText}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fabSmall} onPress={openAddModal}>
                <Ionicons name="add" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </>
        )}

        {activeTab === "AI Builder" && (
          <AIBuilderTab
            classroomId={id as string}
            classTitle={title as string}
            accentColor={cardColor}
          />
        )}

        {activeTab === "Record" && (
          <>
            {/* \u2500\u2500 Search Bar \u2500\u2500 */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={17} color="#9CA3AF" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search students by name or email..."
                placeholderTextColor="#9CA3AF"
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={17} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>

            {/* \u2500\u2500 Roster Header \u2500\u2500 */}
            <View style={styles.rosterHeader}>
              <Text style={styles.rosterTitle}>
                Student Rosters ({filtered.length})
              </Text>
              <Text style={styles.rosterHint}>Tap name to view details</Text>
            </View>

            {/* \u2500\u2500 Student List \u2500\u2500 */}
            {loading ? (
              <ActivityIndicator
                size="large"
                color="#F97316"
                style={{ marginVertical: 40 }}
              />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={52} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>No students yet</Text>
                <Text style={styles.emptySub}>
                  Tap the{" "}
                  <Text style={{ color: "#F97316", fontWeight: "700" }}>+</Text>{" "}
                  button to add your first student
                </Text>
              </View>
            ) : (
              filtered.map((student, i) => {
                const avg = student.average ?? 0;
                const isFlagged = avg < 75;
                const isTop = avg >= 95;
                return (
                  <Pressable key={student.id} style={styles.studentRow}>
                    {/* Avatar */}
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

                    {/* Info */}
                    <View style={styles.studentInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.studentName} numberOfLines={1}>
                          {student.full_name}
                        </Text>
                        {isTop && (
                          <View style={styles.topBadge}>
                            <Text style={styles.topBadgeText}>Top</Text>
                          </View>
                        )}
                        {isFlagged && (
                          <Ionicons name="warning" size={14} color="#EF4444" />
                        )}
                      </View>
                      <Text style={styles.studentEmail} numberOfLines={1}>
                        {student.email ?? "No email"}
                      </Text>
                    </View>

                    {/* Stats */}
                    <View style={styles.studentStats}>
                      <View style={styles.statCol}>
                        <Text style={styles.statValue}>{avg}%</Text>
                        <Text style={styles.statLabel}>Average</Text>
                      </View>
                      <View style={styles.statCol}>
                        <Text style={styles.statValue}>
                          {student.attendance ?? 0}%
                        </Text>
                        <Text style={styles.statLabel}>Attend.</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                    </View>
                  </Pressable>
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <TouchableWithoutFeedback onPress={handleCancel}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.modalCard}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Add New Student</Text>
                    <TouchableOpacity
                      onPress={handleCancel}
                      style={styles.modalCloseBtn}
                    >
                      <Ionicons name="close" size={22} color="#6B7280" />
                    </TouchableOpacity>
                  </View>

                  {/* Full Name */}
                  <Text style={styles.fieldLabel}>
                    FULL NAME <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Liam Smith"
                    placeholderTextColor="#9CA3AF"
                    value={fullName}
                    onChangeText={setFullName}
                  />

                  {/* Email */}
                  <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. liam.smith@school.edu"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  {/* Attendance */}
                  <Text style={styles.fieldLabel}>ATTENDANCE (%)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 95"
                    placeholderTextColor="#9CA3AF"
                    value={attendance}
                    onChangeText={setAttendance}
                    keyboardType="numeric"
                  />

                  {/* Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={handleCancel}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
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
    gap: 2,
    flex: 1,
  },
  backText: {
    fontSize: 15,
    color: "#1F2937",
    fontWeight: "600",
  },
  topSubject: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2937",
    flex: 1,
    textAlign: "center",
  },
  notifDot: {
    flex: 1,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
    maxWidth: 32,
  },

  /* ── Scroll ── */
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 48,
  },

  /* ── Banner ── */
  banner: {
    paddingHorizontal: 22,
    paddingVertical: 22,
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
  bannerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 6,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    gap: 6,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },
  tabActive: {
    backgroundColor: "#F97316",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
  },
  tabTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
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
    backgroundColor: "#F97316",
    borderRadius: 12,
    paddingVertical: 11,
    gap: 6,
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
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingVertical: 11,
    gap: 6,
  },
  exportBtnText: {
    color: "#4B5563",
    fontWeight: "600",
    fontSize: 13,
  },
  fabSmall: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
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
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
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
  topBadge: {
    backgroundColor: "#DBEAFE",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  topBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#2563EB",
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
  addBtnDisabled: {
    backgroundColor: "#FCD9B6",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
