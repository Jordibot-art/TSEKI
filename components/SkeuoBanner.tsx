import { Ionicons } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import {
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

export interface SkeuoBannerProps {
  variant?: SkeuoSemanticVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  message?: string;
  children?: ReactNode;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_ICON: Record<SkeuoSemanticVariant, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  info: "information-circle",
  confirm: "sparkles",
  warning: "warning",
  error: "alert-circle",
};

export function SkeuoBanner({
  variant = "info",
  icon,
  title,
  message,
  children,
  actionLabel,
  actionDisabled = false,
  onAction,
  onDismiss,
  compact = false,
  style,
}: SkeuoBannerProps) {
  const { darkMode, themeColor } = useTheme();
  const palette = getSkeuoPalette(darkMode, themeColor);
  const sem = getSemanticTokens(variant, darkMode, themeColor);

  return (
    <View
      style={[
        styles.plaque,
        compact && styles.plaqueCompact,
        {
          backgroundColor: sem.plaqueBg,
          borderTopColor: darkMode ? sem.plaqueBorder : palette.bevelTop,
          borderLeftColor: sem.plaqueBorder,
          borderRightColor: sem.plaqueBorder,
          borderBottomColor: sem.plaqueBorder,
          shadowColor: palette.shadowColor,
        },
        style,
      ]}
      accessibilityRole={variant === "error" || variant === "warning" ? "alert" : undefined}
    >
      {/* Left Semantic LED Strip */}
      <View
        style={[
          styles.ledStrip,
          {
            backgroundColor: sem.ledBar,
            shadowColor: sem.led,
          },
        ]}
      />

      {/* Beveled Icon Socket */}
      <View
        style={[
          styles.iconSocket,
          compact && styles.iconSocketCompact,
          {
            backgroundColor: sem.socketBg,
            borderTopColor: darkMode ? "#0B0D10" : sem.socketBorder,
            borderLeftColor: darkMode ? "#0B0D10" : sem.socketBorder,
            borderRightColor: sem.socketBorder,
            borderBottomColor: darkMode ? sem.socketBorder : "#FFFFFF",
          },
        ]}
      >
        <Ionicons
          name={icon ?? DEFAULT_ICON[variant]}
          size={compact ? 14 : 16}
          color={sem.plaqueText}
        />
      </View>

      {/* Text / Custom Body */}
      <View style={styles.content}>
        {title ? (
          <Text
            style={[
              styles.title,
              compact && styles.titleCompact,
              { color: sem.plaqueText },
            ]}
          >
            {title}
          </Text>
        ) : null}
        {message ? (
          <Text
            style={[
              styles.message,
              compact && styles.messageCompact,
              { color: sem.plaqueText },
            ]}
          >
            {message}
          </Text>
        ) : null}
        {children}
      </View>

      {/* Optional Tactile Action Button */}
      {actionLabel && onAction && (
        <Pressable
          onPress={() => {
            triggerSkeuoHaptic("light");
            onAction();
          }}
          disabled={actionDisabled}
          style={({ pressed }) => [
            styles.actionBtn,
            skeuoButtonStyle(palette, {
              fill: sem.fill,
              highlight: sem.highlight,
              lip: sem.lip,
              pressed,
              radius: 8,
            }),
            actionDisabled && { opacity: 0.6 },
          ]}
          hitSlop={6}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}

      {/* Optional Tactile Dismiss Button */}
      {onDismiss && (
        <Pressable
          onPress={() => {
            triggerSkeuoHaptic("light");
            onDismiss();
          }}
          style={({ pressed }) => [
            styles.dismissBtn,
            {
              backgroundColor: sem.socketBg,
              borderColor: sem.socketBorder,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss banner"
        >
          <Ionicons name="close" size={14} color={sem.plaqueText} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plaque: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    borderBottomWidth: 2,
    paddingVertical: 10,
    paddingRight: 11,
    paddingLeft: 14,
    gap: 10,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  plaqueCompact: {
    borderRadius: 10,
    paddingVertical: 7,
    paddingRight: 9,
    paddingLeft: 12,
    gap: 8,
  },
  ledStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    shadowOffset: { width: 1, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
  },
  iconSocket: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconSocketCompact: {
    width: 24,
    height: 24,
    borderRadius: 7,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    marginBottom: 1,
  },
  titleCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  message: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  messageCompact: {
    fontSize: 11.5,
    lineHeight: 15.5,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  dismissBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
