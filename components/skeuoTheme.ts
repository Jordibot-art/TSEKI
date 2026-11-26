import * as Haptics from "expo-haptics";
import { Platform, type ViewStyle } from "react-native";

export type SkeuoSemanticVariant = "success" | "info" | "confirm" | "warning" | "error";

export interface SkeuoSemanticColors {
  variant: SkeuoSemanticVariant;
  /** Backlit LED / primary fill */
  led: string;
  /** Glossy/satin hardware button fill */
  fill: string;
  /** Highlight edge on top of button/medallion */
  highlight: string;
  /** Deep physical lip on bottom of button/medallion */
  lip: string;
  /** Soft recessed plaque background */
  plaqueBg: string;
  /** Plaque border */
  plaqueBorder: string;
  /** Left LED strip bar */
  ledBar: string;
  /** High-contrast foreground text on soft plaque */
  plaqueText: string;
  /** Beveled icon socket background */
  socketBg: string;
  /** Beveled icon socket border */
  socketBorder: string;
  /** Foreground icon/text on solid fill */
  onFill: string;
}

export interface SkeuoPalette {
  darkMode: boolean;
  accent: string;
  accentHighlight: string;
  accentLip: string;
  accentSoft: string;
  accentSoftBorder: string;

  /** Main screen chassis canvas */
  canvas: string;
  /** Secondary brushed tray surface */
  tray: string;
  /** Raised card / plaque surface */
  surface: string;
  /** Elevated header / chrome bar */
  chrome: string;
  /** Slightly muted read/inactive surface */
  surfaceMuted: string;
  /** Recessed / debossed well (inputs, tracks, note boxes) */
  well: string;
  wellDeep: string;

  /** Bevel & hairline rim colors */
  border: string;
  borderStrong: string;
  bevelTop: string;
  bevelBottom: string;
  wellBorderTop: string;
  wellBorderBottom: string;
  grooveDark: string;
  grooveLight: string;

  /** Secondary push-button chrome */
  btnNeutralBg: string;
  btnNeutralBorder: string;
  btnNeutralLip: string;
  btnNeutralHighlight: string;

  /** Typography */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  /** Modal backdrop */
  backdrop: string;

  /** Hardware shadow tint */
  shadowColor: string;
}

export function getSkeuoPalette(
  darkMode: boolean,
  accentColor: string = "#EA580C"
): SkeuoPalette {
  const accent = accentColor || "#EA580C";
  const isDefaultOrange =
    accent.toUpperCase() === "#FF6B00" || accent.toUpperCase() === "#EA580C";

  if (darkMode) {
    return {
      darkMode: true,
      accent,
      accentHighlight: isDefaultOrange ? "#FB923C" : accent,
      accentLip: isDefaultOrange ? "#9A3412" : "#111317",
      accentSoft: isDefaultOrange ? "#2E1A10" : "#1E222B",
      accentSoftBorder: isDefaultOrange ? "#6B3416" : "#38404F",

      canvas: "#121418",
      tray: "#16191F",
      surface: "#22262E",
      chrome: "#1D2028",
      surfaceMuted: "#1A1D24",
      well: "#0E1014",
      wellDeep: "#0A0C0F",

      border: "#323742",
      borderStrong: "#404756",
      bevelTop: "#3A404D",
      bevelBottom: "#0B0D10",
      wellBorderTop: "#07080A",
      wellBorderBottom: "#2E333E",
      grooveDark: "#0B0D10",
      grooveLight: "rgba(255, 255, 255, 0.07)",

      btnNeutralBg: "#2A2E38",
      btnNeutralBorder: "#3A404D",
      btnNeutralLip: "#101216",
      btnNeutralHighlight: "#454C5C",

      textPrimary: "#F4F2ED",
      textSecondary: "#A3A8B4",
      textMuted: "#6F7685",

      backdrop: "rgba(6, 8, 12, 0.72)",
      shadowColor: "#000000",
    };
  }

  return {
    darkMode: false,
    accent,
    accentHighlight: isDefaultOrange ? "#FB923C" : accent,
    accentLip: isDefaultOrange ? "#9A3412" : "#78716C",
    accentSoft: isDefaultOrange ? "#FCEEE3" : "#F3EFE9",
    accentSoftBorder: isDefaultOrange ? "#EAB896" : "#D6D1C7",

    canvas: "#EAE7E1",
    tray: "#E3DFD7",
    surface: "#F9F7F3",
    chrome: "#F1EEE8",
    surfaceMuted: "#EFECE6",
    well: "#E5E1D9",
    wellDeep: "#DDD8CE",

    border: "#D4CFC5",
    borderStrong: "#BDB6A9",
    bevelTop: "#FFFFFF",
    bevelBottom: "#C3BCB0",
    wellBorderTop: "#BFB8AB",
    wellBorderBottom: "#FFFFFF",
    grooveDark: "rgba(28, 25, 23, 0.13)",
    grooveLight: "rgba(255, 255, 255, 0.85)",

    btnNeutralBg: "#F4F1EB",
    btnNeutralBorder: "#CFC9BE",
    btnNeutralLip: "#B5AEA0",
    btnNeutralHighlight: "#FFFFFF",

    textPrimary: "#1C1917",
    textSecondary: "#57534E",
    textMuted: "#78716C",

    backdrop: "rgba(20, 17, 14, 0.52)",
    shadowColor: "#1C1917",
  };
}

