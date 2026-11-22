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
        primary: darkMode ? "#F87171" : "#DC2626",
        softBg: darkMode ? "#450A0A" : "#FEF2F2",
        softBorder: darkMode ? "#7F1D1D" : "#FECACA",
        barColor: darkMode ? "#EF4444" : "#DC2626",
        metricLabel: "AVG",
      };
    case "URGENT REVIEW":
      return {
        label: "At-Risk",
        icon: "warning" as const,
        primary: darkMode ? "#FBBF24" : "#D97706",
        softBg: darkMode ? "#451A03" : "#FFFBEB",
        softBorder: darkMode ? "#78350F" : "#FDE68A",
        barColor: darkMode ? "#F59E0B" : "#D97706",
        metricLabel: "AVG",
      };
    case "SCORE DROP":
      return {
        label: "Score Drop",
        icon: "trending-down" as const,
        primary: darkMode ? "#C4B5FD" : "#7C3AED",
        softBg: darkMode ? "#2E1065" : "#F5F3FF",
        softBorder: darkMode ? "#5B21B6" : "#DDD6FE",
        barColor: darkMode ? "#8B5CF6" : "#7C3AED",
        metricLabel: "QUIZ",
      };
    case "NEEDS SUPPORT":
    default:
      return {
        label: "Watchlist",
        icon: "flag" as const,
        primary: darkMode ? "#93C5FD" : "#2563EB",
        softBg: darkMode ? "#172554" : "#EFF6FF",
        softBorder: darkMode ? "#1E40AF" : "#BFDBFE",
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
  const { darkMode } = useTheme();
  const insets = useSafeAreaInsets();

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

  // ── Colors ────────────────────────────────────────────────────────────────
  const sheetBg = darkMode ? "#111827" : "#FFFFFF";
  const bodySurface = darkMode ? "#0B1120" : "#F8FAFC";
  const cardBg = darkMode ? "#1E293B" : "#FFFFFF";
  const readCardBg = darkMode ? "#151E2E" : "#F8FAFC";
  const textMain = darkMode ? "#F8FAFC" : "#0F172A";
  const textSub = darkMode ? "#94A3B8" : "#64748B";
  const border = darkMode ? "#1F2937" : "#E2E8F0";
  const cardBorder = darkMode ? "#334155" : "#E2E8F0";
  const subtlePillBg = darkMode ? "#1F2937" : "#F1F5F9";
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
              backgroundColor: darkMode
                ? "rgba(2, 6, 23, 0.72)"
                : "rgba(15, 23, 42, 0.48)",
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

        {/* Bottom Sheet Container */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: sheetBg,
              borderColor: darkMode ? "#1F2937" : "#E2E8F0",
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateY: sheetAnim }],
            },
          ]}
        >
          {/* Centered Drag Pill */}
          <View style={styles.dragPillWrap}>
            <View
              style={[
                styles.dragPill,
                { backgroundColor: darkMode ? "#334155" : "#CBD5E1" },
              ]}
            />
          </View>

          {/* ── Sheet Header ── */}
          <View style={[styles.header, { borderBottomColor: border }]}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.headerIconBox,
                  {
                    backgroundColor: darkMode ? "#431407" : "#FFF7ED",
                    borderColor: darkMode ? "#7C2D12" : "#FED7AA",
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
                    <View style={styles.unreadPill}>
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
              <TouchableOpacity
                style={[
                  styles.headerIconBtn,
                  {
                    backgroundColor: settingsOpen
                      ? darkMode
                        ? "#431407"
                        : "#FFF7ED"
                      : subtlePillBg,
                    borderColor: settingsOpen
                      ? darkMode
                        ? "#9A3412"
                        : "#FDBA74"
                      : "transparent",
                    borderWidth: 1,
                  },
                ]}
                onPress={() => {
                  triggerHaptic("selection");
                  setSettingsOpen((prev) => !prev);
                }}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Alert threshold settings"
              >
                <Ionicons
                  name="options-outline"
                  size={17}
                  color={settingsOpen ? ORANGE : textSub}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.headerIconBtn,
                  { backgroundColor: subtlePillBg, borderRadius: 17 },
                ]}
                onPress={onClose}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close notifications"
              >
                <Ionicons name="close" size={18} color={textSub} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Collapsible Inline Alert Preferences Panel ── */}
          {settingsOpen && (
            <View
              style={[
                styles.prefsPanel,
                {
                  backgroundColor: bodySurface,
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
                    { backgroundColor: darkMode ? "#1E293B" : "#E2E8F0" },
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
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.thresholdChip,
                        {
                          backgroundColor: isActive
                            ? ORANGE
                            : darkMode
                              ? "#1E293B"
                              : "#FFFFFF",
                          borderColor: isActive ? ORANGE : cardBorder,
                        },
                      ]}
                      onPress={() =>
                        handleUpdatePrefs({ atRiskThreshold: preset })
                      }
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.thresholdChipText,
                          { color: isActive ? "#FFFFFF" : textMain },
                        ]}
                      >
                        ≤{preset}%
                      </Text>
                    </TouchableOpacity>
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
                        : darkMode
                          ? "#334155"
                          : "#CBD5E1",
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
                          : darkMode
                            ? "#334155"
                            : "#CBD5E1",
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
                      <TouchableOpacity
                        key={chip.key}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: selected
                              ? darkMode
                                ? "#F8FAFC"
                                : "#0F172A"
                              : subtlePillBg,
                          },
                        ]}
                        onPress={() => {
                          triggerHaptic("selection");
                          setActiveFilter(chip.key);
                        }}
                        activeOpacity={0.8}
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
                                  ? "#0F172A"
                                  : "#FFFFFF"
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
                                  ? "#475569"
                                  : "#CBD5E1"
                                : textSub,
                            },
                          ]}
                        >
                          {chip.count}
                        </Text>
                      </TouchableOpacity>
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
                              ? darkMode
                                ? "#431407"
                                : "#FFF7ED"
                              : "transparent",
                          borderColor:
                            selectedClassroomId === null
                              ? darkMode
                                ? "#9A3412"
                                : "#FDBA74"
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
                                ? cls.color + "18"
                                : "transparent",
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
                    {
                      backgroundColor: darkMode ? "#064E3B40" : "#ECFDF5",
                      borderColor: darkMode ? "#065F46" : "#A7F3D0",
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
                  <TouchableOpacity
                    style={[
                      styles.restoreEmptyBtn,
                      {
                        backgroundColor: cardBg,
                        borderColor: cardBorder,
                      },
                    ]}
                    onPress={handleRestoreAllDismissed}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="refresh-outline" size={15} color={ORANGE} />
                    <Text style={[styles.restoreEmptyBtnText, { color: textMain }]}>
                      Restore {dismissedAlerts.length} dismissed alert
                      {dismissedAlerts.length === 1 ? "" : "s"}
                    </Text>
                  </TouchableOpacity>
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
                        {
                          backgroundColor: isUnread ? cardBg : readCardBg,
                          borderColor: isUnread
                            ? visuals.softBorder
                            : cardBorder,
                          opacity: isDismissedView ? 0.84 : isUnread ? 1 : 0.92,
                        },
                      ]}
                      onPress={() => {
                        triggerHaptic("light");
                        onAlertPress(alert);
                      }}
                      activeOpacity={0.82}
                    >
                      {/* Top Meta Row: Unread Dot + Severity Pill + Classroom Chip + Time + Dismiss */}
                      <View style={styles.cardTopRow}>
                        <View style={styles.cardTopLeft}>
                          {isUnread && (
                            <View
                              style={[
                                styles.unreadDot,
                                { backgroundColor: visuals.primary },
                              ]}
                            />
                          )}
                          <View
                            style={[
                              styles.severityBadge,
                              { backgroundColor: visuals.softBg },
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
                                { backgroundColor: subtlePillBg },
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
                              <TouchableOpacity
                                style={[
                                  styles.cardIconAction,
                                  { backgroundColor: subtlePillBg },
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
                                  size={14}
                                  color={ORANGE}
                                />
                              </TouchableOpacity>
                            )
                          ) : (
                            <TouchableOpacity
                              style={[
                                styles.cardIconAction,
                                {
                                  backgroundColor: darkMode
                                    ? "#0F172A80"
                                    : "#F1F5F9",
                                },
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
                                size={13}
                                color={textSub}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Main Body: Avatar + Name & Context + Tabular Score Metric */}
                      <View style={styles.cardMainRow}>
                        <View
                          style={[
                            styles.avatarBox,
                            {
                              backgroundColor: visuals.softBg,
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

                      {/* Slim Visual Progress Gauge w/ 75% DepEd Passing Marker */}
                      <View style={styles.gaugeSection}>
                        <View
                          style={[
                            styles.gaugeTrack,
                            {
                              backgroundColor: darkMode
                                ? "#0F172A"
                                : "#E2E8F0",
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
                                  ? "#94A3B8"
                                  : "#475569",
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

                      {/* Bottom Action Footer */}
                      <View
                        style={[
                          styles.cardFooter,
                          {
                            borderTopColor: darkMode ? "#33415580" : "#F1F5F9",
                          },
                        ]}
                      >
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
                          <TouchableOpacity
                            style={[
                              styles.remedialBtn,
                              {
                                backgroundColor: darkMode
                                  ? "#431407"
                                  : "#FFF7ED",
                                borderColor: darkMode
                                  ? "#9A3412"
                                  : "#FED7AA",
                              },
                            ]}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              triggerHaptic("light");
                              onRemedialQuizPress(alert);
                            }}
                            activeOpacity={0.78}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons
                              name="sparkles-outline"
                              size={12}
                              color={ORANGE}
                            />
                            <Text style={styles.remedialBtnText}>
                              Remedial Quiz
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* ── Floating Undo Snackbar ── */}
            {undoPayload && onRestoreAlerts && (
              <View
                style={[
                  styles.undoBar,
                  {
                    backgroundColor: darkMode ? "#F8FAFC" : "#0F172A",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.undoText,
                    { color: darkMode ? "#0F172A" : "#F8FAFC" },
                  ]}
                  numberOfLines={1}
                >
                  {undoPayload.message}
                </Text>
                <TouchableOpacity
                  onPress={handleUndoPress}
                  hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.undoActionText}>Undo</Text>
                </TouchableOpacity>
              </View>
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
    maxHeight: "84%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 16,
  },
  dragPillWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 99,
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
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
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
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 99,
  },
  unreadPillText: {
    color: "#FFFFFF",
    fontSize: 10.5,
    fontWeight: "700",
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
    width: 34,
    height: 34,
    borderRadius: 10,
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
    borderRadius: 6,
  },
  depedPillText: {
    fontSize: 10.5,
    fontWeight: "600",
  },
  thresholdRow: {
    flexDirection: "row",
    gap: 7,
  },
  thresholdChip: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  thresholdChipText: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  prefsHint: {
    fontSize: 11.5,
    marginTop: 7,
    marginBottom: 10,
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
    fontWeight: "600",
  },
  prefToggleSub: {
    fontSize: 11.5,
    marginTop: 1,
  },
  switchTrack: {
    width: 42,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 2,
    elevation: 2,
  },

  /* Filter & Controls Area */
  controlsArea: {
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  filterChipsScroll: {
    paddingHorizontal: 18,
    gap: 8,
    paddingBottom: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 99,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  filterChipText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  filterChipCount: {
    fontSize: 11.5,
    fontWeight: "700",
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
    fontWeight: "600",
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
    fontWeight: "500",
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
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
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
  },
  severityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
    flexShrink: 0,
  },
  severityBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  classroomPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
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
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  cardIconAction: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
    borderRadius: 12,
    borderWidth: 1,
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
    fontWeight: "700",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  contextText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "400",
  },
  scoreBox: {
    minWidth: 58,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
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
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 1,
    opacity: 0.85,
  },

  /* Progress Gauge */
  gaugeSection: {
    marginTop: 12,
    width: "100%",
  },
  gaugeTrack: {
    height: 5,
    borderRadius: 99,
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
    top: -2,
    marginLeft: -1,
    width: 2,
    height: 9,
    borderRadius: 1,
    opacity: 0.7,
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
    fontWeight: "500",
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

  /* Card Footer */
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
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
    fontWeight: "600",
    flexShrink: 1,
  },
  remedialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  remedialBtnText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: ORANGE,
  },

  /* Empty State */
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 28,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
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
    borderRadius: 10,
    borderWidth: 1,
  },
  restoreEmptyBtnText: {
    fontSize: 12.5,
    fontWeight: "600",
  },

  /* Floating Undo Snackbar */
  undoBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  undoText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  undoActionText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FB923C",
  },
});
