import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import LoginPage from './pages/LoginPage';
import OtpPage from './pages/OtpPage';
import DashboardPage from './pages/DashboardPage';
import './App.css';

// ── Auth Context ─────────────────────────────────────────────
interface AuthContextType {
  session: Session | null;
  isAdmin: boolean;
  adminEmail: string;
  loading: boolean;
  signOut: () => Promise<void>;
  setAdminAuthenticated: (email: string) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  session: null,
  isAdmin: false,
  adminEmail: 'tseki.cecsystem@gmail.com',
  loading: true,
  signOut: async () => {},
  setAdminAuthenticated: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Protected Route ──────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading Tseki Admin Portal...</p>
      </div>
    );
  }

  if (!session && !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ── App ──────────────────────────────────────────────────────
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem('tseki_admin_auth') === 'true';
  });
  const [adminEmail, setAdminEmail] = useState<string>(() => {
    return localStorage.getItem('tseki_admin_email') || 'tseki.cecsystem@gmail.com';
  });
  const [loading, setLoading] = useState(true);

  // Dark mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('tseki_theme') === 'dark';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
    localStorage.setItem('tseki_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode((prev) => !prev);
  };

  useEffect(() => {
    // Check existing Supabase session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const setAdminAuthenticated = (email: string) => {
    localStorage.setItem('tseki_admin_auth', 'true');
    localStorage.setItem('tseki_admin_email', email);
    setIsAdmin(true);
    setAdminEmail(email);
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    localStorage.removeItem('tseki_admin_auth');
    localStorage.removeItem('tseki_admin_email');
    setIsAdmin(false);
    setSession(null);
  };

  const isAuthenticated = !!session || isAdmin;

  return (
    <AuthContext.Provider
      value={{
        session,
        isAdmin,
        adminEmail,
        loading,
        signOut,
        setAdminAuthenticated,
        darkMode,
        toggleDarkMode,
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
          />
          <Route
            path="/otp"
            element={isAuthenticated ? <Navigate to="/" replace /> : <OtpPage />}
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

export default App;
