import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { loginAdmin } from '../lib/adminApi';
import { Eye, EyeOff, User, Lock, ArrowRight, Moon, Sun, ShieldCheck } from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const emailInvalid = (touched.email || submitted) && !email.trim();
  const passwordInvalid = (touched.password || submitted) && !password;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your administrator ID or email.');
      emailRef.current?.focus();
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const challenge = await loginAdmin(cleanEmail, password);
      navigate('/otp', {
        state: {
          challengeToken: challenge.challengeToken,
          systemEmail: challenge.systemEmail,
          sentVia: challenge.sentVia,
          demoOtp: challenge.demoOtp,
          message: challenge.message,
          userEmail: cleanEmail,
          rememberMe,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during authentication.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`login-page ${darkMode ? 'dark' : ''}`}>
      {/* ── Left Panel: Branding ─────────────────────────────── */}
      <div className="login-brand-panel">
        <div className="brand-content">
          <div className="mascot-container">
            <img src={mascotImg} alt="Tseki Mascot" className="mascot-image" />
            <div className="mascot-glow" />
          </div>
          <div className="brand-text">
            <h1 className="brand-title">
              Tseki <span className="brand-badge">ADMIN PORTAL</span>
            </h1>
            <p className="brand-subtitle">Educational Assessment &amp; Verification</p>
          </div>
        </div>
        <div className="brand-bg-shapes" aria-hidden="true">
          <div className="bg-circle bg-circle-1" />
          <div className="bg-circle bg-circle-2" />
          <div className="bg-circle bg-circle-3" />
        </div>
      </div>

      {/* ── Right Panel: Login Form ──────────────────────────── */}
      <div className="login-form-panel">
        <div className="login-top-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="form-container">
          <div className="form-header">
            <h2 className="form-title" id="admin-signin-heading">
              Admin Sign In
            </h2>
            <p className="form-description">
              Enter your credentials to access the controller dashboard.
            </p>
          </div>

          {error && (
            <div className="error-alert" role="alert" aria-live="polite">
              <span className="error-icon" aria-hidden="true">
                !
              </span>
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handleLogin}
            className="login-form"
            aria-labelledby="admin-signin-heading"
            noValidate
          >
            <div className="form-group">
              <label htmlFor="admin-email" className="form-label">
                Administrator ID / Email
              </label>
              <div className="input-wrapper">
                <User size={18} className="input-icon" aria-hidden="true" />
                <input
                  ref={emailRef}
                  id="admin-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                  placeholder="tseki.cecsystem@gmail.com"
                  className={`form-input ${emailInvalid ? 'user-invalid-fallback' : ''}`}
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="none"
                  enterKeyHint="next"
                  required
                  aria-invalid={emailInvalid ? 'true' : 'false'}
                  aria-describedby={emailInvalid ? 'admin-email-error' : undefined}
                  disabled={loading}
                />
              </div>
              {emailInvalid && (
                <span id="admin-email-error" className="field-error-text">
                  Please enter your administrator email address.
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="admin-password" className="form-label">
                Password
              </label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" aria-hidden="true" />
                <input
                  ref={passwordRef}
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                  placeholder="••••••••••••"
                  className={`form-input form-input-password ${
                    passwordInvalid ? 'user-invalid-fallback' : ''
                  }`}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  aria-invalid={passwordInvalid ? 'true' : 'false'}
                  aria-describedby={passwordInvalid ? 'admin-password-error' : undefined}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordInvalid && (
                <span id="admin-password-error" className="field-error-text">
                  Please enter your administrator password.
                </span>
              )}
            </div>

            <div className="login-options-row">
              <label className="remember-me-label" htmlFor="remember-me">
                <input
                  id="remember-me"
                  name="remember_me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="remember-checkbox"
                  disabled={loading}
                />
                <span>Remember me</span>
              </label>

              <span className="encryption-badge">
                <ShieldCheck size={13} aria-hidden="true" />
                256-bit Encrypted
              </span>
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? (
                <span className="btn-loading">
                  <span className="btn-spinner" />
                  Sending OTP via Gmail...
                </span>
              ) : (
                <span className="btn-content">
                  Sign In to Admin Console
                  <ArrowRight size={18} aria-hidden="true" />
                </span>
              )}
            </button>
          </form>

          <div className="login-copyright">
            © {new Date().getFullYear()} Tseki Educational Assessment &amp; Verification. All rights
            reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