export function getSemanticTokens(
  variant: SkeuoSemanticVariant,
  darkMode: boolean,
  accentColor: string = "#EA580C"
): SkeuoSemanticColors {
  switch (variant) {
    case "success":
      return {
        variant: "success",
        led: "#10B981",
        fill: "#059669",
        highlight: "#34D399",
        lip: "#065F46",
        plaqueBg: darkMode ? "#112921" : "#E8F6EF",
        plaqueBorder: darkMode ? "#1E5B47" : "#9CD6BC",
        ledBar: "#10B981",
        plaqueText: darkMode ? "#86EFAC" : "#065F46",
        socketBg: darkMode ? "#0C1F19" : "#D6EFE3",
        socketBorder: darkMode ? "#256D55" : "#8CCCB0",
        onFill: "#FFFFFF",
      };
    case "warning":
      return {
        variant: "warning",
        led: "#F59E0B",
        fill: "#D97706",
        highlight: "#FBBF24",
        lip: "#92400E",
        plaqueBg: darkMode ? "#2A1F0D" : "#FDF3DF",
        plaqueBorder: darkMode ? "#6C4A15" : "#E6C27A",
        ledBar: "#F59E0B",
        plaqueText: darkMode ? "#FCD34D" : "#92400E",
        socketBg: darkMode ? "#201708" : "#F8E5BE",
        socketBorder: darkMode ? "#80581A" : "#DDAE57",
        onFill: "#FFFFFF",
      };
    case "error":
      return {
        variant: "error",
        led: "#EF4444",
        fill: "#DC2626",
        highlight: "#F87171",
        lip: "#991B1B",
        plaqueBg: darkMode ? "#2E1417" : "#FBECEB",
        plaqueBorder: darkMode ? "#6E2830" : "#E8B0AA",
        ledBar: "#EF4444",
        plaqueText: darkMode ? "#FCA5A5" : "#991B1B",
        socketBg: darkMode ? "#230E11" : "#F7D9D6",
        socketBorder: darkMode ? "#84323B" : "#DF9992",
        onFill: "#FFFFFF",
      };
    case "info":
      return {
        variant: "info",
        led: "#3B82F6",
        fill: "#2563EB",
        highlight: "#60A5FA",
        lip: "#1E40AF",
        plaqueBg: darkMode ? "#13213B" : "#EAF1FD",
        plaqueBorder: darkMode ? "#25457A" : "#AEC7F4",
        ledBar: "#3B82F6",
        plaqueText: darkMode ? "#93C5FD" : "#1E40AF",
        socketBg: darkMode ? "#0D182C" : "#D9E7FC",
        socketBorder: darkMode ? "#305899" : "#95B7F0",
        onFill: "#FFFFFF",
      };
    case "confirm":
    default: {
      const fill = accentColor || "#EA580C";
      const isDefaultOrange =
        fill.toUpperCase() === "#FF6B00" || fill.toUpperCase() === "#EA580C";
      return {
        variant: "confirm",
        led: isDefaultOrange ? "#FF6B00" : fill,
        fill,
        highlight: isDefaultOrange ? "#FB923C" : fill,
        lip: isDefaultOrange ? "#9A3412" : "#3F3F46",
        plaqueBg: darkMode ? "#2B1B12" : "#FCF0E6",
        plaqueBorder: darkMode ? "#6C3A1C" : "#E9BC9B",
        ledBar: isDefaultOrange ? "#EA580C" : fill,
        plaqueText: darkMode ? "#FDBA74" : "#9A3412",
        socketBg: darkMode ? "#20130B" : "#F7E2D1",
        socketBorder: darkMode ? "#7E4320" : "#E2AA82",
        onFill: "#FFFFFF",
      };
    }
  }
}

