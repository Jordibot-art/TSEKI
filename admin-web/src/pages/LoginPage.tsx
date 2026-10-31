import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../App';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Shield, Moon, Sun } from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './LoginPage.css';

// The admin Gmail used for sending OTP
const ADMIN_EMAIL = 'tseki.cecsystem@gmail.com';
const ADMIN_PASSWORD = 'tsekicecsystem!@#123';

export default function LoginPage() {
  const navigate = useNavigate();
  const { darkMode, toggleDarkMode } = useAuth();
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Please enter both your email and password.');
      return;
    }

    setLoading(true);
    try {
      // 1. First check if it matches the designated Tseki Admin credentials
      const isOfficialAdmin =
        cleanEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
        password === ADMIN_PASSWORD;

      let authSuccess = isOfficialAdmin;

      // 2. Also try Supabase signInWithPassword if available
      try {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (!authError) {
          authSuccess = true;
        }
      } catch {
        // Fall back to credential check
      }

      if (!authSuccess) {
        setError('Invalid admin credentials. Please verify your email and password.');
        setLoading(false);
        return;
      }

      // 3. Dispatch OTP to the admin email
      try {
        await supabase.auth.signInWithOtp({
          email: ADMIN_EMAIL,
        });
      } catch (otpErr) {
        console.warn('Supabase OTP trigger notice:', otpErr);
      }

      // 4. Navigate to OTP verification page
      navigate('/otp', { state: { adminEmail: ADMIN_EMAIL, userEmail: cleanEmail } });
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during authentication.');
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
            <img
              src={mascotImg}
              alt="Tseki Mascot"
              className="mascot-image"
            />
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

      {/* ── Right Panel: Login Form ──────────────────────────── */}
      <div className="login-form-panel">
        <div className="form-container">
          <div className="form-top-bar">
            <div className="security-badge">
              <Shield size={14} />
              <span>Secure Admin Access</span>
            </div>
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleDarkMode}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          <div className="form-header">
            <h2 className="form-title">Welcome back, Admin</h2>
            <p className="form-description">
              Sign in to manage teacher accounts, verify registrations, and monitor system activity.
            </p>
          </div>

          {error && (
            <div className="error-alert" role="alert">
              <span className="error-icon">!</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="admin-email" className="form-label">
                Admin Email
              </label>
              <div className="input-wrapper">
                <Mail size={18} className="input-icon" />
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tseki.cecsystem@gmail.com"
                  className="form-input"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="admin-password" className="form-label">
                Password
              </label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="form-input"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="btn-spinner" />
                  Authenticating...
                </span>
              ) : (
                <span className="btn-content">
                  Sign In & Send OTP
                  <ArrowRight size={18} />
                </span>
              )}
            </button>
          </form>

          <div className="form-footer">
            <p className="footer-note">
              OTP verification code will be sent to<br />
              <strong>{ADMIN_EMAIL}</strong>
            </p>
          </div>

          <div className="login-copyright">
            © {new Date().getFullYear()} Tseki Educational Assessment & Verification. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
