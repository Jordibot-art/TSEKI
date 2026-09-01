import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

// Polyfill URL only on native platforms (browser already has native URL support)
if (Platform.OS !== "web") {
  require("react-native-url-polyfill/auto");
}

const supabaseUrl = "https://gpqssirhcgelceoemysg.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwcXNzaXJoY2dlbGNlb2VteXNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTM0NzUsImV4cCI6MjEwMzc2OTQ3NX0.No_hvc_Vm9n1KgHr63BfFyqhdMtlTHP5dSSdrWKyBrQ";

// Use typeof window check instead of Platform.OS to avoid SSR "window is not defined" crash
const isClientSide = typeof window !== "undefined";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isClientSide,
  },
});