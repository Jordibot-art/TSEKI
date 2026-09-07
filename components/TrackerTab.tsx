import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Image,
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
import { useTheme } from "../context/ThemeContext";

export type TrackerStudent = {
  id: string;
  full_name: string;
  email: string | null;
  average: number;
  attendance: number;
};

type TrackerTabProps = {
  classroomId: string;
  classTitle: string;
  classSubject: string;
  students: TrackerStudent[];
  publishedQuizzes: StoredQuiz[];
  selectedQuizTitle?: string;
  onOpenStudentProfile: (student: TrackerStudent) => void;
  onNavigateToAIBuilder: () => void;
  onNavigateToGrader?: () => void;
};

function getStudentAvatar(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("sarah") || lower.includes("jenkins")) {
    return "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80";
  }
  if (lower.includes("michael") || lower.includes("chang")) {
    return "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80";
  }
  if (lower.includes("emily") || lower.includes("davis")) {
    return "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80";
  }
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

  const totalAtt = students.reduce((acc, s) => acc + (s.attendance ?? 0), 0);
  const attendanceAvg = hasStudents ? Math.round(totalAtt / students.length) : 0;

  const flaggedStudents = students.filter((s) => (s.average ?? 0) <= 50);
  const atRiskCount = flaggedStudents.length;

  const activeQuizName =
    publishedQuizzes[0]?.quizTitle ||
    selectedQuizTitle ||
    (classSubject && classSubject !== "No Subject" ? classSubject : (classTitle ? `${classTitle} Assessment` : "Class Assessment"));

  // ── Grade Distribution ──────────────────────────────────────────────────
  const countA = students.filter((s) => (s.average ?? 0) >= 90).length;
  const countB = students.filter((s) => (s.average ?? 0) >= 80 && (s.average ?? 0) < 90).length;
  const countC = students.filter((s) => (s.average ?? 0) >= 75 && (s.average ?? 0) < 80).length;
  const countF = students.filter((s) => (s.average ?? 0) < 75).length;

  const gradeBuckets = [
    { grade: "A", range: "90-100", count: countA, color: "#3B82F6" },
    { grade: "B", range: "80-89", count: countB, color: "#60A5FA" },
    { grade: "C", range: "75-79", count: countC, color: "#F59E0B" },
    { grade: "F", range: "<75", count: countF, color: "#EF4444" },
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

        {/* Card 3: Attendance Avg */}
        <View style={[styles.metricCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.metricLabel, { color: textSub }]}>Attendance Avg</Text>
          <Text style={[styles.metricValue, { color: textMain }]}>{attendanceAvg}%</Text>
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, { color: "#16A34A" }]}>↗ Stable</Text>
          </View>
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
        <Text style={[styles.cardTitle, { color: textMain }]}>Grade Distribution</Text>

        <View style={styles.histogramContainer}>
          {gradeBuckets.map((bucket) => {
            const barHeight =
              bucket.count > 0
                ? Math.round((bucket.count / maxGradeCount) * 85) + 14
                : 6;

            return (
              <View key={bucket.grade} style={styles.histogramCol}>
                {/* Count badge above bar */}
                <View style={styles.countBadgeWrapper}>
                  {bucket.count > 0 ? (
                    <Text style={[styles.countBadgeText, { color: textMain }]}>
                      {bucket.count} student{bucket.count > 1 ? "s" : ""}
                    </Text>
                  ) : (
                    <Text style={[styles.countBadgeText, { opacity: 0 }]}>-</Text>
                  )}
                </View>

                {/* Vertical Bar */}
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        height: barHeight,
                        backgroundColor: bucket.color,
                        opacity: bucket.count > 0 ? 1 : 0.25,
                      },
                    ]}
                  />
                </View>

                {/* Grade Label */}
                <Text style={[styles.gradeLetter, { color: textMain }]}>{bucket.grade}</Text>
                <Text style={[styles.gradeRange, { color: textSub }]}>{bucket.range}</Text>
              </View>
            );
          })}
        </View>
        {/* Baseline Axis */}
        <View style={[styles.baselineAxis, { backgroundColor: subBorder }]}>
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
              style={[styles.gradeQuizBtn, darkMode && { backgroundColor: "#1E3A8A30", borderColor: "#1D4ED8" }]}
              onPress={onNavigateToGrader}
              activeOpacity={0.7}
            >
              <Ionicons name="scan-outline" size={13} color={darkMode ? "#93C5FD" : "#2563EB"} />
              <Text style={[styles.gradeQuizBtnText, darkMode && { color: "#93C5FD" }]}>Grade Quiz</Text>
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
                      onPress={() => setSelectedIndex(idx)}
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
                      onPress={() => setSelectedIndex(idx)}
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

      {/* ── Section 4: Flagged At-Risk Students ── */}
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
          <Text style={[styles.recommendationTitle, darkMode && { color: "#FDBA74" }]}>Tseki's Recommendation</Text>
          <Text style={[styles.recommendationText, darkMode && { color: "#E2E8F0" }]}>
            {atRiskCount > 0
              ? `You have ${atRiskCount} student${atRiskCount > 1 ? "s" : ""} showing signs of difficulty. Click "Create remedial quiz" to automatically generate custom, easier homework for them!`
              : students.length === 0
              ? "Welcome to your new classroom! Add students in Record or create your first quiz in AI Builder to get started."
              : "All students are performing on track! Consider creating an advanced challenge quiz using AI Builder to keep top performers engaged."}
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
  histogramContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 140,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  histogramCol: {
    flex: 1,
    alignItems: "center",
  },
  countBadgeWrapper: {
    height: 20,
    justifyContent: "center",
    marginBottom: 4,
  },
  countBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#1E293B",
  },
  barTrack: {
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  barFill: {
    width: 44,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  baselineAxis: {
    height: 1.5,
    backgroundColor: "#E2E8F0",
    marginTop: 2,
    marginBottom: 8,
  },
  gradeLetter: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#1E293B",
  },
  gradeRange: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: 2,
  },

  /* ── Interactive Trend Chart ── */
  trendHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  gradeQuizBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  gradeQuizBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#2563EB",
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
});
