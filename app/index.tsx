import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";
import {
  AuthInput,
  formatSubjectsSummaryDisplay,
  getAuthTheme,
} from "../components/auth/AuthInput";
import { TeacherRegistrationStep1 } from "../components/auth/TeacherRegistrationStep1";
import { TeacherVerificationStep2 } from "../components/auth/TeacherVerificationStep2";
import {
  getSkeuoPalette,
  skeuoButtonStyle,
  skeuoCardStyle,
  skeuoWellStyle,
  triggerSkeuoHaptic,
} from "../components/skeuoTheme";
import { useTheme } from "../context/ThemeContext";
import {
  cancelIncompleteTeacherRegistration,
  submitTeacherVerification,
  type VerificationPhotoSet,
} from "../lib/teacherVerificationUpload";
import { checkTeacherAccountApproval } from "../shared/teacherApproval";
import {
  DEFAULT_SCHOOL_NAME,
  extractProfileFromUserMetadata,
  validateRegistrationStep1,
  type TeacherRegistrationProfile,
  type TeacherRegistrationStep1Data,
} from "../shared/teacherRegistration";
import { supabase } from "../supabase";

type AuthView =
  | "welcome"
  | "login"
  | "register"
  | "otp"
  | "verify_identity"
  | "pending_approval";

const ORANGE = "#EA580C";

