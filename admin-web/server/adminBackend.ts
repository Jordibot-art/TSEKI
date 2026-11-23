import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import nodemailer from 'nodemailer';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

let caInitialized = false;
function ensureSystemCaCertificates(): void {
  if (caInitialized) return;
  caInitialized = true;
  try {
    const tlsWithCa = tls as typeof tls & {
      getCACertificates?: (type: 'default' | 'system') => string[];
      setDefaultCACertificates?: (certs: string[]) => void;
    };
    if (
      typeof tlsWithCa.getCACertificates === 'function' &&
      typeof tlsWithCa.setDefaultCACertificates === 'function'
    ) {
      const merged = Array.from(
        new Set([
          ...tlsWithCa.getCACertificates('default'),
          ...tlsWithCa.getCACertificates('system'),
        ])
      );
      tlsWithCa.setDefaultCACertificates(merged);
    }
  } catch {
    // Ignore on older Node runtimes
  }
}
ensureSystemCaCertificates();

export type TeacherStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'unverified';
export type DataSourceMode = 'supabase' | 'supabase_needs_service_key' | 'local';

export interface TeacherRecord {
  id: string;
  user_id?: string | null;
  username: string;
  email: string;
  full_name: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  school_name?: string;
  teacher_id?: string;
  grade_level?: string;
  grade_levels?: string[];
  subject?: string;
  strand?: string;
  subjects?: string[];
  school_id_url?: string;
  school_id_back_url?: string;
  facial_verification_url?: string;
  status: TeacherStatus;
  rejection_reason?: string | null;
  created_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
}

export interface ActivityLogRecord {
  id: number;
  teacher_id?: string | null;
  teacher_name: string;
  operation: string;
  actor?: string;
  category?: 'admin' | 'app';
  time_display: string;
  created_at: string;
}

export type OtpPurpose = 'login' | 'delete_teacher' | 'verify_action';

export type AdminReauthPayload =
  | { method: 'password'; password: string }
  | { method: 'otp'; challengeToken: string; code: string };

interface OtpChallengePayload {
  nonce: string;
  email: string;
  purpose: OtpPurpose;
  targetId?: string;
  actionLabel?: string;
  codeHash: string;
  exp: number;
}

interface SessionPayload {
  email: string;
  exp: number;
}

interface NonceState {
  used: boolean;
  attempts: number;
  exp: number;
}

interface LocalStoreData {
  teachers: TeacherRecord[];
  activityLogs: ActivityLogRecord[];
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const nonceTracker = new Map<string, NonceState>();
let memoryStore: LocalStoreData | null = null;
let ephemeralDevSecret: string | null = null;
let warnedMissingDevAdminPassword = false;

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function getEnv(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim();
}

function getSystemEmail(): string {
  return (
    getEnv('ADMIN_SYSTEM_EMAIL') ||
    getEnv('GMAIL_USER') ||
    getEnv('ADMIN_EMAIL') ||
    'tseki.cecsystem@gmail.com'
  );
}

function getConfiguredAdminEmail(): string {
  return getEnv('ADMIN_EMAIL') || 'tseki.cecsystem@gmail.com';
}

export function getConfiguredAdminPassword(): string {
  const configured = getEnv('ADMIN_PASSWORD');
  if (configured) return configured;

  if (isProductionRuntime()) {
    throw new Error(
      'ADMIN_PASSWORD is not configured on the server. Set ADMIN_PASSWORD in your production environment variables.'
    );
  }

  const devFallback = getEnv('DEV_ADMIN_PASSWORD');
  if (devFallback) return devFallback;

  if (!warnedMissingDevAdminPassword) {
    warnedMissingDevAdminPassword = true;
    console.warn(
      '[AdminBackend] ADMIN_PASSWORD is not set; using local development fallback. Set ADMIN_PASSWORD in .env before deploying.'
    );
  }
  return 'tsekicecsystem!@#123';
}

export function getSecret(): string {
  const configured = getEnv('ADMIN_OTP_SECRET');
  if (configured) {
    if (isProductionRuntime() && configured.length < 16) {
      throw new Error(
        'ADMIN_OTP_SECRET must be at least 16 characters long in production.'
      );
    }
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error(
      'ADMIN_OTP_SECRET is not configured on the server. Set a strong random ADMIN_OTP_SECRET in your production environment variables.'
    );
  }

  if (!ephemeralDevSecret) {
    // Deterministic only for local dev HMR if DEV_ADMIN_OTP_SECRET is set; otherwise random per process
    ephemeralDevSecret = getEnv('DEV_ADMIN_OTP_SECRET') || crypto.randomBytes(32).toString('hex');
  }
  return ephemeralDevSecret;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

function getGmailConfig(): { user: string; pass: string } | null {
  const user = getEnv('GMAIL_USER');
  const pass = getEnv('GMAIL_APP_PASSWORD').replace(/\s+/g, '');
  if (!user || !pass || pass === 'your_16_char_gmail_app_password') {
    return null;
  }
  return { user, pass };
}

function getSupabaseUrl(): string {
  return getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL') || getEnv('EXPO_PUBLIC_SUPABASE_URL');
}

function getServiceRoleKey(): string {
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || key === 'your_supabase_service_role_key_here') {
    return '';
  }
  return key;
}

function hasSupabaseConfig(): boolean {
  const url = getSupabaseUrl();
  const key = isProductionRuntime()
    ? getServiceRoleKey()
    : getServiceRoleKey() || getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return Boolean(url && key && !url.includes('your-project.supabase.co'));
}

function hasServiceRoleKey(): boolean {
  const url = getSupabaseUrl();
  return Boolean(url && !url.includes('your-project.supabase.co') && getServiceRoleKey());
}

function getSupabaseAdminClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  // Never silently downgrade to anon key in production
  const key = isProductionRuntime()
    ? serviceKey
    : serviceKey || getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key || url.includes('your-project.supabase.co')) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getSupabaseServiceClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key || url.includes('your-project.supabase.co')) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function signPayload(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedPayload<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function hashOtp(code: string, nonce: string): string {
  return crypto.createHmac('sha256', getSecret()).update(`${nonce}:${code}`).digest('hex');
}

function pruneNonces() {
  const now = Date.now();
  for (const [k, v] of nonceTracker.entries()) {
    if (v.exp < now) {
      nonceTracker.delete(k);
    }
  }
}

function getStoreFilePath(): string {
  const cwd = process.cwd();
  const inAdminWeb = path.basename(cwd).toLowerCase() === 'admin-web';
  const baseDir = inAdminWeb ? cwd : path.join(cwd, 'admin-web');
  return path.join(baseDir, '.data', 'admin-store.json');
}

function formatDateStamp(date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatTimeDisplay(isoString: string): string {
  const created = new Date(isoString);
  if (Number.isNaN(created.getTime())) return isoString;
  const diffMs = Date.now() - created.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const datePart = formatDateStamp(created);
  if (diffMin < 1) return `Just now - ${datePart}`;
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago - ${datePart}`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago - ${datePart}`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return `Yesterday - ${datePart}`;
  return `${diffDays} days ago - ${datePart}`;
}

function getEmptyStore(): LocalStoreData {
  return { teachers: [], activityLogs: [] };
}

function readLocalStore(): LocalStoreData {
  if (memoryStore) return memoryStore;
  const filePath = getStoreFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as LocalStoreData;
      if (Array.isArray(parsed.teachers) && Array.isArray(parsed.activityLogs)) {
        memoryStore = parsed;
        return memoryStore;
      }
    }
  } catch {
    // Fall back to empty store
  }
  const empty = getEmptyStore();
  writeLocalStore(empty);
  return empty;
}

function writeLocalStore(data: LocalStoreData): void {
  memoryStore = data;
  const filePath = getStoreFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Read-only filesystem in serverless environments; keep in memory
  }
}

function asNonEmptyStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toTimestampMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

async function listAllAuthUsers(sb: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  let page = 1;
  const perPage = 1000;
  while (page <= 10) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users) break;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

