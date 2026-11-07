import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import {
  ClassQuizAnalysis,
  DifficultyLevel,
  QuestionAnalysisSummary,
} from "../lib/questionAnalysis";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export interface ItemAnalysisModalProps {
  visible: boolean;
  onClose: () => void;
  analysis: ClassQuizAnalysis | null;
  quizTitle: string;
  accentColor?: string;
  onOpenStudentProfile?: (studentName: string) => void;
  onCreateRemedialQuiz?: (questionText?: string, topic?: string) => void;
}

export function ItemAnalysisModal({
  visible,
  onClose,
  analysis,
  quizTitle,
  accentColor = "#2563EB",
  onOpenStudentProfile,
  onCreateRemedialQuiz,
}: ItemAnalysisModalProps) {
  const { darkMode } = useTheme();
  const [filterLevel, setFilterLevel] = useState<"ALL" | DifficultyLevel>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedQNum, setExpandedQNum] = useState<number | null>(null);

  const bg = darkMode ? "#111827" : "#FFFFFF";
  const cardBg = darkMode ? "#1F2937" : "#F8FAFC";
  const border = darkMode ? "#374151" : "#E2E8F0";
  const textMain = darkMode ? "#F9FAFB" : "#0F172A";
  const textSub = darkMode ? "#9CA3AF" : "#64748B";

  // Filtered questions
  const filteredQuestions = useMemo(() => {
    if (!analysis || !analysis.questionBreakdown) return [];
    return analysis.questionBreakdown.filter((q) => {
      if (filterLevel !== "ALL" && q.difficultyLevel !== filterLevel) return false;
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase();
        const matchesNum = `q${q.questionNumber}`.includes(query) || `${q.questionNumber}` === query;
        const matchesText = q.questionText ? q.questionText.toLowerCase().includes(query) : false;
        return matchesNum || matchesText;
      }
      return true;
    });
  }, [analysis, filterLevel, searchQuery]);

  if (!visible || !analysis) return null;

  const {
    totalStudentsGraded,
    classAverageScore,
    averageDifficultyIndex,
    difficultyBreakdown,
    mostMissedQuestions,
    overallRecommendation,
  } = analysis;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: bg }]}>
        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleBadgeRow}>
              <View style={[styles.headerPill, { backgroundColor: accentColor + "18" }]}>
                <Ionicons name="bar-chart-outline" size={13} color={accentColor} />
                <Text style={[styles.headerPillText, { color: accentColor }]}>ITEM ANALYSIS</Text>
              </View>
              <Text style={[styles.headerSub, { color: textSub }]}>
                {totalStudentsGraded} Student{totalStudentsGraded !== 1 ? "s" : ""} Graded
              </Text>
            </View>
            <Text style={[styles.headerTitle, { color: textMain }]} numberOfLines={1}>
              {quizTitle || analysis.quizTitle || "Assessment Report"}
            </Text>
          </View>

          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={20} color={textMain} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ── Summary KPI Cards ── */}
          <View style={styles.kpiRow}>
            {/* Avg Difficulty */}
            <View style={[styles.kpiCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[styles.kpiLabel, { color: textSub }]}>Avg Difficulty (p)</Text>
              <Text style={[styles.kpiValue, { color: accentColor }]}>
                {averageDifficultyIndex.toFixed(2)}
              </Text>
              <Text style={[styles.kpiSub, { color: textSub }]}>
                {averageDifficultyIndex >= 0.75 ? "Easy Overall" : averageDifficultyIndex >= 0.25 ? "Balanced" : "Challenging"}
              </Text>
            </View>

            {/* Class Average */}
            <View style={[styles.kpiCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[styles.kpiLabel, { color: textSub }]}>Class Average</Text>
              <Text style={[styles.kpiValue, { color: classAverageScore >= 75 ? "#10B981" : classAverageScore <= 50 ? "#EF4444" : "#F59E0B" }]}>
                {classAverageScore}%
              </Text>
              <Text style={[styles.kpiSub, { color: textSub }]}>Overall Facility</Text>
            </View>

            {/* Questions Flagged */}
            <View style={[styles.kpiCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[styles.kpiLabel, { color: textSub }]}>Hard Items (p&lt;0.25)</Text>
              <Text style={[styles.kpiValue, { color: difficultyBreakdown.difficultCount > 0 ? "#EF4444" : "#10B981" }]}>
                {difficultyBreakdown.difficultCount}
              </Text>
              <Text style={[styles.kpiSub, { color: textSub }]}>
                {difficultyBreakdown.difficultCount > 0 ? "Needs Review" : "Optimal"}
              </Text>
            </View>
          </View>

          {/* ── Pedagogical Synthesis Banner ── */}
          {overallRecommendation ? (
            <View style={[styles.adviceBanner, { backgroundColor: darkMode ? "#1E1B4B" : "#EEF2FF", borderColor: "#6366F140" }]}>
              <Ionicons name="bulb-outline" size={20} color="#6366F1" style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.adviceTitle, { color: darkMode ? "#C7D2FE" : "#3730A3" }]}>
                  Tseki Diagnostic Recommendation
                </Text>
                <Text style={[styles.adviceText, { color: darkMode ? "#E0E7FF" : "#4338CA" }]}>
                  {overallRecommendation}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── Filter / Search Bar ── */}
          <View style={styles.filterSection}>
            <View style={[styles.searchBox, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="search" size={16} color={textSub} />
              <TextInput
                style={[styles.searchInput, { color: textMain }]}
                placeholder="Search by question number or text..."
                placeholderTextColor={textSub}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Ionicons name="close-circle" size={16} color={textSub} />
                </TouchableOpacity>
              )}
            </View>

            {/* Level Filter Pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterLevel === "ALL" && { backgroundColor: accentColor, borderColor: accentColor },
                  filterLevel !== "ALL" && { backgroundColor: cardBg, borderColor: border },
                ]}
                onPress={() => setFilterLevel("ALL")}
              >
                <Text style={[styles.filterPillText, filterLevel === "ALL" ? { color: "#FFF" } : { color: textMain }]}>
                  All ({analysis.questionBreakdown.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterLevel === "Difficult" && { backgroundColor: "#EF4444", borderColor: "#EF4444" },
                  filterLevel !== "Difficult" && { backgroundColor: cardBg, borderColor: border },
                ]}
                onPress={() => setFilterLevel("Difficult")}
              >
                <View style={[styles.dot, { backgroundColor: "#EF4444" }]} />
                <Text style={[styles.filterPillText, filterLevel === "Difficult" ? { color: "#FFF" } : { color: textMain }]}>
                  Difficult ({difficultyBreakdown.difficultCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterLevel === "Moderate" && { backgroundColor: "#2563EB", borderColor: "#2563EB" },
                  filterLevel !== "Moderate" && { backgroundColor: cardBg, borderColor: border },
                ]}
                onPress={() => setFilterLevel("Moderate")}
              >
                <View style={[styles.dot, { backgroundColor: "#2563EB" }]} />
                <Text style={[styles.filterPillText, filterLevel === "Moderate" ? { color: "#FFF" } : { color: textMain }]}>
                  Moderate ({difficultyBreakdown.moderateCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.filterPill,
                  filterLevel === "Easy" && { backgroundColor: "#10B981", borderColor: "#10B981" },
                  filterLevel !== "Easy" && { backgroundColor: cardBg, borderColor: border },
                ]}
                onPress={() => setFilterLevel("Easy")}
              >
                <View style={[styles.dot, { backgroundColor: "#10B981" }]} />
                <Text style={[styles.filterPillText, filterLevel === "Easy" ? { color: "#FFF" } : { color: textMain }]}>
                  Easy ({difficultyBreakdown.easyCount})
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* ── Question Cards List ── */}
          <View style={styles.questionsList}>
            {filteredQuestions.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
                <Ionicons name="search-outline" size={32} color={textSub} />
                <Text style={[styles.emptyText, { color: textMain }]}>No questions match your filter.</Text>
              </View>
            ) : (
              filteredQuestions.map((q) => {
                const isExpanded = expandedQNum === q.questionNumber;
                const isDifficult = q.difficultyLevel === "Difficult";
                const isModerate = q.difficultyLevel === "Moderate";
                const levelColor = isDifficult ? "#EF4444" : isModerate ? "#2563EB" : "#10B981";
                const levelBg = isDifficult
                  ? darkMode ? "#450A0A" : "#FEF2F2"
                  : isModerate
                  ? darkMode ? "#1E3A8A40" : "#EFF6FF"
                  : darkMode ? "#064E3B40" : "#ECFDF5";

                return (
                  <View key={q.questionNumber} style={[styles.itemCard, { backgroundColor: cardBg, borderColor: border }]}>
                    {/* Header Row */}
                    <TouchableOpacity
                      style={styles.itemHeader}
                      onPress={() => setExpandedQNum(isExpanded ? null : q.questionNumber)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.qBadge, { backgroundColor: levelBg, borderColor: levelColor }]}>
                        <Text style={[styles.qBadgeText, { color: levelColor }]}>Q{q.questionNumber}</Text>
                      </View>

                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <View style={styles.itemMetaRow}>
                          <View style={[styles.diffTag, { backgroundColor: levelBg }]}>
                            <Text style={[styles.diffTagText, { color: levelColor }]}>
                              {q.difficultyLevel.toUpperCase()} • p = {q.difficultyIndex.toFixed(2)}
                            </Text>
                          </View>
                          <Text style={[styles.accuracyText, { color: textSub }]}>
                            {q.accuracyRate}% Accuracy ({q.correctCount}/{q.totalAttempts})
                          </Text>
                        </View>
                        {q.questionText ? (
                          <Text style={[styles.itemQuestionText, { color: textMain }]} numberOfLines={isExpanded ? undefined : 2}>
                            {q.questionText}
                          </Text>
                        ) : null}
                      </View>

                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={textSub}
                      />
                    </TouchableOpacity>

                    {/* Progress Bar (Facility Meter) */}
                    <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#374151" : "#E2E8F0" }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.max(5, q.accuracyRate)}%`,
                            backgroundColor: levelColor,
                          },
                        ]}
                      />
                    </View>

                    {/* ── Distractor Distribution Bar ── */}
                    <View style={styles.distractorBarContainer}>
                      <Text style={[styles.distractorBarLabel, { color: textSub }]}>Student Choice Distribution:</Text>
                      <View style={styles.distractorPillsRow}>
                        {q.distractorBreakdown.map((opt) => (
                          <View
                            key={opt.option}
                            style={[
                              styles.choicePill,
                              opt.isCorrect
                                ? { backgroundColor: darkMode ? "#064E3B" : "#DCFCE7", borderColor: "#10B981" }
                                : opt.percentage >= 40
                                ? { backgroundColor: darkMode ? "#450A0A" : "#FEE2E2", borderColor: "#EF4444" }
                                : { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border },
                            ]}
                          >
                            <Text
                              style={[
                                styles.choicePillText,
                                opt.isCorrect
                                  ? { color: "#059669", fontWeight: "800" }
                                  : opt.percentage >= 40
                                  ? { color: "#DC2626", fontWeight: "700" }
                                  : { color: textSub },
                              ]}
                            >
                              [{opt.option}] {opt.percentage}% ({opt.count})
                              {opt.isCorrect ? " ✓" : ""}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Misconception Alert Callout */}
                    {q.mostCommonMistake && q.mostCommonMistake.percentage >= 35 && (
                      <View style={[styles.misconceptionCallout, { backgroundColor: darkMode ? "#78350F25" : "#FFFBEB", borderColor: "#F59E0B" }]}>
                        <Ionicons name="warning-outline" size={14} color="#D97706" />
                        <Text style={[styles.misconceptionText, { color: darkMode ? "#FDE68A" : "#92400E" }]}>
                          Primary Misconception: {q.mostCommonMistake.percentage}% of students incorrectly chose option [{q.mostCommonMistake.answer}].
                        </Text>
                      </View>
                    )}

                    {/* Expanded Details Section */}
                    {isExpanded && (
                      <View style={[styles.expandedBody, { borderTopColor: border }]}>
                        {/* Answer Key */}
                        <View style={styles.keyRow}>
                          <Text style={[styles.keyLabel, { color: textSub }]}>Official Answer Key:</Text>
                          <View style={[styles.keyBadge, { backgroundColor: "#10B981" }]}>
                            <Text style={styles.keyBadgeText}>{q.correctAnswer || "—"}</Text>
                          </View>
                        </View>

                        {/* Pedagogical Insight */}
                        {q.pedagogicalInsight ? (
                          <View style={[styles.insightBox, { backgroundColor: darkMode ? "#1F2937" : "#F1F5F9" }]}>
                            <Text style={[styles.insightTitle, { color: accentColor }]}>TEACHER INSIGHT</Text>
                            <Text style={[styles.insightText, { color: textMain }]}>{q.pedagogicalInsight}</Text>
                          </View>
                        ) : null}

                        {/* Students Who Missed */}
                        {(() => {
                          const missedWithNames = (q.studentsMissedDetails || []).filter(
                            (s) => Boolean(s.studentName && s.studentName.trim().length > 0)
                          );
                          if (missedWithNames.length === 0) return null;
                          return (
                            <View style={styles.studentsSection}>
                              <Text style={[styles.studentsSectionTitle, { color: "#EF4444" }]}>
                                Students Needing Support ({missedWithNames.length}):
                              </Text>
                              <View style={styles.studentChipsWrap}>
                                {missedWithNames.map((s, idx) => (
                                  <TouchableOpacity
                                    key={idx}
                                    style={[
                                      styles.studentChip,
                                      { backgroundColor: darkMode ? "#7F1D1D30" : "#FEE2E2", borderColor: "#EF444440" },
                                    ]}
                                    onPress={() => onOpenStudentProfile && onOpenStudentProfile(s.studentName)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={[styles.studentChipName, { color: darkMode ? "#FCA5A5" : "#B91C1C" }]}>
                                      {s.studentName}
                                    </Text>
                                    <Text style={[styles.studentChipAns, { color: darkMode ? "#F87171" : "#991B1B" }]}>
                                      chose [{s.studentAnswer}]
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                          );
                        })()}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* Footer with Single Remedial CTA */}
        {onCreateRemedialQuiz && (
          <View style={[styles.modalFooter, { backgroundColor: cardBg, borderTopColor: border }]}>
            <TouchableOpacity
              style={[styles.modalFooterBtn, { backgroundColor: accentColor }]}
              onPress={() => {
                onClose();
                onCreateRemedialQuiz();
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
              <Text style={styles.modalFooterBtnText}>Generate Remedial Quiz</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  titleBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  headerPillText: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  /* KPI Row */
  kpiRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  kpiSub: {
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
  },

  /* Advice Banner */
  adviceBanner: {
    flexDirection: "row",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  adviceTitle: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 2,
  },
  adviceText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },

  /* Filters */
  filterSection: {
    marginBottom: 14,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    marginLeft: 8,
  },
  pillsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },

  /* Questions List */
  questionsList: {
    gap: 12,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  itemCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  qBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  qBadgeText: {
    fontSize: 13,
    fontWeight: "800",
  },
  itemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  diffTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  diffTagText: {
    fontSize: 10.5,
    fontWeight: "800",
  },
  accuracyText: {
    fontSize: 11.5,
    fontWeight: "500",
  },
  itemQuestionText: {
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 10,
    marginBottom: 10,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },

  /* Distractor Choice Pills */
  distractorBarContainer: {
    marginTop: 2,
  },
  distractorBarLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  distractorPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  choicePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  choicePillText: {
    fontSize: 11,
  },

  /* Misconception Callout */
  misconceptionCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
  misconceptionText: {
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
  },

  /* Expanded Body */
  expandedBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 12,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  keyLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  keyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  keyBadgeText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 12,
  },
  insightBox: {
    padding: 10,
    borderRadius: 10,
  },
  insightTitle: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  insightText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },
  studentsSection: {
    gap: 6,
  },
  studentsSectionTitle: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  studentChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  studentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  studentChipName: {
    fontSize: 11,
    fontWeight: "700",
  },
  studentChipAns: {
    fontSize: 10.5,
    fontWeight: "500",
  },
  remedialActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 38,
    borderRadius: 10,
    marginTop: 4,
  },
  remedialActionText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  modalFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  modalFooterBtn: {
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modalFooterBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
