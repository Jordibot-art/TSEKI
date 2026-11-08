import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface PaperScanningAnimationProps {
  quizTitle?: string;
  accentColor?: string;
  darkMode?: boolean;
}

export function PaperScanningAnimation({
  quizTitle = "Assessment",
  accentColor = "#EA580C",
  darkMode = false,
}: PaperScanningAnimationProps) {
  // Laser vertical sweep animation (0 -> 1 -> 0)
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Active question row highlights as laser sweeps
  const [activeRow, setActiveRow] = useState<number>(1);

  // Dynamic stage progression (3 steps)
  const [stageIndex, setStageIndex] = useState<number>(0);
  const STAGES = [
    {
      title: "Aligning Corner Registration Markers",
      sub: "360° perspective correction and corner lock active",
      progress: 0.35,
      percentText: "35%",
    },
    {
      title: "Scanning Handwritten Answer Bubbles",
      sub: "Detecting shaded marks and student handwriting",
      progress: 0.7,
      percentText: "70%",
    },
    {
      title: "Validating Against Master Answer Key",
      sub: "Calculating scores and verifying low-confidence marks",
      progress: 1.0,
      percentText: "100%",
    },
  ];

  // Stage progress animation (0.35 -> 0.7 -> 1.0)
  const progressAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    // 1. Continuous Laser Sweep Loop
    const laserLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    laserLoop.start();

    // 2. Cycle active row highlights
    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 750);

    // 3. Stage & progress bar cycle
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => {
        const next = (prev + 1) % STAGES.length;
        Animated.timing(progressAnim, {
          toValue: STAGES[next].progress,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
        return next;
      });
    }, 2000);

    return () => {
      laserLoop.stop();
      clearInterval(rowTimer);
      clearInterval(stageTimer);
    };
  }, []);

  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const sheetBg = darkMode ? "#0F172A" : "#FFFFFF";
  const markerColor = darkMode ? "#F8FAFC" : "#0F172A";

  const currentStage = STAGES[stageIndex];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Mini OMR Sheet Preview ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        <View style={[styles.omrSheet, { backgroundColor: sheetBg, borderColor: stageBorder }]}>
          {/* 4 Shrunk 8x8px Corner Registration Markers */}
          <View style={[styles.cornerMarker, styles.cornerTL, { backgroundColor: markerColor }]} />
          <View style={[styles.cornerMarker, styles.cornerTR, { backgroundColor: markerColor }]} />
          <View style={[styles.cornerMarker, styles.cornerBL, { backgroundColor: markerColor }]} />
          <View style={[styles.cornerMarker, styles.cornerBR, { backgroundColor: markerColor }]} />

          {/* Clean 01–03 Bubble Rows (A B C D) */}
          <View style={styles.bubbleGrid}>
            {[1, 2, 3].map((rowNum) => {
              const isDetected = rowNum <= activeRow;
              return (
                <View key={rowNum} style={styles.bubbleRow}>
                  <Text style={[styles.rowNumber, { color: isDetected ? "#10B981" : subTextColor }]}>
                    {`0${rowNum}`}
                  </Text>
                  {["A", "B", "C", "D"].map((letter, colIdx) => {
                    const isTarget =
                      (rowNum === 1 && colIdx === 1) || // Q1 -> B
                      (rowNum === 2 && colIdx === 0) || // Q2 -> A
                      (rowNum === 3 && colIdx === 2);   // Q3 -> C

                    const isMarked = isTarget && isDetected;

                    return (
                      <View
                        key={letter}
                        style={[
                          styles.bubble,
                          {
                            borderColor: isMarked ? "#10B981" : (darkMode ? "#475569" : "#CBD5E1"),
                            backgroundColor: isMarked
                              ? "#10B981"
                              : (darkMode ? "#1E293B" : "#F8FAFC"),
                          },
                        ]}
                      >
                        {isMarked ? (
                          <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                        ) : (
                          <Text style={[styles.bubbleText, { color: darkMode ? "#94A3B8" : "#64748B" }]}>
                            {letter}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>

          {/* Sweeping Laser Line Overlay */}
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
                      outputRange: [4, 78],
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

      {/* ── 2. Typography Block (Centered, No Floating Left Dot) ── */}
      <View style={styles.typographyBlock}>
        <Text style={[styles.stageTitle, { color: textColor }]}>
          {currentStage.title}
        </Text>
        <Text style={[styles.stageSubtitle, { color: subTextColor }]} numberOfLines={1}>
          {currentStage.sub}
        </Text>
      </View>

      {/* ── 3. Smooth Progress Bar + Step Counter Row ── */}
      <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>

      <View style={styles.stepCounterRow}>
        <Text style={styles.stepText}>Step {stageIndex + 1} of 3</Text>
        <Text style={[styles.percentText, { color: textColor }]}>{currentStage.percentText}</Text>
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
    height: 110,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  omrSheet: {
    width: 200,
    height: 84,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cornerMarker: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 1.5,
  },
  cornerTL: { top: 5, left: 5 },
  cornerTR: { top: 5, right: 5 },
  cornerBL: { bottom: 5, left: 5 },
  cornerBR: { bottom: 5, right: 5 },
  bubbleGrid: {
    gap: 6,
    alignItems: "center",
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  rowNumber: {
    fontSize: 9.5,
    fontWeight: "700",
    width: 16,
    textAlign: "right",
    marginRight: 2,
  },
  bubble: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleText: {
    fontSize: 7.5,
    fontWeight: "700",
  },
  laserBar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  laserTrail: {
    position: "absolute",
    top: 2,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  typographyBlock: {
    width: "100%",
    alignItems: "center",
  },
  stageTitle: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  stageSubtitle: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  progressTrack: {
    height: 6,
    width: "100%",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#0F172A",
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
    fontWeight: "600",
  },
});