async function safeSelectRows(
  sb: SupabaseClient,
  table: string,
  orderBy: string,
  limitCount: number
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await sb
      .from(table)
      .select('*')
      .order(orderBy, { ascending: false })
      .limit(limitCount);
    if (error || !Array.isArray(data)) return [];
    return data as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function mergeAccountsFromSupabase(params: {
  authUsers: User[];
  teacherRows: Record<string, unknown>[];
  classroomRows: Record<string, unknown>[];
  assessmentRows: Record<string, unknown>[];
}): {
  teachers: TeacherRecord[];
  teachersTableIds: Set<string>;
} {
  const classCountByTeacher = new Map<string, number>();
  const subjectByTeacher = new Map<string, string>();
  const gradeByTeacher = new Map<string, string>();

  for (const cls of params.classroomRows) {
    const tid = asNonEmptyStr(cls.teacher_id);
    if (!tid) continue;
    classCountByTeacher.set(tid, (classCountByTeacher.get(tid) || 0) + 1);
    const subj = asNonEmptyStr(cls.subject);
    if (subj && !subjectByTeacher.has(tid)) {
      subjectByTeacher.set(tid, subj);
    }
  }

  for (const a of params.assessmentRows) {
    const tid = asNonEmptyStr(a.teacher_id);
    if (!tid) continue;
    const subj = asNonEmptyStr(a.subject);
    if (subj && !subjectByTeacher.has(tid)) {
      subjectByTeacher.set(tid, subj);
    }
    const grade = asNonEmptyStr(a.grade_level);
    if (grade && !gradeByTeacher.has(tid)) {
      gradeByTeacher.set(tid, grade);
    }
  }

  const byUserId = new Map<string, Record<string, unknown>>();
  const byEmail = new Map<string, Record<string, unknown>>();
  const teachersTableIds = new Set<string>();

  for (const row of params.teacherRows) {
    const rowId = asNonEmptyStr(row.id);
    if (rowId) teachersTableIds.add(rowId);
    const uid = asNonEmptyStr(row.user_id);
    const email = asNonEmptyStr(row.email)?.toLowerCase();
    if (uid && !byUserId.has(uid)) byUserId.set(uid, row);
    if (email && !byEmail.has(email)) byEmail.set(email, row);
  }

  const consumedTeacherRowIds = new Set<string>();
  const merged: TeacherRecord[] = [];

  for (const user of params.authUsers) {
    const email = (user.email || '').trim();
    const emailLower = email.toLowerCase();
    const matched = byUserId.get(user.id) || (emailLower ? byEmail.get(emailLower) : undefined);
    const matchedId = matched ? asNonEmptyStr(matched.id) : undefined;
    if (matchedId) consumedTeacherRowIds.add(matchedId);

    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const bannedUntilMs = user.banned_until ? Date.parse(user.banned_until) : 0;
    const isBanned = Number.isFinite(bannedUntilMs) && bannedUntilMs > Date.now();
    const isConfirmed = Boolean(
      user.email_confirmed_at ||
        (user as { confirmed_at?: string | null }).confirmed_at ||
        user.last_sign_in_at
    );

    let status: TeacherStatus;
    if (isBanned) {
      status = 'suspended';
    } else if (matched && asNonEmptyStr(matched.status)) {
      status = String(matched.status) as TeacherStatus;
    } else if (
      meta.registration_status === 'pending' ||
      meta.needs_identity_verification === false ||
      meta.needs_identity_verification === true ||
      Boolean(asNonEmptyStr(meta.school_id_url))
    ) {
      status = 'pending';
    } else {
      // Existing Tseki accounts without a pending-approval row count toward
      // total/active accounts without creating premature pending approvals.
      status = isConfirmed ? 'approved' : 'unverified';
    }

    const fullName =
      asNonEmptyStr(matched?.full_name) ||
      asNonEmptyStr(meta.full_name) ||
      asNonEmptyStr(meta.name) ||
      asNonEmptyStr(meta.username) ||
      (email ? email.split('@')[0] : undefined) ||
      'Teacher';

    const classCount = classCountByTeacher.get(user.id) || 0;
    const inferredRole = classCount > 0 ? `Teacher (${classCount} class${classCount === 1 ? '' : 'es'})` : 'Teacher';
    const createdAt =
      asNonEmptyStr(matched?.created_at) || user.created_at || new Date().toISOString();

    const toStringArray = (val: unknown): string[] | undefined => {
      if (Array.isArray(val)) {
        const cleaned = val.map((item) => String(item || '').trim()).filter(Boolean);
        return cleaned.length > 0 ? cleaned : undefined;
      }
      return undefined;
    };

    const gradeLevels =
      toStringArray(matched?.grade_levels) || toStringArray(meta.grade_levels);
    const subjects =
      toStringArray(matched?.subjects) || toStringArray(meta.subjects);

    merged.push({
      id: matchedId || user.id,
      user_id: user.id,
      username:
        asNonEmptyStr(matched?.username) ||
        asNonEmptyStr(meta.username) ||
        (email ? email.split('@')[0] : 'teacher'),
      email,
      full_name: fullName,
      first_name: asNonEmptyStr(matched?.first_name) || asNonEmptyStr(meta.first_name),
      middle_name: asNonEmptyStr(matched?.middle_name) ?? asNonEmptyStr(meta.middle_name) ?? null,
      last_name: asNonEmptyStr(matched?.last_name) || asNonEmptyStr(meta.last_name),
      school_name: asNonEmptyStr(matched?.school_name) || asNonEmptyStr(meta.school_name),
      teacher_id: asNonEmptyStr(matched?.teacher_id) || asNonEmptyStr(meta.teacher_id),
      grade_level:
        asNonEmptyStr(matched?.grade_level) ||
        asNonEmptyStr(meta.grade_level) ||
        (gradeLevels ? gradeLevels.join(', ') : undefined) ||
        gradeByTeacher.get(user.id) ||
        inferredRole,
      grade_levels: gradeLevels,
      subject:
        asNonEmptyStr(matched?.subject) ||
        asNonEmptyStr(meta.subject) ||
        (subjects ? subjects.join(', ') : undefined) ||
        subjectByTeacher.get(user.id),
      strand: asNonEmptyStr(matched?.strand) || asNonEmptyStr(meta.strand),
      subjects,
      school_id_url:
        (matched && asNonEmptyStr(matched.user_id) === user.id
          ? asNonEmptyStr(matched.school_id_url)
          : undefined) ||
        asNonEmptyStr(meta.school_id_url) ||
        asNonEmptyStr(matched?.school_id_url),
      school_id_back_url:
        (matched && asNonEmptyStr(matched.user_id) === user.id
          ? asNonEmptyStr(matched.school_id_back_url)
          : undefined) ||
        asNonEmptyStr(meta.school_id_back_url) ||
        asNonEmptyStr(matched?.school_id_back_url),
      facial_verification_url:
        (matched && asNonEmptyStr(matched.user_id) === user.id
          ? asNonEmptyStr(matched.facial_verification_url)
          : undefined) ||
        asNonEmptyStr(meta.facial_verification_url) ||
        asNonEmptyStr(matched?.facial_verification_url),
      status,
      rejection_reason: asNonEmptyStr(matched?.rejection_reason) ?? null,
      created_at: createdAt,
      approved_at:
        asNonEmptyStr(matched?.approved_at) ??
        (status === 'approved' ? user.email_confirmed_at || createdAt : null),
      approved_by: asNonEmptyStr(matched?.approved_by) ?? null,
    });
  }

  for (const row of params.teacherRows) {
    const rowId = asNonEmptyStr(row.id);
    if (!rowId || consumedTeacherRowIds.has(rowId)) continue;
    const rowGrades = Array.isArray(row.grade_levels)
      ? row.grade_levels.map((v) => String(v || '').trim()).filter(Boolean)
      : undefined;
    const rowSubjects = Array.isArray(row.subjects)
      ? row.subjects.map((v) => String(v || '').trim()).filter(Boolean)
      : undefined;
    merged.push({
      id: rowId,
      user_id: asNonEmptyStr(row.user_id) ?? null,
      username: asNonEmptyStr(row.username) || 'teacher',
      email: asNonEmptyStr(row.email) || '',
      full_name: asNonEmptyStr(row.full_name) || 'Teacher',
      first_name: asNonEmptyStr(row.first_name),
      middle_name: asNonEmptyStr(row.middle_name) ?? null,
      last_name: asNonEmptyStr(row.last_name),
      school_name: asNonEmptyStr(row.school_name),
      teacher_id: asNonEmptyStr(row.teacher_id),
      grade_level: asNonEmptyStr(row.grade_level) || (rowGrades?.join(', ') || 'Teacher'),
      grade_levels: rowGrades && rowGrades.length > 0 ? rowGrades : undefined,
      subject: asNonEmptyStr(row.subject) || rowSubjects?.join(', '),
      strand: asNonEmptyStr(row.strand),
      subjects: rowSubjects && rowSubjects.length > 0 ? rowSubjects : undefined,
      school_id_url: asNonEmptyStr(row.school_id_url),
      school_id_back_url: asNonEmptyStr(row.school_id_back_url),
      facial_verification_url: asNonEmptyStr(row.facial_verification_url),
      status: (asNonEmptyStr(row.status) as TeacherStatus) || 'pending',
      rejection_reason: asNonEmptyStr(row.rejection_reason) ?? null,
      created_at: asNonEmptyStr(row.created_at) || new Date().toISOString(),
      approved_at: asNonEmptyStr(row.approved_at) ?? null,
      approved_by: asNonEmptyStr(row.approved_by) ?? null,
    });
  }

  merged.sort((a, b) => toTimestampMs(b.created_at) - toTimestampMs(a.created_at));
  return { teachers: merged, teachersTableIds };
}

function buildCombinedActivityLogs(params: {
  teachers: TeacherRecord[];
  adminLogsRows: Record<string, unknown>[];
  classroomRows: Record<string, unknown>[];
  assessmentRows: Record<string, unknown>[];
  aiLogRows: Record<string, unknown>[];
  studentRows: Record<string, unknown>[];
  quizResultRows: Record<string, unknown>[];
}): ActivityLogRecord[] {
  const teacherNameById = new Map<string, string>();
  for (const t of params.teachers) {
    teacherNameById.set(t.id, t.full_name);
    if (t.user_id) teacherNameById.set(t.user_id, t.full_name);
  }

  const classroomById = new Map<string, { teacherId?: string; title?: string; subject?: string }>();
  for (const cls of params.classroomRows) {
    const cid = asNonEmptyStr(cls.id);
    if (!cid) continue;
    classroomById.set(cid, {
      teacherId: asNonEmptyStr(cls.teacher_id),
      title: asNonEmptyStr(cls.title),
      subject: asNonEmptyStr(cls.subject),
    });
  }

  let clearedAfterMs = 0;
  for (const row of params.adminLogsRows) {
    if (row.teacher_name === '__SYSTEM__' && row.operation === '__CLEARED__') {
      clearedAfterMs = Math.max(clearedAfterMs, toTimestampMs(row.created_at));
    }
  }

  interface RawEvent {
    ts: number;
    teacher_id?: string | null;
    teacher_name: string;
    operation: string;
    actor?: string;
    created_at: string;
  }

  const events: RawEvent[] = [];

  for (const row of params.adminLogsRows) {
    if (row.teacher_name === '__SYSTEM__' && row.operation === '__CLEARED__') continue;
    const createdAt = asNonEmptyStr(row.created_at) || new Date().toISOString();
    events.push({
      ts: toTimestampMs(createdAt),
      teacher_id: asNonEmptyStr(row.teacher_id) ?? null,
      teacher_name: asNonEmptyStr(row.teacher_name) || 'Teacher',
      operation: asNonEmptyStr(row.operation) || 'Admin Action',
      actor: asNonEmptyStr(row.actor) || 'Admin',
      created_at: createdAt,
    });
  }

  for (const cls of params.classroomRows) {
    const tid = asNonEmptyStr(cls.teacher_id);
    const createdAt = asNonEmptyStr(cls.created_at);
    if (!createdAt) continue;
    const title = asNonEmptyStr(cls.title) || 'Untitled Classroom';
    const subject = asNonEmptyStr(cls.subject);
    events.push({
      ts: toTimestampMs(createdAt),
      teacher_id: tid ?? null,
      teacher_name: (tid && teacherNameById.get(tid)) || 'Tseki Teacher',
      operation: `Created Classroom: ${title}${subject ? ` (${subject})` : ''}`,
      actor: 'App',
      created_at: createdAt,
    });
  }

  for (const a of params.assessmentRows) {
    const tid =
      asNonEmptyStr(a.teacher_id) ||
      (asNonEmptyStr(a.classroom_id) ? classroomById.get(String(a.classroom_id))?.teacherId : undefined);
    const createdAt = asNonEmptyStr(a.created_at);
    if (!createdAt) continue;
    const quizTitle = asNonEmptyStr(a.quiz_title) || 'Untitled Assessment';
    const contextLabel = asNonEmptyStr(a.class_title) || asNonEmptyStr(a.subject);
    const isDraft = String(a.status || '').toUpperCase() === 'DRAFT';
    events.push({
      ts: toTimestampMs(createdAt),
      teacher_id: tid ?? null,
      teacher_name: (tid && teacherNameById.get(tid)) || 'Tseki Teacher',
      operation: `${isDraft ? 'Saved Assessment Draft' : 'Generated Assessment'}: ${quizTitle}${
        contextLabel ? ` (${contextLabel})` : ''
      }`,
      actor: 'App',
      created_at: createdAt,
    });
  }

  for (const ai of params.aiLogRows) {
    const tid = asNonEmptyStr(ai.teacher_id);
    const createdAt = asNonEmptyStr(ai.created_at);
    if (!createdAt) continue;
    const status = asNonEmptyStr(ai.status) || 'success';
    const actionType =
      asNonEmptyStr(ai.action_type) === 'single_question' ? 'Single Question' : 'Full Quiz';
    events.push({
      ts: toTimestampMs(createdAt),
      teacher_id: tid ?? null,
      teacher_name: (tid && teacherNameById.get(tid)) || 'Tseki Teacher',
      operation:
        status === 'success'
          ? `AI Quiz Generation (${actionType})`
          : `AI Quiz Generation ${status} (${actionType})`,
      actor: 'App',
      created_at: createdAt,
    });
  }

  // Batch student enrollments imported/added together into a classroom (2-minute buckets)
  const studentBatches = new Map<string, { ts: number; createdAt: string; classroomId: string; names: string[] }>();
  for (const st of params.studentRows) {
    const cid = asNonEmptyStr(st.classroom_id);
    const createdAt = asNonEmptyStr(st.created_at);
    if (!cid || !createdAt) continue;
    const ts = toTimestampMs(createdAt);
    const bucket = Math.floor(ts / 120000);
    const key = `${cid}:${bucket}`;
    const name = asNonEmptyStr(st.full_name) || 'Student';
    const existing = studentBatches.get(key);
    if (existing) {
      existing.names.push(name);
      if (ts > existing.ts) {
        existing.ts = ts;
        existing.createdAt = createdAt;
      }
    } else {
      studentBatches.set(key, { ts, createdAt, classroomId: cid, names: [name] });
    }
  }

  for (const batch of studentBatches.values()) {
    const cls = classroomById.get(batch.classroomId);
    const tid = cls?.teacherId;
    const clsTitle = cls?.title;
    events.push({
      ts: batch.ts,
      teacher_id: tid ?? null,
      teacher_name: (tid && teacherNameById.get(tid)) || 'Tseki Teacher',
      operation:
        batch.names.length > 1
          ? `Imported Class List (${batch.names.length} students${clsTitle ? ` · ${clsTitle}` : ''})`
          : `Added Student: ${batch.names[0]}${clsTitle ? ` (${clsTitle})` : ''}`,
      actor: 'App',
      created_at: batch.createdAt,
    });
  }

  // Batch quiz grading results (5-minute buckets per classroom & quiz title)
  const resultBatches = new Map<
    string,
    { ts: number; createdAt: string; classroomId: string; quizTitle: string; count: number }
  >();
  for (const qr of params.quizResultRows) {
    const cid = asNonEmptyStr(qr.classroom_id);
    const createdAt = asNonEmptyStr(qr.created_at);
    if (!cid || !createdAt) continue;
    const ts = toTimestampMs(createdAt);
    const quizTitle = asNonEmptyStr(qr.quiz_title) || 'Assessment';
    const bucket = Math.floor(ts / 300000);
    const key = `${cid}:${quizTitle}:${bucket}`;
    const existing = resultBatches.get(key);
    if (existing) {
      existing.count += 1;
      if (ts > existing.ts) {
        existing.ts = ts;
        existing.createdAt = createdAt;
      }
    } else {
      resultBatches.set(key, { ts, createdAt, classroomId: cid, quizTitle, count: 1 });
    }
  }

  for (const batch of resultBatches.values()) {
    const cls = classroomById.get(batch.classroomId);
    const tid = cls?.teacherId;
    const clsTitle = cls?.title;
    events.push({
      ts: batch.ts,
      teacher_id: tid ?? null,
      teacher_name: (tid && teacherNameById.get(tid)) || 'Tseki Teacher',
      operation: `Graded Assessment: ${batch.quizTitle} (${batch.count} score${
        batch.count === 1 ? '' : 's'
      }${clsTitle ? ` · ${clsTitle}` : ''})`,
      actor: 'App',
      created_at: batch.createdAt,
    });
  }

  const filtered = events
    .filter((ev) => ev.ts > clearedAfterMs)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 150);

  return filtered.map((ev, index) => {
    const actor = ev.actor || 'App';
    return {
      id: filtered.length - index,
      teacher_id: ev.teacher_id ?? null,
      teacher_name: ev.teacher_name,
      operation: ev.operation,
      actor,
      category: actor === 'App' ? 'app' : 'admin',
      created_at: ev.created_at,
      time_display: formatTimeDisplay(ev.created_at),
    };
  });
}

