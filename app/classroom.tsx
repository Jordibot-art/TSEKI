import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from "react-native";
import AIBuilderTab from "../components/AIBuilderTab";
import GraderTab from "../components/GraderTab";
import { NotificationsModal } from "../components/NotificationsModal";
import TrackerTab from "../components/TrackerTab";
import { StudentFormModal } from "../components/classroom/StudentFormModal";
import { useTheme } from "../context/ThemeContext";
import {
  AlertPreferences,
  buildReconciledAlerts,
  clearAllAlerts,
  DEFAULT_ALERT_PREFERENCES,
  deleteClassroomAlerts,
  deleteStudentAlerts,
  dismissSingleAlert,
  markAlertsAsRead,
  markAllAlertsAsRead,
  restoreDismissedAlerts,
  RosterAlert,
  StudentQuizSnapshot,
} from "../lib/alertStore";
import {
  formatQuizColumnHeader,
  formatStudentFullName,
  generateExcelClasslistBase64,
  generateExcelTemplateBase64,
  generateScoreExportBase64,
  isDuplicateStudent,
  normalizeStudentRecord,
  parseClasslistFile,
  ParsedClasslistResult,
  ParsedStudentRow
} from "../lib/classListParserService";
import { generateStudentAdvice } from "../lib/pedagogicalAdvice";
import {
  deleteAllResultsForStudent,
  deleteStudentQuizResult,
  getAllStudentQuizResults,
  getStudentResults,
  StudentQuizResult,
  updateStudentQuizResult,
} from "../lib/questionAnalysis";
import { DeleteEmailVerificationModal } from "../components/DeleteEmailVerificationModal";
import {
  deleteClassroomQuizzes,
  getPublishedQuizzes,
  StoredQuiz,
} from "../lib/quizStore";
import { supabase } from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────
type Student = {
  id: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string | null;
  full_name: string;
  email: string | null;
  average: number;
  attendance?: number;
};

type Tab = "Record" | "AI Builder" | "Grader" | "Tracker";

