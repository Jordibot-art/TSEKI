import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeneratedAssessment } from "./quizGeneratorService";
import { supabase } from "../supabase";

export interface StoredQuiz extends GeneratedAssessment {
    id: string;
    classroomId: string;
    classTitle?: string;
    subject?: string;
    difficulty?: string;
    questionType?: string;
    gradeLevel?: string;
    createdAt: string;
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVE";
    updatedAt?: string;
}

const STORAGE_PREFIX = "tseki_quizzes_";
const DRAFT_PREFIX = "tseki_drafts_";

/**
 * Saves a published assessment to local storage associated with the classroom.
 * If a matching draft exists, it will be automatically removed from drafts.
 */
export async function savePublishedQuiz(
    classroomId: string,
    assessment: GeneratedAssessment,
    classTitle?: string
): Promise<StoredQuiz> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    const quizId = (assessment as any).id || `quiz_${Date.now()}`;
    const newQuiz: StoredQuiz = {
        ...assessment,
        id: quizId,
        classroomId,
        classTitle: classTitle || (assessment as any).classTitle,
        createdAt: (assessment as any).createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "ARCHIVE",
    };

    try {
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];
        // Put newest first, replacing duplicate titles or matching IDs
        const updated = [
            newQuiz,
            ...existing.filter((q) => q.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase() && q.id !== quizId),
        ];
        await AsyncStorage.setItem(key, JSON.stringify(updated));

        // Also purge from drafts if it was previously saved as draft
        try {
            const draftKey = `${DRAFT_PREFIX}${classroomId}`;
            const draftJson = await AsyncStorage.getItem(draftKey);
            if (draftJson) {
                const drafts: StoredQuiz[] = JSON.parse(draftJson);
                const remaining = drafts.filter(
                    (d) => d.id !== quizId && d.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase()
                );
                await AsyncStorage.setItem(draftKey, JSON.stringify(remaining));
            }
        } catch (draftErr) {
            console.warn("Could not clean matching draft on publish:", draftErr);
        }

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

/**
 * Saves an assessment as a DRAFT associated with the classroom.
 */
export async function saveDraftQuiz(
    classroomId: string,
    assessment: GeneratedAssessment,
    classTitle?: string
): Promise<StoredQuiz> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    const draftId = (assessment as any).id || `draft_${Date.now()}`;
    const draftQuiz: StoredQuiz = {
        ...assessment,
        id: draftId,
        classroomId,
        classTitle: classTitle || (assessment as any).classTitle,
        createdAt: (assessment as any).createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "DRAFT",
    };

    try {
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];
        const updated = [
            draftQuiz,
            ...existing.filter(
                (q) => q.id !== draftId && q.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase()
            ),
        ];
        await AsyncStorage.setItem(key, JSON.stringify(updated));
        return draftQuiz;
    } catch (err) {
        console.error("Failed to save draft to storage:", err);
        return draftQuiz;
    }
}

/**
 * Retrieves all draft assessments for a given classroom.
 */
export async function getDraftQuizzes(classroomId: string): Promise<StoredQuiz[]> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            return JSON.parse(json);
        }
    } catch (err) {
        console.error("Failed to load drafts from storage:", err);
    }
    return [];
}

/**
 * Deletes a draft assessment by ID.
 */
export async function deleteDraftQuiz(classroomId: string, quizId: string): Promise<boolean> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            const drafts: StoredQuiz[] = JSON.parse(json);
            const filtered = drafts.filter((d) => d.id !== quizId);
            await AsyncStorage.setItem(key, JSON.stringify(filtered));
            return true;
        }
    } catch (err) {
        console.error("Failed to delete draft quiz:", err);
    }
    return false;
}

/**
 * Deletes an archived / published assessment by ID.
 */
export async function deletePublishedQuiz(classroomId: string, quizId: string): Promise<boolean> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            const quizzes: StoredQuiz[] = JSON.parse(json);
            const filtered = quizzes.filter((q) => q.id !== quizId);
            await AsyncStorage.setItem(key, JSON.stringify(filtered));
            return true;
        }
    } catch (err) {
        console.error("Failed to delete published quiz:", err);
    }
    return false;
}

