import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AssessmentInspectorModal } from "../components/AssessmentInspectorModal";
import { PdfExportingAnimation } from "../components/PdfExportingAnimation";
import { BondPaperSize } from "../lib/paperSheetExporter";
import {
  abortableDelay,
  generatePrintPackage,
  isExportCancelledError,
} from "../lib/printEngine";
import {
  computeAssessmentCacheKey,
  getCachedPdfUri,
  shareCachedPdfUri,
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
  saveDraftQuiz,
  StoredQuiz,
} from "../lib/quizStore";
import {
  ALERT_THRESHOLD_PRESETS,
  AlertPreferences,
  DEFAULT_ALERT_PREFERENCES,
  getAlertPreferences,
  getCriticalCutoff,
  PASSING_GRADE,
  resetAllDismissedAlerts,
  saveAlertPreferences,
} from "../lib/alertStore";
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
  const [cancellingExport, setCancellingExport] = useState(false);
  const [exportToastMessage, setExportToastMessage] = useState<string | null>(null);
  const [selectedExportQuiz, setSelectedExportQuiz] = useState<StoredQuiz | null>(null);
  const [exportVersion, setExportVersion] = useState<"A" | "B" | "C">("A");
  const [forceSeparateMode, setForceSeparateMode] = useState(false);
  const [exportingStage, setExportingStage] = useState<string>("");
  const [exportingTarget, setExportingTarget] = useState<"short" | "long" | "key" | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportRunIdRef = useRef<number>(0);
  const cancelDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showExportToast(message: string) {
    if (exportToastTimerRef.current) {
      clearTimeout(exportToastTimerRef.current);
    }
    setExportToastMessage(message);
    exportToastTimerRef.current = setTimeout(() => {
      setExportToastMessage(null);
    }, 2600);
  }

  useEffect(() => {
    return () => {
      exportRunIdRef.current += 1;
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      if (cancelDismissTimerRef.current) {
        clearTimeout(cancelDismissTimerRef.current);
      }
      if (exportToastTimerRef.current) {
        clearTimeout(exportToastTimerRef.current);
      }
    };
  }, []);

  // ── Roster Alert Preferences ───────────────────────────────────────────────
  const [alertPrefs, setAlertPrefs] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES);

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
      getAlertPreferences().then(setAlertPrefs);
    }, [loadAssessments])
  );

  async function handleUpdateAlertPrefs(partial: Partial<AlertPreferences>) {
    const updated = await saveAlertPreferences(partial);
    setAlertPrefs(updated);
  }

  function handleResetDismissedAlerts() {
    Alert.alert(
      "Restore Dismissed Alerts",
      "Any students still below your alert threshold who were previously dismissed will reappear in Roster Alerts.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: async () => {
            await resetAllDismissedAlerts();
            Alert.alert("Alerts Restored", "Dismissed roster alerts have been reset.");
          },
        },
      ]
    );
  }

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

  // ── Update / Save Draft ────────────────────────────────────────────────────
  async function handleUpdateDraft(updatedDraft: StoredQuiz) {
    setInspectedQuiz(updatedDraft);
    setDrafts((prev) => prev.map((d) => (d.id === updatedDraft.id ? updatedDraft : d)));
    await saveDraftQuiz(updatedDraft.classroomId, updatedDraft, updatedDraft.classTitle);
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
              let draftToPublish = draft;
              if (!draft.layoutJson) {
                try {
                  const printPkg = await generatePrintPackage(draft, {
                    paperSize: "short",
                    version: "A",
                    classTitle: draft.classTitle || "Classroom Assessment",
                    subject: draft.subject || "General Subject",
                    gradeLevel: draft.gradeLevel,
                    quizId: draft.id || `QZ-${Date.now().toString().slice(-6)}`,
                    target: "LAYOUT_ONLY",
                  });
                  draftToPublish = {
                    ...draft,
                    layoutJson: printPkg.layoutJson,
                    answerVariants: printPkg.layoutJson.answerVariants,
                  };
                  await saveDraftQuiz(draft.classroomId, draftToPublish, draft.classTitle);
                } catch (layoutErr) {
                  console.warn("Could not precompute layoutJson before publishing draft:", layoutErr);
                }
              }
              const published = await publishDraftQuiz(draftToPublish.classroomId, draftToPublish.id);
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


  // ── Cancel In-Progress PDF Export ──────────────────────────────────────────
  function handleCancelExport() {
    exportRunIdRef.current += 1;
    if (exportAbortRef.current) {
      exportAbortRef.current.abort();
      exportAbortRef.current = null;
    }
    setCancellingExport(true);
    setExportingStage("Cancelling PDF Export...");
    if (cancelDismissTimerRef.current) {
      clearTimeout(cancelDismissTimerRef.current);
    }
    cancelDismissTimerRef.current = setTimeout(() => {
      setCancellingExport(false);
      setExportingPdf(false);
      setExportingTarget(null);
      setExportingStage("");
      showExportToast("PDF export cancelled");
    }, 420);
  }

  // ── Export PDF Paper Sheet ─────────────────────────────────────────────────
  async function handleExportPaper(
    quiz: StoredQuiz,
    includeKey: boolean = false,
    paperSize: BondPaperSize = "short",
    versionOverride?: "A" | "B" | "C"
  ) {
    if (exportingPdf) return;
    if (cancelDismissTimerRef.current) {
      clearTimeout(cancelDismissTimerRef.current);
      cancelDismissTimerRef.current = null;
    }
    setCancellingExport(false);

    const runId = ++exportRunIdRef.current;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    const isCancelled = () =>
      controller.signal.aborted || exportRunIdRef.current !== runId;

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
      if (isCancelled()) return;

      if (cachedUri) {
        setExportingStage(`Loading cached Set ${activeVersion} PDF...`);
        await abortableDelay(600, controller.signal);
        if (isCancelled()) return;
        setExportModalVisible(false);
        setExportingPdf(false);
        setExportingTarget(null);
        await abortableDelay(120, controller.signal);
        if (isCancelled()) return;
        await shareCachedPdfUri(cachedUri, dialogTitle, suggestedFileName).catch(console.warn);
        return;
      }

      // 2. Uncached build fallback
      setExportingStage(`Rendering scannable test sheet for Set ${activeVersion}...`);
      await abortableDelay(200, controller.signal); // Yield to let React Native mount modal & run native animation
      if (isCancelled()) return;

      const printPkg = await generatePrintPackage(quiz, {
        paperSize,
        version: activeVersion,
        classTitle: quiz.classTitle || "Classroom Assessment",
        subject: quiz.subject || "General Subject",
        gradeLevel: quiz.gradeLevel,
        forceSeparate: forceSeparateMode,
        quizId: quiz.id || `QZ-${Date.now().toString().slice(-6)}`,
        target,
        signal: controller.signal,
      });
      if (isCancelled()) return;

      const bytesToExport = includeKey
        ? printPkg.answerKeyPdf
        : (printPkg.combinedStudentPdf || printPkg.studentPdf);

      if (!bytesToExport || bytesToExport.length === 0) {
        throw new Error("Generated PDF has no content.");
      }

      setExportingStage("Ready! Preparing share options...");
      const fileUri = await writeCachedPdf(cacheKey, bytesToExport);
      if (isCancelled()) return;
      const shareUri = await writeCachedPdf(suggestedFileName, bytesToExport);
      if (isCancelled()) return;

      await abortableDelay(250, controller.signal);
      if (isCancelled()) return;
      setExportModalVisible(false);
      setExportingPdf(false);
      setExportingTarget(null);

      await abortableDelay(120, controller.signal);
      if (isCancelled()) return;
      await shareCachedPdfUri(
        shareUri || fileUri,
        dialogTitle,
        suggestedFileName
      );
    } catch (err: any) {
      if (isExportCancelledError(err) || isCancelled()) {
        return;
      }
      if (exportRunIdRef.current === runId) {
        setExportingPdf(false);
        setExportingTarget(null);
        Alert.alert("Export Error", err.message || "Failed to export PDF test paper.");
      }
    } finally {
      if (exportRunIdRef.current === runId) {
        exportAbortRef.current = null;
        setExportingPdf(false);
        setExportingTarget(null);
        setExportingStage("");
      }
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

        {/* ── Roster Alerts ── */}
        <Text style={styles.sectionLabel}>Roster Alerts</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <View style={styles.alertThresholdBlock}>
            <View style={styles.alertThresholdHeader}>
              <Ionicons name="notifications-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: textMain }]}>At-Risk Alert Threshold</Text>
                <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                  Flags averages ≤{alertPrefs.atRiskThreshold}% (≤{getCriticalCutoff(alertPrefs.atRiskThreshold)}% Critical)
                </Text>
              </View>
            </View>
            <View style={styles.alertThresholdRow}>
              {ALERT_THRESHOLD_PRESETS.map((preset) => {
                const active = alertPrefs.atRiskThreshold === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    style={[
                      styles.alertThresholdChip,
                      {
                        backgroundColor: active
                          ? "#EA580C"
                          : darkMode
                            ? "#111827"
                            : "#F8FAFC",
                        borderColor: active ? "#EA580C" : border,
                      },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => handleUpdateAlertPrefs({ atRiskThreshold: preset })}
                  >
                    <Text
                      style={[
                        styles.alertThresholdChipText,
                        { color: active ? "#FFFFFF" : textMain },
                      ]}
                    >
                      ≤{preset}%
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.rowBase}
            activeOpacity={0.8}
            onPress={() =>
              handleUpdateAlertPrefs({
                enableScoreDropAlerts: !alertPrefs.enableScoreDropAlerts,
              })
            }
          >
            <Ionicons name="trending-down-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textMain }]}>Sudden Score Drop Alerts</Text>
              <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                Notify when a quiz drops ≥15 pts below prior average
              </Text>
            </View>
            <View
              style={[
                styles.customSwitchTrack,
                {
                  backgroundColor: alertPrefs.enableScoreDropAlerts ? themeColor : "#CBD5E1",
                  alignItems: alertPrefs.enableScoreDropAlerts ? "flex-end" : "flex-start",
                },
              ]}
            >
              <View style={styles.customSwitchThumb} />
            </View>
          </TouchableOpacity>

          {alertPrefs.atRiskThreshold < PASSING_GRADE - 1 && (
            <>
              <View style={[styles.divider, { backgroundColor: border }]} />
              <TouchableOpacity
                style={styles.rowBase}
                activeOpacity={0.8}
                onPress={() =>
                  handleUpdateAlertPrefs({
                    includeNearPassing: !alertPrefs.includeNearPassing,
                  })
                }
              >
                <Ionicons name="flag-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: textMain }]}>Near-Passing Watchlist</Text>
                  <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                    Include students scoring {alertPrefs.atRiskThreshold + 1}%–{PASSING_GRADE - 1}%
                  </Text>
                </View>
                <View
                  style={[
                    styles.customSwitchTrack,
                    {
                      backgroundColor: alertPrefs.includeNearPassing ? themeColor : "#CBD5E1",
                      alignItems: alertPrefs.includeNearPassing ? "flex-end" : "flex-start",
                    },
                  ]}
                >
                  <View style={styles.customSwitchThumb} />
                </View>
              </TouchableOpacity>
            </>
          )}

          <View style={[styles.divider, { backgroundColor: border }]} />

          <TouchableOpacity
            style={styles.rowBase}
            activeOpacity={0.7}
            onPress={handleResetDismissedAlerts}
          >
            <Ionicons name="refresh-outline" size={18} color={darkMode ? "#94A3B8" : "#475569"} />
            <Text style={[styles.rowLabel, { color: textMain }]}>Restore Dismissed Alerts</Text>
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
        onRequestClose={() => {
          if (exportingPdf) {
            handleCancelExport();
            return;
          }
          setAssessmentModalVisible(false);
        }}
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
                            <Ionicons name="school-outline" size={13} color="#2563EB" />
                            <Text style={[styles.classroomBadgeText, { color: "#2563EB" }]} numberOfLines={1}>
                              {draft.classTitle || "Classroom"}
                            </Text>
                            <Text style={[styles.metaDotSeparator, { color: textSub }]}>·</Text>
                            <Text style={[styles.dateText, { color: textSub }]}>{formattedDate}</Text>
                            <Text style={[styles.metaDotSeparator, { color: textSub }]}>·</Text>
                            <Text
                              style={[
                                styles.dateText,
                                {
                                  color: timeInfo.isExpiringSoon ? "#DC2626" : textSub,
                                  fontWeight: timeInfo.isExpiringSoon ? "600" : "500",
                                },
                              ]}
                            >
                              {timeInfo.text}
                            </Text>
                          </View>
                        </View>
                        <View
                          style={[
                            styles.draftStatusIconWrap,
                            {
                              backgroundColor: timeInfo.isExpiringSoon
                                ? darkMode
                                  ? "rgba(220, 38, 38, 0.18)"
                                  : "#FEE2E2"
                                : darkMode
                                  ? "rgba(245, 158, 11, 0.18)"
                                  : "#FEF3C7",
                            },
                          ]}
                          accessibilityLabel={`Draft expires in ${timeInfo.text}`}
                        >
                          <Ionicons
                            name="time-outline"
                            size={17}
                            color={timeInfo.isExpiringSoon ? "#DC2626" : "#D97706"}
                          />
                        </View>
                      </View>

                      <View style={styles.cardMetaRow}>
                        <Text style={[styles.metaPillText, { color: textSub }]}>
                          {draft.questions.length} Questions · {draft.difficulty || "Standard"} · {draft.questionType || "DepEd Scannable"}
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
                          style={[styles.exportPdfBtn, { backgroundColor: "#1E293B" }]}
                          onPress={() => handlePublishDraft(draft)}
                        >
                          <Ionicons name="send-outline" size={15} color="#FFFFFF" />
                          <Text style={styles.exportPdfText} numberOfLines={1}>Publish</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.deleteBtn, { borderColor: darkMode ? "rgba(239, 68, 68, 0.3)" : "#FEE2E2" }]}
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
                        <View
                          style={[
                            styles.cloudIconWrap,
                            { backgroundColor: darkMode ? "rgba(5, 150, 105, 0.18)" : "#ECFDF5" },
                          ]}
                          accessibilityLabel="Synced to cloud"
                        >
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
                          style={[styles.deleteBtn, { borderColor: darkMode ? "rgba(239, 68, 68, 0.3)" : "#FEE2E2" }]}
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
                  onCancel={handleCancelExport}
                  isCancelling={cancellingExport}
                />
              </View>
            </View>
          )}

          {/* Floating Export Status Toast inside Assessments Repository */}
          {exportToastMessage && (
            <View pointerEvents="none" style={styles.exportToastBanner}>
              <Ionicons name="close-circle" size={17} color="#F87171" />
              <Text style={styles.exportToastText}>{exportToastMessage}</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Question Inspector Modal (AI Builder Preview Style) ── */}
      <AssessmentInspectorModal
        visible={inspectModalVisible}
        quiz={inspectedQuiz}
        darkMode={darkMode}
        themeColor={themeColor}
        exportingPdf={exportingPdf}
        cancellingExport={cancellingExport}
        exportModalVisible={exportModalVisible}
        exportVersion={exportVersion}
        selectedExportQuizTitle={selectedExportQuiz?.quizTitle}
        onClose={() => setInspectModalVisible(false)}
        onPublishDraft={(draft) => handlePublishDraft(draft)}
        onExportPdf={(quiz) => {
          setSelectedExportQuiz(quiz);
          setExportModalVisible(true);
        }}
        onCancelExportPdf={handleCancelExport}
        onSaveDraft={handleUpdateDraft}
        onQuizUpdated={handleUpdateDraft}
      />

      {/* ── Export Paper Sheet Modal ── */}
      <Modal
        visible={exportModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
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
            <View style={styles.dragPill} />
            <View style={styles.exportSheetHeaderRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.exportSheetTitle, { color: textMain }]}>Export Paper Sheet Layout</Text>
                <Text style={[styles.exportSheetSub, { color: textSub }]}>
                  Download, print, or share the physical test sheet formatted with scannable answer boxes.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setExportModalVisible(false)}
                style={styles.closeIconBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={textSub} />
              </TouchableOpacity>
            </View>

            {/* Anti-Cheating Version Selector (Set A / B / C) */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: "500", color: darkMode ? "#E2E8F0" : "#334155" }}>
                Test version
              </Text>
              <View style={[styles.segmentedTrack, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                {(["A", "B", "C"] as const).map((ver) => {
                  const isActive = exportVersion === ver;
                  return (
                    <TouchableOpacity
                      key={ver}
                      onPress={() => setExportVersion(ver)}
                      activeOpacity={0.7}
                      style={[
                        styles.exportSegmentBtn,
                        isActive && [
                          styles.exportSegmentBtnActive,
                          {
                            backgroundColor: darkMode ? "#334155" : "#FFFFFF",
                            borderColor: darkMode ? "#475569" : "#CBD5E1",
                          },
                        ],
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 12.5,
                          color: isActive
                            ? darkMode
                              ? "#F8FAFC"
                              : "#0F172A"
                            : "#64748B",
                          fontWeight: isActive ? "700" : "500",
                        }}
                      >
                        Set {ver}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Force Separate Answer Sheet Toggle */}
            <TouchableOpacity
              onPress={() => setForceSeparateMode((prev) => !prev)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 9,
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
              style={[styles.exportOptionBtn, { backgroundColor: darkMode ? "#111827" : "#F9FAFB", borderColor: border }]}
              onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, false, "short")}
              activeOpacity={0.7}
              disabled={exportingPdf}
            >
              <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                <Ionicons name="document-text-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={[styles.exportOptionTitle, { color: textMain }]}>Short Bond Paper</Text>
                  <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                    <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>{'8.5" × 11"'}</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionSub, { color: textSub }]}>
                  {`1 single sheet (Letter size) • Set ${exportVersion} scannable layout for 1-shot camera scanning`}
                </Text>
              </View>
              <Ionicons name="download-outline" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportOptionBtn, { backgroundColor: darkMode ? "#111827" : "#F9FAFB", borderColor: border }]}
              onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, false, "long")}
              activeOpacity={0.7}
              disabled={exportingPdf}
            >
              <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                <Ionicons name="document-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={[styles.exportOptionTitle, { color: textMain }]}>Long Bond Paper</Text>
                  <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                    <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>{'8.5" × 13"'}</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionSub, { color: textSub }]}>
                  {`1 single sheet (Philippine Folio) • Fits all questions with Set ${exportVersion} spacing`}
                </Text>
              </View>
              <Ionicons name="download-outline" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportOptionBtn, { backgroundColor: darkMode ? "#111827" : "#F9FAFB", borderColor: border }]}
              onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, true, "short")}
              activeOpacity={0.7}
              disabled={exportingPdf}
            >
              <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                <Ionicons name="checkmark-done-outline" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={[styles.exportOptionTitle, { color: textMain }]}>Teacher Answer Key</Text>
                  <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                    <Text style={[styles.dimBadgeText, { color: darkMode ? "#CBD5E1" : "#475569" }]}>PDF</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionSub, { color: textSub }]}>
                  {`1 single sheet with correct answers pre-printed in boxes for Set ${exportVersion}`}
                </Text>
              </View>
              <Ionicons name="download-outline" size={18} color="#94A3B8" />
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
        navigationBarTranslucent
        onRequestClose={handleCancelExport}
      >
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingCard, { backgroundColor: darkMode ? card : "#FFFFFF", borderColor: darkMode ? border : "#E2E8F0" }]}>
            <PdfExportingAnimation
              exportVersion={exportVersion}
              quizTitle={selectedExportQuiz?.quizTitle || "Assessment"}
              accentColor={themeColor || "#EA580C"}
              darkMode={darkMode}
              onCancel={handleCancelExport}
              isCancelling={cancellingExport}
            />
          </View>
        </View>
      </Modal>

      {exportToastMessage && !assessmentModalVisible && (
        <View pointerEvents="none" style={styles.exportToastBanner}>
          <Ionicons name="close-circle" size={17} color="#F87171" />
          <Text style={styles.exportToastText}>{exportToastMessage}</Text>
        </View>
      )}
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
  draftStatusIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
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

  /* ── Export Sheet Modal ── */
  exportBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  exportSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 36,
    maxHeight: "90%",
  },
  exportSheetHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  exportSheetTitle: { fontSize: 18, fontWeight: "800" },
  exportSheetSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  segmentedTrack: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  exportSegmentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  exportSegmentBtnActive: {
    borderWidth: 1,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  exportOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  neutralOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dimBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  dimBadgeText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  exportOptionTitle: { fontSize: 14, fontWeight: "700" },
  exportOptionSub: { fontSize: 11.5, marginTop: 2, lineHeight: 16 },

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
  alertThresholdBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  alertThresholdHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  alertThresholdRow: {
    flexDirection: "row",
    gap: 7,
  },
  alertThresholdChip: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  alertThresholdChipText: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  exportToastBanner: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0F172A",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.35)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 999,
  },
  exportToastText: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "700",
  },
});
