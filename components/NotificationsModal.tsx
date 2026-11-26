import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import {
  ALERT_THRESHOLD_PRESETS,
  AlertPreferences,
  AlertSeverity,
  buildAlertCardSummary,
  DEFAULT_ALERT_PREFERENCES,
  formatAlertTimeLabel,
  getCriticalCutoff,
  PASSING_GRADE,
  RosterAlert,
  saveAlertPreferences,
} from "../lib/alertStore";
import {
  getSkeuoPalette,
  skeuoButtonStyle,
  skeuoCardStyle,
  skeuoGrooveStyle,
  skeuoWellStyle,
} from "./skeuoTheme";
import { SkeuoToast } from "./SkeuoToast";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  /** "global" on Homepage (shows classroom pills & classroom filters); "classroom" inside a specific class */
  scope: "global" | "classroom";
  /** Optional classroom name when scope === "classroom" */
  classroomName?: string;
  alerts: RosterAlert[];
  dismissedAlerts?: RosterAlert[];
  preferences?: AlertPreferences;
  /** Optional classroom ID to pre-select when opened from a classroom card's FLAGGED badge */
  initialClassroomFilter?: string | null;
  onAlertPress: (alert: RosterAlert) => void;
  onRemedialQuizPress?: (alert: RosterAlert) => void;
  onDismissAlert: (alert: RosterAlert) => Promise<void> | void;
  onRestoreAlerts?: (alerts: RosterAlert[]) => Promise<void> | void;
  onMarkAllRead: () => Promise<void> | void;
  onClearAll: () => Promise<void> | void;
  onPreferencesChange?: (prefs: AlertPreferences) => void;
}

type FilterTab = "ALL" | "UNREAD" | "HIGH RISK" | "URGENT REVIEW" | "SCORE DROP" | "NEEDS SUPPORT" | "DISMISSED";

// ── Theme & Severity Helpers ──────────────────────────────────────────────────

const ORANGE = "#EA580C";
const SCREEN_HEIGHT = Dimensions.get("window").height;

function triggerHaptic(style: "light" | "medium" | "selection" = "light") {
  if (Platform.OS === "web") return;
  try {
    if (style === "selection") {
      Haptics.selectionAsync().catch(() => {});
    } else if (style === "medium") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  } catch {
    // Haptics unavailable
  }
}

