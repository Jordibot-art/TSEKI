import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  LayoutDashboard,
  GraduationCap,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import styles from "./AppLayout.module.css";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/classrooms", label: "Classrooms", icon: GraduationCap },
  { to: "/assessments", label: "Assessments", icon: FileText },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const teacherName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.username ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Teacher";

  const initials = teacherName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className={styles.layout}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className={styles.overlay} onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} ${
          mobileOpen ? styles.mobileOpen : ""
        }`}
      >
        {/* Logo */}
        <div className={styles.sidebarHeader}>
          <div className={styles.logoArea}>
            <div className={styles.logoIcon}>
              <CheckCircle2 size={22} color="#fff" strokeWidth={2.5} />
            </div>
            {!collapsed && <span className={styles.logoText}>TSEKI</span>}
          </div>
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Toggle sidebar"
          >
            <ChevronLeft
              size={18}
              style={{
                transform: collapsed ? "rotate(180deg)" : "none",
                transition: "transform 0.2s ease",
              }}
            />
          </button>
          <button
            className={styles.mobileCloseBtn}
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
              }
              onClick={() => setMobileOpen(false)}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom Actions */}
        <div className={styles.sidebarFooter}>
          <button
            className={styles.themeToggle}
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {!collapsed && <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>}
          </button>

          <div className={styles.userSection}>
            <div className={styles.avatar}>{initials}</div>
            {!collapsed && (
              <div className={styles.userInfo}>
                <span className={styles.userName}>{teacherName}</span>
                <span className={styles.userRole}>Teacher</span>
              </div>
            )}
          </div>

          <button className={styles.signOutBtn} onClick={handleSignOut} title="Sign Out">
            <LogOut size={18} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={styles.main}>
        {/* Top bar (mobile) */}
        <header className={styles.topBar}>
          <button
            className={styles.menuBtn}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className={styles.topLogo}>
            <CheckCircle2 size={20} color="var(--orange-500)" strokeWidth={2.5} />
            <span>TSEKI</span>
          </div>
          <div style={{ width: 36 }} />
        </header>

        {/* Page content */}
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
