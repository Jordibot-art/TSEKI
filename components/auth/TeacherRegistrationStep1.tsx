import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";
import {
  addSubjectTags,
  GRADE_LEVEL_GROUPS,
  normalizeSubjectTag,
  SCHOOL_PRESETS,
  SUBJECT_PRESET_TAGS,
  type TeacherRegistrationStep1Data,
} from "../../shared/teacherRegistration";
import {
  AuthInput,
  capitalizeWordsInput,
  formatSubjectLabel,
  getAuthTheme,
} from "./AuthInput";

export interface TeacherRegistrationStep1Props {
  values: TeacherRegistrationStep1Data;
  onChange: (patch: Partial<TeacherRegistrationStep1Data>) => void;
  loading: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onGoToLogin: () => void;
}

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size) as T[]);
  }
  return rows;
}

export function TeacherRegistrationStep1({
  values,
  onChange,
  loading,
  onSubmit,
  onBack,
  onGoToLogin,
}: TeacherRegistrationStep1Props) {
  const { darkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const theme = getAuthTheme(darkMode);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [schoolPickerOpen, setSchoolPickerOpen] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [customSubjectInput, setCustomSubjectInput] = useState("");

  const filteredSchools = useMemo(() => {
    const q = schoolSearch.trim().toLowerCase();
    if (!q) return SCHOOL_PRESETS;
    return SCHOOL_PRESETS.filter((s) => s.toLowerCase().includes(q));
  }, [schoolSearch]);

  function toggleGradeLevel(level: string) {
    const exists = values.gradeLevels.includes(level);
    const next = exists
      ? values.gradeLevels.filter((g) => g !== level)
      : [...values.gradeLevels, level];
    onChange({ gradeLevels: next });
  }

  function toggleGradeGroup(levels: readonly string[]) {
    const allSelected = levels.every((l) => values.gradeLevels.includes(l));
    if (allSelected) {
      onChange({
        gradeLevels: values.gradeLevels.filter((g) => !levels.includes(g)),
      });
    } else {
      const merged = Array.from(new Set([...values.gradeLevels, ...levels]));
      onChange({ gradeLevels: merged });
    }
  }

  function toggleSubjectTag(tag: string) {
    const upper = normalizeSubjectTag(tag);
    const exists = values.subjects.includes(upper);
    const next = exists
      ? values.subjects.filter((s) => s !== upper)
      : [...values.subjects, upper];
    onChange({ subjects: next });
  }

  function handleAddCustomSubject() {
    if (!customSubjectInput.trim()) return;
    const next = addSubjectTags(values.subjects, customSubjectInput);
    onChange({ subjects: next });
    setCustomSubjectInput("");
  }

  const customOnlySubjects = values.subjects.filter(
    (s) => !SUBJECT_PRESET_TAGS.includes(s)
  );
  const canAddCustom = customSubjectInput.trim().length > 0 && !loading;

  return (
    <View style={[styles.screenRoot, { backgroundColor: theme.bgPage }]}>
      {/* ── Fixed Opaque Top Header + 3px Progress Bar (Outside ScrollView) ── */}
      <View
        style={[styles.fixedHeader, { backgroundColor: theme.bgSurface }]}
      >
        <View style={styles.fixedHeaderInner}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Go back"
            disabled={loading}
          >
            <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.stepMetaText, { color: theme.textMuted }]}>
            Step 1 of 2 · Profile
          </Text>
        </View>
        <View
          style={[styles.progressTrack, { backgroundColor: theme.bgSubtle }]}
        >
          <View
            style={[
              styles.progressFill,
              { width: "50%", backgroundColor: theme.accent },
            ]}
          />
        </View>
      </View>

      {/* ── Scrollable Form Content ── */}
      <ScrollView
        style={[styles.scrollView, { backgroundColor: theme.bgPage }]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentColumn}>
          {/* Page Title */}
          <View style={styles.pageHeading}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              Teacher Sign Up
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              Enter your details exactly as shown on your Teacher ID.
            </Text>
          </View>

          {/* ── Card 1: Personal & School Details ── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.border,
              },
            ]}
          >
            {/* Full Name */}
            <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>
              Full name
            </Text>
            <Text style={[styles.helperText, { color: theme.textMuted }]}>
              Must match your physical Teacher / Employee ID card.
            </Text>

            <View style={styles.nameRow}>
              <AuthInput
                containerStyle={styles.flex1}
                placeholder="First name"
                autoCapitalize="words"
                value={values.firstName}
                onChangeText={(t) =>
                  onChange({ firstName: capitalizeWordsInput(t) })
                }
                editable={!loading}
                darkMode={darkMode}
              />
              <AuthInput
                containerStyle={styles.flex1}
                placeholder="Last name"
                autoCapitalize="words"
                value={values.lastName}
                onChangeText={(t) =>
                  onChange({ lastName: capitalizeWordsInput(t) })
                }
                editable={!loading}
                darkMode={darkMode}
              />
            </View>

            <AuthInput
              containerStyle={styles.middleNameInput}
              placeholder="Middle name (optional)"
              autoCapitalize="words"
              value={values.middleName}
              onChangeText={(t) =>
                onChange({ middleName: capitalizeWordsInput(t) })
              }
              editable={!loading}
              darkMode={darkMode}
            />

            {/* Email Address */}
            <AuthInput
              containerStyle={styles.fieldGap}
              label="Email address"
              helperText="Used for sign in and email verification."
              placeholder="teacher@school.edu.ph"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={values.email}
              onChangeText={(t) => onChange({ email: t })}
              editable={!loading}
              darkMode={darkMode}
            />

            {/* School */}
            <View style={styles.fieldGap}>
              <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>
                School
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.dropdownTrigger,
                  {
                    backgroundColor: theme.bgSurface,
                    borderColor: theme.borderInput,
                  },
                  pressed && styles.pressedSubtle,
                ]}
                onPress={() => setSchoolPickerOpen(true)}
                disabled={loading}
              >
                <Ionicons
                  name="school-outline"
                  size={18}
                  color={theme.textMuted}
                />
                <Text
                  style={[
                    styles.dropdownValue,
                    {
                      color: values.schoolName
                        ? theme.textPrimary
                        : theme.placeholder,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {values.schoolName || "Select your school"}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={theme.textMuted}
                />
              </Pressable>
            </View>

            {/* Teacher / Employee ID */}
            <AuthInput
              containerStyle={styles.fieldGap}
              label="Teacher / Employee ID"
              placeholder="e.g. 102262 or BCS-2026-014"
              autoCapitalize="characters"
              value={values.teacherId}
              onChangeText={(t) => onChange({ teacherId: t })}
              editable={!loading}
              darkMode={darkMode}
              tabularNums
            />
          </View>

          {/* ── Card 2: Grade Levels Handled (Single Unified Card) ── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>
                Grade levels handled
              </Text>
              {values.gradeLevels.length > 0 && (
                <Text
                  style={[styles.selectedCountText, { color: theme.accent }]}
                >
                  {values.gradeLevels.length} selected
                </Text>
              )}
            </View>
            <Text style={[styles.helperText, { color: theme.textMuted }]}>
              Select all grade levels you teach.
            </Text>

            <View style={styles.gradeGroupsWrap}>
              {GRADE_LEVEL_GROUPS.map((group, groupIdx) => {
                const allChecked = group.levels.every((l) =>
                  values.gradeLevels.includes(l)
                );
                const cols = group.id === "shs" ? 2 : 3;
                const rows = chunkItems(group.levels, cols);

                return (
                  <View
                    key={group.id}
                    style={[
                      styles.gradeGroupSection,
                      groupIdx > 0 && {
                        borderTopWidth: 1,
                        borderTopColor: theme.borderHairline,
                        paddingTop: 14,
                      },
                    ]}
                  >
                    <View style={styles.gradeGroupHeader}>
                      <Text
                        style={[
                          styles.gradeGroupTitle,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {group.label}
                      </Text>
                      <TouchableOpacity
                        onPress={() => toggleGradeGroup(group.levels)}
                        hitSlop={8}
                        disabled={loading}
                      >
                        <Text
                          style={[
                            styles.selectAllText,
                            { color: theme.accent },
                          ]}
                        >
                          {allChecked ? "Clear" : "Select all"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.gradeRowsStack}>
                      {rows.map((row, rowIdx) => (
                        <View key={`${group.id}-${rowIdx}`} style={styles.gradeRow}>
                          {row.map((lvl) => {
                            const checked = values.gradeLevels.includes(lvl);
                            return (
                              <TouchableOpacity
                                key={lvl}
                                style={[
                                  styles.gradeChip,
                                  {
                                    backgroundColor: checked
                                      ? theme.accentBg
                                      : theme.bgSurface,
                                    borderColor: checked
                                      ? theme.accent
                                      : theme.border,
                                  },
                                ]}
                                onPress={() => toggleGradeLevel(lvl)}
                                activeOpacity={0.75}
                                disabled={loading}
                              >
                                {checked && (
                                  <Ionicons
                                    name="checkmark"
                                    size={14}
                                    color={theme.accent}
                                  />
                                )}
                                <Text
                                  style={[
                                    styles.gradeChipText,
                                    {
                                      color: checked
                                        ? theme.accentText
                                        : theme.textSecondary,
                                      fontWeight: checked ? "600" : "500",
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {lvl}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                          {row.length < cols &&
                            Array.from({ length: cols - row.length }).map(
                              (_, spacerIdx) => (
                                <View
                                  key={`spacer-${spacerIdx}`}
                                  style={styles.flex1}
                                />
                              )
                            )}
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ── Card 3: Subjects / Strands ── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.fieldLabel, { color: theme.textPrimary }]}>
                Subjects / Strands
              </Text>
              {values.subjects.length > 0 && (
                <Text
                  style={[styles.selectedCountText, { color: theme.accent }]}
                >
                  {values.subjects.length} selected
                </Text>
              )}
            </View>
            <Text style={[styles.helperText, { color: theme.textMuted }]}>
              Tap to select or add a custom subject.
            </Text>

            {/* Custom Subject Input */}
            <View style={styles.customSubjectRow}>
              <AuthInput
                containerStyle={styles.flex1}
                placeholder="Add custom subject..."
                autoCapitalize="words"
                value={customSubjectInput}
                onChangeText={(text) =>
                  setCustomSubjectInput(capitalizeWordsInput(text))
                }
                onSubmitEditing={handleAddCustomSubject}
                returnKeyType="done"
                editable={!loading}
                darkMode={darkMode}
              />
              <TouchableOpacity
                style={[
                  styles.addTagBtn,
                  {
                    backgroundColor: canAddCustom
                      ? theme.accent
                      : theme.btnDisabledBg,
                  },
                ]}
                onPress={handleAddCustomSubject}
                disabled={!canAddCustom}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="add"
                  size={17}
                  color={
                    canAddCustom ? "#FFFFFF" : theme.btnDisabledText
                  }
                />
                <Text
                  style={[
                    styles.addTagBtnText,
                    {
                      color: canAddCustom
                        ? "#FFFFFF"
                        : theme.btnDisabledText,
                    },
                  ]}
                >
                  Add
                </Text>
              </TouchableOpacity>
            </View>

            {/* Custom Added Tags */}
            {customOnlySubjects.length > 0 && (
              <View style={styles.chipWrap}>
                {customOnlySubjects.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.subjectChip,
                      {
                        backgroundColor: theme.accentBg,
                        borderColor: theme.accent,
                      },
                    ]}
                    onPress={() => toggleSubjectTag(tag)}
                    activeOpacity={0.75}
                    disabled={loading}
                  >
                    <Text
                      style={[
                        styles.subjectChipText,
                        { color: theme.accentText, fontWeight: "600" },
                      ]}
                    >
                      {formatSubjectLabel(tag)}
                    </Text>
                    <Ionicons
                      name="close"
                      size={14}
                      color={theme.accent}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Preset Subject / Strand Chips */}
            <View style={styles.chipWrap}>
              {SUBJECT_PRESET_TAGS.map((tag) => {
                const active = values.subjects.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.subjectChip,
                      {
                        backgroundColor: active
                          ? theme.accentBg
                          : theme.bgSurface,
                        borderColor: active ? theme.accent : theme.border,
                      },
                    ]}
                    onPress={() => toggleSubjectTag(tag)}
                    activeOpacity={0.75}
                    disabled={loading}
                  >
                    {active && (
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={theme.accent}
                      />
                    )}
                    <Text
                      style={[
                        styles.subjectChipText,
                        {
                          color: active
                            ? theme.accentText
                            : theme.textSecondary,
                          fontWeight: active ? "600" : "500",
                        },
                      ]}
                    >
                      {formatSubjectLabel(tag)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Card 4: Password ── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.border,
              },
            ]}
          >
            <AuthInput
              label="Password"
              placeholder="At least 6 characters"
              secureTextEntry={!showPassword}
              value={values.password}
              onChangeText={(t) => onChange({ password: t })}
              editable={!loading}
              darkMode={darkMode}
              rightElement={
                <Pressable
                  onPress={() => setShowPassword((p) => !p)}
                  hitSlop={10}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={theme.textMuted}
                  />
                </Pressable>
              }
            />

            <AuthInput
              containerStyle={styles.fieldGap}
              label="Confirm password"
              placeholder="Re-enter your password"
              secureTextEntry={!showConfirm}
              value={values.confirmPassword}
              onChangeText={(t) => onChange({ confirmPassword: t })}
              editable={!loading}
              darkMode={darkMode}
              rightElement={
                <Pressable
                  onPress={() => setShowConfirm((p) => !p)}
                  hitSlop={10}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showConfirm ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={theme.textMuted}
                  />
                </Pressable>
              }
            />
          </View>

          {/* Switch to Sign In */}
          <View style={styles.footerSwitchRow}>
            <Text style={[styles.footerSwitchText, { color: theme.textMuted }]}>
              Already have an account?{" "}
            </Text>
            <Pressable onPress={onGoToLogin} hitSlop={8}>
              <Text style={[styles.footerSwitchLink, { color: theme.accent }]}>
                Sign in
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky Bottom Footer Bar ── */}
      <View
        style={[
          styles.stickyFooter,
          {
            backgroundColor: theme.bgSurface,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 14),
          },
        ]}
      >
        <View style={styles.stickyFooterInner}>
          <View style={styles.footerCaptionRow}>
            <Ionicons
              name="shield-checkmark-outline"
              size={14}
              color={theme.textMuted}
            />
            <Text
              style={[styles.footerCaptionText, { color: theme.textMuted }]}
              numberOfLines={1}
            >
              Next: Email OTP, then Teacher ID &amp; selfie check.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: theme.accent },
              pressed && styles.btnPressed,
              loading && styles.btnDisabled,
            ]}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* ── Searchable School Picker Modal ── */}
      <Modal
        visible={schoolPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSchoolPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setSchoolPickerOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Select school
              </Text>
              <Pressable
                onPress={() => setSchoolPickerOpen(false)}
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </Pressable>
            </View>

            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: theme.bgPage,
                  borderColor: theme.borderInput,
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={17}
                color={theme.textMuted}
              />
              <TextInput
                style={[styles.searchInput, { color: theme.textPrimary }]}
                placeholder="Search school name..."
                placeholderTextColor={theme.placeholder}
                value={schoolSearch}
                onChangeText={setSchoolSearch}
              />
            </View>

            <ScrollView style={styles.schoolList}>
              {filteredSchools.length === 0 ? (
                <Text
                  style={[styles.emptySearchText, { color: theme.textMuted }]}
                >
                  No matching schools found.
                </Text>
              ) : (
                filteredSchools.map((school) => {
                  const selected = values.schoolName === school;
                  return (
                    <TouchableOpacity
                      key={school}
                      style={[
                        styles.schoolOption,
                        selected && { backgroundColor: theme.accentBg },
                      ]}
                      onPress={() => {
                        onChange({ schoolName: school });
                        setSchoolPickerOpen(false);
                        setSchoolSearch("");
                      }}
                    >
                      <Ionicons
                        name="school-outline"
                        size={18}
                        color={selected ? theme.accent : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.schoolOptionText,
                          {
                            color: selected
                              ? theme.accentText
                              : theme.textPrimary,
                            fontWeight: selected ? "600" : "500",
                          },
                        ]}
                      >
                        {school}
                      </Text>
                      {selected && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={theme.accent}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    width: "100%",
  },
  flex1: {
    flex: 1,
  },
  /* ── Fixed Opaque Header ── */
  fixedHeader: {
    width: "100%",
    zIndex: 10,
  },
  fixedHeaderInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    marginLeft: -6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepMetaText: {
    fontSize: 13,
    fontWeight: "500",
  },
  progressTrack: {
    width: "100%",
    height: 3,
  },
  progressFill: {
    height: "100%",
  },
  /* ── Scrollable Body ── */
  scrollView: {
    flex: 1,
    width: "100%",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  contentColumn: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: 14,
  },
  pageHeading: {
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -2,
    marginBottom: 10,
  },
  selectedCountText: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: "row",
    gap: 10,
  },
  middleNameInput: {
    marginTop: 10,
  },
  fieldGap: {
    marginTop: 16,
  },
  dropdownTrigger: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dropdownValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  pressedSubtle: {
    opacity: 0.8,
  },
  /* ── Grade Levels Unified Card ── */
  gradeGroupsWrap: {
    gap: 14,
  },
  gradeGroupSection: {
    gap: 8,
  },
  gradeGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gradeGroupTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  selectAllText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  gradeRowsStack: {
    gap: 8,
  },
  gradeRow: {
    flexDirection: "row",
    gap: 8,
  },
  gradeChip: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
  },
  gradeChipText: {
    fontSize: 13,
  },
  /* ── Subjects / Strands ── */
  customSubjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addTagBtn: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addTagBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  subjectChip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  subjectChipText: {
    fontSize: 13,
  },
  eyeBtn: {
    padding: 4,
  },
  footerSwitchRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  footerSwitchText: {
    fontSize: 14,
  },
  footerSwitchLink: {
    fontSize: 14,
    fontWeight: "600",
  },
  /* ── Sticky Bottom Footer ── */
  stickyFooter: {
    width: "100%",
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  stickyFooterInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  footerCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 10,
  },
  footerCaptionText: {
    fontSize: 12,
    flexShrink: 1,
  },
  primaryBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  btnPressed: {
    opacity: 0.9,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  /* ── School Picker Modal ── */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 9, 11, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  searchBox: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  schoolList: {
    maxHeight: 240,
  },
  schoolOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  schoolOptionText: {
    flex: 1,
    fontSize: 14,
  },
  emptySearchText: {
    textAlign: "center",
    fontSize: 13,
    paddingVertical: 18,
  },
});
