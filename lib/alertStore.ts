import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity =
  | "HIGH RISK"
  | "URGENT REVIEW"
  | "SCORE DROP"
  | "NEEDS SUPPORT";

export interface RosterAlert {
  id: string;
  studentId: string;
  studentName: string;
  classroomId: string;
  classroomTitle: string;
  classroomSchedule: string;
  classroomRoom: string;
  classroomColor: string;
  /** Student's current cumulative average (0-100) */
  scorePercentage: number;
  /** Score on the specific quiz that triggered or most recently updated the alert */
  quizScorePercentage?: number;
  /** Prior cumulative average before the triggering quiz (for score drop context) */
  previousAverage?: number;
  /** Raw points earned on the latest quiz */
  rawScore?: number;
  /** Maximum points on the latest quiz */
  maxScore?: number;
  /** Total graded assessments for this student in this classroom */
  quizCount?: number;
  quizTitle?: string;
  alertType: AlertSeverity;
  message: string;
  createdAt: string;
  timeLabel: string;
  isRead?: boolean;
}

export interface AlertPreferences {
  /** Students with cumulative average <= atRiskThreshold are flagged (default 50) */
  atRiskThreshold: number;
  /** Alert when a student's newly graded quiz drops >= 15 pts below their prior average */
  enableScoreDropAlerts: boolean;
  /** Also show a "Needs Support" watchlist tier for students between threshold+1 and 74% */
  includeNearPassing: boolean;
}

export interface DismissedAlertSnapshot {
  score: number;
  dismissedAt: string;
  alertType?: AlertSeverity;
}

export interface StudentQuizSnapshot {
  quizTitle?: string;
  scorePercentage?: number;
  totalScore?: number;
  maxScore?: number;
  gradedAt?: string;
  quizCount?: number;
}

export interface ReconcileClassroomInput {
  id: string;
  title: string;
  subject?: string;
  section?: string;
  room?: string;
  schedule?: string;
  color?: string;
}

export interface ReconcileStudentInput {
  id: string;
  classroom_id: string;
  full_name: string;
  average: number | null | undefined;
}

export interface ReconciledAlertsResult {
  activeAlerts: RosterAlert[];
  dismissedAlerts: RosterAlert[];
  unreadCount: number;
  flaggedCountsByClassroom: Record<string, number>;
  preferences: AlertPreferences;
}

// ── Constants & Storage Keys ──────────────────────────────────────────────────

export const PASSING_GRADE = 75;
export const SCORE_DROP_MIN_DELTA = 15;
export const ALERT_THRESHOLD_PRESETS = [40, 50, 60, 70, 74] as const;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  atRiskThreshold: 50,
  enableScoreDropAlerts: true,
  includeNearPassing: false,
};

const ALERTS_STORAGE_KEY = "tseki_roster_alerts";
const CLEARED_KEY = "tseki_cleared_alert_ids";
const READ_KEY = "tseki_read_alert_ids";
const PREFS_KEY = "tseki_alert_preferences";
const DISMISSED_SNAPSHOTS_KEY = "tseki_dismissed_alert_snapshots";