function getStudentInitials(fullName: string): string {
  const clean = (fullName || "S").trim();
  if (!clean) return "S";
  if (clean.includes(",")) {
    const [lastPart, restPart] = clean.split(",").map((p) => p.trim());
    const firstWord = (restPart || "").split(/\s+/).filter(Boolean)[0] || "";
    const lastWord = (lastPart || "").split(/\s+/).filter(Boolean)[0] || "";
    const letters = `${firstWord[0] || ""}${lastWord[0] || ""}`.toUpperCase();
    return letters || clean.slice(0, 2).toUpperCase();
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function getSeverityVisuals(severity: AlertSeverity, darkMode: boolean) {
  switch (severity) {
    case "HIGH RISK":
      return {
        label: "Critical",
        icon: "alert-circle" as const,
        primary: darkMode ? "#FCA5A5" : "#B91C1C",
        led: "#EF4444",
        softBg: darkMode ? "#2E1417" : "#FBECEB",
        softBorder: darkMode ? "#6E2830" : "#E8B0AA",
        socketBg: darkMode ? "#220E11" : "#F6D7D4",
        barColor: darkMode ? "#EF4444" : "#DC2626",
        metricLabel: "AVG",
      };
    case "URGENT REVIEW":
      return {
        label: "At-Risk",
        icon: "warning" as const,
        primary: darkMode ? "#FCD34D" : "#B45309",
        led: "#F59E0B",
        softBg: darkMode ? "#2B1F0D" : "#FDF3DF",
        softBorder: darkMode ? "#6C4A15" : "#E6C27A",
        socketBg: darkMode ? "#1F1608" : "#F8E4BC",
        barColor: darkMode ? "#F59E0B" : "#D97706",
        metricLabel: "AVG",
      };
    case "SCORE DROP":
      return {
        label: "Score Drop",
        icon: "trending-down" as const,
        primary: darkMode ? "#DDD6FE" : "#6D28D9",
        led: "#8B5CF6",
        softBg: darkMode ? "#23173B" : "#F3EEFD",
        softBorder: darkMode ? "#52328C" : "#CBB8F4",
        socketBg: darkMode ? "#19102C" : "#E7DCFA",
        barColor: darkMode ? "#8B5CF6" : "#7C3AED",
        metricLabel: "QUIZ",
      };
    case "NEEDS SUPPORT":
    default:
      return {
        label: "Watchlist",
        icon: "flag" as const,
        primary: darkMode ? "#93C5FD" : "#1D4ED8",
        led: "#3B82F6",
        softBg: darkMode ? "#13213B" : "#EAF1FD",
        softBorder: darkMode ? "#25457A" : "#AEC7F4",
        socketBg: darkMode ? "#0D182C" : "#D8E6FB",
        barColor: darkMode ? "#3B82F6" : "#2563EB",
        metricLabel: "AVG",
      };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationsModal({
  visible,
  onClose,
  scope,
  classroomName,
  alerts,
  dismissedAlerts = [],
  preferences = DEFAULT_ALERT_PREFERENCES,
  initialClassroomFilter = null,
  onAlertPress,
  onRemedialQuizPress,
  onDismissAlert,
  onRestoreAlerts,
  onMarkAllRead,
  onClearAll,
  onPreferencesChange,
}: NotificationsModalProps) {
  const { darkMode, themeColor } = useTheme();
  const insets = useSafeAreaInsets();
  const skeuo = getSkeuoPalette(darkMode, themeColor || ORANGE);

  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(visible);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(
    initialClassroomFilter
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<AlertPreferences>(preferences);

  // Undo snackbar state
  const [undoPayload, setUndoPayload] = useState<{
    message: string;
    alerts: RosterAlert[];
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const backdropAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(SCREEN_HEIGHT * 0.6)).current;

  useEffect(() => {
    setLocalPrefs(preferences);
  }, [preferences]);

  useEffect(() => {
    if (visible) {
      setSelectedClassroomId(initialClassroomFilter ?? null);
      setActiveFilter("ALL");
      setSettingsOpen(false);
      mountedRef.current = true;
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(sheetAnim, {
          toValue: 0,
          damping: 26,
          stiffness: 260,
          mass: 0.9,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mountedRef.current) {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(sheetAnim, {
          toValue: SCREEN_HEIGHT * 0.6,
          duration: 190,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          mountedRef.current = false;
          setMounted(false);
          setUndoPayload(null);
        }
      });
    }
  }, [visible, initialClassroomFilter, backdropAnim, sheetAnim]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // ── Derived Counts & Classroom Options ────────────────────────────────────
  const unreadCount = useMemo(
    () => alerts.filter((a) => !a.isRead).length,
    [alerts]
  );

  const severityCounts = useMemo(() => {
    const counts = {
      highRisk: 0,
      urgentReview: 0,
      scoreDrop: 0,
      needsSupport: 0,
    };
    for (const a of alerts) {
      if (a.alertType === "HIGH RISK") counts.highRisk += 1;
      else if (a.alertType === "URGENT REVIEW") counts.urgentReview += 1;
      else if (a.alertType === "SCORE DROP") counts.scoreDrop += 1;
      else if (a.alertType === "NEEDS SUPPORT") counts.needsSupport += 1;
    }
    return counts;
  }, [alerts]);

  const classroomOptions = useMemo(() => {
    if (scope !== "global") return [];
    const map = new Map<
      string,
      { id: string; title: string; color: string; count: number }
    >();
    for (const a of alerts) {
      const existing = map.get(a.classroomId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(a.classroomId, {
          id: a.classroomId,
          title: a.classroomTitle,
          color: a.classroomColor || ORANGE,
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [alerts, scope]);

  // Reset filter if current filter tab no longer has items (except ALL / DISMISSED)
  useEffect(() => {
    if (activeFilter === "UNREAD" && unreadCount === 0) setActiveFilter("ALL");
    else if (activeFilter === "HIGH RISK" && severityCounts.highRisk === 0)
      setActiveFilter("ALL");
    else if (activeFilter === "URGENT REVIEW" && severityCounts.urgentReview === 0)
      setActiveFilter("ALL");
    else if (activeFilter === "SCORE DROP" && severityCounts.scoreDrop === 0)
      setActiveFilter("ALL");
    else if (activeFilter === "NEEDS SUPPORT" && severityCounts.needsSupport === 0)
      setActiveFilter("ALL");
    else if (activeFilter === "DISMISSED" && dismissedAlerts.length === 0)
      setActiveFilter("ALL");
  }, [activeFilter, unreadCount, severityCounts, dismissedAlerts.length]);

  const displayedAlerts = useMemo(() => {
    if (activeFilter === "DISMISSED") {
      if (scope === "global" && selectedClassroomId) {
        return dismissedAlerts.filter((a) => a.classroomId === selectedClassroomId);
      }
      return dismissedAlerts;
    }

    return alerts.filter((a) => {
      if (scope === "global" && selectedClassroomId && a.classroomId !== selectedClassroomId) {
        return false;
      }
      if (activeFilter === "UNREAD") return !a.isRead;
      if (activeFilter === "ALL") return true;
      return a.alertType === activeFilter;
    });
  }, [alerts, dismissedAlerts, activeFilter, selectedClassroomId, scope]);

  // ── Undo Helper ───────────────────────────────────────────────────────────
  function showUndoSnackbar(message: string, dismissedList: RosterAlert[]) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoPayload({ message, alerts: dismissedList });
    undoTimerRef.current = setTimeout(() => {
      setUndoPayload(null);
    }, 4500);
  }

  async function handleSingleDismiss(alert: RosterAlert) {
    triggerHaptic("light");
    await onDismissAlert(alert);
    showUndoSnackbar(`Dismissed ${alert.studentName}`, [alert]);
  }

  async function handleClearAllPress() {
    if (alerts.length === 0) return;
    triggerHaptic("medium");
    const snapshot = [...alerts];
    await onClearAll();
    showUndoSnackbar(
      snapshot.length === 1
        ? `Dismissed ${snapshot[0].studentName}`
        : `Dismissed ${snapshot.length} alerts`,
      snapshot
    );
  }

  async function handleUndoPress() {
    if (!undoPayload || !onRestoreAlerts) return;
    triggerHaptic("selection");
    const toRestore = undoPayload.alerts;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoPayload(null);
    await onRestoreAlerts(toRestore);
  }

  async function handleRestoreSingle(alert: RosterAlert) {
    if (!onRestoreAlerts) return;
    triggerHaptic("selection");
    await onRestoreAlerts([alert]);
  }

  async function handleRestoreAllDismissed() {
    if (!onRestoreAlerts || dismissedAlerts.length === 0) return;
    triggerHaptic("selection");
    await onRestoreAlerts(dismissedAlerts);
    setActiveFilter("ALL");
  }

  async function handleUpdatePrefs(partial: Partial<AlertPreferences>) {
    triggerHaptic("selection");
    const updated = await saveAlertPreferences(partial);
    setLocalPrefs(updated);
    onPreferencesChange?.(updated);
  }

  // ── Skeuomorphic Hardware Surface Colors ──────────────────────────────────
  const sheetBg = skeuo.chrome;
  const bodySurface = skeuo.canvas;
  const cardBg = skeuo.surface;
  const readCardBg = skeuo.surfaceMuted;
  const textMain = skeuo.textPrimary;
  const textSub = skeuo.textSecondary;
  const border = skeuo.border;
  const cardBorder = skeuo.borderStrong;
  const subtlePillBg = skeuo.well;
  const criticalCutoff = getCriticalCutoff(localPrefs.atRiskThreshold);

  const filterChips: {
    key: FilterTab;
    label: string;
    count: number;
    dotColor?: string;
  }[] = [
    { key: "ALL", label: "All", count: alerts.length },
    ...(unreadCount > 0
      ? [{ key: "UNREAD" as const, label: "Unread", count: unreadCount, dotColor: ORANGE }]
      : []),
    ...(severityCounts.highRisk > 0
      ? [{ key: "HIGH RISK" as const, label: "Critical", count: severityCounts.highRisk, dotColor: "#DC2626" }]
      : []),
    ...(severityCounts.urgentReview > 0
      ? [{ key: "URGENT REVIEW" as const, label: "At-Risk", count: severityCounts.urgentReview, dotColor: "#D97706" }]
      : []),
    ...(severityCounts.scoreDrop > 0
      ? [{ key: "SCORE DROP" as const, label: "Drops", count: severityCounts.scoreDrop, dotColor: "#7C3AED" }]
      : []),
    ...(severityCounts.needsSupport > 0
      ? [{ key: "NEEDS SUPPORT" as const, label: "Watchlist", count: severityCounts.needsSupport, dotColor: "#2563EB" }]
      : []),
    ...(dismissedAlerts.length > 0
      ? [{ key: "DISMISSED" as const, label: "Dismissed", count: dismissedAlerts.length }]
      : []),
  ];

  const subtitleText =
    scope === "classroom"
      ? `${classroomName || "Classroom"} · Flagged ≤${localPrefs.atRiskThreshold}%`
      : alerts.length > 0
        ? `${alerts.length} active · Flagged ≤${localPrefs.atRiskThreshold}%`
        : `Monitoring all classes · ≤${localPrefs.atRiskThreshold}% threshold`;

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        {/* Animated Full-Screen Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            {
              backgroundColor: skeuo.backdrop,
              opacity: backdropAnim,
            },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={onClose}
            accessibilityLabel="Close notifications"
          />
        </Animated.View>

        {/* Bottom Sheet Machined Hardware Housing */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: sheetBg,
              borderTopColor: skeuo.bevelTop,
              borderLeftColor: skeuo.border,
              borderRightColor: skeuo.border,
              shadowColor: skeuo.shadowColor,
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateY: sheetAnim }],
            },
          ]}
        >
          {/* Centered Recessed Drag Groove */}
          <View style={styles.dragPillWrap}>
            <View
              style={[
                styles.dragPill,
                {
                  backgroundColor: skeuo.wellDeep,
                  borderTopColor: skeuo.wellBorderTop,
                  borderBottomColor: skeuo.wellBorderBottom,
                },
              ]}
            />
          </View>

          {/* ── Sheet Header ── */}
          <View style={[styles.header, { borderBottomColor: border }]}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.headerIconBox,
                  skeuoWellStyle(skeuo, 12),
                  {
                    backgroundColor: skeuo.accentSoft,
                    borderColor: skeuo.accentSoftBorder,
                  },
                ]}
              >
                <Ionicons name="notifications" size={18} color={ORANGE} />
              </View>
              <View style={styles.headerTitleWrap}>
                <View style={styles.headerTitleRow}>
                  <Text style={[styles.headerTitle, { color: textMain }]}>
                    Roster Alerts
                  </Text>
                  {unreadCount > 0 && (
                    <View
                      style={[
                        styles.unreadPill,
                        {
                          borderTopColor: "#FB923C",
                          borderBottomColor: "#9A3412",
                        },
                      ]}
                    >
                      <Text style={styles.unreadPillText}>
                        {unreadCount} new
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[styles.headerSubtitle, { color: textSub }]}
                  numberOfLines={1}
                >
                  {subtitleText}
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  settingsOpen
                    ? skeuoButtonStyle(skeuo, {
                        fill: ORANGE,
                        highlight: "#FB923C",
                        lip: "#9A3412",
                        pressed,
                        radius: 10,
                      })
                    : skeuoButtonStyle(skeuo, {
                        neutral: true,
                        pressed,
                        radius: 10,
                      }),
                ]}
                onPress={() => {
                  triggerHaptic("selection");
                  setSettingsOpen((prev) => !prev);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Alert threshold settings"
              >
                <Ionicons
                  name="options-outline"
                  size={17}
                  color={settingsOpen ? "#FFFFFF" : textMain}
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  skeuoButtonStyle(skeuo, {
                    neutral: true,
                    pressed,
                    radius: 17,
                  }),
                ]}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close notifications"
              >
                <Ionicons name="close" size={18} color={textMain} />
              </Pressable>
            </View>
          </View>

          {/* ── Collapsible Inline Alert Preferences Tray ── */}
          {settingsOpen && (
            <View
              style={[
                styles.prefsPanel,
                {
                  backgroundColor: skeuo.tray,
                  borderBottomColor: border,
                },
              ]}
            >
              <View style={styles.prefsTopRow}>
                <Text style={[styles.prefsHeading, { color: textMain }]}>
                  At-Risk Alert Threshold
                </Text>
                <View
                  style={[
                    styles.depedPill,
                    skeuoWellStyle(skeuo, 7),
                  ]}
                >
                  <Text style={[styles.depedPillText, { color: textSub }]}>
                    DepEd Pass: {PASSING_GRADE}%
                  </Text>
                </View>
              </View>

              <View style={styles.thresholdRow}>
                {ALERT_THRESHOLD_PRESETS.map((preset) => {
                  const isActive = localPrefs.atRiskThreshold === preset;
                  return (
                    <Pressable
                      key={preset}
                      style={({ pressed }) => [
                        styles.thresholdChip,
                        isActive
                          ? skeuoButtonStyle(skeuo, {
                              fill: ORANGE,
                              highlight: "#FB923C",
                              lip: "#9A3412",
                              pressed,
                              radius: 9,
                            })
                          : skeuoButtonStyle(skeuo, {
                              neutral: true,
                              pressed,
                              radius: 9,
                            }),
                      ]}
                      onPress={() =>
                        handleUpdatePrefs({ atRiskThreshold: preset })
                      }
                    >
                      <Text
                        style={[
                          styles.thresholdChipText,
                          { color: isActive ? "#FFFFFF" : textMain },
                        ]}
                      >
                        ≤{preset}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.prefsHint, { color: textSub }]}>
                Flags averages ≤{localPrefs.atRiskThreshold}% (≤{criticalCutoff}%
                marked Critical)
              </Text>

              {/* Toggle 1: Score Drop Alerts */}
              <TouchableOpacity
                style={[styles.prefToggleRow, { borderTopColor: border }]}
                activeOpacity={0.75}
                onPress={() =>
                  handleUpdatePrefs({
                    enableScoreDropAlerts: !localPrefs.enableScoreDropAlerts,
                  })
                }
              >
                <View style={styles.prefToggleCopy}>
                  <Text style={[styles.prefToggleTitle, { color: textMain }]}>
                    Sudden score drop alerts
                  </Text>
                  <Text style={[styles.prefToggleSub, { color: textSub }]}>
                    Notify if a quiz drops ≥15 pts below prior average
                  </Text>
                </View>
                <View
                  style={[
                    styles.switchTrack,
                    {
                      backgroundColor: localPrefs.enableScoreDropAlerts
                        ? ORANGE
                        : skeuo.wellDeep,
                      borderTopColor: localPrefs.enableScoreDropAlerts
                        ? "#9A3412"
                        : skeuo.wellBorderTop,
                      borderBottomColor: skeuo.wellBorderBottom,
                      alignItems: localPrefs.enableScoreDropAlerts
                        ? "flex-end"
                        : "flex-start",
                    },
                  ]}
                >
                  <View style={styles.switchThumb} />
                </View>
              </TouchableOpacity>

              {/* Toggle 2: Near-Passing Watchlist */}
              {localPrefs.atRiskThreshold < PASSING_GRADE - 1 && (
                <TouchableOpacity
                  style={[styles.prefToggleRow, { borderTopColor: border }]}
                  activeOpacity={0.75}
                  onPress={() =>
                    handleUpdatePrefs({
                      includeNearPassing: !localPrefs.includeNearPassing,
                    })
                  }
                >
                  <View style={styles.prefToggleCopy}>
                    <Text style={[styles.prefToggleTitle, { color: textMain }]}>
                      Near-passing watchlist
                    </Text>
                    <Text style={[styles.prefToggleSub, { color: textSub }]}>
                      Also track students scoring {localPrefs.atRiskThreshold + 1}
                      %–{PASSING_GRADE - 1}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.switchTrack,
                      {
                        backgroundColor: localPrefs.includeNearPassing
                          ? ORANGE
                          : skeuo.wellDeep,
                        borderTopColor: localPrefs.includeNearPassing
                          ? "#9A3412"
                          : skeuo.wellBorderTop,
                        borderBottomColor: skeuo.wellBorderBottom,
                        alignItems: localPrefs.includeNearPassing
                          ? "flex-end"
                          : "flex-start",
                      },
                    ]}
                  >
                    <View style={styles.switchThumb} />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Filter Chips + Classroom Filter + Quick Toolbar ── */}
          {(alerts.length > 0 || dismissedAlerts.length > 0) && (
            <View
              style={[
                styles.controlsArea,
                { backgroundColor: sheetBg, borderBottomColor: border },
              ]}
            >
              {/* Status / Severity Filter Chips */}
              {filterChips.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterChipsScroll}
                >
                  {filterChips.map((chip) => {
                    const selected = activeFilter === chip.key;
                    return (
                      <Pressable
                        key={chip.key}
                        style={({ pressed }) => [
                          styles.filterChip,
                          selected
                            ? skeuoButtonStyle(skeuo, {
                                fill: darkMode ? "#EAE7E1" : "#242220",
                                highlight: darkMode ? "#FFFFFF" : "#44403C",
                                lip: darkMode ? "#BDB6A9" : "#0D0E12",
                                pressed,
                                radius: 10,
                              })
                            : skeuoButtonStyle(skeuo, {
                                neutral: true,
                                pressed,
                                radius: 10,
                              }),
                        ]}
                        onPress={() => {
                          triggerHaptic("selection");
                          setActiveFilter(chip.key);
                        }}
                      >
                        {chip.dotColor && (
                          <View
                            style={[
                              styles.chipDot,
                              { backgroundColor: chip.dotColor },
                            ]}
                          />
                        )}
                        <Text
                          style={[
                            styles.filterChipText,
                            {
                              color: selected
                                ? darkMode
                                  ? "#1C1917"
                                  : "#FAF8F5"
                                : textMain,
                            },
                          ]}
                        >
                          {chip.label}
                        </Text>
                        <Text
                          style={[
                            styles.filterChipCount,
                            {
                              color: selected
                                ? darkMode
                                  ? "#57534E"
                                  : "#D6D1C7"
                                : textSub,
                            },
                          ]}
                        >
                          {chip.count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              {/* Classroom Chips (Homepage only, when >= 2 classes have alerts or a class is pre-selected) */}
              {scope === "global" &&
                (classroomOptions.length > 1 || selectedClassroomId !== null) && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.classroomChipsScroll}
                  >
                    <TouchableOpacity
                      style={[
                        styles.classFilterPill,
                        {
                          backgroundColor:
                            selectedClassroomId === null
                              ? skeuo.accentSoft
                              : skeuo.well,
                          borderColor:
                            selectedClassroomId === null
                              ? skeuo.accentSoftBorder
                              : cardBorder,
                        },
                      ]}
                      onPress={() => {
                        triggerHaptic("selection");
                        setSelectedClassroomId(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.classFilterText,
                          {
                            color:
                              selectedClassroomId === null ? ORANGE : textSub,
                          },
                        ]}
                      >
                        All Classes
                      </Text>
                    </TouchableOpacity>

                    {classroomOptions.map((cls) => {
                      const active = selectedClassroomId === cls.id;
                      return (
                        <TouchableOpacity
                          key={cls.id}
                          style={[
                            styles.classFilterPill,
                            {
                              backgroundColor: active
                                ? cls.color + "1F"
                                : skeuo.well,
                              borderColor: active ? cls.color : cardBorder,
                            },
                          ]}
                          onPress={() => {
                            triggerHaptic("selection");
                            setSelectedClassroomId(active ? null : cls.id);
                          }}
                          activeOpacity={0.8}
                        >
                          <View
                            style={[
                              styles.classDot,
                              { backgroundColor: cls.color },
                            ]}
                          />
                          <Text
                            style={[
                              styles.classFilterText,
                              { color: active ? textMain : textSub },
                            ]}
                            numberOfLines={1}
                          >
                            {cls.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}

              {/* Bulk Actions Row */}
              {activeFilter !== "DISMISSED" && alerts.length > 0 && (
                <View style={styles.bulkBar}>
                  <Text
                    style={[styles.bulkSummaryText, { color: textSub }]}
                    numberOfLines={1}
                  >
                    {displayedAlerts.length}{" "}
                    {displayedAlerts.length === 1 ? "student" : "students"} ·
                    Sorted by urgency
                  </Text>
                  <View style={styles.bulkActionsRight}>
                    {unreadCount > 0 && (
                      <TouchableOpacity
                        style={styles.bulkActionBtn}
                        onPress={() => {
                          triggerHaptic("light");
                          onMarkAllRead();
                        }}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name="checkmark-done-outline"
                          size={14}
                          color={ORANGE}
                        />
                        <Text style={[styles.bulkActionText, { color: ORANGE }]}>
                          Mark read
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.bulkActionBtn}
                      onPress={handleClearAllPress}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.bulkActionText, { color: textSub }]}>
                        Clear all
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {activeFilter === "DISMISSED" && dismissedAlerts.length > 0 && (
                <View style={styles.bulkBar}>
                  <Text style={[styles.bulkSummaryText, { color: textSub }]}>
                    {displayedAlerts.length} dismissed alert
                    {displayedAlerts.length === 1 ? "" : "s"}
                  </Text>
                  {onRestoreAlerts && (
                    <TouchableOpacity
                      style={styles.bulkActionBtn}
                      onPress={handleRestoreAllDismissed}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={14}
                        color={ORANGE}
                      />
                      <Text style={[styles.bulkActionText, { color: ORANGE }]}>
                        Restore all
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ── Scrollable Alert Cards List / Empty State ── */}
          <View style={[styles.listContainer, { backgroundColor: bodySurface }]}>
            {displayedAlerts.length === 0 ? (
              <View style={styles.emptyState}>
                <View
                  style={[
                    styles.emptyIconBox,
                    skeuoWellStyle(skeuo, 18),
                    {
                      backgroundColor: darkMode ? "#112921" : "#E8F6EF",
                      borderColor: darkMode ? "#1E5B47" : "#9CD6BC",
                    },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={28}
                    color={darkMode ? "#34D399" : "#059669"}
                  />
                </View>
                <Text style={[styles.emptyTitle, { color: textMain }]}>
                  {activeFilter === "UNREAD"
                    ? "You're All Caught Up"
                    : "All Students On Track"}
                </Text>
                <Text style={[styles.emptySub, { color: textSub }]}>
                  {activeFilter === "UNREAD"
                    ? "All active roster alerts have been reviewed."
                    : scope === "classroom"
                      ? `No students are currently at or below the ${localPrefs.atRiskThreshold}% alert threshold in this classroom.`
                      : `No students are currently flagged at or below ${localPrefs.atRiskThreshold}% across your classrooms.`}
                </Text>

                {dismissedAlerts.length > 0 && onRestoreAlerts && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.restoreEmptyBtn,
                      skeuoButtonStyle(skeuo, { neutral: true, pressed, radius: 11 }),
                    ]}
                    onPress={handleRestoreAllDismissed}
                  >
                    <Ionicons name="refresh-outline" size={15} color={ORANGE} />
                    <Text style={[styles.restoreEmptyBtnText, { color: textMain }]}>
                      Restore {dismissedAlerts.length} dismissed alert
                      {dismissedAlerts.length === 1 ? "" : "s"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                {displayedAlerts.map((alert) => {
                  const visuals = getSeverityVisuals(alert.alertType, darkMode);
                  const isDismissedView = activeFilter === "DISMISSED";
                  const isUnread = !alert.isRead && !isDismissedView;
                  const displayScore =
                    alert.alertType === "SCORE DROP" &&
                    typeof alert.quizScorePercentage === "number"
                      ? Math.round(alert.quizScorePercentage)
                      : Math.round(alert.scorePercentage);
                  const clampedProgress = Math.max(
                    3,
                    Math.min(100, Math.round(alert.scorePercentage))
                  );
                  const contextCopy = buildAlertCardSummary(alert);
                  const liveTime = formatAlertTimeLabel(
                    alert.createdAt,
                    alert.timeLabel || "Today"
                  );

                  return (
                    <TouchableOpacity
                      key={`${alert.id}_${alert.studentId}`}
                      style={[
                        styles.alertCard,
                        skeuoCardStyle(skeuo, 15),
                        {
                          backgroundColor: isUnread ? cardBg : readCardBg,
                          borderLeftColor: isUnread
                            ? visuals.softBorder
                            : skeuo.border,
                          borderRightColor: isUnread
                            ? visuals.softBorder
                            : skeuo.border,
                          opacity: isDismissedView ? 0.84 : isUnread ? 1 : 0.94,
                        },
                      ]}
                      onPress={() => {
                        triggerHaptic("light");
                        onAlertPress(alert);
                      }}
                      activeOpacity={0.85}
                    >
                      {/* Left Semantic LED Strip */}
                      <View
                        style={[
                          styles.cardLedStrip,
                          {
                            backgroundColor: isUnread
                              ? visuals.led
                              : skeuo.borderStrong,
                          },
                        ]}
                      />

                      {/* Top Meta Row: Unread LED + Severity Badge + Classroom Chip + Time + Dismiss */}
                      <View style={styles.cardTopRow}>
                        <View style={styles.cardTopLeft}>
                          {isUnread && (
                            <View
                              style={[
                                styles.unreadDot,
                                {
                                  backgroundColor: visuals.led,
                                  shadowColor: visuals.led,
                                },
                              ]}
                            />
                          )}
                          <View
                            style={[
                              styles.severityBadge,
                              {
                                backgroundColor: visuals.softBg,
                                borderColor: visuals.softBorder,
                              },
                            ]}
                          >
                            <Ionicons
                              name={visuals.icon}
                              size={12}
                              color={visuals.primary}
                            />
                            <Text
                              style={[
                                styles.severityBadgeText,
                                { color: visuals.primary },
                              ]}
                            >
                              {visuals.label}
                            </Text>
                          </View>

                          {scope === "global" && (
                            <View
                              style={[
                                styles.classroomPill,
                                {
                                  backgroundColor: subtlePillBg,
                                  borderColor: border,
                                },
                              ]}
                            >
                              <View
                                style={[
                                  styles.classroomPillDot,
                                  {
                                    backgroundColor:
                                      alert.classroomColor || ORANGE,
                                  },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.classroomPillText,
                                  { color: textSub },
                                ]}
                                numberOfLines={1}
                              >
                                {alert.classroomTitle}
                              </Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.cardTopRight}>
                          <Text style={[styles.timeText, { color: textSub }]}>
                            {liveTime}
                          </Text>
                          {isDismissedView ? (
                            onRestoreAlerts && (
                              <Pressable
                                style={({ pressed }) => [
                                  styles.cardIconAction,
                                  skeuoButtonStyle(skeuo, {
                                    neutral: true,
                                    pressed,
                                    radius: 8,
                                  }),
                                ]}
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  handleRestoreSingle(alert);
                                }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityLabel="Restore alert"
                              >
                                <Ionicons
                                  name="refresh-outline"
                                  size={13}
                                  color={ORANGE}
                                />
                              </Pressable>
                            )
                          ) : (
                            <Pressable
                              style={({ pressed }) => [
                                styles.cardIconAction,
                                skeuoButtonStyle(skeuo, {
                                  neutral: true,
                                  pressed,
                                  radius: 8,
                                }),
                              ]}
                              onPress={(e) => {
                                e.stopPropagation?.();
                                handleSingleDismiss(alert);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              accessibilityLabel={`Dismiss alert for ${alert.studentName}`}
                            >
                              <Ionicons
                                name="close"
                                size={12}
                                color={textSub}
                              />
                            </Pressable>
                          )}
                        </View>
                      </View>

                      {/* Main Body: Beveled Avatar Socket + Name & Context + Recessed Score Well */}
                      <View style={styles.cardMainRow}>
                        <View
                          style={[
                            styles.avatarBox,
                            skeuoWellStyle(skeuo, 11),
                            {
                              backgroundColor: visuals.socketBg,
                              borderColor: visuals.softBorder,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.avatarText,
                              { color: visuals.primary },
                            ]}
                          >
                            {getStudentInitials(alert.studentName)}
                          </Text>
                        </View>

                        <View style={styles.studentInfoCol}>
                          <Text
                            style={[styles.studentName, { color: textMain }]}
                            numberOfLines={1}
                          >
                            {alert.studentName}
                          </Text>
                          <Text
                            style={[styles.contextText, { color: textSub }]}
                            numberOfLines={2}
                          >
                            {contextCopy}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.scoreBox,
                            skeuoWellStyle(skeuo, 11),
                            {
                              backgroundColor: visuals.softBg,
                              borderColor: visuals.softBorder,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.scoreValue,
                              { color: visuals.primary },
                            ]}
                          >
                            {displayScore}%
                          </Text>
                          <Text
                            style={[
                              styles.scoreCaption,
                              { color: visuals.primary },
                            ]}
                          >
                            {visuals.metricLabel}
                          </Text>
                        </View>
                      </View>

                      {/* Recessed Progress Gauge w/ 75% DepEd Passing Marker */}
                      <View style={styles.gaugeSection}>
                        <View
                          style={[
                            styles.gaugeTrack,
                            {
                              backgroundColor: skeuo.wellDeep,
                              borderTopColor: skeuo.wellBorderTop,
                              borderBottomColor: skeuo.wellBorderBottom,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.gaugeFill,
                              {
                                width: `${clampedProgress}%`,
                                backgroundColor: visuals.barColor,
                              },
                            ]}
                          />
                          <View
                            style={[
                              styles.passingTick,
                              {
                                left: `${PASSING_GRADE}%`,
                                backgroundColor: darkMode
                                  ? "#D4CFC5"
                                  : "#57534E",
                              },
                            ]}
                          />
                        </View>
                        <View style={styles.gaugeLabelsRow}>
                          <Text
                            style={[
                              styles.gaugeLabelText,
                              styles.gaugeLabelLeft,
                              { color: textSub },
                            ]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {alert.quizTitle
                              ? `Quiz: ${alert.quizTitle}`
                              : "Cumulative Average"}
                          </Text>
                          <Text
                            style={[
                              styles.gaugeLabelText,
                              styles.gaugeLabelRight,
                              { color: textSub },
                            ]}
                            numberOfLines={1}
                          >
                            Pass {PASSING_GRADE}%
                          </Text>
                        </View>
                      </View>

                      {/* Engraved Groove Divider */}
                      <View style={[styles.cardGroove, skeuoGrooveStyle(skeuo)]} />

                      {/* Bottom Action Footer */}
                      <View style={styles.cardFooter}>
                        <View style={styles.primaryActionWrap}>
                          <Ionicons
                            name="analytics-outline"
                            size={14}
                            color={textMain}
                          />
                          <Text
                            style={[
                              styles.primaryActionText,
                              { color: textMain },
                            ]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            Student Tracker
                          </Text>
                          <Ionicons
                            name="chevron-forward"
                            size={13}
                            color={textSub}
                          />
                        </View>

                        {onRemedialQuizPress && (
                          <Pressable
                            style={({ pressed }) => [
                              styles.remedialBtn,
                              skeuoButtonStyle(skeuo, {
                                fill: ORANGE,
                                highlight: "#FB923C",
                                lip: "#9A3412",
                                pressed,
                                radius: 9,
                              }),
                            ]}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              triggerHaptic("light");
                              onRemedialQuizPress(alert);
                            }}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons
                              name="sparkles-outline"
                              size={12}
                              color="#FFFFFF"
                            />
                            <Text style={styles.remedialBtnText}>
                              Remedial Quiz
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* ── Unified Floating Skeuomorphic Undo Snackbar ── */}
            {undoPayload && onRestoreAlerts && (
              <SkeuoToast
                message={undoPayload.message}
                variant="warning"
                actionLabel="Undo"
                onAction={handleUndoPress}
                bottomOffset={12}
              />
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    width: "100%",
    maxWidth: 540,
    alignSelf: "center",
    maxHeight: "85%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1.5,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.24,
    shadowRadius: 22,
    elevation: 18,
  },
  dragPillWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  dragPill: {
    width: 40,
    height: 5,
    borderRadius: 99,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  headerIconBox: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17.5,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  unreadPill: {
    backgroundColor: ORANGE,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderTopWidth: 1,
    borderBottomWidth: 2,
  },
  unreadPillText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerIconBtn: {
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Inline Alert Preferences Panel */
  prefsPanel: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  prefsTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  prefsHeading: {
    fontSize: 13,
    fontWeight: "700",
  },
  depedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  depedPillText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  thresholdRow: {
    flexDirection: "row",
    gap: 7,
  },
  thresholdChip: {
    flex: 1,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  thresholdChipText: {
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  prefsHint: {
    fontSize: 11.5,
    marginTop: 8,
    marginBottom: 10,
    fontWeight: "500",
  },
  prefToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1,
    gap: 12,
  },
  prefToggleCopy: {
    flex: 1,
  },
  prefToggleTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  prefToggleSub: {
    fontSize: 11.5,
    marginTop: 1,
  },
  switchTrack: {
    width: 44,
    height: 25,
    borderRadius: 13,
    padding: 2,
    borderTopWidth: 1.5,
    borderBottomWidth: 1,
    justifyContent: "center",
  },
  switchThumb: {
    width: 19,
    height: 19,
    borderRadius: 9.5,
    backgroundColor: "#FAF8F5",
    borderWidth: 1,
    borderTopColor: "#FFFFFF",
    borderBottomColor: "#BDB6A9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },

  /* Filter & Controls Area */
  controlsArea: {
    paddingTop: 10,
    paddingBottom: 9,
    borderBottomWidth: 1,
  },
  filterChipsScroll: {
    paddingHorizontal: 18,
    gap: 8,
    paddingBottom: 9,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 33,
  },
  chipDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipCount: {
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  classroomChipsScroll: {
    paddingHorizontal: 18,
    gap: 7,
    paddingBottom: 8,
  },
  classFilterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 160,
  },
  classDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  classFilterText: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 2,
    gap: 10,
  },
  bulkSummaryText: {
    fontSize: 11.5,
    fontWeight: "600",
    flex: 1,
    minWidth: 0,
  },
  bulkActionsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
  },
  bulkActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  bulkActionText: {
    fontSize: 12,
    fontWeight: "700",
  },

  /* List Container & Cards */
  listContainer: {
    flexShrink: 1,
    minHeight: 160,
    maxHeight: SCREEN_HEIGHT * 0.56,
    position: "relative",
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
    gap: 12,
  },
  alertCard: {
    paddingVertical: 13,
    paddingRight: 14,
    paddingLeft: 17,
    overflow: "hidden",
  },
  cardLedStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 11,
  },
  cardTopLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
    flexWrap: "wrap",
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    flexShrink: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 4,
  },
  severityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    flexShrink: 0,
  },
  severityBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  classroomPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    borderWidth: 1,
    maxWidth: 140,
    flexShrink: 1,
  },
  classroomPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  classroomPillText: {
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  cardTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  timeText: {
    fontSize: 11.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  cardIconAction: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Card Main Row */
  cardMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  avatarBox: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 13.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  studentInfoCol: {
    flex: 1,
    minWidth: 0,
  },
  studentName: {
    fontSize: 14.5,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  contextText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "500",
  },
  scoreBox: {
    minWidth: 60,
    paddingHorizontal: 9,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  scoreValue: {
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.3,
  },
  scoreCaption: {
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 1,
    opacity: 0.88,
  },

  /* Progress Gauge */
  gaugeSection: {
    marginTop: 12,
    width: "100%",
  },
  gaugeTrack: {
    height: 7,
    borderRadius: 99,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    overflow: "visible",
    position: "relative",
    justifyContent: "center",
  },
  gaugeFill: {
    height: 5,
    borderRadius: 99,
  },
  passingTick: {
    position: "absolute",
    top: -2.5,
    marginLeft: -1,
    width: 2,
    height: 11,
    borderRadius: 1,
    opacity: 0.85,
  },
  gaugeLabelsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 5,
    gap: 12,
    width: "100%",
  },
  gaugeLabelText: {
    fontSize: 11,
    fontWeight: "600",
  },
  gaugeLabelLeft: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  gaugeLabelRight: {
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
  },

  /* Card Groove & Footer */
  cardGroove: {
    marginTop: 11,
    marginBottom: 9,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
  },
  primaryActionWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  primaryActionText: {
    fontSize: 12.5,
    fontWeight: "700",
    flexShrink: 1,
  },
  remedialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    flexShrink: 0,
  },
  remedialBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  /* Empty State */
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 28,
  },
  emptyIconBox: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  restoreEmptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  restoreEmptyBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
  },
});
