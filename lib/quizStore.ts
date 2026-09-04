import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeneratedAssessment } from "./quizGeneratorService";

export interface StoredQuiz extends GeneratedAssessment {
    id: string;
    classroomId: string;
    createdAt: string;
}

const STORAGE_PREFIX = "tseki_quizzes_";

/**
 * Saves a published assessment to local storage associated with the classroom.
 */
export async function savePublishedQuiz(
    classroomId: string,
    assessment: GeneratedAssessment
): Promise<StoredQuiz> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    const newQuiz: StoredQuiz = {
        ...assessment,
        id: `quiz_${Date.now()}`,
        classroomId,
        createdAt: new Date().toISOString(),
    };

    try {
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];
        // Put newest first, replacing duplicate titles if republished
        const updated = [newQuiz, ...existing.filter((q) => q.quizTitle !== assessment.quizTitle)];
        await AsyncStorage.setItem(key, JSON.stringify(updated));
        return newQuiz;
    } catch (err) {
        console.error("Failed to save quiz to storage:", err);
        return newQuiz;
    }
}

/**
 * Retrieves all published assessments for a given classroom.
 */
export async function getPublishedQuizzes(classroomId: string): Promise<StoredQuiz[]> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            return JSON.parse(json);
        }
    } catch (err) {
        console.error("Failed to load quizzes from storage:", err);
    }
    return [];
}

// ── Quiz Performance Tracking ──────────────────────────────────────────────────
export interface QuizPerformanceRecord {
    id: string;
    classroomId: string;
    quizTitle: string;
    averageScore: number;
    totalSubmissions: number;
    highestScore: number;
    lowestScore: number;
    createdAt: string;
}

const PERF_STORAGE_PREFIX = "tseki_quiz_perf_";

/**
 * Retrieves all recorded quiz performance entries for a classroom.
 */
export async function getQuizPerformanceRecords(classroomId: string): Promise<QuizPerformanceRecord[]> {
    const key = `${PERF_STORAGE_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            return JSON.parse(json);
        }
    } catch (err) {
        console.error("Failed to load quiz performance records:", err);
    }
    return [];
}

/**
 * Records or updates performance stats for a quiz in a classroom when graded.
 */
export async function saveQuizPerformanceRecord(
    classroomId: string,
    quizTitle: string,
    scorePercentage: number
): Promise<QuizPerformanceRecord[]> {
    const key = `${PERF_STORAGE_PREFIX}${classroomId}`;
    try {
        const existing = await getQuizPerformanceRecords(classroomId);
        const existingIndex = existing.findIndex((r) => r.quizTitle === quizTitle);

        let updated: QuizPerformanceRecord[];
        if (existingIndex >= 0) {
            const current = existing[existingIndex];
            const newTotal = current.totalSubmissions + 1;
            const newAvg = Math.round((current.averageScore * current.totalSubmissions + scorePercentage) / newTotal);
            const updatedItem: QuizPerformanceRecord = {
                ...current,
                averageScore: newAvg,
                totalSubmissions: newTotal,
                highestScore: Math.max(current.highestScore ?? scorePercentage, scorePercentage),
                lowestScore: Math.min(current.lowestScore ?? scorePercentage, scorePercentage),
            };
            updated = [...existing];
            updated[existingIndex] = updatedItem;
        } else {
            const newRecord: QuizPerformanceRecord = {
                id: `perf_${Date.now()}`,
                classroomId,
                quizTitle,
                averageScore: scorePercentage,
                totalSubmissions: 1,
                highestScore: scorePercentage,
                lowestScore: scorePercentage,
                createdAt: new Date().toISOString(),
            };
            updated = [...existing, newRecord];
        }

        await AsyncStorage.setItem(key, JSON.stringify(updated));
        return updated;
    } catch (err) {
        console.error("Failed to save quiz performance record:", err);
        return [];
    }
}
