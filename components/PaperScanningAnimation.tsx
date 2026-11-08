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

  // Corner registration bracket gentle breathing pulse
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;

  // Status dot pulse
  const dotPulseAnim = useRef(new Animated.Value(1)).current;

  // Active question row highlights as laser sweeps (1..4)
  const [activeRow, setActiveRow] = useState<number>(1);

  // Dynamic stage progression (advances 0 -> 1 -> 2 -> 3 and holds on final stage)
  const [stageIndex, setStageIndex] = useState<number>(0);

  // Live percentage display driven by continuous progressAnim
  const [percentDisplay, setPercentDisplay] = useState<number>(12);

  // Continuous forward-moving progress bar (never jumps backwards)
  const progressAnim = useRef(new Animated.Value(0.12)).current;

  const STAGES = [
    {
      title: "Aligning Corner Registration Squares",
      sub: "360° perspective correction & corner lock active",
    },
    {
      title: "Reading Student Information & QR Code",
      sub: "Linking student identity to classroom roster",
    },
    {
      title: "Scanning Handwritten Answer Boxes",
      sub: "Detecting shaded marks & capital letters",
    },
    {
      title: "Validating Against Master Answer Key",
      sub: "Tallying score and generating item feedback",
    },
  ];

  useEffect(() => {
    // 1. Continuous Laser Sweep Loop (smoothly sweeps top <-> bottom like animation1.mp4)
    const laserLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1700,
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
          duration: 850,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulseAnim, {
          toValue: 1.0,
          duration: 850,
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
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dotPulseAnim, {
          toValue: 1.0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    dotLoop.start();

    // 4. Smooth Continuous Progress Bar Fill (12% -> 96% without looping backwards)
    const listenerId = progressAnim.addListener(({ value }) => {
      setPercentDisplay(Math.round(value * 100));
    });

    Animated.timing(progressAnim, {
      toValue: 0.96,
      duration: 6200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 5. Advance Stages sequentially (holds at final stage so it never resets to Step 1)
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 1500);

    // 6. Cycle Active Scanned Rows (1 -> 2 -> 3 -> 4)
    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 4 ? 1 : prev + 1));
    }, 650);

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

  const currentStage = STAGES[stageIndex];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Mini Stylized Paper Sheet (animation1.mp4) ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        <View style={[styles.paperSheet, { backgroundColor: sheetBg, borderColor: sheetBorder }]}>
          {/* Corner 1: Top-Left Registration Square */}
          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerTL,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          {/* Corner 2: Top-Right Registration Square */}
          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerTR,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          {/* Corner 3: Bottom-Left Registration Square */}
          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerBL,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          {/* Corner 4: Bottom-Right Registration Square */}
          <Animated.View
            style={[
              styles.cornerMarker,
              styles.cornerBR,
              { transform: [{ scale: cornerPulseAnim }] },
            ]}
          >
            <View style={[styles.solidMarkerBox, { backgroundColor: markerColor }]} />
          </Animated.View>

          {/* Header Preview inside the Sheet (Student Info Skeleton + Green QR Box) */}
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <View style={[styles.skeletonLine, { width: "65%", height: 6.5, backgroundColor: accentColor }]} />
              <View
                style={[
                  styles.skeletonLine,
                  { width: "88%", height: 4, marginTop: 4, backgroundColor: darkMode ? "#475569" : "#CBD5E1" },
                ]}
              />
              <View
                style={[
                  styles.skeletonLine,
                  { width: "72%", height: 4, marginTop: 3, backgroundColor: darkMode ? "#334155" : "#E2E8F0" },
                ]}
              />
            </View>
            <View style={styles.miniQrBox}>
              <Ionicons name="qr-code" size={16} color="#10B981" />
            </View>
          </View>

          {/* Simulated 01–04 Bubble Rows + "+1 pt" Score Pills */}
          <View style={styles.bubbleGrid}>
            {[1, 2, 3, 4].map((rowNum) => {
              const isScanned = rowNum <= activeRow;
              return (
                <View key={rowNum} style={styles.bubbleRow}>
                  <Text
                    style={[
                      styles.rowNumber,
                      { color: isScanned ? accentColor : subTextColor },
                    ]}
                  >
                    {`0${rowNum}`}
                  </Text>
                  {["A", "B", "C", "D"].map((letter, colIdx) => {
                    const isMarked =
                      (rowNum === 1 && colIdx === 1) ||
                      (rowNum === 2 && colIdx === 0) ||
                      (rowNum === 3 && colIdx === 2) ||
                      (rowNum === 4 && colIdx === 3);

                    const showGreen = isMarked && isScanned;

                    return (
                      <View
                        key={letter}
                        style={[
                          styles.bubble,
                          {
                            backgroundColor: showGreen
                              ? "#10B981"
                              : darkMode
                              ? "#1E293B"
                              : "#F8FAFC",
                            borderColor: showGreen
                              ? "#10B981"
                              : darkMode
                              ? "#475569"
                              : "#CBD5E1",
                          },
                        ]}
                      >
                        {showGreen ? (
                          <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                        ) : (
                          <Text
                            style={[
                              styles.bubbleText,
                              { color: darkMode ? "#94A3B8" : "#64748B" },
                            ]}
                          >
                            {letter}
                          </Text>
                        )}
                      </View>
                    );
                  })}

                  {/* Row Score Pill (+1 pt) */}
                  <View
                    style={[
                      styles.rowPill,
                      {
                        backgroundColor: isScanned
                          ? "rgba(16, 185, 129, 0.14)"
                          : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rowPillText,
                        { color: isScanned ? "#10B981" : "transparent" },
                      ]}
                    >
                      +1 pt
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ── Sweeping Glowing Emerald Laser Beam Overlay ── */}
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
                      outputRange: [8, 168],
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
        <Text style={styles.stepText}>Step {stageIndex + 1} of {STAGES.length}</Text>
        <Text style={[styles.percentText, { color: textColor }]}>{percentDisplay}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    width: "100%",
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
    height: 182,
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
  bubbleGrid: {
    paddingHorizontal: 14,
    gap: 7,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowNumber: {
    fontSize: 10,
    fontWeight: "700",
    width: 16,
  },
  bubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleText: {
    fontSize: 8,
    fontWeight: "700",
  },
  rowPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: "auto",
  },
  rowPillText: {
    fontSize: 9,
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
