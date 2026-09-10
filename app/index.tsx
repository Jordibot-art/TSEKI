import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../supabase";
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";

type AuthView = "welcome" | "login" | "register" | "otp";

// ── Orange & White Theme Palette ────────────────────────────────
const ORANGE = "#FF6B00";
const ORANGE_LIGHT = "#FFF7ED";

export default function AuthScreen() {
  const router = useRouter();

  // Navigation State
  const [currentView, setCurrentView] = useState<AuthView>("welcome");

  // Common State
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Login Form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Register Form
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [registerConfirm, setRegisterConfirm] = useState("");
  const [showRegisterConfirm, setShowRegisterConfirm] = useState(false);

  // OTP Form (Single unified 6-digit master token)
  const [otpToken, setOtpToken] = useState("");
  const [isOtpFocused, setIsOtpFocused] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(60);
  const hiddenOtpInputRef = useRef<TextInput | null>(null);

  // Forgot Password Modal
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const [checkingSession, setCheckingSession] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const rememberMePref = await AsyncStorage.getItem("tseki_remember_me");
        const { data: { session } } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session) {
          if (rememberMePref === "true") {
            router.replace("/homepage");
            return;
          } else {
            // User did not select "Remember me": sign out on app reopen
            await supabase.auth.signOut();
          }
        }
      } catch (err) {
        console.error("Session check error:", err);
      } finally {
        if (isMounted) {
          setCheckingSession(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer: any = null;
    if (currentView === "otp" && resendCountdown > 0) {
      timer = setInterval(() => {
        setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [currentView, resendCountdown]);

  // ── Handle Login ──────────────────────────────────────────────
  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword) {
      Alert.alert("Missing Fields", "Please enter both your email and password.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) {
        Alert.alert("Login Failed", error.message);
        return;
      }

      if (data.session) {
        await AsyncStorage.setItem("tseki_remember_me", rememberMe ? "true" : "false");
        router.replace("/homepage");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Register ───────────────────────────────────────────
  async function handleRegister() {
    if (
      !registerName.trim() ||
      !registerEmail.trim() ||
      !registerPassword ||
      !registerConfirm
    ) {
      Alert.alert("Missing Fields", "Please fill in all fields to create your account.");
      return;
    }

    if (registerPassword !== registerConfirm) {
      Alert.alert("Password Mismatch", "Passwords do not match. Please verify and try again.");
      return;
    }

    if (registerPassword.length < 6) {
      Alert.alert("Weak Password", "Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: registerEmail.trim(),
        password: registerPassword,
        options: {
          data: {
            full_name: registerName.trim(),
          },
        },
      });

      if (error) {
        Alert.alert("Registration Failed", error.message);
        return;
      }

      if (data.session) {
        Alert.alert("Welcome to TSEKI! 🎉", "Your account has been created.");
        router.replace("/homepage");
      } else {
        // Verification OTP required
        setOtpToken("");
        setResendCountdown(60);
        setCurrentView("otp");
        Alert.alert(
          "Verification Code Sent 📩",
          `A 6-digit OTP has been sent to ${registerEmail.trim()}. Enter it below to confirm your account.`
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Verify OTP ─────────────────────────────────────────
  async function handleVerifyOtp() {
    const token = otpToken.trim();
    const targetEmail = registerEmail.trim() || loginEmail.trim();

    if (token.length < 6) {
      Alert.alert("Enter Code", "Please enter the complete 6-digit verification code.");
      return;
    }

    setLoading(true);
    try {
      let { data, error } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token,
        type: "signup",
      });

      if (error) {
        const fallback = await supabase.auth.verifyOtp({
          email: targetEmail,
          token,
          type: "email",
        });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        Alert.alert("Verification Failed", error.message);
        return;
      }

      Alert.alert("Verified! 🎉", "Your account is active. Welcome to Tseki!");
      router.replace("/homepage");
    } catch (err: any) {
      Alert.alert("Error", err.message || "An error occurred during verification.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Resend OTP ─────────────────────────────────────────
  async function handleResendOtp() {
    if (resendCountdown > 0) return;
    const targetEmail = registerEmail.trim() || loginEmail.trim();
    if (!targetEmail) {
      Alert.alert("Error", "No email address found for resending.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
      });

      if (error) {
        Alert.alert("Resend Failed", error.message);
      } else {
        setOtpToken("");
        setResendCountdown(60);
        Alert.alert("Code Resent 📩", `A new OTP has been sent to ${targetEmail}.`);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not resend code.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Forgot Password ────────────────────────────────────
  async function handleForgotPasswordSubmit() {
    if (!forgotEmail.trim()) {
      Alert.alert("Missing Email", "Please enter your registered email address.");
      return;
    }

    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim());
      if (error) {
        Alert.alert("Request Failed", error.message);
      } else {
        Alert.alert(
          "Check Your Email 📩",
          `Instructions to reset your password have been sent to ${forgotEmail.trim()}.`
        );
        setForgotModalVisible(false);
        setForgotEmail("");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setForgotLoading(false);
    }
  }



  if (checkingSession) {
    return (
      <View style={[styles.root, styles.centeredLoading]}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cardContainer}>
          {/* ══════════════════════════════════════════════════════
              SCREEN 1: WELCOME / INTRO ("Hello !")
             ══════════════════════════════════════════════════════ */}
          {currentView === "welcome" && (
            <View style={styles.welcomeView}>
              {/* Brand mark top left */}
              <View style={styles.topBrandRow}>
                <View style={styles.brandMarkCircle}>
                  <View style={styles.brandMarkInnerDot} />
                </View>
                <Text style={styles.brandMarkText}>TSEKI</Text>
              </View>

              {/* Logo Mascot Presentation */}
              <View style={styles.heroLogoContainer}>
                <AnimatedTsekiLogo size={210} />
              </View>

              {/* Title & Subtitle */}
              <View style={styles.welcomeTextContainer}>
                <Text style={styles.helloTitle}>Hello !</Text>
                <Text style={styles.helloSubtitle}>
                  Best place to grade, manage classrooms and share your learning experiences
                </Text>
              </View>

              {/* Action Buttons (Orange & White combination) */}
              <View style={styles.welcomeActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.primarySolidBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setCurrentView("login")}
                >
                  <Text style={styles.primarySolidBtnText}>LOGIN</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryOutlineBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => setCurrentView("register")}
                >
                  <Text style={styles.secondaryOutlineBtnText}>SIGNUP</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ══════════════════════════════════════════════════════
              SCREEN 2: LOGIN ("Welcome!")
             ══════════════════════════════════════════════════════ */}
          {currentView === "login" && (
            <View style={styles.screenInner}>
              {/* Back Arrow */}
              <Pressable
                style={styles.backButton}
                onPress={() => setCurrentView("welcome")}
                hitSlop={12}
              >
                <Ionicons name="arrow-back" size={26} color="#181920" />
              </Pressable>

              {/* Header */}
              <View style={styles.headerBlock}>
                <Text style={styles.screenTitle}>Welcome!</Text>
                <Text style={styles.screenSubtitle}>Sign in to continue</Text>
              </View>

              {/* Underline Inputs */}
              <View style={styles.inputsBlock}>
                {/* Email */}
                <View
                  style={[
                    styles.underlineWrapper,
                    focusedField === "loginEmail" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={styles.underlineInput}
                    placeholder="amishkr@gmail.com"
                    placeholderTextColor="#9EA0B4"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    onFocus={() => setFocusedField("loginEmail")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                </View>

                {/* Password */}
                <View
                  style={[
                    styles.underlineWrapper,
                    styles.passwordUnderlineWrapper,
                    focusedField === "loginPassword" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={[styles.underlineInput, styles.passwordFlexInput]}
                    placeholder="••••••••"
                    placeholderTextColor="#9EA0B4"
                    secureTextEntry={!showLoginPassword}
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                    onFocus={() => setFocusedField("loginPassword")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                  <Pressable
                    style={styles.eyeToggleBtn}
                    onPress={() => setShowLoginPassword(!showLoginPassword)}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={showLoginPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="#8E8EA8"
                    />
                  </Pressable>
                </View>
              </View>

              {/* Options: Remember Me & Forgot Password */}
              <View style={styles.rememberForgotRow}>
                <Pressable
                  style={styles.rememberMeContainer}
                  onPress={() => setRememberMe((prev) => !prev)}
                  hitSlop={8}
                  accessible={true}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberMe }}
                >
                  <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                    {rememberMe && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                  </View>
                  <Text style={styles.rememberMeText}>Remember me</Text>
                </Pressable>

                <Pressable
                  style={styles.forgotPassBtn}
                  onPress={() => {
                    setForgotEmail(loginEmail);
                    setForgotModalVisible(true);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.forgotPassText}>Forgot Password?</Text>
                </Pressable>
              </View>

              {/* Action Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.primarySolidBtn,
                  styles.actionSubmitBtn,
                  pressed && styles.btnPressed,
                  loading && styles.btnDisabled,
                ]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primarySolidBtnText}>LOGIN</Text>
                )}
              </Pressable>

              {/* Footer switch to Sign up */}
              <View style={styles.footerSwitchRow}>
                <Text style={styles.footerSwitchText}>Don't have an account? </Text>
                <Pressable onPress={() => setCurrentView("register")}>
                  <Text style={styles.footerSwitchLink}>Sign up</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ══════════════════════════════════════════════════════
              SCREEN 3: REGISTER ("Hi!")
             ══════════════════════════════════════════════════════ */}
          {currentView === "register" && (
            <View style={styles.screenInner}>
              {/* Back Arrow */}
              <Pressable
                style={styles.backButton}
                onPress={() => setCurrentView("welcome")}
                hitSlop={12}
              >
                <Ionicons name="arrow-back" size={26} color="#181920" />
              </Pressable>

              {/* Header */}
              <View style={styles.headerBlock}>
                <Text style={styles.screenTitle}>Hi!</Text>
                <Text style={styles.screenSubtitle}>Create a new account</Text>
              </View>

              {/* Underline Inputs */}
              <View style={styles.inputsBlock}>
                {/* Username / Full Name */}
                <View
                  style={[
                    styles.underlineWrapper,
                    focusedField === "regName" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={styles.underlineInput}
                    placeholder="Amish567"
                    placeholderTextColor="#9EA0B4"
                    autoCapitalize="words"
                    value={registerName}
                    onChangeText={setRegisterName}
                    onFocus={() => setFocusedField("regName")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                </View>

                {/* Email */}
                <View
                  style={[
                    styles.underlineWrapper,
                    focusedField === "regEmail" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={styles.underlineInput}
                    placeholder="amishkr@gmail.com"
                    placeholderTextColor="#9EA0B4"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={registerEmail}
                    onChangeText={setRegisterEmail}
                    onFocus={() => setFocusedField("regEmail")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                </View>

                {/* Password */}
                <View
                  style={[
                    styles.underlineWrapper,
                    styles.passwordUnderlineWrapper,
                    focusedField === "regPassword" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={[styles.underlineInput, styles.passwordFlexInput]}
                    placeholder="••••••••"
                    placeholderTextColor="#9EA0B4"
                    secureTextEntry={!showRegisterPassword}
                    value={registerPassword}
                    onChangeText={setRegisterPassword}
                    onFocus={() => setFocusedField("regPassword")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                  <Pressable
                    style={styles.eyeToggleBtn}
                    onPress={() => setShowRegisterPassword(!showRegisterPassword)}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={showRegisterPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="#8E8EA8"
                    />
                  </Pressable>
                </View>

                {/* Confirm Password */}
                <View
                  style={[
                    styles.underlineWrapper,
                    styles.passwordUnderlineWrapper,
                    focusedField === "regConfirm" && styles.underlineWrapperFocused,
                  ]}
                >
                  <TextInput
                    style={[styles.underlineInput, styles.passwordFlexInput]}
                    placeholder="Confirm password"
                    placeholderTextColor="#9EA0B4"
                    secureTextEntry={!showRegisterConfirm}
                    value={registerConfirm}
                    onChangeText={setRegisterConfirm}
                    onFocus={() => setFocusedField("regConfirm")}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                  <Pressable
                    style={styles.eyeToggleBtn}
                    onPress={() => setShowRegisterConfirm(!showRegisterConfirm)}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={showRegisterConfirm ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="#8E8EA8"
                    />
                  </Pressable>
                </View>
              </View>

              {/* Action Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.primarySolidBtn,
                  styles.actionSubmitBtn,
                  pressed && styles.btnPressed,
                  loading && styles.btnDisabled,
                ]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primarySolidBtnText}>SIGN UP</Text>
                )}
              </Pressable>

              {/* Footer switch to Sign in */}
              <View style={styles.footerSwitchRow}>
                <Text style={styles.footerSwitchText}>Already have an account? </Text>
                <Pressable onPress={() => setCurrentView("login")}>
                  <Text style={styles.footerSwitchLink}>Sign in</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ══════════════════════════════════════════════════════
              SCREEN 4: OTP VERIFICATION ("Verification")
             ══════════════════════════════════════════════════════ */}
          {currentView === "otp" && (
            <View style={styles.screenInner}>
              {/* Back Arrow */}
              <Pressable
                style={styles.backButton}
                onPress={() => setCurrentView("register")}
                hitSlop={12}
              >
                <Ionicons name="arrow-back" size={26} color="#181920" />
              </Pressable>

              {/* Header */}
              <View style={styles.headerBlock}>
                <Text style={styles.screenTitle}>Verification</Text>
                <Text style={styles.screenSubtitle}>
                  Enter the 6-digit code sent to{"\n"}
                  <Text style={styles.highlightEmail}>
                    {registerEmail.trim() || loginEmail.trim()}
                  </Text>
                </Text>
              </View>

              {/* ── Single Master Input with 6 Display Cells ── */}
              <View style={styles.otpInputContainer}>
                {/* Single invisible master input handling all inputs, backspaces, pastes, and autofills */}
                <TextInput
                  ref={hiddenOtpInputRef}
                  style={styles.hiddenOtpInput}
                  value={otpToken}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, "").slice(0, 6);
                    setOtpToken(cleaned);
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  autoFocus={false}
                  caretHidden={true}
                  onFocus={() => setIsOtpFocused(true)}
                  onBlur={() => setIsOtpFocused(false)}
                  editable={!loading}
                />

                {/* 6 Visual Display Cells */}
                <Pressable
                  style={styles.otpGridRow}
                  onPress={() => hiddenOtpInputRef.current?.focus()}
                >
                  {[0, 1, 2, 3, 4, 5].map((idx) => {
                    const digit = otpToken[idx] || "";
                    const isCurrent =
                      isOtpFocused &&
                      (otpToken.length === idx || (idx === 5 && otpToken.length === 6));
                    const isFilled = digit.length > 0;

                    return (
                      <View
                        key={idx}
                        style={[
                          styles.otpCellBox,
                          isCurrent && styles.otpCellBoxFocused,
                          isFilled && styles.otpCellBoxFilled,
                        ]}
                      >
                        <Text style={styles.otpCellText}>{digit}</Text>
                        {isCurrent && otpToken.length < 6 && (
                          <View style={styles.otpCursorBar} />
                        )}
                      </View>
                    );
                  })}
                </Pressable>
              </View>

              {/* Action Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.primarySolidBtn,
                  styles.actionSubmitBtn,
                  pressed && styles.btnPressed,
                  loading && styles.btnDisabled,
                ]}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primarySolidBtnText}>VERIFY</Text>
                )}
              </Pressable>

              {/* Resend Section */}
              <View style={styles.resendSection}>
                <Text style={styles.resendNoticeText}>Didn't receive the code?</Text>
                {resendCountdown > 0 ? (
                  <Text style={styles.resendTimerText}>
                    Resend OTP in{" "}
                    <Text style={styles.resendTimerHighlight}>{resendCountdown}s</Text>
                  </Text>
                ) : (
                  <Pressable onPress={handleResendOtp} disabled={loading}>
                    <Text style={styles.resendActiveBtnText}>Resend OTP</Text>
                  </Pressable>
                )}
              </View>

              {/* Switch / Back link */}
              <View style={[styles.footerSwitchRow, { marginTop: 32 }]}>
                <Pressable onPress={() => setCurrentView("login")}>
                  <Text style={styles.footerSwitchLink}>Back to Login</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── Forgot Password Modal ── */}
        <Modal
          visible={forgotModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setForgotModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Reset Password</Text>
                <Pressable
                  onPress={() => setForgotModalVisible(false)}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={24} color="#6B7280" />
                </Pressable>
              </View>

              <Text style={styles.modalSubtitle}>
                Enter the email address associated with your account and we'll send you a password reset link.
              </Text>

              <View
                style={[
                  styles.underlineWrapper,
                  focusedField === "forgotEmail" && styles.underlineWrapperFocused,
                  { marginBottom: 24 },
                ]}
              >
                <TextInput
                  style={styles.underlineInput}
                  placeholder="amishkr@gmail.com"
                  placeholderTextColor="#9EA0B4"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  onFocus={() => setFocusedField("forgotEmail")}
                  onBlur={() => setFocusedField(null)}
                  editable={!forgotLoading}
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primarySolidBtn,
                  pressed && styles.btnPressed,
                  forgotLoading && styles.btnDisabled,
                ]}
                onPress={handleForgotPasswordSubmit}
                disabled={forgotLoading}
              >
                {forgotLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primarySolidBtnText}>SEND RESET LINK</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    width: "100%",
    minHeight: Platform.OS === "web" ? ("100vh" as any) : "100%",
  },
  centeredLoading: {
    alignItems: "center",
    justifyContent: "center",
  },
  scrollView: {
    flex: 1,
    width: "100%",
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Platform.OS === "web" ? 36 : 24,
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
  },
  cardContainer: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#FFFFFF",
    alignSelf: "center",
  },

  /* ══════════════════════════════════════════════════════════════
     SCREEN 1: WELCOME SCREEN STYLES
     ══════════════════════════════════════════════════════════════ */
  welcomeView: {
    width: "100%",
    paddingTop: Platform.OS === "web" ? 10 : 20,
    paddingBottom: 24,
  },
  topBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  brandMarkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandMarkInnerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: ORANGE,
  },
  brandMarkText: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#181920",
  },
  heroLogoContainer: {
    width: "100%",
    height: 240,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 14,
  },
  heroLogoImage: {
    width: 210,
    height: 210,
  },
  welcomeTextContainer: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  helloTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#181920",
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  helloSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: "#8E8EA8",
    textAlign: "center",
    maxWidth: 290,
  },
  welcomeActions: {
    width: "100%",
    gap: 14,
  },
  primarySolidBtn: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 4,
  },
  primarySolidBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  secondaryOutlineBtn: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.8,
    borderColor: ORANGE,
    borderRadius: 12,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryOutlineBtnText: {
    color: ORANGE,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnDisabled: {
    opacity: 0.65,
  },

  /* ══════════════════════════════════════════════════════════════
     SCREENS 2 & 3: FORM SHARED STYLES
     ══════════════════════════════════════════════════════════════ */
  screenInner: {
    width: "100%",
    paddingTop: 12,
    paddingBottom: 24,
  },
  backButton: {
    alignSelf: "flex-start",
    padding: 6,
    marginLeft: -6,
    marginBottom: 28,
  },
  headerBlock: {
    marginBottom: 36,
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#181920",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  screenSubtitle: {
    fontSize: 14,
    color: "#8E8EA8",
    lineHeight: 20,
  },
  highlightEmail: {
    color: ORANGE,
    fontWeight: "700",
  },

  /* ── Minimalist Underline Inputs ── */
  inputsBlock: {
    width: "100%",
    marginBottom: 20,
    gap: 22,
  },
  underlineWrapper: {
    borderBottomWidth: 1.4,
    borderBottomColor: "#E2E4EA",
    paddingBottom: 6,
  },
  underlineWrapperFocused: {
    borderBottomColor: ORANGE,
    borderBottomWidth: 2,
  },
  underlineInput: {
    fontSize: 15,
    color: "#181920",
    paddingVertical: 8,
    paddingHorizontal: 0,
    outlineWidth: 0 as any,
  },
  passwordUnderlineWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  passwordFlexInput: {
    flex: 1,
  },
  eyeToggleBtn: {
    padding: 6,
  },

  /* ── Remember Me & Forgot Password ── */
  rememberForgotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 24,
  },
  rememberMeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.6,
    borderColor: "#C4C7D4",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  rememberMeText: {
    fontSize: 13,
    color: "#5A5D72",
    fontWeight: "500",
  },
  forgotPassBtn: {
    paddingVertical: 2,
  },

  /* ── Action Submit ── */
  actionSubmitBtn: {
    width: "100%",
  },

  /* ── Forgot Password ── */
  forgotPassText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#181920",
  },



  /* ── Footer Switch ── */
  footerSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
  },
  footerSwitchText: {
    fontSize: 13,
    color: "#8E8EA8",
  },
  footerSwitchLink: {
    fontSize: 13,
    fontWeight: "700",
    color: ORANGE,
  },

  /* ══════════════════════════════════════════════════════════════
     SCREEN 4: OTP STYLES (Single unified input + 6 cells)
     ══════════════════════════════════════════════════════════════ */
  otpInputContainer: {
    width: "100%",
    position: "relative",
    marginVertical: 30,
  },
  hiddenOtpInput: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    opacity: 0.01,
    zIndex: 10,
  },
  otpGridRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    gap: 8,
  },
  otpCellBox: {
    flex: 1,
    maxWidth: 52,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E2E4EA",
    backgroundColor: "#FAFAFC",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  otpCellBoxFocused: {
    borderColor: ORANGE,
    backgroundColor: ORANGE_LIGHT,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  otpCellBoxFilled: {
    borderColor: ORANGE,
    backgroundColor: "#FFFFFF",
  },
  otpCellText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#181920",
    textAlign: "center",
  },
  otpCursorBar: {
    position: "absolute",
    width: 2,
    height: 22,
    backgroundColor: ORANGE,
    borderRadius: 1,
  },
  resendSection: {
    alignItems: "center",
    marginTop: 24,
    gap: 6,
  },
  resendNoticeText: {
    fontSize: 13,
    color: "#8E8EA8",
  },
  resendTimerText: {
    fontSize: 13,
    color: "#8E8EA8",
  },
  resendTimerHighlight: {
    fontWeight: "700",
    color: ORANGE,
  },
  resendActiveBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: ORANGE,
  },

  /* ══════════════════════════════════════════════════════════════
     MODAL STYLES (Forgot Password)
     ══════════════════════════════════════════════════════ */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#181920",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#8E8EA8",
    lineHeight: 19,
    marginBottom: 24,
  },
});