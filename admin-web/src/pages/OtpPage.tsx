import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../App';
import { resendOtp, verifyLoginOtp } from '../lib/adminApi';
import { Key, ArrowRight, RotateCw, CheckCircle, AlertTriangle, Moon, Sun, ArrowLeft } from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './OtpPage.css';

interface OtpRouteState {
  challengeToken?: string;
  systemEmail?: string;
  sentVia?: 'gmail' | 'dev_fallback';
  demoOtp?: string;
  message?: string;
  rememberMe?: boolean;
}

export default function OtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAdminAuthenticated, darkMode, toggleDarkMode } = useAuth();

  const initialState = (location.state as OtpRouteState | null) || {};
  const [challengeToken, setChallengeToken] = useState(initialState.challengeToken || '');
  const [systemEmail, setSystemEmail] = useState(
    initialState.systemEmail || 'tseki.cecsystem@gmail.com'
  );
  const [sentVia, setSentVia] = useState<'gmail' | 'dev_fallback'>(
    initialState.sentVia || 'gmail'
  );
  const [demoOtp, setDemoOtp] = useState(initialState.demoOtp || '');

  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendCountdown, setResendCountdown] = useState(60);

  // Redirect back to login if opened directly without an active OTP challenge
  useEffect(() => {
    if (!challengeToken) {
      navigate('/login', { replace: true });
    }
  }, [challengeToken, navigate]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const token = otpCode.trim();

    if (!token) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    if (token.length !== 6) {
      setError('The verification code must be exactly 6 digits.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await verifyLoginOtp(challengeToken, token);
      setSuccess('Verification successful! Access granted.');
      setAdminAuthenticated(
        result.sessionToken,
        result.adminEmail,
        Boolean(initialState.rememberMe)
      );
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 450);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid or expired verification code.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0 || !challengeToken) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const nextChallenge = await resendOtp(challengeToken);
      setChallengeToken(nextChallenge.challengeToken);
      setSystemEmail(nextChallenge.systemEmail);
      setSentVia(nextChallenge.sentVia);
      setDemoOtp(nextChallenge.demoOtp || '');
      setResendCountdown(60);
      setSuccess(
        nextChallenge.sentVia === 'gmail'
          ? `A new 6-digit OTP has been sent via Gmail to ${nextChallenge.systemEmail}.`
          : `New dev fallback OTP generated for ${nextChallenge.systemEmail}.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resend OTP code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`otp-page ${darkMode ? 'dark' : ''}`}>
      {/* ── Left Panel: Orange Branding ──────────────────────── */}
      <div className="otp-brand-panel">
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

      {/* ── Right Panel: Two-Factor Verification ─────────────── */}
      <div className="otp-form-panel">
        <div className="otp-top-actions">
          <Link to="/login" className="otp-back-link">
            <ArrowLeft size={15} />
            <span>Back to Sign In</span>
          </Link>
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

        <div className="otp-form-container">
          <div className="otp-header">
            <h2 className="otp-title" id="otp-heading">
              Two-Factor Verification
            </h2>
            <p className="otp-description">
              A verification code has been dispatched to <strong>{systemEmail}</strong>.
            </p>
          </div>

          {sentVia === 'gmail' ? (
            <div className="otp-info-banner" role="status">
              <CheckCircle size={18} className="banner-icon" aria-hidden="true" />
              <div className="banner-text">
                <span>
                  OTP Sent via Gmail! Please check the system email inbox for your 6-digit
                  verification code.
                </span>
              </div>
            </div>
          ) : (
            <div className="otp-warning-banner" role="status">
              <AlertTriangle size={18} className="warning-banner-icon" aria-hidden="true" />
              <div className="banner-text">
                <span>
                  Gmail SMTP not configured yet (set <code>GMAIL_USER</code> &amp;{' '}
                  <code>GMAIL_APP_PASSWORD</code> in <code>admin-web/.env</code>).
                </span>
                {demoOtp && (
                  <span className="demo-hint">
                    Local Dev Fallback OTP: <strong>{demoOtp}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {success && (
            <div className="otp-success-alert" role="status" aria-live="polite">
              <CheckCircle size={16} aria-hidden="true" />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="otp-error-alert" role="alert" aria-live="polite">
              <span className="error-dot" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="otp-form" aria-labelledby="otp-heading">
            <div className="form-group">
              <label htmlFor="otp-input" className="otp-field-label">
                Verification Code (OTP)
              </label>
              <div className="otp-input-wrapper">
                <Key size={18} className="otp-key-icon" aria-hidden="true" />
                <input
                  id="otp-input"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setOtpCode(val);
                    if (error) setError('');
                  }}
                  placeholder="Enter 6-digit code"
                  className="otp-code-input"
                  enterKeyHint="done"
                  required
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            <div className="otp-resend-row">
              <span className="resend-text">Didn&apos;t receive the code?</span>
              {resendCountdown > 0 ? (
                <span className="resend-countdown">Resend in {resendCountdown}s</span>
              ) : (
                <button
                  type="button"
                  className="resend-button"
                  onClick={handleResend}
                  disabled={loading}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Resend code
                </button>
              )}
            </div>

            <button
              type="submit"
              className="otp-verify-button"
              disabled={loading}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="btn-spinner" />
                  Verifying Code...
                </span>
              ) : (
                <span className="btn-content">
                  Verify Code &amp; Sign In
                  <ArrowRight size={18} aria-hidden="true" />
                </span>
              )}
            </button>
          </form>

          <div className="otp-copyright">
            © {new Date().getFullYear()} Tseki Educational Assessment &amp; Verification. All rights
            reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
