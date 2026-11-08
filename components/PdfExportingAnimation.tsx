import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface PdfExportingAnimationProps {
  quizTitle?: string;
  exportVersion?: "A" | "B" | "C";
  accentColor?: string;
  darkMode?: boolean;
}

export function PdfExportingAnimation({
  quizTitle = "Assessment",
  exportVersion = "A",
  accentColor = "#EA580C",
  darkMode = false,
}: PdfExportingAnimationProps) {
  // Laser / print sweep vertical animation (0 -> 1 -> 0) [100% Native Driver]
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Corner registration brackets gentle breathing pulse [100% Native Driver]
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;

  // Status dot pulse [100% Native Driver]
  const dotPulseAnim = useRef(new Animated.Value(1)).current;

  // Sequential row formatting opacities [100% Native Driver — Zero React Re-renders]
  const row1Opacity = useRef(new Animated.Value(0.45)).current;
  const row2Opacity = useRef(new Animated.Value(0.45)).current;
  const row3Opacity = useRef(new Animated.Value(0.45)).current;

  // Continuous forward-moving progress bar [100% Native Driver translateX — Never Stutters]
  const progressAnim = useRef(new Animated.Value(0.18)).current;
  const [trackWidth, setTrackWidth] = useState<number>(250);

  // Dynamic stages (calm interval update, not every frame)
  const [stageIndex, setStageIndex] = useState<number>(0);
  const [percentDisplay, setPercentDisplay] = useState<number>(18);

  const STAGES = [
    {
      title: `Formatting Set ${exportVersion} Layout & Typography`,
      sub: "Aligning test margins, section headers, and DepEd standards",
    },
    {
      title: "Embedding Scannable Anchors & QR Code",
      sub: "Calibrating 4-corner markers for one-shot camera grading",
    },
    {
      title: "Compiling Print-Ready Vector PDF",
      sub: "Generating 300 DPI high-resolution pages & answer key",
    },
  ];

  useEffect(() => {
    // 1. Continuous Laser Sweep Loop (Native Driver — runs 60fps on GPU)
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

    // 2. Corner Registration Squares Breathing (Native Driver)
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

    // 3. Status Dot Pulse (Native Driver)
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

    // 4. Sequential Row Formatting Pulse (Native Driver — avoids React re-renders)
    const rowsLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(row1Opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(row2Opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(row3Opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(800),
        Animated.parallel([
          Animated.timing(row1Opacity, { toValue: 0.45, duration: 350, useNativeDriver: true }),
          Animated.timing(row2Opacity, { toValue: 0.45, duration: 350, useNativeDriver: true }),
          Animated.timing(row3Opacity, { toValue: 0.45, duration: 350, useNativeDriver: true }),
        ]),
        Animated.delay(150),
      ])
    );
    rowsLoop.start();

    // 5. Continuous Smooth Progress Fill (Native Driver translateX — never blocks when JS is busy)
    Animated.timing(progressAnim, {
      toValue: 0.98,
      duration: 3600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // 6. Calm Stage Advancement (every 1.2s, minimal JS overhead)
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 1200);

    // 7. Calm Percentage Counter (every 350ms, prevents 60fps re-render choking)
    const percentTimer = setInterval(() => {
      setPercentDisplay((prev) => (prev < 96 ? prev + 13 : 97));
    }, 380);

    return () => {
      laserLoop.stop();
      cornerLoop.stop();
      dotLoop.stop();
      rowsLoop.stop();
      clearInterval(stageTimer);
      clearInterval(percentTimer);
    };
  }, [laserAnim, cornerPulseAnim, dotPulseAnim, row1Opacity, row2Opacity, row3Opacity, progressAnim]);

  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const sheetBg = darkMode ? "#0F172A" : "#FFFFFF";
  const sheetBorder = darkMode ? "#334155" : "#E2E8F0";
  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const markerColor = darkMode ? "#F8FAFC" : "#0F172A";
  const skelBarBg = darkMode ? "#334155" : "#E2E8F0";

  const currentStage = STAGES[stageIndex];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Stylized Paper Sheet Preview ── */}
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

          {/* Sheet Header: Set Pill Badge + Skeleton Assessment Title + Mini QR Box */}
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <View style={[styles.versionBadge, { backgroundColor: accentColor + "18" }]}>
                <Ionicons name="document-text" size={9} color={accentColor} />
                <Text style={[styles.versionBadgeText, { color: accentColor }]}>
                  SET {exportVersion}
                </Text>
              </View>
              <View
                style={[
                  styles.skeletonLine,
                  { width: "86%", height: 5, marginTop: 4, backgroundColor: skelBarBg },
                ]}
              />
              <View
                style={[
                  styles.skeletonLine,
                  { width: "65%", height: 3.5, marginTop: 3, backgroundColor: darkMode ? "#475569" : "#CBD5E1" },
                ]}
              />
            </View>
            <View style={styles.miniQrBox}>
              <Ionicons name="qr-code" size={16} color="#10B981" />
            </View>
          </View>

          {/* Simulated Scannable Question Rows & Bubble Grid (Natively Animated Opacity) */}
          <View style={styles.itemsGrid}>
            <Animated.View style={[styles.itemRow, { opacity: row1Opacity }]}>
              <Text style={[styles.rowNumber, { color: accentColor }]}>01</Text>
              <View style={[styles.skeletonLine, { width: 52, height: 5, backgroundColor: "rgba(16, 185, 129, 0.45)" }]} />
              <View style={styles.bubbleGroup}>
                {["A", "B", "C", "D"].map((letter) => (
                  <View
                    key={letter}
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#475569" : "#CBD5E1",
                      },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: darkMode ? "#94A3B8" : "#64748B" }]}>{letter}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            <Animated.View style={[styles.itemRow, { opacity: row2Opacity }]}>
              <Text style={[styles.rowNumber, { color: accentColor }]}>02</Text>
              <View style={[styles.skeletonLine, { width: 44, height: 5, backgroundColor: "rgba(16, 185, 129, 0.45)" }]} />
              <View style={styles.bubbleGroup}>
                {["A", "B", "C", "D"].map((letter) => (
                  <View
                    key={letter}
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#475569" : "#CBD5E1",
                      },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: darkMode ? "#94A3B8" : "#64748B" }]}>{letter}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            <Animated.View style={[styles.itemRow, { opacity: row3Opacity }]}>
              <Text style={[styles.rowNumber, { color: accentColor }]}>03</Text>
              <View style={[styles.skeletonLine, { width: 48, height: 5, backgroundColor: "rgba(16, 185, 129, 0.45)" }]} />
              <View style={styles.bubbleGroup}>
                {["A", "B", "C", "D"].map((letter) => (
                  <View
                    key={letter}
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                        borderColor: darkMode ? "#475569" : "#CBD5E1",
                      },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: darkMode ? "#94A3B8" : "#64748B" }]}>{letter}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          </View>

          {/* Sheet Footer Strip: Ready to Print */}
          <View style={styles.sheetFooterStrip}>
            <Ionicons name="checkmark-done-circle" size={11} color="#10B981" />
            <Text style={[styles.sheetFooterText, { color: darkMode ? "#94A3B8" : "#64748B" }]}>
              300 DPI Vector • Scannable Grid
            </Text>
          </View>

          {/* Sweeping Laser / Print Head Beam Overlay */}
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
                      outputRange: [6, 168],
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

      {/* ── 3. Smooth Continuous Progress Bar (100% Native Driver translateX) ── */}
      <View
        style={[styles.progressTrack, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - trackWidth) > 5) {
            setTrackWidth(w);
          }
        }}
      >
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: accentColor,
              width: "100%",
              transform: [
                {
                  translateX: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-trackWidth, 0],
                  }),
                },
              ],
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
    height: 180,
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
    paddingHorizontal: 12,
    paddingTop: 2,
    marginBottom: 9,
  },
  versionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3.5,
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  versionBadgeText: {
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
  itemsGrid: {
    paddingHorizontal: 12,
    gap: 6.5,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowNumber: {
    fontSize: 9.5,
    fontWeight: "700",
    width: 15,
  },
  bubbleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4.5,
    marginLeft: "auto",
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
  sheetFooterStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 8,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.18)",
  },
  sheetFooterText: {
    fontSize: 8.5,
    fontWeight: "600",
    letterSpacing: 0.1,
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
