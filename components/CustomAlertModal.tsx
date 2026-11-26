import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertButton,
  AlertOptions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import {
  getSemanticTokens,
  getSkeuoPalette,
  skeuoButtonStyle,
  skeuoCardStyle,
  skeuoGrooveStyle,
  skeuoWellStyle,
  triggerSkeuoHaptic,
  type SkeuoSemanticVariant,
} from "./skeuoTheme";
import { SmoothCenterModal, TRANSITION_HANDOFF_DELAY_MS } from "./SmoothModalTransition";

export type AlertType =
  | "busy"
  | "network"
  | "limit"
  | "cooldown"
  | "error"
  | "destructive"
  | "warning"
  | "info"
  | "confirm"
  | "success";

export interface CustomAlertModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  type?: AlertType;
  buttonText?: string;
  accentColor?: string;
  onConfirm?: () => void;
  buttons?: AlertButton[];
  cancelable?: boolean;
  onDismiss?: () => void;
}

interface ResolvedAlertVisual {
  semantic: SkeuoSemanticVariant;
  icon: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
}

function resolveVisual(
  title: string,
  type?: AlertType,
  buttons?: AlertButton[]
): ResolvedAlertVisual {
  if (type === "success") {
    return { semantic: "success", icon: "checkmark", eyebrow: "COMPLETED" };
  }
  if (type === "network") {
    return { semantic: "error", icon: "cloud-offline-outline", eyebrow: "CONNECTION" };
  }
  if (type === "busy") {
    return { semantic: "error", icon: "hourglass-outline", eyebrow: "SERVICE BUSY" };
  }
  if (type === "destructive" || type === "error") {
    return { semantic: "error", icon: "alert", eyebrow: type === "destructive" ? "CONFIRM ACTION" : "ATTENTION" };
  }
  if (type === "limit" || type === "cooldown") {
    return { semantic: "warning", icon: "time-outline", eyebrow: type === "limit" ? "QUOTA LIMIT" : "COOLDOWN" };
  }
  if (type === "warning") {
    return { semantic: "warning", icon: "warning-outline", eyebrow: "CAUTION" };
  }
  if (type === "info") {
    return { semantic: "info", icon: "information", eyebrow: "NOTICE" };
  }
  if (type === "confirm") {
    return { semantic: "confirm", icon: "help", eyebrow: "CONFIRMATION" };
  }

  const hasDestructiveBtn = (buttons || []).some((b) => b.style === "destructive");
  if (hasDestructiveBtn) {
    return { semantic: "error", icon: "alert", eyebrow: "CONFIRM ACTION" };
  }

  const lowerTitle = (title || "").toLowerCase();
  const destructiveKeywords = [
    "delete",
    "remove",
    "discard",
    "failed",
    "fail",
    "error",
    "missing",
    "log out",
    "logout",
    "conflict",
    "trim",
    "invalid",
  ];
  if (destructiveKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "error", icon: "alert", eyebrow: "ATTENTION" };
  }

  const warningKeywords = [
    "warning",
    "caution",
    "limit",
    "at-risk",
    "busy",
    "permission",
    "long answers",
    "cooldown",
    "offline",
  ];
  if (warningKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "warning", icon: "warning-outline", eyebrow: "CAUTION" };
  }

  const successKeywords = [
    "success",
    "saved",
    "published",
    "created",
    "updated",
    "exported",
    "complete",
    "approved",
    "verified",
  ];
  if (successKeywords.some((kw) => lowerTitle.includes(kw))) {
    return { semantic: "success", icon: "checkmark", eyebrow: "COMPLETED" };
  }

  if ((buttons && buttons.length >= 2) || lowerTitle.endsWith("?") || lowerTitle.includes("confirm")) {
    return { semantic: "confirm", icon: "help", eyebrow: "CONFIRMATION" };
  }

  return { semantic: "info", icon: "information", eyebrow: "NOTICE" };
}

