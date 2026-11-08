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
  difficulty = "Medium",
  questionType = "Multiple Choice",
  isAiBusy = false,
  statusMessage,
  accentColor = "#EA580C",
  darkMode = false,
}: AssessmentGeneratingAnimationProps) {
  // Floating question card slide + opacity + scale (from animation1.mp4)
  const cardSlideAnim = useRef(new Animated.Value(10)).current;
  const cardOpacityAnim = useRef(new Animated.Value(0.45)).current;

  // Sweeping AI synthesis beam across the question card
  const sweepAnim = useRef(new Animated.Value(0)).current;

  // Status dot pulse
  const dotPulseAnim = useRef(new Animated.Value(1)).current;

  // Continuous forward-moving progress bar (never resets backwards)
  const progressAnim = useRef(new Animated.Value(0.08)).current;
  const [percentDisplay, setPercentDisplay] = useState<number>(8);

  // Question counter shown inside the animated card (1..5)
  const [questionNum, setQuestionNum] = useState<number>(1);

  // Dynamic stages (advances 0 -> 1 -> 2 -> 3 and holds on final stage)
  const [stageIndex, setStageIndex] = useState<number>(0);

  const STAGES = [
    {
      title: "Analyzing Curriculum & Lesson Materials",
      sub: "Aligning with DepEd Bloom's Taxonomy standards",
    },
    {
      title: "Crafting Higher-Order Thinking Questions",
      sub: `Formulating ${questionCount} tailored for ${difficulty} level`,
    },
    {
      title: "Generating Plausible Distractors & Keys",
      sub: "Building fair, misconception-tested answer choices",
    },
    {
      title: "Formatting Scannable Test Paper Grid",
      sub: "Embedding 4-corner markers & verification blocks",
    },
  ];

  const isSuccess = Boolean(
    statusMessage && statusMessage.toLowerCase().includes("successfully")
  );

  useEffect(() => {
    // 1. Floating Question Card Animation Loop (exact animation1.mp4 card float & transition)
    const cardLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(cardSlideAnim, {
            toValue: 0,
            duration: 650,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacityAnim, {
            toValue: 1,
            duration: 650,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(1450),
        Animated.parallel([
          Animated.timing(cardSlideAnim, {
            toValue: -7,
            duration: 500,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacityAnim, {
            toValue: 0.38,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(cardSlideAnim, {
          toValue: 10,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    cardLoop.start();

    // 2. Sweeping AI Synthesis Beam Loop
    const sweepLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweepAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sweepAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    sweepLoop.start();

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

    // 4. Smooth Continuous Progress Bar Fill (8% -> 95% without ever looping backwards)
    const listenerId = progressAnim.addListener(({ value }) => {
      setPercentDisplay(Math.round(value * 100));
    });

    Animated.timing(progressAnim, {
      toValue: 0.95,
      duration: 11500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // 5. Cycle Question Card Badge (Question 1 -> Question 2 -> Question 3...)
    const qTimer = setInterval(() => {
      setQuestionNum((prev) => (prev >= 5 ? 1 : prev + 1));
    }, 2600);

    // 6. Advance Stages sequentially (holds on final stage so it never jumps back to Step 1)
    const stageTimer = setInterval(() => {
      setStageIndex((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 2700);

    return () => {
      cardLoop.stop();
      sweepLoop.stop();
      dotLoop.stop();
      progressAnim.removeListener(listenerId);
      clearInterval(qTimer);
      clearInterval(stageTimer);
    };
  }, [cardSlideAnim, cardOpacityAnim, sweepAnim, dotPulseAnim, progressAnim]);

  // Snap to 100% smoothly when assessment finishes generating
  useEffect(() => {
    if (isSuccess) {
      setStageIndex(STAGES.length - 1);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    }
  }, [isSuccess, progressAnim]);

  const activeColor = isSuccess ? "#10B981" : isAiBusy ? "#F59E0B" : accentColor;
  const stageBg = darkMode ? "#1E293B" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const cardBg = darkMode ? "#0F172A" : "#FFFFFF";
  const cardBorder = darkMode ? "#334155" : "#E2E8F0";
  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const skelBarBg = darkMode ? "#334155" : "#E2E8F0";

  const currentStage = STAGES[stageIndex];
  const greenOptionIdx = questionNum % 2 === 1 ? 1 : 0; // alternates between B and A

  return (
    <View style={styles.container}>
      {/* ── 1. Top Animated Stage: Rich Floating Question Card Preview (animation1.mp4) ── */}
      <View style={[styles.stageCard, { backgroundColor: stageBg, borderColor: stageBorder }]}>
        {/* Subtle Stacked Back Card Silhouette */}
        <View
          style={[
            styles.backDeckCard,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
            },
          ]}
        />

        {/* Floating Simulated Question Card */}
        <Animated.View
          style={[
            styles.previewQuestionCard,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
              opacity: cardOpacityAnim,
              transform: [{ translateY: cardSlideAnim }],
            },
          ]}
        >
          {/* Card Header: Question Pill + Point Badge */}
          <View style={styles.questionHeaderRow}>
            <View style={[styles.questionTag, { backgroundColor: activeColor + "18" }]}>
              <Ionicons name="sparkles" size={10} color={activeColor} />
              <Text style={[styles.questionTagText, { color: activeColor }]}>
                {isAiBusy ? "Retrying" : `Question ${questionNum}`}
              </Text>
            </View>
            <View style={styles.questionHeaderRight}>
              <View style={[styles.skeletonText, { width: 38, height: 6, backgroundColor: activeColor + "38" }]} />
              <View style={styles.ptBadge}>
                <Text style={styles.ptBadgeText}>1 pt</Text>
              </View>
            </View>
          </View>

          {/* Question Stem Skeleton Lines */}
          <View style={[styles.skeletonText, { width: "94%", height: 6.5, marginTop: 9, backgroundColor: skelBarBg }]} />
          <View style={[styles.skeletonText, { width: "70%", height: 6.5, marginTop: 5, backgroundColor: skelBarBg }]} />

          {/* Simulated Multiple Choice Options (A, B, C with Green Key Checkmark) */}
          <View style={styles.optionsList}>
            {["A", "B", "C"].map((letter, idx) => {
              const isCorrect = idx === greenOptionIdx;
              const barWidths: ("54%" | "66%" | "48%")[] = ["54%", "66%", "48%"];
              return (
                <View
                  key={letter}
                  style={[
                    styles.optionRow,
                    isCorrect && {
                      backgroundColor: "rgba(16, 185, 129, 0.08)",
                      borderColor: "rgba(16, 185, 129, 0.28)",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.optionDot,
                      isCorrect
                        ? { backgroundColor: "#10B981", borderColor: "#10B981" }
                        : {
                            backgroundColor: darkMode ? "#1E293B" : "#F8FAFC",
                            borderColor: darkMode ? "#475569" : "#CBD5E1",
                          },
                    ]}
                  >
                    {isCorrect ? (
                      <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                    ) : (
                      <Text style={[styles.optionLetter, { color: subTextColor }]}>{letter}</Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.skeletonText,
                      {
                        width: barWidths[idx],
                        height: 5.5,
                        backgroundColor: isCorrect
                          ? "rgba(16, 185, 129, 0.45)"
                          : skelBarBg,
                      },
                    ]}
                  />
                  {isCorrect && (
                    <Text style={styles.keyLabel}>Key ✓</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Sweeping AI Synthesis Beam Overlay */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sweepBar,
              {
                backgroundColor: activeColor,
                shadowColor: activeColor,
                transform: [
                  {
                    translateY: sweepAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [6, 146],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.sweepTrail, { backgroundColor: activeColor + "18" }]} />
          </Animated.View>
        </Animated.View>
      </View>

      {/* ── 2. Status Text & Stages (Full Wrapping Subtitle — Never Truncated) ── */}
      <View style={styles.statusArea}>
        <View style={styles.stageTitleRow}>
          <Animated.View
            style={[
              styles.pulseDot,
              { backgroundColor: activeColor, opacity: dotPulseAnim },
            ]}
          />
          <Text style={[styles.stageHeading, { color: textColor }]}>
            {isAiBusy ? "AI Server Busy — Auto-Retrying" : currentStage.title}
          </Text>
        </View>
        <Text
          style={[
            styles.stageSubtitle,
            {
              color: isSuccess
                ? "#10B981"
                : isAiBusy
                ? "#D97706"
                : subTextColor,
              fontWeight: isSuccess ? "600" : "400",
            },
          ]}
        >
          {statusMessage ||
            (isAiBusy
              ? "Waiting with exponential backoff before engaging backup model..."
              : currentStage.sub)}
        </Text>
      </View>

      {/* ── 3. Smooth Continuous Progress Bar + Step & Live Percentage Row ── */}
      <View style={[styles.progressTrack, { backgroundColor: darkMode ? "#334155" : "#F1F5F9" }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: activeColor,
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
        <Text style={[styles.percentText, { color: isSuccess ? "#10B981" : textColor }]}>
          {isSuccess ? "100%" : `${percentDisplay}%`}
        </Text>
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
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 12,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  backDeckCard: {
    position: "absolute",
    top: 11,
    width: 212,
    height: 146,
    borderRadius: 12,
    borderWidth: 1,
    opacity: 0.55,
  },
  previewQuestionCard: {
    width: 232,
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
  questionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  questionTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  questionTagText: {
    fontSize: 10,
    fontWeight: "800",
  },
  questionHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ptBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  ptBadgeText: {
    fontSize: 8.5,
    fontWeight: "800",
    color: "#10B981",
  },
  skeletonText: {
    borderRadius: 3,
  },
  optionsList: {
    marginTop: 9,
    gap: 5,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  optionDot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLetter: {
    fontSize: 7.5,
    fontWeight: "700",
  },
  keyLabel: {
    marginLeft: "auto",
    fontSize: 8.5,
    fontWeight: "800",
    color: "#10B981",
  },
  sweepBar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.75,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  sweepTrail: {
    position: "absolute",
    top: 2,
    left: 0,
    right: 0,
    height: 12,
  },
  statusArea: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: 14,
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
  stageHeading: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
    textAlign: "center",
    flexShrink: 1,
  },
  stageSubtitle: {
    fontSize: 12.5,
    textAlign: "center",
    lineHeight: 17,
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