const SEVERITY_PRIORITY: Record<AlertSeverity, number> = {
  "HIGH RISK": 0,
  "URGENT REVIEW": 1,
  "SCORE DROP": 2,
  "NEEDS SUPPORT": 3,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getCriticalCutoff(atRiskThreshold: number): number {
  if (atRiskThreshold <= 40) return 30;
  if (atRiskThreshold >= 60) return 50;
  return 40;
}

export function classifyScoreSeverity(
  average: number,
  prefs: AlertPreferences
): AlertSeverity | null {
  const rounded = Math.round(average);
  if (rounded <= prefs.atRiskThreshold) {
    return rounded <= getCriticalCutoff(prefs.atRiskThreshold)
      ? "HIGH RISK"
      : "URGENT REVIEW";
  }
  if (prefs.includeNearPassing && rounded < PASSING_GRADE) {
    return "NEEDS SUPPORT";
  }
  return null;
}

/**
 * Computes a live, human-friendly relative timestamp label from an ISO timestamp.
 */
export function formatAlertTimeLabel(
  isoDate?: string | null,
  fallback: string = "Today"
): string {
  if (!isoDate) return fallback;
  const parsed = new Date(isoDate);
  const ts = parsed.getTime();
  if (!Number.isFinite(ts)) return fallback;

  const now = new Date();
  const diffMs = now.getTime() - ts;

  if (diffMs < 0) return "Just now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  const sameDay =
    now.getFullYear() === parsed.getFullYear() &&
    now.getMonth() === parsed.getMonth() &&
    now.getDate() === parsed.getDate();

  if (sameDay) {
    return diffHours <= 12 ? `${diffHours}h ago` : "Today";
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === parsed.getFullYear() &&
    yesterday.getMonth() === parsed.getMonth() &&
    yesterday.getDate() === parsed.getDate();
  if (isYesterday) return "Yesterday";

  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return `${diffDays}d ago`;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Generates clean, non-redundant contextual copy for an alert card.
 */
export function buildAlertContextText(alert: {
  alertType: AlertSeverity;
  scorePercentage: number;
  quizScorePercentage?: number;
  previousAverage?: number;
  rawScore?: number;
  maxScore?: number;
  quizTitle?: string;
}): string {
  const avg = Math.round(alert.scorePercentage);
  const gapToPassing = Math.max(0, PASSING_GRADE - avg);

  if (
    alert.alertType === "SCORE DROP" &&
    typeof alert.previousAverage === "number" &&
    typeof alert.quizScorePercentage === "number"
  ) {
    const drop = Math.max(0, Math.round(alert.previousAverage - alert.quizScorePercentage));
    const quizPart = alert.quizTitle ? ` on ${alert.quizTitle}` : "";
    return `Dropped ${drop} pts${quizPart} (${Math.round(alert.previousAverage)}% → ${Math.round(alert.quizScorePercentage)}%)`;
  }

  if (alert.quizTitle && typeof alert.quizScorePercentage === "number") {
    const rawPart =
      typeof alert.rawScore === "number" &&
      typeof alert.maxScore === "number" &&
      alert.maxScore > 0
        ? ` (${alert.rawScore}/${alert.maxScore})`
        : "";
    if (Math.round(alert.quizScorePercentage) !== avg) {
      return `Scored ${Math.round(alert.quizScorePercentage)}%${rawPart} on ${alert.quizTitle} · Avg ${avg}%`;
    }
    return `Scored ${Math.round(alert.quizScorePercentage)}%${rawPart} on ${alert.quizTitle} · ${gapToPassing} pts below passing`;
  }

  if (alert.alertType === "NEEDS SUPPORT") {
    return `${gapToPassing} pt${gapToPassing === 1 ? "" : "s"} away from the ${PASSING_GRADE}% DepEd passing mark`;
  }

  if (gapToPassing > 0) {
    return `${gapToPassing} pts below the ${PASSING_GRADE}% passing mark`;
  }

  return `Current overall average is ${avg}%`;
}

/**
 * Generates concise, non-duplicative summary copy for the alert card body
 * (keeping the quiz title cleanly isolated in the card's dedicated quiz footer row
 * so long quiz titles never crowd out or truncate key score metrics).
 */
export function buildAlertCardSummary(alert: {
  alertType: AlertSeverity;
  scorePercentage: number;
  quizScorePercentage?: number;
  previousAverage?: number;
  rawScore?: number;
  maxScore?: number;
}): string {
  const avg = Math.round(alert.scorePercentage);
  const gapToPassing = Math.max(0, PASSING_GRADE - avg);

  if (
    alert.alertType === "SCORE DROP" &&
    typeof alert.previousAverage === "number" &&
    typeof alert.quizScorePercentage === "number"
  ) {
    const drop = Math.max(0, Math.round(alert.previousAverage - alert.quizScorePercentage));
    return `Dropped ${drop} pts (${Math.round(alert.previousAverage)}% → ${Math.round(alert.quizScorePercentage)}%)`;
  }

  if (typeof alert.quizScorePercentage === "number") {
    const quizPct = Math.round(alert.quizScorePercentage);
    const rawPart =
      typeof alert.rawScore === "number" &&
      typeof alert.maxScore === "number" &&
      alert.maxScore > 0
        ? ` (${alert.rawScore}/${alert.maxScore})`
        : "";
    if (gapToPassing > 0) {
      return `Latest quiz: ${quizPct}%${rawPart} · ${gapToPassing} pts below passing`;
    }
    return `Latest quiz: ${quizPct}%${rawPart}`;
  }

  if (alert.alertType === "NEEDS SUPPORT") {
    return `${gapToPassing} pt${gapToPassing === 1 ? "" : "s"} away from ${PASSING_GRADE}% passing`;
  }

  if (gapToPassing > 0) {
    return `${gapToPassing} pts below the ${PASSING_GRADE}% passing mark`;
  }

  return `Current overall average is ${avg}%`;
}

/**
 * Generates a clean legacy-compatible plain-text message string.
 */
export function buildAlertMessage(alert: {
  studentName: string;
  alertType: AlertSeverity;
  scorePercentage: number;
  quizScorePercentage?: number;
  previousAverage?: number;
  quizTitle?: string;
}): string {
  const context = buildAlertContextText(alert);
  return `${alert.studentName} — ${context}.`;
}

// ── Preferences Storage ───────────────────────────────────────────────────────

export async function getAlertPreferences(): Promise<AlertPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_PREFERENCES };
    const parsed = JSON.parse(raw);
    const threshold =
      typeof parsed?.atRiskThreshold === "number" &&
      parsed.atRiskThreshold >= 30 &&
      parsed.atRiskThreshold <= 74
        ? parsed.atRiskThreshold
        : DEFAULT_ALERT_PREFERENCES.atRiskThreshold;
    return {
      atRiskThreshold: threshold,
      enableScoreDropAlerts:
        typeof parsed?.enableScoreDropAlerts === "boolean"
          ? parsed.enableScoreDropAlerts
          : DEFAULT_ALERT_PREFERENCES.enableScoreDropAlerts,
      includeNearPassing:
        typeof parsed?.includeNearPassing === "boolean"
          ? parsed.includeNearPassing
          : DEFAULT_ALERT_PREFERENCES.includeNearPassing,
    };
  } catch {
    return { ...DEFAULT_ALERT_PREFERENCES };
  }
}

