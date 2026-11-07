import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
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
import TrackerTab from "../components/TrackerTab";
import { useTheme } from "../context/ThemeContext";
import {
  clearAllAlerts,
  deleteClassroomAlerts,
  deleteStudentAlerts,
  getClearedAlertIds,
  getPersistedAlerts,
  getReadAlertIds,
  markAlertsAsRead,
  RosterAlert,
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
import { getAllStudentQuizResults, getStudentResults, StudentQuizResult } from "../lib/questionAnalysis";
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

  // Notification Alert state for this classroom
  const [classroomAlerts, setClassroomAlerts] = useState<RosterAlert[]>([]);
  const [classroomUnreadCount, setClassroomUnreadCount] = useState<number>(0);
  const [notifModalVisible, setNotifModalVisible] = useState<boolean>(false);

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

  const loadClassroomAlerts = useCallback(async () => {
    if (!id) return;
    try {
      const [persisted, clearedIds, readIds] = await Promise.all([
        getPersistedAlerts(),
        getClearedAlertIds(),
        getReadAlertIds(),
      ]);

      const activeAlerts: RosterAlert[] = [];

      // 1. From real students with a recorded average between 1% and 50%
      for (const s of students) {
        if (s.average !== null && s.average !== undefined && s.average > 0 && s.average <= 50) {
          const alertId = `flag_${s.id}`;
          if (!clearedIds.includes(alertId) && !clearedIds.includes(s.id)) {
            activeAlerts.push({
              id: alertId,
              studentId: s.id,
              studentName: s.full_name || "Student",
              classroomId: id,
              classroomTitle: (title as string) || "Classroom",
              classroomSchedule: (schedule as string) || "",
              classroomRoom: (room as string) || "",
              classroomColor: color || ORANGE,
              scorePercentage: s.average,
              alertType: s.average <= 40 ? "HIGH RISK" : "URGENT REVIEW",
              message: `${s.full_name || "Student"} has dropped to an average of ${s.average}%. Performance Flagged: At-Risk.`,
              createdAt: new Date().toISOString(),
              timeLabel: "Today",
              isRead:
                readIds.includes(alertId) ||
                readIds.includes(s.id) ||
                readIds.includes(`alert_${s.id}`),
            });
          }
        }
      }

      // 2. From persisted alerts specifically for this classroom
      for (const p of persisted) {
        if (
          p.classroomId === id &&
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
          } else {
            activeAlerts[existingIdx] = {
              ...p,
              isRead,
            };
          }
        }
      }

      setClassroomAlerts(activeAlerts);
      setClassroomUnreadCount(activeAlerts.filter((a) => !a.isRead).length);
    } catch (err) {
      console.error("Failed to load classroom alerts:", err);
    }
  }, [id, title, schedule, room, color, students]);

  useEffect(() => {
    loadClassroomAlerts();
  }, [loadClassroomAlerts]);

  // Load per-question results for selected student profile (for advice engine)
  useEffect(() => {
    if (selectedProfile && id) {
      getStudentResults(id, selectedProfile.id).then(setStudentQuizResults);
    } else {
      setStudentQuizResults([]);
    }
  }, [selectedProfile, id]);

  // ── Classroom Notification Handlers ────────────────────────────────────────
  function handleOpenNotifModal() {
    setNotifModalVisible(true);
  }

  async function handleClassroomAlertPress(alert: RosterAlert) {
    await markAlertsAsRead([alert.id, alert.studentId, `flag_${alert.studentId}`]);
    setClassroomAlerts((prev) =>
      prev.map((a) =>
        a.id === alert.id || a.studentId === alert.studentId ? { ...a, isRead: true } : a
      )
    );
    setClassroomUnreadCount((prev) => Math.max(0, prev - 1));
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

  async function handleClearAllClassroomAlerts() {
    await clearAllAlerts(classroomAlerts);
    setClassroomAlerts([]);
    setClassroomUnreadCount(0);
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

      // 2. Delete related alerts in alertStore
      await deleteStudentAlerts(studentId);

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
    } finally {
      setIsDeletingStudent(false);
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

  // Auto-open requested student profile preview when redirected from notification alert
  useEffect(() => {
    if ((openStudentId || openStudentName) && students.length > 0) {
      const match = students.find(
        (s) =>
          (openStudentId && s.id === openStudentId) ||
          (openStudentName && s.full_name.toLowerCase() === openStudentName.toLowerCase())
      );
      if (match) {
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

  // ── Export Classlist (Excel / CSV) Handlers ──────────────────────────────────
  async function handleExportExcel(forceNewFolder = false) {
    if (students.length === 0) {
      Alert.alert("No Data", "There are no students in this classroom to export.");
      return;
    }

    try {
      setIsExporting(true);
      const { quizzes, results } = await getClassroomExportQuizData();
      const base64 = generateExcelClasslistBase64({
        classroomTitle: title || "Classroom",
        subject: classroomSubject,
        section: classroomSection,
        room: classroomRoom,
        schedule: classroomSchedule,
        students,
        quizzes,
        results,
      });

      const cleanTitle = (title || "Classroom").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `${cleanTitle}_classlist.xlsx`;
      const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      console.error("Excel export error:", err);
      Alert.alert("Export Failed", err.message || "Could not export Excel file.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDownloadTemplate(forceNewFolder = false) {
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

      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      console.error("Template download error:", err);
      Alert.alert("Download Failed", err.message || "Could not generate template.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportCSV(forceNewFolder = false) {
    if (students.length === 0) {
      Alert.alert("No Data", "There are no students to export.");
      return;
    }

    try {
      setIsExporting(true);
      const { quizzes, results } = await getClassroomExportQuizData();
      const quizHeaders = quizzes.map((q, idx) => {
        const label = /^quiz\s*\d+/i.test(q.quizTitle.trim())
          ? q.quizTitle.trim()
          : `Quiz ${idx + 1}: ${q.quizTitle.trim()}`;
        return `"${label.replace(/"/g, '""')}${q.maxScore ? ` (${q.maxScore} pts)` : ""}"`;
      });

      const header = ["Item", "Last Name", "First Name", "Middle Name", "Email", ...quizHeaders].join(",") + "\n";
      const rows = students
        .map((s, idx) => {
          const norm = normalizeStudentRecord(s);
          const quizCells = quizzes.map((q) => {
            const match = results.find(
              (r) =>
                (r.studentId === s.id ||
                  r.studentName.toLowerCase().trim() === norm.full_name.toLowerCase().trim()) &&
                r.quizTitle.toLowerCase().trim() === q.quizTitle.toLowerCase().trim()
            );
            return match !== undefined ? String(match.totalScore) : "";
          });
          return [
            idx + 1,
            `"${(norm.last_name || "").replace(/"/g, '""')}"`,
            `"${(norm.first_name || "").replace(/"/g, '""')}"`,
            `"${(norm.middle_name || "").replace(/"/g, '""')}"`,
            `"${(s.email || "N/A").replace(/"/g, '""')}"`,
            ...quizCells,
          ].join(",");
        })
        .join("\n");

      const csvContent = header + rows;
      const cleanTitle = (title || "classroom").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `${cleanTitle}_roster.csv`;
      const mimeType = "text/csv";

      const tempUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(tempUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const base64 = await FileSystem.readAsStringAsync(tempUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      console.error("CSV export error:", err);
      Alert.alert("Export Failed", err.message || "Could not export CSV file.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleShareFile() {
    if (students.length === 0) {
      Alert.alert("No Data", "There are no students to export.");
      return;
    }

    try {
      setIsExporting(true);
      const cleanTitle = (title || "Classroom").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `${cleanTitle}_classlist.xlsx`;
      const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      const { quizzes, results } = await getClassroomExportQuizData();
      const base64 = generateExcelClasslistBase64({
        classroomTitle: title || "Classroom",
        subject: classroomSubject,
        section: classroomSection,
        room: classroomRoom,
        schedule: classroomSchedule,
        students,
        quizzes,
        results,
      });

      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType,
          dialogTitle: `Share ${fileName}`,
        });
      }
    } catch (err: any) {
      console.error("Share error:", err);
      Alert.alert("Share Failed", err.message || "Could not share file.");
    } finally {
      setIsExporting(false);
    }
  }



  async function handleExportQuizScores(forceNewFolder = false) {
    if (students.length === 0) {
      Alert.alert("No Data", "There are no students in this classroom to export scores for.");
      return;
    }

    try {
      setIsExporting(true);
      const { quizzes, results } = await getClassroomExportQuizData();
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

      await saveDirectlyToPhone({
        fileName,
        mimeType,
        base64Data: base64,
        forceNewFolder,
      });
    } catch (err: any) {
      console.error("Quiz scores export error:", err);
      Alert.alert("Export Failed", err.message || "Could not export quiz scores.");
    } finally {
      setIsExporting(false);
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
            style={[styles.notifDot, { backgroundColor: darkMode ? "#374151" : "#F8FAFC", borderColor: border, borderWidth: 1 }]}
            onPress={handleOpenNotifModal}
            activeOpacity={0.8}
            accessibilityLabel="Classroom alerts"
          >
            <Ionicons name="notifications-outline" size={18} color={textMain} />
            {classroomUnreadCount > 0 && (
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
            )}
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
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                  },
                ]}
                activeOpacity={0.8}
                onPress={() => setExportModalVisible(true)}
                disabled={isExporting}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color={darkMode ? "#F8FAFC" : "#0F172A"} />
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
              loadClassroomAlerts();
            }}
            onStudentCreated={(newStudent) => {
              setStudents((prev) => [...prev, newStudent]);
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
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                  },
                ]}
                activeOpacity={0.8}
                onPress={() => handleExportQuizScores(false)}
                disabled={isExporting}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color={darkMode ? "#F8FAFC" : "#0F172A"} />
                ) : (
                  <Ionicons name="grid-outline" size={16} color={darkMode ? "#F8FAFC" : "#0F172A"} />
                )}
                <Text style={[styles.secondaryToolbarBtnText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                  {isExporting ? "Exporting..." : "Export Quiz Scores (.xlsx)"}
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
                const isFlagged = avg <= 50;
                const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
                const isTop = !isFlagged && highestAvg > 50 && avg === highestAvg;
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
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={handleCancel}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: textMain }]}>Add New Student</Text>
                    <TouchableOpacity
                      onPress={handleCancel}
                      style={[styles.modalCloseBtn, { backgroundColor: btnSecondaryBg }]}
                    >
                      <Ionicons name="close" size={22} color={textSub} />
                    </TouchableOpacity>
                  </View>

                  {/* Last Name */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Last name <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Smith"
                    placeholderTextColor={textSub}
                    value={lastName}
                    onChangeText={setLastName}
                  />

                  {/* First Name */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    First name <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Liam"
                    placeholderTextColor={textSub}
                    value={firstName}
                    onChangeText={setFirstName}
                  />

                  {/* Middle Name (Optional) */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Middle name <Text style={{ fontSize: 12, fontWeight: "400", color: textSub }}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Santos"
                    placeholderTextColor={textSub}
                    value={middleName}
                    onChangeText={setMiddleName}
                  />

                  {/* Email */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>Email address</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. liam.smith@school.edu"
                    placeholderTextColor={textSub}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  {/* Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: border, backgroundColor: btnSecondaryBg }]}
                      onPress={handleCancel}
                    >
                      <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
                        { backgroundColor: cardColor, shadowColor: cardColor },
                        ((!lastName.trim() && !firstName.trim()) || saving) && styles.addBtnDisabled,
                      ]}
                      onPress={handleAddStudent}
                      disabled={(!lastName.trim() && !firstName.trim()) || saving}
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

      {/* ── Edit Student Details Modal ── */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCancelEdit}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableWithoutFeedback onPress={handleCancelEdit}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalTitle, { color: textMain }]}>Edit Student Details</Text>
                      <Text style={{ fontSize: 12, color: textSub, marginTop: 2 }}>
                        Update student name and email address
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={handleCancelEdit}
                      style={[styles.modalCloseBtn, { backgroundColor: btnSecondaryBg }]}
                    >
                      <Ionicons name="close" size={22} color={textSub} />
                    </TouchableOpacity>
                  </View>

                  {/* Last Name */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Last name <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Smith"
                    placeholderTextColor={textSub}
                    value={editLastName}
                    onChangeText={setEditLastName}
                  />

                  {/* First Name */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    First name <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Liam"
                    placeholderTextColor={textSub}
                    value={editFirstName}
                    onChangeText={setEditFirstName}
                  />

                  {/* Middle Name (Optional) */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Middle name <Text style={{ fontSize: 12, fontWeight: "400", color: textSub }}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. Santos"
                    placeholderTextColor={textSub}
                    value={editMiddleName}
                    onChangeText={setEditMiddleName}
                  />

                  {/* Email */}
                  <Text style={[styles.fieldLabel, { color: textSub }]}>
                    Email address{" "}
                    {!editEmail.trim() ? (
                      <Text style={{ color: ORANGE, fontSize: 11, fontWeight: "600" }}>(No email set)</Text>
                    ) : null}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textMain }]}
                    placeholder="e.g. student@school.edu"
                    placeholderTextColor={textSub}
                    value={editEmail}
                    onChangeText={setEditEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  {/* Buttons */}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: border, backgroundColor: btnSecondaryBg }]}
                      onPress={handleCancelEdit}
                      disabled={savingEdit}
                    >
                      <Text style={[styles.cancelBtnText, { color: textSub }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
                        { backgroundColor: cardColor, shadowColor: cardColor },
                        ((!editLastName.trim() && !editFirstName.trim()) || savingEdit) && styles.addBtnDisabled,
                      ]}
                      onPress={handleSaveEditStudent}
                      disabled={(!editLastName.trim() && !editFirstName.trim()) || savingEdit}
                    >
                      {savingEdit ? (
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

      {/* ── Student Profile Modal (Popup) ── */}
      <Modal
        visible={selectedProfile !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedProfile(null)}
      >
        <View style={styles.profileModalOverlay}>
          {/* Backdrop dismiss touchable */}
          <TouchableWithoutFeedback onPress={() => setSelectedProfile(null)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          {selectedProfile && (() => {
            const profileAvg = selectedProfile.average ?? 0;
            const profileIsFlagged = profileAvg <= 50;
            const highestAvg = students.length > 0 ? Math.max(...students.map((s) => s.average ?? 0)) : 0;
            const profileIsTop = !profileIsFlagged && highestAvg > 50 && profileAvg === highestAvg;
            const firstName = selectedProfile.first_name || selectedProfile.full_name.replace(/,/g, " ").trim().split(/\s+/)[0];
            const profileAvatar = getStudentAvatar(selectedProfile.full_name);

            const quizTitleDisplay =
              publishedQuizzes[0]?.quizTitle ||
              selectedGradingQuiz ||
              classroomSubject ||
              (schedule !== "No Subject" ? schedule : "") ||
              "Assessment";

            const quizTotalPoints = publishedQuizzes[0]?.questions?.length || 10;
            const quizScore = Math.round((profileAvg / 100) * quizTotalPoints);

            return (
              <View style={[styles.profileModalCard, { backgroundColor: cardBg }]}>
                {/* Header (Pinned) */}
                <View style={[styles.profileHeader, { backgroundColor: cardColor }]}>
                  <View style={styles.profileHeaderLeft}>
                    {profileAvatar ? (
                      <Image source={{ uri: profileAvatar }} style={styles.profileAvatarImg} />
                    ) : (
                      <View style={styles.profileAvatarFallback}>
                        <Text style={styles.profileAvatarFallbackText}>
                          {getInitials(selectedProfile.full_name)}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.profileName} numberOfLines={1}>
                        {selectedProfile.full_name}
                      </Text>
                      <Text style={styles.profileEmail} numberOfLines={1}>
                        {selectedProfile.email || "No email registered"}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TouchableOpacity
                      style={styles.profileHeaderEditBtn}
                      onPress={() => openEditModal(selectedProfile)}
                      activeOpacity={0.7}
                      accessibilityLabel="Edit Student Details"
                    >
                      <Ionicons name="pencil" size={16} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.profileCloseBtn}
                      onPress={() => setSelectedProfile(null)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={18} color="#FFFFFF" />
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
                  {/* Missing Email Alert Banner */}
                  {!selectedProfile.email && (
                    <TouchableOpacity
                      style={[
                        styles.missingEmailBanner,
                        {
                          backgroundColor: darkMode ? "#374151" : "#FFF7ED",
                          borderColor: darkMode ? "#4B5563" : "#FDBA74",
                        },
                      ]}
                      onPress={() => openEditModal(selectedProfile)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="mail-unread-outline" size={20} color={ORANGE} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.missingEmailTitle, { color: textMain }]}>No Email Address Recorded</Text>
                        <Text style={[styles.missingEmailSub, { color: textSub }]}>{"Tap here to add this student's email"}</Text>
                      </View>
                      <View style={[styles.missingEmailBadge, { backgroundColor: cardColor }]}>
                        <Text style={styles.missingEmailBadgeText}>Add Email</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Stats Row */}
                  <View style={styles.profileStatsRow}>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>AVERAGE</Text>
                      <Text style={[styles.statBoxValue, { color: textMain }]}>{profileAvg}%</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.statBoxLabel, { color: textSub }]}>STATUS</Text>
                      {profileIsTop ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#1E3A8A" : "#EFF6FF" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#93C5FD" : "#2563EB" }]}>TOP TIER</Text>
                        </View>
                      ) : profileIsFlagged ? (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>AT RISK</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusPill, { backgroundColor: darkMode ? "#064E3B" : "#ECFDF5" }]}>
                          <Text style={[styles.statusPillText, { color: darkMode ? "#6EE7B7" : "#059669" }]}>ON TRACK</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* At-Risk Warning Flag (Only if profileIsFlagged) */}
                  {profileIsFlagged && (
                    <View style={[styles.atRiskCard, { backgroundColor: darkMode ? "#450A0A" : "#FEF2F2", borderColor: darkMode ? "#7F1D1D" : "#FECACA" }]}>
                      <Ionicons name="warning-outline" size={20} color={darkMode ? "#FCA5A5" : "#DC2626"} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.atRiskTitle, { color: darkMode ? "#FCA5A5" : "#991B1B" }]}>At-Risk Behavioral Flag</Text>
                        <Text style={[styles.atRiskSub, { color: darkMode ? "#F87171" : "#DC2626" }]}>
                          {quizTitleDisplay} score below threshold
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Quiz Grade Sheet */}
                  <View style={styles.quizSheetSection}>
                    <View style={styles.quizSheetHeader}>
                      <Ionicons name="book-outline" size={14} color={textSub} />
                      <Text style={[styles.quizSheetTitle, { color: textSub }]}>QUIZ GRADE SHEET</Text>
                    </View>
                    <View style={[styles.quizScoreCard, { backgroundColor: cardBg, borderColor: border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.quizScoreName, { color: textMain }]} numberOfLines={1}>
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
                              { backgroundColor: profileIsFlagged ? "#EF4444" : "#10B981" },
                            ]}
                          />
                        </View>
                        <Text style={[styles.quizScorePercent, { color: textSub }]}>({profileAvg}%)</Text>
                      </View>
                    </View>
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

                {/* Fixed Footer Action Buttons (Always Visible at bottom!) */}
                <View style={[styles.profileFooter, { backgroundColor: cardBg, borderTopColor: border }]}>
                  <TouchableOpacity
                    style={[styles.editProfileBtn, { backgroundColor: cardColor }]}
                    onPress={() => openEditModal(selectedProfile)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="pencil" size={16} color="#FFFFFF" />
                    <Text style={styles.editProfileBtnText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.emailBtn,
                      {
                        backgroundColor: darkMode ? "#374151" : "#F3F4F6",
                        borderWidth: 1,
                        borderColor: border,
                      },
                    ]}
                    onPress={() => {
                      if (selectedProfile.email) {
                        Linking.openURL(`mailto:${selectedProfile.email}`);
                      } else {
                        Alert.alert(
                          "No Email Recorded",
                          `${selectedProfile.full_name} does not have an email address recorded yet. Tap "Edit" to add their email.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Edit Student", onPress: () => openEditModal(selectedProfile) },
                          ]
                        );
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="mail" size={16} color={textMain} />
                    <Text style={[styles.emailBtnText, { color: textMain }]}>Email</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.removeStudentProfileBtn, { backgroundColor: darkMode ? "#7F1D1D" : "#FEE2E2" }]}
                    onPress={() => promptDeleteStudent(selectedProfile)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    <Text style={[styles.removeStudentProfileBtnText, { color: darkMode ? "#FCA5A5" : "#DC2626" }]}>Remove</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.closeProfileBtn, { backgroundColor: btnSecondaryBg }]}
                    onPress={() => setSelectedProfile(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.closeProfileBtnText, { color: textSub }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* ── Classroom Active Roster Alerts Modal ── */}
      <Modal
        visible={notifModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifModalVisible(false)}
      >
        <View style={styles.alertsModalOverlay}>
          <TouchableWithoutFeedback onPress={() => setNotifModalVisible(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.alertsCard,
              {
                backgroundColor: cardBg,
                borderColor: darkMode ? "#374151" : "#E5E7EB",
              },
            ]}
          >
            {/* Header */}
            <View style={styles.alertsHeader}>
              <View style={styles.alertsHeaderLeft}>
                <Ionicons name="notifications-outline" size={18} color={ORANGE} />
                <Text style={[styles.alertsTitle, { color: textMain }]}>Active Roster Alerts</Text>
              </View>
              {classroomAlerts.length > 0 && (
                <TouchableOpacity onPress={handleClearAllClassroomAlerts} activeOpacity={0.7}>
                  <Text style={[styles.alertsClearBtn, { color: textSub }]}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Content */}
            {classroomAlerts.length === 0 ? (
              <View style={styles.alertsEmptyState}>
                <Ionicons name="shield-checkmark-outline" size={32} color="#10B981" />
                <Text style={[styles.alertsEmptyTitle, { color: textMain }]}>All Clear</Text>
                <Text style={[styles.alertsEmptySub, { color: textSub }]}>
                  No students currently flagged as at-risk in this classroom.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.alertsList} showsVerticalScrollIndicator={false}>
                {classroomAlerts.map((alert) => (
                  <TouchableOpacity
                    key={alert.id}
                    style={[
                      styles.alertCard,
                      {
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#334155" : "#E5E7EB",
                      },
                    ]}
                    onPress={() => handleClassroomAlertPress(alert)}
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
                        View student tracker
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

      {/* ── Remove Student Confirmation Modal ── */}
      <Modal
        visible={confirmDeleteStudentModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !isDeletingStudent && setConfirmDeleteStudentModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingStudent && setConfirmDeleteStudentModal(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.confirmOuterGlassFrame,
              {
                backgroundColor: darkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.45)",
                borderColor: darkMode ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.8)",
              },
            ]}
          >
            <View style={[styles.confirmModalCard, { backgroundColor: cardBg }]}>
              <TouchableOpacity
                style={styles.confirmCloseBtn}
                onPress={() => !isDeletingStudent && setConfirmDeleteStudentModal(false)}
                disabled={isDeletingStudent}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color={textMain} />
              </TouchableOpacity>

              <View
                style={[
                  styles.dangerIconWrap,
                  { backgroundColor: darkMode ? "rgba(217, 56, 41, 0.22)" : "#FCE8E6" },
                ]}
              >
                <View style={styles.dangerDiamondBadge}>
                  <Text style={styles.dangerDiamondExclamation}>!</Text>
                </View>
              </View>

              <Text style={[styles.confirmModalTitle, { color: textMain }]}>Remove Student?</Text>
              <Text style={[styles.confirmModalDesc, { color: textSub }]}>
                Are you sure you want to remove{" "}
                <Text style={{ fontWeight: "700", color: textMain }}>{`"${studentToDelete?.full_name}"`}</Text>{" "}
                from this classroom?
                {"\n\n"}Their grades and quiz evaluation records will be permanently deleted.
              </Text>

              <View style={styles.confirmModalActions}>
                <TouchableOpacity
                  style={[styles.confirmDeleteBtn, isDeletingStudent && styles.btnDisabled]}
                  onPress={handleConfirmDeleteStudent}
                  disabled={isDeletingStudent}
                  activeOpacity={0.85}
                >
                  {isDeletingStudent ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmDeleteBtnText}>Remove</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confirmCancelBtn,
                    {
                      backgroundColor: cardBg,
                      borderColor: darkMode ? "#4B5563" : "#D1D5DB",
                    },
                  ]}
                  onPress={() => setConfirmDeleteStudentModal(false)}
                  disabled={isDeletingStudent}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.confirmCancelBtnText, { color: textMain }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete Classroom Confirmation Modal ── */}
      <Modal
        visible={confirmDeleteClassModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !isDeletingClass && setConfirmDeleteClassModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <TouchableWithoutFeedback onPress={() => !isDeletingClass && setConfirmDeleteClassModal(false)}>
            <View style={StyleSheet.absoluteFillObject} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.confirmOuterGlassFrame,
              {
                backgroundColor: darkMode ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.45)",
                borderColor: darkMode ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.8)",
              },
            ]}
          >
            <View style={[styles.confirmModalCard, { backgroundColor: cardBg }]}>
              <TouchableOpacity
                style={styles.confirmCloseBtn}
                onPress={() => !isDeletingClass && setConfirmDeleteClassModal(false)}
                disabled={isDeletingClass}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color={textMain} />
              </TouchableOpacity>

              <View
                style={[
                  styles.dangerIconWrap,
                  { backgroundColor: darkMode ? "rgba(217, 56, 41, 0.22)" : "#FCE8E6" },
                ]}
              >
                <View style={styles.dangerDiamondBadge}>
                  <Text style={styles.dangerDiamondExclamation}>!</Text>
                </View>
              </View>

              <Text style={[styles.confirmModalTitle, { color: textMain }]}>Delete Classroom?</Text>
              <Text style={[styles.confirmModalDesc, { color: textSub }]}>
                Are you sure you want to permanently delete{" "}
                <Text style={{ fontWeight: "700", color: textMain }}>{`"${title}"`}</Text>?
                {"\n\n"}All enrolled students, quizzes, answer keys, and grade tracking records for this classroom will be permanently deleted.
              </Text>

              <View style={styles.confirmModalActions}>
                <TouchableOpacity
                  style={[styles.confirmDeleteBtn, isDeletingClass && styles.btnDisabled]}
                  onPress={handleConfirmDeleteClassroom}
                  disabled={isDeletingClass}
                  activeOpacity={0.85}
                >
                  {isDeletingClass ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmDeleteBtnText}>Delete</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confirmCancelBtn,
                    {
                      backgroundColor: cardBg,
                      borderColor: darkMode ? "#4B5563" : "#D1D5DB",
                    },
                  ]}
                  onPress={() => setConfirmDeleteClassModal(false)}
                  disabled={isDeletingClass}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.confirmCancelBtnText, { color: textMain }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* ── Export Classroom Records Modal ── */}
      <Modal
        visible={exportModalVisible}
        transparent
        animationType="fade"
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
            <View style={styles.exportModalHeader}>
              <View style={[styles.exportModalTag, { backgroundColor: cardColor + "18" }]}>
                <Ionicons name="download" size={13} color={cardColor} />
                <Text style={[styles.exportModalTagText, { color: cardColor }]}>EXPORT CLASSROOM DATA</Text>
              </View>
              <Text style={[styles.exportModalTitle, { color: textMain }]}>Export Records</Text>
              <Text style={[styles.exportModalSub, { color: textSub }]}>
                Download or share your class records and scores formatted for Excel:
              </Text>
            </View>

            {/* Option 1: Quiz Scores (Featured) */}
            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#374151" : "#F9FAFB", borderColor: cardColor + "55" },
              ]}
              onPress={() => {
                setExportModalVisible(false);
                handleExportQuizScores(false);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.exportOptionIconBox, { backgroundColor: cardColor + "18" }]}>
                <Ionicons name="grid" size={22} color={cardColor} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Quiz Scores (.xlsx)</Text>
                  <View style={[styles.exportOptionBadge, { backgroundColor: cardColor + "20" }]}>
                    <Text style={[styles.exportOptionBadgeText, { color: cardColor }]}>Scores</Text>
                  </View>
                </View>
                <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                  All graded quizzes, student points, and item breakdown
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={cardColor} />
            </TouchableOpacity>

            {/* Option 2: Download Blank BSIT-4 Template */}
            <TouchableOpacity
              style={[
                styles.exportOptionCard,
                { backgroundColor: darkMode ? "#374151" : "#F9FAFB", borderColor: border },
              ]}
              onPress={() => {
                setExportModalVisible(false);
                handleDownloadTemplate(false);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.exportOptionIconBox, { backgroundColor: "#10B98114" }]}>
                <Ionicons name="cloud-download-outline" size={22} color="#10B981" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.exportOptionCardTitle, { color: textMain }]}>Download Excel Template (.xlsx)</Text>
                <Text style={[styles.exportOptionCardSub, { color: textSub }]}>
                  Pre-formatted BSIT-4 blank template with sample student rows
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color="#10B981" />
            </TouchableOpacity>

            {/* Cancel Button */}
            <TouchableOpacity
              style={[styles.exportModalCancelBtn, { backgroundColor: darkMode ? "#374151" : "#F3F4F6" }]}
              onPress={() => setExportModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.exportModalCancelText, { color: textMain }]}>Cancel</Text>
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
    borderRadius: 16,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  addBtnDisabled: {
    backgroundColor: "#FED7AA",
    shadowOpacity: 0,
    elevation: 0,
  },
  addBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* ── Student Profile Modal ── */
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  profileModalCard: {
    width: "100%",
    maxWidth: 390,
    maxHeight: "85%",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 16,
  },
  profileHeader: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  profileAvatarImg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    marginRight: 14,
  },
  profileAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    marginRight: 14,
  },
  profileAvatarFallbackText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  profileName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  profileEmail: {
    fontSize: 12.5,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
  },
  profileCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeaderEditBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    alignItems: "center",
    justifyContent: "center",
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
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  editProfileBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  editProfileBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  emailBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emailBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  closeProfileBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  closeProfileBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#334155",
  },
  topBarBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: ORANGE,
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
  },
  alertsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertsCard: {
    width: "100%",
    maxWidth: 420,
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
    paddingHorizontal: 22,
  },
  confirmOuterGlassFrame: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 28,
    padding: 7,
    borderWidth: 1.5,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 16,
  },
  confirmModalCard: {
    width: "100%",
    borderRadius: 22,
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 22,
    alignItems: "center",
  },
  confirmCloseBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  dangerIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#FCE8E6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  dangerDiamondBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#D93829",
    transform: [{ rotate: "45deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  dangerDiamondExclamation: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    transform: [{ rotate: "-45deg" }],
    textAlign: "center",
    includeFontPadding: false,
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  confirmModalDesc: {
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 22,
    paddingHorizontal: 6,
  },
  confirmModalActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  confirmDeleteBtn: {
    flex: 1,
    backgroundColor: "#D93829",
    height: 44,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  confirmDeleteBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
    gap: 10,
  },
  exportModalHeader: {
    marginBottom: 6,
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
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 4,
  },
  exportModalSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  exportOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  exportOptionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  exportOptionCardTitle: {
    fontSize: 14.5,
    fontWeight: "700",
    marginBottom: 2,
  },
  exportOptionCardSub: {
    fontSize: 12,
    lineHeight: 16,
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