/**
 * Publishes an existing draft assessment, moving it to published / archive.
 */
export async function publishDraftQuiz(classroomId: string, draftId: string): Promise<StoredQuiz | null> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (!json) return null;
        const drafts: StoredQuiz[] = JSON.parse(json);
        const draft = drafts.find((d) => d.id === draftId);
        if (!draft) return null;

        const published = await savePublishedQuiz(classroomId, draft, draft.classTitle);
        const remaining = drafts.filter((d) => d.id !== draftId);
        await AsyncStorage.setItem(key, JSON.stringify(remaining));
        return published;
    } catch (err) {
        console.error("Failed to publish draft quiz:", err);
        return null;
    }
}

/**
 * Retrieves all draft assessments across ALL classrooms.
 */
export async function getAllDraftQuizzes(): Promise<StoredQuiz[]> {
    try {
        const allKeys = await AsyncStorage.getAllKeys();
        const draftKeys = allKeys.filter((k) => k.startsWith(DRAFT_PREFIX));
        if (draftKeys.length === 0) return [];
        const pairs = await AsyncStorage.multiGet(draftKeys);
        const allDrafts: StoredQuiz[] = [];
        for (const [, val] of pairs) {
            if (val) {
                try {
                    const parsed: StoredQuiz[] = JSON.parse(val);
                    if (Array.isArray(parsed)) {
                        allDrafts.push(...parsed);
                    }
                } catch { }
            }
        }
        return allDrafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
        console.error("Failed to get all draft quizzes:", err);
        return [];
    }
}

/**
 * Retrieves all published assessments across ALL classrooms (Archive).
 */
export async function getAllPublishedQuizzes(): Promise<StoredQuiz[]> {
    try {
        const allKeys = await AsyncStorage.getAllKeys();
        const pubKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
        if (pubKeys.length === 0) return [];
        const pairs = await AsyncStorage.multiGet(pubKeys);
        const allPublished: StoredQuiz[] = [];
        for (const [, val] of pairs) {
            if (val) {
                try {
                    const parsed: StoredQuiz[] = JSON.parse(val);
                    if (Array.isArray(parsed)) {
                        allPublished.push(...parsed);
                    }
                } catch { }
            }
        }
        return allPublished.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err) {
        console.error("Failed to get all published quizzes:", err);
        return [];
    }
}

/**
 * Enriches a list of quizzes by filling in any missing classroom titles from Supabase.
 */
export async function enrichQuizzesWithClassrooms(quizzes: StoredQuiz[]): Promise<StoredQuiz[]> {
    const missingClassroomIds = Array.from(
        new Set(quizzes.filter((q) => !q.classTitle && q.classroomId).map((q) => q.classroomId))
    );
    if (missingClassroomIds.length === 0) return quizzes;

    try {
        const { data, error } = await supabase
            .from("classrooms")
            .select("id, title")
            .in("id", missingClassroomIds);

        if (!error && data) {
            const map = new Map(data.map((c: any) => [c.id, c.title]));
            return quizzes.map((q) => ({
                ...q,
                classTitle: q.classTitle || map.get(q.classroomId) || "Classroom Assessment",
            }));
        }
    } catch (err) {
        console.warn("Could not enrich quizzes with classroom titles:", err);
    }

    return quizzes.map((q) => ({
        ...q,
        classTitle: q.classTitle || "Classroom Assessment",
    }));
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

/**
 * Deletes all stored quizzes, drafts, and performance records for a classroom.
 */
export async function deleteClassroomQuizzes(classroomId: string): Promise<void> {
    try {
        await Promise.all([
            AsyncStorage.removeItem(`${STORAGE_PREFIX}${classroomId}`),
            AsyncStorage.removeItem(`${DRAFT_PREFIX}${classroomId}`),
            AsyncStorage.removeItem(`tseki_perf_${classroomId}`),
        ]);
    } catch (err) {
        console.error("Failed to delete classroom quizzes:", err);
    }
}
