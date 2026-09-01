import { Stack } from "expo-router";
import { ThemeProvider } from "../context/ThemeContext";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="homepage" />
        <Stack.Screen name="classroom" />
        <Stack.Screen name="settings" />
      </Stack>
    </ThemeProvider>
  );
}