const INITIAL_STEP1_FORM: TeacherRegistrationStep1Data = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  schoolName: DEFAULT_SCHOOL_NAME,
  teacherId: "",
  gradeLevels: [],
  subjects: [],
  password: "",
  confirmPassword: "",
};

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { darkMode } = useTheme();
  const theme = getAuthTheme(darkMode);
  const skeuo = getSkeuoPalette(darkMode, ORANGE);

  // Navigation State
  const [currentView, setCurrentView] = useState<AuthView>("welcome");

  // Common State
  const [loading, setLoading] = useState(false);

  // Login Form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // 2-Step Register Form
  const [regForm, setRegForm] =
    useState<TeacherRegistrationStep1Data>(INITIAL_STEP1_FORM);
  const [verifiedProfile, setVerifiedProfile] =
    useState<TeacherRegistrationProfile | null>(null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [submittingDocs, setSubmittingDocs] = useState(false);
  const [cancellingReg, setCancellingReg] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");

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

  function enterStep2Identity(
    userId: string,
    meta?: Record<string, unknown> | null,
    fallbackEmail?: string
  ) {
    const profile =
      verifiedProfile ||
      extractProfileFromUserMetadata(meta, fallbackEmail || regForm.email) || {
        firstName: regForm.firstName.trim(),
        middleName: regForm.middleName.trim(),
        lastName: regForm.lastName.trim(),
        fullName:
          [regForm.firstName, regForm.middleName, regForm.lastName]
            .map((s) => s.trim())
            .filter(Boolean)
            .join(" ") || "Teacher",
        email: (fallbackEmail || regForm.email).trim(),
        schoolName: regForm.schoolName || DEFAULT_SCHOOL_NAME,
        teacherId: regForm.teacherId.trim(),
        gradeLevels: regForm.gradeLevels,
        gradeLevelSummary: regForm.gradeLevels.join(", "),
        subjects: regForm.subjects,
        subjectsSummary: regForm.subjects.join(", "),
      };
    setVerifiedUserId(userId);
    setVerifiedProfile(profile);
    setCurrentView("verify_identity");
  }

  // Check existing session on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const rememberMePref = await AsyncStorage.getItem("tseki_remember_me");
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session) {
          const userMeta = (session.user?.user_metadata || {}) as Record<
            string,
            unknown
          >;
          const approval = await checkTeacherAccountApproval(
            supabase,
            session.user?.id,
            userMeta
          );
          if (!isMounted) return;

          if (approval.needsIdentityVerification && session.user?.id) {
            enterStep2Identity(
              session.user.id,
              userMeta,
              session.user.email || ""
            );
            return;
          }

          if (rememberMePref === "true") {
            if (!approval.allowed) {
              await supabase.auth.signOut();
              Alert.alert(
                approval.title || "Account Not Approved",
                approval.message ||
                  "Your teacher account is not currently active."
              );
            } else {
              router.replace("/homepage");
              return;
            }
          } else {
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
      Alert.alert(
        "Missing Fields",
        "Please enter both your email and password."
      );
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
        const userMeta = (data.session.user?.user_metadata || {}) as Record<
          string,
          unknown
        >;
        const approval = await checkTeacherAccountApproval(
          supabase,
          data.session.user?.id,
          userMeta
        );

        if (approval.needsIdentityVerification && data.session.user?.id) {
          enterStep2Identity(
            data.session.user.id,
            userMeta,
            data.session.user.email || loginEmail.trim()
          );
          return;
        }

        if (!approval.allowed) {
          await supabase.auth.signOut();
          Alert.alert(
            approval.title || "Account Not Approved",
            approval.message || "Your teacher account is not currently active."
          );
          return;
        }
        await AsyncStorage.setItem(
          "tseki_remember_me",
          rememberMe ? "true" : "false"
        );
        router.replace("/homepage");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Register Step 1 ────────────────────────────────────
  async function handleRegisterStep1() {
    const validated = validateRegistrationStep1(regForm);
    if (!validated.ok || !validated.profile) {
      Alert.alert(
        "Check Your Details",
        validated.error || "Please complete all required fields."
      );
      return;
    }

    const profile = validated.profile;
    setLoading(true);
    try {
      const username =
        profile.email.split("@")[0] || profile.firstName.toLowerCase();
      const step1Metadata = {
        full_name: profile.fullName,
        first_name: profile.firstName,
        middle_name: profile.middleName || null,
        last_name: profile.lastName,
        username,
        school_name: profile.schoolName,
        teacher_id: profile.teacherId,
        grade_level: profile.gradeLevelSummary,
        grade_levels: profile.gradeLevels,
        subject: profile.subjectsSummary,
        strand: profile.subjectsSummary,
        subjects: profile.subjects,
        needs_identity_verification: true,
      };
      const { data, error } = await supabase.auth.signUp({
        email: profile.email,
        password: regForm.password,
        options: {
          data: step1Metadata,
        },
      });

      const isAlreadyRegistered =
        Boolean(
          error &&
            error.message.toLowerCase().includes("already registered")
        ) ||
        Boolean(
          !error &&
            data.user &&
            Array.isArray(data.user.identities) &&
            data.user.identities.length === 0
        );

      if (isAlreadyRegistered) {
        // If an abandoned incomplete Step 1 account exists with the same password,
        // update its details and resume directly into Step 2 instead of dead-ending.
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email: profile.email,
          password: regForm.password,
        });
        if (signInData?.session?.user?.id) {
          const existingMeta = (signInData.session.user.user_metadata ||
            {}) as Record<string, unknown>;
          const approval = await checkTeacherAccountApproval(
            supabase,
            signInData.session.user.id,
            existingMeta
          );
          if (approval.needsIdentityVerification) {
            await supabase.auth.updateUser({ data: step1Metadata });
            setVerifiedProfile(profile);
            setVerifiedUserId(signInData.session.user.id);
            setCurrentView("verify_identity");
            return;
          }
          await supabase.auth.signOut();
          Alert.alert(
            "Email Already Registered",
            "An account with this email already exists. Please sign in instead."
          );
          return;
        }
        Alert.alert(
          "Email Already Registered",
          "An account with this email already exists. If you did not finish Step 2, sign in with your previous password to continue or cancel registration."
        );
        return;
      }

      if (error) {
        Alert.alert("Registration Failed", error.message);
        return;
      }

      setVerifiedProfile(profile);

      if (data.session?.user?.id) {
        setVerifiedUserId(data.session.user.id);
        setCurrentView("verify_identity");
      } else {
        setOtpToken("");
        setResendCountdown(60);
        setCurrentView("otp");
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
    const targetEmail = regForm.email.trim() || loginEmail.trim();

    if (token.length < 6) {
      Alert.alert(
        "Enter Code",
        "Please enter the complete 6-digit verification code."
      );
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

      const authedUser =
        data?.user || (await supabase.auth.getUser()).data?.user;
      const userMeta = (authedUser?.user_metadata || {}) as Record<
        string,
        unknown
      >;
      const approval = await checkTeacherAccountApproval(
        supabase,
        authedUser?.id,
        userMeta
      );

      // Step 2: Upload Physical Teacher ID (Front & Back) + Face Selfie
      if (approval.needsIdentityVerification && authedUser?.id) {
        enterStep2Identity(
          authedUser.id,
          userMeta,
          authedUser.email || targetEmail
        );
        return;
      }

      if (!approval.allowed) {
        await supabase.auth.signOut();
        Alert.alert(
          approval.title || "Account Not Approved",
          approval.message ||
            "Your teacher account is pending administrator approval."
        );
        setCurrentView("login");
        return;
      }

      router.replace("/homepage");
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.message || "An error occurred during verification."
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Step 2 Photo Submission ────────────────────────────
  async function handleSubmitIdentityPhotos(photos: VerificationPhotoSet) {
    const activeUserId =
      verifiedUserId ||
      (await supabase.auth.getSession()).data?.session?.user?.id;

    if (!activeUserId || !verifiedProfile) {
      Alert.alert(
        "Session Expired",
        "Please sign in again to finish uploading your verification photos."
      );
      setCurrentView("login");
      return;
    }

    setSubmittingDocs(true);
    setUploadProgressText("Uploading Teacher ID (Front)...");
    try {
      await submitTeacherVerification({
        userId: activeUserId,
        profile: verifiedProfile,
        photos,
        onProgress: (msg) => setUploadProgressText(msg),
      });

      // Keep unapproved session signed out until Admin approves in Admin Portal
      await supabase.auth.signOut();
      setRegForm(INITIAL_STEP1_FORM);
      setCurrentView("pending_approval");
    } catch (err: any) {
      Alert.alert(
        "Verification Upload Failed",
        err?.message ||
          "Could not upload your verification photos. Please try again."
      );
    } finally {
      setSubmittingDocs(false);
      setUploadProgressText("");
    }
  }

  // ── Handle Resend OTP ─────────────────────────────────────────
  async function handleResendOtp() {
    if (resendCountdown > 0) return;
    const targetEmail = regForm.email.trim() || loginEmail.trim();
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
        Alert.alert(
          "Code Resent 📩",
          `A new OTP has been sent to ${targetEmail}.`
        );
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
      Alert.alert(
        "Missing Email",
        "Please enter your registered email address."
      );
      return;
    }

    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        forgotEmail.trim()
      );
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

  function handleHeaderBack() {
    if (currentView === "login" || currentView === "register") {
      setCurrentView("welcome");
    } else if (currentView === "otp") {
      setCurrentView("register");
    } else if (currentView === "pending_approval") {
      setCurrentView("login");
    }
  }

  if (checkingSession) {
    return (
      <SafeAreaView
        style={[
          styles.safeRoot,
          styles.centeredLoading,
          { backgroundColor: skeuo.canvas },
        ]}
        edges={["top", "bottom", "left", "right"]}
      >
        <StatusBar style={darkMode ? "light" : "dark"} />
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  const summaryRows = verifiedProfile
    ? [
        { label: "Teacher", value: verifiedProfile.fullName, tabular: false },
        { label: "ID", value: verifiedProfile.teacherId, tabular: true },
        {
          label: "Grades",
          value: verifiedProfile.gradeLevelSummary,
          tabular: false,
        },
        {
          label: "Subjects",
          value: formatSubjectsSummaryDisplay(verifiedProfile.subjectsSummary),
          tabular: false,
        },
      ]
    : [];

  return (
    <SafeAreaView
      style={[styles.safeRoot, { backgroundColor: skeuo.canvas }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={darkMode ? "light" : "dark"} />

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* ══════════════════════════════════════════════════════
            SCREEN 1: WELCOME
           ══════════════════════════════════════════════════════ */}
        {currentView === "welcome" && (
          <View
            style={[styles.flex1, { backgroundColor: skeuo.canvas }]}
          >
            {/* Minimal Top Brand Header */}
            <View style={styles.welcomeHeader}>
              <View style={styles.brandRow}>
                <View style={[styles.brandMarkCircle, { backgroundColor: skeuo.surface }]}>
                  <View style={styles.brandMarkInnerDot} />
                </View>
                <Text
                  style={[styles.brandMarkText, { color: theme.textPrimary }]}
                >
                  TSEKI
                </Text>
              </View>
            </View>

            {/* Centered Hero Artwork & Messaging */}
            <ScrollView
              style={styles.flex1}
              contentContainerStyle={styles.welcomeScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.welcomeHeroInner}>
                <View style={styles.mascotStage}>
                  <AnimatedTsekiLogo size={172} />
                </View>

                <Text
                  style={[styles.welcomeHeading, { color: theme.textPrimary }]}
                >
                  Grade faster. Teach more.
                </Text>
                <Text
                  style={[styles.welcomeSubtitle, { color: theme.textMuted }]}
                >
                  Scan papers, manage classrooms, and track student progress
                  from one place.
                </Text>
              </View>
            </ScrollView>

            {/* Bottom Button Stack */}
            <View
              style={[
                styles.welcomeFooter,
                {
                  backgroundColor: skeuo.canvas,
                  paddingBottom: Math.max(insets.bottom, 20),
                },
              ]}
            >
              <View style={styles.footerInner}>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    skeuoButtonStyle(skeuo, { pressed, radius: 13 }),
                  ]}
                  onPress={() => {
                    triggerSkeuoHaptic("light");
                    setCurrentView("login");
                  }}
                >
                  <Text style={styles.primaryBtnText}>Sign In</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    skeuoButtonStyle(skeuo, { neutral: true, pressed, radius: 13 }),
                  ]}
                  onPress={() => {
                    triggerSkeuoHaptic("light");
                    setCurrentView("register");
                  }}
                >
                  <Text
                    style={[
                      styles.secondaryBtnText,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Create Teacher Account
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════
            SCREEN 2: LOGIN
           ══════════════════════════════════════════════════════ */}
        {currentView === "login" && (
          <View
            style={[styles.flex1, { backgroundColor: skeuo.canvas }]}
          >
            {/* Fixed Opaque Header (Outside ScrollView) */}
            <View
              style={[
                styles.fixedHeader,
                {
                  backgroundColor: skeuo.chrome,
                  borderBottomColor: skeuo.bevelBottom,
                },
              ]}
            >
              <View style={styles.fixedHeaderInner}>
                <TouchableOpacity
                  style={[
                    styles.backBtn,
                    skeuoButtonStyle(skeuo, { neutral: true, radius: 10 }),
                  ]}
                  onPress={handleHeaderBack}
                  activeOpacity={0.75}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Go back"
                >
                  <Ionicons
                    name="arrow-back"
                    size={22}
                    color={theme.textPrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.flex1}
              contentContainerStyle={[
                styles.loginScrollContent,
                { paddingBottom: Math.max(insets.bottom + 18, 24) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.loginCenterStage}>
                <View style={styles.formColumn}>
                  <Text
                    style={[styles.screenTitle, { color: theme.textPrimary }]}
                  >
                    Welcome back
                  </Text>
                  <Text
                    style={[styles.screenSubtitle, { color: theme.textMuted }]}
                  >
                    Sign in to your TSEKI teacher account.
                  </Text>

                  {/* Unified Inputs */}
                  <View style={styles.inputsStack}>
                    <AuthInput
                      label="Email address"
                      placeholder="teacher@school.edu.ph"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={loginEmail}
                      onChangeText={setLoginEmail}
                      editable={!loading}
                      darkMode={darkMode}
                    />

                    <AuthInput
                      label="Password"
                      placeholder="Enter your password"
                      secureTextEntry={!showLoginPassword}
                      value={loginPassword}
                      onChangeText={setLoginPassword}
                      editable={!loading}
                      darkMode={darkMode}
                      rightElement={
                        <Pressable
                          style={styles.eyeToggleBtn}
                          onPress={() =>
                            setShowLoginPassword(!showLoginPassword)
                          }
                          hitSlop={10}
                        >
                          <Ionicons
                            name={
                              showLoginPassword
                                ? "eye-off-outline"
                                : "eye-outline"
                            }
                            size={20}
                            color={theme.textMuted}
                          />
                        </Pressable>
                      }
                    />
                  </View>

                  {/* Remember Me & Forgot Password */}
                  <View style={styles.rememberForgotRow}>
                    <Pressable
                      style={styles.rememberMeContainer}
                      onPress={() => setRememberMe((prev) => !prev)}
                      hitSlop={8}
                      accessible={true}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: rememberMe }}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          rememberMe
                            ? {
                                backgroundColor: skeuo.accent,
                                borderColor: skeuo.accentLip,
                                borderTopColor: skeuo.accentHighlight,
                              }
                            : skeuoWellStyle(skeuo, 5),
                        ]}
                      >
                        {rememberMe && (
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color="#FFFFFF"
                          />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.rememberMeText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        Remember me
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setForgotEmail(loginEmail);
                        setForgotModalVisible(true);
                      }}
                      hitSlop={8}
                    >
                      <Text
                        style={[styles.forgotPassText, { color: theme.accent }]}
                      >
                        Forgot password?
                      </Text>
                    </Pressable>
                  </View>

                  {/* Primary CTA */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      skeuoButtonStyle(skeuo, { pressed, radius: 13 }),
                      loading && styles.btnDisabled,
                    ]}
                    onPress={() => {
                      triggerSkeuoHaptic("light");
                      handleLogin();
                    }}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Sign In</Text>
                    )}
                  </Pressable>

                  {/* Footer Switch to Sign Up */}
                  <View style={styles.footerSwitchRow}>
                    <Text
                      style={[
                        styles.footerSwitchText,
                        { color: theme.textMuted },
                      ]}
                    >
                      Don&apos;t have an account?{" "}
                    </Text>
                    <Pressable
                      onPress={() => setCurrentView("register")}
                      hitSlop={8}
                    >
                      <Text
                        style={[
                          styles.footerSwitchLink,
                          { color: theme.accent },
                        ]}
                      >
                        Create account
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Animated Mascot Brand Mark at Bottom */}
              <View style={styles.loginBottomLogo}>
                <AnimatedTsekiLogo size={56} />
                <Text
                  style={[
                    styles.loginBottomBrandText,
                    { color: theme.placeholder },
                  ]}
                >
                  TSEKI
                </Text>
              </View>
            </ScrollView>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════
            SCREEN 3: REGISTER STEP 1 ("Teacher Sign Up")
           ══════════════════════════════════════════════════════ */}
        {currentView === "register" && (
          <TeacherRegistrationStep1
            values={regForm}
            onChange={(patch) =>
              setRegForm((prev) => ({ ...prev, ...patch }))
            }
            loading={loading}
            onSubmit={handleRegisterStep1}
            onBack={() => setCurrentView("welcome")}
            onGoToLogin={() => setCurrentView("login")}
          />
        )}

        {/* ══════════════════════════════════════════════════════
            SCREEN 4: OTP VERIFICATION
           ══════════════════════════════════════════════════════ */}
        {currentView === "otp" && (
          <View
            style={[styles.flex1, { backgroundColor: skeuo.canvas }]}
          >
            {/* Fixed Opaque Header + 3px Progress Bar */}
            <View
              style={[
                styles.otpHeader,
                { backgroundColor: skeuo.chrome },
              ]}
            >
              <View style={styles.fixedHeaderInner}>
                <TouchableOpacity
                  style={[
                    styles.backBtn,
                    skeuoButtonStyle(skeuo, { neutral: true, radius: 10 }),
                  ]}
                  onPress={handleHeaderBack}
                  activeOpacity={0.75}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Go back"
                >
                  <Ionicons
                    name="arrow-back"
                    size={22}
                    color={theme.textPrimary}
                  />
                </TouchableOpacity>
                <Text
                  style={[styles.stepMetaText, { color: theme.textMuted }]}
                >
                  Email verification
                </Text>
              </View>
              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: skeuo.well },
                ]}
              >
                <View
                  style={[
                    styles.progressFill,
                    { width: "75%", backgroundColor: theme.accent },
                  ]}
                />
              </View>
            </View>

            <ScrollView
              style={styles.flex1}
              contentContainerStyle={[
                styles.authScrollContent,
                { paddingBottom: Math.max(insets.bottom + 24, 32) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formColumn}>
                <Text
                  style={[styles.screenTitle, { color: theme.textPrimary }]}
                >
                  Verify your email
                </Text>
                <Text
                  style={[styles.screenSubtitle, { color: theme.textMuted }]}
                >
                  Enter the 6-digit code sent to{" "}
                  <Text
                    style={{
                      color: theme.textPrimary,
                      fontWeight: "600",
                    }}
                  >
                    {regForm.email.trim() || loginEmail.trim()}
                  </Text>
                  .
                </Text>

                {/* Single Master Input with 6 Display Cells */}
                <View style={styles.otpInputContainer}>
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

                  <Pressable
                    style={styles.otpGridRow}
                    onPress={() => hiddenOtpInputRef.current?.focus()}
                  >
                    {[0, 1, 2, 3, 4, 5].map((idx) => {
                      const digit = otpToken[idx] || "";
                      const isCurrent =
                        isOtpFocused &&
                        (otpToken.length === idx ||
                          (idx === 5 && otpToken.length === 6));
                      const isFilled = digit.length > 0;

                      return (
                        <View
                          key={idx}
                          style={[
                            styles.otpCellBox,
                            skeuoWellStyle(skeuo, 12),
                            (isCurrent || isFilled) && {
                              backgroundColor: isCurrent
                                ? theme.accentBg
                                : skeuo.well,
                              borderWidth: 1.5,
                              borderTopColor: theme.accent,
                              borderLeftColor: theme.accent,
                              borderRightColor: theme.accent,
                              borderBottomColor: theme.accent,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.otpCellText,
                              { color: theme.textPrimary },
                            ]}
                          >
                            {digit}
                          </Text>
                          {isCurrent && otpToken.length < 6 && (
                            <View
                              style={[
                                styles.otpCursorBar,
                                { backgroundColor: theme.accent },
                              ]}
                            />
                          )}
                        </View>
                      );
                    })}
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    skeuoButtonStyle(skeuo, { pressed, radius: 13 }),
                    loading && styles.btnDisabled,
                  ]}
                  onPress={() => {
                    triggerSkeuoHaptic("light");
                    handleVerifyOtp();
                  }}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Continue</Text>
                  )}
                </Pressable>

                <View style={styles.resendSection}>
                  <Text
                    style={[
                      styles.resendNoticeText,
                      { color: theme.textMuted },
                    ]}
                  >
                    Didn&apos;t receive the code?
                  </Text>
                  {resendCountdown > 0 ? (
                    <Text
                      style={[
                        styles.resendTimerText,
                        { color: theme.textMuted },
                      ]}
                    >
                      Resend code in{" "}
                      <Text
                        style={[
                          styles.resendTimerHighlight,
                          { color: theme.textPrimary },
                        ]}
                      >
                        {resendCountdown}s
                      </Text>
                    </Text>
                  ) : (
                    <Pressable
                      onPress={handleResendOtp}
                      disabled={loading}
                      hitSlop={8}
                    >
                      <Text
                        style={[
                          styles.resendActiveBtnText,
                          { color: theme.accent },
                        ]}
                      >
                        Resend code
                      </Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.footerSwitchRow}>
                  <Pressable
                    onPress={() => setCurrentView("login")}
                    hitSlop={8}
                  >
                    <Text
                      style={[
                        styles.footerSwitchLink,
                        { color: theme.textMuted },
                      ]}
                    >
                      Back to Sign In
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════
            SCREEN 3B: REGISTER STEP 2 (ID Front/Back + Face Selfie)
           ══════════════════════════════════════════════════════ */}
        {currentView === "verify_identity" && verifiedProfile && (
          <TeacherVerificationStep2
            profile={verifiedProfile}
            submitting={submittingDocs}
            cancelling={cancellingReg}
            progressStatus={uploadProgressText}
            onSubmitPhotos={handleSubmitIdentityPhotos}
            onSignOut={async () => {
              if (cancellingReg || submittingDocs) return;
              setCancellingReg(true);
              try {
                await cancelIncompleteTeacherRegistration(verifiedUserId);
                setVerifiedUserId(null);
                setVerifiedProfile(null);
                setRegForm(INITIAL_STEP1_FORM);
                setCurrentView("login");
              } catch (err: any) {
                Alert.alert(
                  "Could Not Cancel Registration",
                  err?.message ||
                    "Could not discard your incomplete registration. Please try again."
                );
              } finally {
                setCancellingReg(false);
              }
            }}
          />
        )}

        {/* ══════════════════════════════════════════════════════
            SCREEN 5: APPLICATION SUBMITTED
           ══════════════════════════════════════════════════════ */}
        {currentView === "pending_approval" && (
          <View
            style={[styles.flex1, { backgroundColor: skeuo.canvas }]}
          >
            <ScrollView
              style={styles.flex1}
              contentContainerStyle={styles.submittedScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.submittedInner}>
                {/* 56px Status Icon Container */}
                <View
                  style={[
                    styles.statusIconCircle,
                    {
                      backgroundColor: theme.successBg,
                      borderWidth: 1.5,
                      borderColor: theme.successBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={28}
                    color={theme.success}
                  />
                </View>

                <Text
                  style={[
                    styles.submittedTitle,
                    { color: theme.textPrimary },
                  ]}
                >
                  Application Submitted
                </Text>

                <Text
                  style={[styles.submittedBody, { color: theme.textMuted }]}
                >
                  Your Teacher ID and selfie have been sent to{" "}
                  <Text
                    style={{
                      color: theme.textPrimary,
                      fontWeight: "600",
                    }}
                  >
                    {verifiedProfile?.schoolName || DEFAULT_SCHOOL_NAME}
                  </Text>{" "}
                  for review.
                </Text>

                {/* Key-Value Specification Table */}
                {summaryRows.length > 0 && (
                  <View
                    style={[
                      styles.specTable,
                      skeuoCardStyle(skeuo, 14),
                    ]}
                  >
                    {summaryRows.map((row, idx) => (
                      <View
                        key={row.label}
                        style={[
                          styles.specRow,
                          idx > 0 && {
                            borderTopWidth: 1,
                            borderTopColor: skeuo.grooveDark,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.specKey, { color: theme.textMuted }]}
                        >
                          {row.label}
                        </Text>
                        <Text
                          style={[
                            styles.specValue,
                            { color: theme.textPrimary },
                            row.tabular && styles.tabularNums,
                          ]}
                        >
                          {row.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <Text
                  style={[styles.submittedNote, { color: theme.textMuted }]}
                >
                  You can sign in as soon as your school administrator approves
                  your account.
                </Text>
              </View>
            </ScrollView>

            {/* Pinned Full-Width Back to Sign In CTA */}
            <View
              style={[
                styles.stickyFooter,
                {
                  backgroundColor: skeuo.chrome,
                  borderTopColor: skeuo.bevelTop,
                  paddingBottom: Math.max(insets.bottom, 16),
                },
              ]}
            >
              <View style={styles.footerInner}>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    skeuoButtonStyle(skeuo, { pressed, radius: 13 }),
                  ]}
                  onPress={() => {
                    triggerSkeuoHaptic("light");
                    setCurrentView("login");
                  }}
                >
                  <Text style={styles.primaryBtnText}>Back to Sign In</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Forgot Password Modal ── */}
      <Modal
        visible={forgotModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: skeuo.backdrop }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setForgotModalVisible(false)}
          />
          <View
            style={[
              styles.modalCard,
              skeuoCardStyle(skeuo, 20),
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Reset password
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCloseSquare,
                  skeuoButtonStyle(skeuo, { neutral: true, pressed, radius: 9 }),
                ]}
                onPress={() => setForgotModalVisible(false)}
                hitSlop={10}
              >
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            </View>

            <Text style={[styles.modalSubtitle, { color: theme.textMuted }]}>
              Enter the email address linked to your teacher account and
              we&apos;ll send a reset link.
            </Text>

            <AuthInput
              containerStyle={styles.modalInputGap}
              label="Email address"
              placeholder="teacher@school.edu.ph"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              editable={!forgotLoading}
              darkMode={darkMode}
            />

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                skeuoButtonStyle(skeuo, { pressed, radius: 13 }),
                forgotLoading && styles.btnDisabled,
              ]}
              onPress={() => {
                triggerSkeuoHaptic("light");
                handleForgotPasswordSubmit();
              }}
              disabled={forgotLoading}
            >
              {forgotLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Send Reset Link</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeRoot: {
    flex: 1,
    width: "100%",
    minHeight: Platform.OS === "web" ? ("100vh" as any) : "100%",
  },
  flex1: {
    flex: 1,
  },
  centeredLoading: {
    alignItems: "center",
    justifyContent: "center",
  },
  tabularNums: {
    fontVariant: ["tabular-nums"],
  },

  /* ── Shared Fixed Header ── */
  fixedHeader: {
    width: "100%",
    borderBottomWidth: 1,
    zIndex: 10,
  },
  otpHeader: {
    width: "100%",
    zIndex: 10,
  },
  fixedHeaderInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 36,
    height: 36,
    marginLeft: -6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepMetaText: {
    fontSize: 13,
    fontWeight: "500",
  },
  progressTrack: {
    width: "100%",
    height: 3,
  },
  progressFill: {
    height: "100%",
  },

  /* ── Shared Buttons ── */
  primaryBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryBtn: {
    width: "100%",
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  btnPressed: {
    opacity: 0.88,
  },
  btnDisabled: {
    opacity: 0.65,
  },

  /* ══════════════════════════════════════════════════════════════
     SCREEN 1: WELCOME
     ══════════════════════════════════════════════════════════════ */
  welcomeHeader: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
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
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 2,
  },
  welcomeScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  welcomeHeroInner: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
  },
  mascotStage: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  welcomeHeading: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.6,
    textAlign: "center",
    marginBottom: 10,
  },
  welcomeSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
  },
  welcomeFooter: {
    width: "100%",
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  footerInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: 12,
  },

  /* ══════════════════════════════════════════════════════════════
     SCREEN 2 & 4: LOGIN & OTP
     ══════════════════════════════════════════════════════════════ */
  loginScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  loginCenterStage: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 20,
  },
  loginBottomLogo: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
  },
  loginBottomBrandText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginTop: 6,
  },
  authScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  formColumn: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
    marginBottom: 28,
  },
  inputsStack: {
    width: "100%",
    gap: 16,
  },
  eyeToggleBtn: {
    padding: 4,
  },
  rememberForgotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 16,
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
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rememberMeText: {
    fontSize: 13,
    fontWeight: "500",
  },
  forgotPassText: {
    fontSize: 13,
    fontWeight: "600",
  },
  footerSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    flexWrap: "wrap",
  },
  footerSwitchText: {
    fontSize: 14,
  },
  footerSwitchLink: {
    fontSize: 14,
    fontWeight: "600",
  },

  /* ── OTP Cells ── */
  otpInputContainer: {
    width: "100%",
    position: "relative",
    marginBottom: 24,
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
    maxWidth: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  otpCellText: {
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  otpCursorBar: {
    position: "absolute",
    width: 2,
    height: 22,
    borderRadius: 1,
  },
  resendSection: {
    alignItems: "center",
    marginTop: 20,
    gap: 4,
  },
  resendNoticeText: {
    fontSize: 13,
  },
  resendTimerText: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  resendTimerHighlight: {
    fontWeight: "600",
  },
  resendActiveBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },

  /* ══════════════════════════════════════════════════════════════
     SCREEN 5: APPLICATION SUBMITTED
     ══════════════════════════════════════════════════════════════ */
  submittedScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  submittedInner: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    alignItems: "center",
  },
  statusIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  submittedTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
    textAlign: "center",
    marginBottom: 8,
  },
  submittedBody: {
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: 24,
  },
  specTable: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 12,
    gap: 16,
  },
  specKey: {
    fontSize: 13,
    fontWeight: "500",
  },
  specValue: {
    fontSize: 13.5,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  submittedNote: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 20,
    maxWidth: 310,
  },
  stickyFooter: {
    width: "100%",
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },

  /* ══════════════════════════════════════════════════════════════
     MODAL: FORGOT PASSWORD
     ══════════════════════════════════════════════════════════════ */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(9, 9, 11, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  modalCloseSquare: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubtitle: {
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 18,
  },
  modalInputGap: {
    marginBottom: 20,
  },
});
