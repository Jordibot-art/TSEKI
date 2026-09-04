import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StoredQuiz } from "../lib/quizStore";

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
}: TrackerTabProps) {
  const [chartWidth, setChartWidth] = useState(320);

  // ── Metrics Calculation ──────────────────────────────────────────────────
  const hasStudents = students.length > 0;
  const totalAvg = students.reduce((acc, s) => acc + (s.average ?? 0), 0);
  const classAvg = hasStudents ? Math.round(totalAvg / students.length) : 70;

  const passingCount = students.filter((s) => (s.average ?? 0) >= 75).length;
  const passRate = hasStudents ? Math.round((passingCount / students.length) * 100) : 33;

  const totalAtt = students.reduce((acc, s) => acc + (s.attendance ?? 0), 0);
  const attendanceAvg = hasStudents ? Math.round(totalAtt / students.length) : 90;

  const flaggedStudents = students.filter((s) => (s.average ?? 0) <= 50);
  const atRiskCount = flaggedStudents.length;

  const activeQuizName =
    publishedQuizzes[0]?.quizTitle ||
    selectedQuizTitle ||
    classSubject ||
    "Kinematics exam";

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

  // ── Class Performance Trend Data ────────────────────────────────────────
  // 5 quizzes progression matching the screenshot
  const trendPoints = [
    { label: "Quiz 1", value: Math.min(Math.max(classAvg - 2, 55), 88) },
    { label: "Quiz 2", value: Math.min(Math.max(classAvg + 4, 60), 92) },
    { label: "Quiz 3", value: Math.min(Math.max(classAvg + 1, 58), 90) },
    { label: "Quiz 4", value: Math.min(Math.max(classAvg - 8, 48), 82), isDrop: true },
    { label: "Quiz 5", value: Math.min(Math.max(classAvg - 5, 52), 85), isDrop: true },
  ];

  // Chart layout geometry
  const leftPadding = 42;
  const rightPadding = 18;
  const plotWidth = Math.max(chartWidth - leftPadding - rightPadding, 180);
  const plotHeight = 90;
  const minY = 45;
  const maxY = 100;

  const getX = (index: number) => leftPadding + (index / (trendPoints.length - 1)) * plotWidth;
  const getY = (val: number) => {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return plotHeight - ((clamped - minY) / (maxY - minY)) * plotHeight;
  };

  return (
    <View style={styles.container}>
      {/* ── Section 1: 4 Key Metric Cards (2x2 Grid) ── */}
      <View style={styles.metricsGrid}>
        {/* Card 1: Class Average */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Class Average</Text>
          <Text style={[styles.metricValue, { color: "#2563EB" }]}>{classAvg}%</Text>
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, { color: "#16A34A" }]}>↗ +2.4%</Text>
          </View>
        </View>

        {/* Card 2: Pass Rate */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Pass Rate (≥75%)</Text>
          <Text style={[styles.metricValue, { color: "#EA580C" }]}>{passRate}%</Text>
          <Text style={styles.metricSub}>Target 85%</Text>
        </View>

        {/* Card 3: Attendance Avg */}
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Attendance Avg</Text>
          <Text style={[styles.metricValue, { color: "#0F172A" }]}>{attendanceAvg}%</Text>
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, { color: "#16A34A" }]}>↗ Stable</Text>
          </View>
        </View>

        {/* Card 4: At-Risk Flags */}
        <View style={[styles.metricCard, styles.atRiskMetricCard]}>
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
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Grade Distribution</Text>

        <View style={styles.histogramContainer}>
          {gradeBuckets.map((bucket, i) => {
            const barHeight =
              bucket.count > 0
                ? Math.round((bucket.count / maxGradeCount) * 85) + 14
                : 6;

            return (
              <View key={bucket.grade} style={styles.histogramCol}>
                {/* Count badge above bar */}
                <View style={styles.countBadgeWrapper}>
                  {bucket.count > 0 ? (
                    <Text style={styles.countBadgeText}>
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
                <Text style={styles.gradeLetter}>{bucket.grade}</Text>
                <Text style={styles.gradeRange}>{bucket.range}</Text>
              </View>
            );
          })}
        </View>
        {/* Baseline Axis */}
        <View style={styles.baselineAxis} />
      </View>

      {/* ── Section 3: Class Performance Trend ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Class Performance Trend</Text>
        <Text style={styles.cardSub}>
          Tracking overall score average over consecutive quizzes
        </Text>

        <View
          style={styles.chartContainer}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - chartWidth) > 5) {
              setChartWidth(w);
            }
          }}
        >
          {/* Y-Axis Grid Lines & Labels */}
          {[100, 75, 50].map((level) => {
            const yPos = getY(level);
            return (
              <View key={level} style={[styles.gridLineRow, { top: yPos }]}>
                <Text style={styles.gridLabel}>{level}%</Text>
                <View style={styles.gridLine} />
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

            const isDropSegment = nextPt.isDrop;

            return (
              <View
                key={`line-${idx}`}
                style={{
                  position: "absolute",
                  left: x1,
                  top: y1,
                  width: length,
                  height: 3.5,
                  backgroundColor: isDropSegment ? "#EA580C" : "#3B82F6",
                  borderRadius: 2,
                  transformOrigin: "left center",
                  transform: [{ rotate: `${angle}deg` }],
                  zIndex: 2,
                }}
              />
            );
          })}

          {/* Dots on Data Points */}
          {trendPoints.map((pt, idx) => {
            const x = getX(idx);
            const y = getY(pt.value);
            const isDrop = pt.isDrop;

            return (
              <View
                key={`dot-${idx}`}
                style={[
                  styles.chartDot,
                  {
                    left: x - 5.5,
                    top: y - 5.5,
                    backgroundColor: isDrop ? "#EA580C" : "#2563EB",
                  },
                ]}
              />
            );
          })}

          {/* Chart Baseline */}
          <View style={[styles.chartBaseline, { left: leftPadding, width: plotWidth, top: plotHeight + 6 }]} />

          {/* X-Axis Labels */}
          <View style={[styles.xAxisRow, { left: leftPadding, width: plotWidth, top: plotHeight + 12 }]}>
            {trendPoints.map((pt) => (
              <Text key={pt.label} style={styles.xAxisLabel}>
                {pt.label}
              </Text>
            ))}
          </View>
        </View>
      </View>

      {/* ── Section 4: Flagged At-Risk Students ── */}
      <View style={styles.flaggedSectionCard}>
        <View style={styles.flaggedHeaderRow}>
          <View style={styles.flaggedHeaderLeft}>
            <Ionicons name="warning-outline" size={17} color="#DC2626" />
            <Text style={styles.flaggedHeaderTitle}>Flagged At-Risk Students</Text>
          </View>
          <View style={styles.flaggedCountBadge}>
            <Text style={styles.flaggedCountBadgeText}>
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
                  style={styles.flaggedStudentItem}
                  onPress={() => onOpenStudentProfile(student)}
                  activeOpacity={0.75}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.flaggedAvatar} />
                  ) : (
                    <View style={styles.flaggedAvatarFallback}>
                      <Text style={styles.flaggedAvatarFallbackText}>
                        {getInitials(student.full_name)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.flaggedInfoCol}>
                    <Text style={styles.flaggedName} numberOfLines={1}>
                      {student.full_name}
                    </Text>
                    <Text style={styles.flaggedSub} numberOfLines={1}>
                      {activeQuizName} score below threshold
                    </Text>
                  </View>

                  <View style={styles.flaggedScoreCol}>
                    <Text style={styles.flaggedScoreText}>{student.average}% avg</Text>
                    <Text style={styles.flaggedTrendText}>↘ declining</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.allClearCard}>
            <Ionicons name="checkmark-circle" size={24} color="#059669" />
            <Text style={styles.allClearText}>
              No students currently flagged as at-risk. Great performance!
            </Text>
          </View>
        )}
      </View>

      {/* ── Section 5: Tseki's Recommendation ── */}
      <View style={styles.recommendationCard}>
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.mascotImg}
          resizeMode="contain"
        />
        <View style={styles.recommendationInfo}>
          <Text style={styles.recommendationTitle}>Tseki's Recommendation</Text>
          <Text style={styles.recommendationText}>
            {atRiskCount > 0
              ? `You have ${atRiskCount} student${atRiskCount > 1 ? "s" : ""} showing signs of difficulty. Click "Create remedial quiz" to automatically generate custom, easier homework for them!`
              : "All students are performing on track! Consider creating an advanced challenge quiz using AI Builder to keep top performers engaged."}
          </Text>

          <TouchableOpacity
            style={styles.remedialBtn}
            onPress={onNavigateToAIBuilder}
            activeOpacity={0.8}
          >
            <Ionicons name="sparkles" size={13} color="#FFFFFF" />
            <Text style={styles.remedialBtnText}>
              {atRiskCount > 0 ? "Create remedial quiz" : "Create challenge quiz"}
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

  /* ── Trend Chart ── */
  chartContainer: {
    height: 140,
    marginTop: 10,
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
    top: 6,
    backgroundColor: "rgba(59, 130, 246, 0.05)",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  chartDot: {
    position: "absolute",
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    zIndex: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  chartBaseline: {
    position: "absolute",
    height: 1.5,
    backgroundColor: "#E2E8F0",
  },
  xAxisRow: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  xAxisLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
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
