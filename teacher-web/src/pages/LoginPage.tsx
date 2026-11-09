import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { AnimatedTsekiLogo } from "../components/AnimatedTsekiLogo";
import styles from "./LoginPage.module.css";
import {
  Eye,
  EyeOff,
  CheckCircle2,
  Check,
  Loader2,
  ArrowLeft,
  X,
} from "lucide-react";

type AuthView = "welcome" | "login" | "register" | "otp";

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

  // Register Form
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [registerConfirm, setRegisterConfirm] = useState("");
  const [showRegisterConfirm, setShowRegisterConfirm] = useState(false);

  // OTP Form (Single unified 6-digit master token with 6 visual cells)
  const [otpToken, setOtpToken] = useState("");
  const [isOtpFocused, setIsOtpFocused] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(60);
  const hiddenOtpInputRef = useRef<HTMLInputElement | null>(null);
  const targetEmail = registerEmail.trim() || email.trim();

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

  // ── Handle Register ───────────────────────────────────────────
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (
      !registerName.trim() ||
      !registerEmail.trim() ||
      !registerPassword ||
      !registerConfirm
    ) {
      setError("Please fill in all fields to create your account.");
      return;
    }

    if (registerPassword !== registerConfirm) {
      setError("Passwords do not match. Please verify and try again.");
      return;
    }

    if (registerPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: registerEmail.trim(),
        password: registerPassword,
        options: {
          data: {
            full_name: registerName.trim(),
          },
        },
      });

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        navigate("/dashboard");
      } else {
        // Verification OTP required
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
      let { error: err } = await supabase.auth.verifyOtp({
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
        err = fallback.error;
      }

      if (err) {
        setError(err.message);
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
              VIEW 3: REGISTER SCREEN ("Hi!")
             ══════════════════════════════════════════════════════ */}
          {currentView === "register" && (
            <div className={styles.screenInner}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setCurrentView("login");
                }}
                aria-label="Back to login"
              >
                <ArrowLeft size={22} color="#181920" />
              </button>

              <div className={styles.headerBlock}>
                <h2 className={styles.screenTitle}>Hi!</h2>
                <p className={styles.screenSubtitle}>Create a new teacher account</p>
              </div>

              <form onSubmit={handleRegister} className={styles.formCard}>
                <div className={styles.inputsBlock}>
                  {/* Full Name */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="reg-name">
                      Full Name
                    </label>
                    <input
                      id="reg-name"
                      type="text"
                      placeholder="e.g. John Ariel"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      autoComplete="name"
                      className={styles.underlineInput}
                      autoFocus
                    />
                  </div>

                  {/* Email */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="reg-email">
                      Email Address
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      placeholder="teacher@cec.edu.ph"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      autoComplete="email"
                      className={styles.underlineInput}
                    />
                  </div>

                  {/* Password */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="reg-password">
                      Password
                    </label>
                    <div className={styles.passwordUnderlineWrapper}>
                      <input
                        id="reg-password"
                        type={showRegisterPassword ? "text" : "password"}
                        placeholder="At least 6 characters"
                        value={registerPassword}
                        onChange={(e) => setRegisterPassword(e.target.value)}
                        autoComplete="new-password"
                        className={styles.underlineInput}
                      />
                      <button
                        type="button"
                        className={styles.eyeToggleBtn}
                        onClick={() =>
                          setShowRegisterPassword(!showRegisterPassword)
                        }
                        aria-label={
                          showRegisterPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showRegisterPassword ? (
                          <EyeOff size={18} color="#8E8EA8" />
                        ) : (
                          <Eye size={18} color="#8E8EA8" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className={styles.underlineWrapper}>
                    <label className={styles.fieldLabel} htmlFor="reg-confirm">
                      Confirm Password
                    </label>
                    <div className={styles.passwordUnderlineWrapper}>
                      <input
                        id="reg-confirm"
                        type={showRegisterConfirm ? "text" : "password"}
                        placeholder="Confirm password"
                        value={registerConfirm}
                        onChange={(e) => setRegisterConfirm(e.target.value)}
                        autoComplete="new-password"
                        className={styles.underlineInput}
                      />
                      <button
                        type="button"
                        className={styles.eyeToggleBtn}
                        onClick={() =>
                          setShowRegisterConfirm(!showRegisterConfirm)
                        }
                        aria-label={
                          showRegisterConfirm ? "Hide password" : "Show password"
                        }
                      >
                        {showRegisterConfirm ? (
                          <EyeOff size={18} color="#8E8EA8" />
                        ) : (
                          <Eye size={18} color="#8E8EA8" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  className={styles.primarySolidBtn}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 size={18} className={styles.spinner} color="#FFFFFF" />
                  ) : (
                    "SIGN UP"
                  )}
                </button>

                {/* Footer Switch to Sign In */}
                <div className={styles.footerSwitchRow}>
                  <span className={styles.footerSwitchText}>
                    Already have an account?{" "}
                  </span>
                  <button
                    type="button"
                    className={styles.footerSwitchLink}
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setCurrentView("login");
                    }}
                  >
                    Sign in
                  </button>
                </div>
              </form>
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