// ── Theme Constants ───────────────────────────────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#FF6B00", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899",
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getStudentAvatar(_name: string): string | null {
  return null;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ClassroomScreen() {
  const router = useRouter();
  const {
    id,
    title,
    schedule,
    room,
    color,
    subject,
    section,
    initialTab,
    openStudentId,
    openStudentName,
  } = useLocalSearchParams<{
    id: string;
    title: string;
    schedule?: string;
    room?: string;
    color: string;
    subject?: string;
    section?: string;
    initialTab?: Tab;
    openStudentId?: string;
    openStudentName?: string;
  }>();

  const [classroomTitle, setClassroomTitle] = useState(title || "");
  const [classroomSubject, setClassroomSubject] = useState(subject || "");
  const [classroomSection, setClassroomSection] = useState(section || "");
  const [classroomRoom, setClassroomRoom] = useState(room || "");
  const [classroomSchedule, setClassroomSchedule] = useState(schedule || "");

  // Edit Classroom Modal State
  const [editClassModalVisible, setEditClassModalVisible] = useState(false);
  const [draftClassTitle, setDraftClassTitle] = useState("");
  const [draftClassSubject, setDraftClassSubject] = useState("");
  const [draftClassSection, setDraftClassSection] = useState("");
  const [draftClassRoom, setDraftClassRoom] = useState("");
  const [draftClassSchedule, setDraftClassSchedule] = useState("");
  const [savingClassEdit, setSavingClassEdit] = useState(false);

  // Action Sheets State
  const [classMenuVisible, setClassMenuVisible] = useState(false);
  const [studentMenuTarget, setStudentMenuTarget] = useState<Student | null>(null);

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab === "Tracker" || initialTab === "AI Builder" || initialTab === "Grader"
      ? initialTab
      : "Record"
  );
  const [selectedGradingQuiz, setSelectedGradingQuiz] = useState<string | undefined>(undefined);
  const [publishedQuizzes, setPublishedQuizzes] = useState<StoredQuiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Add-student modal
  const [modalVisible, setModalVisible] = useState(false);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit-student modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [editLastName, setEditLastName] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editMiddleName, setEditMiddleName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Student Profile Detail Modal
  const [selectedProfile, setSelectedProfile] = useState<Student | null>(null);
  const [studentQuizResults, setStudentQuizResults] = useState<StudentQuizResult[]>([]);
  const [profileVisibleAssessments, setProfileVisibleAssessments] = useState<number>(5);

  // Quiz Grade Sheet Edit & Delete States (inside Student Profile Modal)
  const [editingGradeEntry, setEditingGradeEntry] = useState<StudentQuizResult | null>(null);
  const [editGradeTitle, setEditGradeTitle] = useState("");
  const [editGradeScore, setEditGradeScore] = useState("");
  const [editGradeMaxScore, setEditGradeMaxScore] = useState("");
  const [savingGradeEdit, setSavingGradeEdit] = useState(false);
  const [gradeEntryToDelete, setGradeEntryToDelete] = useState<StudentQuizResult | null>(null);
  const [deletingGradeEntry, setDeletingGradeEntry] = useState(false);

  // Notification Alert state for this classroom
  const [classroomAlerts, setClassroomAlerts] = useState<RosterAlert[]>([]);
  const [classroomDismissedAlerts, setClassroomDismissedAlerts] = useState<RosterAlert[]>([]);
  const [classroomAlertPrefs, setClassroomAlertPrefs] = useState<AlertPreferences>(
    DEFAULT_ALERT_PREFERENCES
  );
  const [classroomUnreadCount, setClassroomUnreadCount] = useState<number>(0);
  const [notifModalVisible, setNotifModalVisible] = useState<boolean>(false);
  const handledOpenStudentRef = useRef<string | null>(null);

  // Deletion Confirmation States
  const [confirmDeleteStudentModal, setConfirmDeleteStudentModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);

  const [confirmDeleteClassModal, setConfirmDeleteClassModal] = useState(false);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // Import Classlist Modal
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importResult, setImportResult] = useState<ParsedClasslistResult | null>(null);
  const [importStudents, setImportStudents] = useState<ParsedStudentRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const exportRunIdRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      exportRunIdRef.current += 1;
    };
  }, []);

  function handleCancelClassroomExport() {
    exportRunIdRef.current += 1;
    setIsExporting(false);
  }

  const loadClassroomAlerts = useCallback(
    async (prefsOverride?: AlertPreferences) => {
      if (!id) return;
      try {
        const allQuizResults = await getAllStudentQuizResults(id as string).catch(() => []);
        const latestQuizByStudent: Record<string, StudentQuizSnapshot> = {};

        // Sort newest first so the first entry per student is their latest graded quiz
        const sortedResults = [...allQuizResults].sort(
          (a, b) =>
            (new Date(b.gradedAt || 0).getTime() || 0) -
            (new Date(a.gradedAt || 0).getTime() || 0)
        );
        for (const r of sortedResults) {
          if (!r.studentId) continue;
          if (!latestQuizByStudent[r.studentId]) {
            latestQuizByStudent[r.studentId] = {
              quizTitle: r.quizTitle,
              scorePercentage: r.scorePercentage,
              totalScore: r.totalScore,
              maxScore: r.maxScore,
              gradedAt: r.gradedAt,
              quizCount: 1,
            };
          } else {
            latestQuizByStudent[r.studentId].quizCount =
              (latestQuizByStudent[r.studentId].quizCount || 1) + 1;
          }
        }

        const reconciled = await buildReconciledAlerts({
          students: students.map((s) => ({
            id: s.id,
            classroom_id: id as string,
            full_name: s.full_name || "Student",
            average: s.average,
          })),
          classrooms: [
            {
              id: id as string,
              title: classroomTitle || (title as string) || "Classroom",
              subject: classroomSubject || (subject as string) || "",
              section: classroomSection || (section as string) || "",
              room: classroomRoom || (room as string) || "",
              schedule: classroomSchedule || (schedule as string) || "",
              color: color || ORANGE,
            },
          ],
          classroomIdFilter: id as string,
          latestQuizByStudent,
          preferencesOverride: prefsOverride,
        });

        setClassroomAlerts(reconciled.activeAlerts);
        setClassroomDismissedAlerts(reconciled.dismissedAlerts);
        setClassroomUnreadCount(reconciled.unreadCount);
        setClassroomAlertPrefs(reconciled.preferences);
      } catch (err) {
        console.error("Failed to load classroom alerts:", err);
      }
    },
    [
      id,
      classroomTitle,
      classroomSubject,
      classroomSection,
      classroomRoom,
      classroomSchedule,
      title,
      subject,
      section,
      room,
      schedule,
      color,
      students,
    ]
  );

  useEffect(() => {
    loadClassroomAlerts();
  }, [loadClassroomAlerts]);

  // Load all recorded per-assessment results for selected student profile (newest first)
  useEffect(() => {
    setProfileVisibleAssessments(5);
    if (selectedProfile && id) {
      getStudentResults(id as string, selectedProfile.id, selectedProfile.full_name).then(
        setStudentQuizResults
      );
    } else {
      setStudentQuizResults([]);
      setEditingGradeEntry(null);
      setGradeEntryToDelete(null);
    }
  }, [selectedProfile, id]);

  // ── Classroom Notification Handlers ────────────────────────────────────────
  function handleOpenNotifModal() {
    setNotifModalVisible(true);
  }

  async function handleClassroomAlertPress(alert: RosterAlert) {
    await markAlertsAsRead([
      alert.id,
      alert.studentId,
      `flag_${alert.studentId}`,
      `alert_${alert.studentId}`,
    ]);
    setClassroomAlerts((prev) => {
      const next = prev.map((a) =>
        a.id === alert.id || a.studentId === alert.studentId ? { ...a, isRead: true } : a
      );
      setClassroomUnreadCount(next.filter((a) => !a.isRead).length);
      return next;
    });
    setNotifModalVisible(false);

    // Switch to Tracker tab and open student profile
    setActiveTab("Tracker");
    const match = students.find(
      (s) =>
        s.id === alert.studentId ||
        s.full_name.toLowerCase() === alert.studentName.toLowerCase()
    );
    if (match) {
      setSelectedProfile(match);
    }
  }

  async function handleClassroomRemedialQuiz(alert: RosterAlert) {
    await markAlertsAsRead([
      alert.id,
      alert.studentId,
      `flag_${alert.studentId}`,
      `alert_${alert.studentId}`,
    ]);
    setClassroomAlerts((prev) => {
      const next = prev.map((a) =>
        a.id === alert.id || a.studentId === alert.studentId ? { ...a, isRead: true } : a
      );
      setClassroomUnreadCount(next.filter((a) => !a.isRead).length);
      return next;
    });
    setNotifModalVisible(false);
    setActiveTab("AI Builder");
  }

  async function handleDismissClassroomAlert(alert: RosterAlert) {
    await dismissSingleAlert(alert);
    setClassroomAlerts((prev) => {
      const next = prev.filter((a) => a.studentId !== alert.studentId);
      setClassroomUnreadCount(next.filter((a) => !a.isRead).length);
      return next;
    });
    setClassroomDismissedAlerts((prev) =>
      prev.some((a) => a.studentId === alert.studentId) ? prev : [alert, ...prev]
    );
  }

  async function handleRestoreClassroomAlerts(toRestore: RosterAlert[]) {
    await restoreDismissedAlerts(toRestore);
    await loadClassroomAlerts();
  }

  async function handleMarkAllClassroomAlertsRead() {
    await markAllAlertsAsRead(classroomAlerts);
    setClassroomAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));
    setClassroomUnreadCount(0);
  }

  async function handleClearAllClassroomAlerts() {
    const clearedNow = [...classroomAlerts];
    await clearAllAlerts(clearedNow);
    setClassroomAlerts([]);
    setClassroomUnreadCount(0);
    setClassroomDismissedAlerts((prev) => {
      const existingIds = new Set(prev.map((p) => p.studentId));
      const merged = [...prev];
      for (const a of clearedNow) {
        if (!existingIds.has(a.studentId)) merged.unshift(a);
      }
      return merged;
    });
  }

  async function handleClassroomAlertPrefsChange(nextPrefs: AlertPreferences) {
    setClassroomAlertPrefs(nextPrefs);
    await loadClassroomAlerts(nextPrefs);
  }

  // ── Remove Student Handlers ────────────────────────────────────────────────
  function promptDeleteStudent(student: Student | null) {
    if (!student) return;
    setStudentToDelete(student);
    setConfirmDeleteStudentModal(true);
  }

  async function handleConfirmDeleteStudent() {
    if (!studentToDelete || isDeletingStudent) return;
    setIsDeletingStudent(true);

    try {
      const studentId = studentToDelete.id;
      // 1. Delete student record from Supabase
      const { error } = await supabase.from("students").delete().eq("id", studentId);
      if (error) throw error;

      // 2. Delete related alerts and local quiz results cache
      await Promise.all([
        deleteStudentAlerts(studentId),
        id ? deleteAllResultsForStudent(id as string, studentId) : Promise.resolve(),
      ]);

      // 3. Update local state
      setStudents((prev) => prev.filter((s) => s.id !== studentId));
      if (selectedProfile?.id === studentId) {
        setSelectedProfile(null);
      }
      setConfirmDeleteStudentModal(false);
      setStudentToDelete(null);
      loadClassroomAlerts();
    } catch (err: any) {
      console.error("Failed to delete student:", err);
      Alert.alert("Error Removing Student", err.message || "Failed to remove student from database.");
      throw err;
    } finally {
      setIsDeletingStudent(false);
    }
  }

  // ── Student Quiz Grade Sheet Edit & Delete Handlers ────────────────────────
  function openEditGradeEntry(entry: StudentQuizResult) {
    setGradeEntryToDelete(null);
    setEditingGradeEntry(entry);
    setEditGradeTitle(entry.quizTitle || "");
    setEditGradeScore(String(entry.totalScore ?? 0));
    setEditGradeMaxScore(String(entry.maxScore ?? 1));
  }

  async function handleSaveGradeEdit() {
    if (!selectedProfile || !editingGradeEntry || !id || savingGradeEdit) return;
    const cleanTitle = editGradeTitle.trim();
    const parsedScore = Number(editGradeScore.trim());
    const parsedMax = Number(editGradeMaxScore.trim());

    if (!cleanTitle) {
      Alert.alert("Missing Title", "Please enter an assessment title.");
      return;
    }
    if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
      Alert.alert("Invalid Total Points", "Total weight / max points must be greater than 0.");
      return;
    }
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > parsedMax) {
      Alert.alert("Invalid Score", `Score must be between 0 and ${parsedMax}.`);
      return;
    }

    Keyboard.dismiss();
    setSavingGradeEdit(true);
    try {
      const { results, newAverage } = await updateStudentQuizResult({
        classroomId: id as string,
        studentId: selectedProfile.id,
        studentName: selectedProfile.full_name,
        original: editingGradeEntry,
        newQuizTitle: cleanTitle,
        newTotalScore: parsedScore,
        newMaxScore: parsedMax,
      });

      setStudentQuizResults(results);
      setSelectedProfile((prev) => (prev ? { ...prev, average: newAverage } : prev));
      setStudents((prev) =>
        prev.map((s) => (s.id === selectedProfile.id ? { ...s, average: newAverage } : s))
      );
      setEditingGradeEntry(null);
      loadClassroomAlerts();
    } catch (err: any) {
      console.error("Failed to update quiz grade entry:", err);
      Alert.alert("Update Failed", err?.message || "Could not update quiz grade entry.");
    } finally {
      setSavingGradeEdit(false);
    }
  }

  async function handleConfirmDeleteGradeEntry() {
    if (!selectedProfile || !gradeEntryToDelete || !id || deletingGradeEntry) return;
    setDeletingGradeEntry(true);
    try {
      const { results, newAverage } = await deleteStudentQuizResult({
        classroomId: id as string,
        studentId: selectedProfile.id,
        studentName: selectedProfile.full_name,
        target: gradeEntryToDelete,
      });

      setStudentQuizResults(results);
      setSelectedProfile((prev) => (prev ? { ...prev, average: newAverage } : prev));
      setStudents((prev) =>
        prev.map((s) => (s.id === selectedProfile.id ? { ...s, average: newAverage } : s))
      );
      setGradeEntryToDelete(null);
      loadClassroomAlerts();
    } catch (err: any) {
      console.error("Failed to delete quiz grade entry:", err);
      Alert.alert("Delete Failed", err?.message || "Could not delete quiz grade entry.");
    } finally {
      setDeletingGradeEntry(false);
    }
  }

  // ── Delete & Edit Classroom Handlers ──────────────────────────────────────
  function openEditClassroomModal() {
    setClassMenuVisible(false);
    setDraftClassTitle(classroomTitle);
    setDraftClassSubject(classroomSubject);
    setDraftClassSection(classroomSection);
    setDraftClassRoom(classroomRoom);
    setDraftClassSchedule(classroomSchedule);
    setEditClassModalVisible(true);
  }

  async function handleSaveClassroomEdit() {
    if (!id || !draftClassTitle.trim() || savingClassEdit) return;
    setSavingClassEdit(true);
    try {
      const cleanTitle = draftClassTitle.trim().toUpperCase();
      const cleanSubject = draftClassSubject.trim().toUpperCase();
      const cleanSection = draftClassSection.trim().toUpperCase();
      const cleanRoom = draftClassRoom.trim().toUpperCase();
      const cleanSchedule = draftClassSchedule.trim().toUpperCase();

      let encodedSection = cleanSection;
      if (cleanSchedule) {
        encodedSection = encodedSection ? `${encodedSection} || ${cleanSchedule}` : `|| ${cleanSchedule}`;
      }

      const { error } = await supabase
        .from("classrooms")
        .update({
          title: cleanTitle,
          subject: cleanSubject || null,
          section: encodedSection || null,
          room: cleanRoom || null,
        })
        .eq("id", id);

      if (error) throw error;

      setClassroomTitle(cleanTitle);
      setClassroomSubject(cleanSubject);
      setClassroomSection(cleanSection);
      setClassroomRoom(cleanRoom);
      setClassroomSchedule(cleanSchedule);
      Keyboard.dismiss();
      setEditClassModalVisible(false);
    } catch (err: any) {
      Alert.alert("Update Failed", err.message || "Could not update classroom details.");
    } finally {
      setSavingClassEdit(false);
    }
  }

  function promptDeleteClassroom() {
    setClassMenuVisible(false);
    setConfirmDeleteClassModal(true);
  }

  async function handleConfirmDeleteClassroom() {
    if (!id || isDeletingClass) return;
    setIsDeletingClass(true);

    try {
      // 1. Delete all students enrolled in this classroom
      await supabase.from("students").delete().eq("classroom_id", id);

      // 2. Delete the classroom record
      const { error } = await supabase.from("classrooms").delete().eq("id", id);
      if (error) throw error;

      // 3. Purge related alerts and quiz storage
      await Promise.all([
        deleteClassroomAlerts(id),
        deleteClassroomQuizzes(id),
      ]);

      setConfirmDeleteClassModal(false);
      router.replace("/homepage");
    } catch (err: any) {
      console.error("Failed to delete classroom:", err);
      Alert.alert("Error Deleting Classroom", err.message || "Failed to delete classroom from database.");
      setIsDeletingClass(false);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadStudents();
  }, []);

  // Auto-switch to initialTab if param changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab as Tab);
    }
  }, [initialTab]);

  // Auto-open requested student profile preview once when redirected from notification alert
  useEffect(() => {
    const targetKey = `${openStudentId || ""}:::${openStudentName || ""}`;
    if (
      (openStudentId || openStudentName) &&
      students.length > 0 &&
      handledOpenStudentRef.current !== targetKey
    ) {
      const match = students.find(
        (s) =>
          (openStudentId && s.id === openStudentId) ||
          (openStudentName && s.full_name.toLowerCase() === openStudentName.toLowerCase())
      );
      if (match) {
        handledOpenStudentRef.current = targetKey;
        setSelectedProfile(match);
        // Automatically mark as read when viewed
        const toMark = [
          match.id,
          `flag_${match.id}`,
          `alert_${match.id}`,
          ...(openStudentId ? [openStudentId, `flag_${openStudentId}`, `alert_${openStudentId}`] : []),
        ];
        markAlertsAsRead(toMark).then(() => {
          loadClassroomAlerts();
        });
      }
    }
  }, [students, openStudentId, openStudentName, loadClassroomAlerts]);

  useEffect(() => {
    if (id) {
      getPublishedQuizzes(id).then(setPublishedQuizzes);
    }
  }, [id, activeTab]);

  async function loadStudents() {
    setLoading(true);
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("classroom_id", id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setStudents(data.map((row) => normalizeStudentRecord(row) as Student));
    } else {
      setStudents([]);
    }
    setLoading(false);
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────
  function openAddModal() {
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setEmail("");
    setModalVisible(true);
  }

  function handleCancel() {
    Keyboard.dismiss();
    setModalVisible(false);
  }

  async function handleAddStudent() {
    if (!lastName.trim() || !firstName.trim() || saving) return;
    setSaving(true);

    const cleanLast = lastName.trim();
    const cleanFirst = firstName.trim();
    const cleanMiddle = middleName.trim() || null;
    const computedFull = formatStudentFullName({
      last_name: cleanLast,
      first_name: cleanFirst,
      middle_name: cleanMiddle,
    });

    const alreadyExists = isDuplicateStudent(
      {
        lastName: cleanLast,
        firstName: cleanFirst,
        middleName: cleanMiddle,
        fullName: computedFull,
        email: email.trim() || null,
        selected: true,
      },
      students
    );

    if (alreadyExists) {
      setSaving(false);
      Alert.alert(
        "Student Already in Roster",
        `${computedFull} is already registered in this classroom.`
      );
      return;
    }

    let { data, error } = await supabase
      .from("students")
      .insert({
        classroom_id: id,
        last_name: cleanLast,
        first_name: cleanFirst,
        middle_name: cleanMiddle,
        full_name: computedFull,
        email: email.trim() || null,
        attendance: 100,
        average: 0,
      })
      .select()
      .single();

    if (error && (error.code === "PGRST204" || error.message?.includes("last_name") || error.message?.includes("first_name"))) {
      const retry = await supabase
        .from("students")
        .insert({
          classroom_id: id,
          full_name: computedFull,
          email: email.trim() || null,
          attendance: 100,
          average: 0,
        })
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (!error && data) {
      setStudents((prev) => [...prev, normalizeStudentRecord(data) as Student]);
    } else if (error) {
      Alert.alert("Error adding student", error.message);
    }

    Keyboard.dismiss();
    setSaving(false);
    setModalVisible(false);
  }

  // ── Edit Student Handlers ───────────────────────────────────────────────────
  function openEditModal(student: Student | null) {
    if (!student) return;
    const norm = normalizeStudentRecord(student);
    setStudentToEdit(norm);
    setEditLastName(norm.last_name || "");
    setEditFirstName(norm.first_name || "");
    setEditMiddleName(norm.middle_name || "");
    setEditEmail(norm.email || "");
    setEditModalVisible(true);
  }

  function handleCancelEdit() {
    Keyboard.dismiss();
    setEditModalVisible(false);
    setStudentToEdit(null);
  }

  async function handleSaveEditStudent() {
    if (!studentToEdit || !editLastName.trim() || !editFirstName.trim() || savingEdit) return;
    setSavingEdit(true);

    try {
      const cleanLast = editLastName.trim();
      const cleanFirst = editFirstName.trim();
      const cleanMiddle = editMiddleName.trim() ? editMiddleName.trim() : null;
      const updatedName = formatStudentFullName({
        last_name: cleanLast,
        first_name: cleanFirst,
        middle_name: cleanMiddle,
      });
      const updatedEmail = editEmail.trim() ? editEmail.trim() : null;

      let { error } = await supabase
        .from("students")
        .update({
          last_name: cleanLast,
          first_name: cleanFirst,
          middle_name: cleanMiddle,
          full_name: updatedName,
          email: updatedEmail,
        })
        .eq("id", studentToEdit.id);

      if (error && (error.code === "PGRST204" || error.message?.includes("last_name") || error.message?.includes("first_name"))) {
        const retry = await supabase
          .from("students")
          .update({
            full_name: updatedName,
            email: updatedEmail,
          })
          .eq("id", studentToEdit.id);
        error = retry.error;
      }

      if (error) throw error;

      // Update student in local roster state
      setStudents((prev) =>
        prev.map((s) =>
          s.id === studentToEdit.id
            ? {
                ...s,
                last_name: cleanLast,
                first_name: cleanFirst,
                middle_name: cleanMiddle,
                full_name: updatedName,
                email: updatedEmail,
              }
            : s
        )
      );

      // Update selected profile view if open
      if (selectedProfile && selectedProfile.id === studentToEdit.id) {
        setSelectedProfile((prev) =>
          prev
            ? {
                ...prev,
                last_name: cleanLast,
                first_name: cleanFirst,
                middle_name: cleanMiddle,
                full_name: updatedName,
                email: updatedEmail,
              }
            : null
        );
      }

      Keyboard.dismiss();
      setSavingEdit(false);
      setEditModalVisible(false);
      setStudentToEdit(null);
    } catch (err: any) {
      console.error("Failed to update student:", err);
      Alert.alert("Update Failed", err.message || "Failed to update student record.");
      setSavingEdit(false);
    }
  }

  // ── Import Classlist Handler ────────────────────────────────────────────────
  async function handleImportRecord() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv",
          "application/csv",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      setIsParsing(true);
      setImportModalVisible(true);

      const parsed = await parseClasslistFile(file.uri, file.name);

      // Flag duplicates against current roster
      const flaggedStudents = parsed.students.map((s) => ({
        ...s,
        selected: !isDuplicateStudent(s, students),
      }));

      setImportResult(parsed);
      setImportStudents(flaggedStudents);
      setIsParsing(false);
    } catch (err: any) {
      setIsParsing(false);
      setImportModalVisible(false);
      console.error("Import error:", err);
      Alert.alert(
        "Import Failed",
        err.message || "Could not parse the classlist file. Please check the format."
      );
    }
  }

  function toggleImportStudent(index: number) {
    setImportStudents((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s))
    );
  }

  function toggleAllImportStudents() {
    const allSelected = importStudents.every((s) => s.selected);
    setImportStudents((prev) => prev.map((s) => ({ ...s, selected: !allSelected })));
  }

  async function handleConfirmImport() {
    if (isImporting) return;
    const selectedStudents = importStudents.filter((s) => s.selected);
    if (selectedStudents.length === 0) {
      Alert.alert("No Students Selected", "Please select at least one student to import.");
      return;
    }

    setIsImporting(true);
    try {
      const inserts = selectedStudents.map((s) => ({
        classroom_id: id,
        last_name: s.lastName,
        first_name: s.firstName,
        middle_name: s.middleName || null,
        full_name: s.fullName,
        email: s.email || null,
        attendance: 100,
        average: 0,
      }));

      let { data, error } = await supabase
        .from("students")
        .insert(inserts)
        .select();

      if (error && (error.message?.includes("last_name") || error.message?.includes("first_name"))) {
        const fallbackInserts = selectedStudents.map((s) => ({
          classroom_id: id,
          full_name: s.fullName,
          email: s.email || null,
          attendance: 100,
          average: 0,
        }));
        const fallback = await supabase
          .from("students")
          .insert(fallbackInserts)
          .select();
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;

      if (data) {
        setStudents((prev) => [
          ...prev,
          ...(data as any[]).map((row) => normalizeStudentRecord(row) as Student),
        ]);
      }

      setImportModalVisible(false);
      setImportResult(null);
      setImportStudents([]);
      Alert.alert(
        "Import Successful",
        `${selectedStudents.length} student${selectedStudents.length > 1 ? "s" : ""} imported to this classroom.`
      );
    } catch (err: any) {
      console.error("Import insert error:", err);
      Alert.alert("Import Error", err.message || "Failed to insert students into the database.");
    } finally {
      setIsImporting(false);
    }
  }

  // ── Direct Download / Save To Phone Handler ──────────────────────────────────
  async function writeToSafDirectory(
    dirUri: string,
    fileName: string,
    mimeType: string,
    base64Data: string
  ): Promise<string> {
    const { StorageAccessFramework } = FileSystem;

    // 1. Delete any colliding file with the same name to prevent OEM filesystem errors
    try {
      const existing = await StorageAccessFramework.readDirectoryAsync(dirUri);
      const lowerName = fileName.toLowerCase();
      for (const itemUri of existing) {
        const decoded = decodeURIComponent(itemUri).toLowerCase();
        if (decoded.endsWith(`/${lowerName}`) || decoded.endsWith(`%2f${lowerName}`)) {
          await StorageAccessFramework.deleteAsync(itemUri).catch(() => { });
        }
      }
    } catch {
      // ignore read directory errors
    }

    // 2. Build list of MIME types to attempt (from specific to universal)
    const mimeCandidates: string[] = [];
    if (fileName.endsWith(".xlsx")) {
      mimeCandidates.push(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/octet-stream"
      );
    } else if (fileName.endsWith(".csv")) {
      mimeCandidates.push(
        "text/csv",
        "text/comma-separated-values",
        "text/plain",
        "application/octet-stream"
      );
    } else {
      mimeCandidates.push(mimeType, "application/octet-stream");
    }

    const uniqueMimes = Array.from(new Set(mimeCandidates));
    let lastError: any = null;

    // 3. Try creating file directly in selected directory
    for (const mime of uniqueMimes) {
      try {
        const fileUri = await StorageAccessFramework.createFileAsync(dirUri, fileName, mime);
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return fileUri;
      } catch (err: any) {
        lastError = err;
      }
    }

    // 4. If direct creation failed (e.g. Scoped Storage root Download restriction), try creating a "TSEKI" subfolder
    try {
      const subfolderUri = await StorageAccessFramework.makeDirectoryAsync(dirUri, "TSEKI");
      for (const mime of uniqueMimes) {
        try {
          const fileUri = await StorageAccessFramework.createFileAsync(subfolderUri, fileName, mime);
          await FileSystem.writeAsStringAsync(fileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return fileUri;
        } catch (err: any) {
          lastError = err;
        }
      }
    } catch {
      // Subfolder creation not allowed on this root
    }

    throw lastError || new Error("Failed to create file in selected directory.");
  }

  async function saveDirectlyToPhone(options: {
    fileName: string;
    mimeType: string;
    base64Data: string;
    forceNewFolder?: boolean;
  }) {
    const { fileName, mimeType, base64Data, forceNewFolder } = options;

    // Web: direct browser download
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = `data:${mimeType};base64,${base64Data}`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Alert.alert("Downloaded", `"${fileName}" has been downloaded to your browser.`);
      } catch (err: any) {
        Alert.alert("Download Failed", err.message || "Could not trigger download.");
      }
      return;
    }

    // Android: use StorageAccessFramework to download directly into phone storage
    if (Platform.OS === "android") {
      const { StorageAccessFramework } = FileSystem;
      if (!StorageAccessFramework) {
        Alert.alert("Error", "Storage Access Framework is not available on this device.");
        return;
      }

      let directoryUri: string | null = null;
      if (!forceNewFolder) {
        directoryUri = await AsyncStorage.getItem("tseki_export_directory_uri");
      }

      // If no folder remembered or forced new folder, prompt user with initialUri pointing to Documents
      if (!directoryUri) {
        let initialUri: string | null = null;
        try {
          initialUri = StorageAccessFramework.getUriForDirectoryInRoot("Documents");
        } catch {
          initialUri = null;
        }

        const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
        if (!perm.granted) {
          // User cancelled folder picker
          return;
        }
        directoryUri = perm.directoryUri;
      }

      // Try writing to directoryUri
      try {
        await writeToSafDirectory(directoryUri, fileName, mimeType, base64Data);
        // Successfully saved! Remember this working directory URI for all future downloads
        await AsyncStorage.setItem("tseki_export_directory_uri", directoryUri);

        Alert.alert(
          "Download Complete",
          `"${fileName}" has been downloaded directly to your phone.\n\nYou can access it in your phone's Files / Documents folder.`,
          [
            {
              text: "Open File",
              onPress: async () => {
                try {
                  const tempUri = `${FileSystem.cacheDirectory}${fileName}`;
                  await FileSystem.writeAsStringAsync(tempUri, base64Data, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                  if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(tempUri, {
                      mimeType,
                      dialogTitle: `Open ${fileName}`,
                    });
                  }
                } catch (openErr) {
                  console.warn("Could not open file:", openErr);
                }
              },
            },
            { text: "OK", style: "default" },
          ]
        );
        return;
      } catch (writeErr: any) {
        console.warn("Write to SAF directory failed:", writeErr);
        // Remove bad cached URI
        await AsyncStorage.removeItem("tseki_export_directory_uri");

        // Inform user clearly about Android restrictions on root Download and prompt for Documents/subfolder
        Alert.alert(
          "Storage Permission Notice",
          "Android does not allow saving directly into the root 'Download' folder.\n\nPlease select the 'Documents' folder or create/select a subfolder (like 'TSEKI') to complete the download.",
          [
            {
              text: "Select Folder",
              onPress: async () => {
                try {
                  let initialUri: string | null = null;
                  try {
                    initialUri = StorageAccessFramework.getUriForDirectoryInRoot("Documents");
                  } catch {
                    initialUri = null;
                  }
                  const retryPerm = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
                  if (retryPerm.granted) {
                    await writeToSafDirectory(retryPerm.directoryUri, fileName, mimeType, base64Data);
                    await AsyncStorage.setItem("tseki_export_directory_uri", retryPerm.directoryUri);
                    Alert.alert(
                      "Download Complete",
                      `"${fileName}" has been downloaded directly to your phone.\n\nYou can access it in your phone's Files / Documents folder.`,
                      [
                        {
                          text: "Open File",
                          onPress: async () => {
                            try {
                              const tempUri = `${FileSystem.cacheDirectory}${fileName}`;
                              await FileSystem.writeAsStringAsync(tempUri, base64Data, {
                                encoding: FileSystem.EncodingType.Base64,
                              });
                              if (await Sharing.isAvailableAsync()) {
                                await Sharing.shareAsync(tempUri, {
                                  mimeType,
                                  dialogTitle: `Open ${fileName}`,
                                });
                              }
                            } catch (e) {
                              console.warn("Open error:", e);
                            }
                          },
                        },
                        { text: "OK", style: "default" },
                      ]
                    );
                  }
                } catch (retryErr: any) {
                  Alert.alert("Download Error", retryErr.message || "Could not write file to the selected folder.");
                }
              },
            },
            { text: "Cancel", style: "cancel" },
          ]
        );
        return;
      }
    }

    // iOS: save to cache and open system share / Save to Files
    const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType,
        dialogTitle: `Download ${fileName}`,
        UTI: fileName.endsWith(".xlsx")
          ? "com.microsoft.excel.xlsx"
          : "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("Download Complete", `File saved to: ${fileUri}`);
    }
  }

  // ── Helper to build chronological quizzes & results for Excel/CSV exports ────
  async function getClassroomExportQuizData() {
    const quizResults = id ? await getAllStudentQuizResults(id as string) : [];
    // Sort publishedQuizzes oldest first so Quiz 1 is first created, Quiz 2 is second, etc.
    const chronologicalQuizzes = [...publishedQuizzes].reverse().map((q) => {
      const maxScore =
        (q.answerKey || []).reduce((sum, k) => sum + (k.points || 1), 0) || q.questions.length;
      return { id: q.id, quizTitle: q.quizTitle, maxScore };
    });

    // Also include any graded quiz titles found in quizResults that aren't in publishedQuizzes
    const knownTitles = new Set(chronologicalQuizzes.map((q) => q.quizTitle.toLowerCase().trim()));
    for (const r of quizResults) {
      const normTitle = (r.quizTitle || "").toLowerCase().trim();
      if (normTitle && !knownTitles.has(normTitle)) {
        knownTitles.add(normTitle);
        chronologicalQuizzes.push({
          id: r.quizId || r.quizTitle,
          quizTitle: r.quizTitle,
          maxScore: r.maxScore || 0,
        });
      }
    }

    const results = quizResults.map((r) => ({
      studentId: r.studentId,
      studentName: r.studentName,
      quizTitle: r.quizTitle,
      totalScore: r.totalScore,
    }));

    return { quizzes: chronologicalQuizzes, results };
  }

  // ── Export Classlist Template Handler ────────────────────────────────────────
  async function handleDownloadTemplate(forceNewFolder = false) {
    const runId = ++exportRunIdRef.current;
    try {
      setIsExporting(true);
      const base64 = generateExcelTemplateBase64({
        classroomTitle: title || "Classroom",
        subject: classroomSubject,
        section: classroomSection,
        room: classroomRoom,
        schedule: classroomSchedule,
      });

      const cleanTitle = (title || "Classroom").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `${cleanTitle}_BSIT4_Template.xlsx`;
      const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      if (exportRunIdRef.current !== runId) return;
      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      if (exportRunIdRef.current !== runId) return;
      console.error("Template download error:", err);
      Alert.alert("Download Failed", err.message || "Could not generate template.");
    } finally {
      if (exportRunIdRef.current === runId) {
        setIsExporting(false);
      }
    }
  }



  async function handleExportQuizScores(forceNewFolder = false) {
    if (students.length === 0) {
      Alert.alert("No Data", "There are no students in this classroom to export scores for.");
      return;
    }

    const runId = ++exportRunIdRef.current;
    try {
      setIsExporting(true);
      const { quizzes, results } = await getClassroomExportQuizData();
      if (exportRunIdRef.current !== runId) return;

      const base64 = generateExcelClasslistBase64({
        classroomTitle: (title as string) || "Classroom",
        subject: classroomSubject,
        section: classroomSection,
        room: classroomRoom,
        schedule: classroomSchedule,
        students,
        quizzes,
        results,
      });

      const cleanTitle = ((title as string) || "Classroom").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `${cleanTitle}_quiz_scores.xlsx`;
      const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      if (exportRunIdRef.current !== runId) return;
      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      if (exportRunIdRef.current !== runId) return;
      console.error("Quiz scores export error:", err);
      Alert.alert("Export Failed", err.message || "Could not export quiz scores.");
    } finally {
      if (exportRunIdRef.current === runId) {
        setIsExporting(false);
      }
    }
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.last_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.first_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.middle_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const tabs: Tab[] = ["Record", "AI Builder", "Grader", "Tracker"];
  const cardColor = color || ORANGE;
  const { darkMode } = useTheme();

  // ── Dynamic theme colors ──────────────────────────────────────────────────
  const bg = darkMode ? "#111827" : "#F9FAFB";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#1F2937";
  const textSub = darkMode ? "#9CA3AF" : "#6B7280";
  const border = darkMode ? "#374151" : "#E5E7EB";
  const subBorder = darkMode ? "#374151" : "#F3F4F6";
  const inputBg = darkMode ? "#374151" : "#F9FAFB";
  const btnSecondaryBg = darkMode ? "#374151" : "#F3F4F6";

  // ── Render ─────────────────────────────────────────────────────────────────
  const subtitleParts: string[] = [];
  if (classroomSubject && classroomSubject.toUpperCase() !== (classroomTitle || title || "").toUpperCase()) {
    subtitleParts.push(classroomSubject);
  }
  if (classroomSection) {
    subtitleParts.push(
      /^\d+$/.test(classroomSection.trim())
        ? `Section ${classroomSection.trim()}`
        : classroomSection
    );
  }
  if (classroomRoom) {
    subtitleParts.push(
      classroomRoom.toLowerCase().startsWith("room")
        ? classroomRoom
        : `Room ${classroomRoom}`
    );
  }
  if (classroomSchedule) {
    subtitleParts.push(classroomSchedule);
  }
  const bannerSubtitleLine = subtitleParts.join(" · ");

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Top App Bar ── */}
      <View style={[styles.topBar, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <View style={[styles.backIconCircle, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}>
            <Ionicons name="chevron-back" size={18} color={textMain} />
          </View>
          <Text style={[styles.backText, { color: textMain }]}>Classrooms</Text>
        </TouchableOpacity>

        {/* Centered title omitted because the classroom banner directly below already displays it */}
        <View style={{ flex: 1 }} />

        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={[
              styles.notifDot,
              {
                backgroundColor:
                  classroomUnreadCount > 0
                    ? darkMode
                      ? "#431407"
                      : "#FFF7ED"
                    : darkMode
                      ? "#374151"
                      : "#F8FAFC",
                borderColor:
                  classroomUnreadCount > 0
                    ? darkMode
                      ? "#7C2D12"
                      : "#FED7AA"
                    : border,
                borderWidth: 1,
              },
            ]}
            onPress={handleOpenNotifModal}
            activeOpacity={0.8}
            accessibilityLabel={
              classroomUnreadCount > 0
                ? `Classroom alerts, ${classroomUnreadCount} unread`
                : "Classroom alerts"
            }
          >
            <Ionicons
              name={classroomUnreadCount > 0 ? "notifications" : "notifications-outline"}
              size={18}
              color={classroomUnreadCount > 0 ? "#EA580C" : textMain}
            />
            {classroomUnreadCount > 0 ? (
              <View
                style={[
                  styles.topBarBadge,
                  { borderColor: darkMode ? "#1F2937" : "#FFFFFF" },
                ]}
              >
                <Text style={styles.topBarBadgeText}>
                  {classroomUnreadCount > 9 ? "9+" : classroomUnreadCount}
                </Text>
              </View>
            ) : classroomAlerts.length > 0 ? (
              <View
                style={[
                  styles.topBarSubtleDot,
                  { borderColor: darkMode ? "#1F2937" : "#FFFFFF" },
                ]}
              />
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.topBarActionBtn, { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border, borderWidth: 1 }]}
            onPress={() => setClassMenuVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel="More classroom options"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={textMain} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={[styles.scroll, { backgroundColor: bg }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Class Banner (Full on Record, Compact on Utility Tabs) ── */}
        <View
          style={[
            styles.banner,
            activeTab !== "Record" && styles.bannerCompact,
            { backgroundColor: cardColor },
          ]}
        >
          <View style={styles.bannerStripe} />
          <Text style={[styles.bannerTitle, activeTab !== "Record" && styles.bannerTitleCompact]}>
            {classroomTitle || title}
          </Text>
          {bannerSubtitleLine ? (
            <Text style={styles.bannerSubtitleText}>
              {bannerSubtitleLine}
            </Text>
          ) : null}
        </View>

        {/* ── Underline Tab Bar ── */}
        <View style={[styles.tabBar, { backgroundColor: cardBg, borderBottomColor: darkMode ? "#334155" : "#E2E8F0" }]}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tab,
                  isActive && [
                    styles.tabActive,
                    { borderBottomColor: darkMode ? "#F8FAFC" : "#0F172A" },
                  ],
                ]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? (darkMode ? "#F8FAFC" : "#0F172A") : "#64748B" },
                    isActive && styles.tabTextActive,
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Tab Content ── */}
        {activeTab === "Record" && (
          <>
            {/* ── Action Toolbar ── */}
            <View style={[styles.actionRow, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
              <TouchableOpacity
                style={[
                  styles.secondaryToolbarBtn,
                  {
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                  },
                ]}
                activeOpacity={0.8}
                onPress={handleImportRecord}
              >
                <Ionicons name="cloud-upload-outline" size={16} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                <Text style={[styles.secondaryToolbarBtnText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                  Import
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.secondaryToolbarBtn,
                  {
                    backgroundColor: isExporting
                      ? darkMode
                        ? "rgba(239, 68, 68, 0.14)"
                        : "#FEF2F2"
                      : darkMode
                        ? "#1F2937"
                        : "#FFFFFF",
                    borderColor: isExporting
                      ? darkMode
                        ? "rgba(248, 113, 113, 0.4)"
                        : "#FECACA"
                      : darkMode
                        ? "#475569"
                        : "#CBD5E1",
                  },
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  if (isExporting) {
                    handleCancelClassroomExport();
                  } else {
                    setExportModalVisible(true);
                  }
                }}
                accessibilityLabel={isExporting ? "Cancel Excel export" : "Export Excel"}
              >
                {isExporting ? (
                  <>
                    <ActivityIndicator size="small" color={darkMode ? "#FCA5A5" : "#DC2626"} />
                    <Text style={[styles.secondaryToolbarBtnText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>
                      Cancel Export
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name="download-outline"
                      size={16}
                      color={darkMode ? "#F8FAFC" : "#0F172A"}
                    />
                    <Text style={[styles.secondaryToolbarBtnText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                      Export Excel
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryToolbarBtn, { backgroundColor: cardColor }]}
                onPress={openAddModal}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={17} color="#FFFFFF" />
                <Text style={styles.primaryToolbarBtnText}>Add Student</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {activeTab === "AI Builder" && (
          <AIBuilderTab
            classroomId={id as string}
            classTitle={(classroomTitle || title) as string}
            classSubject={classroomSubject}
            classSection={classroomSection}
            accentColor={cardColor}
            onQuizPublished={(quizTitle) => {
              setSelectedGradingQuiz(quizTitle);
              setActiveTab("Grader");
            }}
          />
        )}

        {activeTab === "Grader" && (
          <GraderTab
            classroomId={id as string}
            classTitle={(classroomTitle || title) as string}
            accentColor={cardColor}
            students={students}
            defaultSelectedQuiz={selectedGradingQuiz}
            onScoreRecorded={(studentId, newAvg) => {
              setStudents((prev) =>
                prev.map((s) => (s.id === studentId ? { ...s, average: newAvg } : s))
              );
              setSelectedProfile((prev) =>
                prev && prev.id === studentId ? { ...prev, average: newAvg } : prev
              );
              if (id && selectedProfile?.id === studentId) {
                getStudentResults(id as string, studentId, selectedProfile.full_name).then(
                  setStudentQuizResults
                );
              }
              loadClassroomAlerts();
            }}
            onStudentCreated={(newStudent) => {
              setStudents((prev) =>
                prev.some((s) => s.id === newStudent.id) ? prev : [...prev, newStudent]
              );
              loadClassroomAlerts();
            }}
          />
        )}

        {activeTab === "Tracker" && (
          <>
            <View style={[styles.actionRow, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
              <TouchableOpacity
                style={[
                  styles.secondaryToolbarBtn,
                  {
                    flex: 1,
                    backgroundColor: isExporting
                      ? darkMode
                        ? "rgba(239, 68, 68, 0.14)"
                        : "#FEF2F2"
                      : darkMode
                        ? "#1F2937"
                        : "#FFFFFF",
                    borderColor: isExporting
                      ? darkMode
                        ? "rgba(248, 113, 113, 0.4)"
                        : "#FECACA"
                      : darkMode
                        ? "#475569"
                        : "#CBD5E1",
                  },
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  if (isExporting) {
                    handleCancelClassroomExport();
                  } else {
                    handleExportQuizScores(false);
                  }
                }}
                accessibilityLabel={isExporting ? "Cancel quiz scores export" : "Export Quiz Scores"}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color={darkMode ? "#FCA5A5" : "#DC2626"} />
                ) : (
                  <Ionicons name="grid-outline" size={16} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                )}
                <Text
                  style={[
                    styles.secondaryToolbarBtnText,
                    { color: isExporting ? (darkMode ? "#FCA5A5" : "#DC2626") : darkMode ? "#F8FAFC" : "#0F172A" },
                  ]}
                >
                  {isExporting ? "Cancel Export" : "Export Quiz Scores (.xlsx)"}
                </Text>
              </TouchableOpacity>
            </View>
          <TrackerTab
            classroomId={id as string}
            classTitle={(classroomTitle || title) as string}
            classSubject={classroomSubject}
            accentColor={cardColor}
            students={students}
            publishedQuizzes={publishedQuizzes}
            selectedQuizTitle={selectedGradingQuiz}
            onOpenStudentProfile={(student) => setSelectedProfile(student)}
            onNavigateToAIBuilder={() => setActiveTab("AI Builder")}
            onNavigateToGrader={(quizTitle) => {
              if (quizTitle) {
                setSelectedGradingQuiz(quizTitle);
              }
              setActiveTab("Grader");
            }}
          />
          </>
        )}

        {activeTab === "Record" && (
          <>
            {/* ── Search Bar ── */}
            <View style={[styles.searchBar, { backgroundColor: cardBg, borderColor: darkMode ? border : "#E2E8F0" }]}>
              <Ionicons name="search-outline" size={17} color="#64748B" />
              <TextInput
                style={[styles.searchInput, { color: textMain }]}
                placeholder="Search students by name or email..."
                placeholderTextColor="#94A3B8"
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={17} color={textSub} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Roster Header ── */}
            <View style={styles.rosterHeader}>
              <Text style={[styles.rosterTitle, { color: textMain }]}>
                Student Roster ({filtered.length})
              </Text>
              <Text style={[styles.rosterHint, { color: textSub }]}>Tap student to view profile</Text>
            </View>

            {/* ── Student List ── */}
            {loading ? (
              <ActivityIndicator
                size="large"
                color={cardColor}
                style={{ marginVertical: 40 }}
              />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={44} color={darkMode ? "#4B5563" : "#CBD5E1"} />
                <Text style={[styles.emptyTitle, { color: textSub }]}>No students yet</Text>
                <Text style={[styles.emptySub, { color: textSub }]}>
                  Tap{" "}
                  <Text style={{ color: textMain, fontWeight: "600" }}>+ Add Student</Text>{" "}
                  or{" "}
                  <Text style={{ color: textMain, fontWeight: "600" }}>Import</Text>{" "}
                  above to add your roster.
                </Text>
              </View>
            ) : (
              filtered.map((student) => {
                const avg = student.average ?? 0;
                const isFlagged = avg < 75;
                const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
                const isTop = avg >= 85 && avg === highestAvg;
                const avatarUri = getStudentAvatar(student.full_name);

                return (
                  <TouchableOpacity
                    key={student.id}
                    style={[
                      styles.studentRow,
                      {
                        backgroundColor: cardBg,
                        borderColor: darkMode ? "#334155" : "#E5E7EB",
                      },
                    ]}
                    onPress={() => setSelectedProfile(student)}
                    activeOpacity={0.75}
                  >
                    {/* 36px Neutral Avatar */}
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                    ) : (
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: darkMode ? "#334155" : "#F1F5F9" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.avatarText,
                            { color: darkMode ? "#E2E8F0" : "#334155" },
                          ]}
                        >
                          {getInitials(student.full_name)}
                        </Text>
                      </View>
                    )}

                    {/* Left Info: Full Student Name + Email */}
                    <View style={styles.studentInfo}>
                      <Text style={[styles.studentName, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                        {student.full_name}
                      </Text>
                      <Text style={[styles.studentEmail, { color: "#64748B" }]} numberOfLines={1}>
                        {student.email || "No email"}
                      </Text>
                    </View>

                    {/* Right Stats: Score + Single Semantic Pill + Subtle More Button */}
                    <View style={styles.studentStats}>
                      <View style={styles.statRightCol}>
                        <Text style={[styles.statValue, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                          {avg}%
                        </Text>
                        {isFlagged ? (
                          <View style={[styles.flaggedBadge, { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2" }]}>
                            <Text style={[styles.flaggedBadgeText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>
                              At-Risk
                            </Text>
                          </View>
                        ) : isTop ? (
                          <View style={[styles.topBadge, { backgroundColor: darkMode ? "#1E3A8A" : "#EFF6FF" }]}>
                            <Text style={[styles.topBadgeText, { color: darkMode ? "#93C5FD" : "#2563EB" }]}>
                              Top
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.statLabel, { color: "#64748B" }]}>Avg</Text>
                        )}
                      </View>

                      <TouchableOpacity
                        style={styles.studentMoreBtn}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setStudentMenuTarget(student);
                        }}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        activeOpacity={0.7}
                        accessibilityLabel="More options for student"
                      >
                        <Ionicons name="ellipsis-vertical" size={16} color="#64748B" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* ── Add New Student Modal ── */}
      <StudentFormModal
        visible={modalVisible}
        mode="add"
        lastName={lastName}
        firstName={firstName}
        middleName={middleName}
        email={email}
        onChangeLastName={setLastName}
        onChangeFirstName={setFirstName}
        onChangeMiddleName={setMiddleName}
        onChangeEmail={setEmail}
        saving={saving}
        onSubmit={handleAddStudent}
        onCancel={handleCancel}
        darkMode={darkMode}
        cardBg={cardBg}
        inputBg={inputBg}
        border={border}
        textMain={textMain}
        textSub={textSub}
        btnSecondaryBg={btnSecondaryBg}
      />

      {/* ── Edit Student Details Modal ── */}
      <StudentFormModal
        visible={editModalVisible}
        mode="edit"
        lastName={editLastName}
        firstName={editFirstName}
        middleName={editMiddleName}
        email={editEmail}
        onChangeLastName={setEditLastName}
        onChangeFirstName={setEditFirstName}
        onChangeMiddleName={setEditMiddleName}
        onChangeEmail={setEditEmail}
        saving={savingEdit}
        onSubmit={handleSaveEditStudent}
        onCancel={handleCancelEdit}
        darkMode={darkMode}
        cardBg={cardBg}
        inputBg={inputBg}
        border={border}
        textMain={textMain}
        textSub={textSub}
        btnSecondaryBg={btnSecondaryBg}
      />

      {/* ── Student Profile Modal (Bottom Sheet) ── */}
      <Modal
        visible={selectedProfile !== null && !confirmDeleteStudentModal && !editModalVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {
          if (editingGradeEntry) {
            if (!savingGradeEdit) setEditingGradeEntry(null);
          } else if (gradeEntryToDelete) {
            if (!deletingGradeEntry) setGradeEntryToDelete(null);
          } else {
            setSelectedProfile(null);
          }
        }}
      >
        <View style={styles.profileModalOverlay}>
          {/* Backdrop dismiss touchable */}
          <TouchableWithoutFeedback onPress={() => setSelectedProfile(null)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          {selectedProfile && (() => {
            const profileAvg = selectedProfile.average ?? 0;
            const isNeedsSupport = profileAvg < 75;
            const isTopPerformer = profileAvg >= 85;
            const isPassing = profileAvg >= 75 && profileAvg < 85;
            const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
            const firstName = selectedProfile.first_name || selectedProfile.full_name.replace(/,/g, " ").trim().split(/\s+/)[0];
            const profileAvatar = getStudentAvatar(selectedProfile.full_name);

            const sortedStudentResults = [...studentQuizResults].sort(
              (a, b) => new Date(b.gradedAt || 0).getTime() - new Date(a.gradedAt || 0).getTime()
            );
            const latestResult = sortedStudentResults.length > 0 ? sortedStudentResults[0] : null;
            const quizTitleDisplay =
              latestResult?.quizTitle ||
              publishedQuizzes[0]?.quizTitle ||
              selectedGradingQuiz ||
              classroomSubject ||
              (schedule !== "No Subject" ? schedule : "") ||
              "Assessment";

            const quizTotalPoints = latestResult?.maxScore || publishedQuizzes[0]?.questions?.length || 10;
            const quizScore = latestResult?.totalScore ?? Math.round((profileAvg / 100) * quizTotalPoints);
            const quizPercentage = quizTotalPoints > 0
              ? Math.round((quizScore / quizTotalPoints) * 100)
              : profileAvg;
            const belowPassingAssessments = sortedStudentResults.filter((r) => {
              const pct =
                typeof r.scorePercentage === "number" && !Number.isNaN(r.scorePercentage)
                  ? r.scorePercentage
                  : r.maxScore > 0
                  ? Math.round((r.totalScore / r.maxScore) * 100)
                  : 0;
              return pct < 75;
            });

            const hasActiveGradeOverlay = Boolean(editingGradeEntry || gradeEntryToDelete);

            return (
              <View
                style={[
                  styles.profileModalCard,
                  { backgroundColor: cardBg },
                  hasActiveGradeOverlay && { elevation: 0 },
                ]}
                pointerEvents={hasActiveGradeOverlay ? "none" : "auto"}
              >
                {/* Header (Clean White Sheet Header with Drag Handle) */}
                <View style={[styles.profileHeader, { backgroundColor: cardBg, borderBottomColor: border }]}>
                  <View style={styles.sheetDragHandle} />
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={styles.profileHeaderLeft}>
                      {profileAvatar ? (
                        <Image source={{ uri: profileAvatar }} style={styles.profileAvatarImg} />
                      ) : (
                        <View style={[styles.profileAvatarFallback, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9", borderColor: border }]}>
                          <Text style={[styles.profileAvatarFallbackText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                            {getInitials(selectedProfile.full_name)}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.profileName, { color: textMain }]} numberOfLines={2}>
                          {selectedProfile.full_name}
                        </Text>
                        {selectedProfile.email ? (
                          <Text style={[styles.profileEmail, { color: textSub }]} numberOfLines={1}>
                            {selectedProfile.email}
                          </Text>
                        ) : (
                          <TouchableOpacity onPress={() => openEditModal(selectedProfile)} style={{ marginTop: 2 }}>
                            <Text style={{ fontSize: 13, color: ORANGE, fontWeight: "600" }}>+ Add email</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.profileCloseBtn, { backgroundColor: darkMode ? "#334155" : "#F8FAFC", borderColor: border }]}
                      onPress={() => setSelectedProfile(null)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={18} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Scrollable Body Content */}
                <ScrollView
                  style={[styles.profileScroll, { backgroundColor: bg }]}
                  contentContainerStyle={styles.profileBody}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled={true}
                >
                  {/* Sleek Single-Row Inline Callout for Missing Email */}
                  {!selectedProfile.email && (
                    <View
                      style={[
                        styles.compactMissingEmailBanner,
                        {
                          backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                          borderColor: darkMode ? "#334155" : "#E2E8F0",
                        },
                      ]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        <Ionicons name="mail-outline" size={16} color={darkMode ? "#94A3B8" : "#64748B"} />
                        <Text style={[styles.compactMissingEmailText, { color: darkMode ? textSub : "#64748B" }]}>
                          No email linked
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => openEditModal(selectedProfile)}
                        style={[styles.compactAddEmailBtn, { borderColor: darkMode ? "#475569" : "#CBD5E1", backgroundColor: cardBg }]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.compactAddEmailBtnText, { color: darkMode ? textMain : "#0F172A" }]}>
                          + Add Email
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Stats Row */}
                  <View style={styles.profileStatsRow}>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>AVERAGE</Text>
                      <Text style={[styles.statBoxValue, { color: textMain }]}>{profileAvg}%</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>STATUS</Text>
                      {isTopPerformer ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#064E3B" : "#F0FDF4" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#86EFAC" : "#15803D" }]}>Top Performer</Text>
                        </View>
                      ) : isPassing ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#CBD5E1" : "#334155" }]}>Passing</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>At-Risk</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* At-Risk Warning Flag (Only if below 75% passing threshold) */}
                  {isNeedsSupport && (
                    <View style={[styles.atRiskCard, { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2", borderColor: darkMode ? "#7F1D1D" : "#FECACA" }]}>
                      <Ionicons name="warning-outline" size={20} color={darkMode ? "#FCA5A5" : "#DC2626"} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.atRiskTitle, { color: darkMode ? "#FCA5A5" : "#991B1B" }]}>At-Risk Behavioral Flag</Text>
                        <Text style={[styles.atRiskSub, { color: darkMode ? "#F87171" : "#DC2626" }]}>
                          {belowPassingAssessments.length > 1
                            ? `${belowPassingAssessments.length} of ${sortedStudentResults.length} recorded assessments below 75% passing threshold (Overall avg: ${profileAvg}%)`
                            : `${belowPassingAssessments[0]?.quizTitle || quizTitleDisplay} score below 75% passing threshold`}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Quiz Grade Sheet — Lists ALL recorded assessments for this student */}
                  <View style={styles.quizSheetSection}>
                    <View style={[styles.quizSheetHeader, { justifyContent: "space-between" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="book-outline" size={14} color={textSub} />
                        <Text style={[styles.quizSheetTitle, { color: textSub }]}>QUIZ GRADE SHEET</Text>
                      </View>
                      {sortedStudentResults.length > 0 && (
                        <Text style={{ fontSize: 11.5, fontWeight: "600", color: textSub }}>
                          {sortedStudentResults.length}{" "}
                          {sortedStudentResults.length === 1 ? "Assessment" : "Assessments"}
                        </Text>
                      )}
                    </View>

                    {sortedStudentResults.length > 0 ? (
                      <View style={{ gap: 10 }}>
                        {sortedStudentResults.slice(0, profileVisibleAssessments).map((res, idx) => {
                          const maxPts = Number(res.maxScore) || 0;
                          const rawPts = Number(res.totalScore) || 0;
                          const pct =
                            typeof res.scorePercentage === "number" && !Number.isNaN(res.scorePercentage)
                              ? Math.round(res.scorePercentage)
                              : maxPts > 0
                              ? Math.round((rawPts / maxPts) * 100)
                              : 0;
                          const isBelowPassing = pct < 75;
                          const gradedDateText = res.gradedAt
                            ? new Date(res.gradedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "";

                          return (
                            <View
                              key={`${res.quizId || res.quizTitle}-${idx}`}
                              style={[
                                styles.quizScoreCard,
                                {
                                  backgroundColor: cardBg,
                                  borderColor: border,
                                  flexDirection: "column",
                                  alignItems: "stretch",
                                  gap: 10,
                                },
                              ]}
                            >
                              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                <View style={{ flex: 1, marginRight: 12 }}>
                                  <Text style={[styles.quizScoreName, { color: textMain }]} numberOfLines={2}>
                                    {res.quizTitle || "Assessment"}
                                  </Text>
                                  <Text style={[styles.quizScoreSub, { color: textSub }]}>
                                    {maxPts > 0 ? `Total weight: ${maxPts} ${maxPts === 1 ? "point" : "points"}` : "Recorded assessment"}
                                    {gradedDateText ? ` · ${gradedDateText}` : ""}
                                  </Text>
                                </View>
                                <View style={{ alignItems: "flex-end" }}>
                                  <View style={styles.quizScoreNumRow}>
                                    <Text style={[styles.quizScoreNum, { color: textMain }]}>
                                      {rawPts} / {maxPts || "—"}
                                    </Text>
                                    <View
                                      style={[
                                        styles.quizScoreDot,
                                        { backgroundColor: isBelowPassing ? "#EF4444" : "#10B981" },
                                      ]}
                                    />
                                  </View>
                                  <Text style={[styles.quizScorePercent, { color: textSub }]}>({pct}%)</Text>
                                </View>
                              </View>

                              {/* Per-Assessment Edit / Delete Controls */}
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                  gap: 8,
                                  paddingTop: 8,
                                  borderTopWidth: 1,
                                  borderTopColor: darkMode ? "#334155" : "#F1F5F9",
                                }}
                              >
                                <TouchableOpacity
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 7,
                                    borderWidth: 1,
                                    borderColor: border,
                                    backgroundColor: darkMode ? "#0F172A" : "#F8FAFC",
                                  }}
                                  onPress={() => openEditGradeEntry(res)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.75}
                                >
                                  <Ionicons name="pencil-outline" size={12.5} color={textMain} />
                                  <Text style={{ fontSize: 11.5, fontWeight: "600", color: textMain }}>
                                    Edit
                                  </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 7,
                                    borderWidth: 1,
                                    borderColor: darkMode ? "#7F1D1D" : "#FECACA",
                                    backgroundColor: darkMode ? "#450A0A" : "#FEF2F2",
                                  }}
                                  onPress={() => {
                                    setEditingGradeEntry(null);
                                    setGradeEntryToDelete(res);
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  activeOpacity={0.75}
                                >
                                  <Ionicons name="trash-outline" size={12.5} color={darkMode ? "#FCA5A5" : "#DC2626"} />
                                  <Text style={{ fontSize: 11.5, fontWeight: "600", color: darkMode ? "#FCA5A5" : "#DC2626" }}>
                                    Delete
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}

                        {sortedStudentResults.length > 5 && (
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                            {sortedStudentResults.length > profileVisibleAssessments ? (
                              <>
                                <TouchableOpacity
                                  style={{
                                    flex: 1,
                                    paddingVertical: 10,
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: border,
                                    backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                  onPress={() => setProfileVisibleAssessments((prev) => prev + 5)}
                                  activeOpacity={0.75}
                                >
                                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: textMain }}>
                                    Show {Math.min(5, sortedStudentResults.length - profileVisibleAssessments)} More
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{
                                    flex: 1,
                                    paddingVertical: 10,
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: cardColor + "40",
                                    backgroundColor: cardColor + "16",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                  onPress={() => setProfileVisibleAssessments(sortedStudentResults.length)}
                                  activeOpacity={0.75}
                                >
                                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: cardColor }}>
                                    View All ({sortedStudentResults.length})
                                  </Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <TouchableOpacity
                                style={{
                                  flex: 1,
                                  paddingVertical: 10,
                                  borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: border,
                                  backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                onPress={() => setProfileVisibleAssessments(5)}
                                activeOpacity={0.75}
                              >
                                <Text style={{ fontSize: 12.5, fontWeight: "700", color: textSub }}>
                                  Show Less (Top 5)
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    ) : profileAvg > 0 ? (
                      <View style={[styles.quizScoreCard, { backgroundColor: cardBg, borderColor: border }]}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                          <Text style={[styles.quizScoreName, { color: textMain }]} numberOfLines={2}>
                            {quizTitleDisplay}
                          </Text>
                          <Text style={[styles.quizScoreSub, { color: textSub }]}>Total weight: {quizTotalPoints} points</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <View style={styles.quizScoreNumRow}>
                            <Text style={[styles.quizScoreNum, { color: textMain }]}>
                              {quizScore} / {quizTotalPoints}
                            </Text>
                            <View
                              style={[
                                styles.quizScoreDot,
                                { backgroundColor: isNeedsSupport ? "#EF4444" : "#10B981" },
                              ]}
                            />
                          </View>
                          <Text style={[styles.quizScorePercent, { color: textSub }]}>({quizPercentage}%)</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={[styles.quizScoreCard, { backgroundColor: cardBg, borderColor: border, justifyContent: "center" }]}>
                        <Text style={[styles.quizScoreSub, { color: textSub }]}>
                          No assessments graded yet for this student.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Tseki Pedagogical Advice */}
                  <View style={[styles.pedagogicalCard, { backgroundColor: darkMode ? "#292524" : "#FFFBEB", borderColor: darkMode ? "#44403C" : "#FED7AA" }]}>
                    <View style={styles.pedagogicalHeader}>
                      <Ionicons name="sparkles" size={15} color={darkMode ? "#34D399" : "#059669"} />
                      <Text style={[styles.pedagogicalTitle, { color: darkMode ? "#FDBA74" : "#9A3412" }]}>TSEKI PEDAGOGICAL ADVICE</Text>
                    </View>
                    <Text style={[styles.pedagogicalText, { color: darkMode ? "#D6D3D1" : "#475569" }]}>
                      {generateStudentAdvice({
                        studentName: selectedProfile.full_name,
                        average: profileAvg,
                        classAverage: students.length > 0 ? Math.round(students.reduce((sum, s) => sum + (s.average ?? 0), 0) / students.length) : 0,
                        highestAvg: highestAvg,
                        subject: classroomSubject || (schedule && schedule !== "No Subject" ? schedule : "") || "",
                        quizTitle: quizTitleDisplay,
                        difficulty: publishedQuizzes[0]?.difficulty,
                        totalStudents: students.length,
                        studentResults: studentQuizResults,
                      })}
                    </Text>
                  </View>
                </ScrollView>

                {/* Fixed Clean 3-Button Footer */}
                <View style={[styles.profileFooter, { backgroundColor: cardBg, borderTopColor: border }]}>
                  <TouchableOpacity
                    style={[styles.profileFooterBtn, { backgroundColor: cardBg, borderColor: border }]}
                    onPress={() => openEditModal(selectedProfile)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="pencil-outline" size={15} color={textMain} />
                    <Text style={[styles.profileFooterBtnText, { color: textMain }]}>Edit Student</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.profileFooterBtn, { backgroundColor: cardBg, borderColor: border }]}
                    onPress={() => {
                      if (selectedProfile.email) {
                        Linking.openURL(`mailto:${selectedProfile.email}`);
                      } else {
                        Alert.alert(
                          "No Email Recorded",
                          `${selectedProfile.full_name} does not have an email address recorded yet. Tap "Edit Student" to add their email.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Edit Student", onPress: () => openEditModal(selectedProfile) },
                          ]
                        );
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="mail-outline" size={15} color={textMain} />
                    <Text style={[styles.profileFooterBtnText, { color: textMain }]}>Email Report</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.profileDeleteBtn,
                      {
                        backgroundColor: darkMode ? "#450A0A" : "#FEF2F2",
                        borderColor: darkMode ? "#7F1D1D" : "#FECACA",
                      },
                    ]}
                    onPress={() => promptDeleteStudent(selectedProfile)}
                    activeOpacity={0.7}
                    accessibilityLabel="Delete student"
                  >
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {/* ── In-Modal Overlay: Edit Quiz Grade Entry ── */}
          {editingGradeEntry && (() => {
            const previewScore = Number(editGradeScore);
            const previewMax = Number(editGradeMaxScore);
            const previewValid =
              Number.isFinite(previewScore) &&
              Number.isFinite(previewMax) &&
              previewMax > 0 &&
              previewScore >= 0 &&
              previewScore <= previewMax;
            const previewPct = previewValid ? Math.round((previewScore / previewMax) * 100) : null;
            const previewPassing = previewPct !== null && previewPct >= 75;

            return (
              <View
                style={[
                  StyleSheet.absoluteFillObject,
                  {
                    zIndex: 100,
                    elevation: 24,
                  },
                ]}
              >
                <Pressable
                  style={[
                    StyleSheet.absoluteFillObject,
                    { backgroundColor: "rgba(15, 23, 42, 0.62)" },
                  ]}
                  onPress={() => {
                    if (!savingGradeEdit) {
                      Keyboard.dismiss();
                      setEditingGradeEntry(null);
                    }
                  }}
                />
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : "height"}
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    padding: 20,
                  }}
                  pointerEvents="box-none"
                >
                  <Pressable
                    onPress={(e) => e.stopPropagation()}
                    style={[
                      styles.confirmModalCard,
                      {
                        backgroundColor: cardBg,
                        borderColor: darkMode ? "#334155" : "#E2E8F0",
                        width: "100%",
                        maxWidth: 400,
                        elevation: 28,
                        zIndex: 101,
                      },
                    ]}
                  >
                  <Text style={[styles.confirmModalTitle, { color: textMain, marginBottom: 4 }]}>
                    Edit Quiz Grade
                  </Text>
                  <Text style={{ fontSize: 12.5, color: textSub, marginBottom: 14 }}>
                    Adjust the title or score. {selectedProfile?.full_name}&apos;s overall average will recalculate automatically.
                  </Text>

                  <Text style={{ fontSize: 12, fontWeight: "700", color: textSub, marginBottom: 6 }}>
                    ASSESSMENT TITLE
                  </Text>
                  <TextInput
                    style={{
                      borderWidth: 1,
                      borderColor: border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 14,
                      color: textMain,
                      backgroundColor: darkMode ? "#0F172A" : "#F8FAFC",
                      marginBottom: 12,
                    }}
                    value={editGradeTitle}
                    onChangeText={setEditGradeTitle}
                    placeholder="Assessment title"
                    placeholderTextColor={textSub}
                    editable={!savingGradeEdit}
                  />

                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: textSub, marginBottom: 6 }}>
                        SCORE EARNED
                      </Text>
                      <TextInput
                        style={{
                          borderWidth: 1,
                          borderColor: border,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          fontSize: 15,
                          fontWeight: "700",
                          color: textMain,
                          backgroundColor: darkMode ? "#0F172A" : "#F8FAFC",
                        }}
                        value={editGradeScore}
                        onChangeText={(t) => setEditGradeScore(t.replace(/[^0-9.]/g, ""))}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={textSub}
                        editable={!savingGradeEdit}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: textSub, marginBottom: 6 }}>
                        TOTAL POINTS
                      </Text>
                      <TextInput
                        style={{
                          borderWidth: 1,
                          borderColor: border,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          fontSize: 15,
                          fontWeight: "700",
                          color: textMain,
                          backgroundColor: darkMode ? "#0F172A" : "#F8FAFC",
                        }}
                        value={editGradeMaxScore}
                        onChangeText={(t) => setEditGradeMaxScore(t.replace(/[^0-9.]/g, ""))}
                        keyboardType="decimal-pad"
                        placeholder="10"
                        placeholderTextColor={textSub}
                        editable={!savingGradeEdit}
                      />
                    </View>
                  </View>

                  {previewPct !== null && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 8,
                        marginBottom: 16,
                        backgroundColor: previewPassing
                          ? darkMode ? "#064E3B40" : "#F0FDF4"
                          : darkMode ? "#450A0A40" : "#FEF2F2",
                        borderWidth: 1,
                        borderColor: previewPassing
                          ? darkMode ? "#065F46" : "#BBF7D0"
                          : darkMode ? "#7F1D1D" : "#FECACA",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12.5,
                          fontWeight: "700",
                          color: previewPassing
                            ? darkMode ? "#86EFAC" : "#15803D"
                            : darkMode ? "#FCA5A5" : "#DC2626",
                        }}
                      >
                        Updated Score: {previewScore} / {previewMax} ({previewPct}%)
                      </Text>
                      <Text
                        style={{
                          fontSize: 11.5,
                          fontWeight: "700",
                          color: previewPassing
                            ? darkMode ? "#86EFAC" : "#15803D"
                            : darkMode ? "#FCA5A5" : "#DC2626",
                        }}
                      >
                        {previewPassing ? "Passing" : "At-Risk"}
                      </Text>
                    </View>
                  )}

                  <View style={styles.confirmModalActions}>
                    <TouchableOpacity
                      style={[
                        styles.confirmCancelBtn,
                        { backgroundColor: cardBg, borderColor: darkMode ? "#4B5563" : "#CBD5E1" },
                      ]}
                      onPress={() => setEditingGradeEntry(null)}
                      disabled={savingGradeEdit}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.confirmCancelBtnText, { color: darkMode ? "#E2E8F0" : "#334155" }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.confirmDeleteBtn,
                        { backgroundColor: darkMode ? "#334155" : "#1E293B" },
                        (!previewValid || !editGradeTitle.trim() || savingGradeEdit) && styles.btnDisabled,
                      ]}
                      onPress={handleSaveGradeEdit}
                      disabled={!previewValid || !editGradeTitle.trim() || savingGradeEdit}
                      activeOpacity={0.85}
                    >
                      {savingGradeEdit ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.confirmDeleteBtnText}>Save Grade</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  </Pressable>
                </KeyboardAvoidingView>
              </View>
            );
          })()}

          {/* ── In-Modal Overlay: Delete Quiz Grade Confirmation ── */}
          {gradeEntryToDelete && (
            <View
              style={[
                StyleSheet.absoluteFillObject,
                {
                  zIndex: 100,
                  elevation: 24,
                },
              ]}
            >
              <Pressable
                style={[
                  StyleSheet.absoluteFillObject,
                  { backgroundColor: "rgba(15, 23, 42, 0.62)" },
                ]}
                onPress={() => !deletingGradeEntry && setGradeEntryToDelete(null)}
              />
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 20,
                }}
                pointerEvents="box-none"
              >
                <Pressable
                  onPress={(e) => e.stopPropagation()}
                  style={[
                    styles.confirmModalCard,
                    {
                      backgroundColor: cardBg,
                      borderColor: darkMode ? "#334155" : "#E2E8F0",
                      width: "100%",
                      maxWidth: 380,
                      elevation: 28,
                      zIndex: 101,
                    },
                  ]}
                >
                <Text style={[styles.confirmModalTitle, { color: textMain }]}>
                  Delete Quiz Grade?
                </Text>
                <Text style={[styles.confirmModalDesc, { color: textSub }]}>
                  Are you sure you want to delete{" "}
                  <Text style={{ fontWeight: "700", color: textMain }}>
                    {`"${gradeEntryToDelete.quizTitle}"`}
                  </Text>{" "}
                  ({gradeEntryToDelete.totalScore} / {gradeEntryToDelete.maxScore}) from{" "}
                  <Text style={{ fontWeight: "700", color: textMain }}>
                    {selectedProfile?.full_name}
                  </Text>
                  ?{"\n\n"}Their overall classroom average will be recalculated automatically.
                </Text>

                <View style={styles.confirmModalActions}>
                  <TouchableOpacity
                    style={[
                      styles.confirmCancelBtn,
                      { backgroundColor: cardBg, borderColor: darkMode ? "#4B5563" : "#CBD5E1" },
                    ]}
                    onPress={() => setGradeEntryToDelete(null)}
                    disabled={deletingGradeEntry}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.confirmCancelBtnText, { color: darkMode ? "#E2E8F0" : "#334155" }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmDeleteBtn, deletingGradeEntry && styles.btnDisabled]}
                    onPress={handleConfirmDeleteGradeEntry}
                    disabled={deletingGradeEntry}
                    activeOpacity={0.85}
                  >
                    {deletingGradeEntry ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.confirmDeleteBtnText}>Delete Grade</Text>
                    )}
                  </TouchableOpacity>
                </View>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Classroom Roster Alerts Bottom Sheet Modal ── */}
      <NotificationsModal
        visible={notifModalVisible}
        onClose={() => setNotifModalVisible(false)}
        scope="classroom"
        classroomName={classroomTitle || (title as string) || "Classroom"}
        alerts={classroomAlerts}
        dismissedAlerts={classroomDismissedAlerts}
        preferences={classroomAlertPrefs}
        onAlertPress={handleClassroomAlertPress}
        onRemedialQuizPress={handleClassroomRemedialQuiz}
        onDismissAlert={handleDismissClassroomAlert}
        onRestoreAlerts={handleRestoreClassroomAlerts}
        onMarkAllRead={handleMarkAllClassroomAlertsRead}
        onClearAll={handleClearAllClassroomAlerts}
        onPreferencesChange={handleClassroomAlertPrefsChange}
      />

      {/* ── Remove Student Email-Verified Confirmation Modal ── */}
      <DeleteEmailVerificationModal
        visible={confirmDeleteStudentModal}
        entityType="student"
        targetName={studentToDelete?.full_name || "Student"}
        description="Removing this student will permanently delete their enrollment, grades, and quiz evaluation records from this classroom."
        confirmActionLabel="Verify & Remove"
        onClose={() => {
          if (!isDeletingStudent) {
            setConfirmDeleteStudentModal(false);
            setStudentToDelete(null);
          }
        }}
        onVerifiedDelete={handleConfirmDeleteStudent}
      />

      {/* ── Delete Classroom Email-Verified Confirmation Modal ── */}
      <DeleteEmailVerificationModal
        visible={confirmDeleteClassModal}
        entityType="classroom"
        targetName={classroomTitle || (title as string) || "Classroom"}
        description="All enrolled students, quizzes, answer keys, and grade tracking records for this classroom will be permanently deleted."
        confirmActionLabel="Verify & Delete"
        onClose={() => {
          if (!isDeletingClass) {
            setConfirmDeleteClassModal(false);
          }
        }}
        onVerifiedDelete={handleConfirmDeleteClassroom}
      />
      {/* ── Export Classroom Records Modal ── */}
      <Modal
        visible={exportModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setExportModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.exportModalBackdrop}
          activeOpacity={1}
          onPress={() => setExportModalVisible(false)}
        >
          <Pressable
            style={[styles.exportModalSheet, { backgroundColor: cardBg }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={styles.sheetDragHandle} />

            <View style={styles.exportModalHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.exportModalTitle, { color: textMain }]}>Export Records</Text>
                <Text style={[styles.exportModalSub, { color: textSub }]}>
                  Download or share your class records and scores formatted for Excel:
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setExportModalVisible(false)}
                style={[styles.sheetCloseBtn, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={16} color={textSub} />
              </TouchableOpacity>
            </View>

            {/* Option 1: Quiz Scores */}
            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#1E293B" : "#FFFFFF", borderColor: darkMode ? "#334155" : "#E2E8F0" },
              ]}
              onPress={() => {
                setExportModalVisible(false);
                handleExportQuizScores(false);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#0F172A" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                <Ionicons name="grid-outline" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Quiz Scores</Text>
                  <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                    <Text style={[styles.dimBadgeText, { color: darkMode ? "#94A3B8" : "#475569" }]}>.xlsx</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                  All graded quizzes, student points, and item breakdown
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={textSub} />
            </TouchableOpacity>

            {/* Option 2: Blank Student Template */}
            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#1E293B" : "#FFFFFF", borderColor: darkMode ? "#334155" : "#E2E8F0" },
              ]}
              onPress={() => {
                setExportModalVisible(false);
                handleDownloadTemplate(false);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.neutralOptionIcon, { backgroundColor: darkMode ? "#0F172A" : "#F8FAFC", borderColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                <Ionicons name="document-text-outline" size={20} color={darkMode ? "#F8FAFC" : "#0F172A"} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Blank Student Template</Text>
                  <View style={[styles.dimBadge, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
                    <Text style={[styles.dimBadgeText, { color: darkMode ? "#94A3B8" : "#475569" }]}>.xlsx</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                  Pre-formatted BSIT-4 blank template with sample student rows
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={textSub} />
            </TouchableOpacity>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* ── Import Classlist Preview Modal ── */}
      <Modal
        visible={importModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!isImporting) {
            setImportModalVisible(false);
            setImportResult(null);
            setImportStudents([]);
          }
        }}
      >
        <View style={[styles.importModalRoot, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={[styles.importModalHeader, { backgroundColor: cardBg, borderBottomColor: subBorder }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.importModalHeaderTag}>
                <Ionicons name="cloud-upload" size={14} color={cardColor} />
                <Text style={[styles.importModalHeaderTagText, { color: cardColor }]}>IMPORT CLASSLIST</Text>
              </View>
              <Text style={[styles.importModalTitle, { color: textMain }]}>Review & Import</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!isImporting) {
                  setImportModalVisible(false);
                  setImportResult(null);
                  setImportStudents([]);
                }
              }}
              style={[styles.importModalCloseBtn, { backgroundColor: btnSecondaryBg }]}
              disabled={isImporting}
            >
              <Ionicons name="close" size={22} color={textSub} />
            </TouchableOpacity>
          </View>

          {isParsing ? (
            <View style={styles.importLoadingWrap}>
              <ActivityIndicator size="large" color={cardColor} />
              <Text style={[styles.importLoadingText, { color: textSub }]}>Parsing classlist...</Text>
            </View>
          ) : importResult ? (
            <>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.importScrollContent}
                showsVerticalScrollIndicator={false}
              >
                {/* Metadata Card */}
                {(importResult.metadata.subjectName || importResult.metadata.subjectCode || importResult.metadata.schedule || importResult.metadata.room || importResult.metadata.teacher) && (
                  <View style={[styles.importMetaCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <View style={styles.importMetaCardHeader}>
                      <Ionicons name="information-circle" size={16} color={cardColor} />
                      <Text style={[styles.importMetaCardTitle, { color: textMain }]}>Detected Class Info</Text>
                    </View>
                    {importResult.metadata.subjectName ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>Subject</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]} numberOfLines={2}>{importResult.metadata.subjectName}</Text>
                      </View>
                    ) : null}
                    {importResult.metadata.subjectCode ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>Code</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]}>{importResult.metadata.subjectCode}</Text>
                      </View>
                    ) : null}
                    {importResult.metadata.schedule ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>Schedule</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]}>{importResult.metadata.schedule}</Text>
                      </View>
                    ) : null}
                    {importResult.metadata.room ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>Room</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]}>{importResult.metadata.room}</Text>
                      </View>
                    ) : null}
                    {importResult.metadata.teacher ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>Teacher</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]}>{importResult.metadata.teacher}</Text>
                      </View>
                    ) : null}
                    {importResult.metadata.edpCode ? (
                      <View style={styles.importMetaRow}>
                        <Text style={[styles.importMetaLabel, { color: textSub }]}>EDP Code</Text>
                        <Text style={[styles.importMetaValue, { color: textMain }]}>{importResult.metadata.edpCode}</Text>
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Student Selection Header */}
                <View style={styles.importStudentHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.importStudentHeaderTitle, { color: textMain }]}>
                      Students Detected ({importStudents.length})
                    </Text>
                    <Text style={[styles.importStudentHeaderSub, { color: textSub }]}>
                      {importStudents.filter((s) => s.selected).length} selected for import
                      {importStudents.some((s) => !s.selected && isDuplicateStudent(s, students)) &&
                        " • Duplicates auto-deselected"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.importSelectAllBtn, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}
                    onPress={toggleAllImportStudents}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={importStudents.every((s) => s.selected) ? "checkbox" : "square-outline"}
                      size={18}
                      color={importStudents.every((s) => s.selected) ? cardColor : textSub}
                    />
                    <Text style={[styles.importSelectAllText, { color: textMain }]}>
                      {importStudents.every((s) => s.selected) ? "Deselect All" : "Select All"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Student List */}
                {importStudents.map((student, index) => {
                  const isDup = isDuplicateStudent(student, students);
                  return (
                    <TouchableOpacity
                      key={`import-${index}`}
                      style={[
                        styles.importStudentRow,
                        {
                          backgroundColor: cardBg,
                          borderColor: isDup ? (darkMode ? "#92400E" : "#FDE68A") : student.selected ? cardColor : border,
                          borderWidth: student.selected ? 1.5 : 1,
                          opacity: student.selected ? 1 : 0.6,
                        },
                      ]}
                      onPress={() => toggleImportStudent(index)}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name={student.selected ? "checkbox" : "square-outline"}
                        size={22}
                        color={student.selected ? cardColor : textSub}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.importStudentName, { color: textMain }]} numberOfLines={1}>
                            {student.fullName}
                          </Text>
                          {isDup && (
                            <View style={[styles.importDupBadge, { backgroundColor: darkMode ? "#78350F" : "#FEF3C7" }]}>
                              <Text style={[styles.importDupBadgeText, { color: darkMode ? "#FCD34D" : "#92400E" }]}>Duplicate</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.importStudentDetail, { color: textSub }]} numberOfLines={1}>
                          {[student.studentId, student.email, student.course, student.gender]
                            .filter(Boolean)
                            .join(" • ") || "No additional info"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Footer */}
              <View style={[styles.importFooter, { backgroundColor: cardBg, borderTopColor: border }]}>
                <TouchableOpacity
                  style={[styles.importCancelBtn, { backgroundColor: btnSecondaryBg }]}
                  onPress={() => {
                    setImportModalVisible(false);
                    setImportResult(null);
                    setImportStudents([]);
                  }}
                  disabled={isImporting}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.importCancelBtnText, { color: textSub }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.importConfirmBtn,
                    { backgroundColor: cardColor, shadowColor: cardColor },
                    (isImporting || importStudents.filter((s) => s.selected).length === 0) && styles.btnDisabled,
                  ]}
                  onPress={handleConfirmImport}
                  disabled={isImporting || importStudents.filter((s) => s.selected).length === 0}
                  activeOpacity={0.85}
                >
                  {isImporting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="cloud-upload" size={17} color="#FFFFFF" />
                      <Text style={styles.importConfirmBtnText}>
                        Import {importStudents.filter((s) => s.selected).length} Student{importStudents.filter((s) => s.selected).length !== 1 ? "s" : ""}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>
      </Modal>

      {/* ── Classroom More Options Action Sheet ── */}
      <Modal
        visible={classMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setClassMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.exportModalBackdrop}
          activeOpacity={1}
          onPress={() => setClassMenuVisible(false)}
        >
          <Pressable
            style={[styles.exportModalSheet, { backgroundColor: cardBg }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={{ marginBottom: 4 }}>
              <Text style={[styles.exportModalTitle, { color: textMain }]}>
                {classroomTitle || title}
              </Text>
              <Text style={[styles.exportModalSub, { color: textSub }]}>
                Manage classroom settings or remove this course
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border },
              ]}
              onPress={openEditClassroomModal}
              activeOpacity={0.7}
            >
              <View style={[styles.exportOptionIconBox, { backgroundColor: darkMode ? "#475569" : "#E2E8F0" }]}>
                <Ionicons name="create-outline" size={20} color={textMain} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Edit Classroom</Text>
                <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                  Update class title, subject, section, room, or schedule
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={textSub} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2", borderColor: darkMode ? "#7F1D1D" : "#FECACA" },
              ]}
              onPress={promptDeleteClassroom}
              activeOpacity={0.7}
            >
              <View style={[styles.exportOptionIconBox, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}>
                <Ionicons name="trash-outline" size={20} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptionCardTitle, { color: "#DC2626" }]}>Delete Classroom</Text>
                <Text style={[styles.exportOptionCardSub, { color: darkMode ? "#FCA5A5" : "#B91C1C" }]}>
                  Permanently remove this classroom and all enrolled students
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.exportModalCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}
              onPress={() => setClassMenuVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.exportModalCancelText, { color: textMain }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit Classroom Modal ── */}
      <Modal
        visible={editClassModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditClassModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={() => setEditClassModalVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: textMain }]}>Edit Classroom</Text>
                    <TouchableOpacity
                      onPress={() => setEditClassModalVisible(false)}
                      style={[styles.modalCloseBtn, { backgroundColor: btnSecondaryBg }]}
                    >
                      <Ionicons name="close" size={20} color={textSub} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Class title <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Grade 10 - Mathematics"
                    placeholderTextColor={textSub}
                    value={draftClassTitle}
                    onChangeText={setDraftClassTitle}
                  />

                  <Text style={[styles.fieldLabel, { color: textSub }]}>Subject</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Mathematics"
                    placeholderTextColor={textSub}
                    value={draftClassSubject}
                    onChangeText={setDraftClassSubject}
                  />

                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: textSub }]}>Section</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                        placeholder="e.g. Section 3"
                        placeholderTextColor={textSub}
                        value={draftClassSection}
                        onChangeText={setDraftClassSection}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { color: textSub }]}>Room</Text>
                      <TextInput
                        style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                        placeholder="e.g. CL1"
                        placeholderTextColor={textSub}
                        value={draftClassRoom}
                        onChangeText={setDraftClassRoom}
                      />
                    </View>
                  </View>

                  <Text style={[styles.fieldLabel, { color: textSub }]}>Schedule</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. MWF 4:30-5:30PM"
                    placeholderTextColor={textSub}
                    value={draftClassSchedule}
                    onChangeText={setDraftClassSchedule}
                  />

                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: border, backgroundColor: btnSecondaryBg }]}
                      onPress={() => setEditClassModalVisible(false)}
                      disabled={savingClassEdit}
                    >
                      <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
                        { backgroundColor: cardColor },
                        (!draftClassTitle.trim() || savingClassEdit) && styles.addBtnDisabled,
                      ]}
                      onPress={handleSaveClassroomEdit}
                      disabled={!draftClassTitle.trim() || savingClassEdit}
                    >
                      {savingClassEdit ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.addBtnText}>Save Changes</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Student More Options Action Sheet ── */}
      <Modal
        visible={studentMenuTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setStudentMenuTarget(null)}
      >
        <TouchableOpacity
          style={styles.exportModalBackdrop}
          activeOpacity={1}
          onPress={() => setStudentMenuTarget(null)}
        >
          <Pressable
            style={[styles.exportModalSheet, { backgroundColor: cardBg }]}
            onPress={(e) => e.stopPropagation?.()}
          >
            {studentMenuTarget && (
              <>
                <View style={{ marginBottom: 4 }}>
                  <Text style={[styles.exportModalTitle, { color: textMain }]}>
                    {studentMenuTarget.full_name}
                  </Text>
                  <Text style={[styles.exportModalSub, { color: textSub }]}>
                    {studentMenuTarget.email || "No email address recorded"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.exportOptionCard,
                    { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border },
                  ]}
                  onPress={() => {
                    const target = studentMenuTarget;
                    setStudentMenuTarget(null);
                    setSelectedProfile(target);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.exportOptionIconBox, { backgroundColor: darkMode ? "#475569" : "#E2E8F0" }]}>
                    <Ionicons name="person-outline" size={20} color={textMain} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>View Student Profile</Text>
                    <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                      Inspect quiz breakdown and pedagogical advice
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSub} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.exportOptionCard,
                    { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border },
                  ]}
                  onPress={() => {
                    const target = studentMenuTarget;
                    setStudentMenuTarget(null);
                    openEditModal(target);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.exportOptionIconBox, { backgroundColor: darkMode ? "#475569" : "#E2E8F0" }]}>
                    <Ionicons name="create-outline" size={20} color={textMain} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Edit Student Details</Text>
                    <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                      Update name or email address
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={textSub} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.exportOptionCard,
                    { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2", borderColor: darkMode ? "#7F1D1D" : "#FECACA" },
                  ]}
                  onPress={() => {
                    const target = studentMenuTarget;
                    setStudentMenuTarget(null);
                    promptDeleteStudent(target);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.exportOptionIconBox, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}>
                    <Ionicons name="trash-outline" size={20} color="#DC2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.exportOptionCardTitle, { color: "#DC2626" }]}>Remove Student</Text>
                    <Text style={[styles.exportOptionCardSub, { color: darkMode ? "#FCA5A5" : "#B91C1C" }]}>
                      Delete student from this classroom roster
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportModalCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}
                  onPress={() => setStudentMenuTarget(null)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.exportModalCancelText, { color: textMain }]}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </TouchableOpacity>
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
    gap: 8,
    flexShrink: 0,
  },
  backIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontSize: 15,
    color: "#181920",
    fontWeight: "700",
  },
  topSubject: {
    fontSize: 16,
    fontWeight: "800",
    color: "#181920",
    flex: 1,
    textAlign: "center",
    letterSpacing: -0.2,
    marginHorizontal: 8,
    minWidth: 0,
  },
  notifDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  /* ── Scroll ── */
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: 48,
  },

  /* ── Banner ── */
  banner: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    overflow: "hidden",
  },
  bannerCompact: {
    paddingVertical: 12,
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
    fontSize: 21,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  bannerTitleCompact: {
    fontSize: 17,
  },
  bannerSubtitleText: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 18,
  },

  /* ── Tabs (True Underline Tab Bar) ── */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: "#0F172A",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
  },
  tabTextActive: {
    color: "#0F172A",
    fontWeight: "700",
  },

  /* ── Action Row ── */
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  secondaryToolbarBtn: {
    flex: 1,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
  },
  secondaryToolbarBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  primaryToolbarBtn: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 5,
  },
  primaryToolbarBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },

  /* ── Search ── */
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
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
    paddingTop: 16,
    paddingBottom: 8,
  },
  rosterTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  rosterHint: {
    fontSize: 11.5,
    color: "#64748B",
    fontWeight: "500",
  },

  /* ── Student Row ── */
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    color: "#334155",
    fontWeight: "700",
    fontSize: 13,
  },
  studentInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  studentName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
    lineHeight: 20,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
  },
  topBadge: {
    backgroundColor: "#EFF6FF",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  topBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#2563EB",
  },
  flaggedBadge: {
    backgroundColor: "#FEF2F2",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  flaggedBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#DC2626",
  },
  studentEmail: {
    fontSize: 13,
    color: "#64748B",
  },
  studentStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  statRightCol: {
    alignItems: "flex-end",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  statLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "500",
    marginTop: 1,
  },
  studentMoreBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
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
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1F2937",
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    letterSpacing: 0,
    marginBottom: 6,
    marginTop: 12,
  },
  required: { color: "#EF4444" },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14.5,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
  },
  addBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnDisabled: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  /* ── Student Profile Modal ── */
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  profileModalCard: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 16,
  },
  profileHeader: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  profileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  profileAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  profileAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  profileAvatarFallbackText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  profileName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
  },
  profileEmail: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  profileCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  compactMissingEmailBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  compactMissingEmailText: {
    fontSize: 13,
    fontWeight: "500",
  },
  compactAddEmailBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  compactAddEmailBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  missingEmailBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  missingEmailTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  missingEmailSub: {
    fontSize: 11.5,
    marginTop: 1,
  },
  missingEmailBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  missingEmailBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  profileScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  profileBody: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  profileStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  statBoxLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  statBoxValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 4,
  },
  statusPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 5,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "800",
  },
  atRiskCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  atRiskTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#991B1B",
  },
  atRiskSub: {
    fontSize: 11.5,
    color: "#DC2626",
    marginTop: 2,
    fontWeight: "500",
  },
  quizSheetSection: {
    marginBottom: 14,
  },
  quizSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  quizSheetTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.6,
  },
  quizScoreCard: {
    borderWidth: 1.5,
    borderColor: "#0F172A",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  quizScoreName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
  },
  quizScoreSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  quizScoreNumRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  quizScoreNum: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#0F172A",
  },
  quizScoreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  quizScorePercent: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "right",
    marginTop: 2,
  },
  pedagogicalCard: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  pedagogicalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  pedagogicalTitle: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#9A3412",
    letterSpacing: 0.5,
  },
  pedagogicalText: {
    fontSize: 11.5,
    color: "#475569",
    lineHeight: 17,
    fontWeight: "500",
  },
  profileFooter: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 32 : 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  profileFooterBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  profileFooterBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  profileDeleteBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    alignItems: "center",
    justifyContent: "center",
  },
  editProfileBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  editProfileBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  emailBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emailBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  topBarBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    backgroundColor: "#DC2626",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  topBarBadgeText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  topBarSubtleDot: {
    position: "absolute",
    top: 6,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EA580C",
    borderWidth: 1.5,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  topBarActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  editStudentRowBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  deleteStudentRowBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  removeStudentProfileBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  removeStudentProfileBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
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

  /* ── Import Classlist Modal ── */
  importModalRoot: {
    flex: 1,
  },
  importModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  importModalHeaderTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  importModalHeaderTagText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  importModalTitle: {
    fontSize: 22,
    fontWeight: "800",
  },
  importModalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  importLoadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  importLoadingText: {
    fontSize: 14,
    fontWeight: "600",
  },
  importScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  importMetaCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  importMetaCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  importMetaCardTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  importMetaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  importMetaLabel: {
    fontSize: 12,
    fontWeight: "600",
    width: 72,
  },
  importMetaValue: {
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    textAlign: "right",
  },
  importStudentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  importStudentHeaderTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  importStudentHeaderSub: {
    fontSize: 11.5,
    fontWeight: "500",
    marginTop: 2,
  },
  importSelectAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  importSelectAllText: {
    fontSize: 12,
    fontWeight: "700",
  },
  importStudentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
  },
  importStudentName: {
    fontSize: 14,
    fontWeight: "700",
  },
  importStudentDetail: {
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: "500",
  },
  importDupBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  importDupBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  importFooter: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: 1,
  },
  importCancelBtn: {
    flex: 0.4,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  importCancelBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  importConfirmBtn: {
    flex: 0.6,
    height: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  importConfirmBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  exportModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  exportModalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    gap: 10,
  },
  exportModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  exportModalTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 6,
  },
  exportModalTagText: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  exportModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 3,
  },
  exportModalSub: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  exportOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  exportOptionIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  exportOptionCardTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  exportOptionCardSub: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  exportOptionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  exportOptionBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },

  /* Reusable Sheet Elements */
  sheetDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  neutralOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
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
    fontSize: 11,
    fontWeight: "600",
  },
  exportModalCancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 4,
  },
  exportModalCancelText: {
    fontSize: 14.5,
    fontWeight: "700",
  },
});
