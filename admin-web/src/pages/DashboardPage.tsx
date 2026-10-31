import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../App';
import { supabase } from '../lib/supabase';
import {
  LogOut,
  Moon,
  Sun,
  Users,
  UserCheck,
  UserPlus,
  Calendar,
  Eye,
  Search,
  X,
  CheckCircle,
  XCircle,
  Trash2,
  Bell,
  Paperclip,
} from 'lucide-react';
import mascotImg from '../assets/tseki-mascot.png';
import './DashboardPage.css';

// ── Types ────────────────────────────────────────────────────
interface Teacher {
  id: string;
  username: string;
  email: string;
  full_name: string;
  school_id_url?: string;
  facial_verification_url?: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  rejection_reason?: string;
  created_at: string;
  approved_at?: string;
  grade_level?: string;
  subject?: string;
  teacher_id?: string;
  strand?: string;
}

interface ActivityLogEntry {
  id: number;
  teacher_name: string;
  operation: string;
  time_display: string;
}

export default function DashboardPage() {
  const { signOut, darkMode, toggleDarkMode } = useAuth();
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);

  // Teachers state
  const [teachers, setTeachers] = useState<Teacher[]>(getInitialTeachers());
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>(getInitialActivityLogs());
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Rejection modal prompt
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Live real-time clock updating every second
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Supabase Sync (Syncs with DB if tables exist, preserves fallback) ─────────
  const fetchTeachers = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('teachers')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        setTeachers(data);
      }
    } catch {
      // Keep state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  // Derived stats
  const totalCount = teachers.length;
  const pendingCount = teachers.filter((t) => t.status === 'pending').length;
  const activeCount = teachers.filter((t) => t.status === 'approved').length;

  // Filtered teachers for Account Management
  const filteredTeachers = teachers.filter((t) => {
    const matchesSearch =
      !searchQuery ||
      t.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.grade_level?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.subject?.toLowerCase().includes(searchQuery.toLowerCase());

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

  // Pending teachers for the Pending Approvals table
  const pendingTeachers = teachers.filter((t) => t.status === 'pending');

  // ── Actions ──────────────────────────────────────────────────
  async function handleApprove(teacher: Teacher) {
    const updatedTeachers = teachers.map((t) =>
      t.id === teacher.id
        ? { ...t, status: 'approved' as const, approved_at: new Date().toISOString() }
        : t
    );
    setTeachers(updatedTeachers);

    // Try Supabase update
    try {
      await supabase
        .from('teachers')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', teacher.id);
    } catch {
      // ignore
    }

    // Add activity log
    const newLog: ActivityLogEntry = {
      id: activityLogs.length + 1,
      teacher_name: teacher.full_name,
      operation: 'Admin Approved Teacher Registration',
      time_display: `Just now - ${formatCurrentDate()}`,
    };
    setActivityLogs([newLog, ...activityLogs]);
    setSelectedTeacher(null);
  }

  function handleOpenReject() {
    setShowRejectPrompt(true);
  }

  async function handleConfirmReject() {
    if (!selectedTeacher) return;
    const reason = rejectReason.trim() || 'Verification documents could not be validated';

    const updatedTeachers = teachers.map((t) =>
      t.id === selectedTeacher.id
        ? { ...t, status: 'rejected' as const, rejection_reason: reason }
        : t
    );
    setTeachers(updatedTeachers);

    try {
      await supabase
        .from('teachers')
        .update({ status: 'rejected', rejection_reason: reason })
        .eq('id', selectedTeacher.id);
    } catch {
      // ignore
    }

    const newLog: ActivityLogEntry = {
      id: activityLogs.length + 1,
      teacher_name: selectedTeacher.full_name,
      operation: `Admin Rejected Registration: ${reason}`,
      time_display: `Just now - ${formatCurrentDate()}`,
    };
    setActivityLogs([newLog, ...activityLogs]);
    setShowRejectPrompt(false);
    setRejectReason('');
    setSelectedTeacher(null);
  }

  async function handleToggleStatus(teacher: Teacher) {
    const newStatus = teacher.status === 'approved' ? ('suspended' as const) : ('approved' as const);
    setTeachers((prev) =>
      prev.map((t) => (t.id === teacher.id ? { ...t, status: newStatus } : t))
    );

    try {
      await supabase.from('teachers').update({ status: newStatus }).eq('id', teacher.id);
    } catch {
      // ignore
    }

    const op = newStatus === 'approved' ? 'Enabled Account' : 'Disabled Account';
    const newLog: ActivityLogEntry = {
      id: activityLogs.length + 1,
      teacher_name: teacher.full_name,
      operation: `Admin ${op}`,
      time_display: `Just now - ${formatCurrentDate()}`,
    };
    setActivityLogs([newLog, ...activityLogs]);
  }

  async function handleDelete(teacher: Teacher) {
    if (!confirm(`Are you sure you want to permanently delete ${teacher.full_name}?`)) {
      return;
    }
    setTeachers((prev) => prev.filter((t) => t.id !== teacher.id));

    try {
      await supabase.from('teachers').delete().eq('id', teacher.id);
    } catch {
      // ignore
    }
  }

  function handleClearLog() {
    if (confirm('Are you sure you want to clear the activity log?')) {
      setActivityLogs([]);
    }
  }

  // Format real-time clock: "Oct 22, 2026 • 09:30:09 PM"
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

  function formatCurrentDate() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  return (
    <div className={`dash-page-wrapper ${darkMode ? 'dark' : ''}`}>
      {/* ═══════════════════════════════════════════════════════
         1. Solid Orange Top Navigation Bar (Screenshot 2)
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
              <span className="dash-app-sub">Educational Assessment & Verification</span>
            </div>
          </div>

          <div className="dash-nav-actions">
            <button
              type="button"
              className="dash-icon-btn"
              onClick={toggleDarkMode}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="dash-notif-btn">
              <Bell size={18} />
              <span className="dash-notif-dot" />
            </div>
            <button type="button" className="dash-logout-btn" onClick={signOut}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════
         Main Content Area
         ═══════════════════════════════════════════════════════ */}
      <main className="dash-main-container">
        {/* Dashboard Title & Realtime Clock (Screenshot 2) */}
        <div className="dash-headline-row">
          <div className="dash-headline-left">
            <h1 className="dash-page-heading">
              <span className="dash-heading-icon">
                {/* 3 orange connected nodes / prism icon matching screenshot 2 */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="5" r="3.5" fill="#FF6B00" />
                  <circle cx="6" cy="17" r="3.5" fill="#FF6B00" />
                  <circle cx="18" cy="17" r="3.5" fill="#FF6B00" />
                  <path d="M12 8.5L7.5 14M12 8.5L16.5 14M9 17H15" stroke="#FF6B00" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              Dashboard
            </h1>
            <p className="dash-page-subtext">
              Overview of teacher registrations, account statuses, and system activity logs.
            </p>
          </div>
          <div className="dash-datetime-pill">
            <Calendar size={14} className="dash-cal-icon" />
            <span>{formatClock(currentTime)}</span>
          </div>
        </div>

        {/* ── Stat Cards (Screenshot 2) ─────────────────────── */}
        <div className="dash-stats-grid">
          {/* Card 1: Total Accounts */}
          <div className="dash-stat-card">
            <div className="stat-card-top">
              <span className="stat-card-title">TOTAL ACCOUNTS</span>
              <span className="stat-card-link">Click to view +</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{totalCount}</span>
              <div className="stat-card-icon-box orange-box">
                <Users size={22} />
              </div>
            </div>
            <div className="stat-card-bottom active-text">
              <span>+ Active System</span>
            </div>
          </div>

          {/* Card 2: Pending Approvals */}
          <div className="dash-stat-card">
            <div className="stat-card-top">
              <span className="stat-card-title pending-title">PENDING APPROVALS</span>
              <span className="stat-card-link">Click to view +</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{pendingCount}</span>
              <div className="stat-card-icon-box yellow-box">
                <UserPlus size={22} />
              </div>
            </div>
            <div className="stat-card-bottom pending-text">
              <span className="stat-dot orange-dot" />
              <span>Requires Action</span>
            </div>
          </div>

          {/* Card 3: Active Accounts */}
          <div className="dash-stat-card">
            <div className="stat-card-top">
              <span className="stat-card-title active-title">ACTIVE ACCOUNTS</span>
              <span className="stat-card-link">Click to view +</span>
            </div>
            <div className="stat-card-middle">
              <span className="stat-card-number">{activeCount}</span>
              <div className="stat-card-icon-box green-box">
                <UserCheck size={22} />
              </div>
            </div>
            <div className="stat-card-bottom verified-text">
              <span className="stat-dot green-dot" />
              <span>Verified Teachers</span>
            </div>
          </div>
        </div>

        {/* ── Section 1: Pending Approvals (Screenshot 2) ───── */}
        <section className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon yellow-badge">
                <UserPlus size={18} />
              </div>
              <div>
                <h2 className="dash-panel-heading">Pending Approvals</h2>
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
              <div className="btn-spinner" />
              <span>Loading approvals...</span>
            </div>
          ) : pendingTeachers.length === 0 ? (
            <div className="dash-empty-state">
              <CheckCircle size={36} className="empty-check" />
              <p>No pending teacher verification requests.</p>
              <span>All registered teachers have been reviewed.</span>
            </div>
          ) : (
            <div className="dash-table-container">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>GRADE LEVEL</th>
                    <th>SUBJECT / FIELD</th>
                    <th className="th-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTeachers.map((teacher) => (
                    <tr key={teacher.id}>
                      <td className="td-name">
                        <strong>{teacher.full_name}</strong>
                      </td>
                      <td className="td-muted">{teacher.grade_level}</td>
                      <td>
                        <span className="subject-chip">{teacher.subject}</span>
                      </td>
                      <td className="td-right">
                        <button
                          type="button"
                          className="view-btn-pill"
                          onClick={() => setSelectedTeacher(teacher)}
                        >
                          <Eye size={13} />
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

        {/* ── Section 2: Account Management (Screenshot 4) ──── */}
        <section className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon orange-badge">
                <Users size={18} />
              </div>
              <div>
                <h2 className="dash-panel-heading">Account Management</h2>
                <p className="dash-panel-subheading">
                  Manage existing teacher accounts, toggle status, or remove users
                </p>
              </div>
            </div>
            <div className="dash-panel-filters">
              <div className="search-input-wrap">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search teacher or role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-field"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="status-dropdown"
              >
                <option value="all">All Statuses</option>
                <option value="approved">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>

          <div className="dash-table-container">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>GRADE LEVEL</th>
                  <th>STATUS</th>
                  <th className="th-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map((teacher) => {
                  const isActive = teacher.status === 'approved';
                  return (
                    <tr key={teacher.id}>
                      <td className="td-name">
                        <strong>{teacher.full_name}</strong>
                      </td>
                      <td className="td-muted">{teacher.grade_level}</td>
                      <td>
                        {isActive ? (
                          <span className="status-pill status-pill-active">
                            + Active
                          </span>
                        ) : (
                          <span className="status-pill status-pill-inactive">
                            • Inactive
                          </span>
                        )}
                      </td>
                      <td className="td-right">
                        <div className="actions-cluster">
                          {isActive ? (
                            <button
                              type="button"
                              className="action-pill-btn btn-disable"
                              onClick={() => handleToggleStatus(teacher)}
                            >
                              Disable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="action-pill-btn btn-enable"
                              onClick={() => handleToggleStatus(teacher)}
                            >
                              Enable
                            </button>
                          )}
                          <button
                            type="button"
                            className="action-pill-btn btn-delete"
                            onClick={() => handleDelete(teacher)}
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
        </section>

        {/* ── Section 3: Activity Log (Screenshot 4 & 5) ────── */}
        <section className="dash-panel-section">
          <div className="dash-panel-header">
            <div className="dash-panel-title-group">
              <div className="panel-badge-icon blue-badge">
                {/* Activity list icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </div>
              <div>
                <h2 className="dash-panel-heading">Activity Log</h2>
                <p className="dash-panel-subheading">
                  Real-time audit trail of teacher classroom, assessment, and list operations
                </p>
              </div>
            </div>
            <div className="dash-log-actions">
              <span className="events-counter-pill">
                {activityLogs.length} Events
              </span>
              <button type="button" className="clear-log-btn" onClick={handleClearLog}>
                <Trash2 size={13} />
                <span>Clear Log</span>
              </button>
            </div>
          </div>

          <div className="dash-table-container">
            <table className="dash-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>ID</th>
                  <th>TEACHER NAME</th>
                  <th>TEACHER ACTION / OPERATION</th>
                  <th className="th-right">TIME & DATE</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="td-id">{log.id}</td>
                    <td className="td-name">
                      <strong>{log.teacher_name}</strong>
                    </td>
                    <td className="td-desc">{log.operation}</td>
                    <td className="td-right td-time">{log.time_display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Footer (Screenshot 5) ─────────────────────────── */}
        <footer className="dash-bottom-footer">
          <span className="footer-copyright">
            © {new Date().getFullYear()} Tseki Assessment & Verification System. All rights reserved.
          </span>
          <div className="footer-links-group">
            <a href="#privacy">Privacy Policy</a>
            <span className="footer-bullet">•</span>
            <a href="#terms">Terms of Service</a>
          </div>
        </footer>
      </main>

      {/* ═══════════════════════════════════════════════════════
         Approval Request Modal (Screenshot 3)
         ═══════════════════════════════════════════════════════ */}
      {selectedTeacher && (
        <div className="modal-backdrop-overlay" onClick={() => setSelectedTeacher(null)}>
          <div className="approval-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-card-header">
              <div className="modal-header-left">
                <span className="modal-orange-dot" />
                <h3 className="modal-title">Approval Request</h3>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setSelectedTeacher(null)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: 2 Columns */}
            <div className="modal-card-body">
              <div className="modal-two-columns">
                {/* Left Column: Teacher Details */}
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

                {/* Right Column: TSEKI ID Card Preview */}
                <div className="modal-col-right">
                  <div className="tseki-id-card-frame">
                    <div className="id-card-top-row">
                      <span className="id-card-tagline">TSEKI ID CARD</span>
                      <img
                        src={mascotImg}
                        alt="Mini Mascot"
                        className="id-card-mini-mascot"
                      />
                    </div>

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

                    <div className="id-card-bottom-link">
                      <Paperclip size={13} />
                      <span>Photo Attached (Verified)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer: Approve & Reject */}
            <div className="modal-card-footer">
              <button
                type="button"
                className="modal-btn-approve"
                onClick={() => handleApprove(selectedTeacher)}
              >
                <CheckCircle size={18} />
                <span>Approve</span>
              </button>
              <button
                type="button"
                className="modal-btn-reject"
                onClick={handleOpenReject}
              >
                <XCircle size={18} />
                <span>Reject</span>
              </button>
            </div>

            {/* Reject Reason Sub-prompt */}
            {showRejectPrompt && (
              <div className="reject-prompt-drawer">
                <label className="reject-label">Specify Rejection Reason:</label>
                <div className="reject-input-row">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Invalid institutional credentials"
                    className="reject-input"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="reject-confirm-btn"
                    onClick={handleConfirmReject}
                  >
                    Confirm Rejection
                  </button>
                  <button
                    type="button"
                    className="reject-cancel-btn"
                    onClick={() => setShowRejectPrompt(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function getInitials(name: string) {
  if (!name) return 'TC';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ── Initial Mock Data matching User's Screenshots exactly ────
function getInitialTeachers(): Teacher[] {
  return [
    {
      id: '1',
      username: 'amaquin_cj',
      email: 'lalovesheand@gmail.com',
      full_name: 'Amaquin Christian John',
      status: 'pending',
      grade_level: 'Senior High Teacher',
      subject: 'Personal development',
      strand: 'HUMSS',
      teacher_id: '102262',
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: '2',
      username: 'ramos_ja',
      email: 'ramos.johnariel@cec.edu.ph',
      full_name: 'Ramos John Ariel',
      status: 'pending',
      grade_level: 'Junior High Teacher',
      subject: 'PE',
      strand: 'MAPEH',
      teacher_id: '102263',
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: '3',
      username: 'ocanada_j',
      email: 'ocanada.joshua@cec.edu.ph',
      full_name: 'Ocanada Joshua',
      status: 'pending',
      grade_level: 'Elementary Teacher',
      subject: 'English',
      strand: 'Language Arts',
      teacher_id: '102264',
      created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: '4',
      username: 'castro_ma',
      email: 'castro.mark@cec.edu.ph',
      full_name: 'Castro Mark Anthony',
      status: 'pending',
      grade_level: 'Junior High Teacher',
      subject: 'Science',
      strand: 'STEM',
      teacher_id: '102269',
      created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
    },
    {
      id: '5',
      username: 'delacruz_r',
      email: 'delacruz.rebecca@cec.edu.ph',
      full_name: 'Dela Cruz Rebecca',
      status: 'pending',
      grade_level: 'Senior High Teacher',
      subject: 'Business Math',
      strand: 'ABM',
      teacher_id: '102270',
      created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    },
    {
      id: '6',
      username: 'santos_m',
      email: 'santos.miguel@cec.edu.ph',
      full_name: 'Santos Miguel',
      status: 'pending',
      grade_level: 'Elementary Teacher',
      subject: 'Social Studies',
      strand: 'Araling Panlipunan',
      teacher_id: '102271',
      created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
    },
    {
      id: '7',
      username: 'bautista_p',
      email: 'bautista.patricia@cec.edu.ph',
      full_name: 'Bautista Patricia',
      status: 'approved',
      grade_level: 'Senior High Teacher',
      subject: 'Mathematics',
      strand: 'STEM',
      teacher_id: '102265',
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      approved_at: new Date(Date.now() - 86400000 * 8).toISOString(),
    },
    {
      id: '8',
      username: 'villanueva_g',
      email: 'villanueva.gabriel@cec.edu.ph',
      full_name: 'Villanueva Gabriel',
      status: 'approved',
      grade_level: 'Junior High Teacher',
      subject: 'Science',
      strand: 'STEM',
      teacher_id: '102266',
      created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
      approved_at: new Date(Date.now() - 86400000 * 12).toISOString(),
    },
    {
      id: '9',
      username: 'mendoza_s',
      email: 'mendoza.sarah@cec.edu.ph',
      full_name: 'Mendoza Sarah',
      status: 'suspended',
      grade_level: 'Elementary Teacher',
      subject: 'Filipino',
      strand: 'Language Arts',
      teacher_id: '102267',
      created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
  ];
}

function getInitialActivityLogs(): ActivityLogEntry[] {
  return [
    {
      id: 6,
      teacher_name: 'Navarro Paolo',
      operation: 'Generated Assessment: Midterm Exam (STEM 12)',
      time_display: 'Just now - 10/19/2026',
    },
    {
      id: 5,
      teacher_name: 'Bautista Patricia',
      operation: 'Imported Class List (Grade 11 HUMSS)',
      time_display: '12 minutes ago - 10/19/2026',
    },
    {
      id: 4,
      teacher_name: 'Ramos John Ariel',
      operation: 'Created Classroom: Section 9 - Newton PE',
      time_display: '25 minutes ago - 10/19/2026',
    },
    {
      id: 3,
      teacher_name: 'Amaquin Christian John',
      operation: 'Exported Class List (Grade 12 ABM)',
      time_display: '1 hour ago - 10/19/2026',
    },
    {
      id: 2,
      teacher_name: 'Amaquin Christian John',
      operation: 'Generated Assessment: Personal Development Quiz',
      time_display: '2 hours ago - 10/19/2026',
    },
    {
      id: 1,
      teacher_name: 'Ocanada Joshua',
      operation: 'Created Classroom: Grade 6 English Lit',
      time_display: 'Yesterday - 10/18/2026',
    },
  ];
}
