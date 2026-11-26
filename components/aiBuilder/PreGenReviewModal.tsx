import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { getDocBadgeInfo, SupportedDocType } from "../../lib/documentParserService";
import { QuotaState } from "../../lib/ai/aiQuotaService";
import { SmoothBottomSheetModal } from "../SmoothModalTransition";
import {
  getSkeuoPalette,
  skeuoButtonStyle,
  skeuoCardStyle,
  skeuoWellStyle,
} from "../skeuoTheme";

export interface PreGenClassroomOption {
  id: string;
  title: string;
  subject: string;
  section: string;
  color?: string;
}

export interface PreGenAttachedFile {
  name: string;
  type: SupportedDocType;
}

export type PreGenEditingField =
  | null
  | "classroom"
  | "subject"
  | "grade"
  | "type"
  | "count"
  | "difficulty"
  | "notes"
  | "parts";

export interface PreGenReviewModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  canGenerate: boolean;
  darkMode: boolean;
  cardBg: string;
  border: string;
  textMain: string;
  textSub: string;
  accentColor: string;
  bottomInset: number;

  // Classroom / section state
  selectedClassroomId: string;
  selectedClassTitle: string;
  selectedClassSection: string;
  setSelectedClassSection: (v: string) => void;
  availableClassrooms: PreGenClassroomOption[];
  onSelectClassroom: (cls: PreGenClassroomOption) => void;

  // Source material state
  attachedFile: PreGenAttachedFile | null;
  onAttachFile: () => void;
  onClearAttachedFile: () => void;
  lessonNotes: string;
  setLessonNotes: (v: string) => void;

  // Assessment settings state
  subject: string;
  setSubject: (v: string) => void;
  gradeLevel: string;
  setGradeLevel: (v: string) => void;
  questionType: string;
  setQuestionType: (v: string) => void;
  questionCount: string;
  setQuestionCount: (v: string) => void;
  difficulty: string;
  setDifficulty: (v: string) => void;

  // Mixed assessment state
  mixedTypes: string[];
  mixedPartCounts: Record<string, number>;
  mixedTypeOptions: Array<{ key: string; label: string }>;
  renderMixedPicker: () => React.ReactNode;

  // Option lists
  gradeLevels: string[];
  questionTypes: string[];
  questionCounts: string[];
  bloomDifficulties: string[];

  // Inline editor & quota
  editingField: PreGenEditingField;
  setEditingField: React.Dispatch<React.SetStateAction<PreGenEditingField>>;
  quotaState: QuotaState | null;
}

