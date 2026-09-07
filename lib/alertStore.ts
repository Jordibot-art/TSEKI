import AsyncStorage from "@react-native-async-storage/async-storage";

export interface RosterAlert {
  id: string;
  studentId: string;
  studentName: string;
  classroomId: string;
  classroomTitle: string;
  classroomSchedule: string;
  classroomRoom: string;
  classroomColor: string;
  scorePercentage: number;
  quizTitle?: string;
  alertType: "HIGH RISK" | "URGENT REVIEW";
  message: string;
  createdAt: string;
  timeLabel: string;
  isRead?: boolean;
}

const ALERTS_STORAGE_KEY = "tseki_roster_alerts";
const CLEARED_KEY = "tseki_cleared_alert_ids";
const READ_KEY = "tseki_read_alert_ids";

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

/**
 * Saves a new alert when a student is flagged at-risk.
 */
export async function saveRosterAlert(
  alert: Omit<RosterAlert, "id" | "createdAt" | "timeLabel">
): Promise<RosterAlert> {
  const newAlert: RosterAlert = {
    ...alert,
    id: `alert_${alert.studentId}_${Date.now()}`,
    createdAt: new Date().toISOString(),
    timeLabel: "Today",
    isRead: false,
  };

  try {
    const existing = await getPersistedAlerts();
    // Keep newest alert per student, removing older duplicate alerts for the same student
    const updated = [newAlert, ...existing.filter((a) => a.studentId !== alert.studentId)];
    await AsyncStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(updated));

    // Remove from cleared list if student was re-flagged
    const cleared = await getClearedAlertIds();
    const updatedCleared = cleared.filter((id) => id !== newAlert.id && id !== alert.studentId);
    await AsyncStorage.setItem(CLEARED_KEY, JSON.stringify(updatedCleared));

    // Remove from read list so the newly triggered alert is marked unread
    const read = await getReadAlertIds();
    const updatedRead = read.filter(
      (id) => id !== newAlert.id && id !== alert.studentId && id !== `flag_${alert.studentId}`
    );
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(updatedRead));

    return newAlert;
  } catch (err) {
    console.error("Failed to save alert:", err);
    return newAlert;
  }
}

/**
 * Retrieves IDs of alerts that the teacher has dismissed/cleared.
 */
export async function getClearedAlertIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CLEARED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Marks alerts as cleared/dismissed.
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
 * Clears all active alerts.
 */
export async function clearAllAlerts(currentAlerts: RosterAlert[]): Promise<void> {
  try {
    const ids = currentAlerts.map((a) => a.id);
    const studentIds = currentAlerts.map((a) => a.studentId);
    await markAlertsCleared([...ids, ...studentIds]);
  } catch (err) {
    console.error("Failed to clear all alerts:", err);
  }
}

/**
 * Retrieves active alerts specifically for a classroom.
 */
export async function getClassroomAlerts(classroomId: string): Promise<RosterAlert[]> {
  try {
    const [persisted, clearedIds, readIds] = await Promise.all([
      getPersistedAlerts(),
      getClearedAlertIds(),
      getReadAlertIds(),
    ]);

    return persisted
      .filter(
        (a) =>
          a.classroomId === classroomId &&
          !clearedIds.includes(a.id) &&
          !clearedIds.includes(a.studentId)
      )
      .map((a) => ({
        ...a,
        isRead:
          readIds.includes(a.id) ||
          readIds.includes(a.studentId) ||
          readIds.includes(`flag_${a.studentId}`),
      }));
  } catch (err) {
    console.error("Failed to load classroom alerts:", err);
    return [];
  }
}