/** Raised tactile hardware plaque style (cards, modal housings) */
export function skeuoCardStyle(
  palette: SkeuoPalette,
  radius: number = 16,
  androidElevation?: number
): ViewStyle {
  return {
    backgroundColor: palette.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderTopColor: palette.bevelTop,
    borderLeftColor: palette.border,
    borderRightColor: palette.border,
    borderBottomColor: palette.bevelBottom,
    borderBottomWidth: 2,
    shadowColor: palette.shadowColor,
    shadowOffset: { width: 0, height: palette.darkMode ? 6 : 4 },
    shadowOpacity: palette.darkMode ? 0.45 : 0.14,
    shadowRadius: palette.darkMode ? 12 : 10,
    elevation: androidElevation ?? (palette.darkMode ? 4 : 2),
  };
}

/** Debossed / recessed well style (inputs, note callouts, segmented tracks) */
export function skeuoWellStyle(
  palette: SkeuoPalette,
  radius: number = 11
): Pick<
  ViewStyle,
  | "backgroundColor"
  | "borderRadius"
  | "borderWidth"
  | "borderTopColor"
  | "borderLeftColor"
  | "borderRightColor"
  | "borderBottomColor"
> {
  return {
    backgroundColor: palette.well,
    borderRadius: radius,
    borderWidth: 1,
    borderTopColor: palette.wellBorderTop,
    borderLeftColor: palette.wellBorderTop,
    borderRightColor: palette.border,
    borderBottomColor: palette.wellBorderBottom,
  };
}

/** 3D tactile push-button style (unpressed vs pressed) */
export function skeuoButtonStyle(
  palette: SkeuoPalette,
  options: {
    fill?: string;
    highlight?: string;
    lip?: string;
    pressed?: boolean;
    neutral?: boolean;
    radius?: number;
    elevation?: number;
  } = {}
): ViewStyle {
  const { pressed = false, neutral = false, radius = 12, elevation } = options;
  const bg = neutral ? palette.btnNeutralBg : options.fill || palette.accent;
  const top = neutral
    ? palette.btnNeutralHighlight
    : options.highlight || palette.accentHighlight;
  const lip = neutral ? palette.btnNeutralLip : options.lip || palette.accentLip;
  const side = neutral ? palette.btnNeutralBorder : lip;

  if (pressed) {
    return {
      backgroundColor: bg,
      borderRadius: radius,
      borderWidth: 1,
      borderTopColor: lip,
      borderLeftColor: side,
      borderRightColor: side,
      borderBottomColor: top,
      borderBottomWidth: 1,
      transform: [{ translateY: 1.5 }],
      shadowColor: palette.shadowColor,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: palette.darkMode ? 0.25 : 0.08,
      shadowRadius: 2,
      elevation: elevation !== undefined ? Math.min(elevation, 1) : 1,
    };
  }

  return {
    backgroundColor: bg,
    borderRadius: radius,
    borderWidth: 1,
    borderTopColor: top,
    borderLeftColor: side,
    borderRightColor: side,
    borderBottomColor: lip,
    borderBottomWidth: 3,
    shadowColor: palette.shadowColor,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: palette.darkMode ? 0.42 : 0.18,
    shadowRadius: 5,
    elevation: elevation ?? 2,
  };
}

/** Engraved horizontal groove divider helper */
export function skeuoGrooveStyle(palette: SkeuoPalette): ViewStyle {
  return {
    height: 2,
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: palette.grooveDark,
    borderBottomWidth: 1,
    borderBottomColor: palette.grooveLight,
  };
}

export function triggerSkeuoHaptic(style: "light" | "medium" | "selection" = "light") {
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
    // Haptics unavailable on device
  }
}
