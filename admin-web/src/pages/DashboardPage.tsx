import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../App';
import {
  approveTeacher,
  clearActivityLogs,
  confirmDeleteTeacher,
  fetchDashboardData,
  rejectTeacher,
  requestActionOtp,
  requestTeacherDeleteOtp,
  resendOtp,
  toggleTeacherStatus,
  type ActivityLogEntry,
  type DataSourceMode,
  type OtpChallengeResponse,
  type Teacher,
} from '../lib/adminApi';
import { ModalDialog } from '../components/ModalDialog';
import {
  AdminVerifyBox,
  validateAdminVerifyInput,
  type AdminVerifyMethod,
} from '../components/AdminVerifyBox';
import {
  LogOut,
  Moon,
  Sun,
  Users,
  UserCheck,
  UserPlus,
  UserX,
  Calendar,
  Eye,
  Search,
  X,
  CheckCircle,
  XCircle,
  Trash2,
  Bell,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  RotateCw,
  AlertTriangle,
} from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './DashboardPage.css';

interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'error';
}

type PendingEditVerify =
  | { type: 'approve'; teacher: Teacher }
  | { type: 'reject'; teacher: Teacher; reason: string };

type ActivityFilterTab = 'all' | 'admin' | 'app';

const NOTIF_READ_AT_KEY = 'tseki_admin_notif_read_at';

