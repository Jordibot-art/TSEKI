import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import {
  clearStoredSession,
  getStoredAdminEmail,
  getStoredSessionToken,
  logoutAdmin,
  storeSession,
  verifySession,
} from './lib/adminApi';
import LoginPage from './pages/LoginPage';
import OtpPage from './pages/OtpPage';
import DashboardPage from './pages/DashboardPage';
import './App.css';

interface AuthContextType {
  isAdmin: boolean;
  adminEmail: string;
  loading: boolean;
  signOut: () => void;
  setAdminAuthenticated: (sessionToken: string, email: string, rememberMe: boolean) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  isAdmin: false,
  adminEmail: 'tseki.cecsystem@gmail.com',
  loading: true,
  signOut: () => {},
  setAdminAuthenticated: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading Tseki Admin Portal...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string>(() => getStoredAdminEmail());
  const [loading, setLoading] = useState(true);

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
    let active = true;
    const token = getStoredSessionToken();
    if (!token) {
      setLoading(false);
      return;
    }

    verifySession()
      .then((res) => {
        if (!active) return;
        if (res.authenticated) {
          setIsAdmin(true);
          setAdminEmail(res.adminEmail);
        } else {
          clearStoredSession();
          setIsAdmin(false);
        }
      })
      .catch(() => {
        if (!active) return;
        clearStoredSession();
        setIsAdmin(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const setAdminAuthenticated = (
    sessionToken: string,
    email: string,
    rememberMe: boolean
  ) => {
    storeSession(sessionToken, email, rememberMe);
    setAdminEmail(email);
    setIsAdmin(true);
  };

  const signOut = () => {
    const token = getStoredSessionToken();
    clearStoredSession();
    setIsAdmin(false);
    if (token) {
      void logoutAdmin(token).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider
      value={{
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
            element={isAdmin ? <Navigate to="/" replace /> : <LoginPage />}
          />
          <Route
            path="/otp"
            element={isAdmin ? <Navigate to="/" replace /> : <OtpPage />}
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
