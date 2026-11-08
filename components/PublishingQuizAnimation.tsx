import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface PublishingQuizAnimationProps {
  quizTitle?: string;
  accentColor?: string;
  darkMode?: boolean;
}

export function PublishingQuizAnimation({
  quizTitle = "Assessment",
  accentColor = "#EA580C",
  darkMode = false,
}: PublishingQuizAnimationProps) {
  // Vertical calibration sweep beam (0 -> 1 -> 0, just like animation1.mp4)
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Corner registration brackets gentle breathing pulse
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;

  // Status dot pulse
  const dotPulseAnim = useRef(new Animated.Value(1)).current;

  // Active locked row (1..4)
  const [activeRow, setActiveRow] = useState<number>(1);

  // Stage progression (advances 0 -> 1 -> 2 and holds on final stage)
  const [stageIndex, setStageIndex] = useState<number>(0);

  // Continuous forward-moving progress bar + live percentage
  const progressAnim = useRef(new Animated.Value(0.18)).current;
  const [percentDisplay, setPercentDisplay] = useState<number>(18);

  const STAGES = [
    {
      title: "Validating Answer Key & Sections",
      sub: "Checking item numbers, answer keys, and point totals",
    },
    {
      title: "Mapping Camera Grader Coordinates",
      sub: "Calibrating 4-corner anchors & scannable answer boxes",
    },
    {
      title: "Publishing to Classroom Archive",
      sub: "Syncing quiz records and test sheets to your classroom",
    },
  ];

  useEffect(() => {
    // 1. Continuous Calibration Laser Sweep Loop
    const laserLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    laserLoop.start();

    // 2. Corner Registration Squares Gentle Breathing
    const cornerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerPulseAnim, {
          toValue: 1.08,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulseAnim, {
          toValue: 1.0,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    cornerLoop.start();

    // 3. Status Dot Pulse
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulseAnim, {
          toValue: 0.35,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dotPulseAnim, {
          toValue: 1.0,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    dotLoop.start();

    // 4. Smooth Continuous Progress Bar Fill (18% -> 98% without looping backwards)
    const listenerId = progressAnim.addListener(({ value }) => {
      setPercentDisplay(Math.round(value * 100));
    });

    Animated.timing(progressAnim, {
      toValue: 0.98,
      duration: 4200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 5. Advance Stages sequentially (holds at final stage)
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 1350);

    // 6. Cycle Locked Answer Key Rows (1 -> 2 -> 3 -> 4)
    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 4 ? 1 : prev + 1));
    }, 550);

    return () => {
      laserLoop.stop();
      cornerLoop.stop();
      dotLoop.stop();
      progressAnim.removeListener(listenerId);
      clearInterval(stageTimer);
      clearInterval(rowTimer);
    };
  }, [laserAnim, cornerPulseAnim, dotPulseAnim, progressAnim]);

  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const sheetBg = darkMode ? "#0F172A" : "#FFFFFF";
  const sheetBorder = darkMode ? "#334155" : "#E2E8F0";
  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const markerColor = darkMode ? "#F8FAFC" : "#0F172A";
  const skelBarBg = darkMode ? "#334155" : "#E2E8F0";

  const currentStage = STAGES[stageIndex];
  const KEY_LETTERS = ["B", "A", "C", "D"];
  const BAR_WIDTHS = [68, 54, 62, 50];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Scannable Master Sheet Preview (animation1.mp4 style) ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        <View style={[styles.paperSheet, { backgroundColor: sheetBg, borderColor: sheetBorder }]}>
          {/* 4 Breathing Corner Registration Squares */}
          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerTL,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerTR,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerBL,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerBR,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          {/* Sheet Header: Master Key Pill + Skeleton Title + Green QR Code Badge */}
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <View style={[styles.masterBadge, { backgroundColor: accentColor + "18" }]}>
                <Text style={[styles.masterBadgeText, { color: accentColor }]}>MASTER KEY</Text>
              </View>
              <View
                style={[
                  styles.skeletonLine,
                  { width: "84%", height: 4.5, marginTop: 5, backgroundColor: skelBarBg },
                ]}
              />
            </View>
            <View style={styles.miniQrBox}>
              <Ionicons name="qr-code" size={16} color="#10B981" />
            </View>
          </View>

          {/* 4 Validated Answer Key Rows */}
          <View style={styles.keyGrid}>
            {[1, 2, 3, 4].map((rowNum, idx) => {
              const isLocked = rowNum <= activeRow;
              return (
                <View key={rowNum} style={styles.keyRow}>
                  <Text
                    style={[
                      styles.rowNumber,
                      { color: isLocked ? accentColor : subTextColor },
                    ]}
                  >
                    {`0${rowNum}`}
                  </Text>

                  <View
                    style={[
                      styles.checkCircle,
                      isLocked
                        ? { backgroundColor: "#10B981", borderColor: "#10B981" }
                        : {
                            backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                            borderColor: darkMode ? "#475569" : "#CBD5E1",
                          },
                    ]}
                  >
                    {isLocked ? (
                      <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                    ) : (
                      <View style={styles.pendingDot} />
                    )}
                  </View>

                  <View
                    style={[
                      styles.skeletonLine,
                      {
                        width: BAR_WIDTHS[idx],
                        height: 5.5,
                        backgroundColor: isLocked
                          ? "rgba(16, 185, 129, 0.42)"
                          : skelBarBg,
                      },
                    ]}
                  />

                  <View
                    style={[
                      styles.keyPill,
                      {
                        backgroundColor: isLocked
                          ? "rgba(16, 185, 129, 0.14)"
                          : darkMode
                          ? "#1E293B"
                          : "#F1F5F9",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.keyPillText,
                        { color: isLocked ? "#10B981" : subTextColor },
                      ]}
                    >
                      {`Key: ${KEY_LETTERS[idx]}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Sweeping Glowing Calibration Beam Overlay */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.laserBar,
              {
                backgroundColor: "#10B981",
                shadowColor: "#10B981",
                transform: [
                  {
                    translateY: laserAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 166],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.laserTrail} />
          </Animated.View>
        </View>
      </View>

      {/* ── 2. Typography Block (Full Wrapping Subtitle — Never Truncated) ── */}
      <View style={styles.statusArea}>
        <View style={styles.stageTitleRow}>
          <Animated.View
            style={[
              styles.pulseDot,
              { backgroundColor: accentColor, opacity: dotPulseAnim },
            ]}
          />
          <Text style={[styles.stageTitle, { color: textColor }]}>
            {currentStage.title}
          </Text>
        </View>
        <Text style={[styles.stageSub, { color: subTextColor }]}>
          {currentStage.sub}
        </Text>
      </View>

      {/* ── 3. Smooth Continuous Progress Bar + Step & Live Percentage Row ── */}
      <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: accentColor,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>

      <View style={styles.stepCounterRow}>
        <Text style={styles.stepText}>
          Step {stageIndex + 1} of {STAGES.length}
        </Text>
        <Text style={[styles.percentText, { color: textColor }]}>{percentDisplay}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
  },
  stageCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  paperSheet: {
    width: 232,
    height: 178,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  cornerMarker: {
    position: "absolute",
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  solidMarkerBox: {
    width: 9,
    height: 9,
    borderRadius: 1.5,
  },
  cornerTL: { top: 6, left: 6 },
  cornerTR: { top: 6, right: 6 },
  cornerBL: { bottom: 6, left: 6 },
  cornerBR: { bottom: 6, right: 6 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 2,
    marginBottom: 10,
  },
  masterBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  masterBadgeText: {
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  skeletonLine: {
    borderRadius: 3,
  },
  miniQrBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.32)",
  },
  keyGrid: {
    paddingHorizontal: 14,
    gap: 7,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  rowNumber: {
    fontSize: 10,
    fontWeight: "700",
    width: 16,
  },
  checkCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#94A3B8",
  },
  keyPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginLeft: "auto",
  },
  keyPillText: {
    fontSize: 8.5,
    fontWeight: "800",
  },
  laserBar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 8,
  },
  laserTrail: {
    position: "absolute",
    top: 2,
    left: 0,
    right: 0,
    height: 14,
    backgroundColor: "rgba(16, 185, 129, 0.14)",
  },
  statusArea: {
    width: "100%",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  stageTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 4,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  stageTitle: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
    textAlign: "center",
    flexShrink: 1,
  },
  stageSub: {
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
    minHeight: 34,
  },
  progressTrack: {
    height: 6,
    width: "100%",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  stepCounterRow: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    alignItems: "center",
  },
  stepText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  percentText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