function getLogTimestampMs(log: ActivityLogEntry): number {
  if (!log.created_at) return 0;
  const parsed = Date.parse(log.created_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isAdminActivityLog(log: ActivityLogEntry): boolean {
  if (log.category) return log.category === 'admin';
  return Boolean(log.actor && log.actor !== 'App');
}

export default function DashboardPage() {
  const { signOut, darkMode, toggleDarkMode, adminEmail } = useAuth();

  // Data state
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [dataSource, setDataSource] = useState<DataSourceMode | null>(null);
  const [systemEmail, setSystemEmail] = useState(adminEmail);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilterTab>('all');

  // Modals state
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [previewTab, setPreviewTab] = useState<'card' | 'school_id' | 'face'>('card');

  // Pending Approve / Reject verification modal
  const [pendingEditVerify, setPendingEditVerify] = useState<PendingEditVerify | null>(null);

  // Disable / Enable confirmation modal
  const [statusConfirmTeacher, setStatusConfirmTeacher] = useState<Teacher | null>(null);

  // Permanent deletion confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);

  // Clear log confirmation modal
  const [showClearLogDialog, setShowClearLogDialog] = useState(false);

  // Shared re-verification state (Password or Gmail OTP) across all data-editing dialogs
  const [verifyMode, setVerifyMode] = useState<AdminVerifyMethod>('password');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyOtpCode, setVerifyOtpCode] = useState('');
  const [verifyOtpChallenge, setVerifyOtpChallenge] = useState<OtpChallengeResponse | null>(null);
  const [verifyOtpCountdown, setVerifyOtpCountdown] = useState(0);
  const [verifyOtpSending, setVerifyOtpSending] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const verifyPasswordInputRef = useRef<HTMLInputElement>(null);
  const verifyOtpInputRef = useRef<HTMLInputElement>(null);

  // Notifications popover + persisted read watermark
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [lastNotifReadAt, setLastNotifReadAt] = useState<number>(() => {
    const raw = localStorage.getItem(NOTIF_READ_AT_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const notifWrapRef = useRef<HTMLDivElement>(null);

  // Toast state (shown only when no modal dialog is open)
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  // Live real-time clock updating every second
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const anyModalOpen =
    Boolean(selectedTeacher) ||
    Boolean(pendingEditVerify) ||
    Boolean(statusConfirmTeacher) ||
    Boolean(deleteTarget) ||
    showClearLogDialog;

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'success') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  // Manage popover="manual" toast visibility safely without appearing behind open modals
  useEffect(() => {
    const el = toastRef.current;
    if (!el) return;

    if (!toast || anyModalOpen) {
      try {
        if (el.matches(':popover-open')) el.hidePopover?.();
      } catch {
        // Fallback for browsers without Popover API
      }
      el.classList.remove(':popover-open');
      return;
    }

    try {
      if (!el.matches(':popover-open')) el.showPopover?.();
    } catch {
      el.classList.add(':popover-open');
    }

    const timer = setTimeout(() => {
      setToast((prev) => (prev?.id === toast.id ? null : prev));
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast, anyModalOpen]);

  // Close notification dropdown on outside click / Esc
  useEffect(() => {
    if (!showNotifDropdown) return;
    const onPointer = (e: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target as Node)) {
        setShowNotifDropdown(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifDropdown(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [showNotifDropdown]);

  // Shared OTP resend countdown
  useEffect(() => {
    if (verifyOtpCountdown <= 0) return;
    const timer = setInterval(() => {
      setVerifyOtpCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [verifyOtpCountdown]);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      const data = await fetchDashboardData();
      setTeachers(data.teachers);
      setActivityLogs(data.activityLogs);
      setDataSource(data.source);
      if (data.systemEmail) setSystemEmail(data.systemEmail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard data.';
      setLoadError(msg);
      if (msg.toLowerCase().includes('unauthorized')) {
        signOut();
      }
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Derived stats & notification counts
  const totalCount = teachers.length;
  const pendingTeachers = teachers.filter((t) => t.status === 'pending');
  const pendingCount = pendingTeachers.length;
  const activeCount = teachers.filter((t) => t.status === 'approved').length;

  const adminLogsCount = activityLogs.filter(isAdminActivityLog).length;
  const appLogsCount = activityLogs.length - adminLogsCount;
  const filteredActivityLogs =
    activityFilter === 'admin'
      ? activityLogs.filter(isAdminActivityLog)
      : activityFilter === 'app'
      ? activityLogs.filter((l) => !isAdminActivityLog(l))
      : activityLogs;

  const unreadActivityLogs = activityLogs.filter(
    (log) => getLogTimestampMs(log) > lastNotifReadAt
  );
  const totalNotifCount = pendingCount + unreadActivityLogs.length;

  // Filtered teachers for Account Management
  const filteredTeachers = teachers.filter((t) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      t.full_name?.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) ||
      t.grade_level?.toLowerCase().includes(q) ||
      t.subject?.toLowerCase().includes(q) ||
      t.teacher_id?.toLowerCase().includes(q);

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'approved'
        ? t.status === 'approved'
        : statusFilter === 'inactive'
        ? t.status === 'suspended' || t.status === 'rejected'
        : t.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  type VerifyOtpContext =
    | { kind: 'delete'; teacher: Teacher }
    | { kind: 'action'; actionLabel: string; targetId?: string; targetName?: string };

  function markAllNotifsRead(explicitTimestampMs?: number) {
    const newestLogMs = activityLogs.reduce(
      (max, item) => Math.max(max, getLogTimestampMs(item)),
      0
    );
    const nextWatermark = explicitTimestampMs ?? Math.max(Date.now(), newestLogMs);
    setLastNotifReadAt(nextWatermark);
    localStorage.setItem(NOTIF_READ_AT_KEY, String(nextWatermark));
  }

  function resetVerifyState(defaultMode: AdminVerifyMethod = 'password') {
    setVerifyMode(defaultMode);
    setVerifyPassword('');
    setVerifyOtpCode('');
    setVerifyOtpChallenge(null);
    setVerifyOtpCountdown(0);
    setVerifyOtpSending(false);
    setVerifyError('');
  }

  async function sendOrResendVerifyOtp(ctx: VerifyOtpContext) {
    if (verifyOtpChallenge && verifyOtpCountdown > 0) return;
    setVerifyOtpSending(true);
    setVerifyError('');
    try {
      let next: OtpChallengeResponse;
      if (verifyOtpChallenge) {
        next = await resendOtp(verifyOtpChallenge.challengeToken, {
          auth: true,
          teacherName: ctx.kind === 'delete' ? ctx.teacher.full_name : ctx.targetName,
          actionLabel: ctx.kind === 'action' ? ctx.actionLabel : undefined,
        });
      } else if (ctx.kind === 'delete') {
        next = await requestTeacherDeleteOtp(ctx.teacher.id);
      } else {
        next = await requestActionOtp({
          actionLabel: ctx.actionLabel,
          targetId: ctx.targetId,
          targetName: ctx.targetName,
        });
      }
      setVerifyOtpChallenge(next);
      setVerifyOtpCountdown(60);
      setVerifyOtpCode('');
      setTimeout(() => verifyOtpInputRef.current?.focus(), 80);
    } catch (err: unknown) {
      setVerifyError(
        err instanceof Error ? err.message : 'Failed to send verification OTP via Gmail.'
      );
    } finally {
      setVerifyOtpSending(false);
    }
  }

  function handleSwitchVerifyMode(nextMode: AdminVerifyMethod, ctx: VerifyOtpContext) {
    setVerifyMode(nextMode);
    setVerifyError('');
    if (nextMode === 'password') {
      setTimeout(() => verifyPasswordInputRef.current?.focus(), 40);
      return;
    }
    if (!verifyOtpChallenge && !verifyOtpSending) {
      void sendOrResendVerifyOtp(ctx);
    } else {
      setTimeout(() => verifyOtpInputRef.current?.focus(), 40);
    }
  }

  function scrollToSection(id: string, nextStatusFilter?: string) {
    if (nextStatusFilter) {
      setStatusFilter(nextStatusFilter);
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openApprovalModal(teacher: Teacher) {
    setSelectedTeacher(teacher);
    setShowRejectPrompt(false);
    setRejectReason('');
    setModalError('');
    setPreviewTab('card');
  }

  function startVerifyApproveOrReject(edit: PendingEditVerify) {
    setModalError('');
    setSelectedTeacher(null);
    setShowRejectPrompt(false);
    setRejectReason('');
    resetVerifyState('password');
    setPendingEditVerify(edit);
    setTimeout(() => verifyPasswordInputRef.current?.focus(), 60);
  }

  // ── Verified Approve / Reject Teacher ────────────────────────
  async function handleSubmitPendingEditVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingEditVerify) return;

    const checked = validateAdminVerifyInput({
      mode: verifyMode,
      password: verifyPassword,
      otpCode: verifyOtpCode,
      otpChallenge: verifyOtpChallenge,
    });
    if (!checked.ok) {
      setVerifyError(checked.error);
      return;
    }

    setActionBusy(true);
    setVerifyError('');
    try {
      if (pendingEditVerify.type === 'approve') {
        const res = await approveTeacher(pendingEditVerify.teacher.id, checked.verification);
        setTeachers((prev) =>
          prev.map((t) => (t.id === pendingEditVerify.teacher.id ? res.teacher : t))
        );
        if (res.log) {
          setActivityLogs((prev) => [res.log, ...prev.filter((item) => item.id !== res.log.id)]);
        }
        showToast(`Approved ${pendingEditVerify.teacher.full_name}'s teacher account.`, 'success');
      } else {
        const res = await rejectTeacher(
          pendingEditVerify.teacher.id,
          pendingEditVerify.reason,
          checked.verification
        );
        setTeachers((prev) =>
          prev.map((t) => (t.id === pendingEditVerify.teacher.id ? res.teacher : t))
        );
        if (res.log) {
          setActivityLogs((prev) => [res.log, ...prev.filter((item) => item.id !== res.log.id)]);
        }
        showToast(`Rejected ${pendingEditVerify.teacher.full_name}'s registration.`, 'info');
      }
      setPendingEditVerify(null);
      resetVerifyState('password');
    } catch (err: unknown) {
      setVerifyError(
        err instanceof Error ? err.message : 'Admin verification failed. No changes saved.'
      );
    } finally {
      setActionBusy(false);
    }
  }

  // ── Enable / Disable Teacher ─────────────────────────────────
  function handleOpenToggleStatus(teacher: Teacher) {
    resetVerifyState('password');
    setStatusConfirmTeacher(teacher);
    setTimeout(() => verifyPasswordInputRef.current?.focus(), 60);
  }

  async function handleConfirmToggleStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!statusConfirmTeacher) return;

    const checked = validateAdminVerifyInput({
      mode: verifyMode,
      password: verifyPassword,
      otpCode: verifyOtpCode,
      otpChallenge: verifyOtpChallenge,
    });
    if (!checked.ok) {
      setVerifyError(checked.error);
      return;
    }

    setActionBusy(true);
    setVerifyError('');
    try {
      const res = await toggleTeacherStatus(statusConfirmTeacher.id, checked.verification);
      setTeachers((prev) =>
        prev.map((t) => (t.id === statusConfirmTeacher.id ? res.teacher : t))
      );
      if (res.log) {
        setActivityLogs((prev) => [res.log, ...prev.filter((item) => item.id !== res.log.id)]);
      }
      const enabled = res.teacher.status === 'approved';
      showToast(
        `${statusConfirmTeacher.full_name} has been ${enabled ? 'enabled' : 'disabled'}.`,
        enabled ? 'success' : 'info'
      );
      setStatusConfirmTeacher(null);
      resetVerifyState('password');
    } catch (err: unknown) {
      setVerifyError(
        err instanceof Error ? err.message : 'Failed to verify and update teacher status.'
      );
    } finally {
      setActionBusy(false);
    }
  }

  // ── Authorize Permanent Deletion (Gmail OTP or Password) ─────
  async function handleOpenDeleteOtp(teacher: Teacher) {
    setDeleteTarget(teacher);
    resetVerifyState('otp');
    await sendOrResendVerifyOtp({ kind: 'delete', teacher });
  }

  async function handleVerifyAndDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;

    const checked = validateAdminVerifyInput({
      mode: verifyMode,
      password: verifyPassword,
      otpCode: verifyOtpCode,
      otpChallenge: verifyOtpChallenge,
    });
    if (!checked.ok) {
      setVerifyError(checked.error);
      return;
    }

    setActionBusy(true);
    setVerifyError('');
    try {
      const res = await confirmDeleteTeacher(deleteTarget.id, checked.verification);
      setTeachers((prev) => prev.filter((t) => t.id !== res.deletedId));
      if (res.log) {
        setActivityLogs((prev) => [res.log, ...prev.filter((item) => item.id !== res.log.id)]);
      }
      const deletedName = deleteTarget.full_name;
      setDeleteTarget(null);
      resetVerifyState('password');
      showToast(`Permanently deleted ${deletedName}.`, 'info');
    } catch (err: unknown) {
      setVerifyError(
        err instanceof Error ? err.message : 'Admin verification failed. Account was not deleted.'
      );
    } finally {
      setActionBusy(false);
    }
  }

  // ── Clear Activity Log (Password or Gmail OTP Verified) ───────
  function handleOpenClearLogDialog() {
    resetVerifyState('password');
    setShowClearLogDialog(true);
    setTimeout(() => verifyPasswordInputRef.current?.focus(), 60);
  }

  async function handleConfirmClearLog(e: React.FormEvent) {
    e.preventDefault();

    const checked = validateAdminVerifyInput({
      mode: verifyMode,
      password: verifyPassword,
      otpCode: verifyOtpCode,
      otpChallenge: verifyOtpChallenge,
    });
    if (!checked.ok) {
      setVerifyError(checked.error);
      return;
    }

    setActionBusy(true);
    setVerifyError('');
    try {
      const res = await clearActivityLogs(checked.verification);
      setActivityLogs(res.log ? [res.log] : []);
      setShowClearLogDialog(false);
      resetVerifyState('password');
      showToast('Activity log cleared.', 'info');
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : 'Failed to verify and clear logs.');
    } finally {
      setActionBusy(false);
    }
  }

  function formatClock(date: Date) {
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();
    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return `${month} ${day}, ${year} • ${time}`;
  }

  return (
    <div className={`dash-page-wrapper ${darkMode ? 'dark' : ''}`}>
      {/* ═══════════════════════════════════════════════════════
         1. Solid Orange Top Navigation Bar
         ═══════════════════════════════════════════════════════ */}
      <header className="dash-top-header">
        <div className="dash-header-inner">
          <div className="dash-brand-block">
            <div className="dash-logo-badge">
              <img src={mascotImg} alt="Tseki Mascot" className="dash-mascot-img" />
            </div>
            <div className="dash-brand-titles">
              <div className="dash-title-row">
                <span className="dash-app-name">Tseki</span>
                <span className="dash-admin-tag">ADMIN</span>
              </div>
              <span className="dash-app-sub">Educational Assessment &amp; Verification</span>
            </div>
          </div>

          <div className="dash-nav-actions">
            <button
              type="button"
              className="dash-icon-btn"
              onClick={toggleDarkMode}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div className="dash-notif-wrap" ref={notifWrapRef}>
              <button
                type="button"
                className="dash-notif-btn"
                onClick={() => setShowNotifDropdown((prev) => !prev)}
                aria-expanded={showNotifDropdown}
                aria-label={`Notifications (${pendingCount} pending approvals, ${unreadActivityLogs.length} unread activity alerts)`}
              >
                <Bell size={18} />
                {totalNotifCount > 0 && (
                  <span className="dash-notif-badge">
                    {totalNotifCount > 99 ? '99+' : totalNotifCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div
                  className="dash-notif-popover"
                  role="region"
                  aria-label="Admin Activity and Approval Notifications"
                >
                  <div className="notif-popover-header">
                    <div className="notif-header-title">
                      <span>Notifications</span>
                      {unreadActivityLogs.length > 0 && (
                        <span className="notif-count-pill">{unreadActivityLogs.length} new</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="notif-mark-read-btn"
                      onClick={() => markAllNotifsRead()}
                      disabled={unreadActivityLogs.length === 0}
                    >
                      Mark all read
                    </button>
                  </div>

                  {pendingTeachers.length > 0 && (
                    <div className="notif-section">
                      <div className="notif-section-label">
                        <span>Pending Approvals</span>
                        <span className="notif-mini-count">{pendingCount}</span>
                      </div>
                      <ul className="notif-list notif-list-compact">
                        {pendingTeachers.slice(0, 3).map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              className="notif-item-btn notif-item-unread"
                              onClick={() => {
                                setShowNotifDropdown(false);
                                openApprovalModal(t);
                              }}
                            >
                              <div className="notif-item-top">
                                <span className="notif-source-tag tag-pending">Pending Review</span>
                                <span className="notif-unread-dot" aria-hidden="true" />
                              </div>
                              <span className="notif-item-name">{t.full_name}</span>
                              <span className="notif-item-sub">
                                {t.grade_level || 'Teacher'} • {t.subject || 'Registration'}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="notif-section">
                    <div className="notif-section-label">
                      <span>Recent Activity</span>
                      <button
                        type="button"
                        className="notif-view-all-btn"
                        onClick={() => {
                          setShowNotifDropdown(false);
                          setActivityFilter('all');
                          scrollToSection('activity-log-section');
                        }}
                      >
                        View all
                      </button>
                    </div>
                    {activityLogs.length === 0 ? (
                      <p className="notif-empty">No recent activity alerts yet.</p>
                    ) : (
                      <ul className="notif-list">
                        {activityLogs.slice(0, 8).map((log) => {
                          const isAdmin = isAdminActivityLog(log);
                          const isUnread = getLogTimestampMs(log) > lastNotifReadAt;
                          return (
                            <li key={log.id}>
                              <button
                                type="button"
                                className={`notif-item-btn ${isUnread ? 'notif-item-unread' : ''}`}
                                onClick={() => {
                                  setShowNotifDropdown(false);
                                  setActivityFilter(isAdmin ? 'admin' : 'app');
                                  markAllNotifsRead();
                                  scrollToSection('activity-log-section');
                                }}
                              >
                                <div className="notif-item-top">
                                  <span
                                    className={`notif-source-tag ${
                                      isAdmin ? 'tag-admin' : 'tag-app'
                                    }`}
                                  >
                                    {isAdmin ? 'Admin Action' : 'Teacher App'}
                                  </span>
                                  <span className="notif-item-time">{log.time_display}</span>
                                </div>
                                <span className="notif-item-name">
                                  {isUnread && <span className="notif-unread-dot" aria-hidden="true" />}
                                  {log.teacher_name}
                                </span>
                                <span className="notif-item-sub">{log.operation}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button type="button" className="dash-logout-btn" onClick={signOut}>
              <LogOut size={16} aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════
         Main Content Area
         ═══════════════════════════════════════════════════════ */}
      <main className="dash-main-container">
        <div className="dash-headline-row">
          <div className="dash-headline-left">
            <h1 className="dash-page-heading">
              <span className="dash-heading-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="5" r="3.5" fill="#FF6B00" />
                  <circle cx="6" cy="17" r="3.5" fill="#FF6B00" />
                  <circle cx="18" cy="17" r="3.5" fill="#FF6B00" />
                  <path
                    d="M12 8.5L7.5 14M12 8.5L16.5 14M9 17H15"
                    stroke="#FF6B00"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              Dashboard
            </h1>
            <p className="dash-page-subtext">
              Overview of teacher registrations, account statuses, and system activity logs.
            </p>
          </div>
          <div className="dash-headline-right">
            {dataSource === 'supabase' && (
              <span className="dash-live-pill">
                <span className="live-dot" aria-hidden="true" />
                Live Tseki Data
              </span>
            )}
            <button
              type="button"
              className="dash-sync-btn"
              onClick={loadDashboard}
              disabled={loading}
              title="Refresh Tseki data"
            >
              <RotateCw size={13} className={loading ? 'spin-icon' : ''} aria-hidden="true" />
              <span>Sync</span>
            </button>
            <div className="dash-datetime-pill">
              <Calendar size={14} className="dash-cal-icon" aria-hidden="true" />
              <span>{formatClock(currentTime)}</span>
            </div>
          </div>
        </div>

        {dataSource === 'supabase_needs_service_key' && (
          <div className="dash-setup-banner" role="status">
            <AlertTriangle size={17} aria-hidden="true" />
            <div>
              <strong>Supabase Service Role Key Required:</strong> Add{' '}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> (from Supabase Dashboard &rarr; Project
              Settings &rarr; API) to <code>admin-web/.env</code> and restart the server to load
              live Tseki Total Accounts, Active Accounts, and Activity Logs.
            </div>
          </div>
        )}

        {loadError && (
          <div className="dash-error-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{loadError}</span>
          </div>
        )}

        {/* ── Stat Cards ──────────────────────────────────────── */}
        <div className="dash-stats-grid">
          <button
            type="button"
            className="dash-stat-card"
            onClick={() => scrollToSection('account-management', 'all')}
          >
            <div className="stat-card-top">
              <span className="stat-card-title">TOTAL ACCOUNTS</span>
              <span className="stat-card-link">Click to view &rsaquo;</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{totalCount}</span>
              <div className="stat-card-icon-box orange-box" aria-hidden="true">
                <Users size={22} />
              </div>
            </div>
            <div className="stat-card-bottom active-text">
              <span>+ Active System</span>
            </div>
          </button>

          <button
            type="button"
            className="dash-stat-card"
            onClick={() => scrollToSection('pending-approvals')}
          >
            <div className="stat-card-top">
              <span className="stat-card-title pending-title">PENDING APPROVALS</span>
              <span className="stat-card-link">Click to view &rsaquo;</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{pendingCount}</span>
              <div className="stat-card-icon-box yellow-box" aria-hidden="true">
                <UserPlus size={22} />
              </div>
            </div>
            <div className="stat-card-bottom pending-text">
              <span className="stat-dot orange-dot" />
              <span>Requires Action</span>
            </div>
          </button>

          <button
            type="button"
            className="dash-stat-card"
            onClick={() => scrollToSection('account-management', 'approved')}
          >
            <div className="stat-card-top">
              <span className="stat-card-title active-title">ACTIVE ACCOUNTS</span>
              <span className="stat-card-link">Click to view &rsaquo;</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{activeCount}</span>
              <div className="stat-card-icon-box green-box" aria-hidden="true">
                <UserCheck size={22} />
              </div>
            </div>
            <div className="stat-card-bottom verified-text">
              <span className="stat-dot green-dot" />
              <span>Verified Teachers</span>
            </div>
          </button>
        </div>

        {/* ── Section 1: Pending Approvals ────────────────────── */}
        <section id="pending-approvals" className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon yellow-badge" aria-hidden="true">
                <UserPlus size={18} />
              </div>
              <div>
                <h2 id="pending-approvals-heading" className="dash-panel-heading">
                  Pending Approvals
                </h2>
                <p className="dash-panel-subheading">
                  New teacher verification requests waiting for validation
                </p>
              </div>
            </div>
            {pendingTeachers.length > 0 && (
              <div className="pending-counter-badge">
                {pendingTeachers.length} Request{pendingTeachers.length > 1 ? 's' : ''} Pending
              </div>
            )}
          </div>

          {loading ? (
            <div className="dash-table-loading">
              <div className="btn-spinner dark-spinner" />
              <span>Loading approvals...</span>
            </div>
          ) : pendingTeachers.length === 0 ? (
            <div className="dash-empty-state">
              <CheckCircle size={36} className="empty-check" aria-hidden="true" />
              <p>No pending teacher verification requests.</p>
              <span>
                Teacher registrations will appear here once the teacher sign-up form is connected to
                admin approval.
              </span>
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="pending-approvals-heading"
              className="dash-table-container"
            >
              <table className="dash-table dash-table-pending">
                <thead>
                  <tr>
                    <th scope="col">NAME</th>
                    <th scope="col">GRADE LEVEL</th>
                    <th scope="col">SUBJECT / FIELD</th>
                    <th scope="col" className="th-right">
                      ACTION
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTeachers.map((teacher) => (
                    <tr key={teacher.id}>
                      <th scope="row" className="td-name">
                        <strong>{teacher.full_name}</strong>
                      </th>
                      <td className="td-muted" data-label="Grade Level">
                        {teacher.grade_level || 'Teacher'}
                      </td>
                      <td data-label="Subject / Field">
                        <span className="subject-chip">{teacher.subject || 'General'}</span>
                      </td>
                      <td className="td-right" data-label="Action">
                        <button
                          type="button"
                          className="view-btn-pill"
                          onClick={() => openApprovalModal(teacher)}
                        >
                          <Eye size={13} aria-hidden="true" />
                          VIEW
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 2: Account Management ───────────────────── */}
        <section id="account-management" className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon orange-badge" aria-hidden="true">
                <Users size={18} />
              </div>
              <div>
                <h2 id="account-management-heading" className="dash-panel-heading">
                  Account Management
                </h2>
                <p className="dash-panel-subheading">
                  Manage existing teacher accounts, toggle status, or remove users
                </p>
              </div>
            </div>
            <search>
              <form
                className="dash-panel-filters"
                onSubmit={(e) => e.preventDefault()}
                aria-label="Filter teacher accounts"
              >
                <div className="search-input-wrap">
                  <Search size={15} className="search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search teacher or role"
                    placeholder="Search teacher or role..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-field"
                  />
                </div>
                <select
                  aria-label="Filter by account status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="status-dropdown"
                >
                  <option value="all">All Statuses</option>
                  <option value="approved">Active</option>
                  <option value="unverified">Unverified Email</option>
                  <option value="inactive">Inactive / Rejected</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </form>
            </search>
          </div>

          {filteredTeachers.length === 0 ? (
            <div className="dash-empty-state">
              <Users size={34} className="empty-muted" aria-hidden="true" />
              <p>No teacher accounts match your current filter.</p>
              <span>Try adjusting your search query or status filter.</span>
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="account-management-heading"
              className="dash-table-container"
            >
              <table className="dash-table dash-table-accounts">
                <thead>
                  <tr>
                    <th scope="col">NAME</th>
                    <th scope="col">GRADE LEVEL</th>
                    <th scope="col">STATUS</th>
                    <th scope="col" className="th-right">
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTeachers.map((teacher) => {
                    const isActive = teacher.status === 'approved';
                    const isPending = teacher.status === 'pending';
                    const isRejected = teacher.status === 'rejected';
                    const isUnverified = teacher.status === 'unverified';
                    return (
                      <tr key={teacher.id}>
                        <th scope="row" className="td-name" data-label="Name">
                          <strong>{teacher.full_name}</strong>
                        </th>
                        <td className="td-muted" data-label="Grade Level">
                          {teacher.grade_level || 'Teacher'}
                        </td>
                        <td data-label="Status">
                          {isActive ? (
                            <span className="status-pill status-pill-active">
                              &#10003; Active
                            </span>
                          ) : isPending ? (
                            <span className="status-pill status-pill-pending">
                              &bull; Pending
                            </span>
                          ) : isUnverified ? (
                            <span className="status-pill status-pill-unverified">
                              &bull; Unverified
                            </span>
                          ) : isRejected ? (
                            <span className="status-pill status-pill-rejected">
                              &bull; Rejected
                            </span>
                          ) : (
                            <span className="status-pill status-pill-inactive">
                              &bull; Inactive
                            </span>
                          )}
                        </td>
                        <td className="td-right" data-label="Actions">
                          <div className="actions-cluster">
                            {isPending ? (
                              <button
                                type="button"
                                className="action-pill-btn btn-review"
                                onClick={() => openApprovalModal(teacher)}
                              >
                                Review
                              </button>
                            ) : isActive ? (
                              <button
                                type="button"
                                className="action-pill-btn btn-disable"
                                onClick={() => handleOpenToggleStatus(teacher)}
                              >
                                Disable
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="action-pill-btn btn-enable"
                                onClick={() => handleOpenToggleStatus(teacher)}
                              >
                                Enable
                              </button>
                            )}
                            <button
                              type="button"
                              className="action-pill-btn btn-delete"
                              onClick={() => handleOpenDeleteOtp(teacher)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 3: Activity Log ─────────────────────────── */}
        <section id="activity-log-section" className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon blue-badge" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </div>
              <div>
                <h2 id="activity-log-heading" className="dash-panel-heading">
                  Activity Log
                </h2>
                <p className="dash-panel-subheading">
                  Real-time audit trail of admin actions, verifications, and teacher app operations
                </p>
              </div>
            </div>
            <div className="dash-log-actions">
              <span className="events-counter-pill">{filteredActivityLogs.length} Events</span>
              <button
                type="button"
                className="clear-log-btn"
                onClick={handleOpenClearLogDialog}
                disabled={activityLogs.length === 0}
              >
                <Trash2 size={13} aria-hidden="true" />
                <span>Clear Log</span>
              </button>
            </div>
          </div>

          <div className="activity-tabs-bar" role="tablist" aria-label="Activity Log Filter">
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === 'all'}
              className={`activity-tab-btn ${activityFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActivityFilter('all')}
            >
              All Activity
              <span className="activity-tab-count">{activityLogs.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === 'admin'}
              className={`activity-tab-btn ${activityFilter === 'admin' ? 'active' : ''}`}
              onClick={() => setActivityFilter('admin')}
            >
              Admin Actions
              <span className="activity-tab-count">{adminLogsCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityFilter === 'app'}
              className={`activity-tab-btn ${activityFilter === 'app' ? 'active' : ''}`}
              onClick={() => setActivityFilter('app')}
            >
              Teacher App
              <span className="activity-tab-count">{appLogsCount}</span>
            </button>
          </div>

          {filteredActivityLogs.length === 0 ? (
            <div className="dash-empty-state">
              <p>
                {activityFilter === 'admin'
                  ? 'No admin actions recorded yet.'
                  : activityFilter === 'app'
                  ? 'No Tseki teacher app events recorded yet.'
                  : 'No activity log events recorded.'}
              </p>
              <span>
                Admin logins, verifications, approvals, and live Tseki app actions appear here.
              </span>
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="activity-log-heading"
              className="dash-table-container"
            >
              <table className="dash-table dash-table-logs">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '132px' }}>
                      SOURCE
                    </th>
                    <th scope="col">TEACHER / TARGET</th>
                    <th scope="col">ACTION / OPERATION</th>
                    <th scope="col" className="th-right">
                      TIME &amp; DATE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivityLogs.map((log) => {
                    const isAdmin = isAdminActivityLog(log);
                    return (
                      <tr key={log.id}>
                        <td data-label="Source">
                          <span
                            className={`log-source-badge ${
                              isAdmin ? 'badge-admin' : 'badge-app'
                            }`}
                            title={log.actor ? `Actor: ${log.actor}` : undefined}
                          >
                            {isAdmin ? 'Admin Action' : 'Teacher App'}
                          </span>
                        </td>
                        <th scope="row" className="td-name" data-label="Teacher / Target">
                          <strong>{log.teacher_name}</strong>
                        </th>
                        <td className="td-desc" data-label="Operation">
                          {log.operation}
                        </td>
                        <td className="td-right td-time" data-label="Time & Date">
                          {log.time_display}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Footer ──────────────────────────────────────────── */}
        <footer className="dash-bottom-footer">
          <span className="footer-copyright">
            © {new Date().getFullYear()} Tseki Assessment &amp; Verification System. All rights
            reserved.
          </span>
          <div className="footer-links-group">
            <a href="#privacy">Privacy Policy</a>
            <span className="footer-bullet">•</span>
            <a href="#terms">Terms of Service</a>
          </div>
        </footer>
      </main>

      {/* ═══════════════════════════════════════════════════════
         Modal 1: Approval Request Modal
         ═══════════════════════════════════════════════════════ */}
      <ModalDialog
        open={Boolean(selectedTeacher)}
        onClose={() => {
          setSelectedTeacher(null);
          setShowRejectPrompt(false);
          setRejectReason('');
          setModalError('');
        }}
        labelledBy="approval-modal-title"
        closedBy="any"
        className="approval-modal-card"
      >
        {selectedTeacher && (
          <>
            <div className="modal-card-header">
              <div className="modal-header-left">
                <span className="modal-orange-dot" aria-hidden="true" />
                <h3 id="approval-modal-title" className="modal-title">
                  Approval Request
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setSelectedTeacher(null)}
                aria-label="Close approval modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-card-body">
              {modalError && (
                <div className="modal-inline-error" role="alert">
                  {modalError}
                </div>
              )}
              <div className="modal-two-columns">
                <div className="modal-col-left">
                  <div className="modal-field-block">
                    <span className="modal-field-label">TEACHER NAME</span>
                    <h4 className="modal-field-name">{selectedTeacher.full_name}</h4>
                  </div>

                  <div className="modal-field-block">
                    <span className="modal-field-label">INSTITUTIONAL EMAIL</span>
                    <a
                      href={`mailto:${selectedTeacher.email}`}
                      className="modal-email-link"
                    >
                      {selectedTeacher.email}
                    </a>
                  </div>

                  <div className="modal-field-row">
                    <div className="modal-field-block flex-1">
                      <span className="modal-field-label">TEACHER ID</span>
                      <div className="teacher-id-badge">
                        {selectedTeacher.teacher_id || '102262'}
                      </div>
                    </div>
                    <div className="modal-field-block flex-1">
                      <span className="modal-field-label">GRADE LEVEL</span>
                      <span className="modal-field-text">
                        {selectedTeacher.grade_level?.replace(' Teacher', '') || 'Senior High'}
                      </span>
                    </div>
                  </div>

                  <div className="modal-field-block">
                    <span className="modal-field-label">STRAND / SUBJECT</span>
                    <span className="modal-field-text bold">
                      {selectedTeacher.strand || selectedTeacher.subject || 'HUMSS'}
                    </span>
                  </div>
                </div>

                <div className="modal-col-right">
                  <div className="tseki-id-card-frame">
                    <div className="id-card-top-row">
                      <span className="id-card-tagline">TSEKI ID CARD</span>
                      <img
                        src={mascotImg}
                        alt="Tseki Mascot"
                        className="id-card-mini-mascot"
                      />
                    </div>

                    {(selectedTeacher.school_id_url || selectedTeacher.facial_verification_url) && (
                      <div className="id-card-preview-tabs">
                        <button
                          type="button"
                          className={`preview-tab-btn ${previewTab === 'card' ? 'active' : ''}`}
                          onClick={() => setPreviewTab('card')}
                        >
                          ID Card
                        </button>
                        {selectedTeacher.school_id_url && (
                          <button
                            type="button"
                            className={`preview-tab-btn ${
                              previewTab === 'school_id' ? 'active' : ''
                            }`}
                            onClick={() => setPreviewTab('school_id')}
                          >
                            School ID
                          </button>
                        )}
                        {selectedTeacher.facial_verification_url && (
                          <button
                            type="button"
                            className={`preview-tab-btn ${previewTab === 'face' ? 'active' : ''}`}
                            onClick={() => setPreviewTab('face')}
                          >
                            Face Photo
                          </button>
                        )}
                      </div>
                    )}

                    {previewTab === 'school_id' && selectedTeacher.school_id_url ? (
                      <img
                        src={selectedTeacher.school_id_url}
                        alt={`${selectedTeacher.full_name} school ID`}
                        className="id-card-uploaded-img"
                      />
                    ) : previewTab === 'face' && selectedTeacher.facial_verification_url ? (
                      <img
                        src={selectedTeacher.facial_verification_url}
                        alt={`${selectedTeacher.full_name} facial verification`}
                        className="id-card-uploaded-img"
                      />
                    ) : (
                      <div className="id-card-center-row">
                        <div className="id-card-initials-box">
                          {getInitials(selectedTeacher.full_name)}
                        </div>
                        <div className="id-card-info">
                          <span className="id-card-teacher-name">
                            {selectedTeacher.full_name}
                          </span>
                          <span className="id-card-faculty">Faculty Member</span>
                          <span className="id-card-verified-code">VERIFIED-TC-2026</span>
                        </div>
                      </div>
                    )}

                    <div className="id-card-bottom-link">
                      <Paperclip size={13} aria-hidden="true" />
                      <span>Photo Attached (Verified)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-card-footer">
              <button
                type="button"
                className="modal-btn-approve"
                onClick={() =>
                  startVerifyApproveOrReject({ type: 'approve', teacher: selectedTeacher })
                }
                disabled={actionBusy}
              >
                <CheckCircle size={18} aria-hidden="true" />
                <span>Approve</span>
              </button>
              <button
                type="button"
                className="modal-btn-reject"
                onClick={() => setShowRejectPrompt(true)}
                disabled={actionBusy}
              >
                <XCircle size={18} aria-hidden="true" />
                <span>Reject</span>
              </button>
            </div>

            {showRejectPrompt && (
              <form
                className="reject-prompt-drawer"
                onSubmit={(e) => {
                  e.preventDefault();
                  startVerifyApproveOrReject({
                    type: 'reject',
                    teacher: selectedTeacher,
                    reason:
                      rejectReason.trim() || 'Verification documents could not be validated',
                  });
                }}
              >
                <label htmlFor="reject-reason-input" className="reject-label">
                  Specify Rejection Reason:
                </label>
                <div className="reject-input-row">
                  <input
                    id="reject-reason-input"
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Invalid institutional credentials"
                    className="reject-input"
                    autoFocus
                    disabled={actionBusy}
                  />
                  <button
                    type="submit"
                    className="reject-confirm-btn"
                    disabled={actionBusy}
                  >
                    Continue to Verify
                  </button>
                  <button
                    type="button"
                    className="reject-cancel-btn"
                    onClick={() => setShowRejectPrompt(false)}
                    disabled={actionBusy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </ModalDialog>

      {/* ═══════════════════════════════════════════════════════
         Modal 2: Disable / Enable Confirmation Modal (Verified)
         ═══════════════════════════════════════════════════════ */}
      <ModalDialog
        open={Boolean(statusConfirmTeacher)}
        onClose={() => {
          setStatusConfirmTeacher(null);
          resetVerifyState('password');
        }}
        labelledBy="status-confirm-title"
        closedBy="closerequest"
        className="compact-confirm-dialog"
      >
        {statusConfirmTeacher && (() => {
          const isDisabling = statusConfirmTeacher.status === 'approved';
          const otpCtx: VerifyOtpContext = {
            kind: 'action',
            actionLabel: isDisabling ? 'Disable Teacher Account' : 'Enable Teacher Account',
            targetId: statusConfirmTeacher.id,
            targetName: statusConfirmTeacher.full_name,
          };
          return (
            <form className="confirm-dialog-inner" onSubmit={handleConfirmToggleStatus}>
              <div
                className={`confirm-icon-badge ${isDisabling ? 'amber-badge' : 'green-badge'}`}
                aria-hidden="true"
              >
                {isDisabling ? <UserX size={24} /> : <UserCheck size={24} />}
              </div>
              <h3 id="status-confirm-title" className="confirm-dialog-title">
                {isDisabling ? 'Disable' : 'Enable'} {statusConfirmTeacher.full_name}?
              </h3>
              <p className="confirm-dialog-desc">
                {isDisabling
                  ? `Disabling will temporarily revoke ${statusConfirmTeacher.full_name}'s portal access while retaining their assessment history.`
                  : `Re-enabling will restore ${statusConfirmTeacher.full_name}'s portal access and existing assessment history.`}
              </p>

              <AdminVerifyBox
                idPrefix="status-confirm"
                systemEmail={systemEmail}
                mode={verifyMode}
                onModeChange={(next) => handleSwitchVerifyMode(next, otpCtx)}
                password={verifyPassword}
                onPasswordChange={(val) => {
                  setVerifyPassword(val);
                  if (verifyError) setVerifyError('');
                }}
                otpCode={verifyOtpCode}
                onOtpCodeChange={(val) => {
                  setVerifyOtpCode(val);
                  if (verifyError) setVerifyError('');
                }}
                otpChallenge={verifyOtpChallenge}
                otpCountdown={verifyOtpCountdown}
                otpSending={verifyOtpSending}
                onSendOrResendOtp={() => void sendOrResendVerifyOtp(otpCtx)}
                error={verifyError}
                disabled={actionBusy}
                passwordInputRef={verifyPasswordInputRef}
                otpInputRef={verifyOtpInputRef}
              />

              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="confirm-btn-cancel"
                  onClick={() => {
                    setStatusConfirmTeacher(null);
                    resetVerifyState('password');
                  }}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={isDisabling ? 'confirm-btn-amber' : 'confirm-btn-green'}
                  disabled={actionBusy}
                >
                  {actionBusy
                    ? 'Verifying...'
                    : isDisabling
                    ? 'Verify & Disable'
                    : 'Verify & Enable'}
                </button>
              </div>
            </form>
          );
        })()}
      </ModalDialog>

      {/* ═══════════════════════════════════════════════════════
         Modal 3: Authorize Deletion Modal (Gmail OTP or Password)
         ═══════════════════════════════════════════════════════ */}
      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null);
          resetVerifyState('password');
        }}
        labelledBy="delete-otp-title"
        closedBy="closerequest"
        className="compact-confirm-dialog delete-otp-dialog"
      >
        {deleteTarget && (() => {
          const otpCtx: VerifyOtpContext = { kind: 'delete', teacher: deleteTarget };
          return (
            <form className="confirm-dialog-inner" onSubmit={handleVerifyAndDelete}>
              <div className="confirm-icon-badge red-badge" aria-hidden="true">
                <ShieldAlert size={24} />
              </div>
              <h3 id="delete-otp-title" className="confirm-dialog-title">
                Authorize Deletion: {deleteTarget.full_name}
              </h3>
              <p className="confirm-dialog-desc">
                Permanently deleting this teacher account requires admin verification via{' '}
                <strong>Gmail OTP</strong> or <strong>password re-entry</strong>.
              </p>

              <AdminVerifyBox
                idPrefix="delete-confirm"
                systemEmail={systemEmail}
                mode={verifyMode}
                onModeChange={(next) => handleSwitchVerifyMode(next, otpCtx)}
                password={verifyPassword}
                onPasswordChange={(val) => {
                  setVerifyPassword(val);
                  if (verifyError) setVerifyError('');
                }}
                otpCode={verifyOtpCode}
                onOtpCodeChange={(val) => {
                  setVerifyOtpCode(val);
                  if (verifyError) setVerifyError('');
                }}
                otpChallenge={verifyOtpChallenge}
                otpCountdown={verifyOtpCountdown}
                otpSending={verifyOtpSending}
                onSendOrResendOtp={() => void sendOrResendVerifyOtp(otpCtx)}
                error={verifyError}
                disabled={actionBusy}
                passwordInputRef={verifyPasswordInputRef}
                otpInputRef={verifyOtpInputRef}
              />

              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="confirm-btn-cancel"
                  onClick={() => {
                    setDeleteTarget(null);
                    resetVerifyState('password');
                  }}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="confirm-btn-red"
                  disabled={actionBusy || (verifyMode === 'otp' && !verifyOtpChallenge)}
                >
                  {actionBusy ? 'Verifying...' : 'Verify & Delete'}
                </button>
              </div>
            </form>
          );
        })()}
      </ModalDialog>

      {/* ═══════════════════════════════════════════════════════
         Modal 4: Clear Activity Log Confirmation (Verified)
         ═══════════════════════════════════════════════════════ */}
      <ModalDialog
        open={showClearLogDialog}
        onClose={() => {
          setShowClearLogDialog(false);
          resetVerifyState('password');
        }}
        labelledBy="clear-log-title"
        closedBy="closerequest"
        className="compact-confirm-dialog"
      >
        {showClearLogDialog && (() => {
          const otpCtx: VerifyOtpContext = {
            kind: 'action',
            actionLabel: 'Clear Activity Log',
            targetId: 'clear_logs',
            targetName: 'Admin Console',
          };
          return (
            <form className="confirm-dialog-inner" onSubmit={handleConfirmClearLog}>
              <div className="confirm-icon-badge red-badge" aria-hidden="true">
                <Trash2 size={22} />
              </div>
              <h3 id="clear-log-title" className="confirm-dialog-title">
                Clear Activity Log?
              </h3>
              <p className="confirm-dialog-desc">
                Verify your identity to clear {activityLogs.length} visible activity log entries. An
                audit entry recording this action will remain.
              </p>

              <AdminVerifyBox
                idPrefix="clear-log"
                systemEmail={systemEmail}
                mode={verifyMode}
                onModeChange={(next) => handleSwitchVerifyMode(next, otpCtx)}
                password={verifyPassword}
                onPasswordChange={(val) => {
                  setVerifyPassword(val);
                  if (verifyError) setVerifyError('');
                }}
                otpCode={verifyOtpCode}
                onOtpCodeChange={(val) => {
                  setVerifyOtpCode(val);
                  if (verifyError) setVerifyError('');
                }}
                otpChallenge={verifyOtpChallenge}
                otpCountdown={verifyOtpCountdown}
                otpSending={verifyOtpSending}
                onSendOrResendOtp={() => void sendOrResendVerifyOtp(otpCtx)}
                error={verifyError}
                disabled={actionBusy}
                passwordInputRef={verifyPasswordInputRef}
                otpInputRef={verifyOtpInputRef}
              />

              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="confirm-btn-cancel"
                  onClick={() => {
                    setShowClearLogDialog(false);
                    resetVerifyState('password');
                  }}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="confirm-btn-red"
                  disabled={actionBusy}
                >
                  {actionBusy ? 'Verifying...' : 'Verify & Clear Log'}
                </button>
              </div>
            </form>
          );
        })()}
      </ModalDialog>

      {/* ═══════════════════════════════════════════════════════
         Modal 5: Authorize Approve / Reject Verification
         ═══════════════════════════════════════════════════════ */}
      <ModalDialog
        open={Boolean(pendingEditVerify)}
        onClose={() => {
          setPendingEditVerify(null);
          resetVerifyState('password');
        }}
        labelledBy="edit-verify-title"
        closedBy="closerequest"
        className="compact-confirm-dialog"
      >
        {pendingEditVerify && (() => {
          const isApprove = pendingEditVerify.type === 'approve';
          const otpCtx: VerifyOtpContext = {
            kind: 'action',
            actionLabel: isApprove
              ? 'Approve Teacher Registration'
              : 'Reject Teacher Registration',
            targetId: pendingEditVerify.teacher.id,
            targetName: pendingEditVerify.teacher.full_name,
          };
          return (
            <form className="confirm-dialog-inner" onSubmit={handleSubmitPendingEditVerify}>
              <div
                className={`confirm-icon-badge ${isApprove ? 'green-badge' : 'red-badge'}`}
                aria-hidden="true"
              >
                {isApprove ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
              </div>
              <h3 id="edit-verify-title" className="confirm-dialog-title">
                {isApprove ? 'Authorize Approval' : 'Authorize Rejection'}:{' '}
                {pendingEditVerify.teacher.full_name}
              </h3>
              <p className="confirm-dialog-desc">
                {isApprove ? (
                  <>
                    Verify your administrator identity before approving{' '}
                    <strong>{pendingEditVerify.teacher.full_name}</strong> for portal access.
                  </>
                ) : (
                  <>
                    Verify your administrator identity before rejecting{' '}
                    <strong>{pendingEditVerify.teacher.full_name}</strong> (Reason:{' '}
                    <em>{pendingEditVerify.reason}</em>).
                  </>
                )}
              </p>

              <AdminVerifyBox
                idPrefix="edit-verify"
                systemEmail={systemEmail}
                mode={verifyMode}
                onModeChange={(next) => handleSwitchVerifyMode(next, otpCtx)}
                password={verifyPassword}
                onPasswordChange={(val) => {
                  setVerifyPassword(val);
                  if (verifyError) setVerifyError('');
                }}
                otpCode={verifyOtpCode}
                onOtpCodeChange={(val) => {
                  setVerifyOtpCode(val);
                  if (verifyError) setVerifyError('');
                }}
                otpChallenge={verifyOtpChallenge}
                otpCountdown={verifyOtpCountdown}
                otpSending={verifyOtpSending}
                onSendOrResendOtp={() => void sendOrResendVerifyOtp(otpCtx)}
                error={verifyError}
                disabled={actionBusy}
                passwordInputRef={verifyPasswordInputRef}
                otpInputRef={verifyOtpInputRef}
              />

              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="confirm-btn-cancel"
                  onClick={() => {
                    setPendingEditVerify(null);
                    resetVerifyState('password');
                  }}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={isApprove ? 'confirm-btn-green' : 'confirm-btn-red'}
                  disabled={actionBusy}
                >
                  {actionBusy
                    ? 'Verifying...'
                    : isApprove
                    ? 'Verify & Approve'
                    : 'Verify & Reject'}
                </button>
              </div>
            </form>
          );
        })()}
      </ModalDialog>

      {/* ═══════════════════════════════════════════════════════
         Persistent Toast Region (Popover="manual")
         ═══════════════════════════════════════════════════════ */}
      <div role="region" aria-label="Notifications" className="toast-region">
        <div className="visually-hidden" aria-live="polite">
          {toast && !anyModalOpen ? toast.message : ''}
        </div>
        <div
          ref={toastRef}
          {...({ popover: 'manual' } as Record<string, string>)}
          className={`admin-toast ${toast ? `toast-${toast.tone}` : ''}`}
        >
          {toast && (
            <>
              <span className="toast-dot" aria-hidden="true" />
              <span className="toast-message">{toast.message}</span>
              <button
                type="button"
                className="toast-close-btn"
                onClick={() => setToast(null)}
                aria-label="Close notification"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getInitials(name: string) {
  if (!name) return 'TC';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
