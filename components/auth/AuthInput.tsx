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
      bgPage: "#09090B",
      bgSurface: "#18181B",
      bgSubtle: "#27272A",
      border: "#27272A",
      borderHairline: "#27272A",
      borderInput: "#3F3F46",
      textPrimary: "#FAFAFA",
      textSecondary: "#E4E4E7",
      textMuted: "#A1A1AA",
      placeholder: "#71717A",
      accent: "#EA580C",
      accentBg: "rgba(234, 88, 12, 0.14)",
      accentText: "#FB923C",
      success: "#10B981",
      successBg: "rgba(16, 185, 129, 0.14)",
      successBorder: "rgba(16, 185, 129, 0.35)",
      successText: "#34D399",
      btnDarkBg: "#FAFAFA",
      btnDarkText: "#18181B",
      btnDisabledBg: "#27272A",
      btnDisabledText: "#71717A",
    };
  }

  return {
    bgPage: "#FAFAFA",
    bgSurface: "#FFFFFF",
    bgSubtle: "#F4F4F5",
    border: "#E4E4E7",
    borderHairline: "#F4F4F5",
    borderInput: "#D4D4D8",
    textPrimary: "#18181B",
    textSecondary: "#3F3F46",
    textMuted: "#71717A",
    placeholder: "#A1A1AA",
    accent: "#EA580C",
    accentBg: "#FFF7ED",
    accentText: "#C2410C",
    success: "#10B981",
    successBg: "#ECFDF5",
    successBorder: "#D1FAE5",
    successText: "#059669",
    btnDarkBg: "#18181B",
    btnDarkText: "#FFFFFF",
    btnDisabledBg: "#E4E4E7",
    btnDisabledText: "#A1A1AA",
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
          {
            backgroundColor: theme.bgSurface,
            borderColor: focused ? theme.accent : theme.borderInput,
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
    fontWeight: "600",
    marginBottom: 6,
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
