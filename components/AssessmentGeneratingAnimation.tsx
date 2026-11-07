import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface AssessmentGeneratingAnimationProps {
  topicOrSubject?: string;
  questionCount?: string;
  difficulty?: string;
  questionType?: string;
  isAiBusy?: boolean;
  statusMessage?: string;
  accentColor?: string;
  darkMode?: boolean;
}

export function AssessmentGeneratingAnimation({
  topicOrSubject = "Lesson",
  questionCount = "10 Items",
  difficulty = "Average",
  questionType = "Multiple Choice",
  isAiBusy = false,
  statusMessage,
  accentColor = "#F97316",
  darkMode = false,
}: AssessmentGeneratingAnimationProps) {
  // Pulsing scale and glow for the center AI core
  const coreScaleAnim = useRef(new Animated.Value(1)).current;
  const pulseRingAnim = useRef(new Animated.Value(0)).current;

  // Rotation animation for sparkles
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Progress bar fill (0% -> 95%)
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Floating question card slide-in
  const cardSlideAnim = useRef(new Animated.Value(10)).current;
  const cardOpacityAnim = useRef(new Animated.Value(0.4)).current;

  // Dynamic stages
  const [stageIndex, setStageIndex] = useState(0);
  const STAGES = [
    { title: "Analyzing Curriculum & Lesson Materials", sub: "Aligning with DepEd Bloom's Taxonomy standards" },
    { title: "Crafting Higher-Order Thinking Questions", sub: `Formulating ${questionCount} tailored for ${difficulty} level` },
    { title: "Generating Plausible Distractors & Keys", sub: "Building fair, misconception-tested multiple choices" },
    { title: "Formatting Scannable Test Paper Grid", sub: "Embedding 4 corner markers & answer verification blocks" },
  ];

  useEffect(() => {
    // 1. Core Pulsing Loop
    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coreScaleAnim, {
          toValue: 1.1,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(coreScaleAnim, {
          toValue: 1.0,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    coreLoop.start();

    // 2. Concentric Ring Pulse Loop
    const ringLoop = Animated.loop(
      Animated.timing(pulseRingAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    ringLoop.start();

    // 3. Continuous Sparkles Spin
    const spinLoop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinLoop.start();

    // 4. Progress Bar Animation
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 12000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 5. Question Card Floating Animation
    const cardLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(cardSlideAnim, {
            toValue: 0,
            duration: 800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacityAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(1600),
        Animated.parallel([
          Animated.timing(cardSlideAnim, {
            toValue: -8,
            duration: 600,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacityAnim, {
            toValue: 0.35,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(cardSlideAnim, {
          toValue: 12,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    cardLoop.start();

    // 6. Stage Rotator
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STAGES.length);
    }, 2800);

    return () => {
      coreLoop.stop();
      ringLoop.stop();
      spinLoop.stop();
      cardLoop.stop();
      clearInterval(stageTimer);
    };
  }, [coreScaleAnim, pulseRingAnim, spinAnim, progressAnim, cardSlideAnim, cardOpacityAnim]);

  const activeColor = isAiBusy ? "#F59E0B" : accentColor;
  const textColor = darkMode ? "#F9FAFB" : "#111827";
  const subTextColor = darkMode ? "#9CA3AF" : "#6B7280";
  const cardBg = darkMode ? "#1F2937" : "#F3F4F6";

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.container}>
      {/* ── Central Pulsing AI Core & Concentric Rings ── */}
      <View style={styles.coreWrapper}>
        {/* Outer Expanding Pulse Ring */}
        <Animated.View
          style={[
            styles.pulseRing,
            {
              borderColor: activeColor,
              opacity: pulseRingAnim.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [0.6, 0.2, 0],
              }),
              transform: [
                {
                  scale: pulseRingAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1.8],
                  }),
                },
              ],
            },
          ]}
        />

        {/* Orbiting Rotating Sparkles */}
        <Animated.View style={[styles.orbitingWrapper, { transform: [{ rotate: spin }] }]}>
          <View style={[styles.orbitSparkle, { top: -6, left: 34 }]}>
            <Ionicons name="sparkles" size={14} color={activeColor} />
          </View>
          <View style={[styles.orbitSparkle, { bottom: -6, right: 34 }]}>
            <Ionicons name="sparkles" size={12} color="#10B981" />
          </View>
        </Animated.View>

        {/* Pulsing Core Badge */}
        <Animated.View
          style={[
            styles.coreCircle,
            { backgroundColor: activeColor, transform: [{ scale: coreScaleAnim }] },
          ]}
        >
          <Ionicons
            name={isAiBusy ? "hourglass-outline" : "sparkles"}
            size={30}
            color="#FFFFFF"
          />
        </Animated.View>
      </View>

      {/* ── Floating Simulated Question Card Preview ── */}
      <Animated.View
        style={[
          styles.previewQuestionCard,
          {
            backgroundColor: cardBg,
            borderColor: darkMode ? "#374151" : "#E5E7EB",
            opacity: cardOpacityAnim,
            transform: [{ translateY: cardSlideAnim }],
          },
        ]}
      >
        <View style={styles.questionHeaderRow}>
          <View style={[styles.questionTag, { backgroundColor: activeColor + "1E" }]}>
            <Text style={[styles.questionTagText, { color: activeColor }]}>
              {isAiBusy ? "Retrying" : `Question ${(stageIndex % 3) + 1}`}
            </Text>
          </View>
          <View style={[styles.skeletonText, { width: 45, height: 6, backgroundColor: activeColor + "40" }]} />
        </View>

        <View style={[styles.skeletonText, { width: "95%", height: 7, marginTop: 8 }]} />
        <View style={[styles.skeletonText, { width: "70%", height: 7, marginTop: 5 }]} />

        {/* Simulated Multiple Choice Options */}
        <View style={styles.optionRow}>
          <View style={styles.optionDot} />
          <View style={[styles.skeletonText, { width: "50%", height: 6 }]} />
        </View>
        <View style={styles.optionRow}>
          <View style={[styles.optionDot, { backgroundColor: "#10B981" }]} />
          <View style={[styles.skeletonText, { width: "60%", height: 6 }]} />
        </View>
      </Animated.View>

      {/* ── Status Text & Stages ── */}
      <View style={styles.statusArea}>
        <Text style={[styles.stageHeading, { color: textColor }]}>
          {isAiBusy ? "AI Server Busy — Auto-Retrying" : STAGES[stageIndex].title}
        </Text>
        <Text style={[styles.stageSubtitle, { color: isAiBusy ? "#D97706" : subTextColor }]}>
          {statusMessage || (isAiBusy
            ? "Waiting with exponential backoff before engaging backup model..."
            : STAGES[stageIndex].sub)}
        </Text>
      </View>

      {/* ── Meta Parameters Pill ── */}
      <View style={[styles.metaPill, { backgroundColor: cardBg }]}>
        <Ionicons name="school-outline" size={13} color={activeColor} />
        <Text style={[styles.metaPillText, { color: subTextColor }]} numberOfLines={1}>
          {topicOrSubject} • {questionCount} • {difficulty}
        </Text>
      </View>

      {/* ── Progress Bar Track ── */}
      <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#374151" : "#E5E7EB" }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: activeColor,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["10%", "96%"],
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
    paddingVertical: 6,
  },
  coreWrapper: {
    width: 90,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    position: "relative",
  },
  pulseRing: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
  },
  orbitingWrapper: {
    position: "absolute",
    width: 90,
    height: 90,
  },
  orbitSparkle: {
    position: "absolute",
  },
  coreCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  previewQuestionCard: {
    width: "92%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  questionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  questionTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  questionTagText: {
    fontSize: 10,
    fontWeight: "800",
  },
  skeletonText: {
    borderRadius: 3,
    backgroundColor: "#9CA3AF40",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  optionDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "#9CA3AF60",
  },
  statusArea: {
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  stageHeading: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
    marginBottom: 4,
  },
  stageSubtitle: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 14,
  },
  metaPillText: {
    fontSize: 11.5,
    fontWeight: "600",
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
