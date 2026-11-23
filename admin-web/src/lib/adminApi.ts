export type TeacherStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'unverified';
export type DataSourceMode = 'supabase' | 'supabase_needs_service_key' | 'local';

export interface Teacher {
  id: string;
  user_id?: string | null;
  username: string;
  email: string;
  full_name: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  school_name?: string;
  school_id_url?: string;
  school_id_back_url?: string;
  facial_verification_url?: string;
  status: TeacherStatus;
  rejection_reason?: string | null;
  created_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  grade_level?: string;
  grade_levels?: string[];
  subject?: string;
  strand?: string;
  subjects?: string[];
  teacher_id?: string;
}

export interface ActivityLogEntry {
  id: number;
  teacher_id?: string | null;
  teacher_name: string;
  operation: string;
  actor?: string;
  category?: 'admin' | 'app';
  time_display: string;
  created_at?: string;
}

export type AdminVerificationPayload =
  | { method: 'password'; password: string }
  | { method: 'otp'; challengeToken: string; code: string };

export interface OtpChallengeResponse {
  challengeToken: string;
  systemEmail: string;
  sentVia: 'gmail' | 'dev_fallback';
  demoOtp?: string;
  message: string;
  expiresAt: string;
}

export interface VerifyOtpResponse {
  sessionToken: string;
  adminEmail: string;
  expiresAt: string;
}

export interface DashboardDataResponse {
  teachers: Teacher[];
  activityLogs: ActivityLogEntry[];
  source: DataSourceMode;
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
  systemEmail: string;
  gmailConfigured: boolean;
}

const TOKEN_KEY = 'tseki_admin_session_token';
const EMAIL_KEY = 'tseki_admin_email';

export function getStoredSessionToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function storeSession(token: string, email: string, rememberMe: boolean): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(EMAIL_KEY, email);
}

export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem('tseki_admin_auth');
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EMAIL_KEY);
}

export function getStoredAdminEmail(): string {
  return (
    localStorage.getItem(EMAIL_KEY) ||
    sessionStorage.getItem(EMAIL_KEY) ||
    'tseki.cecsystem@gmail.com'
  );
}

async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; tokenOverride?: string | null } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.auth) {
    const token = options.tokenOverride || getStoredSessionToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`/api/admin/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function fetchHealth(): Promise<{
  gmailConfigured: boolean;
  systemEmail: string;
  supabaseConfigured: boolean;
}> {
  return apiRequest('health');
}

export function loginAdmin(email: string, password: string): Promise<OtpChallengeResponse> {
  return apiRequest('login', {
    method: 'POST',
    body: { email, password },
  });
}

export function resendOtp(
  challengeToken: string,
  options: { auth?: boolean; teacherName?: string; actionLabel?: string } = {}
): Promise<OtpChallengeResponse> {
  return apiRequest('resend-otp', {
    method: 'POST',
    auth: options.auth,
    body: {
      challengeToken,
      teacherName: options.teacherName,
      actionLabel: options.actionLabel,
    },
  });
}

export function verifyLoginOtp(challengeToken: string, code: string): Promise<VerifyOtpResponse> {
  return apiRequest('verify-otp', {
    method: 'POST',
    body: { challengeToken, code },
  });
}

export function logoutAdmin(tokenOverride?: string | null): Promise<{ loggedOut: boolean }> {
  return apiRequest('logout', {
    method: 'POST',
    auth: true,
    tokenOverride,
  });
}

export function requestActionOtp(params: {
  actionLabel: string;
  targetId?: string;
  targetName?: string;
}): Promise<OtpChallengeResponse> {
  return apiRequest('action-otp', {
    method: 'POST',
    auth: true,
    body: params,
  });
}

export function verifySession(): Promise<{
  authenticated: boolean;
  adminEmail: string;
  systemEmail: string;
  gmailConfigured: boolean;
}> {
  return apiRequest('session', { auth: true });
}

export function fetchDashboardData(): Promise<DashboardDataResponse> {
  return apiRequest('teachers', { auth: true });
}

export function approveTeacher(
  teacherId: string,
  verification: AdminVerificationPayload
): Promise<{ teacher: Teacher; log: ActivityLogEntry }> {
  return apiRequest('teachers/approve', {
    method: 'POST',
    auth: true,
    body: { teacherId, verification },
  });
}

export function rejectTeacher(
  teacherId: string,
  reason: string,
  verification: AdminVerificationPayload
): Promise<{ teacher: Teacher; log: ActivityLogEntry }> {
  return apiRequest('teachers/reject', {
    method: 'POST',
    auth: true,
    body: { teacherId, reason, verification },
  });
}

export function toggleTeacherStatus(
  teacherId: string,
  verification: AdminVerificationPayload
): Promise<{ teacher: Teacher; log: ActivityLogEntry }> {
  return apiRequest('teachers/toggle-status', {
    method: 'POST',
    auth: true,
    body: { teacherId, verification },
  });
}

export function requestTeacherDeleteOtp(teacherId: string): Promise<OtpChallengeResponse> {
  return apiRequest('teachers/delete-otp', {
    method: 'POST',
    auth: true,
    body: { teacherId },
  });
}

export function confirmDeleteTeacher(
  teacherId: string,
  verification: AdminVerificationPayload
): Promise<{ deletedId: string; log: ActivityLogEntry }> {
  return apiRequest('teachers/delete', {
    method: 'POST',
    auth: true,
    body: { teacherId, verification },
  });
}

export function clearActivityLogs(
  verification: AdminVerificationPayload
): Promise<{ cleared: boolean; log?: ActivityLogEntry }> {
  return apiRequest('activity-logs/clear', {
    method: 'POST',
    auth: true,
    body: { verification },
  });
}
