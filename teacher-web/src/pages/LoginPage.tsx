import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { checkTeacherAccountApproval } from "../lib/teacherApproval";
import {
  DEFAULT_SCHOOL_NAME,
  extractProfileFromUserMetadata,
  validateRegistrationStep1,
  type TeacherRegistrationProfile,
  type TeacherRegistrationStep1Data,
} from "../lib/teacherRegistration";
import {
  submitWebTeacherVerification,
  type WebVerificationPhotoFiles,
} from "../lib/teacherRegistrationUpload";
import { TeacherRegistrationStep1Web } from "../components/TeacherRegistrationStep1Web";
import { TeacherVerificationStep2Web } from "../components/TeacherVerificationStep2Web";
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";
import styles from "./LoginPage.module.css";
import regStyles from "../components/TeacherRegistrationWeb.module.css";
import {
  Eye,
  EyeOff,
  CheckCircle2,
  Check,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  X,
} from "lucide-react";

type AuthView =
  | "welcome"
  | "login"
  | "register"
  | "otp"
  | "verify_identity"
  | "pending_approval";

const INITIAL_STEP1_WEB: TeacherRegistrationStep1Data = {
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

export default function LoginPage() {
  const navigate = useNavigate();

  // Navigation State - defaults to 'login' for web convenience, but user can click Back to see 'welcome'
  const [currentView, setCurrentView] = useState<AuthView>("login");

  // Common Feedback State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Login Form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // 2-Step Register Form
  const [regForm, setRegForm] = useState<TeacherRegistrationStep1Data>(INITIAL_STEP1_WEB);
  const [verifiedProfile, setVerifiedProfile] = useState<TeacherRegistrationProfile | null>(null);
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [submittingDocs, setSubmittingDocs] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");

  // OTP Form (Single unified 6-digit master token with 6 visual cells)
  const [otpToken, setOtpToken] = useState("");
  const [isOtpFocused, setIsOtpFocused] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(60);
  const hiddenOtpInputRef = useRef<HTMLInputElement | null>(null);
  const targetEmail = regForm.email.trim() || email.trim();

  // Forgot Password Modal
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // On mount: check "remember me" preference and existing session
  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("tseki_remember_email");
      const savedRemember = localStorage.getItem("tseki_remember_me");
      if (savedRemember === "true" && savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

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

  // Focus OTP input when entering OTP view
  useEffect(() => {
    if (currentView === "otp") {
      setTimeout(() => {
        hiddenOtpInputRef.current?.focus();
      }, 100);
    }
  }, [currentView]);

  // ── Handle Login ──────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Please enter both your email and password.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        const userMeta = (data.session.user?.user_metadata || {}) as Record<string, unknown>;
        const approval = await checkTeacherAccountApproval(
          supabase,
          data.session.user?.id,
          userMeta
        );
        if (approval.needsIdentityVerification && data.session.user?.id) {
          const recovered = extractProfileFromUserMetadata(
            userMeta,
            data.session.user.email || cleanEmail
          );
          setVerifiedUserId(data.session.user.id);
          setVerifiedProfile(
            recovered || {
              firstName: "",
              middleName: "",
              lastName: "",
              fullName: String(userMeta.full_name || "Teacher"),
              email: cleanEmail,
              schoolName: DEFAULT_SCHOOL_NAME,
              teacherId: "",
              gradeLevels: [],
              gradeLevelSummary: "",
              subjects: [],
              subjectsSummary: "",
            }
          );
          setCurrentView("verify_identity");
          setLoading(false);
          return;
        }
        if (!approval.allowed) {
          await supabase.auth.signOut();
          setError(
            approval.message ||
              "Your teacher account is pending administrator approval."
          );
          setLoading(false);
          return;
        }
        try {
          if (rememberMe) {
            localStorage.setItem("tseki_remember_me", "true");
            localStorage.setItem("tseki_remember_email", cleanEmail);
          } else {
            localStorage.removeItem("tseki_remember_me");
            localStorage.removeItem("tseki_remember_email");
          }
        } catch {
          // Ignore storage errors
        }
        navigate("/dashboard");
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during login.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Register Step 1 ────────────────────────────────────
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const validated = validateRegistrationStep1(regForm);
    if (!validated.ok || !validated.profile) {
      setError(validated.error || "Please complete all required fields.");
      return;
    }

    const profile = validated.profile;
    setLoading(true);
    try {
      const username = profile.email.split("@")[0] || profile.firstName.toLowerCase();
      const { data, error: err } = await supabase.auth.signUp({
        email: profile.email,
        password: regForm.password,
        options: {
          data: {
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
          },
        },
      });

      if (err) {
        setError(err.message);
        setLoading(false);
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
      setError(err?.message || "An unexpected error occurred during registration.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Verify OTP ─────────────────────────────────────────
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const token = otpToken.trim();
    if (token.length < 6) {
      setError("Please enter the complete 6-digit verification code.");
      return;
    }

    setLoading(true);
    try {
      let { data: otpData, error: err } = await supabase.auth.verifyOtp({
        email: targetEmail,
        token,
        type: "signup",
      });

      if (err) {
        const fallback = await supabase.auth.verifyOtp({
          email: targetEmail,
          token,
          type: "email",
        });
        otpData = fallback.data;
        err = fallback.error;
      }

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const authedUser = otpData?.user || (await supabase.auth.getUser()).data?.user;
      const userMeta = (authedUser?.user_metadata || {}) as Record<string, unknown>;
      const approval = await checkTeacherAccountApproval(
        supabase,
        authedUser?.id,
        userMeta
      );

      if (approval.needsIdentityVerification && authedUser?.id) {
        const profile =
          verifiedProfile ||
          extractProfileFromUserMetadata(userMeta, authedUser.email || targetEmail);
        setVerifiedUserId(authedUser.id);
        if (profile) setVerifiedProfile(profile);
        setCurrentView("verify_identity");
        setLoading(false);
        return;
      }

      if (!approval.allowed) {
        await supabase.auth.signOut();
        setError(
          approval.message ||
            "Your email is verified, and your teacher account is awaiting administrator approval."
        );
        setCurrentView("login");
        setLoading(false);
        return;
      }

      navigate("/dashboard");
    } catch (err: any) {
      setError(err?.message || "An error occurred during verification.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Step 2 Photo Upload Submission ─────────────────────
  async function handleSubmitIdentityPhotos(photos: WebVerificationPhotoFiles) {
    setError(null);
    const activeUserId =
      verifiedUserId ||
      (await supabase.auth.getSession()).data?.session?.user?.id;

    if (!activeUserId || !verifiedProfile) {
      setError("Your verification session expired. Please sign in again to complete Step 2.");
      setCurrentView("login");
      return;
    }

    setSubmittingDocs(true);
    setUploadProgressText("Preparing photos...");
    try {
      await submitWebTeacherVerification({
        userId: activeUserId,
        profile: verifiedProfile,
        photos,
        onProgress: (msg) => setUploadProgressText(msg),
      });

      await supabase.auth.signOut();
      setRegForm(INITIAL_STEP1_WEB);
      setCurrentView("pending_approval");
    } catch (err: any) {
      setError(
        err?.message || "Failed to upload your verification photos. Please try again."
      );
    } finally {
      setSubmittingDocs(false);
      setUploadProgressText("");
    }
  }

  // ── Handle Resend OTP ─────────────────────────────────────────
  async function handleResendOtp() {
    if (resendCountdown > 0) return;
    if (!targetEmail) {
      setError("No email address found for resending.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
      });

      if (err) {
        setError(err.message);
      } else {
        setOtpToken("");
        setResendCountdown(60);
        setSuccess(`A new OTP has been sent to ${targetEmail}.`);
      }
    } catch (err: any) {
      setError(err?.message || "Could not resend code.");
    } finally {
      setLoading(false);
    }
  }

  // ── Handle Forgot Password ────────────────────────────────────
  async function handleForgotPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError(null);

    if (!forgotEmail.trim()) {
      setForgotError("Please enter your registered email address.");
      return;
    }

    setForgotLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        forgotEmail.trim()
      );
      if (err) {
        setForgotError(err.message);
      } else {
        setForgotSuccess(true);
      }
    } catch (err: any) {
      setForgotError(err?.message || "An unexpected error occurred.");
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Left Column: Brand & Animated Mascot Showcase (Matching TSEKI Mobile) ── */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          {/* Top Brand Mark */}
          <div className={styles.topBrandRow}>
            <div className={styles.brandMarkCircle}>
              <div className={styles.brandMarkInnerDot} />
            </div>
            <span className={styles.brandMarkText}>TSEKI</span>
          </div>

          {/* Hero Mascot with Interactive Animated Waving Arm */}
          <div className={styles.heroLogoContainer}>
            <AnimatedTsekiLogo size={200} interactive={true} />
          </div>

          <div className={styles.welcomeTextContainer}>
            <h1 className={styles.helloTitle}>Hello !</h1>
            <p className={styles.helloSubtitle}>
              Best place to grade, manage classrooms and share your learning experiences
            </p>
          </div>

          {/* Feature Highlights */}
          <div className={styles.featureList}>
            <div className={styles.featureItem}>
              <div className={styles.featureIconBox}>
                <Check size={13} strokeWidth={2.8} />
              </div>
              <span>Classroom & Roster Management</span>
            </div>
            <div className={styles.featureItem}>
              <div className={styles.featureIconBox}>
                <Check size={13} strokeWidth={2.8} />
              </div>
              <span>AI Assessment Builder</span>
            </div>
            <div className={styles.featureItem}>
              <div className={styles.featureIconBox}>
                <Check size={13} strokeWidth={2.8} />
              </div>
              <span>Student Analytics & Diagnostics</span>
            </div>
            <div className={styles.featureItem}>
              <div className={styles.featureIconBox}>
                <Check size={13} strokeWidth={2.8} />
              </div>
              <span>Real-time Progress Tracking</span>
            </div>
          </div>

          <div className={styles.brandFooter}>
            <p>© 2026 Cebu Eastern College • Teacher Web Portal</p>
          </div>
        </div>
      </div>

      {/* ── Right Column: Interactive Auth Form (TSEKI Mobile Views) ── */}
      <div className={styles.formPanel}>
        <div className={styles.formContainer}>
          {/* Mobile Top Brand Row (Shown when left panel is hidden on small screens) */}
          <div className={styles.mobileTopBrand}>
            <div className={styles.brandMarkCircle}>
              <div className={styles.brandMarkInnerDot} />
            </div>
            <span className={styles.brandMarkText}>TSEKI</span>
          </div>

          {/* Feedback Banners */}
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className={styles.successBanner} role="status">
              <span>{success}</span>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 1: WELCOME SCREEN ("Hello !")
              (For mobile or when user navigates back to welcome)
             ══════════════════════════════════════════════════════ */}
          {currentView === "welcome" && (
            <div className={styles.welcomeView}>
              <div className={styles.mobileHeroMascot}>
                <AnimatedTsekiLogo size={180} interactive={true} />
              </div>

              <div className={styles.welcomeTextContainer}>
                <h2 className={styles.helloTitle}>Hello !</h2>
                <p className={styles.helloSubtitle}>
                  Best place to grade, manage classrooms and share your learning experiences
                </p>
              </div>

              <div className={styles.welcomeActions}>
                <button
                  type="button"
                  className={styles.primarySolidBtn}
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setCurrentView("login");
                  }}
                >
                  LOGIN
                </button>

                <button
                  type="button"
                  className={styles.secondaryOutlineBtn}
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setCurrentView("register");
                  }}
                >
                  SIGNUP
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 2: LOGIN SCREEN ("Welcome!")
             ══════════════════════════════════════════════════════ */}
          {currentView === "login" && (
            <div className={styles.screenInner}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setCurrentView("welcome");
                }}
                aria-label="Back to welcome"
              >
                <ArrowLeft size={22} color="#181920" />
              </button>

              <div className={styles.headerBlock}>
                <h2 className={styles.screenTitle}>Welcome!</h2>
                <p className={styles.screenSubtitle}>Sign in to continue</p>
              </div>

              <form onSubmit={handleLogin} className={styles.formCard}>
                <div className={styles.inputsBlock}>
                  {/* Email */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="login-email">
                      Email Address
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      placeholder="teacher@cec.edu.ph"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className={styles.underlineInput}
                      autoFocus
                    />
                  </div>

                  {/* Password */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="login-password">
                      Password
                    </label>
                    <div className={styles.passwordUnderlineWrapper}>
                      <input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        className={styles.underlineInput}
                      />
                      <button
                        type="button"
                        className={styles.eyeToggleBtn}
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff size={18} color="#8E8EA8" />
                        ) : (
                          <Eye size={18} color="#8E8EA8" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Options: Remember Me & Forgot Password */}
                <div className={styles.rememberForgotRow}>
                  <label className={styles.rememberMeContainer}>
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className={styles.checkboxInput}
                    />
                    <span
                      className={`${styles.checkbox} ${
                        rememberMe ? styles.checkboxChecked : ""
                      }`}
                    >
                      {rememberMe && <Check size={12} strokeWidth={3} color="#FFFFFF" />}
                    </span>
                    <span className={styles.rememberMeText}>Remember me</span>
                  </label>

                  <button
                    type="button"
                    className={styles.forgotPassBtn}
                    onClick={() => {
                      setForgotEmail(email);
                      setForgotModalVisible(true);
                      setForgotSuccess(false);
                      setForgotError(null);
                    }}
                  >
                    Forgot Password?
                  </button>
                </div>

                {/* Action Submit Button */}
                <button
                  type="submit"
                  className={styles.primarySolidBtn}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 size={18} className={styles.spinner} color="#FFFFFF" />
                  ) : (
                    "LOGIN"
                  )}
                </button>

                {/* Footer Switch to Sign up */}
                <div className={styles.footerSwitchRow}>
                  <span className={styles.footerSwitchText}>
                    Don't have an account?{" "}
                  </span>
                  <button
                    type="button"
                    className={styles.footerSwitchLink}
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setCurrentView("register");
                    }}
                  >
                    Sign up
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 3: REGISTER STEP 1 ("Teacher Sign Up")
             ══════════════════════════════════════════════════════ */}
          {currentView === "register" && (
            <div className={styles.screenInner}>
              <TeacherRegistrationStep1Web
                values={regForm}
                onChange={(patch) => setRegForm((prev) => ({ ...prev, ...patch }))}
                loading={loading}
                onSubmit={handleRegister}
                onBackToLogin={() => {
                  setError(null);
                  setSuccess(null);
                  setCurrentView("login");
                }}
              />
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 3B: REGISTER STEP 2 (ID Front/Back + Face Selfie)
             ══════════════════════════════════════════════════════ */}
          {currentView === "verify_identity" && verifiedProfile && (
            <div className={styles.screenInner}>
              <TeacherVerificationStep2Web
                profile={verifiedProfile}
                submitting={submittingDocs}
                progressText={uploadProgressText}
                onSubmitPhotos={handleSubmitIdentityPhotos}
                onSignOut={async () => {
                  await supabase.auth.signOut();
                  setCurrentView("login");
                }}
              />
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 3C: PENDING ADMIN APPROVAL CONFIRMATION
             ══════════════════════════════════════════════════════ */}
          {currentView === "pending_approval" && (
            <div className={styles.screenInner}>
              <div className={regStyles.pendingBox}>
                <div className={regStyles.pendingIcon}>
                  <ShieldCheck size={34} />
                </div>
                <h2 className={regStyles.heading}>Application Submitted!</h2>
                <p className={regStyles.subtext}>
                  Your Teacher ID (Front &amp; Back) and Face Selfie have been sent to{" "}
                  <strong>{verifiedProfile?.schoolName || DEFAULT_SCHOOL_NAME}</strong> for administrator review.
                </p>

                {verifiedProfile && (
                  <div className={regStyles.summaryCard} style={{ textAlign: "left" }}>
                    <div className={regStyles.summaryTop}>
                      <span className={regStyles.summaryName}>{verifiedProfile.fullName}</span>
                      <span className={regStyles.idChip}>ID: {verifiedProfile.teacherId}</span>
                    </div>
                    <div className={regStyles.summaryMeta}>
                      {verifiedProfile.schoolName} · {verifiedProfile.gradeLevelSummary}
                    </div>
                    <div className={regStyles.summarySubjects}>{verifiedProfile.subjectsSummary}</div>
                  </div>
                )}

                <button
                  type="button"
                  className={regStyles.primaryBtn}
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setCurrentView("login");
                  }}
                >
                  BACK TO SIGN IN
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              VIEW 4: OTP VERIFICATION SCREEN ("Verification")
             ══════════════════════════════════════════════════════ */}
          {currentView === "otp" && (
            <div className={styles.screenInner}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setCurrentView("register");
                }}
                aria-label="Back to registration"
              >
                <ArrowLeft size={22} color="#181920" />
              </button>

              <div className={styles.headerBlock}>
                <h2 className={styles.screenTitle}>Verification</h2>
                <p className={styles.screenSubtitle}>
                  Enter the 6-digit code sent to{" "}
                  <span className={styles.highlightEmail}>{targetEmail}</span>
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className={styles.formCard}>
                {/* 6-Cell Interactive OTP Input */}
                <div
                  className={styles.otpInputContainer}
                  onClick={() => hiddenOtpInputRef.current?.focus()}
                >
                  {/* Invisible master input capturing keyboard, paste, and auto-complete */}
                  <input
                    ref={hiddenOtpInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otpToken}
                    onChange={(e) => {
                      const cleaned = e.target.value
                        .replace(/[^0-9]/g, "")
                        .slice(0, 6);
                      setOtpToken(cleaned);
                    }}
                    onFocus={() => setIsOtpFocused(true)}
                    onBlur={() => setIsOtpFocused(false)}
                    className={styles.hiddenOtpInput}
                    aria-label="Verification code"
                  />

                  {/* 6 Visual Display Cells */}
                  <div className={styles.otpGridRow}>
                    {[0, 1, 2, 3, 4, 5].map((idx) => {
                      const digit = otpToken[idx] || "";
                      const isCurrent =
                        isOtpFocused &&
                        (otpToken.length === idx ||
                          (idx === 5 && otpToken.length === 6));
                      const isFilled = digit.length > 0;

                      return (
                        <div
                          key={idx}
                          className={`${styles.otpCellBox} ${
                            isCurrent ? styles.otpCellBoxFocused : ""
                          } ${isFilled ? styles.otpCellBoxFilled : ""}`}
                        >
                          <span className={styles.otpCellText}>{digit}</span>
                          {isCurrent && otpToken.length < 6 && (
                            <span className={styles.otpCursorBar} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Submit Verification */}
                <button
                  type="submit"
                  className={styles.primarySolidBtn}
                  disabled={loading || otpToken.length < 6}
                >
                  {loading ? (
                    <Loader2 size={18} className={styles.spinner} color="#FFFFFF" />
                  ) : (
                    "VERIFY"
                  )}
                </button>

                {/* Resend Section */}
                <div className={styles.resendSection}>
                  <p className={styles.resendNoticeText}>Didn't receive the code?</p>
                  {resendCountdown > 0 ? (
                    <p className={styles.resendTimerText}>
                      Resend OTP in{" "}
                      <span className={styles.resendTimerHighlight}>
                        {resendCountdown}s
                      </span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={styles.resendActiveBtn}
                      onClick={handleResendOtp}
                      disabled={loading}
                    >
                      Resend OTP
                    </button>
                  )}
                </div>

                <div className={styles.footerSwitchRow} style={{ marginTop: 28 }}>
                  <button
                    type="button"
                    className={styles.footerSwitchLink}
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setCurrentView("login");
                    }}
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Forgot Password Modal Overlay ── */}
      {forgotModalVisible && (
        <div
          className={styles.modalOverlay}
          onClick={() => setForgotModalVisible(false)}
        >
          <div
            className={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.modalHeaderRow}>
              <h3 className={styles.modalTitle}>Reset Password</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setForgotModalVisible(false)}
                aria-label="Close modal"
              >
                <X size={20} color="#6B7280" />
              </button>
            </div>

            {forgotSuccess ? (
              <div className={styles.modalSuccessBody}>
                <div className={styles.successIconCircle}>
                  <CheckCircle2 size={36} color="#059669" />
                </div>
                <h4 className={styles.modalSuccessHeading}>Check Your Email 📩</h4>
                <p className={styles.modalSuccessText}>
                  Instructions to reset your password have been sent to{" "}
                  <strong>{forgotEmail.trim()}</strong>.
                </p>
                <button
                  type="button"
                  className={styles.primarySolidBtn}
                  onClick={() => setForgotModalVisible(false)}
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPasswordSubmit}>
                <p className={styles.modalSubtitle}>
                  Enter the email address associated with your account and we'll
                  send you a password reset link.
                </p>

                {forgotError && (
                  <div className={styles.errorBanner} style={{ marginBottom: 16 }}>
                    <span>{forgotError}</span>
                  </div>
                )}

                <div className={styles.underlineWrapper} style={{ marginBottom: 24 }}>
                  <label className={styles.fieldLabel} htmlFor="forgot-email">
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="teacher@cec.edu.ph"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    autoComplete="email"
                    className={styles.underlineInput}
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className={styles.primarySolidBtn}
                  disabled={forgotLoading}
                >
                  {forgotLoading ? (
                    <Loader2 size={18} className={styles.spinner} color="#FFFFFF" />
                  ) : (
                    "SEND RESET LINK"
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
