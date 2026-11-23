import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type NetworkListener = (offline: boolean) => void;
const listeners = new Set<NetworkListener>();
let globalOffline = false;

/**
 * Allows services (e.g., Supabase sync helpers) to immediately signal offline/online
 * transitions without requiring an additional native module.
 */
export function notifyNetworkStatus(offline: boolean) {
  if (globalOffline === offline) return;
  globalOffline = offline;
  listeners.forEach((cb) => cb(offline));
}

async function probeConnectivity(): Promise<boolean> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const probeUrl = supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/health`
    : "https://clients3.google.com/generate_204";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(probeUrl, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function OfflineStatusBanner() {
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(globalOffline);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const online = await probeConnectivity();
      notifyNetworkStatus(!online);
      if (online) {
        setDismissed(false);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const handler: NetworkListener = (offline) => {
      setIsOffline(offline);
      if (offline) setDismissed(false);
    };
    listeners.add(handler);

    // Web browser online/offline events
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onOnline = () => notifyNetworkStatus(false);
      const onOffline = () => notifyNetworkStatus(true);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        notifyNetworkStatus(true);
      }
      return () => {
        listeners.delete(handler);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }

    // Native: lightweight check on mount and when returning to foreground
    void checkNow();
    const appSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkNow();
      }
    });

    return () => {
      listeners.delete(handler);
      appSub.remove();
    };
  }, [checkNow]);

  if (!isOffline || dismissed) return null;

  return (
    <View
      style={[
        styles.bannerWrap,
        { paddingTop: Math.max(insets.top, 8) + 4 },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={16} color="#92400E" />
        <Text style={styles.bannerText} numberOfLines={2}>
          Offline mode — local grades &amp; drafts are cached and will sync when reconnected.
        </Text>
        <Pressable
          onPress={checkNow}
          disabled={checking}
          style={styles.retryBtn}
          hitSlop={6}
        >
          <Text style={styles.retryText}>{checking ? "..." : "Retry"}</Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
          <Ionicons name="close" size={16} color="#92400E" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998,
    paddingHorizontal: 12,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#92400E",
    lineHeight: 16,
  },
  retryBtn: {
    backgroundColor: "#F59E0B",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
