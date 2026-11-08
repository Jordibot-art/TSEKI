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
  const [stageIndex, setStageIndex] = useState(0);

  // Checkmarks sequential fade-in animations
  const check1Anim = useRef(new Animated.Value(0)).current;
  const check2Anim = useRef(new Animated.Value(0)).current;
  const check3Anim = useRef(new Animated.Value(0)).current;

  // Horizontal scan shimmer bar sweep
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Progress bar animation (35% -> 70% -> 100%)
  const progressAnim = useRef(new Animated.Value(0.35)).current;

  const STAGES = [
    {
      title: "Validating Answer Key & Sections",
      sub: "Checking item numbers, answer keys, and point distributions",
      progress: 0.35,
      percentText: "35%",
    },
    {
      title: "Mapping Camera Grader Coordinates",
      sub: "Calibrating 4-corner anchors and scannable answer boxes",
      progress: 0.7,
      percentText: "70%",
    },
    {
      title: "Publishing to Classroom Archive",
      sub: "Syncing quiz records and test sheets to your classroom",
      progress: 1.0,
      percentText: "100%",
    },
  ];

  useEffect(() => {
    // 1. Shimmer sweep loop across the card
    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    shimmerLoop.start();

    // 2. Sequential checkmark animations loop
    const checkmarksLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(check1Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(check2Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(check3Anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.parallel([
          Animated.timing(check1Anim, { toValue: 0.2, duration: 300, useNativeDriver: true }),
          Animated.timing(check2Anim, { toValue: 0.2, duration: 300, useNativeDriver: true }),
          Animated.timing(check3Anim, { toValue: 0.2, duration: 300, useNativeDriver: true }),
        ]),
        Animated.delay(200),
      ])
    );
    checkmarksLoop.start();

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
    }, 2200);

    return () => {
      shimmerLoop.stop();
      checkmarksLoop.stop();
      clearInterval(stageTimer);
    };
  }, []);

  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const sheetBg = darkMode ? "#0F172A" : "#FFFFFF";
  const skeletonColor = darkMode ? "#334155" : "#E2E8F0";

  const shimmerTranslateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, 210],
  });

  const currentStage = STAGES[stageIndex];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Document-to-gradebook graphic ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        <View style={[styles.miniSheet, { backgroundColor: sheetBg, borderColor: stageBorder }]}>
          {/* Mini QR badge */}
          <View style={[styles.qrBadge, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
            <Ionicons name="qr-code" size={17} color={textColor} />
          </View>

          {/* 3 Item Rows with sequential checkmarks */}
          <View style={styles.sheetRows}>
            <View style={styles.sheetRow}>
              <Animated.View style={{ opacity: check1Anim }}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              </Animated.View>
              <View style={[styles.skeletonLine, { width: 78, backgroundColor: skeletonColor }]} />
            </View>

            <View style={styles.sheetRow}>
              <Animated.View style={{ opacity: check2Anim }}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              </Animated.View>
              <View style={[styles.skeletonLine, { width: 56, backgroundColor: skeletonColor }]} />
            </View>

            <View style={styles.sheetRow}>
              <Animated.View style={{ opacity: check3Anim }}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              </Animated.View>
              <View style={[styles.skeletonLine, { width: 68, backgroundColor: skeletonColor }]} />
            </View>
          </View>

          {/* Smooth Horizontal Scan Shimmer Bar */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shimmerBar,
              {
                transform: [{ translateX: shimmerTranslateX }],
              },
            ]}
          />
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
    padding: 14,
    marginBottom: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  miniSheet: {
    width: 175,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  qrBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRows: {
    flex: 1,
    gap: 7,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  skeletonLine: {
    height: 5.5,
    borderRadius: 3,
  },
  shimmerBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 38,
    backgroundColor: "rgba(16, 185, 129, 0.16)",
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
