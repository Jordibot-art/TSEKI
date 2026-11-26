import { Ionicons } from "@expo/vector-icons";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GlobalAlertHost } from "../components/CustomAlertModal";
import { OfflineStatusBanner } from "../components/OfflineStatusBanner";
import { ThemeProvider } from "../context/ThemeContext";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorContainer}>
      <View style={styles.errorBezel}>
        <View style={styles.errorCard}>
          <View style={styles.errorHeader}>
            <View style={styles.errorSocket}>
              <View style={styles.errorMedallion}>
                <Ionicons name="warning-outline" size={22} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.errorHeaderText}>
              <View style={styles.errorEyebrowRow}>
                <View style={styles.errorLed} />
                <Text style={styles.errorEyebrow}>RECOVERY REQUIRED</Text>
              </View>
              <Text style={styles.errorTitle}>Something went wrong</Text>
            </View>
          </View>

          <View style={styles.errorGroove} />

          <View style={styles.errorBodyWrap}>
            <Text style={styles.errorBody}>
              TSEKI ran into an unexpected error on this screen. Your saved classrooms and grades are safe.
            </Text>
            {!!error?.message && (
              <View style={styles.errorDetailWell}>
                <Text style={styles.errorDetail} numberOfLines={4}>
                  {error.message}
                </Text>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.retryButtonPressed,
              ]}
              onPress={retry}
            >
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Reload Screen</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade_from_bottom",
              animationDuration: 220,
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="homepage" />
            <Stack.Screen name="classroom" />
            <Stack.Screen name="settings" />
          </Stack>
          <OfflineStatusBanner />
          <GlobalAlertHost />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#EAE7E1",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorBezel: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#DDD8CE",
    borderRadius: 23,
    padding: 5,
    borderWidth: 1,
    borderTopColor: "#FFFFFF",
    borderLeftColor: "#C5BEB1",
    borderRightColor: "#C5BEB1",
    borderBottomColor: "#ABA497",
    borderBottomWidth: 3,
    shadowColor: "#1C1917",
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  errorCard: {
    width: "100%",
    backgroundColor: "#F9F7F3",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderTopColor: "#FFFFFF",
    borderLeftColor: "#D4CFC5",
    borderRightColor: "#D4CFC5",
    borderBottomColor: "#C3BCB0",
    borderBottomWidth: 2,
  },
  errorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F1EEE8",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  errorSocket: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#F8E5BE",
    borderWidth: 1,
    borderTopColor: "#DDAE57",
    borderLeftColor: "#DDAE57",
    borderRightColor: "#E5C17B",
    borderBottomColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  errorMedallion: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#D97706",
    borderTopWidth: 1,
    borderTopColor: "#FBBF24",
    borderBottomWidth: 2,
    borderBottomColor: "#92400E",
    justifyContent: "center",
    alignItems: "center",
  },
  errorHeaderText: {
    flex: 1,
  },
  errorEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  errorLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#F59E0B",
  },
  errorEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: "#92400E",
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1C1917",
  },
  errorGroove: {
    height: 2,
    borderTopWidth: 1,
    borderTopColor: "rgba(28, 25, 23, 0.13)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.85)",
  },
  errorBodyWrap: {
    padding: 18,
  },
  errorBody: {
    fontSize: 14,
    color: "#57534E",
    lineHeight: 20,
    marginBottom: 14,
  },
  errorDetailWell: {
    backgroundColor: "#E5E1D9",
    borderRadius: 10,
    borderWidth: 1,
    borderTopColor: "#BFB8AB",
    borderLeftColor: "#BFB8AB",
    borderRightColor: "#D4CFC5",
    borderBottomColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 16,
  },
  errorDetail: {
    fontSize: 12,
    color: "#9A3412",
    lineHeight: 17,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EA580C",
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: "#FB923C",
    borderLeftColor: "#9A3412",
    borderRightColor: "#9A3412",
    borderBottomColor: "#9A3412",
    borderBottomWidth: 3,
    paddingHorizontal: 22,
    paddingVertical: 12,
    width: "100%",
    shadowColor: "#1C1917",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  retryButtonPressed: {
    transform: [{ translateY: 1.5 }],
    borderBottomWidth: 1,
    borderTopColor: "#9A3412",
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