export async function saveAlertPreferences(
  partial: Partial<AlertPreferences>
): Promise<AlertPreferences> {
  const current = await getAlertPreferences();
  const next: AlertPreferences = {
    ...current,
    ...partial,
  };
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("Failed to save alert preferences:", err);
  }
  return next;
}

// ── Persisted Alerts Storage ──────────────────────────────────────────────────

/**
 * Retrieves persisted roster alerts from storage.
 */
export async function getPersistedAlerts(): Promise<RosterAlert[]> {
  try {
    const raw = await AsyncStorage.getItem(ALERTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to load alerts from storage:", err);
    return [];
  }
}

async function setPersistedAlerts(alerts: RosterAlert[]): Promise<void> {
  await AsyncStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
}

/**
 * Saves a new alert when a student is flagged at-risk or experiences a sharp score drop.
 */
export async function saveRosterAlert(
  alert: Omit<RosterAlert, "id" | "createdAt" | "timeLabel">
): Promise<RosterAlert> {
  const nowIso = new Date().toISOString();
  const newAlert: RosterAlert = {
    ...alert,
    id: `alert_${alert.studentId}_${Date.now()}`,
    createdAt: nowIso,
    timeLabel: "Just now",
    isRead: false,
  };

  try {
    const existing = await getPersistedAlerts();
    // Keep newest alert per student, removing older duplicate alerts for the same student
    const updated = [
      newAlert,
      ...existing.filter((a) => a.studentId !== alert.studentId),
    ];
    await setPersistedAlerts(updated);

    // Remove from cleared list & dismissed snapshots so re-flagged student surfaces cleanly
    const [cleared, snapshots, read] = await Promise.all([
      getClearedAlertIds(),
      getDismissedSnapshots(),
      getReadAlertIds(),
    ]);

    const updatedCleared = cleared.filter(
      (id) =>
        id !== newAlert.id &&
        id !== alert.studentId &&
        id !== `flag_${alert.studentId}`
    );
    delete snapshots[alert.studentId];

    const updatedRead = read.filter(
      (id) =>
        id !== newAlert.id &&
        id !== alert.studentId &&
        id !== `flag_${alert.studentId}` &&
        id !== `alert_${alert.studentId}`
    );

    await Promise.all([
      AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(updatedCleared)),
      AsyncStorage.setItem(DISMISSED_SNAPSHOTS_KEY, JSON.stringify(snapshots)),
      AsyncStorage.setItem(READ_KEY, JSON.stringify(updatedRead)),
    ]);

    return newAlert;
  } catch (err) {
    console.error("Failed to save alert:", err);
    return newAlert;
  }
}

