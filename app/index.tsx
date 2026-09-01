import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../supabase";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);

  // Register fields
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  // OTP Verification state
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpToken, setOtpToken] = useState("");

  // ── Handle Login ──
  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Missing fields", "Please enter both your email and password.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        Alert.alert("Login Failed", error.message);
        return;
      }

      if (data.session) {
        router.replace("/homepage");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Register ──
  async function handleRegister() {
    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert("Missing fields", "Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Password Mismatch", "Passwords do not match. Please check and try again.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak Password", "Password should be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) {
        Alert.alert("Registration Failed", error.message);
        return;
      }

      // If user is already logged in (e.g., email confirm is disabled in Supabase)
      if (data.session) {
        Alert.alert("Welcome!", "Account created successfully.");
        router.replace("/homepage");
      } else {
        // User created and requires OTP code verification
        setIsVerifyingOtp(true);
        Alert.alert(
          "Verification Code Sent! 📩",
          `We sent a 6-digit OTP code to ${email.trim()}. Please enter it below to confirm your account.`
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Verify OTP ──
  async function handleVerifyOtp() {
    if (!otpToken.trim()) {
      Alert.alert("Enter Code", "Please enter the 6-digit code sent to your email.");
      return;
    }

    setLoading(true);
    try {
      // Try verifying with signup type
      let { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpToken.trim(),
        type: "signup",
      });

      // Fallback to email type if signup type fails
      if (error) {
        const fallback = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: otpToken.trim(),
          type: "email",
        });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        Alert.alert("Verification Failed", error.message);
        return;
      }

      Alert.alert("Verified! 🎉", "Your email has been confirmed. Welcome to Tseki!");
      setIsVerifyingOtp(false);
      router.replace("/homepage");
    } catch (err: any) {
      Alert.alert("Error", err.message || "An error occurred during verification.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Resend OTP ──
  async function handleResendOtp() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
      });

      if (error) {
        Alert.alert("Resend Failed", error.message);
      } else {
        Alert.alert("Code Resent 📩", "A new OTP verification code has been sent to your email.");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not resend verification code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Logo / Brand ── */}
        <View style={styles.brandBlock}>
          <View style={styles.logoWrapper}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandName}>Tseki</Text>
          <Text style={styles.brandTagline}>Smart grading for Filipino classrooms</Text>
        </View>

        {/* ── Main Auth Card or OTP Card ── */}
        {isVerifyingOtp ? (
          /* ── OTP Verification View ── */
          <View style={styles.card}>
            <View style={styles.otpHeader}>
              <Ionicons name="mail-open-outline" size={48} color="#3B82F6" />
              <Text style={styles.otpTitle}>Verify Your Email</Text>
              <Text style={styles.otpSubtext}>
                Enter the 6-digit verification code sent to{"\n"}
                <Text style={styles.otpEmail}>{email}</Text>
              </Text>
            </View>

            <Text style={styles.label}>Verification Code (OTP)</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="key-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={6}
                value={otpToken}
                onChangeText={setOtpToken}
                editable={!loading}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed ? styles.btnPressed : null,
                loading ? styles.btnDisabled : null,
              ]}
              onPress={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Confirm Code & Continue</Text>
              )}
            </Pressable>

            <View style={styles.otpFooterRow}>
              <Pressable onPress={handleResendOtp} disabled={loading}>
                <Text style={styles.resendLink}>Resend Code</Text>
              </Pressable>
              <Text style={styles.bulletDivider}>•</Text>
              <Pressable onPress={() => setIsVerifyingOtp(false)}>
                <Text style={styles.backLink}>Back to Register</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* ── Normal Login / Register Tabs ── */
          <>
            {/* ── Tab Toggle ── */}
            <View style={styles.tabBar}>
              <Pressable
                style={[styles.tab, activeTab === "login" ? styles.tabActive : null]}
                onPress={() => setActiveTab("login")}
              >
                <Text style={[styles.tabText, activeTab === "login" ? styles.tabTextActive : null]}>
                  Log In
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, activeTab === "register" ? styles.tabActive : null]}
                onPress={() => setActiveTab("register")}
              >
                <Text style={[styles.tabText, activeTab === "register" ? styles.tabTextActive : null]}>
                  Register
                </Text>
              </Pressable>
            </View>

            {/* ── Form Card ── */}
            <View style={styles.card}>
              {activeTab === "login" ? (
                <>
                  {/* EMAIL */}
                  <Text style={styles.label}>Email</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="mail-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="you@school.edu.ph"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      value={email}
                      onChangeText={setEmail}
                      editable={!loading}
                    />
                  </View>

                  {/* PASSWORD */}
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="••••••••"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color="#9CA3AF"
                      />
                    </Pressable>
                  </View>

                  {/* FORGOT */}
                  <Pressable style={styles.forgotRow}>
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>

                  {/* LOG IN BUTTON */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      pressed ? styles.btnPressed : null,
                      loading ? styles.btnDisabled : null,
                    ]}
                    onPress={handleLogin}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Log In</Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  {/* FULL NAME */}
                  <Text style={styles.label}>Full Name</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="person-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Juan dela Cruz"
                      placeholderTextColor="#9CA3AF"
                      autoCapitalize="words"
                      value={fullName}
                      onChangeText={setFullName}
                      editable={!loading}
                    />
                  </View>

                  {/* EMAIL */}
                  <Text style={styles.label}>Email</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="mail-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="you@school.edu.ph"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      value={email}
                      onChangeText={setEmail}
                      editable={!loading}
                    />
                  </View>

                  {/* PASSWORD */}
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="••••••••"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color="#9CA3AF"
                      />
                    </Pressable>
                  </View>

                  {/* CONFIRM PASSWORD */}
                  <Text style={styles.label}>Confirm Password</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      placeholder="••••••••"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry={!showConfirm}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowConfirm(!showConfirm)} style={styles.eyeBtn}>
                      <Ionicons
                        name={showConfirm ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color="#9CA3AF"
                      />
                    </Pressable>
                  </View>

                  {/* REGISTER BUTTON */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      styles.registerBtn,
                      pressed ? styles.btnPressed : null,
                      loading ? styles.btnDisabled : null,
                    ]}
                    onPress={handleRegister}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Create Account</Text>
                    )}
                  </Pressable>
                </>
              )}
            </View>

            {/* ── Switch prompt ── */}
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>
                {activeTab === "login" ? "Don't have an account? " : "Already have an account? "}
              </Text>
              <Pressable onPress={() => setActiveTab(activeTab === "login" ? "register" : "login")}>
                <Text style={styles.switchLink}>
                  {activeTab === "login" ? "Register" : "Log In"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    width: "100%",
    minHeight: Platform.OS === "web" ? ("100vh" as any) : "100%",
  },
  scrollView: {
    flex: 1,
    width: "100%",
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
    alignItems: "center",
    width: "100%",
  },

  /* ── Brand ── */
  brandBlock: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoWrapper: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
  },
  brandName: {
    fontSize: 30,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  brandTagline: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
  },

  /* ── Tab bar ── */
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#E5E7EB",
    borderRadius: 14,
    padding: 4,
    width: "100%",
    maxWidth: 420,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
  },
  tabTextActive: {
    color: "#111827",
  },

  /* ── Card ── */
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 20,
  },

  /* ── Fields ── */
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
    marginTop: 4,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 15,
    color: "#111827",
  },
  inputFlex: {
    flex: 1,
  },
  eyeBtn: {
    padding: 4,
  },

  /* ── Forgot ── */
  forgotRow: {
    alignSelf: "flex-end",
    marginBottom: 20,
    marginTop: -6,
  },
  forgotText: {
    fontSize: 13,
    color: "#3B82F6",
    fontWeight: "600",
  },

  /* ── Buttons ── */
  primaryBtn: {
    backgroundColor: "#3B82F6",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  registerBtn: {
    marginTop: 16,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  /* ── Switch row ── */
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  switchText: {
    fontSize: 14,
    color: "#6B7280",
  },
  switchLink: {
    fontSize: 14,
    fontWeight: "700",
    color: "#3B82F6",
  },

  /* ── OTP Verification styles ── */
  otpHeader: {
    alignItems: "center",
    marginBottom: 20,
  },
  otpTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    marginTop: 12,
    marginBottom: 6,
  },
  otpSubtext: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 18,
  },
  otpEmail: {
    fontWeight: "700",
    color: "#3B82F6",
  },
  otpFooterRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    gap: 8,
  },
  resendLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3B82F6",
  },
  bulletDivider: {
    color: "#9CA3AF",
    fontSize: 14,
  },
  backLink: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },
});