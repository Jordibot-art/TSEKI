import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import {
  getSemanticTokens,
  getSkeuoPalette,
  skeuoButtonStyle,
  triggerSkeuoHaptic,
  type SkeuoSemanticVariant,
} from "./skeuoTheme";

export interface SkeuoToastProps {
  message: string;
  variant?: SkeuoSemanticVariant;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  /** Optional Animated.Value (0 -> 1) for slide/fade entrance controlled by caller */
  animatedOpacity?: Animated.Value;
  /** Bottom offset when floating over screen/sheet */
  bottomOffset?: number;
  /** Set true if rendered inline inside a positioned wrapper */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANT_ICON: Record<SkeuoSemanticVariant, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  info: "information-circle",
  confirm: "checkmark-circle",
  warning: "warning",
  error: "close-circle",
};

export function inferToastVariant(message: string): SkeuoSemanticVariant {
  const lower = (message || "").toLowerCase();
  if (
    lower.includes("cancel") ||
    lower.includes("fail") ||
    lower.includes("error") ||
    lower.includes("unable")
  ) {
    return "error";
  }
  if (
    lower.includes("dismiss") ||
    lower.includes("warn") ||
    lower.includes("offline") ||
    lower.includes("limit")
  ) {
    return "warning";
  }
  if (
    lower.includes("saved") ||
    lower.includes("updated") ||
    lower.includes("added") ||
    lower.includes("removed") ||
    lower.includes("regenerated") ||
    lower.includes("exported") ||
    lower.includes("copied") ||
    lower.includes("✓")
  ) {
    return "success";
  }
  return "info";
}

export function SkeuoToast({
  message,
  variant,
  actionLabel,
  onAction,
  onDismiss,
  animatedOpacity,
  bottomOffset = 22,
  inline = false,
  style,
}: SkeuoToastProps) {
  const { darkMode, themeColor } = useTheme();
  const palette = getSkeuoPalette(darkMode, themeColor);
  const resolvedVariant = variant ?? inferToastVariant(message);
  const sem = getSemanticTokens(resolvedVariant, darkMode, themeColor);

  // Toast housing is a dark anodized instrument pill in light mode (high legibility)
  // and a brushed titanium-graphite instrument pill in dark mode.
  const pillBg = darkMode ? "#262B34" : "#242220";
  const pillTopHighlight = darkMode ? "#434A59" : "#44403C";
  const pillSideBorder = darkMode ? "#353B47" : "#35322F";
  const pillBottomLip = "#0D0E12";
  const pillText = "#FAF8F5";

  const cleanMessage = message.replace(/^[✓✔]\s*/, "");

  const pillContent = (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: pillBg,
          borderTopColor: pillTopHighlight,
          borderLeftColor: pillSideBorder,
          borderRightColor: pillSideBorder,
          borderBottomColor: pillBottomLip,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
        {/* Backlit LED Indicator Socket */}
        <View style={styles.ledSocket}>
          <View
            style={[
              styles.ledDot,
              {
                backgroundColor: sem.led,
                shadowColor: sem.led,
              },
            ]}
          />
        </View>

        <Ionicons
          name={VARIANT_ICON[resolvedVariant]}
          size={16}
          color={sem.highlight}
          style={styles.icon}
        />

        <Text style={[styles.text, { color: pillText }]} numberOfLines={2}>
          {cleanMessage}
        </Text>

        {actionLabel && onAction && (
          <Pressable
            onPress={() => {
              triggerSkeuoHaptic("selection");
              onAction();
            }}
            style={({ pressed }) => [
              styles.actionBtn,
              skeuoButtonStyle(palette, {
                fill: sem.fill,
                highlight: sem.highlight,
                lip: sem.lip,
                pressed,
                radius: 8,
              }),
            ]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        )}

        {onDismiss && (
          <Pressable
            onPress={() => {
              triggerSkeuoHaptic("light");
              onDismiss();
            }}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
          >
            <Ionicons name="close" size={14} color="#A8A29E" />
          </Pressable>
        )}
      </View>
  );

  const pointerEvents = actionLabel || onDismiss ? "box-none" : "none";
  const floatingStyle = !inline
    ? [styles.floatingWrap, { bottom: bottomOffset }]
    : undefined;

  if (animatedOpacity) {
    return (
      <Animated.View
        pointerEvents={pointerEvents}
        style={[
          floatingStyle,
          {
            opacity: animatedOpacity,
            transform: [
              {
                translateY: animatedOpacity.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
          style,
        ]}
      >
        {pillContent}
      </Animated.View>
    );
  }

  return (
    <View pointerEvents={pointerEvents} style={[floatingStyle, style]}>
      {pillContent}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 440,
    width: "100%",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderBottomWidth: 3,
    gap: 9,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
    elevation: 10,
  },
  ledSocket: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0E1014",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  ledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: {
    marginRight: -2,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  actionBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
});
