import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../App';
import { Key, ArrowRight, RotateCw, CheckCircle, Moon, Sun } from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './OtpPage.css';

const DEFAULT_ADMIN_EMAIL = 'tseki.cecsystem@gmail.com';
const DEMO_OTP = '123456';

export default function OtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAdminAuthenticated, darkMode, toggleDarkMode } = useAuth();
  const stateAdminEmail = (location.state as any)?.adminEmail;
  const adminEmail = stateAdminEmail || DEFAULT_ADMIN_EMAIL;

  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendCountdown, setResendCountdown] = useState(60);

  // Countdown timer for resend
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
      // 1. Check demo code first for reliable admin testing
      if (token === DEMO_OTP) {
        setSuccess('Verification successful! Access granted.');
        setAdminAuthenticated(adminEmail);
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 800);
        return;
      }

      // 2. Try Supabase verifyOtp
      let verified = false;
      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: adminEmail,
          token,
          type: 'email',
        });

        if (!verifyError) {
          verified = true;
        } else {
          // If Supabase failed, check error
          setError(verifyError.message || 'Invalid or expired verification code.');
        }
      } catch (err: any) {
        setError(err.message || 'Invalid verification code.');
      }

      if (verified) {
        setSuccess('Verification successful! Access granted.');
        setAdminAuthenticated(adminEmail);
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 800);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0) return;
    setLoading(true);
    setError('');
    try {
      await supabase.auth.signInWithOtp({
        email: adminEmail,
      });
      setResendCountdown(60);
      setSuccess('A new OTP code has been sent to your admin email!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Could not resend OTP code.');
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
            <p className="brand-subtitle">
              Educational Assessment & Verification
            </p>
          </div>
        </div>
        <div className="brand-bg-shapes">
          <div className="bg-circle bg-circle-1" />
          <div className="bg-circle bg-circle-2" />
          <div className="bg-circle bg-circle-3" />
        </div>
      </div>

      {/* ── Right Panel: Two-Factor Verification ─────────────── */}
      <div className="otp-form-panel">
        {/* Top Right Theme Toggle */}
        <div className="otp-top-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="otp-form-container">
          <div className="otp-header">
            <h2 className="otp-title">Two-Factor Verification</h2>
            <p className="otp-description">
              A verification code has been dispatched to <strong>{adminEmail}</strong>.
            </p>
          </div>

          {/* Green Notice Banner (Screenshot 1) */}
          <div className="otp-info-banner">
            <CheckCircle size={18} className="banner-icon" />
            <div className="banner-text">
              <span>OTP Sent! Please check your admin email for the verification code.</span>
              <span className="demo-hint">(Demo code: <strong>{DEMO_OTP}</strong>)</span>
            </div>
          </div>

          {success && (
            <div className="otp-success-alert">
              <CheckCircle size={16} />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="otp-error-alert">
              <span className="error-dot" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="otp-form">
            <div className="form-group">
              <label htmlFor="otp-input" className="otp-field-label">
                VERIFICATION CODE (OTP)
              </label>
              <div className="otp-input-wrapper">
                <Key size={18} className="otp-key-icon" />
                <input
                  id="otp-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setOtpCode(val);
                    setError('');
                  }}
                  placeholder="Enter 6-digit code (e.g. 123456)"
                  className="otp-code-input"
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            <div className="otp-resend-row">
              <span className="resend-text">Didn't receive the code?</span>
              {resendCountdown > 0 ? (
                <span className="resend-countdown">Resend in {resendCountdown}s</span>
              ) : (
                <button
                  type="button"
                  className="resend-button"
                  onClick={handleResend}
                  disabled={loading}
                >
                  <RotateCw size={13} />
                  Resend code
                </button>
              )}
            </div>

            <button
              type="submit"
              className="otp-verify-button"
              disabled={loading || otpCode.length !== 6}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="btn-spinner" />
                  Verifying Code...
                </span>
              ) : (
                <span className="btn-content">
                  Verify Code & Sign In
                  <ArrowRight size={18} />
                </span>
              )}
            </button>
          </form>

          <div className="otp-copyright">
            © {new Date().getFullYear()} Tseki Educational Assessment & Verification. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