export function PreGenReviewModal({
  visible,
  onClose,
  onConfirm,
  canGenerate,
  darkMode,
  cardBg,
  border,
  textMain,
  textSub,
  accentColor,
  bottomInset,
  selectedClassroomId,
  selectedClassTitle,
  selectedClassSection,
  setSelectedClassSection,
  availableClassrooms,
  onSelectClassroom,
  attachedFile,
  onAttachFile,
  onClearAttachedFile,
  lessonNotes,
  setLessonNotes,
  subject,
  setSubject,
  gradeLevel,
  setGradeLevel,
  questionType,
  setQuestionType,
  questionCount,
  setQuestionCount,
  difficulty,
  setDifficulty,
  mixedTypes,
  mixedPartCounts,
  mixedTypeOptions,
  renderMixedPicker,
  gradeLevels,
  questionTypes,
  questionCounts,
  bloomDifficulties,
  editingField,
  setEditingField,
  quotaState,
}: PreGenReviewModalProps) {
  const skeuo = getSkeuoPalette(darkMode, accentColor);

  return (
    <SmoothBottomSheetModal
      visible={visible}
      onClose={onClose}
      onRequestClose={onClose}
      avoidKeyboard
      backdropColor={skeuo.backdrop}
      sheetStyle={[
        styles.preGenSheet,
        skeuoCardStyle(skeuo, 24),
        {
          backgroundColor: cardBg,
          paddingBottom: Math.max(16, bottomInset + 10),
        },
      ]}
    >
      <View style={[styles.sheetDragHandle, { backgroundColor: skeuo.borderStrong }]} />

          {/* Header */}
          <View style={styles.preGenHeader}>
            <View style={[styles.preGenIconBox, skeuoWellStyle(skeuo, 12), { backgroundColor: skeuo.accentSoft, borderColor: skeuo.accentSoftBorder }]}>
              <Ionicons name="eye-outline" size={19} color={accentColor} />
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
              <Text style={[styles.preGenTitle, { color: textMain }]}>
                Review Before Generating
              </Text>
              <Text style={[styles.preGenSub, { color: textSub }]}>
                Check what you entered — tap any section or setting to change it before using Tseki AI.
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.preGenCloseBtn, skeuoButtonStyle(skeuo, { neutral: true, radius: 16 })]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close preview"
            >
              <Ionicons name="close" size={18} color={textSub} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.preGenScroll}
            contentContainerStyle={styles.preGenScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 1. Target Classroom & Section Card */}
            <View
              style={[
                styles.preGenCard,
                skeuoWellStyle(skeuo, 14),
                editingField === "classroom" && { borderColor: accentColor, borderWidth: 1.5 },
              ]}
            >
              <View style={styles.preGenCardTopRow}>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={[styles.preGenSectionEyebrow, { color: textSub }]}>
                    TARGET CLASSROOM &amp; SECTION
                  </Text>
                  <View style={styles.preGenClassRow}>
                    <View
                      style={[
                        styles.preGenClassDot,
                        {
                          backgroundColor:
                            availableClassrooms.find((c) => c.id === selectedClassroomId)?.color ||
                            accentColor,
                        },
                      ]}
                    />
                    <Text style={[styles.preGenClassTitle, { color: textMain }]} numberOfLines={1}>
                      {selectedClassTitle}
                    </Text>
                    {selectedClassSection ? (
                      <View
                        style={[
                          styles.preGenSectionPill,
                          {
                            backgroundColor: accentColor + "18",
                            borderColor: accentColor + "40",
                          },
                        ]}
                      >
                        <Text style={[styles.preGenSectionPillText, { color: accentColor }]}>
                          {selectedClassSection}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.preGenSectionPill,
                          {
                            backgroundColor: darkMode ? "#1E293B" : "#E2E8F0",
                            borderColor: "transparent",
                          },
                        ]}
                      >
                        <Text style={[styles.preGenSectionPillText, { color: textSub }]}>
                          No Section
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.preGenClassSub, { color: textSub }]} numberOfLines={1}>
                    Subject: {subject}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.preGenChangeBtn,
                    {
                      backgroundColor:
                        editingField === "classroom"
                          ? accentColor
                          : darkMode
                            ? "#1F2937"
                            : "#FFFFFF",
                      borderColor:
                        editingField === "classroom"
                          ? accentColor
                          : darkMode
                            ? "#475569"
                            : "#CBD5E1",
                    },
                  ]}
                  onPress={() =>
                    setEditingField((prev) => (prev === "classroom" ? null : "classroom"))
                  }
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={editingField === "classroom" ? "checkmark" : "swap-horizontal"}
                    size={13}
                    color={editingField === "classroom" ? "#FFFFFF" : textMain}
                  />
                  <Text
                    style={[
                      styles.preGenChangeBtnText,
                      { color: editingField === "classroom" ? "#FFFFFF" : textMain },
                    ]}
                  >
                    {editingField === "classroom" ? "Done" : "Change"}
                  </Text>
                </TouchableOpacity>
              </View>

              {editingField === "classroom" && (
                <View style={[styles.preGenInlineBox, { borderTopColor: darkMode ? "#1F2937" : "#E2E8F0" }]}>
                  <Text style={[styles.preGenInlineHint, { color: textSub }]}>
                    Select the correct classroom / section:
                  </Text>
                  <View style={{ gap: 6, marginTop: 6 }}>
                    {availableClassrooms.map((cls) => {
                      const isActive = cls.id === selectedClassroomId;
                      return (
                        <TouchableOpacity
                          key={cls.id}
                          style={[
                            styles.preGenClassOption,
                            {
                              backgroundColor: isActive
                                ? accentColor + "14"
                                : darkMode
                                  ? "#1F2937"
                                  : "#FFFFFF",
                              borderColor: isActive
                                ? accentColor
                                : darkMode
                                  ? "#334155"
                                  : "#E2E8F0",
                            },
                          ]}
                          onPress={() => onSelectClassroom(cls)}
                          activeOpacity={0.75}
                        >
                          <View
                            style={[
                              styles.preGenClassDot,
                              { backgroundColor: cls.color || accentColor },
                            ]}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text
                                style={[
                                  styles.preGenClassOptTitle,
                                  { color: isActive ? accentColor : textMain },
                                ]}
                                numberOfLines={1}
                              >
                                {cls.title}
                              </Text>
                              {cls.section ? (
                                <View
                                  style={[
                                    styles.preGenMiniBadge,
                                    { backgroundColor: darkMode ? "#334155" : "#F1F5F9" },
                                  ]}
                                >
                                  <Text style={[styles.preGenMiniBadgeText, { color: darkMode ? "#E2E8F0" : "#475569" }]}>
                                    {cls.section}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={{ fontSize: 11.5, color: textSub }} numberOfLines={1}>
                              {cls.subject}
                            </Text>
                          </View>
                          {isActive && (
                            <Ionicons name="checkmark-circle" size={18} color={accentColor} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <Text style={[styles.preGenInlineHint, { color: textSub, marginBottom: 4 }]}>
                      Or edit section label directly:
                    </Text>
                    <TextInput
                      style={[
                        styles.preGenInlineInput,
                        {
                          backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                          borderColor: darkMode ? "#475569" : "#CBD5E1",
                          color: textMain,
                        },
                      ]}
                      value={selectedClassSection}
                      onChangeText={setSelectedClassSection}
                      placeholder="e.g. Section 1, BSIT-4A"
                      placeholderTextColor={textSub}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* 2. Source Material Card */}
            <View
              style={[
                styles.preGenCard,
                {
                  backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                  borderColor:
                    editingField === "notes"
                      ? accentColor
                      : darkMode
                        ? "#334155"
                        : "#E2E8F0",
                },
              ]}
            >
              <View style={styles.preGenCardTopRow}>
                <Text style={[styles.preGenSectionEyebrow, { color: textSub }]}>
                  SOURCE MATERIAL
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <TouchableOpacity
                    style={[
                      styles.preGenChangeBtn,
                      {
                        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                        borderColor: darkMode ? "#475569" : "#CBD5E1",
                      },
                    ]}
                    onPress={onAttachFile}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="attach-outline" size={13} color={textMain} />
                    <Text style={[styles.preGenChangeBtnText, { color: textMain }]}>
                      {attachedFile ? "Change File" : "Add File"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.preGenChangeBtn,
                      {
                        backgroundColor:
                          editingField === "notes"
                            ? accentColor
                            : darkMode
                              ? "#1F2937"
                              : "#FFFFFF",
                        borderColor:
                          editingField === "notes"
                            ? accentColor
                            : darkMode
                              ? "#475569"
                              : "#CBD5E1",
                      },
                    ]}
                    onPress={() =>
                      setEditingField((prev) => (prev === "notes" ? null : "notes"))
                    }
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={editingField === "notes" ? "checkmark" : "create-outline"}
                      size={13}
                      color={editingField === "notes" ? "#FFFFFF" : textMain}
                    />
                    <Text
                      style={[
                        styles.preGenChangeBtnText,
                        { color: editingField === "notes" ? "#FFFFFF" : textMain },
                      ]}
                    >
                      {editingField === "notes" ? "Done" : "Edit Notes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {attachedFile && (
                <View
                  style={[
                    styles.preGenFilePill,
                    {
                      backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                      borderColor: getDocBadgeInfo(attachedFile.type).color + "55",
                    },
                  ]}
                >
                  <View style={[styles.docBadge, { backgroundColor: getDocBadgeInfo(attachedFile.type).bgColor }]}>
                    <Ionicons
                      name={getDocBadgeInfo(attachedFile.type).icon as any}
                      size={14}
                      color={getDocBadgeInfo(attachedFile.type).color}
                    />
                    <Text style={[styles.docBadgeText, { color: getDocBadgeInfo(attachedFile.type).color }]}>
                      {getDocBadgeInfo(attachedFile.type).label}
                    </Text>
                  </View>
                  <Text style={[styles.preGenFileName, { color: textMain }]} numberOfLines={1}>
                    {attachedFile.name}
                  </Text>
                  {lessonNotes.trim().length > 0 && (
                    <TouchableOpacity
                      onPress={onClearAttachedFile}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {editingField === "notes" ? (
                <TextInput
                  style={[
                    styles.preGenNotesInput,
                    {
                      backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                      borderColor: darkMode ? "#475569" : "#CBD5E1",
                      color: textMain,
                    },
                  ]}
                  value={lessonNotes}
                  onChangeText={setLessonNotes}
                  placeholder="Enter lesson notes, topic focus, or syllabus excerpts..."
                  placeholderTextColor={textSub}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              ) : lessonNotes.trim().length > 0 ? (
                <Text style={[styles.preGenNotesPreview, { color: textMain }]} numberOfLines={4}>
                  {lessonNotes.trim()}
                </Text>
              ) : !attachedFile ? (
                <Text style={[styles.preGenNotesEmpty, { color: "#DC2626" }]}>
                  No file or notes provided — add a reference file or notes to generate.
                </Text>
              ) : (
                <Text style={[styles.preGenNotesEmpty, { color: textSub }]}>
                  No extra notes added (using attached document).
                </Text>
              )}
            </View>

            {/* 3. Assessment Settings Summary */}
            <View
              style={[
                styles.preGenCard,
                {
                  backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                  borderColor: darkMode ? "#334155" : "#E2E8F0",
                },
              ]}
            >
              <Text style={[styles.preGenSectionEyebrow, { color: textSub, marginBottom: 8 }]}>
                ASSESSMENT SETTINGS
              </Text>

              {/* Subject */}
              <TouchableOpacity
                style={[styles.preGenRow, { borderBottomColor: darkMode ? "#1F2937" : "#E2E8F0" }]}
                onPress={() =>
                  setEditingField((prev) => (prev === "subject" ? null : "subject"))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.preGenRowLabel, { color: textSub }]}>Subject</Text>
                <View style={styles.preGenRowValueWrap}>
                  <Text style={[styles.preGenRowValue, { color: textMain }]} numberOfLines={1}>
                    {subject}
                  </Text>
                  <Ionicons
                    name={editingField === "subject" ? "chevron-up" : "pencil-outline"}
                    size={14}
                    color={accentColor}
                  />
                </View>
              </TouchableOpacity>
              {editingField === "subject" && (
                <View style={styles.preGenChipArea}>
                  <TextInput
                    style={[
                      styles.preGenInlineInput,
                      {
                        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                        borderColor: accentColor,
                        color: textMain,
                      },
                    ]}
                    value={subject}
                    onChangeText={setSubject}
                    placeholder="Enter subject name"
                    placeholderTextColor={textSub}
                    returnKeyType="done"
                    onSubmitEditing={() => setEditingField(null)}
                  />
                </View>
              )}

              {/* Grade Level */}
              <TouchableOpacity
                style={[styles.preGenRow, { borderBottomColor: darkMode ? "#1F2937" : "#E2E8F0" }]}
                onPress={() =>
                  setEditingField((prev) => (prev === "grade" ? null : "grade"))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.preGenRowLabel, { color: textSub }]}>Grade level</Text>
                <View style={styles.preGenRowValueWrap}>
                  <Text style={[styles.preGenRowValue, { color: textMain }]} numberOfLines={1}>
                    {gradeLevel}
                  </Text>
                  <Ionicons
                    name={editingField === "grade" ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={accentColor}
                  />
                </View>
              </TouchableOpacity>
              {editingField === "grade" && (
                <View style={styles.preGenChipGrid}>
                  {gradeLevels.map((lvl) => {
                    const active = gradeLevel === lvl;
                    return (
                      <TouchableOpacity
                        key={lvl}
                        style={[
                          styles.preGenChip,
                          {
                            backgroundColor: active
                              ? accentColor
                              : darkMode
                                ? "#1F2937"
                                : "#FFFFFF",
                            borderColor: active
                              ? accentColor
                              : darkMode
                                ? "#334155"
                                : "#CBD5E1",
                          },
                        ]}
                        onPress={() => {
                          setGradeLevel(lvl);
                          setEditingField(null);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.preGenChipText,
                            { color: active ? "#FFFFFF" : textMain },
                          ]}
                        >
                          {lvl}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Question Type */}
              <TouchableOpacity
                style={[styles.preGenRow, { borderBottomColor: darkMode ? "#1F2937" : "#E2E8F0" }]}
                onPress={() =>
                  setEditingField((prev) => (prev === "type" ? null : "type"))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.preGenRowLabel, { color: textSub }]}>Question type</Text>
                <View style={styles.preGenRowValueWrap}>
                  <Text style={[styles.preGenRowValue, { color: textMain }]} numberOfLines={1}>
                    {questionType}
                  </Text>
                  <Ionicons
                    name={editingField === "type" ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={accentColor}
                  />
                </View>
              </TouchableOpacity>
              {editingField === "type" && (
                <View style={styles.preGenChipGrid}>
                  {questionTypes.map((t) => {
                    const active = questionType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[
                          styles.preGenChip,
                          {
                            backgroundColor: active
                              ? accentColor
                              : darkMode
                                ? "#1F2937"
                                : "#FFFFFF",
                            borderColor: active
                              ? accentColor
                              : darkMode
                                ? "#334155"
                                : "#CBD5E1",
                          },
                        ]}
                        onPress={() => {
                          setQuestionType(t);
                          setEditingField(null);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.preGenChipText,
                            { color: active ? "#FFFFFF" : textMain },
                          ]}
                        >
                          {t}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Questions Count */}
              <TouchableOpacity
                style={[styles.preGenRow, { borderBottomColor: darkMode ? "#1F2937" : "#E2E8F0" }]}
                onPress={() =>
                  setEditingField((prev) => (prev === "count" ? null : "count"))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.preGenRowLabel, { color: textSub }]}>Questions count</Text>
                <View style={styles.preGenRowValueWrap}>
                  <Text style={[styles.preGenRowValue, { color: textMain }]} numberOfLines={1}>
                    {questionCount}
                  </Text>
                  <Ionicons
                    name={editingField === "count" ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={accentColor}
                  />
                </View>
              </TouchableOpacity>
              {editingField === "count" && (
                <View style={styles.preGenChipGrid}>
                  {questionCounts.map((c) => {
                    const active = questionCount === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[
                          styles.preGenChip,
                          {
                            backgroundColor: active
                              ? accentColor
                              : darkMode
                                ? "#1F2937"
                                : "#FFFFFF",
                            borderColor: active
                              ? accentColor
                              : darkMode
                                ? "#334155"
                                : "#CBD5E1",
                          },
                        ]}
                        onPress={() => {
                          setQuestionCount(c);
                          setEditingField(null);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.preGenChipText,
                            { color: active ? "#FFFFFF" : textMain },
                          ]}
                        >
                          {c}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Difficulty Level */}
              <TouchableOpacity
                style={[styles.preGenRow, { borderBottomWidth: 0 }]}
                onPress={() =>
                  setEditingField((prev) => (prev === "difficulty" ? null : "difficulty"))
                }
                activeOpacity={0.7}
              >
                <Text style={[styles.preGenRowLabel, { color: textSub }]}>Difficulty</Text>
                <View style={styles.preGenRowValueWrap}>
                  <Text style={[styles.preGenRowValue, { color: textMain }]} numberOfLines={1}>
                    {difficulty}
                  </Text>
                  <Ionicons
                    name={editingField === "difficulty" ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={accentColor}
                  />
                </View>
              </TouchableOpacity>
              {editingField === "difficulty" && (
                <View style={[styles.preGenChipGrid, { flexDirection: "column" }]}>
                  {bloomDifficulties.map((d) => {
                    const active = difficulty === d;
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[
                          styles.preGenChip,
                          {
                            width: "100%",
                            backgroundColor: active
                              ? accentColor
                              : darkMode
                                ? "#1F2937"
                                : "#FFFFFF",
                            borderColor: active
                              ? accentColor
                              : darkMode
                                ? "#334155"
                                : "#CBD5E1",
                          },
                        ]}
                        onPress={() => {
                          setDifficulty(d);
                          setEditingField(null);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.preGenChipText,
                            { color: active ? "#FFFFFF" : textMain },
                          ]}
                        >
                          {d}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 4. Exam Sections / Parts Breakdown */}
            {questionType === "Mixed Assessment" && (
              <View
                style={[
                  styles.preGenCard,
                  {
                    backgroundColor: darkMode ? "#111827" : "#F8FAFC",
                    borderColor:
                      editingField === "parts"
                        ? accentColor
                        : darkMode
                          ? "#334155"
                          : "#E2E8F0",
                  },
                ]}
              >
                <View style={styles.preGenCardTopRow}>
                  <Text style={[styles.preGenSectionEyebrow, { color: textSub }]}>
                    EXAM SECTIONS / PARTS ({mixedTypes.length})
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.preGenChangeBtn,
                      {
                        backgroundColor:
                          editingField === "parts"
                            ? accentColor
                            : darkMode
                              ? "#1F2937"
                              : "#FFFFFF",
                        borderColor:
                          editingField === "parts"
                            ? accentColor
                            : darkMode
                              ? "#475569"
                              : "#CBD5E1",
                      },
                    ]}
                    onPress={() =>
                      setEditingField((prev) => (prev === "parts" ? null : "parts"))
                    }
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={editingField === "parts" ? "checkmark" : "options-outline"}
                      size={13}
                      color={editingField === "parts" ? "#FFFFFF" : textMain}
                    />
                    <Text
                      style={[
                        styles.preGenChangeBtnText,
                        { color: editingField === "parts" ? "#FFFFFF" : textMain },
                      ]}
                    >
                      {editingField === "parts" ? "Done" : "Edit Parts"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {editingField === "parts" ? (
                  <View style={{ marginTop: 8 }}>{renderMixedPicker()}</View>
                ) : (
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {mixedTypes.map((key, idx) => {
                      const ROMANS = ["I", "II", "III", "IV", "V", "VI"];
                      const opt = mixedTypeOptions.find((o) => o.key === key);
                      const partCount = mixedPartCounts[key] ?? 3;
                      return (
                        <View
                          key={key}
                          style={[
                            styles.preGenPartRow,
                            {
                              backgroundColor: darkMode ? "#1F2937" : "#FFFFFF",
                              borderColor: darkMode ? "#334155" : "#E2E8F0",
                            },
                          ]}
                        >
                          <View style={[styles.preGenRomanPill, { backgroundColor: accentColor + "1A" }]}>
                            <Text style={[styles.preGenRomanText, { color: accentColor }]}>
                              Part {ROMANS[idx] || idx + 1}
                            </Text>
                          </View>
                          <Text style={[styles.preGenPartLabel, { color: textMain }]} numberOfLines={1}>
                            {opt ? opt.label : key}
                          </Text>
                          <Text style={[styles.preGenPartCount, { color: textSub }]}>
                            {partCount} {partCount === 1 ? "item" : "items"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* 5. Quota Info Pill */}
            {quotaState && (
              <View
                style={[
                  styles.preGenQuotaRow,
                  skeuoWellStyle(skeuo, 11),
                  {
                    backgroundColor: skeuo.accentSoft,
                    borderColor: skeuo.accentSoftBorder,
                  },
                ]}
              >
                <Ionicons name="sparkles-outline" size={14} color={accentColor} />
                <Text style={[styles.preGenQuotaText, { color: darkMode ? "#FDBA74" : "#9A3412" }]}>
                  Uses 1 of {quotaState.remainingToday} remaining AI generations today
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View
            style={[
              styles.preGenFooter,
              { backgroundColor: skeuo.chrome, borderTopColor: skeuo.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.preGenBackBtn,
                skeuoButtonStyle(skeuo, { neutral: true, radius: 12 }),
              ]}
              onPress={onClose}
              activeOpacity={0.75}
            >
              <Text style={[styles.preGenBackBtnText, { color: textMain }]}>Edit Form</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.preGenConfirmBtn,
                canGenerate
                  ? skeuoButtonStyle(skeuo, { fill: accentColor, radius: 12 })
                  : [skeuoButtonStyle(skeuo, { neutral: true, radius: 12 }), { opacity: 0.6 }],
              ]}
              onPress={onConfirm}
              disabled={!canGenerate}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
              <Text style={styles.preGenConfirmBtnText}>Confirm &amp; Generate</Text>
            </TouchableOpacity>
          </View>
    </SmoothBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 12,
  },
  docBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  docBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  preGenBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    justifyContent: "flex-end",
  },
  preGenSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 18,
    maxHeight: "88%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 16,
  },
  preGenHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  preGenIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  preGenTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  preGenSub: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 2,
  },
  preGenCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  preGenScroll: {
    flexGrow: 0,
  },
  preGenScrollContent: {
    gap: 12,
    paddingBottom: 14,
  },
  preGenCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  preGenCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  preGenSectionEyebrow: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  preGenClassRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 5,
    flexWrap: "wrap",
  },
  preGenClassDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  preGenClassTitle: {
    fontSize: 15,
    fontWeight: "800",
    flexShrink: 1,
  },
  preGenSectionPill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  preGenSectionPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  preGenClassSub: {
    fontSize: 12,
    marginTop: 3,
  },
  preGenChangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  preGenChangeBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  preGenInlineBox: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  preGenInlineHint: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  preGenClassOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  preGenClassOptTitle: {
    fontSize: 13.5,
    fontWeight: "700",
  },
  preGenMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  preGenMiniBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  preGenInlineInput: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 13.5,
    fontWeight: "500",
  },
  preGenFilePill: {
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  preGenFileName: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
  },
  preGenNotesInput: {
    marginTop: 9,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 84,
    fontSize: 13,
    lineHeight: 18,
  },
  preGenNotesPreview: {
    marginTop: 8,
    fontSize: 12.5,
    lineHeight: 18,
  },
  preGenNotesEmpty: {
    marginTop: 8,
    fontSize: 12,
    fontStyle: "italic",
  },
  preGenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    gap: 10,
  },
  preGenRowLabel: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  preGenRowValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  preGenRowValue: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
    flexShrink: 1,
  },
  preGenChipArea: {
    paddingVertical: 8,
  },
  preGenChipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingVertical: 9,
  },
  preGenChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  preGenChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  preGenPartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  preGenRomanPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  preGenRomanText: {
    fontSize: 11,
    fontWeight: "800",
  },
  preGenPartLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
  },
  preGenPartCount: {
    fontSize: 12,
    fontWeight: "700",
  },
  preGenQuotaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  preGenQuotaText: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  preGenFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  preGenBackBtn: {
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  preGenBackBtnText: {
    fontSize: 13.5,
    fontWeight: "700",
  },
  preGenConfirmBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 3,
  },
  preGenConfirmBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
