import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ThemeContextType = {
  darkMode: boolean;
  themeColor: string;
  setDarkMode: (val: boolean) => void;
  setThemeColor: (val: string) => void;
};

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_THEME_COLOR = "#FF6B00";

const ThemeContext = createContext<ThemeContextType>({
  darkMode: false,
  themeColor: DEFAULT_THEME_COLOR,
  setDarkMode: () => {},
  setThemeColor: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [darkMode, _setDarkMode]     = useState(false);
  const [themeColor, _setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const [loaded, setLoaded]          = useState(false);

  // Load saved prefs on mount
  useEffect(() => {
    (async () => {
      try {
        const [dm, tc] = await AsyncStorage.multiGet(["darkMode", "themeColor"]);
        if (dm[1] !== null) _setDarkMode(dm[1] === "true");
        if (tc[1] !== null) _setThemeColor(tc[1]);
      } catch (_) {}
      setLoaded(true);
    })();
  }, []);

  async function setDarkMode(val: boolean) {
    _setDarkMode(val);
    await AsyncStorage.setItem("darkMode", String(val));
  }

  async function setThemeColor(val: string) {
    _setThemeColor(val);
    await AsyncStorage.setItem("themeColor", val);
  }

  // Don't render children until prefs are loaded (avoids flash)
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ darkMode, themeColor, setDarkMode, setThemeColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useTheme() {
  return useContext(ThemeContext);
}
