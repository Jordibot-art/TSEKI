import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { PdfExportingAnimation } from "../components/PdfExportingAnimation";
import { BondPaperSize } from "../lib/paperSheetExporter";
import { generatePrintPackage } from "../lib/printEngine";
import {
  computeAssessmentCacheKey,
  getCachedPdfUri,
  shareCachedPdfUri,
  sharePdfBytes,
  writeCachedPdf,
} from "../lib/printEngine/mobileShare";
import {
  deleteDraftQuiz,
  deletePublishedQuiz,
  enrichQuizzesWithClassrooms,
  getAllDraftQuizzes,
  getAllPublishedQuizzes,
  getDraftTimeRemaining,
  publishDraftQuiz,
  StoredQuiz,
} from "../lib/quizStore";
import { supabase } from "../supabase";

// ── Theme Constants ───────────────────────────────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";


function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Answer matching helper for Question Inspector ─────────────────────────────
function isChoiceAnswer(choice: string, answer: string, choiceIndex: number): boolean {
  if (!choice || !answer) return false;
  const cClean = choice.trim();
  const aClean = answer.trim();
  if (cClean === aClean) return true;
  if (cClean.toLowerCase() === aClean.toLowerCase()) return true;

  const stripFormatting = (str: string) =>
    str
      .replace(/^['"`(]+|['"`) .]+$/g, "")
      .replace(/['"`*_]/g, "")
      .trim();

  const cNorm = stripFormatting(cClean).toLowerCase();
  const aNorm = stripFormatting(aClean).toLowerCase();
  if (cNorm === aNorm) return true;

  const optionLetter = String.fromCharCode(65 + choiceIndex);
  const letterMatch = aNorm.match(/^(?:option\s+)?([a-d])(?:\)|\.|\:|$)/i);
  if (letterMatch && letterMatch[1].toUpperCase() === optionLetter) {
    return true;
  }

  const stripPrefix = (str: string) =>
    str.replace(/^(?:[a-d]\s*[\)\.\:\-]|option\s+[a-d][\:\.]?)\s*/i, "").trim();

  const cStripped = stripFormatting(stripPrefix(cClean)).toLowerCase();
  const aStripped = stripFormatting(stripPrefix(aClean)).toLowerCase();

  if (cStripped.length > 0 && cStripped === aStripped) return true;
  if (cStripped.length > 1 && aStripped.length > 1) {
    if (aStripped.includes(cStripped) || cStripped.includes(aStripped)) {
      return true;
    }
  }
  return false;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── User info ──────────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("T");
  const [loadingUser, setLoadingUser] = useState(true);

  // ── Appearance (from global context — persisted via AsyncStorage) ───────────
  const { darkMode, themeColor, setDarkMode } = useTheme();

  // ── Edit Name modal ────────────────────────────────────────────────────────
  const [editVisible, setEditVisible] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  // ── Change Password modal ──────────────────────────────────────────────────
  const [pwVisible, setPwVisible] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [newPwFocused, setNewPwFocused] = useState(false);
  const [confirmPwFocused, setConfirmPwFocused] = useState(false);

  // ── Assessments State (Drafts & Archive) ───────────────────────────────────
  const [drafts, setDrafts] = useState<StoredQuiz[]>([]);
  const [archived, setArchived] = useState<StoredQuiz[]>([]);
  const [loadingAssessments, setLoadingAssessments] = useState(false);
  const [assessmentModalVisible, setAssessmentModalVisible] = useState(false);
  const [assessmentTab, setAssessmentTab] = useState<"DRAFT" | "ARCHIVE">("DRAFT");
  const [inspectedQuiz, setInspectedQuiz] = useState<StoredQuiz | null>(null);
  const [inspectModalVisible, setInspectModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedExportQuiz, setSelectedExportQuiz] = useState<StoredQuiz | null>(null);
  const [exportVersion, setExportVersion] = useState<"A" | "B" | "C">("A");
  const [forceSeparateMode, setForceSeparateMode] = useState(false);
  const [exportingStage, setExportingStage] = useState<string>("");
  const [exportingTarget, setExportingTarget] = useState<"short" | "long" | "key" | null>(null);

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

  // ── Load assessments (Drafts & Archive) ────────────────────────────────────
  const loadAssessments = useCallback(async () => {
    setLoadingAssessments(true);
    try {
      const [allDrafts, allPub] = await Promise.all([
        getAllDraftQuizzes(),
        getAllPublishedQuizzes(),
      ]);
      const [enrichedDrafts, enrichedPub] = await Promise.all([
        enrichQuizzesWithClassrooms(allDrafts),
        enrichQuizzesWithClassrooms(allPub),
      ]);
      setDrafts(enrichedDrafts);
      setArchived(enrichedPub);
    } catch (err) {
      console.error("Failed to load assessments in settings:", err);
    } finally {
      setLoadingAssessments(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAssessments();
    }, [loadAssessments])
  );

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
          await AsyncStorage.removeItem("tseki_remember_me");
          await supabase.auth.signOut();
          router.replace("/");
        },
      },
    ]);
  }

  // ── Publish Draft ──────────────────────────────────────────────────────────
  function handlePublishDraft(draft: StoredQuiz) {
    Alert.alert(
      "Publish Assessment",
      `Publish "${draft.quizTitle}" to ${draft.classTitle || "Classroom"}?\n\nIt will be moved to Archive and immediately accessible for camera grading in the Grader tab.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Publish Now",
          onPress: async () => {
            try {
              const published = await publishDraftQuiz(draft.classroomId, draft.id);
              if (published) {
                Alert.alert(
                  "Published!",
                  `"${draft.quizTitle}" has been published to ${draft.classTitle || "Classroom"} and is now in Archive.`
                );
                await loadAssessments();
                setAssessmentTab("ARCHIVE");
                if (inspectedQuiz?.id === draft.id) {
                  setInspectedQuiz(published);
                }
              }
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to publish draft.");
            }
          },
        },
      ]
    );
  }

  // ── Delete Draft ───────────────────────────────────────────────────────────
  function handleDeleteDraft(draft: StoredQuiz) {
    Alert.alert(
      "Delete Draft",
      `Are you sure you want to delete "${draft.quizTitle}" from your drafts? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteDraftQuiz(draft.classroomId, draft.id);
            await loadAssessments();
            if (inspectedQuiz?.id === draft.id) {
              setInspectedQuiz(null);
              setInspectModalVisible(false);
            }
          },
        },
      ]
    );
  }

  // ── Delete Archived Quiz ───────────────────────────────────────────────────
  function handleDeleteArchive(quiz: StoredQuiz) {
    Alert.alert(
      "Delete from Archive",
      `Remove "${quiz.quizTitle}" from your published archive?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deletePublishedQuiz(quiz.classroomId, quiz.id);
            await loadAssessments();
            if (inspectedQuiz?.id === quiz.id) {
              setInspectedQuiz(null);
              setInspectModalVisible(false);
            }
          },
        },
      ]
    );
  }


  // ── Export PDF Paper Sheet ─────────────────────────────────────────────────
  async function handleExportPaper(
    quiz: StoredQuiz,
    includeKey: boolean = false,
    paperSize: BondPaperSize = "short",
    versionOverride?: "A" | "B" | "C"
  ) {
    if (exportingPdf) return;

    const activeVersion = versionOverride || exportVersion;
    const target = includeKey ? "ANSWER_KEY_ONLY" : "STUDENT_ONLY";
    const targetType: "short" | "long" | "key" = includeKey ? "key" : paperSize;
    setExportingTarget(targetType);

    const cacheKey = computeAssessmentCacheKey(
      quiz,
      {
        paperSize,
        version: activeVersion,
        target,
        forceSeparate: forceSeparateMode,
      },
      includeKey ? "key" : "student"
    );

    const safeTitle = (quiz.quizTitle || "Assessment").replace(/[^a-zA-Z0-9]/g, "_");
    const suggestedFileName = includeKey
      ? `${safeTitle}_Answer_Key_Set_${activeVersion}.pdf`
      : `${safeTitle}_Set_${activeVersion}_${paperSize.toUpperCase()}.pdf`;
    const dialogTitle = includeKey
      ? `${quiz.quizTitle} — Teacher Answer Key (Set ${activeVersion})`
      : `${quiz.quizTitle} — Student Paper (Set ${activeVersion})`;

    // Dismiss export options sheet immediately
    setExportModalVisible(false);
    setExportingStage(
      includeKey
        ? `Preparing Teacher Answer Key for Set ${activeVersion}...`
        : `Formatting Set ${activeVersion} (${paperSize === "long" ? "Long Bond" : "Short Bond"})...`
    );
    setExportingPdf(true);

    try {
      // 1. Instant check in cache
      const cachedUri = await getCachedPdfUri(cacheKey);
      if (cachedUri) {
        setExportingStage(`Loading cached Set ${activeVersion} PDF...`);
        await new Promise((r) => setTimeout(r, 600));
        setExportModalVisible(false);
        setExportingPdf(false);
        setExportingTarget(null);
        await new Promise((r) => setTimeout(r, 120));
        await shareCachedPdfUri(cachedUri, dialogTitle, suggestedFileName).catch(console.warn);
        return;
      }

      // 2. Uncached build fallback
      setExportingStage(`Rendering scannable test sheet for Set ${activeVersion}...`);
      await new Promise((r) => setTimeout(r, 80)); // Yield to let React Native render loading overlay
      const printPkg = await generatePrintPackage(quiz, {
        paperSize,
        version: activeVersion,
        classTitle: quiz.classTitle || "Classroom Assessment",
        subject: quiz.subject || "General Subject",
        gradeLevel: quiz.gradeLevel,
        forceSeparate: forceSeparateMode,
        quizId: quiz.id || `QZ-${Date.now().toString().slice(-6)}`,
        target,
      });

      const bytesToExport = includeKey
        ? printPkg.answerKeyPdf
        : (printPkg.combinedStudentPdf || printPkg.studentPdf);

      if (!bytesToExport || bytesToExport.length === 0) {
        throw new Error("Generated PDF has no content.");
      }

      setExportingStage("Ready! Preparing share options...");
      const fileUri = await writeCachedPdf(cacheKey, bytesToExport);
      const shareUri = await writeCachedPdf(suggestedFileName, bytesToExport);

      await new Promise((r) => setTimeout(r, 250));
      setExportModalVisible(false);
      setExportingPdf(false);
      setExportingTarget(null);

      await new Promise((r) => setTimeout(r, 120));
      await shareCachedPdfUri(
        shareUri || fileUri,
        dialogTitle,
        suggestedFileName
      );
    } catch (err: any) {
      setExportingPdf(false);
      setExportingTarget(null);
      Alert.alert("Export Error", err.message || "Failed to export PDF test paper.");
    } finally {
      setExportingPdf(false);
      setExportingTarget(null);
      setExportingStage("");
    }
  }


  // ── Dynamic colors ─────────────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#F9FAFB";
  const card = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#E5E7EB";
  const inputBg = darkMode ? "#374151" : "#F9FAFB";
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
      <View style={[styles.header, { backgroundColor: card, borderBottomColor: darkMode ? border : "#F3F4F6" }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <View style={[styles.backIconCircle, { backgroundColor: darkMode ? "#374151" : ORANGE_LIGHT }]}>
            <Ionicons name="chevron-back" size={18} color={ORANGE} />
          </View>
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
        <View style={[styles.profileCard, { backgroundColor: card, borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
          <View style={[styles.avatarCircle, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
            <Text style={[styles.avatarText, { color: darkMode ? "#F8FAFC" : "#334155" }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.profileName, { color: textMain }]} numberOfLines={1}>{fullName || "Teacher"}</Text>
              <Ionicons name="checkmark-circle" size={15} color="#0D9488" />
            </View>
            <Text
              style={[styles.profileEmail, { color: "#64748B" }]}
              numberOfLines={1}
            >
              {email}
            </Text>
          </View>
        </View>

        {/* ── Account ── */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <SettingsRow
            icon="person-outline"
            label="Edit Display Name"
            textMain={textMain}
            textSub={textSub}
            iconColor={darkMode ? "#94A3B8" : "#475569"}
            onPress={() => { setDraftName(fullName); setEditVisible(true); }}
          />
          <View style={[styles.divider, { backgroundColor: border }]} />
          <SettingsRow
            icon="lock-closed-outline"
            label="Change Password"
            textMain={textMain}
            textSub={textSub}
            iconColor={darkMode ? "#94A3B8" : "#475569"}
            onPress={() => { setNewPw(""); setConfirmPw(""); setPwVisible(true); }}
          />
        </View>

        {/* ── Assessments (Drafts & Archive) ── */}
        <Text style={styles.sectionLabel}>Assessments</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {/* Draft Assessments */}
          <TouchableOpacity
            style={styles.rowBase}
            activeOpacity={0.7}
            onPress={() => {
              setAssessmentTab("DRAFT");
              setAssessmentModalVisible(true);
            }}
          >
            <Ionicons name="document-text-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textMain }]}>Draft Assessments</Text>
              <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} saved
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={textSub} />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: border }]} />

          {/* Archive / Published Assessments */}
          <TouchableOpacity
            style={styles.rowBase}
            activeOpacity={0.7}
            onPress={() => {
              setAssessmentTab("ARCHIVE");
              setAssessmentModalVisible(true);
            }}
          >
            <Ionicons name="archive-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textMain }]}>Archive</Text>
              <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                {archived.length} published {archived.length === 1 ? "assessment" : "assessments"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={textSub} />
          </TouchableOpacity>
        </View>

        {/* ── Appearance ── */}
        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {/* Dark Mode */}
          <TouchableOpacity
            style={styles.rowBase}
            activeOpacity={0.8}
            onPress={() => setDarkMode(!darkMode)}
          >
            <Ionicons name="moon-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
            <Text style={[styles.rowLabel, { color: textMain }]}>Dark Mode</Text>
            <View
              style={[
                styles.customSwitchTrack,
                {
                  backgroundColor: darkMode ? themeColor : "#CBD5E1",
                  alignItems: darkMode ? "flex-end" : "flex-start",
                },
              ]}
            >
              <View style={styles.customSwitchThumb} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Session ── */}
        <Text style={styles.sectionLabel}>Session</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <TouchableOpacity style={styles.rowBase} onPress={handleLogout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={18} color="#EF4444" />
            <Text style={[styles.rowLabel, { color: "#EF4444", fontWeight: "600" }]}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.versionText, { color: textSub }]}>Tseki v1.0.0</Text>
      </ScrollView>

      {/* ── Edit Name Modal ── */}
      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setEditVisible(false)}
      >
        <View style={styles.modalBackdropContainer}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setEditVisible(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalSheetKeyboardWrap}
          >
            <View
              style={[
                styles.bottomSheet,
                {
                  backgroundColor: card,
                  paddingBottom: Math.max(insets.bottom, 16) + 16,
                },
              ]}
            >
              {/* Centered Drag Pill */}
              <View style={[styles.dragPill, { backgroundColor: darkMode ? "#475569" : "#CBD5E1" }]} />

              {/* Sheet Header */}
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: textMain }]}>Edit display name</Text>
                <TouchableOpacity
                  style={[styles.closeIconBtn, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}
                  onPress={() => setEditVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={18} color={darkMode ? "#94A3B8" : "#64748B"} />
                </TouchableOpacity>
              </View>

              {/* Form Content */}
              <Text style={[styles.inputLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                Display name
              </Text>
              <TextInput
                style={[
                  styles.formInput,
                  {
                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                    color: textMain,
                    borderColor: nameFocused ? "#EA580C" : (darkMode ? "#334155" : "#CBD5E1"),
                  },
                ]}
                placeholder="Your full name"
                placeholderTextColor={textSub}
                value={draftName}
                onChangeText={setDraftName}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                autoFocus
              />

              {/* Compact Modal Footer Buttons */}
              <View style={styles.modalFooterActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtnCompact,
                    {
                      backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                      borderColor: darkMode ? "#334155" : "#CBD5E1",
                    },
                  ]}
                  onPress={() => setEditVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cancelBtnTextCompact, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.saveBtnCompact,
                    {
                      backgroundColor: "#EA580C",
                      opacity: (!draftName.trim() || savingName) ? 0.6 : 1,
                    },
                  ]}
                  onPress={handleSaveName}
                  disabled={!draftName.trim() || savingName}
                  activeOpacity={0.8}
                >
                  {savingName ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnTextCompact}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Change Password Modal ── */}
      <Modal
        visible={pwVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setPwVisible(false)}
      >
        <View style={styles.modalBackdropContainer}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setPwVisible(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalSheetKeyboardWrap}
          >
            <View
              style={[
                styles.bottomSheet,
                {
                  backgroundColor: card,
                  paddingBottom: Math.max(insets.bottom, 16) + 16,
                },
              ]}
            >
              {/* Centered Drag Pill */}
              <View style={[styles.dragPill, { backgroundColor: darkMode ? "#475569" : "#CBD5E1" }]} />

              {/* Sheet Header */}
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: textMain }]}>Change password</Text>
                <TouchableOpacity
                  style={[styles.closeIconBtn, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}
                  onPress={() => setPwVisible(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={18} color={darkMode ? "#94A3B8" : "#64748B"} />
                </TouchableOpacity>
              </View>

              {/* New Password */}
              <Text style={[styles.inputLabel, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                New password
              </Text>
              <View
                style={[
                  styles.formPwRow,
                  {
                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                    borderColor: newPwFocused ? "#EA580C" : (darkMode ? "#334155" : "#CBD5E1"),
                  },
                ]}
              >
                <TextInput
                  style={[styles.formPwInput, { color: textMain }]}
                  placeholder="At least 6 characters"
                  placeholderTextColor={textSub}
                  secureTextEntry={!showNewPw}
                  value={newPw}
                  onChangeText={setNewPw}
                  onFocus={() => setNewPwFocused(true)}
                  onBlur={() => setNewPwFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => setShowNewPw(!showNewPw)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showNewPw ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>
              </View>

              {/* Confirm Password */}
              <Text style={[styles.inputLabel, { color: darkMode ? "#CBD5E1" : "#334155", marginTop: 14 }]}>
                Confirm new password
              </Text>
              <View
                style={[
                  styles.formPwRow,
                  {
                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                    borderColor: confirmPwFocused ? "#EA580C" : (darkMode ? "#334155" : "#CBD5E1"),
                  },
                ]}
              >
                <TextInput
                  style={[styles.formPwInput, { color: textMain }]}
                  placeholder="Repeat new password"
                  placeholderTextColor={textSub}
                  secureTextEntry={!showConfirmPw}
                  value={confirmPw}
                  onChangeText={setConfirmPw}
                  onFocus={() => setConfirmPwFocused(true)}
                  onBlur={() => setConfirmPwFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPw(!showConfirmPw)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showConfirmPw ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>
              </View>

              {/* Compact Modal Footer Buttons */}
              <View style={styles.modalFooterActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtnCompact,
                    {
                      backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                      borderColor: darkMode ? "#334155" : "#CBD5E1",
                    },
                  ]}
                  onPress={() => setPwVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.cancelBtnTextCompact, { color: darkMode ? "#CBD5E1" : "#334155" }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.saveBtnCompact,
                    {
                      backgroundColor: "#EA580C",
                      opacity: (!newPw || !confirmPw || savingPw) ? 0.6 : 1,
                    },
                  ]}
                  onPress={handleChangePassword}
                  disabled={!newPw || !confirmPw || savingPw}
                  activeOpacity={0.8}
                >
                  {savingPw ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnTextCompact}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Assessments Hub Modal (Drafts & Archive) ── */}
      <Modal
        visible={assessmentModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAssessmentModalVisible(false)}
      >
        <View style={[styles.hubContainer, { backgroundColor: bg }]}>
          {/* Hub Header */}
          <View style={[styles.hubHeader, { backgroundColor: card, borderBottomColor: border }]}>
            <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
              <Text style={[styles.hubHeaderTitle, { color: textMain }]}>Assessments Repository</Text>
              <Text style={[styles.hubHeaderSub, { color: textSub }]}>
                Manage your saved drafts and published classroom archives
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.hubCloseBtn, { backgroundColor: border }]}
              onPress={() => setAssessmentModalVisible(false)}
              accessibilityLabel="Close repository"
            >
              <Ionicons name="close" size={20} color={textMain} />
            </TouchableOpacity>
          </View>

          {/* Segmented Switcher */}
          <View style={[styles.tabSegmentWrap, { backgroundColor: darkMode ? "#1F2937" : "#F3F4F6" }]}>
            <TouchableOpacity
              style={[
                styles.tabSegmentBtn,
                assessmentTab === "DRAFT" && [
                  styles.tabSegmentBtnActive,
                  { backgroundColor: card },
                ],
              ]}
              onPress={() => setAssessmentTab("DRAFT")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabSegmentText,
                  { color: assessmentTab === "DRAFT" ? textMain : textSub },
                  assessmentTab === "DRAFT" && { fontWeight: "700" },
                ]}
              >
                Drafts
              </Text>
              <View
                style={[
                  styles.segmentCountPill,
                  {
                    backgroundColor:
                      assessmentTab === "DRAFT"
                        ? darkMode ? "#374151" : "#F3F4F6"
                        : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentCountText,
                    { color: assessmentTab === "DRAFT" ? textMain : textSub },
                  ]}
                >
                  {drafts.length}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabSegmentBtn,
                assessmentTab === "ARCHIVE" && [
                  styles.tabSegmentBtnActive,
                  { backgroundColor: card },
                ],
              ]}
              onPress={() => setAssessmentTab("ARCHIVE")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabSegmentText,
                  { color: assessmentTab === "ARCHIVE" ? textMain : textSub },
                  assessmentTab === "ARCHIVE" && { fontWeight: "700" },
                ]}
              >
                Archive
              </Text>
              <View
                style={[
                  styles.segmentCountPill,
                  {
                    backgroundColor:
                      assessmentTab === "ARCHIVE"
                        ? darkMode ? "#374151" : "#F3F4F6"
                        : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segmentCountText,
                    { color: assessmentTab === "ARCHIVE" ? textMain : textSub },
                  ]}
                >
                  {archived.length}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* List Content */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.hubScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {loadingAssessments ? (
              <View style={styles.hubEmptyWrap}>
                <ActivityIndicator size="large" color={themeColor} />
                <Text style={[styles.hubEmptySub, { color: textSub, marginTop: 12 }]}>Loading assessments...</Text>
              </View>
            ) : assessmentTab === "DRAFT" ? (
              // ── Drafts List ──
              drafts.length === 0 ? (
                <View style={styles.hubEmptyWrap}>
                  <View style={[styles.emptyIconWrap, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}>
                    <Ionicons name="document-text-outline" size={28} color={textSub} />
                  </View>
                  <Text style={[styles.hubEmptyTitle, { color: textMain }]}>No Draft Assessments</Text>
                  <Text style={[styles.hubEmptySub, { color: textSub }]}>
                    {"Drafts are stored locally on this device for 7 days. Create a quiz in the AI Builder and select 'Save as Draft' to access it here."}
                  </Text>
                </View>
              ) : (
                drafts.map((draft) => {
                  const formattedDate = new Date(draft.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const timeInfo = getDraftTimeRemaining(draft);

                  return (
                    <View key={draft.id} style={[styles.assessmentCard, { backgroundColor: card, borderColor: border }]}>
                      <View style={styles.cardTopRow}>
                        <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                          <Text style={[styles.quizTitle, { color: textMain }]} numberOfLines={2}>
                            {draft.quizTitle}
                          </Text>
                          <View style={styles.classroomBadgeRow}>
                            <Ionicons name="school-outline" size={13} color={themeColor} />
                            <Text style={[styles.classroomBadgeText, { color: themeColor }]} numberOfLines={1}>
                              {draft.classTitle || "Classroom"}
                            </Text>
                            <Text style={[styles.metaDotSeparator, { color: textSub }]}>·</Text>
                            <Text style={[styles.dateText, { color: textSub }]}>{formattedDate}</Text>
                          </View>
                        </View>
                        <View
                          style={[
                            styles.draftTimerBadge,
                            timeInfo.isExpiringSoon && styles.draftTimerExpiringBadge,
                          ]}
                        >
                          <Ionicons
                            name="time-outline"
                            size={11}
                            color={timeInfo.isExpiringSoon ? "#DC2626" : "#B45309"}
                          />
                          <Text
                            style={[
                              styles.draftTimerText,
                              timeInfo.isExpiringSoon && styles.draftTimerExpiringText,
                            ]}
                          >
                            {timeInfo.text}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardMetaRow}>
                        <Text style={[styles.metaPillText, { color: textSub }]}>
                          {draft.questions.length} Questions · {draft.difficulty || "Standard"} · {draft.questionType || "Mixed"}
                        </Text>
                      </View>

                      <View style={[styles.cardActionsDivider, { backgroundColor: border }]} />

                      <View style={styles.cardActionsRow}>
                        <TouchableOpacity
                          style={[styles.inspectBtn, { borderColor: border }]}
                          onPress={() => {
                            setInspectedQuiz(draft);
                            setInspectModalVisible(true);
                          }}
                        >
                          <Ionicons name="eye-outline" size={15} color={textMain} />
                          <Text style={[styles.inspectBtnText, { color: textMain }]} numberOfLines={1}>Inspect</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionPublishBtn, { backgroundColor: themeColor }]}
                          onPress={() => handlePublishDraft(draft)}
                        >
                          <Ionicons name="send-outline" size={15} color="#FFFFFF" />
                          <Text style={styles.actionPublishText} numberOfLines={1}>Publish</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.deleteBtn, { borderColor: "#FEE2E2" }]}
                          onPress={() => handleDeleteDraft(draft)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )
            ) : (
              // ── Archive List ──
              archived.length === 0 ? (
                <View style={styles.hubEmptyWrap}>
                  <View style={[styles.emptyIconWrap, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}>
                    <Ionicons name="archive-outline" size={28} color={textSub} />
                  </View>
                  <Text style={[styles.hubEmptyTitle, { color: textMain }]}>No Archived Assessments</Text>
                  <Text style={[styles.hubEmptySub, { color: textSub }]}>
                    Assessments published to your classrooms are saved in your cloud archive and accessible across all your devices.
                  </Text>
                </View>
              ) : (
                archived.map((quiz) => {
                  const formattedDate = new Date(quiz.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });

                  return (
                    <View key={quiz.id} style={[styles.assessmentCard, { backgroundColor: card, borderColor: border }]}>
                      <View style={styles.cardTopRow}>
                        <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                          <Text style={[styles.quizTitle, { color: textMain }]} numberOfLines={2}>
                            {quiz.quizTitle}
                          </Text>
                          <View style={styles.classroomBadgeRow}>
                            <Ionicons name="school-outline" size={13} color="#2563EB" />
                            <Text style={[styles.classroomBadgeText, { color: "#2563EB" }]} numberOfLines={1}>
                              {quiz.classTitle || "Classroom"}
                            </Text>
                            <Text style={[styles.metaDotSeparator, { color: textSub }]}>·</Text>
                            <Text style={[styles.dateText, { color: textSub }]}>{formattedDate}</Text>
                          </View>
                        </View>
                        <View style={styles.cloudIconWrap} accessibilityLabel="Synced to cloud">
                          <Ionicons name="cloud-done-outline" size={17} color="#059669" />
                        </View>
                      </View>

                      <View style={styles.cardMetaRow}>
                        <Text style={[styles.metaPillText, { color: textSub }]}>
                          {quiz.questions.length} Questions · {quiz.difficulty || "Standard"} · DepEd Scannable
                        </Text>
                      </View>

                      <View style={[styles.cardActionsDivider, { backgroundColor: border }]} />

                      <View style={styles.cardActionsRow}>
                        <TouchableOpacity
                          style={[styles.inspectBtn, { borderColor: border }]}
                          onPress={() => {
                            setInspectedQuiz(quiz);
                            setInspectModalVisible(true);
                          }}
                        >
                          <Ionicons name="eye-outline" size={15} color={textMain} />
                          <Text style={[styles.inspectBtnText, { color: textMain }]} numberOfLines={1}>Inspect</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.exportPdfBtn, { backgroundColor: "#1E293B" }]}
                          onPress={() => {
                            setSelectedExportQuiz(quiz);
                            setExportModalVisible(true);
                          }}
                        >
                          <Ionicons name="print-outline" size={15} color="#FFFFFF" />
                          <Text style={styles.exportPdfText} numberOfLines={1}>Export PDF</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.deleteBtn, { borderColor: "#FEE2E2" }]}
                          onPress={() => handleDeleteArchive(quiz)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )
            )}
          </ScrollView>

          {/* In-Repository Export Loading Overlay (guaranteed visible on top of archive cards) */}
          {exportingPdf && !exportModalVisible && (
            <View style={styles.loadingOverlay}>
              <View style={[styles.loadingCard, { backgroundColor: darkMode ? card : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
                <PdfExportingAnimation
                  exportVersion={exportVersion}
                  quizTitle={selectedExportQuiz?.quizTitle || "Assessment"}
                  accentColor={themeColor || "#EA580C"}
                  darkMode={darkMode}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Question Inspector Modal ── */}
      <Modal
        visible={inspectModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInspectModalVisible(false)}
      >
        <View style={[styles.hubContainer, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={[styles.hubHeader, { backgroundColor: card, borderBottomColor: border }]}>
            <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <Text style={[styles.hubHeaderTitle, { color: textMain }]} numberOfLines={1}>
                  {inspectedQuiz?.quizTitle}
                </Text>
                {inspectedQuiz?.status === "DRAFT" ? (
                  <View style={[styles.draftBadge, { flexShrink: 0 }]}><Text style={styles.draftBadgeText}>DRAFT</Text></View>
                ) : (
                  <View style={[styles.archiveBadge, { flexShrink: 0 }]}><Text style={styles.archiveBadgeText}>ARCHIVE</Text></View>
                )}
              </View>
              <Text style={[styles.hubHeaderSub, { color: textSub }]} numberOfLines={1}>
                {inspectedQuiz?.classTitle || "Classroom"} • {inspectedQuiz?.questions.length} Questions • {inspectedQuiz?.difficulty || "Standard"}
              </Text>
            </View>

            <View style={styles.hubHeaderRightActions}>
              <TouchableOpacity
                style={[styles.hubCloseBtn, { backgroundColor: border }]}
                onPress={() => setInspectModalVisible(false)}
                accessibilityLabel="Close inspector"
              >
                <Ionicons name="close" size={20} color={textMain} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Scrollable Questions list */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.hubScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {inspectedQuiz?.questions.map((q) => {
              const answerObj = inspectedQuiz.answerKey.find((k) => k.questionNumber === q.questionNumber);
              const correctAnswer = answerObj ? answerObj.correctAnswer : "";
              const points = answerObj ? answerObj.points : 1;
              const typeLabel = q.type.replace(/_/g, " ").toUpperCase();

              return (
                <View key={q.questionNumber} style={[styles.inspectQuestionCard, { backgroundColor: card, borderColor: border }]}>
                  <View style={styles.inspectQuestionHeader}>
                    <View style={[styles.questionNumberBubble, { backgroundColor: themeColor }]}>
                      <Text style={styles.questionNumberText}>{q.questionNumber}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <View style={styles.qTypePill}>
                          <Text style={styles.qTypePillText}>{typeLabel}</Text>
                        </View>
                        <View style={styles.boxesPill}>
                          <Text style={styles.boxesPillText}>
                            {q.answerBoxesRequired} {q.answerBoxesRequired > 1 ? "BOXES" : "BOX"}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.inspectQuestionText, { color: textMain }]}>{q.questionText}</Text>
                    </View>
                  </View>

                  {/* Options */}
                  {q.options && q.options.length > 0 && (
                    <View style={styles.optionsWrap}>
                      {q.options.map((opt, cIdx) => {
                        const isCorrect = isChoiceAnswer(opt, correctAnswer, cIdx);
                        return (
                          <View
                            key={`${opt}_${cIdx}`}
                            style={[
                              styles.choiceRow,
                              { borderColor: border, backgroundColor: isCorrect ? themeColor + "14" : inputBg },
                              isCorrect && { borderColor: themeColor },
                            ]}
                          >
                            <Text
                              style={[
                                styles.choiceRowText,
                                { color: isCorrect ? themeColor : textMain },
                                isCorrect && { fontWeight: "700" },
                              ]}
                            >
                              {opt}
                            </Text>
                            {isCorrect && (
                              <Ionicons name="checkmark-circle" size={16} color={themeColor} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Answer Key Box */}
                  <View style={[styles.answerKeyBox, { borderLeftColor: themeColor, backgroundColor: themeColor + "10" }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={[styles.answerKeyLabel, { color: themeColor }]}>OFFICIAL ANSWER KEY</Text>
                      <Text style={[styles.answerKeyPoints, { color: themeColor }]}>+{points} pt{points > 1 ? "s" : ""}</Text>
                    </View>
                    <Text style={[styles.answerKeyValue, { color: themeColor }]}>{correctAnswer}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Footer Actions */}
          <View style={[styles.inspectFooter, { backgroundColor: card, borderTopColor: border }]}>
            {inspectedQuiz?.status === "DRAFT" ? (
              <TouchableOpacity
                style={[styles.inspectFooterPublishBtn, { backgroundColor: themeColor }]}
                onPress={() => {
                  if (inspectedQuiz) {
                    handlePublishDraft(inspectedQuiz);
                  }
                }}
              >
                <Ionicons name="send-outline" size={16} color="#FFFFFF" />
                <Text style={styles.inspectFooterPublishText}>Publish Quiz to Classroom</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.inspectFooterExportBtn, { backgroundColor: themeColor }]}
                onPress={() => {
                  if (inspectedQuiz) {
                    setSelectedExportQuiz(inspectedQuiz);
                    setExportModalVisible(true);
                  }
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="print-outline" size={16} color="#FFFFFF" />
                <Text style={styles.inspectFooterExportText}>Export / Print PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Inspector Export Loading Overlay */}
          {exportingPdf && !exportModalVisible && (
            <View style={styles.loadingOverlay}>
              <View style={[styles.loadingCard, { backgroundColor: darkMode ? card : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
                <PdfExportingAnimation
                  exportVersion={exportVersion}
                  quizTitle={selectedExportQuiz?.quizTitle || "Assessment"}
                  accentColor={themeColor || "#EA580C"}
                  darkMode={darkMode}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Export Paper Sheet Modal ── */}
      <Modal
        visible={exportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!exportingPdf) setExportModalVisible(false);
        }}
      >
        <TouchableOpacity
          style={styles.exportBackdrop}
          activeOpacity={1}
          onPress={() => {
            if (!exportingPdf) setExportModalVisible(false);
          }}
        >
          <Pressable
            style={[styles.exportSheet, { backgroundColor: card }]}
            onPress={(e) => {
              e.stopPropagation?.();
            }}
          >
            <View style={styles.exportSheetHeader}>
              <Text style={[styles.exportSheetTitle, { color: textMain }]}>Export Paper Sheet Layout</Text>
              <Text style={[styles.exportSheetSub, { color: textSub }]}>
                Download, print, or share the physical test sheet formatted with scannable answer boxes.
              </Text>
            </View>

                {/* Anti-Cheating Version Selector (Set A / B / C) */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: textMain }}>TEST VERSION (SET):</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["A", "B", "C"] as const).map((ver) => (
                      <TouchableOpacity
                        key={ver}
                        onPress={() => setExportVersion(ver)}
                        activeOpacity={0.7}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 6,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: exportVersion === ver ? themeColor : border,
                          backgroundColor: exportVersion === ver ? themeColor + "18" : inputBg,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: "700",
                            color: exportVersion === ver ? themeColor : textMain,
                          }}
                        >
                          Set {ver}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Force Separate Answer Sheet Toggle */}
                <TouchableOpacity
                  onPress={() => setForceSeparateMode((prev) => !prev)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: inputBg,
                    borderWidth: 1,
                    borderColor: border,
                    marginBottom: 12,
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: "600", color: textMain, flex: 1 }}>
                    Always use separate Question Booklet + Answer Sheet
                  </Text>
                  <Ionicons
                    name={forceSeparateMode ? "checkbox" : "square-outline"}
                    size={20}
                    color={forceSeparateMode ? themeColor : textSub}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportOptionBtn, { borderColor: border }]}
                  onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, false, "short")}
                  activeOpacity={0.7}
                  disabled={exportingPdf}
                >
                  <View style={[styles.exportOptionIcon, { backgroundColor: (themeColor || "#2563EB") + "18" }]}>
                    <Ionicons name="document-text" size={22} color={themeColor || "#2563EB"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionTitle, { color: textMain }]}>{'Short Bond Paper (8.5" × 11")'}</Text>
                    <Text style={[styles.exportOptionSub, { color: textSub }]}>
                      {`1 single sheet (Letter size) • Set ${exportVersion} scannable layout for 1-shot camera scanning`}
                    </Text>
                  </View>
                  <Ionicons name="download-outline" size={20} color="#6B7280" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportOptionBtn, { borderColor: border }]}
                  onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, false, "long")}
                  activeOpacity={0.7}
                  disabled={exportingPdf}
                >
                  <View style={[styles.exportOptionIcon, { backgroundColor: "#8B5CF618" }]}>
                    <Ionicons name="document-outline" size={22} color="#8B5CF6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionTitle, { color: textMain }]}>{'Long Bond Paper (8.5" × 13")'}</Text>
                    <Text style={[styles.exportOptionSub, { color: textSub }]}>
                      {`1 single sheet (Philippine Folio) • Fits all questions with Set ${exportVersion} spacing`}
                    </Text>
                  </View>
                  <Ionicons name="download-outline" size={20} color="#6B7280" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportOptionBtn, { borderColor: border }]}
                  onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, true, "short")}
                  activeOpacity={0.7}
                  disabled={exportingPdf}
                >
                  <View style={[styles.exportOptionIcon, { backgroundColor: "#10B98118" }]}>
                    <Ionicons name="checkmark-done-circle" size={22} color="#10B981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionTitle, { color: textMain }]}>Teacher Answer Key Paper (PDF)</Text>
                    <Text style={[styles.exportOptionSub, { color: textSub }]}>
                      {`1 single sheet with correct answers pre-printed in boxes for Set ${exportVersion}`}
                    </Text>
                  </View>
                  <Ionicons name="download-outline" size={20} color="#6B7280" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportCancelBtn, { borderColor: border }]}
                  onPress={() => setExportModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.exportCancelText, { color: textSub }]}>Cancel</Text>
                </TouchableOpacity>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* ── PDF Exporting Progress Overlay (shown during PDF generation) ── */}
      <Modal
        visible={exportingPdf}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { }}
      >
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: darkMode ? card : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
            <PdfExportingAnimation
              exportVersion={exportVersion}
              quizTitle={selectedExportQuiz?.quizTitle || "Assessment"}
              accentColor={themeColor || "#EA580C"}
              darkMode={darkMode}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Reusable row ──────────────────────────────────────────────────────────────
function SettingsRow({
  icon, label, onPress, textMain, textSub, iconColor,
}: {
  icon: any; label: string; onPress: () => void;
  textMain: string; textSub: string; iconColor: string;
}) {
  return (
    <TouchableOpacity style={styles.rowBase} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text style={[styles.rowLabel, { color: textMain }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={textSub} />
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },

  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  profileCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 16,
    padding: 16, marginBottom: 24, gap: 14, borderWidth: 1,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 15, fontWeight: "600", color: "#334155" },
  profileName: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 2 },
  profileEmail: { fontSize: 13, color: "#64748B" },

  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#64748B", marginBottom: 8, marginLeft: 4 },

  card: {
    borderRadius: 14, marginBottom: 22, borderWidth: 1, overflow: "hidden",
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  divider: { height: 1, marginLeft: 46 },

  rowBase: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  customSwitchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  customSwitchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },

  /* Badges */
  draftBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  draftBadgeText: {
    color: "#B45309",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  archiveBadge: {
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  archiveBadgeText: {
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  draftTimerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  draftTimerExpiringBadge: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FECACA",
  },
  draftTimerText: {
    color: "#B45309",
    fontSize: 10,
    fontWeight: "800",
  },
  draftTimerExpiringText: {
    color: "#DC2626",
  },

  cloudSyncBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  cloudSyncBadgeText: {
    color: "#047857",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  versionText: { textAlign: "center", fontSize: 12, marginTop: 8 },

  /* ── Bottom Sheet Modals ── */
  modalBackdropContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  modalSheetKeyboardWrap: {
    width: "100%",
  },
  bottomSheet: {
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 6,
  },
  formInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  formPwRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  formPwInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  modalFooterActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  cancelBtnCompact: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnTextCompact: {
    fontSize: 14,
    fontWeight: "500",
  },
  saveBtnCompact: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnTextCompact: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  /* ── Assessment Hub Modal ── */
  hubContainer: { flex: 1 },
  hubHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  hubHeaderTitle: { fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  hubHeaderSub: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  hubHeaderRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  hubCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  tabSegmentWrap: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tabSegmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  tabSegmentBtnActive: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  tabSegmentText: { fontSize: 13.5, fontWeight: "600" },
  segmentCountPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  segmentCountText: {
    fontSize: 12,
    fontWeight: "600",
  },

  hubScrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  hubEmptyWrap: { alignItems: "center", justifyContent: "center", paddingTop: 60, paddingHorizontal: 28 },
  emptyIconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  hubEmptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  hubEmptySub: { fontSize: 13.5, textAlign: "center", lineHeight: 20 },

  assessmentCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  quizTitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  classroomBadgeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap" },
  classroomBadgeText: { fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  metaDotSeparator: { fontSize: 12.5, fontWeight: "600" },
  cloudIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 10 },
  metaPillText: { fontSize: 12.5, fontWeight: "500", lineHeight: 18, flexShrink: 1 },
  dateText: { fontSize: 12.5, fontWeight: "500" },
  cardActionsDivider: { height: 1, marginVertical: 12 },
  cardActionsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inspectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  inspectBtnText: { fontSize: 13, fontWeight: "600" },
  actionPublishBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    borderRadius: 10,
    gap: 6,
  },
  actionPublishText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  exportPdfBtn: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    borderRadius: 10,
    gap: 6,
  },
  exportPdfText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", paddingHorizontal: 2 },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E222",
    flexShrink: 0,
  },

  /* ── Question Inspector ── */
  inspectQuestionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  inspectQuestionHeader: { flexDirection: "row", gap: 12, marginBottom: 12 },
  questionNumberBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  questionNumberText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  qTypePill: { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  qTypePillText: { fontSize: 10, fontWeight: "700", color: "#4B5563" },
  boxesPill: { backgroundColor: "#E5E7EB", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  boxesPillText: { fontSize: 9, fontWeight: "700", color: "#374151" },
  inspectQuestionText: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  optionsWrap: { gap: 6, marginBottom: 10 },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  choiceRowText: { fontSize: 13, flex: 1, marginRight: 8 },
  answerKeyBox: {
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  answerKeyLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  answerKeyPoints: { fontSize: 11, fontWeight: "700" },
  answerKeyValue: { fontSize: 13, fontWeight: "700", marginTop: 2 },
  inspectFooter: {
    padding: 16,
    borderTopWidth: 1,
  },
  inspectFooterPublishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    gap: 8,
  },
  inspectFooterPublishText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  inspectFooterExportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    gap: 8,
  },
  inspectFooterExportText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },

  /* ── Export Sheet Modal ── */
  sheetLoadingWrap: {
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  exportBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  exportSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "90%",
  },
  exportSheetHeader: { marginBottom: 20 },
  exportSheetTitle: { fontSize: 19, fontWeight: "800" },
  exportSheetSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  exportOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  exportOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  exportOptionTitle: { fontSize: 14, fontWeight: "700" },
  exportOptionSub: { fontSize: 11, marginTop: 2 },
  exportCancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  exportCancelText: { fontSize: 14, fontWeight: "600" },

  /* ── Full-screen Export Progress Overlay ── */
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 24, 39, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    zIndex: 9999,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 344,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 14,
  },
  loadingIconGlow: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  loadingIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  loadingTitle: {
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  loadingSub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  spinnerWrap: {
    marginVertical: 10,
    transform: [{ scale: 1.15 }],
  },
  loadingNoticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  loadingNoticeText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
});
