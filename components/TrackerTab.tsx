import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  getQuizPerformanceRecords,
  QuizPerformanceRecord,
  StoredQuiz,
} from "../lib/quizStore";
import { generateClassroomAdvice } from "../lib/pedagogicalAdvice";
import { useTheme } from "../context/ThemeContext";
import {
  analyzeQuizForClass,
  ClassQuizAnalysis,
  DifficultyLevel,
  QuestionAnalysisSummary,
} from "../lib/questionAnalysis";
import { ItemAnalysisModal } from "./ItemAnalysisModal";

export type TrackerStudent = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
  attendance?: number;
};

type TrackerTabProps = {
  classroomId: string;
  classTitle: string;
  classSubject: string;
  accentColor?: string;
  students: TrackerStudent[];
  publishedQuizzes: StoredQuiz[];
  selectedQuizTitle?: string;
  onOpenStudentProfile: (student: TrackerStudent) => void;
  onNavigateToAIBuilder: () => void;
  onNavigateToGrader?: (quizTitle?: string) => void;
};

function getStudentAvatar(_name: string): string | null {
  return null;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TrackerTab({
  classroomId,
  classTitle,
  classSubject,
  accentColor = "#2563EB",
  students,
  publishedQuizzes,
  selectedQuizTitle,
  onOpenStudentProfile,
  onNavigateToAIBuilder,
  onNavigateToGrader,
}: TrackerTabProps) {
  const [chartWidth, setChartWidth] = useState(320);
  const [perfRecords, setPerfRecords] = useState<QuizPerformanceRecord[]>([]);
  const { darkMode } = useTheme();

  const bg = darkMode ? "#111827" : "#F9FAFB";
  const cardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const textMain = darkMode ? "#F9FAFB" : "#0F172A";
  const textSub = darkMode ? "#9CA3AF" : "#64748B";
  const border = darkMode ? "#374151" : "#F1F5F9";
  const subBorder = darkMode ? "#374151" : "#E2E8F0";

  // ── Load Real Quiz Performance History ───────────────────────────────────
  useEffect(() => {
    if (classroomId) {
      getQuizPerformanceRecords(classroomId).then(setPerfRecords);
    }
  }, [classroomId, publishedQuizzes, students]);

  // ── Metrics Calculation ──────────────────────────────────────────────────
  const hasStudents = students.length > 0;
  const totalAvg = students.reduce((acc, s) => acc + (s.average ?? 0), 0);
  const classAvg = hasStudents ? Math.round(totalAvg / students.length) : 0;

  const passingCount = students.filter((s) => (s.average ?? 0) >= 75).length;
  const passRate = hasStudents ? Math.round((passingCount / students.length) * 100) : 0;

  const flaggedStudents = students.filter((s) => (s.average ?? 0) <= 50);
  const atRiskCount = flaggedStudents.length;
  const atRiskList = flaggedStudents.map((s) => ({
    name: s.full_name,
    average: s.average ?? 0,
  }));

  const sortedStudents = [...students].sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const highestScore = sortedStudents[0]?.average ?? 0;
  const topStudents = sortedStudents
    .filter((s) => (s.average ?? 0) === highestScore && highestScore > 50)
    .map((s) => ({ name: s.full_name, average: s.average ?? 0 }));

  let calculatedTrend: "improving" | "declining" | "stable" | "insufficient_data" = "insufficient_data";
  if (perfRecords.length >= 2) {
    const first = perfRecords[0].averageScore;
    const last = perfRecords[perfRecords.length - 1].averageScore;
    const diff = last - first;
    if (diff > 3) calculatedTrend = "improving";
    else if (diff < -3) calculatedTrend = "declining";
    else calculatedTrend = "stable";
  }

  const activeQuizName =
    publishedQuizzes[0]?.quizTitle ||
    selectedQuizTitle ||
    (classSubject && classSubject !== "No Subject" ? classSubject : (classTitle ? `${classTitle} Assessment` : "Class Assessment"));

  // ── Item Analysis States & Synchronized Loader ───────────────────────────
  const [itemAnalysis, setItemAnalysis] = useState<ClassQuizAnalysis | null>(null);
  const [itemAnalysisLoading, setItemAnalysisLoading] = useState(false);
  const [itemAnalysisModalVisible, setItemAnalysisModalVisible] = useState(false);
  const [itemAnalysisViewMode, setItemAnalysisViewMode] = useState<"MOST_MISSED" | "DIFFICULTY_INDEX">("MOST_MISSED");
  const [difficultyFilter, setDifficultyFilter] = useState<"ALL" | DifficultyLevel>("ALL");
  const [activeQuizTitle, setActiveQuizTitle] = useState<string>(selectedQuizTitle || "");
  const [expandedAnalysisQNum, setExpandedAnalysisQNum] = useState<number | null>(null);

  const availableQuizOptions = Array.from(
    new Set(
      [
        ...publishedQuizzes.map((q) => q.quizTitle),
        ...perfRecords.map((r) => r.quizTitle),
        activeQuizName,
      ].filter(Boolean)
    )
  );

  useEffect(() => {
    let isMounted = true;
    async function loadAnalysis() {
      const targetQuiz = activeQuizTitle || activeQuizName;
      const matchedPublished = publishedQuizzes.find((q) => q.quizTitle === targetQuiz);
      setItemAnalysisLoading(true);
      try {
        const result = await analyzeQuizForClass(
          classroomId,
          targetQuiz,
          matchedPublished,
          students.map((s) => ({ id: s.id, full_name: s.full_name }))
        );
        if (isMounted) {
          setItemAnalysis(result);
        }
      } catch (e) {
        console.warn("[TrackerTab] Failed to analyze quiz:", e);
      } finally {
        if (isMounted) setItemAnalysisLoading(false);
      }
    }
    loadAnalysis();
    return () => {
      isMounted = false;
    };
  }, [classroomId, activeQuizTitle, activeQuizName, publishedQuizzes, students]);

  // ── Grade Distribution ──────────────────────────────────────────────────
  const countA = students.filter((s) => (s.average ?? 0) >= 90).length;
  const countB = students.filter((s) => (s.average ?? 0) >= 80 && (s.average ?? 0) < 90).length;
  const countC = students.filter((s) => (s.average ?? 0) >= 75 && (s.average ?? 0) < 80).length;
  const countF = students.filter((s) => (s.average ?? 0) < 75).length;

  const gradeBuckets = [
    { grade: "F", range: "<75", count: countF, color: "#EF4444" },
    { grade: "C", range: "75-79", count: countC, color: "#F59E0B" },
    { grade: "B", range: "80-89", count: countB, color: "#3B82F6" },
    { grade: "A", range: "90-100", count: countA, color: "#10B981" },
  ];

  const maxGradeCount = Math.max(...gradeBuckets.map((b) => b.count), 1);

  // ── Functional Class Performance Trend ──────────────────────────────────
  // Construct data points anchored dynamically to real performance or recorded quizzes
  interface TrendPoint {
    label: string;
    fullTitle: string;
    value: number;
    submissions: number;
    isDrop?: boolean;
    isReal?: boolean;
  }

  const baseScore = Math.max(0, Math.min(100, classAvg));

  let trendPoints: TrendPoint[] = [];

  if (perfRecords.length > 0) {
    // Show only real quizzes that have been graded
    trendPoints = perfRecords.map((r, i, arr) => {
      const displayLabel =
        r.quizTitle.length <= 10
          ? r.quizTitle
          : r.quizTitle.toLowerCase().startsWith("quiz")
          ? r.quizTitle.slice(0, 10)
          : `Quiz ${i + 1}`;

      return {
        label: displayLabel,
        fullTitle: r.quizTitle,
        value: r.averageScore,
        submissions: r.totalSubmissions,
        isDrop: i > 0 && r.averageScore < arr[i - 1].averageScore - 5,
        isReal: true,
      };
    });
  } else if (publishedQuizzes.length > 0) {
    // Show only the actual quizzes created in this classroom
    trendPoints = publishedQuizzes.map((q, i) => {
      const displayLabel =
        q.quizTitle.length <= 10
          ? q.quizTitle
          : q.quizTitle.toLowerCase().startsWith("quiz")
          ? q.quizTitle.slice(0, 10)
          : `Quiz ${i + 1}`;

      return {
        label: displayLabel,
        fullTitle: q.quizTitle,
        value: baseScore,
        submissions: students.length,
        isReal: true,
      };
    });
  } else if (students.length > 0) {
    // Only 1 baseline assessment active based on current student scores
    trendPoints = [
      {
        label: "Quiz 1",
        fullTitle: activeQuizName || "Class Assessment 1",
        value: baseScore,
        submissions: students.length,
        isReal: true,
      },
    ];
  }

  // Track user interactive selection on chart
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, trendPoints.length - 1));
  const selectedPoint = trendPoints[activeIndex];

  // Chart layout geometry: full 0% to 100% linear scale
  const leftPadding = 42;
  const rightPadding = 20;
  const plotWidth = Math.max(chartWidth - leftPadding - rightPadding, 180);
  const plotHeight = 100;
  const minY = 0;
  const maxY = 100;

  const getX = (index: number) =>
    leftPadding + (trendPoints.length > 1 ? (index / (trendPoints.length - 1)) * plotWidth : plotWidth / 2);
  const getY = (val: number) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return plotHeight - ((clamped - minY) / (maxY - minY)) * plotHeight;
  };

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* ── Section 1: 4 Key Metric Cards (2x2 Grid) ── */}
      <View style={styles.metricsGrid}>
        {/* Card 1: Class Average */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Class Average</Text>
          <Text style={[styles.metricValue, { color: "#2563EB" }]}>{classAvg}%</Text>
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, { color: classAvg >= 75 ? "#16A34A" : "#DC2626" }]}>
              {classAvg >= 75 ? "↗ +2.4%" : classAvg <= 50 ? "↘ -3.1%" : "↗ Stable"}
            </Text>
          </View>
        </View>

        {/* Card 2: Pass Rate */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Pass Rate (≥75%)</Text>
          <Text style={[styles.metricValue, { color: "#EA580C" }]}>{passRate}%</Text>
          <Text style={[styles.metricSub, { color: textSub }]}>Target 85%</Text>
        </View>

        {/* Card 3: Total Enrolled */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Total Enrolled</Text>
          <Text style={[styles.metricValue, { color: "#10B981" }]}>{students.length}</Text>
          <Text style={[styles.metricSub, { color: textSub }]}>Active Roster</Text>
        </View>

        {/* Card 4: At-Risk Flags */}
        <View style={[styles.metricCard, styles.atRiskMetricCard, darkMode && { backgroundColor: "#450A0A50", borderColor: "#7F1D1D" }]}>
          <View style={styles.atRiskHeaderRow}>
            <Ionicons name="warning-outline" size={14} color="#DC2626" />
            <Text style={styles.atRiskMetricLabel}>At-Risk Flags</Text>
          </View>
          <Text style={[styles.metricValue, { color: "#DC2626" }]}>{atRiskCount}</Text>
          <Text style={styles.atRiskMetricSub}>
            {atRiskCount > 0 ? "Requires Action" : "All Clear"}
          </Text>
        </View>
      </View>

      {/* ── Section 2: Grade Distribution Histogram ── */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={styles.distHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: textMain }]}>Grade Distribution</Text>
            <Text style={[styles.cardSub, { color: textSub }]}>
              Student breakdown across grading performance bands
            </Text>
          </View>
          <View style={[styles.totalEnrolledBadge, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}>
            <Text style={[styles.totalEnrolledBadgeText, { color: textSub }]}>
              {students.length} Student{students.length !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>

        {/* Histogram Bars */}
        <View style={styles.histogramContainer}>
          {gradeBuckets.map((bucket) => {
            const fillHeight =
              bucket.count > 0
                ? Math.max(16, Math.round((bucket.count / maxGradeCount) * 85))
                : 0;

            return (
              <View key={bucket.grade} style={styles.histogramCol}>
                {/* Count badge above bar */}
                <View style={styles.countBadgeWrapper}>
                  {bucket.count > 0 ? (
                    <View style={[styles.countBadgePill, { backgroundColor: bucket.color + "18" }]}>
                      <Text style={[styles.countBadgeText, { color: bucket.color }]}>
                        {bucket.count}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.countBadgeText, { color: textSub, opacity: 0.5 }]}>0</Text>
                  )}
                </View>

                {/* Vertical Bar with Track */}
                <View style={[styles.barTrack, { backgroundColor: darkMode ? "#37415166" : "#F1F5F9" }]}>
                  {fillHeight > 0 && (
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: fillHeight,
                          backgroundColor: bucket.color,
                        },
                      ]}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Baseline Axis */}
        <View style={[styles.baselineAxis, { backgroundColor: subBorder }]} />

        {/* Grade Labels & Ranges */}
        <View style={styles.gradeLabelsRow}>
          {gradeBuckets.map((bucket) => {
            const percent = students.length > 0 ? Math.round((bucket.count / students.length) * 100) : 0;
            return (
              <View key={bucket.grade} style={styles.gradeLabelCol}>
                <View style={[styles.gradePill, { backgroundColor: bucket.color + "14", borderColor: bucket.color + "35" }]}>
                  <Text style={[styles.gradeLetter, { color: bucket.color }]}>{bucket.grade}</Text>
                </View>
                <Text style={[styles.gradeRange, { color: textSub }]}>{bucket.range}</Text>
                <Text style={[styles.gradePercent, { color: bucket.count > 0 ? bucket.color : textSub }]}>
                  {percent}%
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Section 3: Class Performance Trend (Interactive & Fully Functional) ── */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={styles.trendHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: textMain }]}>Class Performance Trend</Text>
            <Text style={[styles.cardSub, { color: textSub }]}>
              Tracking overall score average over consecutive quizzes
            </Text>
          </View>
          {onNavigateToGrader && (
            <TouchableOpacity
              style={[
                styles.gradeQuizBtn,
                {
                  backgroundColor: darkMode ? accentColor + "22" : accentColor + "14",
                  borderColor: darkMode ? accentColor + "55" : accentColor + "35",
                },
              ]}
              onPress={() => {
                if (publishedQuizzes.length === 0) {
                  Alert.alert(
                    "No Quizzes Published Yet",
                    "You haven't created any quizzes for this classroom yet. Please create and publish a quiz in the AI Builder tab first so Tseki knows the answer key!",
                    [
                      { text: "Create Quiz", onPress: onNavigateToAIBuilder },
                      { text: "Cancel", style: "cancel" },
                    ]
                  );
                  return;
                }
                const targetQuiz = selectedPoint?.fullTitle || publishedQuizzes[0]?.quizTitle;
                onNavigateToGrader(targetQuiz);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="scan-outline" size={15} color={accentColor} />
              <Text style={[styles.gradeQuizBtnText, { color: accentColor }]}>Grade Quiz</Text>
            </TouchableOpacity>
          )}
        </View>

        {trendPoints.length === 0 ? (
          <View style={styles.trendEmptyContainer}>
            <Ionicons name="trending-up-outline" size={32} color={darkMode ? "#4B5563" : "#CBD5E1"} />
            <Text style={[styles.trendEmptyTitle, { color: textMain }]}>No Assessment Records</Text>
            <Text style={[styles.trendEmptySub, { color: textSub }]}>
              Create a quiz or record student scores in Grader to begin tracking your class performance trend.
            </Text>
          </View>
        ) : (
          <>
            {/* Interactive Selected Quiz Detail Banner */}
            {selectedPoint && (
              <View style={[styles.trendDetailBanner, { backgroundColor: darkMode ? "#111827" : "#F8FAFC", borderColor: border }]}>
                <View style={{ flex: 1 }}>
                  <View style={styles.trendDetailHeader}>
                    <Ionicons name="analytics" size={13} color="#2563EB" />
                    <Text style={[styles.trendDetailTitle, { color: textMain }]} numberOfLines={1}>
                      {selectedPoint.fullTitle || selectedPoint.label}
                    </Text>
                  </View>
                  <Text style={[styles.trendDetailSub, { color: textSub }]}>
                    {selectedPoint.submissions} student{selectedPoint.submissions !== 1 ? "s" : ""} recorded
                  </Text>
                </View>
                <View style={styles.trendDetailScoreBox}>
                  <Text
                    style={[
                      styles.trendDetailScore,
                      {
                        color:
                          selectedPoint.value >= 75
                            ? "#16A34A"
                            : selectedPoint.value <= 50
                            ? "#DC2626"
                            : "#EA580C",
                      },
                    ]}
                  >
                    {selectedPoint.value}%
                  </Text>
                  <Text
                    style={[
                      styles.trendDetailStatus,
                      {
                        color:
                          selectedPoint.value >= 75
                            ? "#16A34A"
                            : selectedPoint.value <= 50
                            ? "#DC2626"
                            : "#EA580C",
                      },
                    ]}
                  >
                    {selectedPoint.value >= 75
                      ? "Passing"
                      : selectedPoint.value <= 50
                      ? "At Risk"
                      : "On Track"}
                  </Text>
                </View>
              </View>
            )}

            <View
              style={styles.chartContainer}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - chartWidth) > 5) {
                  setChartWidth(w);
                }
              }}
            >
              {/* Full Y-Axis Grid Lines & Labels: 100%, 75%, 50%, 25%, 0% */}
              {[100, 75, 50, 25, 0].map((level) => {
                const yPos = getY(level);
                return (
                  <View key={level} style={[styles.gridLineRow, { top: yPos }]}>
                    <Text style={[styles.gridLabel, { color: textSub }]}>{level}%</Text>
                    <View style={[styles.gridLine, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]} />
                  </View>
                );
              })}

              {/* Shaded Area Tint Under Graph */}
              <View style={[styles.chartAreaFill, { left: leftPadding, width: plotWidth, height: plotHeight }]} />

              {/* Connected Line Segments */}
              {trendPoints.map((pt, idx) => {
                if (idx === trendPoints.length - 1) return null;
                const nextPt = trendPoints[idx + 1];

                const x1 = getX(idx);
                const y1 = getY(pt.value);
                const x2 = getX(idx + 1);
                const y2 = getY(nextPt.value);

                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.hypot(dx, dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);

                const isDropSegment = nextPt.value <= 50 || nextPt.isDrop;

                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;

                return (
                  <View
                    key={`line-${idx}`}
                    style={{
                      position: "absolute",
                      left: cx - length / 2,
                      top: cy - 1.75,
                      width: length,
                      height: 3.5,
                      backgroundColor: isDropSegment ? "#EA580C" : "#3B82F6",
                      borderRadius: 2,
                      transform: [{ rotate: `${angle}deg` }],
                      zIndex: 2,
                    }}
                  />
                );
              })}

              {/* Interactive Tap Zones & Dots on Data Points */}
              {trendPoints.map((pt, idx) => {
                const x = getX(idx);
                const y = getY(pt.value);
                const isSelected = activeIndex === idx;
                const isDrop = pt.value <= 50 || pt.isDrop;

                return (
                  <React.Fragment key={`interactive-${idx}`}>
                    {/* Highlight Pulse Ring when selected */}
                    {isSelected && (
                      <View
                        style={[
                          styles.selectedDotRing,
                          {
                            left: x - 10,
                            top: y - 10,
                            borderColor: isDrop ? "rgba(234, 88, 12, 0.35)" : "rgba(37, 99, 235, 0.35)",
                          },
                        ]}
                      />
                    )}

                    {/* Dot */}
                    <TouchableOpacity
                      style={[
                        styles.chartDot,
                        {
                          left: x - 6,
                          top: y - 6,
                          backgroundColor: isDrop ? "#EA580C" : "#2563EB",
                          borderColor: darkMode ? "#1F2937" : "#FFFFFF",
                          transform: [{ scale: isSelected ? 1.25 : 1 }],
                        },
                      ]}
                      onPress={() => {
                        setSelectedIndex(idx);
                        if (trendPoints[idx]?.fullTitle) {
                          setActiveQuizTitle(trendPoints[idx].fullTitle);
                        }
                      }}
                      activeOpacity={0.8}
                    />
                  </React.Fragment>
                );
              })}

              {/* Chart Baseline */}
              <View style={[styles.chartBaseline, { left: leftPadding, width: plotWidth, top: plotHeight + 4, backgroundColor: subBorder }]} />

              {/* X-Axis Labels (Centered directly under dot, tap to select) */}
              <View style={[styles.xAxisRow, { top: plotHeight + 10, left: 0, right: 0 }]}>
                {trendPoints.map((pt, idx) => {
                  const x = getX(idx);
                  const isSelected = activeIndex === idx;
                  return (
                    <TouchableOpacity
                      key={`lbl-${idx}`}
                      style={{
                        position: "absolute",
                        left: x - 35,
                        width: 70,
                        alignItems: "center",
                      }}
                      onPress={() => {
                        setSelectedIndex(idx);
                        if (trendPoints[idx]?.fullTitle) {
                          setActiveQuizTitle(trendPoints[idx].fullTitle);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.xAxisLabel,
                          { color: textSub },
                          isSelected && { color: "#2563EB", fontWeight: "800" },
                        ]}
                        numberOfLines={1}
                      >
                        {pt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Tip / helper below chart */}
            <View style={[styles.chartFooterHint, { borderTopColor: subBorder }]}>
              <Ionicons name="information-circle-outline" size={13} color={textSub} />
              <Text style={[styles.chartFooterHintText, { color: textSub }]}>
                {trendPoints.length <= 1
                  ? "1 assessment recorded. Subsequent quizzes will form the trend line."
                  : "Tap any quiz point above to view detailed assessment metrics"}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ── Section 4: Item Analysis (Most Missed Questions & Difficulty Index) ── */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={styles.itemAnalysisHeaderRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <View style={[styles.miniHeaderPill, { backgroundColor: accentColor + "18" }]}>
                <Ionicons name="analytics" size={12} color={accentColor} />
                <Text style={[styles.miniHeaderPillText, { color: accentColor }]}>ITEM ANALYSIS</Text>
              </View>
              <Text style={[styles.headerSubText, { color: textSub }]}>
                {itemAnalysis?.totalStudentsGraded ?? 0} Submissions
              </Text>
            </View>
            <Text style={[styles.cardTitle, { color: textMain }]}>Question Performance & Difficulty</Text>
            <Text style={[styles.cardSub, { color: textSub }]}>
              Difficulty index (p-value), most missed questions & distractor diagnostic metrics
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.inspectMatrixBtn,
              {
                backgroundColor: darkMode ? accentColor + "22" : accentColor + "14",
                borderColor: darkMode ? accentColor + "55" : accentColor + "35",
              },
            ]}
            onPress={() => setItemAnalysisModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="expand-outline" size={14} color={accentColor} />
            <Text style={[styles.inspectMatrixBtnText, { color: accentColor }]}>Full Matrix</Text>
          </TouchableOpacity>
        </View>

        {/* Quiz Selector Carousel (if multiple quizzes available) */}
        {availableQuizOptions.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quizSelectorScroll}>
            {availableQuizOptions.map((qTitle) => {
              const isSelected = qTitle === (activeQuizTitle || activeQuizName);
              return (
                <TouchableOpacity
                  key={qTitle}
                  style={[
                    styles.quizSelectorPill,
                    isSelected
                      ? { backgroundColor: accentColor, borderColor: accentColor }
                      : { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border },
                  ]}
                  onPress={() => setActiveQuizTitle(qTitle)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.quizSelectorPillText,
                      isSelected ? { color: "#FFFFFF", fontWeight: "800" } : { color: textSub },
                    ]}
                    numberOfLines={1}
                  >
                    {qTitle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {!itemAnalysis || itemAnalysis.questionBreakdown.length === 0 ? (
          <View style={[styles.emptyItemBox, { backgroundColor: darkMode ? "#1F2937" : "#F8FAFC", paddingVertical: 28, alignItems: "center", borderRadius: 12, marginVertical: 8 }]}>
            <Ionicons name="document-text-outline" size={36} color={textSub} style={{ marginBottom: 8 }} />
            <Text style={{ color: textMain, fontWeight: "700", fontSize: 14 }}>
              No Graded Test Papers Yet
            </Text>
            <Text style={{ color: textSub, fontSize: 12, textAlign: "center", marginTop: 4, paddingHorizontal: 24, lineHeight: 18 }}>
              Scan or grade student test sheets using the Grader tab to generate item difficulty indices (p-values) and distractor diagnostics.
            </Text>
          </View>
        ) : (
          <>
            {/* ── 3 Key Item Metrics ── */}
            <View style={styles.analysisKpiRow}>
          {/* Card 1: Top Most Missed Question */}
          <View style={[styles.analysisKpiCard, { backgroundColor: darkMode ? "#450A0A30" : "#FEF2F2", borderColor: "#FCA5A5" }]}>
            <View style={styles.analysisKpiHeader}>
              <Ionicons name="alert-circle" size={13} color="#DC2626" />
              <Text style={[styles.analysisKpiLabel, { color: "#B91C1C" }]}>Most Missed</Text>
            </View>
            <Text style={[styles.analysisKpiVal, { color: "#DC2626" }]}>
              {itemAnalysis?.mostMissedQuestions[0] ? `Q${itemAnalysis.mostMissedQuestions[0].questionNumber}` : "None"}
            </Text>
            <Text style={[styles.analysisKpiSub, { color: "#991B1B" }]}>
              {itemAnalysis?.mostMissedQuestions[0]
                ? `${itemAnalysis.mostMissedQuestions[0].missedRate}% Missed • p=${itemAnalysis.mostMissedQuestions[0].difficultyIndex.toFixed(2)}`
                : "No data"}
            </Text>
          </View>

          {/* Card 2: Easiest Question */}
          <View style={[styles.analysisKpiCard, { backgroundColor: darkMode ? "#064E3B30" : "#ECFDF5", borderColor: "#A7F3D0" }]}>
            <View style={styles.analysisKpiHeader}>
              <Ionicons name="checkmark-circle" size={13} color="#059669" />
              <Text style={[styles.analysisKpiLabel, { color: "#065F46" }]}>Easiest Item</Text>
            </View>
            <Text style={[styles.analysisKpiVal, { color: "#059669" }]}>
              {itemAnalysis?.easiestQuestions[0] ? `Q${itemAnalysis.easiestQuestions[0].questionNumber}` : "None"}
            </Text>
            <Text style={[styles.analysisKpiSub, { color: "#047857" }]}>
              {itemAnalysis?.easiestQuestions[0]
                ? `${itemAnalysis.easiestQuestions[0].accuracyRate}% Acc • p=${itemAnalysis.easiestQuestions[0].difficultyIndex.toFixed(2)}`
                : "No data"}
            </Text>
          </View>

          {/* Card 3: Class Avg Difficulty Index */}
          <View style={[styles.analysisKpiCard, { backgroundColor: darkMode ? "#1E3A8A30" : "#EFF6FF", borderColor: "#BFDBFE" }]}>
            <View style={styles.analysisKpiHeader}>
              <Ionicons name="speedometer-outline" size={13} color="#2563EB" />
              <Text style={[styles.analysisKpiLabel, { color: "#1E40AF" }]}>Avg Difficulty</Text>
            </View>
            <Text style={[styles.analysisKpiVal, { color: "#2563EB" }]}>
              p = {itemAnalysis?.averageDifficultyIndex.toFixed(2) ?? "0.50"}
            </Text>
            <Text style={[styles.analysisKpiSub, { color: "#1D4ED8" }]}>
              {itemAnalysis && itemAnalysis.averageDifficultyIndex >= 0.75
                ? "Easy Facility"
                : itemAnalysis && itemAnalysis.averageDifficultyIndex >= 0.25
                ? "Moderate (Ideal)"
                : "Difficult Test"}
            </Text>
          </View>
        </View>

        {/* ── Mode Switcher Tab ── */}
        <View style={[styles.tabSegmentWrap, { backgroundColor: darkMode ? "#111827" : "#F1F5F9" }]}>
          <TouchableOpacity
            style={[
              styles.tabSegmentBtn,
              itemAnalysisViewMode === "MOST_MISSED" && [styles.tabSegmentBtnActive, { backgroundColor: cardBg }],
            ]}
            onPress={() => setItemAnalysisViewMode("MOST_MISSED")}
            activeOpacity={0.8}
          >
            <Ionicons
              name="flame"
              size={14}
              color={itemAnalysisViewMode === "MOST_MISSED" ? "#DC2626" : textSub}
            />
            <Text
              style={[
                styles.tabSegmentText,
                itemAnalysisViewMode === "MOST_MISSED"
                  ? { color: textMain, fontWeight: "800" }
                  : { color: textSub },
              ]}
            >
              Most Missed ({itemAnalysis?.mostMissedQuestions.length ?? 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabSegmentBtn,
              itemAnalysisViewMode === "DIFFICULTY_INDEX" && [styles.tabSegmentBtnActive, { backgroundColor: cardBg }],
            ]}
            onPress={() => setItemAnalysisViewMode("DIFFICULTY_INDEX")}
            activeOpacity={0.8}
          >
            <Ionicons
              name="list-outline"
              size={14}
              color={itemAnalysisViewMode === "DIFFICULTY_INDEX" ? accentColor : textSub}
            />
            <Text
              style={[
                styles.tabSegmentText,
                itemAnalysisViewMode === "DIFFICULTY_INDEX"
                  ? { color: textMain, fontWeight: "800" }
                  : { color: textSub },
              ]}
            >
              Difficulty Index ({itemAnalysis?.questionBreakdown.length ?? 0})
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── MODE 1: MOST MISSED QUESTIONS ── */}
        {itemAnalysisViewMode === "MOST_MISSED" && (
          <View style={styles.mostMissedList}>
            {itemAnalysis && itemAnalysis.mostMissedQuestions.length > 0 ? (
              itemAnalysis.mostMissedQuestions.slice(0, 3).map((q, idx) => {
                const isTop1 = idx === 0;
                const isDifficult = q.difficultyLevel === "Difficult";
                const isModerate = q.difficultyLevel === "Moderate";
                const badgeColor = isDifficult ? "#EF4444" : isModerate ? "#2563EB" : "#10B981";
                const badgeBg = isDifficult
                  ? (darkMode ? "#450A0A" : "#FEE2E2")
                  : isModerate
                  ? (darkMode ? "#1E3A8A40" : "#EFF6FF")
                  : (darkMode ? "#064E3B40" : "#ECFDF5");

                return (
                  <View
                    key={q.questionNumber}
                    style={[
                      styles.missedCard,
                      {
                        backgroundColor: darkMode ? "#1E1E2E" : "#FFFFFF",
                        borderColor: isTop1 ? "#FCA5A5" : border,
                        borderWidth: isTop1 ? 1.5 : 1,
                      },
                    ]}
                  >
                    <View style={styles.missedCardHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        <View style={[styles.missedBadge, { backgroundColor: badgeBg, borderColor: badgeColor }]}>
                          <Text style={[styles.missedBadgeText, { color: badgeColor }]}>Q{q.questionNumber}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <View style={[styles.miniDiffPill, { backgroundColor: badgeBg }]}>
                              <Text style={[styles.miniDiffPillText, { color: badgeColor }]}>
                                {q.difficultyLevel.toUpperCase()} • p = {q.difficultyIndex.toFixed(2)}
                              </Text>
                            </View>
                            <Text style={[styles.missedRateText, { color: "#DC2626" }]}>
                              {q.missedRate}% Missed
                            </Text>
                          </View>
                          <Text style={[styles.missedAttemptsText, { color: textSub }]}>
                            {q.incorrectCount} of {q.totalAttempts} students got this wrong
                          </Text>
                        </View>
                      </View>

                      <View style={[styles.keyPill, { backgroundColor: darkMode ? "#064E3B" : "#DCFCE7", borderColor: "#10B981" }]}>
                        <Text style={styles.keyPillText}>Key: [{q.correctAnswer}]</Text>
                      </View>
                    </View>

                    {/* Question Text */}
                    {q.questionText ? (
                      <Text style={[styles.missedQuestionText, { color: textMain }]} numberOfLines={2}>
                        {q.questionText}
                      </Text>
                    ) : null}

                    {/* Visual Facility Bar */}
                    <View style={[styles.miniFacilityTrack, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}>
                      <View
                        style={[
                          styles.miniFacilityFill,
                          {
                            width: `${Math.max(6, q.accuracyRate)}%`,
                            backgroundColor: badgeColor,
                          },
                        ]}
                      />
                    </View>

                    {/* Distractor Choices Distribution */}
                    <View style={styles.distractorBarWrap}>
                      <Text style={[styles.distractorLabel, { color: textSub }]}>Student Choices:</Text>
                      <View style={styles.distractorPillRow}>
                        {q.distractorBreakdown.map((opt) => (
                          <View
                            key={opt.option}
                            style={[
                              styles.miniChoicePill,
                              opt.isCorrect
                                ? { backgroundColor: darkMode ? "#064E3B40" : "#ECFDF5", borderColor: "#10B981" }
                                : opt.percentage >= 35
                                ? { backgroundColor: darkMode ? "#450A0A" : "#FEE2E2", borderColor: "#EF4444" }
                                : { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border },
                            ]}
                          >
                            <Text
                              style={[
                                styles.miniChoiceText,
                                opt.isCorrect
                                  ? { color: "#059669", fontWeight: "800" }
                                  : opt.percentage >= 35
                                  ? { color: "#DC2626", fontWeight: "700" }
                                  : { color: textSub },
                              ]}
                            >
                              [{opt.option}] {opt.percentage}%
                              {opt.isCorrect ? " ✓" : opt.percentage >= 35 ? " ⚠️" : ""}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    {/* Misconception Alert Callout */}
                    {q.mostCommonMistake && q.mostCommonMistake.percentage >= 35 && (
                      <View style={[styles.miniMisconceptionBox, { backgroundColor: darkMode ? "#78350F25" : "#FFFBEB", borderColor: "#F59E0B" }]}>
                        <Ionicons name="warning-outline" size={13} color="#D97706" />
                        <Text style={[styles.miniMisconceptionText, { color: darkMode ? "#FDE68A" : "#92400E" }]}>
                          Misconception Alert: {q.mostCommonMistake.percentage}% chose option [{q.mostCommonMistake.answer}].
                        </Text>
                      </View>
                    )}

                    {/* Students Who Missed */}
                    {q.studentsMissed && q.studentsMissed.length > 0 && (
                      <View style={styles.missedStudentsWrap}>
                        <Text style={[styles.missedStudentsLabel, { color: textSub }]}>Students who missed:</Text>
                        <View style={styles.missedStudentPillsRow}>
                          {q.studentsMissed.slice(0, 4).map((name, i) => (
                            <TouchableOpacity
                              key={i}
                              style={[styles.missedStudentChip, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}
                              onPress={() => onOpenStudentProfile({ id: `stud-${i}`, full_name: name, email: null, average: 65 })}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.missedStudentChipText, { color: textMain }]}>{name}</Text>
                            </TouchableOpacity>
                          ))}
                          {q.studentsMissed.length > 4 && (
                            <Text style={[styles.missedMoreCount, { color: textSub }]}>
                              +{q.studentsMissed.length - 4} more
                            </Text>
                          )}
                        </View>
                      </View>
                    )}

                    {/* Action button */}
                    <TouchableOpacity
                      style={[styles.remedialSmallBtn, { backgroundColor: accentColor + "14", borderColor: accentColor + "30" }]}
                      onPress={onNavigateToAIBuilder}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="sparkles" size={13} color={accentColor} />
                      <Text style={[styles.remedialSmallBtnText, { color: accentColor }]}>
                        Re-teach Concept / Generate Remedial Quiz
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            ) : (
              <View style={[styles.emptyItemBox, { backgroundColor: darkMode ? "#1F2937" : "#F8FAFC" }]}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#10B981" />
                <Text style={[styles.emptyItemText, { color: textMain }]}>All items mastered with high accuracy!</Text>
              </View>
            )}
          </View>
        )}

        {/* ── MODE 2: PER-QUESTION DIFFICULTY INDEX TABLE ── */}
        {itemAnalysisViewMode === "DIFFICULTY_INDEX" && (
          <View style={styles.difficultyIndexList}>
            {/* Filter Pills: All | Difficult | Moderate | Easy */}
            <View style={styles.diffFilterRow}>
              {(["ALL", "Difficult", "Moderate", "Easy"] as const).map((level) => {
                const isSelected = difficultyFilter === level;
                const count =
                  level === "ALL"
                    ? itemAnalysis?.questionBreakdown.length ?? 0
                    : level === "Difficult"
                    ? itemAnalysis?.difficultyBreakdown.difficultCount ?? 0
                    : level === "Moderate"
                    ? itemAnalysis?.difficultyBreakdown.moderateCount ?? 0
                    : itemAnalysis?.difficultyBreakdown.easyCount ?? 0;

                return (
                  <TouchableOpacity
                    key={level}
                    style={[
                      styles.diffFilterPill,
                      isSelected
                        ? { backgroundColor: accentColor, borderColor: accentColor }
                        : { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border },
                    ]}
                    onPress={() => setDifficultyFilter(level)}
                  >
                    <Text
                      style={[
                        styles.diffFilterPillText,
                        isSelected ? { color: "#FFF", fontWeight: "800" } : { color: textSub },
                      ]}
                    >
                      {level} ({count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Questions Table */}
            {itemAnalysis?.questionBreakdown
              .filter((q) => (difficultyFilter === "ALL" ? true : q.difficultyLevel === difficultyFilter))
              .map((q) => {
                const isExpanded = expandedAnalysisQNum === q.questionNumber;
                const isDifficult = q.difficultyLevel === "Difficult";
                const isModerate = q.difficultyLevel === "Moderate";
                const lvlColor = isDifficult ? "#EF4444" : isModerate ? "#2563EB" : "#10B981";
                const lvlBg = isDifficult
                  ? (darkMode ? "#450A0A" : "#FEE2E2")
                  : isModerate
                  ? (darkMode ? "#1E3A8A40" : "#EFF6FF")
                  : (darkMode ? "#064E3B40" : "#ECFDF5");

                return (
                  <TouchableOpacity
                    key={q.questionNumber}
                    style={[styles.diffRowCard, { backgroundColor: darkMode ? "#1E1E2E" : "#FFFFFF", borderColor: border }]}
                    onPress={() => setExpandedAnalysisQNum(isExpanded ? null : q.questionNumber)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.diffRowMain}>
                      {/* Left Badge */}
                      <View style={[styles.diffRowBadge, { backgroundColor: lvlBg, borderColor: lvlColor }]}>
                        <Text style={[styles.diffRowBadgeText, { color: lvlColor }]}>Q{q.questionNumber}</Text>
                      </View>

                      {/* Middle: Text + Accuracy Meter */}
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <Text style={[styles.diffRowAccuracy, { color: textMain }]}>
                            {q.accuracyRate}% Accuracy ({q.correctCount}/{q.totalAttempts})
                          </Text>
                          <View style={[styles.diffLevelTag, { backgroundColor: lvlBg }]}>
                            <Text style={[styles.diffLevelTagText, { color: lvlColor }]}>
                              {q.difficultyLevel} • p = {q.difficultyIndex.toFixed(2)}
                            </Text>
                          </View>
                        </View>

                        {q.questionText ? (
                          <Text style={[styles.diffRowQText, { color: textSub }]} numberOfLines={isExpanded ? undefined : 1}>
                            {q.questionText}
                          </Text>
                        ) : null}

                        {/* Facility Bar */}
                        <View style={[styles.diffRowTrack, { backgroundColor: darkMode ? "#374151" : "#F1F5F9" }]}>
                          <View style={[styles.diffRowFill, { width: `${Math.max(5, q.accuracyRate)}%`, backgroundColor: lvlColor }]} />
                        </View>
                      </View>

                      <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={textSub} />
                    </View>

                    {/* Expanded details */}
                    {isExpanded && (
                      <View style={[styles.diffRowExpanded, { borderTopColor: border }]}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={[styles.diffExpandedKey, { color: textMain }]}>
                            Official Answer Key: <Text style={{ fontWeight: "800", color: "#10B981" }}>[{q.correctAnswer}]</Text>
                          </Text>
                          <Text style={[styles.diffExpandedMissed, { color: "#EF4444" }]}>
                            {q.missedRate}% Missed ({q.incorrectCount} students)
                          </Text>
                        </View>

                        {/* Choice pills */}
                        <View style={styles.distractorPillRow}>
                          {q.distractorBreakdown.map((opt) => (
                            <View
                              key={opt.option}
                              style={[
                                styles.miniChoicePill,
                                opt.isCorrect
                                  ? { backgroundColor: darkMode ? "#064E3B40" : "#ECFDF5", borderColor: "#10B981" }
                                  : { backgroundColor: darkMode ? "#374151" : "#F1F5F9", borderColor: border },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.miniChoiceText,
                                  opt.isCorrect ? { color: "#059669", fontWeight: "800" } : { color: textSub },
                                ]}
                              >
                                [{opt.option}] {opt.percentage}% ({opt.count})
                              </Text>
                            </View>
                          ))}
                        </View>

                        {q.pedagogicalInsight ? (
                          <Text style={[styles.diffRowInsight, { color: textSub }]}>
                            💡 {q.pedagogicalInsight}
                          </Text>
                        ) : null}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
          </View>
        )}

            {/* Bottom Full Matrix Trigger Link */}
            <TouchableOpacity
              style={[styles.fullMatrixFooterBtn, { borderColor: subBorder }]}
              onPress={() => setItemAnalysisModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="bar-chart-outline" size={15} color={accentColor} />
              <Text style={[styles.fullMatrixFooterText, { color: accentColor }]}>
                Open Complete Item Analysis Report & Distractor Breakdown
              </Text>
              <Ionicons name="chevron-forward" size={15} color={accentColor} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Item Analysis Deep Modal ── */}
      <ItemAnalysisModal
        visible={itemAnalysisModalVisible}
        onClose={() => setItemAnalysisModalVisible(false)}
        analysis={itemAnalysis}
        quizTitle={activeQuizTitle || activeQuizName}
        accentColor={accentColor}
        onOpenStudentProfile={(studentName) => {
          setItemAnalysisModalVisible(false);
          const matched = students.find((s) => s.full_name === studentName);
          if (matched) onOpenStudentProfile(matched);
        }}
        onCreateRemedialQuiz={() => {
          setItemAnalysisModalVisible(false);
          onNavigateToAIBuilder();
        }}
      />

      {/* ── Section 5: Flagged At-Risk Students ── */}
      <View style={[styles.flaggedSectionCard, darkMode && { backgroundColor: "#450A0A30", borderColor: "#7F1D1D" }]}>
        <View style={styles.flaggedHeaderRow}>
          <View style={styles.flaggedHeaderLeft}>
            <Ionicons name="warning-outline" size={17} color="#DC2626" />
            <Text style={[styles.flaggedHeaderTitle, darkMode && { color: "#FCA5A5" }]}>Flagged At-Risk Students</Text>
          </View>
          <View style={[styles.flaggedCountBadge, darkMode && { backgroundColor: "#7F1D1D" }]}>
            <Text style={[styles.flaggedCountBadgeText, darkMode && { color: "#FCA5A5" }]}>
              {atRiskCount} Flagged
            </Text>
          </View>
        </View>

        {flaggedStudents.length > 0 ? (
          <View style={styles.flaggedList}>
            {flaggedStudents.map((student) => {
              const avatar = getStudentAvatar(student.full_name);

              return (
                <TouchableOpacity
                  key={student.id}
                  style={[styles.flaggedStudentItem, darkMode && { backgroundColor: "#1F2937", borderColor: "#7F1D1D" }]}
                  onPress={() => onOpenStudentProfile(student)}
                  activeOpacity={0.75}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.flaggedAvatar} />
                  ) : (
                    <View style={[styles.flaggedAvatarFallback, darkMode && { backgroundColor: "#7F1D1D" }]}>
                      <Text style={[styles.flaggedAvatarFallbackText, darkMode && { color: "#FCA5A5" }]}>
                        {getInitials(student.full_name)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.flaggedInfoCol}>
                    <Text style={[styles.flaggedName, { color: textMain }]} numberOfLines={1}>
                      {student.full_name}
                    </Text>
                    <Text style={styles.flaggedSub} numberOfLines={1}>
                      {activeQuizName} score below threshold
                    </Text>
                  </View>

                  <View style={styles.flaggedScoreCol}>
                    <Text style={[styles.flaggedScoreText, { color: textMain }]}>{student.average}% avg</Text>
                    <Text style={styles.flaggedTrendText}>↘ declining</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={[styles.allClearCard, darkMode && { backgroundColor: "#064E3B30", borderColor: "#059669" }]}>
            <Ionicons name="checkmark-circle" size={24} color={darkMode ? "#34D399" : "#059669"} />
            <Text style={[styles.allClearText, darkMode && { color: "#6EE7B7" }]}>
              No students currently flagged as at-risk. Great performance!
            </Text>
          </View>
        )}
      </View>

      {/* ── Section 5: Tseki's Recommendation ── */}
      <View style={[styles.recommendationCard, darkMode && { backgroundColor: "#451A0340", borderColor: "#78350F" }]}>
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.mascotImg}
          resizeMode="contain"
        />
        <View style={styles.recommendationInfo}>
          <Text style={[styles.recommendationTitle, darkMode && { color: "#FDBA74" }]}>{"Tseki's Recommendation"}</Text>
          <Text style={[styles.recommendationText, darkMode && { color: "#E2E8F0" }]}>
            {generateClassroomAdvice({
              classAverage: classAvg,
              passRate,
              totalStudents: students.length,
              atRiskStudents: atRiskList,
              topStudents,
              subject: classSubject,
              classTitle,
              quizTitle: activeQuizName,
              gradeDistribution: { a: countA, b: countB, c: countC, f: countF },
              trend: calculatedTrend,
            })}
          </Text>

          <TouchableOpacity
            style={styles.remedialBtn}
            onPress={onNavigateToAIBuilder}
            activeOpacity={0.8}
          >
            <Ionicons name="sparkles" size={13} color="#FFFFFF" />
            <Text style={styles.remedialBtnText}>
              {atRiskCount > 0 ? "Create remedial quiz" : students.length === 0 ? "Create your first quiz" : "Create challenge quiz"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 16,
  },

  /* ── 2x2 Metrics Grid ── */
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    minWidth: "46%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  trendRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  trendText: {
    fontSize: 12,
    fontWeight: "700",
  },
  metricSub: {
    fontSize: 11.5,
    color: "#94A3B8",
    fontWeight: "600",
    marginTop: 4,
  },
  atRiskMetricCard: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FEE2E2",
  },
  atRiskHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  atRiskMetricLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
  },
  atRiskMetricSub: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#DC2626",
    marginTop: 4,
  },

  /* ── General Card ── */
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  cardSub: {
    fontSize: 11.5,
    color: "#64748B",
    marginTop: 3,
    marginBottom: 10,
  },

  /* ── Grade Distribution ── */
  distHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  totalEnrolledBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  totalEnrolledBadgeText: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  histogramContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 120,
    paddingHorizontal: 4,
  },
  histogramCol: {
    flex: 1,
    alignItems: "center",
  },
  countBadgeWrapper: {
    height: 22,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  countBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  barTrack: {
    width: 48,
    height: 85,
    borderRadius: 10,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: 10,
  },
  baselineAxis: {
    height: 1.5,
    marginVertical: 10,
  },
  gradeLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  gradeLabelCol: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  gradePill: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  gradeLetter: {
    fontSize: 14,
    fontWeight: "800",
  },
  gradeRange: {
    fontSize: 10.5,
    fontWeight: "600",
  },
  gradePercent: {
    fontSize: 9.5,
    fontWeight: "700",
  },

  /* ── Interactive Trend Chart ── */
  trendHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  },
  gradeQuizBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  gradeQuizBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  trendDetailBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  trendDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  trendDetailTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    maxWidth: 210,
  },
  trendDetailSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  trendDetailScoreBox: {
    alignItems: "flex-end",
  },
  trendDetailScore: {
    fontSize: 17,
    fontWeight: "800",
  },
  trendDetailStatus: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  chartContainer: {
    height: 145,
    marginTop: 6,
    position: "relative",
  },
  gridLineRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  gridLabel: {
    width: 38,
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
  },
  gridLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#F1F5F9",
  },
  chartAreaFill: {
    position: "absolute",
    top: 4,
    backgroundColor: "rgba(59, 130, 246, 0.05)",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  chartDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    zIndex: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  selectedDotRing: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    zIndex: 3,
  },
  chartBaseline: {
    position: "absolute",
    height: 1.5,
    backgroundColor: "#E2E8F0",
  },
  xAxisRow: {
    position: "absolute",
    height: 20,
  },
  xAxisLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
  },
  trendEmptyContainer: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  trendEmptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
    marginTop: 8,
  },
  trendEmptySub: {
    fontSize: 11.5,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 4,
    paddingHorizontal: 24,
    lineHeight: 16,
  },
  chartFooterHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 18,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F8FAFC",
  },
  chartFooterHintText: {
    fontSize: 10.5,
    color: "#94A3B8",
    fontWeight: "500",
  },

  /* ── Flagged At-Risk Students ── */
  flaggedSectionCard: {
    backgroundColor: "#FFF5F5",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#FEE2E2",
  },
  flaggedHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  flaggedHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flaggedHeaderTitle: {
    fontSize: 14.5,
    fontWeight: "800",
    color: "#991B1B",
  },
  flaggedCountBadge: {
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flaggedCountBadgeText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#DC2626",
  },
  flaggedList: {
    gap: 8,
  },
  flaggedStudentItem: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#FEE2E2",
  },
  flaggedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  flaggedAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  flaggedAvatarFallbackText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#DC2626",
  },
  flaggedInfoCol: {
    flex: 1,
    marginRight: 8,
  },
  flaggedName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
  },
  flaggedSub: {
    fontSize: 11,
    color: "#DC2626",
    marginTop: 2,
    fontWeight: "500",
  },
  flaggedScoreCol: {
    alignItems: "flex-end",
  },
  flaggedScoreText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#0F172A",
  },
  flaggedTrendText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#DC2626",
    marginTop: 2,
  },
  allClearCard: {
    backgroundColor: "#ECFDF5",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  allClearText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#065F46",
    flex: 1,
  },

  /* ── Tseki Recommendation ── */
  recommendationCard: {
    backgroundColor: "#FFFBEB",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#FED7AA",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  mascotImg: {
    width: 58,
    height: 58,
    marginTop: 2,
  },
  recommendationInfo: {
    flex: 1,
  },
  recommendationTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#9A3412",
  },
  recommendationText: {
    fontSize: 11.5,
    color: "#475569",
    lineHeight: 17,
    marginTop: 4,
    fontWeight: "500",
  },
  remedialBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#F97316",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  remedialBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* ── Item Analysis Section Styles ── */
  itemAnalysisHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  miniHeaderPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniHeaderPillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerSubText: {
    fontSize: 11.5,
    fontWeight: "500",
  },
  inspectMatrixBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  inspectMatrixBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  quizSelectorScroll: {
    gap: 8,
    paddingVertical: 4,
    marginBottom: 12,
  },
  quizSelectorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  quizSelectorPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  analysisKpiRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  analysisKpiCard: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  analysisKpiHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  analysisKpiLabel: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  analysisKpiVal: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  analysisKpiSub: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  tabSegmentWrap: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
  },
  tabSegmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabSegmentBtnActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabSegmentText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  mostMissedList: {
    gap: 10,
  },
  missedCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  missedCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  missedBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  missedBadgeText: {
    fontSize: 12.5,
    fontWeight: "800",
  },
  miniDiffPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniDiffPillText: {
    fontSize: 9.5,
    fontWeight: "800",
  },
  missedRateText: {
    fontSize: 11.5,
    fontWeight: "800",
  },
  missedAttemptsText: {
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
  },
  keyPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  keyPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
  },
  missedQuestionText: {
    fontSize: 12.5,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 8,
  },
  miniFacilityTrack: {
    height: 5,
    borderRadius: 2.5,
    overflow: "hidden",
    marginTop: 8,
    marginBottom: 8,
  },
  miniFacilityFill: {
    height: "100%",
    borderRadius: 2.5,
  },
  distractorBarWrap: {
    marginTop: 4,
  },
  distractorLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    marginBottom: 4,
  },
  distractorPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  miniChoicePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  miniChoiceText: {
    fontSize: 10.5,
  },
  miniMisconceptionBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 6,
  },
  miniMisconceptionText: {
    fontSize: 10.5,
    fontWeight: "700",
    flex: 1,
  },
  missedStudentsWrap: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  missedStudentsLabel: {
    fontSize: 10.5,
    fontWeight: "600",
  },
  missedStudentPillsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  missedStudentChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  missedStudentChipText: {
    fontSize: 10,
    fontWeight: "600",
  },
  missedMoreCount: {
    fontSize: 10,
    fontWeight: "600",
  },
  remedialSmallBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
  remedialSmallBtnText: {
    fontSize: 11,
    fontWeight: "700",
  },
  emptyItemBox: {
    alignItems: "center",
    padding: 20,
    borderRadius: 12,
    gap: 6,
  },
  emptyItemText: {
    fontSize: 12,
    fontWeight: "600",
  },
  difficultyIndexList: {
    gap: 8,
  },
  diffFilterRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  diffFilterPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  diffFilterPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  diffRowCard: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  diffRowMain: {
    flexDirection: "row",
    alignItems: "center",
  },
  diffRowBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  diffRowBadgeText: {
    fontSize: 11.5,
    fontWeight: "800",
  },
  diffRowAccuracy: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  diffLevelTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  diffLevelTagText: {
    fontSize: 9.5,
    fontWeight: "800",
  },
  diffRowQText: {
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 4,
  },
  diffRowTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  diffRowFill: {
    height: "100%",
    borderRadius: 2,
  },
  diffRowExpanded: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    gap: 6,
  },
  diffExpandedKey: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  diffExpandedMissed: {
    fontSize: 11,
    fontWeight: "700",
  },
  diffRowInsight: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  fullMatrixFooterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    marginTop: 12,
  },
  fullMatrixFooterText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