const VERIFICATION_BUCKET = 'teacher-verification-docs';

function extractStoragePath(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return null;
  }
  const prefix = `${VERIFICATION_BUCKET}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/**
 * Resolves private Supabase Storage paths on TeacherRecords into short-lived
 * 1-hour signed HTTPS URLs using the service-role client in one batched call.
 */
async function attachSignedVerificationUrls(
  sbService: SupabaseClient,
  teachers: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const uniquePaths = new Set<string>();
  for (const t of teachers) {
    const p1 = extractStoragePath(t.school_id_url);
    const p2 = extractStoragePath(t.school_id_back_url);
    const p3 = extractStoragePath(t.facial_verification_url);
    if (p1) uniquePaths.add(p1);
    if (p2) uniquePaths.add(p2);
    if (p3) uniquePaths.add(p3);
  }

  if (uniquePaths.size === 0) return teachers;

  const pathList = Array.from(uniquePaths);
  const signedMap = new Map<string, string>();
  try {
    const { data, error } = await sbService.storage
      .from(VERIFICATION_BUCKET)
      .createSignedUrls(pathList, 3600);
    if (!error && Array.isArray(data)) {
      for (const item of data) {
        if (item.path && item.signedUrl) {
          signedMap.set(item.path, item.signedUrl);
        }
      }
    }
  } catch {
    // Non-fatal if storage bucket has not been created yet
    return teachers;
  }

  const resolveField = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    const p = extractStoragePath(raw);
    if (!p) return raw;
    return signedMap.get(p) || raw;
  };

  return teachers.map((t) => ({
    ...t,
    school_id_url: resolveField(t.school_id_url),
    school_id_back_url: resolveField(t.school_id_back_url),
    facial_verification_url: resolveField(t.facial_verification_url),
  }));
}

async function fetchTeachersAndLogs(): Promise<{
  teachers: TeacherRecord[];
  activityLogs: ActivityLogRecord[];
  source: DataSourceMode;
  teachersTableIds: Set<string>;
}> {
  const sbService = getSupabaseServiceClient();
  if (sbService) {
    try {
      const [
        authUsers,
        teacherRows,
        adminLogsRows,
        classroomRows,
        assessmentRows,
        aiLogRows,
        studentRows,
        quizResultRows,
      ] = await Promise.all([
        listAllAuthUsers(sbService),
        safeSelectRows(sbService, 'teachers', 'created_at', 1000),
        safeSelectRows(sbService, 'admin_activity_logs', 'created_at', 300),
        safeSelectRows(sbService, 'classrooms', 'created_at', 250),
        safeSelectRows(sbService, 'archived_assessments', 'created_at', 250),
        safeSelectRows(sbService, 'ai_generation_logs', 'created_at', 200),
        safeSelectRows(sbService, 'students', 'created_at', 500),
        safeSelectRows(sbService, 'student_quiz_results', 'created_at', 200),
      ]);

      const { teachers: mergedTeachers, teachersTableIds } = mergeAccountsFromSupabase({
        authUsers,
        teacherRows,
        classroomRows,
        assessmentRows,
      });

      // Auto-heal orphaned public.teachers rows (e.g. user_id became NULL after an Auth user
      // was deleted and re-registered with the same email) so user_id and photo paths stay in sync.
      const rowByEmail = new Map<string, Record<string, unknown>>();
      for (const r of teacherRows) {
        const em = asNonEmptyStr(r.email)?.toLowerCase();
        if (em) rowByEmail.set(em, r);
      }
      for (const t of mergedTeachers) {
        if (!t.user_id || !t.email) continue;
        const existingRow = rowByEmail.get(t.email.toLowerCase());
        const needsRebind =
          existingRow && asNonEmptyStr(existingRow.user_id) !== t.user_id;
        const needsPendingInsert =
          !existingRow && t.status === 'pending' && Boolean(t.school_id_url);
        if (needsRebind || needsPendingInsert) {
          try {
            const { data: healed } = await sbService
              .from('teachers')
              .upsert(
                {
                  user_id: t.user_id,
                  username: t.username,
                  email: t.email.toLowerCase(),
                  full_name: t.full_name,
                  first_name: t.first_name || null,
                  middle_name: t.middle_name ?? null,
                  last_name: t.last_name || null,
                  school_name: t.school_name || null,
                  teacher_id: t.teacher_id || null,
                  grade_level: t.grade_level || null,
                  grade_levels: t.grade_levels || [],
                  subject: t.subject || null,
                  strand: t.strand || null,
                  subjects: t.subjects || [],
                  school_id_url: t.school_id_url || null,
                  school_id_back_url: t.school_id_back_url || null,
                  facial_verification_url: t.facial_verification_url || null,
                  status: t.status,
                  rejection_reason: t.rejection_reason ?? null,
                },
                { onConflict: 'email' }
              )
              .select('id')
              .maybeSingle();
            if (healed?.id) {
              t.id = String(healed.id);
              teachersTableIds.add(t.id);
            }
          } catch {
            // Non-fatal background sync
          }
        }
      }

      const teachers = await attachSignedVerificationUrls(sbService, mergedTeachers);

      const activityLogs = buildCombinedActivityLogs({
        teachers,
        adminLogsRows,
        classroomRows,
        assessmentRows,
        aiLogRows,
        studentRows,
        quizResultRows,
      });

      return {
        teachers,
        activityLogs,
        source: 'supabase',
        teachersTableIds,
      };
    } catch {
      // Fall through cleanly if Supabase admin query throws unexpectedly
    }
  }

  if (hasSupabaseConfig()) {
    return {
      teachers: [],
      activityLogs: [],
      source: 'supabase_needs_service_key',
      teachersTableIds: new Set<string>(),
    };
  }

  const local = readLocalStore();
  return {
    teachers: local.teachers,
    activityLogs: local.activityLogs.map((log) => ({
      ...log,
      actor: log.actor || 'Admin',
      category: log.category || (log.actor === 'App' ? 'app' : 'admin'),
    })),
    source: 'local',
    teachersTableIds: new Set<string>(),
  };
}

async function appendActivityLog(entry: {
  teacher_id?: string | null;
  teacher_name: string;
  operation: string;
  actor?: string;
  created_at?: string;
}): Promise<ActivityLogRecord> {
  const nowIso = entry.created_at || new Date().toISOString();
  const sb = getSupabaseServiceClient() || getSupabaseAdminClient();
  if (sb) {
    try {
      const insertRow: Record<string, unknown> = {
        teacher_id: entry.teacher_id || null,
        teacher_name: entry.teacher_name,
        operation: entry.operation,
        actor: entry.actor || 'Admin',
        ...(entry.created_at ? { created_at: entry.created_at } : {}),
      };
      const firstTry = await sb
        .from('admin_activity_logs')
        .insert(insertRow)
        .select('*')
        .single();

      let data = firstTry.data;
      if (firstTry.error && entry.teacher_id) {
        // Retry without teacher_id FK if this user exists in auth.users only
        const retry = await sb
          .from('admin_activity_logs')
          .insert({
            ...insertRow,
            teacher_id: null,
          })
          .select('*')
          .single();
        data = retry.data;
      }

      if (data) {
        const actor = String(data.actor || 'Admin');
        return {
          id: Date.now() + Number(data.id || 0),
          teacher_id: data.teacher_id ?? null,
          teacher_name: String(data.teacher_name),
          operation: String(data.operation),
          actor,
          category: actor === 'App' ? 'app' : 'admin',
          created_at: String(data.created_at || nowIso),
          time_display: formatTimeDisplay(String(data.created_at || nowIso)),
        };
      }
    } catch {
      // Fall back to local store
    }
  }

  const store = readLocalStore();
  const nextId = store.activityLogs.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const actor = entry.actor || 'Admin';
  const newLog: ActivityLogRecord = {
    id: nextId,
    teacher_id: entry.teacher_id || null,
    teacher_name: entry.teacher_name,
    operation: entry.operation,
    actor,
    category: actor === 'App' ? 'app' : 'admin',
    created_at: nowIso,
    time_display: `Just now - ${formatDateStamp()}`,
  };
  store.activityLogs = [newLog, ...store.activityLogs];
  writeLocalStore(store);
  return newLog;
}

function createGmailTransporter(gmail: { user: string; pass: string }) {
  ensureSystemCaCertificates();
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: gmail.user,
      pass: gmail.pass,
    },
  });
}

async function sendOtpEmailViaGmail(params: {
  code: string;
  purpose: OtpPurpose;
  teacherName?: string;
  actionLabel?: string;
}): Promise<{ sentVia: 'gmail' | 'dev_fallback'; demoOtp?: string; message: string }> {
  const systemEmail = getSystemEmail();
  const gmail = getGmailConfig();

  if (!gmail) {
    const allowDemo =
      getEnv('ALLOW_DEMO_OTP', process.env.NODE_ENV === 'production' ? 'false' : 'true') !==
      'false';

    if (!allowDemo) {
      throw new Error(
        'Gmail SMTP is not configured on the server. Set GMAIL_USER and GMAIL_APP_PASSWORD.'
      );
    }

    return {
      sentVia: 'dev_fallback',
      demoOtp: params.code,
      message: `Gmail SMTP not configured yet (set GMAIL_USER & GMAIL_APP_PASSWORD in .env). Using local dev OTP fallback for ${systemEmail}.`,
    };
  }

  const transporter = createGmailTransporter(gmail);

  const targetSuffix = params.teacherName ? `: ${params.teacherName}` : '';
  const actionSuffix = params.actionLabel ? `: ${params.actionLabel}` : '';

  const emailCopyMap: Record<OtpPurpose, { subject: string; title: string; desc: string }> = {
    delete_teacher: {
      subject: `[Tseki Admin] OTP to Authorize Teacher Deletion${targetSuffix}`,
      title: `Authorize Permanent Deletion${targetSuffix}`,
      desc: `A request was made in the Tseki Admin Portal to permanently delete teacher account <strong>${escapeHtml(params.teacherName || 'selected teacher')}</strong>.`,
    },
    verify_action: {
      subject: `[Tseki Admin] OTP to Verify Data Edit${actionSuffix}`,
      title: `Authorize Admin Data Edit${actionSuffix}`,
      desc: `Administrator verification was requested in the Tseki Admin Portal to <strong>${escapeHtml(params.actionLabel || 'modify portal data')}</strong>${params.teacherName ? ` for <strong>${escapeHtml(params.teacherName)}</strong>` : ''}.`,
    },
    login: {
      subject: '[Tseki Admin] Your 6-Digit Sign-In Verification Code',
      title: 'Admin Console Two-Factor Sign-In',
      desc: 'A sign-in attempt was initiated for the Tseki Admin Portal.',
    },
  };

  const { subject, title: actionTitle, desc: actionDesc } = emailCopyMap[params.purpose];

  const html = `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:32px 16px; color:#0f172a;">
      <div style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; box-shadow:0 4px 16px rgba(15,23,42,0.06);">
        <div style="background:linear-gradient(135deg,#FF6B00,#EA580C); padding:20px 24px; color:#ffffff;">
          <div style="font-size:18px; font-weight:800; letter-spacing:-0.3px;">Tseki <span style="font-size:10px; background:rgba(255,255,255,0.22); padding:3px 8px; border-radius:999px; margin-left:6px; vertical-align:middle;">ADMIN PORTAL</span></div>
          <div style="font-size:12px; opacity:0.9; margin-top:4px;">Educational Assessment &amp; Verification</div>
        </div>
        <div style="padding:28px 24px;">
          <h2 style="margin:0 0 8px; font-size:18px; font-weight:700; color:#0f172a;">${actionTitle}</h2>
          <p style="margin:0 0 20px; font-size:14px; line-height:1.55; color:#475569;">${actionDesc} Use the 6-digit verification code below to continue:</p>
          <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:18px; text-align:center; margin-bottom:20px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#c2410c; margin-bottom:6px;">One-Time Verification Code</div>
            <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:32px; font-weight:800; letter-spacing:8px; color:#ea580c;">${params.code}</div>
          </div>
          <p style="margin:0; font-size:12.5px; color:#64748b; line-height:1.5;">
            This code expires in <strong>5 minutes</strong> and can only be used once. If you did not initiate this action, please secure your admin credentials immediately.
          </p>
        </div>
        <div style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:14px 24px; font-size:11.5px; color:#94a3b8; text-align:center;">
          Sent to system email: ${escapeHtml(systemEmail)}
        </div>
      </div>
    </div>
  `;

  const text = `${actionTitle}\n\nYour 6-digit Tseki Admin verification code is: ${params.code}\n\nThis code expires in 5 minutes and can only be used once.\nSystem email: ${systemEmail}`;

  await transporter.sendMail({
    from: `"Tseki Admin Portal" <${gmail.user}>`,
    to: systemEmail,
    subject,
    text,
    html,
  });

  return {
    sentVia: 'gmail',
    message: `Verification OTP sent via Gmail to ${systemEmail}.`,
  };
}

async function sendTeacherStatusEmailBestEffort(params: {
  to: string;
  teacherName: string;
  approved: boolean;
  reason?: string;
}): Promise<void> {
  const gmail = getGmailConfig();
  if (!gmail || !params.to) return;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmail.user,
        pass: gmail.pass,
      },
    });

    const subject = params.approved
      ? '[Tseki] Your Teacher Account Has Been Approved'
      : '[Tseki] Update Regarding Your Teacher Registration';

    const bodyHtml = params.approved
      ? `<p>Hello <strong>${escapeHtml(params.teacherName)}</strong>,</p>
         <p>Your registered teacher account on <strong>Tseki</strong> has been <strong>approved</strong> by the administrator. You may now sign in to access your classrooms, assessments, and grading tools.</p>`
      : `<p>Hello <strong>${escapeHtml(params.teacherName)}</strong>,</p>
         <p>Your registered teacher account on <strong>Tseki</strong> was <strong>not approved</strong> at this time.</p>
         ${params.reason ? `<p><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>` : ''}
         <p>Please contact your school administrator if you believe this was an error or need to resubmit your verification documents.</p>`;

    await transporter.sendMail({
      from: `"Tseki Admin Portal" <${gmail.user}>`,
      to: params.to,
      subject,
      html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">${bodyHtml}</div>`,
    });
  } catch {
    // Non-blocking best-effort notification
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function issueOtpChallenge(params: {
  purpose: OtpPurpose;
  targetId?: string;
  teacherName?: string;
  actionLabel?: string;
}): Promise<{
  challengeToken: string;
  systemEmail: string;
  sentVia: 'gmail' | 'dev_fallback';
  demoOtp?: string;
  message: string;
  expiresAt: string;
}> {
  pruneNonces();
  const systemEmail = getSystemEmail();
  const code = crypto.randomInt(100000, 1000000).toString();
  const nonce = crypto.randomUUID();
  const exp = Date.now() + OTP_TTL_MS;
  const codeHash = hashOtp(code, nonce);

  nonceTracker.set(nonce, { used: false, attempts: 0, exp });

  const sb = getSupabaseServiceClient() || getSupabaseAdminClient();
  if (sb) {
    try {
      // Persist nonce for cross-instance serverless OTP replay protection
      await sb.from('admin_otp_nonces').upsert(
        {
          nonce,
          purpose: params.purpose,
          attempts: 0,
          used_at: null,
          expires_at: new Date(exp).toISOString(),
        },
        { onConflict: 'nonce' }
      );
      // Opportunistically clean up expired nonce rows
      await sb
        .from('admin_otp_nonces')
        .delete()
        .lt('expires_at', new Date(Date.now() - 60_000).toISOString());
    } catch {
      // Non-fatal if migration harden_admin_security.sql is not yet applied
    }

    try {
      const { error } = await sb.from('admin_otp_codes').insert({
        email: systemEmail,
        code_hash: codeHash,
        purpose: params.purpose,
        target_id: params.targetId || (params.actionLabel ? `action:${params.actionLabel}` : null),
        expires_at: new Date(exp).toISOString(),
      });
      if (error && params.purpose === 'verify_action') {
        // Fallback when deployed Supabase table keeps initial CHECK (purpose IN ('login', 'delete_teacher'))
        await sb.from('admin_otp_codes').insert({
          email: systemEmail,
          code_hash: codeHash,
          purpose: 'login',
          target_id:
            params.targetId ||
            (params.actionLabel ? `verify_action:${params.actionLabel}` : 'verify_action'),
          expires_at: new Date(exp).toISOString(),
        });
      }
    } catch {
      // Non-fatal if table isn't created yet
    }
  }

  const delivery = await sendOtpEmailViaGmail({
    code,
    purpose: params.purpose,
    teacherName: params.teacherName,
    actionLabel: params.actionLabel,
  });

  const challengeToken = signPayload({
    nonce,
    email: systemEmail,
    purpose: params.purpose,
    targetId: params.targetId,
    actionLabel: params.actionLabel,
    codeHash,
    exp,
  } satisfies OtpChallengePayload);

  return {
    challengeToken,
    systemEmail,
    sentVia: delivery.sentVia,
    ...(delivery.demoOtp ? { demoOtp: delivery.demoOtp } : {}),
    message: delivery.message,
    expiresAt: new Date(exp).toISOString(),
  };
}

async function verifyOtpChallenge(params: {
  challengeToken: string;
  code: string;
  expectedPurpose: OtpPurpose | OtpPurpose[];
  expectedTargetId?: string;
}): Promise<{ ok: true; payload: OtpChallengePayload } | { ok: false; error: string; status: number }> {
  const cleanCode = params.code.trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Verification code must be exactly 6 digits.', status: 400 };
  }

  const payload = verifySignedPayload<OtpChallengePayload>(params.challengeToken);
  if (!payload) {
    return { ok: false, error: 'Invalid or tampered verification session. Please request a new OTP.', status: 400 };
  }

  const allowedPurposes = Array.isArray(params.expectedPurpose)
    ? params.expectedPurpose
    : [params.expectedPurpose];
  if (!allowedPurposes.includes(payload.purpose)) {
    return { ok: false, error: 'OTP purpose mismatch. Please request a new OTP.', status: 400 };
  }

  if (
    params.expectedTargetId &&
    (payload.purpose === 'delete_teacher' || payload.targetId) &&
    payload.targetId !== params.expectedTargetId
  ) {
    return { ok: false, error: 'OTP target mismatch. Please request a new OTP.', status: 400 };
  }

  if (Date.now() > payload.exp) {
    return { ok: false, error: 'Verification code has expired. Please request a new OTP.', status: 400 };
  }

  // Check persistent DB nonce store first (prevents cross-instance serverless replays)
  const sb = getSupabaseServiceClient();
  let dbNonceAvailable = false;
  let dbNonceRow: { attempts?: number; used_at?: string | null } | null = null;
  if (sb) {
    try {
      const { data, error } = await sb
        .from('admin_otp_nonces')
        .select('attempts, used_at')
        .eq('nonce', payload.nonce)
        .maybeSingle();

      if (!error) {
        dbNonceAvailable = true;
        dbNonceRow = data as { attempts?: number; used_at?: string | null } | null;
        if (dbNonceRow?.used_at) {
          return { ok: false, error: 'This verification code has already been used.', status: 400 };
        }
        if ((dbNonceRow?.attempts ?? 0) >= MAX_OTP_ATTEMPTS) {
          return {
            ok: false,
            error: 'Too many failed attempts. Please request a new verification code.',
            status: 429,
          };
        }
      }
    } catch {
      dbNonceAvailable = false;
    }
  }

  const state = nonceTracker.get(payload.nonce);
  if (state) {
    if (state.used) {
      return { ok: false, error: 'This verification code has already been used.', status: 400 };
    }
    if (state.attempts >= MAX_OTP_ATTEMPTS) {
      return {
        ok: false,
        error: 'Too many failed attempts. Please request a new verification code.',
        status: 429,
      };
    }
    state.attempts += 1;
  }

  const candidateHash = hashOtp(cleanCode, payload.nonce);
  const a = Buffer.from(candidateHash);
  const b = Buffer.from(payload.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    if (sb && dbNonceAvailable) {
      try {
        await sb
          .from('admin_otp_nonces')
          .update({ attempts: (dbNonceRow?.attempts ?? 0) + 1 })
          .eq('nonce', payload.nonce);
      } catch {
        // non-fatal
      }
    }
    return { ok: false, error: 'Invalid verification code. Please check your email and try again.', status: 401 };
  }

  // Atomically mark nonce used in Postgres so parallel replay requests fail
  if (sb && dbNonceAvailable) {
    try {
      if (dbNonceRow) {
        const { data: claimed, error: claimErr } = await sb
          .from('admin_otp_nonces')
          .update({
            used_at: new Date().toISOString(),
            attempts: (dbNonceRow.attempts ?? 0) + 1,
          })
          .eq('nonce', payload.nonce)
          .is('used_at', null)
          .select('nonce');

        if (!claimErr && (!claimed || claimed.length === 0)) {
          return { ok: false, error: 'This verification code has already been used.', status: 400 };
        }
      } else {
        // Nonce wasn't persisted on issue (e.g., created right before migration): insert as used
        const { error: insertErr } = await sb.from('admin_otp_nonces').insert({
          nonce: payload.nonce,
          purpose: payload.purpose,
          attempts: 1,
          used_at: new Date().toISOString(),
          expires_at: new Date(payload.exp).toISOString(),
        });
        if (insertErr && insertErr.code === '23505') {
          return { ok: false, error: 'This verification code has already been used.', status: 400 };
        }
      }
    } catch {
      // non-fatal fallback to in-memory lock below
    }
  }

  if (state) {
    state.used = true;
  } else {
    nonceTracker.set(payload.nonce, { used: true, attempts: 1, exp: payload.exp });
  }

  return { ok: true, payload };
}

