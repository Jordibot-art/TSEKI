import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
import { useTheme } from "../context/ThemeContext";
import { BondPaperSize, exportPaperSheet } from "../lib/paperSheetExporter";
import {
  deleteDraftQuiz,
  deletePublishedQuiz,
  duplicateAsShuffledQuiz,
  enrichQuizzesWithClassrooms,
  getAllDraftQuizzes,
  getAllPublishedQuizzes,
  getDraftTimeRemaining,
  publishDraftQuiz,
  shuffleAssessmentQuestions,
  StoredQuiz,
  updatePublishedQuiz,
} from "../lib/quizStore";
import { supabase } from "../supabase";

// ── Theme Constants ───────────────────────────────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";
const ORANGE_BORDER = "#FFEDD5";
const TEXT_DARK = "#181920";


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

  // ── Change Password modal ──────────────────────────────────────────────────
  const [pwVisible, setPwVisible] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

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

  // ── Shuffle Modal State ────────────────────────────────────────────────────
  const [shuffleModalVisible, setShuffleModalVisible] = useState(false);
  const [quizToShuffle, setQuizToShuffle] = useState<StoredQuiz | null>(null);
  const [shuffleMode, setShuffleMode] = useState<"IN_PLACE" | "DUPLICATE">("IN_PLACE");
  const [newQuizTitle, setNewQuizTitle] = useState("");
  const [targetClassroomId, setTargetClassroomId] = useState("");
  const [classroomsList, setClassroomsList] = useState<Array<{ id: string; title: string; section?: string }>>([]);
  const [isShuffling, setIsShuffling] = useState(false);

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
  async function handleExportPaper(quiz: StoredQuiz, includeKey: boolean = false, paperSize: BondPaperSize = "short") {
    setExportModalVisible(false);
    setExportingPdf(true);
    try {
      await exportPaperSheet({
        assessment: quiz,
        classTitle: quiz.classTitle || "Classroom Assessment",
        subject: quiz.subject || "General Subject",
        includeAnswerKey: includeKey,
        paperSize,
      });
    } catch (err: any) {
      Alert.alert("Export Error", err.message || "Failed to export PDF test paper.");
    } finally {
      setExportingPdf(false);
    }
  }

  // ── Shuffle Assessment Handlers ────────────────────────────────────────────
  async function openShuffleModal(quiz: StoredQuiz) {
    setQuizToShuffle(quiz);
    setShuffleMode("IN_PLACE");
    setNewQuizTitle(`${quiz.quizTitle} (Set B)`);
    setTargetClassroomId(quiz.classroomId || "");
    setShuffleModalVisible(true);

    try {
      const { data } = await supabase
        .from("classrooms")
        .select("id, title, section")
        .order("title", { ascending: true });
      if (data) {
        setClassroomsList(data);
      }
    } catch (err) {
      console.warn("Could not load classrooms for shuffle:", err);
    }
  }

  async function handleExecuteShuffle() {
    if (!quizToShuffle) return;
    setIsShuffling(true);

    try {
      if (shuffleMode === "IN_PLACE") {
        const shuffled = shuffleAssessmentQuestions(quizToShuffle);
        const updated = await updatePublishedQuiz(quizToShuffle.classroomId, quizToShuffle.id, {
          questions: shuffled.questions,
          answerKey: shuffled.answerKey,
        });

        if (updated) {
          await loadAssessments();
          if (inspectedQuiz?.id === quizToShuffle.id) {
            setInspectedQuiz(updated);
          }
          setShuffleModalVisible(false);
          Alert.alert(
            "Questions Shuffled!",
            `Successfully randomized question order for "${quizToShuffle.quizTitle}". Questions and answer keys have been re-indexed 1 to ${shuffled.questions.length}.\n\nReady to print for Section 2!`,
            [
              {
                text: "Print / Export PDF Now",
                onPress: () => {
                  setSelectedExportQuiz(updated);
                  setExportModalVisible(true);
                },
              },
              {
                text: "Inspect Questions",
                onPress: () => {
                  setInspectedQuiz(updated);
                  setInspectModalVisible(true);
                },
              },
              { text: "Done", style: "cancel" },
            ]
          );
        } else {
          Alert.alert("Shuffle Error", "Failed to update assessment with shuffled questions.");
        }
      } else {
        // DUPLICATE AS SET B
        const targetClass = classroomsList.find((c) => c.id === targetClassroomId);
        const targetClassTitle = targetClass ? targetClass.title : quizToShuffle.classTitle;

        const newQuiz = await duplicateAsShuffledQuiz(quizToShuffle, {
          newTitle: newQuizTitle.trim() || `${quizToShuffle.quizTitle} (Set B)`,
          targetClassroomId: targetClassroomId || quizToShuffle.classroomId,
          targetClassTitle: targetClassTitle,
        });

        await loadAssessments();
        setShuffleModalVisible(false);

        Alert.alert(
          "Shuffled Version Created!",
          `Created "${newQuiz.quizTitle}" with randomized questions for ${targetClassTitle || "Section 2"}.\n\nOriginal quiz remains intact!`,
          [
            {
              text: "Print / Export PDF Now",
              onPress: () => {
                setSelectedExportQuiz(newQuiz);
                setExportModalVisible(true);
              },
            },
            {
              text: "Inspect New Quiz",
              onPress: () => {
                setInspectedQuiz(newQuiz);
                setInspectModalVisible(true);
              },
            },
            { text: "Done", style: "cancel" },
          ]
        );
      }
    } catch (err: any) {
      console.error("Shuffle error:", err);
      Alert.alert("Shuffle Error", err.message || "Failed to shuffle assessment.");
    } finally {
      setIsShuffling(false);
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
        <View style={[styles.profileCard, { backgroundColor: themeColor, shadowColor: themeColor }]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.profileName}>{fullName || "Teacher"}</Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="shield-checkmark" size={11} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
          <TouchableOpacity
            style={styles.editProfileBtn}
            onPress={() => { setDraftName(fullName); setEditVisible(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* ── Account ── */}
        <Text style={[styles.sectionLabel, { color: darkMode ? textSub : ORANGE }]}>ACCOUNT</Text>
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

        {/* ── Assessments (Drafts & Archive) ── */}
        <Text style={[styles.sectionLabel, { color: darkMode ? textSub : ORANGE }]}>ASSESSMENTS</Text>
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
            <View style={[styles.iconWrap, { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name="document-text-outline" size={20} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textMain }]}>Draft Assessments</Text>
              <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} saved
              </Text>
            </View>
            <View style={styles.draftBadge}>
              <Text style={styles.draftBadgeText}>DRAFT</Text>
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
            <View style={[styles.iconWrap, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="archive-outline" size={20} color="#2563EB" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: textMain }]}>Archive</Text>
              <Text style={{ fontSize: 12, color: textSub, marginTop: 1 }}>
                {archived.length} published {archived.length === 1 ? "assessment" : "assessments"}
              </Text>
            </View>
            <View style={styles.archiveBadge}>
              <Text style={styles.archiveBadgeText}>ARCHIVE</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={textSub} />
          </TouchableOpacity>
        </View>

        {/* ── Appearance ── */}
        <Text style={[styles.sectionLabel, { color: darkMode ? textSub : ORANGE }]}>APPEARANCE</Text>
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
        </View>

        {/* ── Session ── */}
        <Text style={[styles.sectionLabel, { color: darkMode ? textSub : ORANGE }]}>SESSION</Text>
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
            <View>
              <Text style={[styles.hubHeaderTitle, { color: textMain }]}>Assessments Repository</Text>
              <Text style={[styles.hubHeaderSub, { color: textSub }]}>
                Manage your saved drafts and published classroom archives
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.hubCloseBtn, { backgroundColor: border }]}
              onPress={() => setAssessmentModalVisible(false)}
            >
              <Ionicons name="close" size={20} color={textMain} />
            </TouchableOpacity>
          </View>

          {/* Segmented Switcher */}
          <View style={[styles.tabSegmentWrap, { backgroundColor: border }]}>
            <TouchableOpacity
              style={[
                styles.tabSegmentBtn,
                assessmentTab === "DRAFT" && { backgroundColor: card },
              ]}
              onPress={() => setAssessmentTab("DRAFT")}
              activeOpacity={0.8}
            >
              <Ionicons
                name="document-text"
                size={16}
                color={assessmentTab === "DRAFT" ? "#D97706" : textSub}
              />
              <Text
                style={[
                  styles.tabSegmentText,
                  { color: assessmentTab === "DRAFT" ? textMain : textSub },
                  assessmentTab === "DRAFT" && { fontWeight: "700" },
                ]}
              >
                Drafts ({drafts.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabSegmentBtn,
                assessmentTab === "ARCHIVE" && { backgroundColor: card },
              ]}
              onPress={() => setAssessmentTab("ARCHIVE")}
              activeOpacity={0.8}
            >
              <Ionicons
                name="archive"
                size={16}
                color={assessmentTab === "ARCHIVE" ? "#2563EB" : textSub}
              />
              <Text
                style={[
                  styles.tabSegmentText,
                  { color: assessmentTab === "ARCHIVE" ? textMain : textSub },
                  assessmentTab === "ARCHIVE" && { fontWeight: "700" },
                ]}
              >
                Archive ({archived.length})
              </Text>
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
                  <View style={[styles.emptyIconWrap, { backgroundColor: "#FEF3C7" }]}>
                    <Ionicons name="document-text-outline" size={32} color="#D97706" />
                  </View>
                  <Text style={[styles.hubEmptyTitle, { color: textMain }]}>No Draft Assessments</Text>
                  <Text style={[styles.hubEmptySub, { color: textSub }]}>
                    Drafts are cached only on this device and automatically delete after 7 days (like Instagram). Generate a quiz in AI Builder and tap "Save as Draft" to store one here.
                  </Text>
                </View>
              ) : (
                drafts.map((draft) => (
                  <View key={draft.id} style={[styles.assessmentCard, { backgroundColor: card, borderColor: border }]}>
                    <View style={styles.cardTopRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.quizTitle, { color: textMain }]} numberOfLines={2}>
                          {draft.quizTitle}
                        </Text>
                        <View style={styles.classroomBadgeRow}>
                          <Ionicons name="school-outline" size={13} color={themeColor} />
                          <Text style={[styles.classroomBadgeText, { color: themeColor }]} numberOfLines={1}>
                            {draft.classTitle || "Classroom"}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {(() => {
                          const timeInfo = getDraftTimeRemaining(draft);
                          return (
                            <View
                              style={[
                                styles.draftTimerBadge,
                                timeInfo.isExpiringSoon && styles.draftTimerExpiringBadge,
                              ]}
                            >
                              <Ionicons
                                name="time-outline"
                                size={11}
                                color={timeInfo.isExpiringSoon ? "#DC2626" : "#D97706"}
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
                          );
                        })()}
                        <View style={styles.draftBadge}>
                          <Text style={styles.draftBadgeText}>DRAFT</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.cardMetaRow}>
                      <Text style={[styles.metaPillText, { color: textSub }]}>
                        {draft.questions.length} Questions • {draft.difficulty || "Standard"} • {draft.questionType || "Mixed"}
                      </Text>
                      <Text style={[styles.dateText, { color: textSub }]}>
                        {new Date(draft.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
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
                        <Text style={[styles.inspectBtnText, { color: textMain }]}>Inspect</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionPublishBtn, { backgroundColor: themeColor }]}
                        onPress={() => handlePublishDraft(draft)}
                      >
                        <Ionicons name="send-outline" size={15} color="#FFFFFF" />
                        <Text style={styles.actionPublishText}>Publish</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.deleteBtn, { borderColor: "#FEE2E2" }]}
                        onPress={() => handleDeleteDraft(draft)}
                      >
                        <Ionicons name="trash-outline" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )
            ) : (
              // ── Archive List ──
              archived.length === 0 ? (
                <View style={styles.hubEmptyWrap}>
                  <View style={[styles.emptyIconWrap, { backgroundColor: "#DBEAFE" }]}>
                    <Ionicons name="archive-outline" size={32} color="#2563EB" />
                  </View>
                  <Text style={[styles.hubEmptyTitle, { color: textMain }]}>No Archived Assessments</Text>
                  <Text style={[styles.hubEmptySub, { color: textSub }]}>
                    Assessments published to your classrooms are saved in your database cloud archive and accessible across all your devices.
                  </Text>
                </View>
              ) : (
                archived.map((quiz) => (
                  <View key={quiz.id} style={[styles.assessmentCard, { backgroundColor: card, borderColor: border }]}>
                    <View style={styles.cardTopRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.quizTitle, { color: textMain }]} numberOfLines={2}>
                          {quiz.quizTitle}
                        </Text>
                        <View style={styles.classroomBadgeRow}>
                          <Ionicons name="school-outline" size={13} color="#2563EB" />
                          <Text style={[styles.classroomBadgeText, { color: "#2563EB" }]} numberOfLines={1}>
                            {quiz.classTitle || "Classroom"}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={styles.cloudSyncBadge}>
                          <Ionicons name="cloud-done-outline" size={11} color="#059669" />
                          <Text style={styles.cloudSyncBadgeText}>CLOUD</Text>
                        </View>
                        <View style={styles.archiveBadge}>
                          <Text style={styles.archiveBadgeText}>ARCHIVE</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.cardMetaRow}>
                      <Text style={[styles.metaPillText, { color: textSub }]}>
                        {quiz.questions.length} Questions • {quiz.difficulty || "Standard"} • DepEd Scannable
                      </Text>
                      <Text style={[styles.dateText, { color: textSub }]}>
                        {new Date(quiz.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
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
                        <Text style={[styles.inspectBtnText, { color: textMain }]}>Inspect</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.shuffleBtn, { borderColor: themeColor + "44", backgroundColor: themeColor + "10" }]}
                        onPress={() => openShuffleModal(quiz)}
                      >
                        <Ionicons name="shuffle-outline" size={15} color={themeColor} />
                        <Text style={[styles.shuffleBtnText, { color: themeColor }]}>Shuffle</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.exportPdfBtn, { backgroundColor: "#1F2937" }]}
                        onPress={() => {
                          setSelectedExportQuiz(quiz);
                          setExportModalVisible(true);
                        }}
                      >
                        <Ionicons name="print-outline" size={15} color="#FFFFFF" />
                        <Text style={styles.exportPdfText}>Export PDF</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.deleteBtn, { borderColor: "#FEE2E2" }]}
                        onPress={() => handleDeleteArchive(quiz)}
                      >
                        <Ionicons name="trash-outline" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )
            )}
          </ScrollView>
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
            <View style={{ flex: 1, marginRight: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <Text style={[styles.hubHeaderTitle, { color: textMain }]} numberOfLines={1}>
                  {inspectedQuiz?.quizTitle}
                </Text>
                {inspectedQuiz?.status === "DRAFT" ? (
                  <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>DRAFT</Text></View>
                ) : (
                  <View style={styles.archiveBadge}><Text style={styles.archiveBadgeText}>ARCHIVE</Text></View>
                )}
              </View>
              <Text style={[styles.hubHeaderSub, { color: textSub }]}>
                {inspectedQuiz?.classTitle || "Classroom"} • {inspectedQuiz?.questions.length} Questions • {inspectedQuiz?.difficulty || "Standard"}
              </Text>
            </View>
            {inspectedQuiz?.status === "ARCHIVE" && (
              <TouchableOpacity
                style={[styles.inspectHeaderShuffleBtn, { backgroundColor: themeColor + "18", borderColor: themeColor + "40" }]}
                onPress={() => inspectedQuiz && openShuffleModal(inspectedQuiz)}
                activeOpacity={0.7}
              >
                <Ionicons name="shuffle" size={14} color={themeColor} />
                <Text style={[styles.inspectHeaderShuffleText, { color: themeColor }]}>Shuffle</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.hubCloseBtn, { backgroundColor: border }]}
              onPress={() => setInspectModalVisible(false)}
            >
              <Ionicons name="close" size={20} color={textMain} />
            </TouchableOpacity>
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
              <View style={styles.inspectFooterArchiveRow}>
                <TouchableOpacity
                  style={[styles.inspectFooterShuffleBtn, { borderColor: themeColor, backgroundColor: themeColor + "14" }]}
                  onPress={() => {
                    if (inspectedQuiz) {
                      openShuffleModal(inspectedQuiz);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="shuffle" size={16} color={themeColor} />
                  <Text style={[styles.inspectFooterShuffleText, { color: themeColor }]}>Shuffle Questions</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.inspectFooterExportBtn, { backgroundColor: themeColor, flex: 1.2 }]}
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
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Export Paper Sheet Modal ── */}
      <Modal
        visible={exportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExportModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.exportBackdrop}
          activeOpacity={1}
          onPress={() => setExportModalVisible(false)}
        >
          <View style={[styles.exportSheet, { backgroundColor: card }]}>
            <View style={styles.exportSheetHeader}>
              <Text style={[styles.exportSheetTitle, { color: textMain }]}>Export Physical Paper Sheet</Text>
              <Text style={[styles.exportSheetSub, { color: textSub }]}>
                Select paper size to export or print single-sheet scannable test papers for "{selectedExportQuiz?.quizTitle}".
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.exportOptionBtn, { borderColor: border }]}
              onPress={() => selectedExportQuiz && handleExportPaper(selectedExportQuiz, false, "short")}
              activeOpacity={0.7}
              disabled={exportingPdf}
            >
              <View style={[styles.exportOptionIcon, { backgroundColor: themeColor + "18" }]}>
                <Ionicons name="document-text" size={22} color={themeColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptionTitle, { color: textMain }]}>Short Bond Paper (8.5" × 11")</Text>
                <Text style={[styles.exportOptionSub, { color: textSub }]}>
                  Letter size • 2-column scannable format optimized for camera scanning
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={textSub} />
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
                <Text style={[styles.exportOptionTitle, { color: textMain }]}>Long Bond Paper (8.5" × 13")</Text>
                <Text style={[styles.exportOptionSub, { color: textSub }]}>
                  Philippine Folio • Extra spacing for DepEd standard exams
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={textSub} />
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
                  Pre-filled answer key sheet with correct letters in scannable boxes
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={textSub} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportCancelBtn, { borderColor: border }]}
              onPress={() => setExportModalVisible(false)}
            >
              <Text style={[styles.exportCancelText, { color: textSub }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Shuffle Assessment Modal ── */}
      <Modal
        visible={shuffleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !isShuffling && setShuffleModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.exportBackdrop}
          activeOpacity={1}
          onPress={() => !isShuffling && setShuffleModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.shuffleSheet, { backgroundColor: card }]}>
            {/* Modal Drag Indicator */}
            <View style={styles.sheetHandle} />

            <View style={styles.shuffleHeader}>
              <View style={[styles.shuffleIconWrap, { backgroundColor: themeColor + "18" }]}>
                <Ionicons name="shuffle" size={24} color={themeColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shuffleTitle, { color: textMain }]}>Shuffle Questions</Text>
                <Text style={[styles.shuffleSubtitle, { color: textSub }]}>
                  Randomize question order & scannable answer keys for Section 2 / Set B
                </Text>
              </View>
            </View>

            {/* Quiz Info Box */}
            {quizToShuffle && (
              <View style={[styles.shuffleQuizInfoBox, { backgroundColor: inputBg, borderColor: border }]}>
                <Ionicons name="document-text-outline" size={18} color={themeColor} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.shuffleQuizTitle, { color: textMain }]} numberOfLines={1}>
                    {quizToShuffle.quizTitle}
                  </Text>
                  <Text style={[styles.shuffleQuizMeta, { color: textSub }]}>
                    {quizToShuffle.questions.length} Questions • {quizToShuffle.classTitle || "Classroom"} • DepEd Scannable
                  </Text>
                </View>
              </View>
            )}

            {/* Shuffle Mode Selection */}
            <Text style={[styles.shuffleSectionLabel, { color: textSub }]}>CHOOSE SHUFFLE MODE</Text>

            {/* Mode 1: In-Place */}
            <TouchableOpacity
              style={[
                styles.shuffleModeCard,
                {
                  borderColor: shuffleMode === "IN_PLACE" ? themeColor : border,
                  backgroundColor: shuffleMode === "IN_PLACE" ? themeColor + "0C" : card,
                },
              ]}
              onPress={() => setShuffleMode("IN_PLACE")}
              activeOpacity={0.7}
            >
              <View style={[styles.radioCircle, { borderColor: shuffleMode === "IN_PLACE" ? themeColor : border }]}>
                {shuffleMode === "IN_PLACE" && <View style={[styles.radioDot, { backgroundColor: themeColor }]} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.shuffleModeTitle, { color: textMain }]}>Shuffle Current Assessment</Text>
                  <View style={[styles.quickBadge, { backgroundColor: "#10B98120" }]}>
                    <Text style={styles.quickBadgeText}>QUICK PRINT</Text>
                  </View>
                </View>
                <Text style={[styles.shuffleModeSub, { color: textSub }]}>
                  Reorders questions 1 through {quizToShuffle?.questions.length || 10} directly in this quiz and updates the camera grader answer key. Perfect if you just finished Section 1 and need to print immediately for Section 2.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Mode 2: Duplicate as Set B */}
            <TouchableOpacity
              style={[
                styles.shuffleModeCard,
                {
                  borderColor: shuffleMode === "DUPLICATE" ? themeColor : border,
                  backgroundColor: shuffleMode === "DUPLICATE" ? themeColor + "0C" : card,
                },
              ]}
              onPress={() => setShuffleMode("DUPLICATE")}
              activeOpacity={0.7}
            >
              <View style={[styles.radioCircle, { borderColor: shuffleMode === "DUPLICATE" ? themeColor : border }]}>
                {shuffleMode === "DUPLICATE" && <View style={[styles.radioDot, { backgroundColor: themeColor }]} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.shuffleModeTitle, { color: textMain }]}>Create New Shuffled Set (Set B)</Text>
                  <View style={[styles.quickBadge, { backgroundColor: "#3B82F620" }]}>
                    <Text style={[styles.quickBadgeText, { color: "#2563EB" }]}>PRESERVE SET A</Text>
                  </View>
                </View>
                <Text style={[styles.shuffleModeSub, { color: textSub }]}>
                  Preserves Section 1's test sheet in the archive and generates an independent, randomized copy with its own title and assigned classroom.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Additional inputs if DUPLICATE */}
            {shuffleMode === "DUPLICATE" && (
              <View style={styles.duplicateConfigWrap}>
                <Text style={[styles.inputFieldLabel, { color: textSub }]}>NEW SET TITLE</Text>
                <TextInput
                  style={[styles.shuffleTextInput, { backgroundColor: inputBg, color: textMain, borderColor: border }]}
                  value={newQuizTitle}
                  onChangeText={setNewQuizTitle}
                  placeholder="e.g. Science Quiz (Set B)"
                  placeholderTextColor={textSub}
                />

                {classroomsList.length > 0 && (
                  <>
                    <Text style={[styles.inputFieldLabel, { color: textSub, marginTop: 10 }]}>ASSIGN TO CLASSROOM / SECTION</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.classroomChipsRow}>
                      {classroomsList.map((c) => {
                        const isSelected = targetClassroomId === c.id;
                        return (
                          <TouchableOpacity
                            key={c.id}
                            style={[
                              styles.classroomChip,
                              {
                                borderColor: isSelected ? themeColor : border,
                                backgroundColor: isSelected ? themeColor + "18" : inputBg,
                              },
                            ]}
                            onPress={() => setTargetClassroomId(c.id)}
                          >
                            <Ionicons
                              name="school-outline"
                              size={12}
                              color={isSelected ? themeColor : textSub}
                            />
                            <Text
                              style={[
                                styles.classroomChipText,
                                { color: isSelected ? themeColor : textMain, fontWeight: isSelected ? "700" : "500" },
                              ]}
                            >
                              {c.title} {c.section ? `(${c.section})` : ""}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </>
                )}
              </View>
            )}

            {/* Actions */}
            <View style={styles.shuffleActionsRow}>
              <TouchableOpacity
                style={[styles.shuffleCancelBtn, { borderColor: border }]}
                onPress={() => setShuffleModalVisible(false)}
                disabled={isShuffling}
              >
                <Text style={[styles.shuffleCancelText, { color: textSub }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shuffleSubmitBtn, { backgroundColor: themeColor }]}
                onPress={handleExecuteShuffle}
                disabled={isShuffling}
                activeOpacity={0.8}
              >
                {isShuffling ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="shuffle" size={17} color="#FFFFFF" />
                    <Text style={styles.shuffleSubmitText}>
                      {shuffleMode === "IN_PLACE" ? "Shuffle Questions Now" : "Create & Save Set B"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
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
    <TouchableOpacity style={styles.rowBase} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconWrap, { backgroundColor: accentColor + "18" }]}>
        <Ionicons name={icon} size={20} color={accentColor} />
      </View>
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
  headerTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },

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
  avatarText: { fontSize: 22, fontWeight: "800", color: "#FFFFFF" },
  profileName: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", marginBottom: 2 },
  profileEmail: { fontSize: 12, color: "rgba(255,255,255,0.8)" },
  verifiedBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  editProfileBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },

  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8, marginLeft: 4 },

  card: {
    borderRadius: 16, marginBottom: 24, borderWidth: 1, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  divider: { height: 1, marginLeft: 64 },

  rowBase: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: "500" },

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

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 48 },
  modalTitle: { fontSize: 22, fontWeight: "800", marginBottom: 20 },

  input: { height: 54, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  pwRow: { flexDirection: "row", alignItems: "center", height: 54, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, gap: 8 },
  pwInput: { flex: 1, fontSize: 16 },

  modalActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, height: 54, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontSize: 16, fontWeight: "600" },
  saveBtn: {
    flex: 1, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },

  /* ── Assessment Hub Modal ── */
  hubContainer: { flex: 1 },
  hubHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  hubHeaderTitle: { fontSize: 18, fontWeight: "800" },
  hubHeaderSub: { fontSize: 12, marginTop: 2 },
  hubCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabSegmentWrap: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabSegmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  tabSegmentText: { fontSize: 14, fontWeight: "600" },

  hubScrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  hubEmptyWrap: { alignItems: "center", justifyContent: "center", paddingTop: 60, paddingHorizontal: 30 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  hubEmptyTitle: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  hubEmptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },

  assessmentCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  quizTitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  classroomBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  classroomBadgeText: { fontSize: 13, fontWeight: "600" },
  cardMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  metaPillText: { fontSize: 12, fontWeight: "500" },
  dateText: { fontSize: 11 },
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
  shuffleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
  },
  shuffleBtnText: { fontSize: 13, fontWeight: "700" },
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
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 38,
    borderRadius: 10,
    gap: 6,
  },
  exportPdfText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E222",
  },

  /* ── Question Inspector ── */
  inspectHeaderShuffleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  inspectHeaderShuffleText: { fontSize: 12, fontWeight: "700" },
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
  inspectFooterArchiveRow: {
    flexDirection: "row",
    gap: 10,
  },
  inspectFooterShuffleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
  },
  inspectFooterShuffleText: { fontSize: 14, fontWeight: "700" },
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

  /* ── Shuffle Modal Styles ── */
  shuffleSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 22,
    paddingBottom: 36,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginBottom: 16,
  },
  shuffleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  shuffleIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  shuffleTitle: { fontSize: 18, fontWeight: "800" },
  shuffleSubtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  shuffleQuizInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  shuffleQuizTitle: { fontSize: 13, fontWeight: "700" },
  shuffleQuizMeta: { fontSize: 11, marginTop: 2 },
  shuffleSectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  shuffleModeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  shuffleModeTitle: { fontSize: 14, fontWeight: "700" },
  shuffleModeSub: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  quickBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  quickBadgeText: { fontSize: 9, fontWeight: "800", color: "#059669" },
  duplicateConfigWrap: {
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  inputFieldLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },
  shuffleTextInput: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  classroomChipsRow: {
    flexDirection: "row",
    marginTop: 4,
    marginBottom: 6,
  },
  classroomChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  classroomChipText: { fontSize: 12 },
  shuffleActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  shuffleCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  shuffleCancelText: { fontSize: 14, fontWeight: "600" },
  shuffleSubmitBtn: {
    flex: 2,
    height: 46,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  shuffleSubmitText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
