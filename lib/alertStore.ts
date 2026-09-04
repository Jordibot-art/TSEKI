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
}

const ALERTS_STORAGE_KEY = "tseki_roster_alerts";
const CLEARED_KEY = "tseki_cleared_alert_ids";

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
