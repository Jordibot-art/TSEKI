import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface PaperScanningAnimationProps {
  quizTitle?: string;
  accentColor?: string;
  darkMode?: boolean;
}

export function PaperScanningAnimation({
  quizTitle = "Assessment",
  accentColor = "#F97316",
  darkMode = false,
}: PaperScanningAnimationProps) {
  // Laser vertical sweep animation (0 -> 1 -> 0)
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Corner breathing pulse animation
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;

  // Active question row highlights as laser sweeps
  const [activeRow, setActiveRow] = useState<number>(1);

  // Dynamic stage progression
  const [stageIndex, setStageIndex] = useState<number>(0);
  const STAGES = [
    { title: "Aligning Corner Registration Squares", sub: "360° perspective correction active" },
    { title: "Reading Student Information & QR Code", sub: "Linking student identity to roster" },
    { title: "Scanning Handwritten Answer Boxes", sub: "Detecting shaded marks & capital letters" },
    { title: "Validating Against Master Answer Key", sub: "Tallying score and generating feedback" },
  ];

  // Stage progress animation (0 -> 100%)
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Continuous Laser Sweep Loop
    const laserLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    laserLoop.start();

    // 2. Corner Bracket Gentle Breathing
    const cornerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerPulseAnim, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulseAnim, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    cornerLoop.start();

    // 3. Progress Bar Fill Loop
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 6000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 4. Cycle Stages and Active Rows
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 1500);

    const rowTimer = setInterval(() => {
      setActiveRow((prev) => (prev >= 4 ? 1 : prev + 1));
    }, 800);

    return () => {
      laserLoop.stop();
      cornerLoop.stop();
      clearInterval(stageTimer);
      clearInterval(rowTimer);
    };
  }, [laserAnim, cornerPulseAnim, progressAnim]);

  const sheetBg = darkMode ? "#1F2937" : "#FFFFFF";
  const sheetBorder = darkMode ? "#374151" : "#E5E7EB";
  const textColor = darkMode ? "#F9FAFB" : "#111827";
  const subTextColor = darkMode ? "#9CA3AF" : "#6B7280";

  return (
    <View style={styles.container}>
      {/* ── Mini Stylized Paper Sheet ── */}
      <View style={[styles.paperSheet, { backgroundColor: sheetBg, borderColor: sheetBorder }]}>
        {/* Corner 1: Top-Left Marker */}
        <Animated.View
          style={[
            styles.cornerMarker,
            styles.cornerTL,
            { transform: [{ scale: cornerPulseAnim }] },
          ]}
        >
          <View style={styles.solidMarkerBox} />
        </Animated.View>

        {/* Corner 2: Top-Right Marker */}
        <Animated.View
          style={[
            styles.cornerMarker,
            styles.cornerTR,
            { transform: [{ scale: cornerPulseAnim }] },
          ]}
        >
          <View style={styles.solidMarkerBox} />
        </Animated.View>

        {/* Corner 3: Bottom-Left Marker */}
        <Animated.View
          style={[
            styles.cornerMarker,
            styles.cornerBL,
            { transform: [{ scale: cornerPulseAnim }] },
          ]}
        >
          <View style={styles.solidMarkerBox} />
        </Animated.View>

        {/* Corner 4: Bottom-Right Marker */}
        <Animated.View
          style={[
            styles.cornerMarker,
            styles.cornerBR,
            { transform: [{ scale: cornerPulseAnim }] },
          ]}
        >
          <View style={styles.solidMarkerBox} />
        </Animated.View>

        {/* Header Preview inside the Sheet */}
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <View style={[styles.skeletonLine, { width: "65%", height: 7, backgroundColor: accentColor }]} />
            <View style={[styles.skeletonLine, { width: "90%", height: 4, marginTop: 4, opacity: 0.5 }]} />
            <View style={[styles.skeletonLine, { width: "75%", height: 4, marginTop: 3, opacity: 0.4 }]} />
          </View>
          <View style={styles.miniQrBox}>
            <Ionicons name="qr-code" size={18} color="#10B981" />
          </View>
        </View>

        {/* Simulated Question & Answer Rows */}
        <View style={styles.bubbleGrid}>
          {[1, 2, 3, 4].map((rowNum) => {
            const isScanned = rowNum <= activeRow;
            return (
              <View key={rowNum} style={styles.bubbleRow}>
                <Text style={[styles.rowNumber, { color: isScanned ? accentColor : subTextColor }]}>
                  {rowNum < 10 ? `0${rowNum}` : rowNum}
                </Text>
                {["A", "B", "C", "D"].map((letter, colIdx) => {
                  const isMarked = (rowNum === 1 && colIdx === 1) ||
                    (rowNum === 2 && colIdx === 0) ||
                    (rowNum === 3 && colIdx === 2) ||
                    (rowNum === 4 && colIdx === 3);

                  return (
                    <View
                      key={letter}
                      style={[
                        styles.bubble,
                        isMarked && isScanned && {
                          backgroundColor: "#10B981",
                          borderColor: "#10B981",
                        },
                      ]}
                    >
                      {isMarked && isScanned ? (
                        <Ionicons name="checkmark" size={9} color="#FFFFFF" />
                      ) : (
                        <Text style={styles.bubbleText}>{letter}</Text>
                      )}
                    </View>
                  );
                })}

                {/* Row Score Pill */}
                {isScanned ? (
                  <View style={[styles.rowPill, { backgroundColor: "#10B9811C" }]}>
                    <Text style={[styles.rowPillText, { color: "#10B981" }]}>+1 pt</Text>
                  </View>
                ) : (
                  <View style={[styles.rowPill, { backgroundColor: "transparent" }]}>
                    <Text style={[styles.rowPillText, { color: "transparent" }]}>+1 pt</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Sweeping Laser Beam Overlay ── */}
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
                    outputRange: [6, 174],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Subtle glowing trail below the laser line */}
          <View style={styles.laserTrail} />
        </Animated.View>
      </View>

      {/* ── Status Text & Step Progress ── */}
      <View style={styles.statusArea}>
        <View style={styles.stageTitleRow}>
          <View style={[styles.pulseDot, { backgroundColor: accentColor }]} />
          <Text style={[styles.stageTitle, { color: textColor }]}>
            {STAGES[stageIndex].title}
          </Text>
        </View>
        <Text style={[styles.stageSub, { color: subTextColor }]}>
          {STAGES[stageIndex].sub}
        </Text>
      </View>

      {/* ── Animated Gradient-like Progress Bar ── */}
      <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#374151" : "#E5E7EB" }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: accentColor,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["15%", "95%"],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    width: "100%",
    paddingVertical: 4,
  },
  paperSheet: {
    width: 230,
    height: 190,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  cornerMarker: {
    position: "absolute",
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  solidMarkerBox: {
    width: 10,
    height: 10,
    backgroundColor: "#111827",
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
    paddingHorizontal: 16,
    paddingTop: 4,
    marginBottom: 10,
  },
  skeletonLine: {
    borderRadius: 3,
    backgroundColor: "#9CA3AF",
  },
  miniQrBox: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  bubbleGrid: {
    paddingHorizontal: 16,
    gap: 8,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowNumber: {
    fontSize: 10,
    fontWeight: "700",
    width: 18,
  },
  bubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9FAFB",
  },
  bubbleText: {
    fontSize: 8,
    fontWeight: "600",
    color: "#6B7280",
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
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  statusArea: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  stageTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stageTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  stageSub: {
    fontSize: 11.5,
    marginTop: 3,
    textAlign: "center",
  },
  progressTrack: {
    width: "85%",
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
});
