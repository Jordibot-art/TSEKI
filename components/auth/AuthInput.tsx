import React, { useState } from "react";
import {
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { getSkeuoPalette, skeuoWellStyle } from "../skeuoTheme";

export interface AuthTheme {
  bgPage: string;
  bgSurface: string;
  bgSubtle: string;
  border: string;
  borderHairline: string;
  borderInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  placeholder: string;
  accent: string;
  accentBg: string;
  accentText: string;
  success: string;
  successBg: string;
  successBorder: string;
  successText: string;
  btnDarkBg: string;
  btnDarkText: string;
  btnDisabledBg: string;
  btnDisabledText: string;
}

export function getAuthTheme(darkMode: boolean): AuthTheme {
  if (darkMode) {
    return {
      bgPage: "#121418",
      bgSurface: "#22262E",
      bgSubtle: "#16191F",
      border: "#323742",
      borderHairline: "#262B35",
      borderInput: "#3A404D",
      textPrimary: "#F4F2ED",
      textSecondary: "#C8CCD6",
      textMuted: "#8F96A6",
      placeholder: "#687082",
      accent: "#EA580C",
      accentBg: "#2E1A10",
      accentText: "#FB923C",
      success: "#10B981",
      successBg: "#112921",
      successBorder: "#1E5B47",
      successText: "#86EFAC",
      btnDarkBg: "#F4F2ED",
      btnDarkText: "#181A1F",
      btnDisabledBg: "#1D2028",
      btnDisabledText: "#687082",
    };
  }

  return {
    bgPage: "#EAE7E1",
    bgSurface: "#F9F7F3",
    bgSubtle: "#E5E1D9",
    border: "#D4CFC5",
    borderHairline: "#E1DCD2",
    borderInput: "#C3BCB0",
    textPrimary: "#1C1917",
    textSecondary: "#44403C",
    textMuted: "#78716C",
    placeholder: "#9C958B",
    accent: "#EA580C",
    accentBg: "#FCEEE3",
    accentText: "#C2410C",
    success: "#059669",
    successBg: "#E8F6EF",
    successBorder: "#9CD6BC",
    successText: "#065F46",
    btnDarkBg: "#24272E",
    btnDarkText: "#FAF8F5",
    btnDisabledBg: "#DDD8CE",
    btnDisabledText: "#9C958B",
  };
}

const SUBJECT_ACRONYMS = new Set([
  "HUMSS",
  "STEM",
  "ABM",
  "GAS",
  "TVL",
  "ICT",
  "MAPEH",
  "ESP",
  "TLE",
  "SHS",
  "JHS",
  "PE",
  "P.E.",
  "HELE",
  "EPP",
  "AP",
  "IT",
]);

/**
 * Live input formatter that automatically capitalizes the first letter of each
 * word as the user types (without trimming spaces or altering inner capitals).
 */
export function capitalizeWordsInput(raw: string): string {
  return raw.replace(
    /(^|[\s\-./(])([a-z\u00e0-\u00f6\u00f8-\u00ff])/g,
    (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`
  );
}

/**
 * Presentation-only formatter that converts canonical UPPERCASE subject tags
 * into clean Title Case while preserving well-known educational acronyms.
 */
export function formatSubjectLabel(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  return trimmed
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (SUBJECT_ACRONYMS.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function formatSubjectsSummaryDisplay(summary: string): string {
  if (!summary) return "";
  return summary
    .split(",")
    .map((part) => formatSubjectLabel(part))
    .filter(Boolean)
    .join(", ");
}

export interface AuthInputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  helperText?: string;
  rightElement?: React.ReactNode;
  darkMode?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  tabularNums?: boolean;
}

export function AuthInput({
  label,
  helperText,
  rightElement,
  darkMode = false,
  containerStyle,
  inputStyle,
  tabularNums = false,
  onFocus,
  onBlur,
  ...textInputProps
}: AuthInputProps) {
  const [focused, setFocused] = useState(false);
  const theme = getAuthTheme(darkMode);
  const palette = getSkeuoPalette(darkMode, theme.accent);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {!!label && (
        <Text style={[styles.label, { color: theme.textPrimary }]}>
          {label}
        </Text>
      )}
      {!!helperText && (
        <Text style={[styles.helperText, { color: theme.textMuted }]}>
          {helperText}
        </Text>
      )}
      <View
        style={[
          styles.inputBox,
          skeuoWellStyle(palette, 12),
          focused && {
            backgroundColor: darkMode ? "#12151C" : "#FCFBF8",
            borderWidth: 1.5,
            borderTopColor: palette.accent,
            borderLeftColor: palette.accent,
            borderRightColor: palette.accent,
            borderBottomColor: palette.accent,
          },
        ]}
      >
        <TextInput
          {...textInputProps}
          placeholderTextColor={theme.placeholder}
          style={[
            styles.input,
            { color: theme.textPrimary },
            tabularNums && styles.tabularNums,
            Platform.OS === "web" ? ({ outlineWidth: 0 } as TextStyle) : null,
            inputStyle,
          ]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {!!rightElement && (
          <View style={styles.rightSlot}>{rightElement}</View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: 0.1,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -2,
    marginBottom: 8,
  },
  inputBox: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: "100%",
    fontSize: 15,
    paddingVertical: 0,
  },
  tabularNums: {
    fontVariant: ["tabular-nums"],
  },
  rightSlot: {
    marginLeft: 8,
    justifyContent: "center",
    alignItems: "center",
  },
});
