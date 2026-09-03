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