function authenticateSession(headers: Record<string, string | string[] | undefined>): SessionPayload | null {
  const raw = headers['authorization'] || headers['Authorization'];
  const authHeader = Array.isArray(raw) ? raw[0] : raw;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySignedPayload<SessionPayload>(token);
  if (!payload || Date.now() > payload.exp) {
    return null;
  }
  return payload;
}

async function verifyAdminCredentials(emailInput: string, password: string): Promise<boolean> {
  const cleanEmail = emailInput.trim().toLowerCase();
  const configuredEmail = getConfiguredAdminEmail().toLowerCase();
  const configuredPassword = getConfiguredAdminPassword();

  const matchesLocal =
    (cleanEmail === configuredEmail || cleanEmail === 'admin@tseki.edu') &&
    timingSafeStringEqual(password, configuredPassword);

  if (matchesLocal) return true;

  // Optionally allow Supabase Auth admin user if configured
  const sb = getSupabaseAdminClient();
  if (sb && cleanEmail === configuredEmail) {
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: emailInput.trim(),
        password,
      });
      if (!error) return true;
    } catch {
      // Ignore
    }
  }

  return false;
}

/**
 * Verifies admin identity via password re-entry or Gmail OTP before any mutating action.
 */
async function verifyAdminReauth(params: {
  sessionEmail: string;
  body: Record<string, unknown>;
  expectedTargetId?: string;
  allowDeleteOtpPurpose?: boolean;
}): Promise<
  | { ok: true; methodLabel: 'Password Verified' | 'Gmail OTP Verified' }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const rawVerification =
    params.body.verification && typeof params.body.verification === 'object'
      ? (params.body.verification as Partial<AdminReauthPayload> & Record<string, unknown>)
      : params.body.challengeToken || params.body.code
      ? {
          method: 'otp' as const,
          challengeToken: String(params.body.challengeToken || ''),
          code: String(params.body.code || ''),
        }
      : null;

  if (!rawVerification) {
    return {
      ok: false,
      status: 403,
      body: {
        code: 'REAUTH_REQUIRED',
        error: 'Admin verification required. Please re-enter your password or verify via Gmail OTP before editing data.',
      },
    };
  }

  if (rawVerification.method === 'password') {
    const password = String(rawVerification.password || '');
    if (!password) {
      return {
        ok: false,
        status: 403,
        body: {
          code: 'REAUTH_REQUIRED',
          error: 'Please enter your administrator password to authorize this edit.',
        },
      };
    }

    const valid =
      (await verifyAdminCredentials(params.sessionEmail, password)) ||
      (await verifyAdminCredentials(getConfiguredAdminEmail(), password));
    if (!valid) {
      return {
        ok: false,
        status: 403,
        body: {
          code: 'REAUTH_FAILED',
          error: 'Incorrect administrator password. No changes were saved.',
        },
      };
    }

    return { ok: true, methodLabel: 'Password Verified' };
  }

  if (rawVerification.method === 'otp') {
    const challengeToken = String(rawVerification.challengeToken || '');
    const code = String(rawVerification.code || '');
    const allowedPurposes: OtpPurpose[] = params.allowDeleteOtpPurpose
      ? ['verify_action', 'delete_teacher']
      : ['verify_action'];

    const otpRes = await verifyOtpChallenge({
      challengeToken,
      code,
      expectedPurpose: allowedPurposes,
      expectedTargetId: params.expectedTargetId,
    });

    if (!otpRes.ok) {
      return {
        ok: false,
        status: otpRes.status === 401 ? 403 : otpRes.status,
        body: {
          code: 'REAUTH_FAILED',
          error: otpRes.error,
        },
      };
    }

    return { ok: true, methodLabel: 'Gmail OTP Verified' };
  }

  return {
    ok: false,
    status: 403,
    body: {
      code: 'REAUTH_REQUIRED',
      error: 'Unsupported verification method. Choose password re-entry or Gmail OTP.',
    },
  };
}

