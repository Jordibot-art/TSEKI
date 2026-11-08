import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";

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
  difficulty = "Medium",
  questionType = "Multiple Choice",
  isAiBusy = false,
  statusMessage,
  accentColor = "#EA580C",
  darkMode = false,
}: AssessmentGeneratingAnimationProps) {
  // Skeleton opacity pulse animation (0.4 <-> 1.0)
  const skeletonPulseAnim = useRef(new Animated.Value(0.4)).current;

  // Progress bar fill
  const progressAnim = useRef(new Animated.Value(0.35)).current;

  // Question pill index
  const [stageIndex, setStageIndex] = useState(0);

  const STAGES = [
    {
      title: "Analyzing Curriculum & Materials",
      sub: "Aligning with DepEd Bloom's Taxonomy standards",
      progress: 0.35,
      percentText: "35%",
      questionLabel: "Question 1",
    },
    {
      title: "Crafting Higher-Order Questions",
      sub: `Formulating ${questionCount} tailored for ${difficulty} level`,
      progress: 0.7,
      percentText: "70%",
      questionLabel: "Question 2",
    },
    {
      title: "Formatting Scannable Paper Layout",
      sub: "Embedding 4-corner markers & answer verification blocks",
      progress: 1.0,
      percentText: "100%",
      questionLabel: "Question 3",
    },
  ];

  useEffect(() => {
    // 1. Smooth skeleton pulse loop
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(skeletonPulseAnim, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(skeletonPulseAnim, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    // 2. Stage progression and progress bar fill
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
    }, 2500);

    return () => {
      pulseLoop.stop();
      clearInterval(stageTimer);
    };
  }, []);

  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const skeletonColor = darkMode ? "#334155" : "#E2E8F0";

  const currentStage = STAGES[stageIndex];

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Animated Skeleton Question Card ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        <View style={styles.skeletonCardInner}>
          {/* Question Number Pill */}
          <View style={styles.questionPill}>
            <Text style={styles.questionPillText}>
              {isAiBusy ? "Retrying" : currentStage.questionLabel}
            </Text>
          </View>

          {/* 3 Shimmering Skeleton Bars */}
          <Animated.View style={[styles.skeletonBarsWrapper, { opacity: skeletonPulseAnim }]}>
            <View style={[styles.skeletonBar, { width: "92%", backgroundColor: skeletonColor }]} />
            <View style={[styles.skeletonBar, { width: "75%", backgroundColor: skeletonColor }]} />
            <View style={[styles.skeletonBar, { width: "55%", backgroundColor: skeletonColor }]} />
          </Animated.View>
        </View>
      </View>

      {/* ── 2. Typography Block (Centered, No Floating Left Dot) ── */}
      <View style={styles.typographyBlock}>
        <Text style={[styles.stageTitle, { color: textColor }]}>
          {isAiBusy ? "AI Server Busy — Retrying" : currentStage.title}
        </Text>
        <Text style={[styles.stageSubtitle, { color: isAiBusy ? "#D97706" : subTextColor }]} numberOfLines={1}>
          {statusMessage || (isAiBusy
            ? "Waiting with backoff before engaging backup model..."
            : currentStage.sub)}
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
        <Text style={[styles.percentText, { color: textColor }]}>
          {currentStage.percentText}
        </Text>
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
    justifyContent: "center",
  },
  skeletonCardInner: {
    width: "100%",
    justifyContent: "center",
  },
  questionPill: {
    backgroundColor: "#0F172A",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 10,
  },
  questionPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  skeletonBarsWrapper: {
    width: "100%",
    gap: 7,
  },
  skeletonBar: {
    height: 7.5,
    borderRadius: 4,
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