/**
 * Evaluates a newly graded student assessment against the teacher's alert preferences.
 * - Triggers Critical / At-Risk alert if cumulative average <= threshold
 * - Triggers Score Drop alert if single quiz dropped >= 15 pts below prior average & < 75%
 * - Auto-clears stale at-risk persisted alerts if the student recovered above threshold
 */
export async function evaluateAndRecordStudentAlert(params: {
  studentId: string;
  studentName: string;
  classroomId: string;
  classroomTitle: string;
  classroomSchedule?: string;
  classroomRoom?: string;
  classroomColor?: string;
  cumulativeAverage: number;
  quizScorePercentage: number;
  previousAverage?: number;
  rawScore?: number;
  maxScore?: number;
  quizTitle?: string;
}): Promise<RosterAlert | null> {
  const prefs = await getAlertPreferences();
  const avg = Math.round(params.cumulativeAverage);
  const quizPct = Math.round(params.quizScorePercentage);
  const prevAvg =
    typeof params.previousAverage === "number" && params.previousAverage > 0
      ? Math.round(params.previousAverage)
      : undefined;

  // 1. Check cumulative average against configured threshold
  if (avg <= prefs.atRiskThreshold) {
    const severity: AlertSeverity =
      avg <= getCriticalCutoff(prefs.atRiskThreshold)
        ? "HIGH RISK"
        : "URGENT REVIEW";

    const alertPayload: Omit<RosterAlert, "id" | "createdAt" | "timeLabel"> = {
      studentId: params.studentId,
      studentName: params.studentName,
      classroomId: params.classroomId,
      classroomTitle: params.classroomTitle || "Classroom",
      classroomSchedule: params.classroomSchedule || "",
      classroomRoom: params.classroomRoom || "",
      classroomColor: params.classroomColor || "#EA580C",
      scorePercentage: avg,
      quizScorePercentage: quizPct,
      previousAverage: prevAvg,
      rawScore: params.rawScore,
      maxScore: params.maxScore,
      quizTitle: params.quizTitle,
      alertType: severity,
      message: buildAlertMessage({
        studentName: params.studentName,
        alertType: severity,
        scorePercentage: avg,
        quizScorePercentage: quizPct,
        previousAverage: prevAvg,
        quizTitle: params.quizTitle,
      }),
    };

    return saveRosterAlert(alertPayload);
  }

  // 2. Check sudden score drop (even if cumulative average is still above at-risk threshold)
  if (
    prefs.enableScoreDropAlerts &&
    prevAvg !== undefined &&
    prevAvg >= 60 &&
    quizPct < PASSING_GRADE &&
    prevAvg - quizPct >= SCORE_DROP_MIN_DELTA
  ) {
    const alertPayload: Omit<RosterAlert, "id" | "createdAt" | "timeLabel"> = {
      studentId: params.studentId,
      studentName: params.studentName,
      classroomId: params.classroomId,
      classroomTitle: params.classroomTitle || "Classroom",
      classroomSchedule: params.classroomSchedule || "",
      classroomRoom: params.classroomRoom || "",
      classroomColor: params.classroomColor || "#EA580C",
      scorePercentage: avg,
      quizScorePercentage: quizPct,
      previousAverage: prevAvg,
      rawScore: params.rawScore,
      maxScore: params.maxScore,
      quizTitle: params.quizTitle,
      alertType: "SCORE DROP",
      message: buildAlertMessage({
        studentName: params.studentName,
        alertType: "SCORE DROP",
        scorePercentage: avg,
        quizScorePercentage: quizPct,
        previousAverage: prevAvg,
        quizTitle: params.quizTitle,
      }),
    };

    return saveRosterAlert(alertPayload);
  }

  // 3. Student recovered above threshold with no score drop — clear any stale persisted alert
  await deleteStudentAlerts(params.studentId);
  return null;
}

// ── Cleared / Dismissed Snapshots & Read State ────────────────────────────────

/**
 * Retrieves legacy IDs of alerts that the teacher has dismissed/cleared.
 */
export async function getClearedAlertIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CLEARED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getDismissedSnapshots(): Promise<
  Record<string, DismissedAlertSnapshot>
> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Marks alert IDs as cleared/dismissed (legacy-compatible).
 */
export async function markAlertsCleared(alertIds: string[]): Promise<void> {
  try {
    const existing = await getClearedAlertIds();
    const merged = Array.from(new Set([...existing, ...alertIds]));
    await AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error("Failed to clear alerts:", err);
  }
}

/**
 * Dismisses a single alert cleanly, storing the student's score snapshot so that
 * if their performance worsens later, the alert automatically re-triggers.
 */
export async function dismissSingleAlert(alert: RosterAlert): Promise<void> {
  try {
    const [cleared, snapshots] = await Promise.all([
      getClearedAlertIds(),
      getDismissedSnapshots(),
    ]);
    const nextCleared = Array.from(
      new Set([...cleared, alert.id, alert.studentId, `flag_${alert.studentId}`])
    );
    snapshots[alert.studentId] = {
      score: Math.round(alert.scorePercentage),
      dismissedAt: new Date().toISOString(),
      alertType: alert.alertType,
    };
    await Promise.all([
      AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(nextCleared)),
      AsyncStorage.setItem(DISMISSED_SNAPSHOTS_KEY, JSON.stringify(snapshots)),
    ]);
  } catch (err) {
    console.error("Failed to dismiss alert:", err);
  }
}

/**
 * Restores one or more previously dismissed alerts (supports Undo and Restore Dismissed).
 */
export async function restoreDismissedAlerts(
  alertsToRestore: RosterAlert[]
): Promise<void> {
  if (!alertsToRestore || alertsToRestore.length === 0) return;
  try {
    const [cleared, snapshots] = await Promise.all([
      getClearedAlertIds(),
      getDismissedSnapshots(),
    ]);
    const idsToRemove = new Set<string>();
    for (const a of alertsToRestore) {
      idsToRemove.add(a.id);
      idsToRemove.add(a.studentId);
      idsToRemove.add(`flag_${a.studentId}`);
      delete snapshots[a.studentId];
    }
    const nextCleared = cleared.filter((id) => !idsToRemove.has(id));
    await Promise.all([
      AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(nextCleared)),
      AsyncStorage.setItem(DISMISSED_SNAPSHOTS_KEY, JSON.stringify(snapshots)),
    ]);
  } catch (err) {
    console.error("Failed to restore dismissed alerts:", err);
  }
}

/**
 * Resets all dismissed alerts globally (e.g. from Settings).
 */
export async function resetAllDismissedAlerts(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(CLEARED_KEY),
      AsyncStorage.removeItem(DISMISSED_SNAPSHOTS_KEY),
    ]);
  } catch (err) {
    console.error("Failed to reset dismissed alerts:", err);
  }
}

/**
 * Retrieves IDs of alerts that the teacher has viewed/read.
 */
export async function getReadAlertIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Marks alert IDs as read.
 */
export async function markAlertsAsRead(alertIds: string[]): Promise<void> {
  try {
    if (!alertIds || alertIds.length === 0) return;
    const existing = await getReadAlertIds();
    const merged = Array.from(new Set([...existing, ...alertIds]));
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error("Failed to mark alerts as read:", err);
  }
}

/**
 * Marks all provided alerts as read without dismissing them from the list.
 */
export async function markAllAlertsAsRead(alerts: RosterAlert[]): Promise<void> {
  if (!alerts || alerts.length === 0) return;
  const ids: string[] = [];
  for (const a of alerts) {
    ids.push(a.id, a.studentId, `flag_${a.studentId}`, `alert_${a.studentId}`);
  }
  await markAlertsAsRead(ids);
}

/**
 * Clears/dismisses all provided active alerts (recording snapshots for smart re-trigger & undo).
 */
export async function clearAllAlerts(currentAlerts: RosterAlert[]): Promise<void> {
  if (!currentAlerts || currentAlerts.length === 0) return;
  try {
    const [cleared, snapshots] = await Promise.all([
      getClearedAlertIds(),
      getDismissedSnapshots(),
    ]);
    const nextIds = new Set<string>(cleared);
    const nowIso = new Date().toISOString();
    for (const a of currentAlerts) {
      nextIds.add(a.id);
      nextIds.add(a.studentId);
      nextIds.add(`flag_${a.studentId}`);
      snapshots[a.studentId] = {
        score: Math.round(a.scorePercentage),
        dismissedAt: nowIso,
        alertType: a.alertType,
      };
    }
    await Promise.all([
      AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(Array.from(nextIds))),
      AsyncStorage.setItem(DISMISSED_SNAPSHOTS_KEY, JSON.stringify(snapshots)),
    ]);
  } catch (err) {
    console.error("Failed to clear all alerts:", err);
  }
}

