import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import styles from "./LoginPage.module.css";
import { Eye, EyeOff, CheckCircle2, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: err } = await signIn(email, password);
    if (err) {
      setError(err);
    }
    setLoading(false);
  }

  return (
    <div className={styles.page}>
      {/* Left Panel: Brand */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <div className={styles.logoWrap}>
            <div className={styles.logoIcon}>
              <CheckCircle2 size={40} color="#fff" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className={styles.brandName}>TSEKI</h1>
          <p className={styles.brandTagline}>Teacher Web Portal</p>
          <p className={styles.brandDesc}>
            Access your classrooms, assessments, and student analytics from any browser.
            Your complete teaching companion on the web.
          </p>
          <div className={styles.featureList}>
            <div className={styles.featureItem}>
              <span className={styles.featureDot} />
              <span>Classroom & Roster Management</span>
            </div>
            <div className={styles.featureItem}>
              <span className={styles.featureDot} />
              <span>AI Assessment Builder</span>
            </div>
            <div className={styles.featureItem}>
              <span className={styles.featureDot} />
              <span>Student Analytics & Diagnostics</span>
            </div>
            <div className={styles.featureItem}>
              <span className={styles.featureDot} />
              <span>Real-time Progress Tracking</span>
            </div>
          </div>
        </div>
        <div className={styles.brandFooter}>
          <p>© 2026 Cebu Eastern College</p>
        </div>
        {/* Decorative shapes */}
        <div className={styles.decorCircle1} />
        <div className={styles.decorCircle2} />
        <div className={styles.decorCircle3} />
      </div>

      {/* Right Panel: Login Form */}
      <div className={styles.formPanel}>
        <form className={styles.formCard} onSubmit={handleSubmit}>
          <div className={styles.formHeader}>
            <div className={styles.mobileLogo}>
              <CheckCircle2 size={28} color="var(--orange-500)" strokeWidth={2.5} />
              <span>TSEKI</span>
            </div>
            <h2>Welcome back</h2>
            <p>Sign in to your teacher account</p>
          </div>

          {error && (
            <div className={styles.errorBanner}>
              <span>{error}</span>
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              placeholder="teacher@cec.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={styles.input}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="login-password">Password</label>
            <div className={styles.passwordWrap}>
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={styles.input}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={20} className={styles.spinner} />
            ) : (
              "Sign In"
            )}
          </button>

          <p className={styles.hint}>
            Don't have an account? Register through the <strong>TSEKI mobile app</strong>.
          </p>
        </form>
      </div>
    </div>
  );
}