async function syncTeacherToSupabase(params: {
  sb: SupabaseClient;
  teachersTableIds: Set<string>;
  target: TeacherRecord;
  updates: Partial<TeacherRecord>;
}): Promise<{ teacher: TeacherRecord; error?: string }> {
  const { sb, teachersTableIds, target, updates } = params;
  const fallbackMerged: TeacherRecord = { ...target, ...updates };

  if (teachersTableIds.has(target.id)) {
    const { data, error } = await sb
      .from('teachers')
      .update(updates)
      .eq('id', target.id)
      .select('*')
      .single();
    if (error) return { teacher: fallbackMerged, error: error.message };
    return { teacher: (data as TeacherRecord) || fallbackMerged };
  }

  const upsertPayload = {
    id: target.user_id || target.id,
    user_id: target.user_id || null,
    username: target.username,
    email: target.email,
    full_name: target.full_name,
    teacher_id: target.teacher_id || null,
    grade_level: target.grade_level || null,
    subject: target.subject || null,
    strand: target.strand || null,
    status: updates.status || target.status,
    rejection_reason: updates.rejection_reason ?? target.rejection_reason ?? null,
    approved_at: updates.approved_at ?? target.approved_at ?? null,
    approved_by: updates.approved_by ?? target.approved_by ?? null,
  };

  const { data, error } = await sb
    .from('teachers')
    .upsert(upsertPayload, { onConflict: 'email' })
    .select('*')
    .single();
  if (error) return { teacher: fallbackMerged, error: error.message };
  return { teacher: (data as TeacherRecord) || fallbackMerged };
}

