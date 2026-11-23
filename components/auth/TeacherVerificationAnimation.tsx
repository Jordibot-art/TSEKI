import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type VerificationAnimationMode =
  | "login"
  | "signup"
  | "otp"
  | "upload_docs";

export interface TeacherVerificationAnimationProps {
  visible: boolean;
  mode: VerificationAnimationMode;
  teacherName?: string;
  schoolName?: string;
  progressStatus?: string;
  accentColor?: string;
  darkMode?: boolean;
}

interface StageItem {
  title: string;
  sub: string;
  badge: string;
}

export function TeacherVerificationAnimation({
  visible,
  mode,
  teacherName = "Teacher",
  schoolName = "Basak Community School",
  progressStatus,
  accentColor = "#EA580C",
  darkMode = false,
}: TeacherVerificationAnimationProps) {
  // Vertical calibration / verification laser sweep (0 -> 1 -> 0)
  const laserAnim = useRef(new Animated.Value(0)).current;

  // 4-Corner OMR registration squares gentle breathing pulse
  const cornerPulseAnim = useRef(new Animated.Value(1)).current;

  // Status dot pulse
  const dotPulseAnim = useRef(new Animated.Value(1)).current;

  // Floating ID card subtle entrance float
  const cardFloatAnim = useRef(new Animated.Value(0)).current;

  // Continuous forward-moving progress bar
  const progressAnim = useRef(new Animated.Value(0.16)).current;
  const [percentDisplay, setPercentDisplay] = useState<number>(16);

  // Active locked row (1..4)
  const [activeRow, setActiveRow] = useState<number>(1);
  const [stageIndex, setStageIndex] = useState<number>(0);

  const stages: StageItem[] = useMemo(() => {
    if (mode === "login") {
      return [
        {
          title: "Authenticating Teacher Credentials",
          sub: "Verifying encrypted session with TSEKI Auth",
          badge: "AUTH CHECK",
        },
        {
          title: "Checking School Admin Approval",
          sub: `Confirming active faculty status at ${schoolName}`,
          badge: "FACULTY SYNC",
        },
        {
          title: "Loading Your Classrooms & AI Tools",
          sub: "Preparing quizzes, rosters, and camera grader",
          badge: "READY",
        },
      ];
    }
    if (mode === "signup") {
      return [
        {
          title: "Creating Official Teacher Profile",
          sub: `Registering ${teacherName} under ${schoolName}`,
          badge: "STEP 1 · PROFILE",
        },
        {
          title: "Indexing Grade Levels & Subjects",
          sub: "Saving teaching load and strand assignments",
          badge: "CURRICULUM",
        },
        {
          title: "Dispatching 6-Digit Security OTP",
          sub: "Sending verification code to your email inbox",
          badge: "EMAIL OTP",
        },
      ];
    }
    if (mode === "otp") {
      return [
        {
          title: "Validating 6-Digit Security Code",
          sub: "Verifying your one-time security code",
          badge: "OTP CHECK",
        },
        {
          title: "Confirming Teacher Email Identity",
          sub: "Unlocking Step 2 Physical ID & Selfie verification",
          badge: "VERIFIED",
        },
      ];
    }
    // mode === "upload_docs"
    return [
      {
        title: "Scanning Physical Teacher ID (Front)",
        sub: "Encrypting & uploading front ID card to private storage",
        badge: "ID FRONT",
      },
      {
        title: "Scanning Physical Teacher ID (Back)",
        sub: "Verifying school seal & back endorsement photo",
        badge: "ID BACK",
      },
      {
        title: "Uploading Face Verification Selfie",
        sub: "Pairing live teacher selfie with ID holder record",
        badge: "FACE SELFIE",
      },
      {
        title: "Submitting to School Administrator",
        sub: `Queuing application for ${schoolName} review`,
        badge: "ADMIN QUEUE",
      },
    ];
  }, [mode, schoolName, teacherName]);

  // Sync stage index & progress bar when live progressStatus changes during Step 2 photo upload
  useEffect(() => {
    if (!visible || mode !== "upload_docs" || !progressStatus) return;
    const lower = progressStatus.toLowerCase();
    let targetStage = 0;
    let targetProgress = 0.25;
    let targetRow = 1;

    if (lower.includes("front")) {
      targetStage = 0;
      targetProgress = 0.34;
      targetRow = 2;
    } else if (lower.includes("back")) {
      targetStage = 1;
      targetProgress = 0.62;
      targetRow = 3;
    } else if (lower.includes("selfie")) {
      targetStage = 2;
      targetProgress = 0.86;
      targetRow = 4;
    } else if (lower.includes("submitting")) {
      targetStage = 3;
      targetProgress = 0.97;
      targetRow = 4;
    }

    setStageIndex(targetStage);
    setActiveRow(targetRow);
    Animated.timing(progressAnim, {
      toValue: targetProgress,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [visible, mode, progressStatus, progressAnim]);

  useEffect(() => {
    if (!visible) return;

    setStageIndex(0);
    setActiveRow(1);
    progressAnim.setValue(0.16);
    setPercentDisplay(16);

    // 1. Continuous Calibration Laser Sweep Loop
    const laserLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1450,
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
          toValue: 1.09,
          duration: 750,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulseAnim, {
          toValue: 1.0,
          duration: 750,
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
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(dotPulseAnim, {
          toValue: 1.0,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    dotLoop.start();

    // 4. Subtle card float loop
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(cardFloatAnim, {
          toValue: -3,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(cardFloatAnim, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    floatLoop.start();

    // 5. Progress listener
    const listenerId = progressAnim.addListener(({ value }) => {
      setPercentDisplay(Math.min(99, Math.max(10, Math.round(value * 100))));
    });

    // If not driven by live upload_docs callbacks, animate smoothly on timer
    let stageTimer: ReturnType<typeof setInterval> | null = null;
    let rowTimer: ReturnType<typeof setInterval> | null = null;

    if (mode !== "upload_docs") {
      Animated.timing(progressAnim, {
        toValue: 0.95,
        duration: 2600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();

      stageTimer = setInterval(() => {
        setStageIndex((prev) => (prev < stages.length - 1 ? prev + 1 : prev));
      }, 900);

      rowTimer = setInterval(() => {
        setActiveRow((prev) => (prev >= 4 ? 1 : prev + 1));
      }, 480);
    }

    return () => {
      laserLoop.stop();
      cornerLoop.stop();
      dotLoop.stop();
      floatLoop.stop();
      progressAnim.removeListener(listenerId);
      if (stageTimer) clearInterval(stageTimer);
      if (rowTimer) clearInterval(rowTimer);
    };
  }, [
    visible,
    mode,
    stages.length,
    laserAnim,
    cornerPulseAnim,
    dotPulseAnim,
    cardFloatAnim,
    progressAnim,
  ]);

  if (!visible) return null;

  const modalCardBg = darkMode ? "#1F2937" : "#FFFFFF";
  const modalCardBorder = darkMode ? "#374151" : "#E2E8F0";
  const stageBg = darkMode ? "#111827" : "#F8FAFC";
  const stageBorder = darkMode ? "#334155" : "#E2E8F0";
  const sheetBg = darkMode ? "#0F172A" : "#FFFFFF";
  const sheetBorder = darkMode ? "#334155" : "#E2E8F0";
  const textColor = darkMode ? "#F8FAFC" : "#0F172A";
  const subTextColor = darkMode ? "#94A3B8" : "#64748B";
  const markerColor = darkMode ? "#F8FAFC" : "#0F172A";
  const skelBarBg = darkMode ? "#334155" : "#E2E8F0";

  const currentStage = stages[Math.min(stageIndex, stages.length - 1)];

  const CHECK_ROWS =
    mode === "upload_docs"
      ? [
          { num: "01", label: "ID Front Card", tag: "FRONT" },
          { num: "02", label: "ID Back Seal", tag: "BACK" },
          { num: "03", label: "Face Biometric", tag: "SELFIE" },
          { num: "04", label: "Admin Vault", tag: "LOCKED" },
        ]
      : [
          { num: "01", label: "Faculty Identity", tag: "NAME" },
          { num: "02", label: "School Scope", tag: "BCS" },
          { num: "03", label: "Teaching Load", tag: "GRADES" },
          { num: "04", label: "Security Token", tag: "AUTH" },
        ];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: modalCardBg, borderColor: modalCardBorder },
          ]}
        >
          {/* ── 1. Top Animated Stage: Scannable Teacher ID & Biometric Verification Sheet ── */}
          <View
            style={[
              styles.stageCard,
              { backgroundColor: stageBg, borderColor: stageBorder },
            ]}
          >
            <Animated.View
              style={[
                styles.paperSheet,
                {
                  backgroundColor: sheetBg,
                  borderColor: sheetBorder,
                  transform: [{ translateY: cardFloatAnim }],
                },
              ]}
            >
              {/* 4 Breathing Corner Registration Squares */}
              <Animated.View
                style={[
                  styles.cornerMarker,
                  styles.cornerTL,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              >
                <View
                  style={[styles.solidMarkerBox, { backgroundColor: markerColor }]}
                />
              </Animated.View>

              <Animated.View
                style={[
                  styles.cornerMarker,
                  styles.cornerTR,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              >
                <View
                  style={[styles.solidMarkerBox, { backgroundColor: markerColor }]}
                />
              </Animated.View>

              <Animated.View
                style={[
                  styles.cornerMarker,
                  styles.cornerBL,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              >
                <View
                  style={[styles.solidMarkerBox, { backgroundColor: markerColor }]}
                />
              </Animated.View>

              <Animated.View
                style={[
                  styles.cornerMarker,
                  styles.cornerBR,
                  { transform: [{ scale: cornerPulseAnim }] },
                ]}
              >
                <View
                  style={[styles.solidMarkerBox, { backgroundColor: markerColor }]}
                />
              </Animated.View>

              {/* Sheet Header: Verification Pill + Teacher Mini Avatar & Shield Badge */}
              <View style={styles.sheetHeader}>
                <View style={styles.idAvatarBox}>
                  <Ionicons name="person" size={14} color={accentColor} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <View
                    style={[
                      styles.masterBadge,
                      { backgroundColor: accentColor + "18" },
                    ]}
                  >
                    <Text
                      style={[styles.masterBadgeText, { color: accentColor }]}
                    >
                      {currentStage.badge}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.skeletonLine,
                      {
                        width: "82%",
                        height: 4.5,
                        marginTop: 5,
                        backgroundColor: skelBarBg,
                      },
                    ]}
                  />
                </View>
                <View style={styles.miniShieldBox}>
                  <Ionicons name="shield-checkmark" size={15} color="#10B981" />
                </View>
              </View>

              {/* 4 Scannable Verification Rows */}
              <View style={styles.keyGrid}>
                {CHECK_ROWS.map((item, idx) => {
                  const rowNum = idx + 1;
                  const isLocked = rowNum <= activeRow;
                  return (
                    <View key={item.num} style={styles.keyRow}>
                      <Text
                        style={[
                          styles.rowNumber,
                          { color: isLocked ? accentColor : subTextColor },
                        ]}
                      >
                        {item.num}
                      </Text>

                      <View
                        style={[
                          styles.checkCircle,
                          isLocked
                            ? {
                                backgroundColor: "#10B981",
                                borderColor: "#10B981",
                              }
                            : {
                                backgroundColor: darkMode
                                  ? "#1E293B"
                                  : "#F8FAFC",
                                borderColor: darkMode ? "#475569" : "#CBD5E1",
                              },
                        ]}
                      >
                        {isLocked ? (
                          <Ionicons
                            name="checkmark"
                            size={9}
                            color="#FFFFFF"
                          />
                        ) : (
                          <View style={styles.pendingDot} />
                        )}
                      </View>

                      <Text
                        style={[
                          styles.rowLabelText,
                          {
                            color: isLocked ? textColor : subTextColor,
                            fontWeight: isLocked ? "700" : "500",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>

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
                          {item.tag}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Sweeping Glowing Calibration Laser Beam Overlay */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.laserBar,
                  {
                    backgroundColor: accentColor,
                    shadowColor: accentColor,
                    transform: [
                      {
                        translateY: laserAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [10, 162],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    styles.laserTrail,
                    { backgroundColor: accentColor + "24" },
                  ]}
                />
              </Animated.View>
            </Animated.View>
          </View>

          {/* ── 2. Typography Block ── */}
          <View style={styles.statusArea}>
            <View style={styles.stageTitleRow}>
              <Animated.View
                style={[
                  styles.pulseDot,
                  { backgroundColor: accentColor, opacity: dotPulseAnim },
                ]}
              />
              <Text style={[styles.stageTitle, { color: textColor }]}>
                {progressStatus || currentStage.title}
              </Text>
            </View>
            <Text style={[styles.stageSub, { color: subTextColor }]}>
              {currentStage.sub}
            </Text>
          </View>

          {/* ── 3. Smooth Continuous Progress Bar + Step & Percentage Row ── */}
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: darkMode ? "#334155" : "#F1F5F9" },
            ]}
          >
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
              Step {Math.min(stageIndex + 1, stages.length)} of {stages.length}
            </Text>
            <Text style={[styles.percentText, { color: textColor }]}>
              {percentDisplay}%
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  modalCard: {
    width: "100%",
    maxWidth: 345,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
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
    width: 236,
    height: 176,
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
    marginBottom: 10,
  },
  idAvatarBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    alignItems: "center",
    justifyContent: "center",
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
  miniShieldBox: {
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
    paddingHorizontal: 12,
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
    width: 15,
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
  rowLabelText: {
    fontSize: 10.5,
    flex: 1,
  },
  keyPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  keyPillText: {
    fontSize: 8,
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
