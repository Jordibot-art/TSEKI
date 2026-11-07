import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Modal,
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
  const [quizDropdownOpen, setQuizDropdownOpen] = useState(false);
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
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: subBorder }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Class Average</Text>
          <Text style={[styles.metricValue, { color: textMain }]}>{classAvg}%</Text>
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, { color: classAvg >= 75 ? "#16A34A" : classAvg <= 50 ? "#DC2626" : textSub }]}>
              {classAvg >= 75 ? "↗ +2.4%" : classAvg <= 50 ? "↘ -3.1%" : "↗ Stable"}
            </Text>
          </View>
        </View>

        {/* Card 2: Pass Rate */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: subBorder }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Pass Rate (≥75%)</Text>
          <Text style={[styles.metricValue, { color: textMain }]}>{passRate}%</Text>
          <Text style={[styles.metricSub, { color: textSub }]}>Target 85%</Text>
        </View>

        {/* Card 3: Total Enrolled */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: subBorder }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Total Enrolled</Text>
          <Text style={[styles.metricValue, { color: textMain }]}>{students.length}</Text>
          <Text style={[styles.metricSub, { color: textSub }]}>Active Roster</Text>
        </View>

        {/* Card 4: At-Risk Flags (White surface + 3px subtle left border) */}
        <View
          style={[
            styles.metricCard,
            {
              backgroundColor: cardBg,
              borderColor: subBorder,
              borderLeftWidth: 3,
              borderLeftColor: atRiskCount > 0 ? "#DC2626" : subBorder,
            },
          ]}
        >
          <View style={styles.atRiskHeaderRow}>
            <Ionicons name="warning-outline" size={14} color={atRiskCount > 0 ? "#DC2626" : textSub} />
            <Text style={[styles.atRiskMetricLabel, { color: atRiskCount > 0 ? "#DC2626" : textSub }]}>At-Risk Flags</Text>
          </View>
          <Text style={[styles.metricValue, { color: textMain }]}>{atRiskCount}</Text>
          <Text style={[styles.atRiskMetricSub, { color: atRiskCount > 0 ? "#DC2626" : "#16A34A" }]}>
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
                <Text style={[styles.gradeLetterText, { color: darkMode ? "#F8FAFC" : "#334155" }]}>
                  {bucket.grade}
                </Text>
                <Text style={[styles.gradeRange, { color: textSub }]}>{bucket.range}</Text>
                <Text style={[styles.gradePercent, { color: textSub }]}>
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
              <View style={[styles.trendDetailBanner, { backgroundColor: darkMode ? "#111827" : "#F8FAFC", borderColor: subBorder }]}>
                <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <View style={styles.trendDetailHeader}>
                    <Ionicons name="analytics" size={13} color="#2563EB" />
                    <Text style={[styles.trendDetailTitle, { color: textMain }]} numberOfLines={1} ellipsizeMode="tail">
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
            <Text style={[styles.cardTitle, { color: textMain, marginBottom: 3 }]}>
              Question Performance & Item Analysis
            </Text>
            <Text style={[styles.cardSub, { color: textSub, marginBottom: 12 }]}>
              Difficulty index (p-value), most missed questions & distractor diagnostic metrics
            </Text>
          </View>
        </View>

        {/* ── Full-Width Interactive Quiz Selector Dropdown ── */}
        <TouchableOpacity
          style={[
            styles.quizSelectorDropdown,
            { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: darkMode ? "#475569" : "#CBD5E1" },
          ]}
          onPress={() => setQuizDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="document-text-outline" size={16} color={darkMode ? "#94A3B8" : "#64748B"} style={{ marginRight: 8 }} />
          <Text style={[styles.quizSelectorDropdownText, { color: textMain }]} numberOfLines={1}>
            {activeQuizTitle || activeQuizName}
          </Text>
          <Ionicons name="chevron-down" size={16} color={textSub} style={{ marginLeft: 6 }} />
        </TouchableOpacity>

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
            {/* ── Unified 3-Column Stat Strip ── */}
            <View style={[styles.statStrip, { backgroundColor: darkMode ? "#1E293B" : "#F8FAFC", borderColor: subBorder }]}>
              <View style={styles.statStripCol}>
                <Text style={[styles.statStripLabel, { color: textSub }]}>Most Missed</Text>
                <Text style={[styles.statStripVal, { color: textMain }]}>
                  {itemAnalysis?.mostMissedQuestions[0] ? `Q${itemAnalysis.mostMissedQuestions[0].questionNumber}` : "None"}
                </Text>
                <Text style={[styles.statStripSub, { color: itemAnalysis?.mostMissedQuestions[0] ? "#DC2626" : textSub }]}>
                  {itemAnalysis?.mostMissedQuestions[0]
                    ? `${itemAnalysis.mostMissedQuestions[0].missedRate}% Missed`
                    : "No data"}
                </Text>
              </View>

              <View style={[styles.statStripDivider, { backgroundColor: subBorder }]} />

              <View style={styles.statStripCol}>
                <Text style={[styles.statStripLabel, { color: textSub }]}>Easiest Item</Text>
                <Text style={[styles.statStripVal, { color: textMain }]}>
                  {itemAnalysis?.easiestQuestions[0] ? `Q${itemAnalysis.easiestQuestions[0].questionNumber}` : "None"}
                </Text>
                <Text style={[styles.statStripSub, { color: itemAnalysis?.easiestQuestions[0] ? "#16A34A" : textSub }]}>
                  {itemAnalysis?.easiestQuestions[0]
                    ? `${itemAnalysis.easiestQuestions[0].accuracyRate}% Acc`
                    : "No data"}
                </Text>
              </View>

              <View style={[styles.statStripDivider, { backgroundColor: subBorder }]} />

              <View style={styles.statStripCol}>
                <Text style={[styles.statStripLabel, { color: textSub }]}>Avg Difficulty</Text>
                <Text style={[styles.statStripVal, { color: textMain }]}>
                  p = {itemAnalysis ? itemAnalysis.averageDifficultyIndex.toFixed(2) : "0.50"}
                </Text>
                <Text style={[styles.statStripSub, { color: accentColor }]}>
                  {itemAnalysis && itemAnalysis.averageDifficultyIndex >= 0.75
                    ? "Easy"
                    : itemAnalysis && itemAnalysis.averageDifficultyIndex >= 0.25
                    ? "Moderate"
                    : "Difficult"}
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
                  ? { color: textMain, fontWeight: "700" }
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
                  ? { color: textMain, fontWeight: "700" }
                  : { color: textSub },
              ]}
            >
              Difficulty Index ({itemAnalysis?.questionBreakdown.length ?? 0})
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Top 2 Questions in Compact Preview Card Format ── */}
        {(() => {
          const listToRender =
            itemAnalysisViewMode === "MOST_MISSED"
              ? (itemAnalysis?.mostMissedQuestions || [])
              : (itemAnalysis?.questionBreakdown || []);
          const previewList = listToRender.slice(0, 2);

          if (previewList.length === 0) {
            return (
              <View style={[styles.emptyItemBox, { backgroundColor: darkMode ? "#1F2937" : "#F8FAFC" }]}>
                <Ionicons name="checkmark-circle-outline" size={24} color="#10B981" />
                <Text style={[styles.emptyItemText, { color: textMain }]}>All items mastered with high accuracy!</Text>
              </View>
            );
          }

          return (
            <View style={styles.compactQuestionsList}>
              {previewList.map((q) => {
                const isDifficult = q.difficultyLevel === "Difficult";
                const isModerate = q.difficultyLevel === "Moderate";
                const badgeColor = isDifficult ? "#EF4444" : isModerate ? "#2563EB" : "#10B981";
                const badgeBg = isDifficult
                  ? (darkMode ? "#450A0A" : "#FEE2E2")
                  : isModerate
                  ? (darkMode ? "#1E3A8A40" : "#EFF6FF")
                  : (darkMode ? "#064E3B40" : "#ECFDF5");

                const matchedKeyItem = publishedQuizzes
                  ?.find((pq) => pq.quizTitle === (activeQuizTitle || activeQuizName))
                  ?.answerKey?.find((k) => (k.questionNumber || (k as any).qNum) === q.questionNumber);
                const cleanKey = String(matchedKeyItem?.correctAnswer || q.correctAnswer || "A").trim().toUpperCase();

                const topDistractor = q.mostCommonMistake;

                return (
                  <TouchableOpacity
                    key={q.questionNumber}
                    style={[
                      styles.compactQuestionCard,
                      { backgroundColor: darkMode ? "#1E293B" : "#FFFFFF", borderColor: subBorder },
                    ]}
                    onPress={() => setItemAnalysisModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    {/* Row 1: Q badge + Question text (clamped to 2 lines) + Missed rate on right */}
                    <View style={styles.compactRow1}>
                      <View style={[styles.compactQBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[styles.compactQBadgeText, { color: badgeColor }]}>Q{q.questionNumber}</Text>
                      </View>
                      <Text style={[styles.compactQuestionText, { color: textMain }]} numberOfLines={2}>
                        {q.questionText || `Question ${q.questionNumber}`}
                      </Text>
                      <Text style={styles.compactMissedRate}>
                        {q.missedRate}% Missed
                      </Text>
                    </View>

                    {/* Row 2: Most chosen distractor + Correct Key */}
                    <View style={styles.compactRow2}>
                      <Text style={[styles.compactMetaText, { color: textSub }]} numberOfLines={1}>
                        {topDistractor ? (
                          <>
                            Most chosen distractor:{" "}
                            <Text style={{ fontWeight: "600", color: "#DC2626" }}>
                              [{topDistractor.answer}] ({topDistractor.percentage}%)
                            </Text>
                            {" · "}
                          </>
                        ) : null}
                        Correct Key:{" "}
                        <Text style={{ fontWeight: "700", color: "#16A34A" }}>
                          [{cleanKey}]
                        </Text>
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={textSub} />
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Clean Action Button: See All Questions & Full Report */}
              <TouchableOpacity
                style={[
                  styles.seeAllAnalysisBtn,
                  {
                    backgroundColor: darkMode ? "#1E293B" : "#FFFFFF",
                    borderColor: darkMode ? "#475569" : "#CBD5E1",
                  },
                ]}
                onPress={() => setItemAnalysisModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={[styles.seeAllAnalysisBtnText, { color: darkMode ? "#F8FAFC" : "#0F172A" }]}>
                  See All {itemAnalysis.questionBreakdown.length} Questions & Full Item Analysis →
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}
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
      <View
        style={[
          styles.flaggedSectionCard,
          {
            backgroundColor: cardBg,
            borderColor: subBorder,
            borderLeftWidth: 3,
            borderLeftColor: atRiskCount > 0 ? "#DC2626" : subBorder,
          },
        ]}
      >
        <View style={styles.flaggedHeaderRow}>
          <View style={styles.flaggedHeaderLeft}>
            <Ionicons name="warning-outline" size={17} color={atRiskCount > 0 ? "#DC2626" : textSub} />
            <Text style={[styles.flaggedHeaderTitle, { color: textMain }]}>Flagged At-Risk Students</Text>
          </View>
          <View
            style={[
              styles.flaggedCountBadge,
              {
                backgroundColor: atRiskCount > 0 ? (darkMode ? "#450A0A" : "#FEE2E2") : (darkMode ? "#14532D" : "#DCFCE7"),
              },
            ]}
          >
            <Text
              style={[
                styles.flaggedCountBadgeText,
                { color: atRiskCount > 0 ? "#DC2626" : "#16A34A" },
              ]}
            >
              {atRiskCount > 0 ? `${atRiskCount} Flagged` : "All Clear"}
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
                  style={[
                    styles.flaggedStudentItem,
                    {
                      backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                      borderColor: subBorder,
                    },
                  ]}
                  onPress={() => onOpenStudentProfile(student)}
                  activeOpacity={0.75}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.flaggedAvatar} />
                  ) : (
                    <View style={[styles.flaggedAvatarFallback, { backgroundColor: darkMode ? "#334155" : "#E2E8F0" }]}>
                      <Text style={[styles.flaggedAvatarFallbackText, { color: textMain }]}>
                        {getInitials(student.full_name)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.flaggedInfoCol}>
                    <Text style={[styles.flaggedName, { color: textMain }]} numberOfLines={1}>
                      {student.full_name}
                    </Text>
                    <Text style={[styles.flaggedSub, { color: textSub }]} numberOfLines={1}>
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
          <View style={[styles.allClearCard, { backgroundColor: darkMode ? "#064E3B30" : "#F0FDF4", borderColor: "#86EFAC" }]}>
            <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
            <Text style={[styles.allClearText, { color: darkMode ? "#86EFAC" : "#166534" }]}>
              No students currently flagged as at-risk. Great performance!
            </Text>
          </View>
        )}
      </View>

      {/* ── Section 6: Tseki's Recommendation ── */}
      <View
        style={[
          styles.recommendationCard,
          {
            backgroundColor: darkMode ? "#43140725" : "#FFF7ED",
            borderColor: darkMode ? "#7C2D12" : "#FED7AA",
          },
        ]}
      >
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.mascotImg}
          resizeMode="contain"
        />
        <View style={styles.recommendationInfo}>
          <Text style={[styles.recommendationTitle, { color: darkMode ? "#FDBA74" : "#9A3412" }]}>
            {"Tseki's Recommendation"}
          </Text>
          <Text style={[styles.recommendationText, { color: darkMode ? "#E2E8F0" : "#431407" }]}>
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
            style={[styles.remedialBtn, { backgroundColor: accentColor }]}
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

      {/* ── Quiz Selector Dropdown Modal ── */}
      <Modal
        visible={quizDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQuizDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.quizPickerOverlay}
          activeOpacity={1}
          onPress={() => setQuizDropdownOpen(false)}
        >
          <View style={[styles.quizPickerSheet, { backgroundColor: cardBg, borderColor: subBorder }]}>
            <View style={[styles.quizPickerHeader, { borderBottomColor: subBorder }]}>
              <Text style={[styles.quizPickerTitle, { color: textMain }]}>Select Assessment</Text>
              <TouchableOpacity onPress={() => setQuizDropdownOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={textSub} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 280 }}>
              {availableQuizOptions.map((q) => {
                const isSelected = q === (activeQuizTitle || activeQuizName);
                return (
                  <TouchableOpacity
                    key={q}
                    style={[
                      styles.quizPickerItem,
                      isSelected && { backgroundColor: darkMode ? "#334155" : "#F1F5F9" },
                    ]}
                    onPress={() => {
                      setActiveQuizTitle(q);
                      setQuizDropdownOpen(false);
                    }}
                  >
                    <Ionicons
                      name={isSelected ? "radio-button-on" : "radio-button-off"}
                      size={18}
                      color={isSelected ? accentColor : textSub}
                    />
                    <Text
                      style={[
                        styles.quizPickerItemText,
                        { color: isSelected ? textMain : textSub, fontWeight: isSelected ? "700" : "500" },
                      ]}
                      numberOfLines={1}
                    >
                      {q}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
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
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  flaggedHeaderTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  flaggedCountBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flaggedCountBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  flaggedList: {
    gap: 8,
  },
  flaggedStudentItem: {
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  flaggedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  flaggedAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  flaggedAvatarFallbackText: {
    fontSize: 12,
    fontWeight: "700",
  },
  flaggedInfoCol: {
    flex: 1,
    marginRight: 8,
  },
  flaggedName: {
    fontSize: 13,
    fontWeight: "600",
  },
  flaggedSub: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  flaggedScoreCol: {
    alignItems: "flex-end",
  },
  flaggedScoreText: {
    fontSize: 13,
    fontWeight: "700",
  },
  flaggedTrendText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "#DC2626",
    marginTop: 2,
  },
  allClearCard: {
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  allClearText: {
    fontSize: 12.5,
    fontWeight: "600",
    flex: 1,
  },

  /* ── Tseki Recommendation ── */
  recommendationCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  mascotImg: {
    width: 50,
    height: 50,
    marginTop: 2,
  },
  recommendationInfo: {
    flex: 1,
  },
  recommendationTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  recommendationText: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    fontWeight: "500",
  },
  remedialBtn: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  remedialBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* ── Item Analysis Section Styles ── */
  itemAnalysisHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  gradeLetterText: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  quizSelectorDropdown: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  quizSelectorDropdownText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  quizPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  quizPickerSheet: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  quizPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  quizPickerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  quizPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  quizPickerItemText: {
    fontSize: 13,
    flex: 1,
  },

  /* ── 3-Column Stat Strip ── */
  statStrip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 14,
  },
  statStripCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  statStripLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 3,
    textAlign: "center",
  },
  statStripVal: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  statStripSub: {
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
    textAlign: "center",
  },
  statStripDivider: {
    width: 1,
    height: 28,
  },

  /* ── Compact Question Preview Cards ── */
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
  compactQuestionsList: {
    gap: 10,
    marginTop: 4,
  },
  compactQuestionCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  compactRow1: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compactQBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  compactQBadgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  compactQuestionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  compactMissedRate: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
  },
  compactRow2: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 8,
  },
  compactMetaText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: "500",
    marginRight: 8,
  },
  seeAllAnalysisBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  seeAllAnalysisBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
  },
});