export async function handleAdminApiRequest(params: {
  method: string;
  route: string;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): Promise<ApiResult> {
  const method = params.method.toUpperCase();
  const route = params.route.replace(/^\/+|\/+$/g, '');
  const body = params.body || {};

  // ── Public Routes ────────────────────────────────────────────
  if (method === 'GET' && route === 'health') {
    const gmail = getGmailConfig();
    return {
      status: 200,
      body: {
        gmailConfigured: Boolean(gmail),
        systemEmail: getSystemEmail(),
        supabaseConfigured: hasSupabaseConfig(),
        serviceRoleConfigured: hasServiceRoleKey(),
      },
    };
  }

  if (method === 'POST' && route === 'login') {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');

    if (!email || !password) {
      return { status: 400, body: { error: 'Please enter both your administrator email and password.' } };
    }

    const valid = await verifyAdminCredentials(email, password);
    if (!valid) {
      return {
        status: 401,
        body: { error: 'Invalid administrator credentials. Please verify your email and password.' },
      };
    }

    try {
      const challenge = await issueOtpChallenge({ purpose: 'login' });
      return { status: 200, body: challenge };
    } catch (err) {
      return {
        status: 503,
        body: {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to send OTP via Gmail. Check GMAIL_USER and GMAIL_APP_PASSWORD.',
        },
      };
    }
  }

  if (method === 'POST' && route === 'resend-otp') {
    const challengeToken = String(body.challengeToken || '');
    const existing = verifySignedPayload<OtpChallengePayload>(challengeToken);
    if (!existing) {
      return { status: 400, body: { error: 'Verification session expired. Please sign in again.' } };
    }

    if (existing.purpose === 'delete_teacher' || existing.purpose === 'verify_action') {
      const session = authenticateSession(params.headers);
      if (!session) {
        return { status: 401, body: { error: 'Unauthorized. Please sign in again.' } };
      }
    }

    try {
      const teacherName = body.teacherName ? String(body.teacherName) : undefined;
      const actionLabel = body.actionLabel ? String(body.actionLabel) : existing.actionLabel;
      const challenge = await issueOtpChallenge({
        purpose: existing.purpose,
        targetId: existing.targetId,
        teacherName,
        actionLabel,
      });
      return { status: 200, body: challenge };
    } catch (err) {
      return {
        status: 503,
        body: {
          error:
            err instanceof Error
              ? err.message
              : 'Could not resend OTP via Gmail.',
        },
      };
    }
  }

  if (method === 'POST' && route === 'verify-otp') {
    const challengeToken = String(body.challengeToken || '');
    const code = String(body.code || '');

    const verification = await verifyOtpChallenge({
      challengeToken,
      code,
      expectedPurpose: 'login',
    });

    if (!verification.ok) {
      return { status: verification.status, body: { error: verification.error } };
    }

    const exp = Date.now() + SESSION_TTL_MS;
    const sessionToken = signPayload({
      email: verification.payload.email,
      exp,
    } satisfies SessionPayload);

    await appendActivityLog({
      teacher_id: null,
      teacher_name: 'Admin Console',
      operation: 'Admin Signed In (2FA Gmail OTP Verified)',
      actor: verification.payload.email,
    });

    return {
      status: 200,
      body: {
        sessionToken,
        adminEmail: verification.payload.email,
        expiresAt: new Date(exp).toISOString(),
      },
    };
  }

  // ── Protected Routes ─────────────────────────────────────────
  const session = authenticateSession(params.headers);
  if (!session) {
    return { status: 401, body: { error: 'Unauthorized. Please sign in.' } };
  }

  if (method === 'POST' && route === 'logout') {
    await appendActivityLog({
      teacher_id: null,
      teacher_name: 'Admin Console',
      operation: 'Admin Signed Out',
      actor: session.email,
    });
    return { status: 200, body: { loggedOut: true } };
  }

  if (method === 'POST' && route === 'action-otp') {
    const actionLabel = body.actionLabel ? String(body.actionLabel).trim() : 'Edit Portal Data';
    const targetId = body.targetId ? String(body.targetId).trim() : undefined;
    const targetName = body.targetName ? String(body.targetName).trim() : undefined;

    try {
      const challenge = await issueOtpChallenge({
        purpose: 'verify_action',
        targetId,
        teacherName: targetName,
        actionLabel,
      });
      return { status: 200, body: challenge };
    } catch (err) {
      return {
        status: 503,
        body: {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to send verification OTP via Gmail.',
        },
      };
    }
  }

  if (method === 'GET' && route === 'session') {
    return {
      status: 200,
      body: {
        authenticated: true,
        adminEmail: session.email,
        systemEmail: getSystemEmail(),
        gmailConfigured: Boolean(getGmailConfig()),
        supabaseConfigured: hasSupabaseConfig(),
        serviceRoleConfigured: hasServiceRoleKey(),
      },
    };
  }

  if (method === 'GET' && route === 'teachers') {
    const data = await fetchTeachersAndLogs();
    return {
      status: 200,
      body: {
        teachers: data.teachers,
        activityLogs: data.activityLogs,
        source: data.source,
        supabaseConfigured: hasSupabaseConfig(),
        serviceRoleConfigured: hasServiceRoleKey(),
        systemEmail: getSystemEmail(),
        gmailConfigured: Boolean(getGmailConfig()),
      },
    };
  }

  if (method === 'POST' && route === 'teachers/approve') {
    const teacherId = String(body.teacherId || '').trim();
    if (!teacherId) {
      return { status: 400, body: { error: 'Missing teacherId.' } };
    }

    const reauth = await verifyAdminReauth({
      sessionEmail: session.email,
      body,
      expectedTargetId: teacherId,
    });
    if (!reauth.ok) {
      return { status: reauth.status, body: reauth.body };
    }

    const { teachers, source, teachersTableIds } = await fetchTeachersAndLogs();
    if (source === 'supabase_needs_service_key') {
      return {
        status: 503,
        body: { error: 'Add SUPABASE_SERVICE_ROLE_KEY to admin-web/.env to manage Supabase accounts.' },
      };
    }

    const target = teachers.find((t) => t.id === teacherId);
    if (!target) {
      return { status: 404, body: { error: 'Teacher registration not found.' } };
    }

    const approvedAt = new Date().toISOString();
    const updates: Partial<TeacherRecord> = {
      status: 'approved',
      rejection_reason: null,
      approved_at: approvedAt,
      approved_by: session.email,
    };
    let updatedTeacher: TeacherRecord = { ...target, ...updates };

    if (source === 'supabase') {
      const sb = getSupabaseServiceClient();
      if (sb) {
        if (target.user_id) {
          await sb.auth.admin.updateUserById(target.user_id, {
            ban_duration: 'none',
            email_confirm: true,
          });
        }
        const synced = await syncTeacherToSupabase({ sb, teachersTableIds, target, updates });
        if (synced.error) return { status: 500, body: { error: synced.error } };
        updatedTeacher = synced.teacher;
      }
    } else {
      const store = readLocalStore();
      store.teachers = store.teachers.map((t) => (t.id === teacherId ? updatedTeacher : t));
      writeLocalStore(store);
    }

    const log = await appendActivityLog({
      teacher_id: teachersTableIds.has(updatedTeacher.id) ? updatedTeacher.id : null,
      teacher_name: target.full_name,
      operation: `Admin Approved Teacher Registration (${reauth.methodLabel})`,
      actor: session.email,
    });

    await sendTeacherStatusEmailBestEffort({
      to: target.email,
      teacherName: target.full_name,
      approved: true,
    });

    return { status: 200, body: { teacher: updatedTeacher, log } };
  }

  if (method === 'POST' && route === 'teachers/reject') {
    const teacherId = String(body.teacherId || '').trim();
    const reason =
      String(body.reason || '').trim() || 'Verification documents could not be validated';

    if (!teacherId) {
      return { status: 400, body: { error: 'Missing teacherId.' } };
    }

    const reauth = await verifyAdminReauth({
      sessionEmail: session.email,
      body,
      expectedTargetId: teacherId,
    });
    if (!reauth.ok) {
      return { status: reauth.status, body: reauth.body };
    }

    const { teachers, source, teachersTableIds } = await fetchTeachersAndLogs();
    if (source === 'supabase_needs_service_key') {
      return {
        status: 503,
        body: { error: 'Add SUPABASE_SERVICE_ROLE_KEY to admin-web/.env to manage Supabase accounts.' },
      };
    }

    const target = teachers.find((t) => t.id === teacherId);
    if (!target) {
      return { status: 404, body: { error: 'Teacher registration not found.' } };
    }

    const updates: Partial<TeacherRecord> = {
      status: 'rejected',
      rejection_reason: reason,
    };
    let updatedTeacher: TeacherRecord = { ...target, ...updates };

    if (source === 'supabase') {
      const sb = getSupabaseServiceClient();
      if (sb) {
        if (target.user_id) {
          await sb.auth.admin.updateUserById(target.user_id, { ban_duration: '876000h' });
        }
        const synced = await syncTeacherToSupabase({ sb, teachersTableIds, target, updates });
        if (synced.error) return { status: 500, body: { error: synced.error } };
        updatedTeacher = synced.teacher;
      }
    } else {
      const store = readLocalStore();
      store.teachers = store.teachers.map((t) => (t.id === teacherId ? updatedTeacher : t));
      writeLocalStore(store);
    }

    const log = await appendActivityLog({
      teacher_id: teachersTableIds.has(updatedTeacher.id) ? updatedTeacher.id : null,
      teacher_name: target.full_name,
      operation: `Admin Rejected Registration (${reauth.methodLabel}): ${reason}`,
      actor: session.email,
    });

    await sendTeacherStatusEmailBestEffort({
      to: target.email,
      teacherName: target.full_name,
      approved: false,
      reason,
    });

    return { status: 200, body: { teacher: updatedTeacher, log } };
  }

  if (method === 'POST' && route === 'teachers/toggle-status') {
    const teacherId = String(body.teacherId || '').trim();
    if (!teacherId) {
      return { status: 400, body: { error: 'Missing teacherId.' } };
    }

    const reauth = await verifyAdminReauth({
      sessionEmail: session.email,
      body,
      expectedTargetId: teacherId,
    });
    if (!reauth.ok) {
      return { status: reauth.status, body: reauth.body };
    }

    const { teachers, source, teachersTableIds } = await fetchTeachersAndLogs();
    if (source === 'supabase_needs_service_key') {
      return {
        status: 503,
        body: { error: 'Add SUPABASE_SERVICE_ROLE_KEY to admin-web/.env to manage Supabase accounts.' },
      };
    }

    const target = teachers.find((t) => t.id === teacherId);
    if (!target) {
      return { status: 404, body: { error: 'Teacher not found.' } };
    }

    const nextStatus: TeacherStatus = target.status === 'approved' ? 'suspended' : 'approved';
    const approvedAt =
      nextStatus === 'approved' ? target.approved_at || new Date().toISOString() : target.approved_at;
    const updates: Partial<TeacherRecord> = { status: nextStatus, approved_at: approvedAt };
    let updatedTeacher: TeacherRecord = { ...target, ...updates };

    if (source === 'supabase') {
      const sb = getSupabaseServiceClient();
      if (sb) {
        if (target.user_id) {
          const authUpdate =
            nextStatus === 'approved'
              ? { ban_duration: 'none', email_confirm: true }
              : { ban_duration: '876000h' };
          const { error: authErr } = await sb.auth.admin.updateUserById(target.user_id, authUpdate);
          if (authErr) return { status: 500, body: { error: authErr.message } };
        }
        const synced = await syncTeacherToSupabase({ sb, teachersTableIds, target, updates });
        if (synced.error) return { status: 500, body: { error: synced.error } };
        updatedTeacher = { ...updatedTeacher, ...synced.teacher, status: nextStatus };
      }
    } else {
      const store = readLocalStore();
      store.teachers = store.teachers.map((t) => (t.id === teacherId ? updatedTeacher : t));
      writeLocalStore(store);
    }

    const op = nextStatus === 'approved' ? 'Admin Enabled Account' : 'Admin Disabled Account';
    const log = await appendActivityLog({
      teacher_id: teachersTableIds.has(updatedTeacher.id) ? updatedTeacher.id : null,
      teacher_name: target.full_name,
      operation: `${op} (${reauth.methodLabel})`,
      actor: session.email,
    });

    return { status: 200, body: { teacher: updatedTeacher, log } };
  }

  if (method === 'POST' && route === 'teachers/delete-otp') {
    const teacherId = String(body.teacherId || '').trim();
    if (!teacherId) {
      return { status: 400, body: { error: 'Missing teacherId.' } };
    }

    const { teachers } = await fetchTeachersAndLogs();
    const target = teachers.find((t) => t.id === teacherId);
    if (!target) {
      return { status: 404, body: { error: 'Teacher not found.' } };
    }

    try {
      const challenge = await issueOtpChallenge({
        purpose: 'delete_teacher',
        targetId: teacherId,
        teacherName: target.full_name,
      });
      return { status: 200, body: challenge };
    } catch (err) {
      return {
        status: 503,
        body: {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to send deletion verification OTP via Gmail.',
        },
      };
    }
  }

  if (method === 'POST' && route === 'teachers/delete') {
    const teacherId = String(body.teacherId || '').trim();
    if (!teacherId) {
      return { status: 400, body: { error: 'Missing teacherId.' } };
    }

    const reauth = await verifyAdminReauth({
      sessionEmail: session.email,
      body,
      expectedTargetId: teacherId,
      allowDeleteOtpPurpose: true,
    });
    if (!reauth.ok) {
      return { status: reauth.status, body: reauth.body };
    }

    const { teachers, source, teachersTableIds } = await fetchTeachersAndLogs();
    if (source === 'supabase_needs_service_key') {
      return {
        status: 503,
        body: { error: 'Add SUPABASE_SERVICE_ROLE_KEY to admin-web/.env to manage Supabase accounts.' },
      };
    }

    const target = teachers.find((t) => t.id === teacherId);
    if (!target) {
      return { status: 404, body: { error: 'Teacher not found.' } };
    }

    if (source === 'supabase') {
      const sb = getSupabaseServiceClient();
      if (sb) {
        if (teachersTableIds.has(teacherId)) {
          const { error } = await sb.from('teachers').delete().eq('id', teacherId);
          if (error) return { status: 500, body: { error: error.message } };
        }
        if (target.user_id) {
          const { error: authErr } = await sb.auth.admin.deleteUser(target.user_id);
          if (authErr && !authErr.message?.toLowerCase().includes('not found')) {
            return { status: 500, body: { error: authErr.message } };
          }
        }
      }
    } else {
      const store = readLocalStore();
      store.teachers = store.teachers.filter((t) => t.id !== teacherId);
      writeLocalStore(store);
    }

    const log = await appendActivityLog({
      teacher_id: null,
      teacher_name: target.full_name,
      operation: `Admin Permanently Deleted Teacher Account (${reauth.methodLabel})`,
      actor: session.email,
    });

    return { status: 200, body: { deletedId: teacherId, log } };
  }

  if (method === 'POST' && route === 'activity-logs/clear') {
    const reauth = await verifyAdminReauth({
      sessionEmail: session.email,
      body,
      expectedTargetId: 'clear_logs',
    });
    if (!reauth.ok) {
      return { status: reauth.status, body: reauth.body };
    }

    const { source } = await fetchTeachersAndLogs();
    if (source === 'supabase_needs_service_key') {
      return {
        status: 503,
        body: { error: 'Add SUPABASE_SERVICE_ROLE_KEY to admin-web/.env first.' },
      };
    }

    let auditCreatedAt: string | undefined;
    if (source === 'supabase') {
      const sb = getSupabaseServiceClient();
      if (sb) {
        const { error: delErr } = await sb.from('admin_activity_logs').delete().gte('id', 0);
        if (delErr) {
          return { status: 500, body: { error: delErr.message } };
        }
        // Record clear cutoff marker so earlier app events remain hidden while keeping this clear event visible
        const { data: cutoffRow } = await sb
          .from('admin_activity_logs')
          .insert({
            teacher_id: null,
            teacher_name: '__SYSTEM__',
            operation: '__CLEARED__',
            actor: session.email,
          })
          .select('created_at')
          .single();
        if (cutoffRow?.created_at) {
          auditCreatedAt = new Date(new Date(String(cutoffRow.created_at)).getTime() + 5).toISOString();
        }
      }
    } else {
      const store = readLocalStore();
      store.activityLogs = [];
      writeLocalStore(store);
    }

    const log = await appendActivityLog({
      teacher_id: null,
      teacher_name: 'Admin Console',
      operation: `Admin Cleared Activity Log (${reauth.methodLabel})`,
      actor: session.email,
      created_at: auditCreatedAt,
    });

    return { status: 200, body: { cleared: true, log } };
  }

  return { status: 404, body: { error: `Unknown admin API route: ${route}` } };
}