// ── Unified Deterministic Reconciliation Engine ───────────────────────────────

function shouldResurfaceDismissedAlert(
  snapshot: DismissedAlertSnapshot | undefined,
  currentScore: number,
  currentType: AlertSeverity
): boolean {
  if (!snapshot) return false;
  // Re-trigger automatically if the student's average dropped further by >= 3 pts
  if (Math.round(currentScore) <= snapshot.score - 3) return true;
  // Or escalated from a lower severity to HIGH RISK
  if (
    currentType === "HIGH RISK" &&
    snapshot.alertType &&
    snapshot.alertType !== "HIGH RISK"
  ) {
    return true;
  }
  return false;
}

export function sortAlertsByPriority(alerts: RosterAlert[]): RosterAlert[] {
  return [...alerts].sort((a, b) => {
    // 1. Unread before read
    const readDiff = Number(Boolean(a.isRead)) - Number(Boolean(b.isRead));
    if (readDiff !== 0) return readDiff;
    // 2. Severity tier (Critical -> At-Risk -> Score Drop -> Needs Support)
    const sevDiff =
      (SEVERITY_PRIORITY[a.alertType] ?? 9) -
      (SEVERITY_PRIORITY[b.alertType] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    // 3. Lowest score first (most urgent student at top)
    const scoreDiff = a.scorePercentage - b.scorePercentage;
    if (scoreDiff !== 0) return scoreDiff;
    // 4. Most recent first
    const timeA = new Date(a.createdAt || 0).getTime() || 0;
    const timeB = new Date(b.createdAt || 0).getTime() || 0;
    return timeB - timeA;
  });
}

/**
 * Pure + storage-backed reconciler used by both Homepage and Classroom screens.
 * Eliminates stale alerts after student improvement, syncs live names/averages/timestamps,
 * applies teacher threshold preferences, separates dismissed alerts for recovery, and sorts by urgency.
 */
export async function buildReconciledAlerts(params: {
  students: ReconcileStudentInput[];
  classrooms: ReconcileClassroomInput[];
  classroomIdFilter?: string;
  latestQuizByStudent?: Record<string, StudentQuizSnapshot>;
  preferencesOverride?: AlertPreferences;
}): Promise<ReconciledAlertsResult> {
  const {
    students,
    classrooms,
    classroomIdFilter,
    latestQuizByStudent = {},
    preferencesOverride,
  } = params;

  const [persisted, clearedIds, readIds, dismissedSnapshots, loadedPrefs] =
    await Promise.all([
      getPersistedAlerts(),
      getClearedAlertIds(),
      getReadAlertIds(),
      getDismissedSnapshots(),
      preferencesOverride
        ? Promise.resolve(preferencesOverride)
        : getAlertPreferences(),
    ]);

  const prefs = preferencesOverride || loadedPrefs;
  const classroomMap = new Map<string, ReconcileClassroomInput>();
  for (const c of classrooms) {
    classroomMap.set(c.id, c);
  }

  const studentMap = new Map<string, ReconcileStudentInput>();
  for (const s of students) {
    if (!classroomIdFilter || s.classroom_id === classroomIdFilter) {
      studentMap.set(s.id, s);
    }
  }

  const persistedByStudent = new Map<string, RosterAlert>();
  const stalePersistedIds = new Set<string>();

  for (const p of persisted) {
    if (classroomIdFilter && p.classroomId !== classroomIdFilter) continue;
    if (!classroomMap.has(p.classroomId)) continue;

    const liveStudent = studentMap.get(p.studentId);
    if (liveStudent) {
      const liveAvg = liveStudent.average ?? 0;
      const hasQuiz = Boolean(latestQuizByStudent[liveStudent.id]);
      const isNoGrades = liveAvg === 0 && !hasQuiz;
      const severityForLive = isNoGrades
        ? null
        : classifyScoreSeverity(liveAvg, prefs);

      const isActiveScoreDrop =
        p.alertType === "SCORE DROP" &&
        prefs.enableScoreDropAlerts &&
        !isNoGrades &&
        liveAvg < 85 &&
        // Expire score-drop notifications after 14 days
        Date.now() - (new Date(p.createdAt).getTime() || 0) <=
          14 * 24 * 60 * 60 * 1000;

      if (!severityForLive && !isActiveScoreDrop) {
        // Student has recovered or had grades deleted — mark persisted alert stale
        stalePersistedIds.add(p.id);
        continue;
      }
    } else if (students.length > 0) {
      // Student was removed from this roster — ignore stale persisted alert
      stalePersistedIds.add(p.id);
      continue;
    }

    persistedByStudent.set(p.studentId, p);
  }

  // Silently prune resolved/stale alerts from storage so they never come back
  if (stalePersistedIds.size > 0) {
    const cleaned = persisted.filter((p) => !stalePersistedIds.has(p.id));
    setPersistedAlerts(cleaned).catch(() => {});
  }

  const activeAlerts: RosterAlert[] = [];
  const dismissedAlerts: RosterAlert[] = [];
  const flaggedCountsByClassroom: Record<string, number> = {};
  const handledStudentIds = new Set<string>();

  // 1. Evaluate every live student in roster
  for (const s of studentMap.values()) {
    const liveAvgRaw = s.average;
    const quizSnap = latestQuizByStudent[s.id];
    const hasGradedRecord = Boolean(quizSnap);

    // Skip newly enrolled students who have average 0 and zero graded quizzes
    if (
      liveAvgRaw === null ||
      liveAvgRaw === undefined ||
      (liveAvgRaw === 0 && !hasGradedRecord)
    ) {
      continue;
    }

    const liveAvg = Math.round(liveAvgRaw);
    const persistedForStudent = persistedByStudent.get(s.id);

    // Determine effective severity (cumulative average tier takes precedence over score drop)
    let severity = classifyScoreSeverity(liveAvg, prefs);
    if (
      !severity &&
      persistedForStudent?.alertType === "SCORE DROP" &&
      prefs.enableScoreDropAlerts
    ) {
      severity = "SCORE DROP";
    }

    if (!severity) continue;

    // Count true at-risk students (<= configured threshold) per classroom for card badges
    if (liveAvg <= prefs.atRiskThreshold) {
      flaggedCountsByClassroom[s.classroom_id] =
        (flaggedCountsByClassroom[s.classroom_id] || 0) + 1;
    }

    const c = classroomMap.get(s.classroom_id);
    if (!c) continue;

    handledStudentIds.add(s.id);

    const alertId = persistedForStudent?.id || `flag_${s.id}`;
    const createdAt =
      persistedForStudent?.createdAt ||
      quizSnap?.gradedAt ||
      new Date().toISOString();

    const quizTitle = quizSnap?.quizTitle || persistedForStudent?.quizTitle;
    const quizScorePercentage =
      quizSnap?.scorePercentage !== undefined
        ? Math.round(quizSnap.scorePercentage)
        : persistedForStudent?.quizScorePercentage;
    const rawScore = quizSnap?.totalScore ?? persistedForStudent?.rawScore;
    const maxScore = quizSnap?.maxScore ?? persistedForStudent?.maxScore;
    const quizCount = quizSnap?.quizCount ?? persistedForStudent?.quizCount;
    const previousAverage = persistedForStudent?.previousAverage;

    const studentName = s.full_name || persistedForStudent?.studentName || "Student";
    const isRead =
      readIds.includes(alertId) ||
      readIds.includes(s.id) ||
      readIds.includes(`flag_${s.id}`) ||
      readIds.includes(`alert_${s.id}`);

    const alertObj: RosterAlert = {
      id: alertId,
      studentId: s.id,
      studentName,
      classroomId: s.classroom_id,
      classroomTitle: c.title || persistedForStudent?.classroomTitle || "Classroom",
      classroomSchedule:
        c.schedule ||
        c.subject ||
        persistedForStudent?.classroomSchedule ||
        "",
      classroomRoom: c.room || c.section || persistedForStudent?.classroomRoom || "",
      classroomColor: c.color || persistedForStudent?.classroomColor || "#EA580C",
      scorePercentage: liveAvg,
      quizScorePercentage,
      previousAverage,
      rawScore,
      maxScore,
      quizCount,
      quizTitle,
      alertType: severity,
      message: buildAlertMessage({
        studentName,
        alertType: severity,
        scorePercentage: liveAvg,
        quizScorePercentage,
        previousAverage,
        quizTitle,
      }),
      createdAt,
      timeLabel: formatAlertTimeLabel(createdAt, "Today"),
      isRead,
    };

    const isCleared =
      clearedIds.includes(alertId) ||
      clearedIds.includes(s.id) ||
      clearedIds.includes(`flag_${s.id}`);
    const snapshot = dismissedSnapshots[s.id];

    if (isCleared && !shouldResurfaceDismissedAlert(snapshot, liveAvg, severity)) {
      dismissedAlerts.push(alertObj);
    } else {
      activeAlerts.push(alertObj);
    }
  }

  // 2. Include any persisted alerts whose student wasn't in `students` only if `students` wasn't loaded (offline fallback)
  if (students.length === 0) {
    for (const p of persistedByStudent.values()) {
      if (handledStudentIds.has(p.studentId)) continue;
      const c = classroomMap.get(p.classroomId);
      if (!c) continue;
      const isRead =
        readIds.includes(p.id) ||
        readIds.includes(p.studentId) ||
        readIds.includes(`flag_${p.studentId}`) ||
        readIds.includes(`alert_${p.studentId}`);
      const hydrated: RosterAlert = {
        ...p,
        classroomTitle: c.title || p.classroomTitle,
        classroomColor: c.color || p.classroomColor,
        timeLabel: formatAlertTimeLabel(p.createdAt, p.timeLabel || "Today"),
        isRead,
      };
      const isCleared =
        clearedIds.includes(p.id) ||
        clearedIds.includes(p.studentId) ||
        clearedIds.includes(`flag_${p.studentId}`);
      if (isCleared) {
        dismissedAlerts.push(hydrated);
      } else {
        activeAlerts.push(hydrated);
        if (hydrated.scorePercentage <= prefs.atRiskThreshold) {
          flaggedCountsByClassroom[hydrated.classroomId] =
            (flaggedCountsByClassroom[hydrated.classroomId] || 0) + 1;
        }
      }
    }
  }

  const sortedActive = sortAlertsByPriority(activeAlerts);
  const sortedDismissed = sortAlertsByPriority(dismissedAlerts);

  return {
    activeAlerts: sortedActive,
    dismissedAlerts: sortedDismissed,
    unreadCount: sortedActive.filter((a) => !a.isRead).length,
    flaggedCountsByClassroom,
    preferences: prefs,
  };
}

/**
 * Retrieves active alerts specifically for a classroom (legacy helper kept compatible).
 */
export async function getClassroomAlerts(
  classroomId: string
): Promise<RosterAlert[]> {
  try {
    const [persisted, clearedIds, readIds] = await Promise.all([
      getPersistedAlerts(),
      getClearedAlertIds(),
      getReadAlertIds(),
    ]);

    return sortAlertsByPriority(
      persisted
        .filter(
          (a) =>
            a.classroomId === classroomId &&
            !clearedIds.includes(a.id) &&
            !clearedIds.includes(a.studentId)
        )
        .map((a) => ({
          ...a,
          timeLabel: formatAlertTimeLabel(a.createdAt, a.timeLabel || "Today"),
          isRead:
            readIds.includes(a.id) ||
            readIds.includes(a.studentId) ||
            readIds.includes(`flag_${a.studentId}`),
        }))
    );
  } catch (err) {
    console.error("Failed to load classroom alerts:", err);
    return [];
  }
}

/**
 * Permanently deletes all alerts associated with a classroom.
 */
export async function deleteClassroomAlerts(classroomId: string): Promise<void> {
  try {
    const existing = await getPersistedAlerts();
    const remaining = existing.filter((a) => a.classroomId !== classroomId);
    await setPersistedAlerts(remaining);
  } catch (err) {
    console.error("Failed to delete classroom alerts:", err);
  }
}

/**
 * Permanently deletes all alerts associated with a student.
 */
export async function deleteStudentAlerts(studentId: string): Promise<void> {
  try {
    const existing = await getPersistedAlerts();
    const remaining = existing.filter((a) => a.studentId !== studentId);
    await setPersistedAlerts(remaining);
  } catch (err) {
    console.error("Failed to delete student alerts:", err);
  }
}
