import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";

// ── Theme accent colors ────────────────────────────────────────────────────────
const THEME_COLORS = [
  { label: "Orange",  value: "#F97316" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Purple",  value: "#8B5CF6" },
  { label: "Emerald", value: "#10B981" },
  { label: "Rose",    value: "#F43F5E" },
  { label: "Amber",   value: "#F59E0B" },
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function SettingsScreen() {
  const router = useRouter();

  // ── User info ──────────────────────────────────────────────────────────────
  const [email, setEmail]           = useState("");
  const [fullName, setFullName]     = useState("");
  const [initials, setInitials]     = useState("T");
  const [loadingUser, setLoadingUser] = useState(true);

  // ── Appearance (from global context — persisted via AsyncStorage) ───────────
  const { darkMode, themeColor, setDarkMode, setThemeColor } = useTheme();

  // ── Edit Name modal ────────────────────────────────────────────────────────
  const [editVisible, setEditVisible] = useState(false);
  const [draftName, setDraftName]     = useState("");
  const [savingName, setSavingName]   = useState(false);

  // ── Change Password modal ──────────────────────────────────────────────────
  const [pwVisible, setPwVisible]         = useState(false);
  const [newPw, setNewPw]                 = useState("");
  const [confirmPw, setConfirmPw]         = useState("");
  const [showNewPw, setShowNewPw]         = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPw, setSavingPw]           = useState(false);

  // ── Load user ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const name = user.user_metadata?.full_name ?? "";
        setEmail(user.email ?? "");
        setFullName(name);
        setInitials(name ? getInitials(name) : (user.email?.[0] ?? "T").toUpperCase());
      }
      setLoadingUser(false);
    })();
  }, []);

  // ── Save display name ──────────────────────────────────────────────────────
  async function handleSaveName() {
    if (!draftName.trim()) return;
    setSavingName(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: draftName.trim() } });
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setFullName(draftName.trim());
      setInitials(getInitials(draftName.trim()));
      setEditVisible(false);
    }
    setSavingName(false);
  }

  // ── Change password ────────────────────────────────────────────────────────
  async function handleChangePassword() {
    if (!newPw || !confirmPw) {
      Alert.alert("Missing fields", "Please fill in both password fields.");
      return;
    }
    if (newPw.length < 6) {
      Alert.alert("Too short", "Password must be at least 6 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert("Done!", "Your password has been updated.");
      setNewPw("");
      setConfirmPw("");
      setPwVisible(false);
    }
    setSavingPw(false);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  function handleLogout() {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/");
        },
      },
    ]);
  }

  // ── Dynamic colors ─────────────────────────────────────────────────────────
  const bg        = darkMode ? "#111827" : "#F9FAFB";
  const card      = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain  = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub   = darkMode ? "#9CA3AF" : "#6B7280";
  const border    = darkMode ? "#374151" : "#E5E7EB";
  const inputBg   = darkMode ? "#374151" : "#F9FAFB";
  const inputText = darkMode ? "#F9FAFB" : "#1F2937";

  if (loadingUser) {
    return (
      <View style={[styles.centered, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={themeColor} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: card, borderBottomColor: border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={textMain} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textMain }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Card ── */}
        <View style={[styles.profileCard, { backgroundColor: themeColor }]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{fullName || "Teacher"}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
          <TouchableOpacity
            style={styles.editProfileBtn}
            onPress={() => { setDraftName(fullName); setEditVisible(true); }}
          >
            <Ionicons name="pencil" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* ── Account ── */}
        <Text style={[styles.sectionLabel, { color: textSub }]}>ACCOUNT</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <SettingsRow
            icon="person-outline"
            label="Edit Display Name"
            textMain={textMain}
            textSub={textSub}
            accentColor={themeColor}
            onPress={() => { setDraftName(fullName); setEditVisible(true); }}
          />
          <View style={[styles.divider, { backgroundColor: border }]} />
          <SettingsRow
            icon="lock-closed-outline"
            label="Change Password"
            textMain={textMain}
            textSub={textSub}
            accentColor={themeColor}
            onPress={() => { setNewPw(""); setConfirmPw(""); setPwVisible(true); }}
          />
        </View>

        {/* ── Appearance ── */}
        <Text style={[styles.sectionLabel, { color: textSub }]}>APPEARANCE</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {/* Dark Mode */}
          <View style={styles.rowBase}>
            <View style={[styles.iconWrap, { backgroundColor: themeColor + "22" }]}>
              <Ionicons name="moon-outline" size={20} color={themeColor} />
            </View>
            <Text style={[styles.rowLabel, { color: textMain }]}>Dark Mode</Text>
            <Switch
              value={darkMode}
              onValueChange={setDarkMode}
              trackColor={{ false: "#D1D5DB", true: themeColor }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          {/* Theme Color */}
          <View style={styles.colorPickerWrap}>
            <View style={styles.rowBase}>
              <View style={[styles.iconWrap, { backgroundColor: themeColor + "22" }]}>
                <Ionicons name="color-palette-outline" size={20} color={themeColor} />
              </View>
              <Text style={[styles.rowLabel, { color: textMain }]}>Theme Color</Text>
            </View>
            <View style={styles.colorSwatchRow}>
              {THEME_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[
                    styles.swatch,
                    { backgroundColor: c.value },
                    themeColor === c.value && styles.swatchSelected,
                  ]}
                  onPress={() => setThemeColor(c.value)}
                >
                  {themeColor === c.value && (
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── Session ── */}
        <Text style={[styles.sectionLabel, { color: textSub }]}>SESSION</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <TouchableOpacity style={styles.rowBase} onPress={handleLogout}>
            <View style={[styles.iconWrap, { backgroundColor: "#FEE2E2" }]}>
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            </View>
            <Text style={[styles.rowLabel, { color: "#EF4444" }]}>Log Out</Text>
            <Ionicons name="chevron-forward" size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.versionText, { color: textSub }]}>Tseki v1.0.0</Text>
      </ScrollView>

      {/* ── Edit Name Modal ── */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: card }]}>
            <Text style={[styles.modalTitle, { color: textMain }]}>Edit Display Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, color: inputText, borderColor: border }]}
              placeholder="Your full name"
              placeholderTextColor={textSub}
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: border }]}
                onPress={() => setEditVisible(false)}
              >
                <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: themeColor, opacity: (!draftName.trim() || savingName) ? 0.6 : 1 }]}
                onPress={handleSaveName}
                disabled={!draftName.trim() || savingName}
              >
                {savingName
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Change Password Modal ── */}
      <Modal visible={pwVisible} transparent animationType="slide" onRequestClose={() => setPwVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: card }]}>
            <Text style={[styles.modalTitle, { color: textMain }]}>Change Password</Text>

            <Text style={[styles.fieldLabel, { color: textSub }]}>NEW PASSWORD</Text>
            <View style={[styles.pwRow, { backgroundColor: inputBg, borderColor: border }]}>
              <TextInput
                style={[styles.pwInput, { color: inputText }]}
                placeholder="At least 6 characters"
                placeholderTextColor={textSub}
                secureTextEntry={!showNewPw}
                value={newPw}
                onChangeText={setNewPw}
              />
              <TouchableOpacity onPress={() => setShowNewPw(!showNewPw)}>
                <Ionicons name={showNewPw ? "eye-off-outline" : "eye-outline"} size={20} color={textSub} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: textSub, marginTop: 16 }]}>CONFIRM PASSWORD</Text>
            <View style={[styles.pwRow, { backgroundColor: inputBg, borderColor: border }]}>
              <TextInput
                style={[styles.pwInput, { color: inputText }]}
                placeholder="Repeat new password"
                placeholderTextColor={textSub}
                secureTextEntry={!showConfirmPw}
                value={confirmPw}
                onChangeText={setConfirmPw}
              />
              <TouchableOpacity onPress={() => setShowConfirmPw(!showConfirmPw)}>
                <Ionicons name={showConfirmPw ? "eye-off-outline" : "eye-outline"} size={20} color={textSub} />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalActions, { marginTop: 28 }]}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: border }]}
                onPress={() => setPwVisible(false)}
              >
                <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: themeColor, opacity: savingPw ? 0.6 : 1 }]}
                onPress={handleChangePassword}
                disabled={savingPw}
              >
                {savingPw
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Text style={styles.saveBtnText}>Update</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Reusable row ──────────────────────────────────────────────────────────────
function SettingsRow({
  icon, label, onPress, textMain, textSub, accentColor,
}: {
  icon: any; label: string; onPress: () => void;
  textMain: string; textSub: string; accentColor: string;
}) {
  return (
    <TouchableOpacity style={styles.rowBase} onPress={onPress}>
      <View style={[styles.iconWrap, { backgroundColor: accentColor + "22" }]}>
        <Ionicons name={icon} size={20} color={accentColor} />
      </View>
      <Text style={[styles.rowLabel, { color: textMain }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={textSub} />
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1,
  },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },

  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60 },

  profileCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 20,
    padding: 20, marginBottom: 28, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 5,
  },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  avatarText:    { fontSize: 22, fontWeight: "800", color: "#FFFFFF" },
  profileName:   { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginBottom: 2 },
  profileEmail:  { fontSize: 12, color: "rgba(255,255,255,0.8)" },
  editProfileBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },

  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8, marginLeft: 4 },

  card: {
    borderRadius: 16, marginBottom: 24, borderWidth: 1, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  divider: { height: 1, marginLeft: 64 },

  rowBase:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: "500" },

  colorPickerWrap: { paddingBottom: 16 },
  colorSwatchRow:  { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  swatch:          { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  swatchSelected:  {
    borderWidth: 3, borderColor: "#FFFFFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },

  versionText: { textAlign: "center", fontSize: 12, marginTop: 8 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard:    { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 48 },
  modalTitle:   { fontSize: 22, fontWeight: "800", marginBottom: 20 },

  input: { height: 54, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  pwRow: { flexDirection: "row", alignItems: "center", height: 54, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, gap: 8 },
  pwInput: { flex: 1, fontSize: 16 },

  modalActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  cancelBtn:    { flex: 1, height: 54, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontSize: 16, fontWeight: "600" },
  saveBtn: {
    flex: 1, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