export default function CustomAlertModal({
  visible,
  onClose,
  title,
  message,
  type,
  buttonText = "OK",
  accentColor,
  onConfirm,
  buttons,
  cancelable = true,
  onDismiss,
}: CustomAlertModalProps) {
  const { darkMode, themeColor } = useTheme();
  const effectiveAccent = accentColor && accentColor !== "#2563EB" ? accentColor : themeColor;
  const palette = getSkeuoPalette(darkMode, effectiveAccent);

  const effectiveButtons: AlertButton[] =
    buttons && buttons.length > 0
      ? buttons
      : [
          {
            text: buttonText || "OK",
            style: "default",
            onPress: onConfirm,
          },
        ];

  const visual = resolveVisual(title, type, effectiveButtons);
  const sem = getSemanticTokens(visual.semantic, darkMode, effectiveAccent);

  const handleClose = () => {
    triggerSkeuoHaptic("light");
    const cancelBtn = effectiveButtons.find((b) => b.style === "cancel");
    onClose();
    setTimeout(() => {
      if (cancelBtn?.onPress) {
        cancelBtn.onPress();
      } else if (onDismiss) {
        onDismiss();
      }
    }, TRANSITION_HANDOFF_DELAY_MS);
  };

  const handleBackdropPress = () => {
    if (!cancelable) return;
    handleClose();
  };

  const handleButtonPress = (btn: AlertButton) => {
    triggerSkeuoHaptic(btn.style === "destructive" ? "medium" : "light");
    onClose();
    if (btn.onPress) {
      setTimeout(() => {
        btn.onPress?.();
      }, TRANSITION_HANDOFF_DELAY_MS);
    }
  };

  // Standard 2-button ordering: [Cancel (left), Primary/Action (right)]
  let orderedButtons = [...effectiveButtons];
  if (orderedButtons.length === 2) {
    const cancelIdx = orderedButtons.findIndex((b) => b.style === "cancel");
    if (cancelIdx !== -1) {
      const cancelBtn = orderedButtons[cancelIdx];
      const actionBtn = orderedButtons[cancelIdx === 0 ? 1 : 0];
      orderedButtons = [cancelBtn, actionBtn];
    }
  }

  const isTwoColumn = orderedButtons.length === 2;

  // Parse message into body text and optional helper note
  let bodyText = (message || "").trim();
  let noteText: string | null = null;

  const trailingParen = bodyText.match(/\n*\(([^)]+)\)\s*$/);
  if (trailingParen) {
    noteText = trailingParen[1].trim();
    bodyText = bodyText.replace(trailingParen[0], "").trim();
  } else {
    const noteLine = bodyText.match(/\n+(?:Note:\s*|\*Note:\*\s*)(.+)$/i);
    if (noteLine) {
      noteText = noteLine[1].trim();
      bodyText = bodyText.replace(noteLine[0], "").trim();
    }
  }

  if (noteText) {
    if (
      noteText.toLowerCase().includes("single-question regeneration does not consume") ||
      noteText.toLowerCase().includes("does not consume your daily quiz quota")
    ) {
      noteText = "Does not use your daily AI generation quota.";
    }
  }

  function getActionSemantic(btn: AlertButton) {
    if (btn.style === "destructive" || visual.semantic === "error") {
      return getSemanticTokens("error", darkMode, effectiveAccent);
    }
    if (visual.semantic === "warning") {
      return getSemanticTokens("warning", darkMode, effectiveAccent);
    }
    if (visual.semantic === "success") {
      return getSemanticTokens("success", darkMode, effectiveAccent);
    }
    return getSemanticTokens("confirm", darkMode, effectiveAccent);
  }

  return (
    <SmoothCenterModal
      visible={visible}
      onRequestClose={handleClose}
      onBackdropPress={cancelable ? handleBackdropPress : undefined}
      backdropColor={palette.backdrop}
      overlayStyle={styles.overlay}
      cardStyle={[
        styles.bezelFrame,
        {
          backgroundColor: darkMode ? "#161920" : "#DDD8CE",
          borderTopColor: darkMode ? "#3B4250" : "#FFFFFF",
          borderLeftColor: palette.borderStrong,
          borderRightColor: palette.borderStrong,
          borderBottomColor: darkMode ? "#07080B" : "#ABA497",
          shadowColor: palette.shadowColor,
        },
      ]}
    >
      <View style={[styles.card, skeuoCardStyle(palette, 18)]}>
        {/* Tactile Machined Header Bar */}
        <View
          style={[
            styles.headerBar,
            {
              backgroundColor: palette.chrome,
              borderBottomColor: palette.grooveDark,
            },
          ]}
        >
          <View style={styles.headerLeft}>
            {/* Recessed Medallion Socket + Glossy Emblem */}
            <View
              style={[
                styles.medallionWell,
                {
                  backgroundColor: sem.socketBg,
                  borderTopColor: darkMode ? "#0A0C0F" : sem.socketBorder,
                  borderLeftColor: darkMode ? "#0A0C0F" : sem.socketBorder,
                  borderRightColor: sem.socketBorder,
                  borderBottomColor: darkMode ? sem.socketBorder : "#FFFFFF",
                },
              ]}
            >
              <View
                style={[
                  styles.medallionCore,
                  {
                    backgroundColor: sem.fill,
                    borderTopColor: sem.highlight,
                    borderBottomColor: sem.lip,
                    shadowColor: sem.led,
                  },
                ]}
              >
                <Ionicons name={visual.icon} size={18} color={sem.onFill} />
              </View>
            </View>

            <View style={styles.headerTextWrap}>
              <View style={styles.eyebrowRow}>
                <View
                  style={[
                    styles.statusLed,
                    { backgroundColor: sem.led, shadowColor: sem.led },
                  ]}
                />
                <Text style={[styles.eyebrow, { color: sem.plaqueText }]}>
                  {visual.eyebrow}
                </Text>
              </View>
              <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={2}>
                {title}
              </Text>
            </View>
          </View>

          {cancelable && (
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeBtn,
                skeuoButtonStyle(palette, { neutral: true, pressed, radius: 10 }),
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
            >
              <Ionicons name="close" size={16} color={palette.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Specular Groove Catch-Line */}
        <View style={[skeuoGrooveStyle(palette), { marginTop: -1 }]} />

        {/* Dialog Body */}
        <View style={styles.bodySection}>
          {Boolean(bodyText && bodyText.length > 0) && (
            <ScrollView
              style={styles.messageScroll}
              contentContainerStyle={styles.messageScrollContent}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.body, { color: palette.textSecondary }]}>
                {bodyText}
              </Text>
            </ScrollView>
          )}

          {/* Optional Recessed Helper Note Well */}
          {Boolean(noteText && noteText.length > 0) && (
            <View style={[styles.infoCallout, skeuoWellStyle(palette, 10)]}>
              <Ionicons
                name="information-circle-outline"
                size={15}
                color={palette.textMuted}
                style={{ marginRight: 7, marginTop: 1 }}
              />
              <Text style={[styles.infoCalloutText, { color: palette.textSecondary }]}>
                {noteText}
              </Text>
            </View>
          )}

          {/* Tactile Footer Push-Buttons */}
          <View
            style={[
              styles.buttonsContainer,
              isTwoColumn ? styles.buttonsRow : styles.buttonsColumn,
            ]}
          >
            {orderedButtons.map((btn, idx) => {
              const isCancel = btn.style === "cancel" && orderedButtons.length > 1;
              const btnSem = getActionSemantic(btn);

              return (
                <Pressable
                  key={`${btn.text || "btn"}_${idx}`}
                  onPress={() => handleButtonPress(btn)}
                  style={({ pressed }) => [
                    styles.btnBase,
                    isTwoColumn && styles.btnFlex,
                    isCancel
                      ? skeuoButtonStyle(palette, { neutral: true, pressed, radius: 12 })
                      : skeuoButtonStyle(palette, {
                          fill: btnSem.fill,
                          highlight: btnSem.highlight,
                          lip: btnSem.lip,
                          pressed,
                          radius: 12,
                        }),
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={btn.text || "OK"}
                >
                  <Text
                    style={[
                      styles.btnText,
                      {
                        color: isCancel ? palette.textPrimary : "#FFFFFF",
                        textShadowColor: isCancel
                          ? "transparent"
                          : "rgba(0, 0, 0, 0.28)",
                        textShadowOffset: { width: 0, height: -1 },
                        textShadowRadius: 1,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {btn.text || "OK"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </SmoothCenterModal>
  );
}

// ── Global Alert.alert Interceptor & Host ─────────────────────────────────────

interface QueuedAlert {
  id: number;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
}

type AlertListener = (alert: QueuedAlert | null) => void;

const alertQueue: QueuedAlert[] = [];
let activeAlert: QueuedAlert | null = null;
let alertListener: AlertListener | null = null;
let nextAlertId = 1;
let interceptorInstalled = false;

function notifyListener() {
  alertListener?.(activeAlert);
}

function showNextInQueue() {
  if (alertQueue.length > 0) {
    activeAlert = alertQueue.shift()!;
  } else {
    activeAlert = null;
  }
  notifyListener();
}

export function enqueueGlobalAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions
) {
  const item: QueuedAlert = {
    id: nextAlertId++,
    title: title || "",
    message,
    buttons,
    options,
  };

  if (!activeAlert) {
    activeAlert = item;
    notifyListener();
  } else {
    if (
      activeAlert.title === item.title &&
      activeAlert.message === item.message
    ) {
      return;
    }
    alertQueue.push(item);
  }
}

export function installGlobalAlertInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  try {
    Alert.alert = (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: AlertOptions
    ) => {
      enqueueGlobalAlert(title, message, buttons, options);
    };
  } catch (err) {
    console.warn("Could not install custom Alert.alert interceptor:", err);
  }
}

// Install immediately when this module is imported
installGlobalAlertInterceptor();

export function GlobalAlertHost() {
  const [current, setCurrent] = useState<QueuedAlert | null>(activeAlert);
  const [lastRendered, setLastRendered] = useState<QueuedAlert | null>(activeAlert);

  useEffect(() => {
    installGlobalAlertInterceptor();
    alertListener = (next) => {
      setCurrent(next);
      if (next) {
        setLastRendered(next);
      }
    };
    if (activeAlert) {
      setCurrent(activeAlert);
      setLastRendered(activeAlert);
    }
    return () => {
      if (alertListener) {
        alertListener = null;
      }
    };
  }, []);

  const target = current || lastRendered;
  if (!target) return null;

  return (
    <CustomAlertModal
      visible={Boolean(current)}
      title={target.title}
      message={target.message}
      buttons={target.buttons}
      cancelable={target.options?.cancelable ?? true}
      onDismiss={target.options?.onDismiss}
      onClose={() => {
        showNextInQueue();
      }}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  bezelFrame: {
    width: "92%",
    maxWidth: 380,
    borderRadius: 23,
    padding: 5,
    borderWidth: 1,
    borderBottomWidth: 3,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 14,
  },
  card: {
    width: "100%",
    overflow: "hidden",
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  medallionWell: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  medallionCore: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderTopWidth: 1,
    borderBottomWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
    elevation: 3,
  },
  headerTextWrap: {
    flex: 1,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  statusLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 16.5,
    fontWeight: "700",
    lineHeight: 21,
    letterSpacing: -0.25,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bodySection: {
    paddingHorizontal: 18,
    paddingTop: 15,
    paddingBottom: 18,
  },
  messageScroll: {
    maxHeight: 220,
    width: "100%",
  },
  messageScrollContent: {
    alignItems: "stretch",
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "left",
  },
  infoCallout: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 12,
  },
  infoCalloutText: {
    fontSize: 12.5,
    lineHeight: 18,
    flex: 1,
    textAlign: "left",
  },
  buttonsContainer: {
    width: "100%",
    marginTop: 18,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  buttonsColumn: {
    flexDirection: "column",
    gap: 9,
  },
  btnBase: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  btnFlex: {
    flex: 1,
  },
  btnText: {
    fontSize: 14.5,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
});
