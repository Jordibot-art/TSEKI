import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeneratedAssessment } from "./quizGeneratorService";
import { supabase } from "../supabase";

export interface StoredQuiz extends GeneratedAssessment {
    id: string;
    classroomId: string;
    teacherId?: string;
    classTitle?: string;
    subject?: string;
    difficulty?: string;
    questionType?: string;
    gradeLevel?: string;
    createdAt: string;
    expiresAt?: string; // For drafts: exactly 7 days after creation
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVE";
    updatedAt?: string;
    isCloudSynced?: boolean;
}

const STORAGE_PREFIX = "tseki_quizzes_";
const DRAFT_PREFIX = "tseki_drafts_";

// ── 7-Day Draft Lifespan (Instagram-Style Auto-Expiry) ─────────────────────────
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Checks whether a draft assessment has passed its 7-day lifespan.
 */
export function isDraftExpired(draft: StoredQuiz): boolean {
    const createdTime = new Date(draft.createdAt || 0).getTime();
    if (!createdTime || isNaN(createdTime)) return false;
    return Date.now() - createdTime >= DRAFT_TTL_MS;
}

/**
 * Computes remaining time for a draft in an Instagram-like countdown badge.
 */
export function getDraftTimeRemaining(draft: StoredQuiz): {
    text: string;
    isExpiringSoon: boolean;
    daysRemaining: number;
} {
    const createdTime = new Date(draft.createdAt || 0).getTime();
    const expiryTime = createdTime + DRAFT_TTL_MS;
    const remainingMs = Math.max(0, expiryTime - Date.now());
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingDays = Math.floor(remainingHours / 24);

    if (remainingDays >= 1) {
        return {
            text: `${remainingDays}d left`,
            isExpiringSoon: remainingDays <= 2,
            daysRemaining: remainingDays,
        };
    }
    if (remainingHours >= 1) {
        return {
            text: `${remainingHours}h left`,
            isExpiringSoon: true,
            daysRemaining: 0,
        };
    }
    const remainingMins = Math.max(1, Math.floor(remainingMs / (1000 * 60)));
    return {
        text: `${remainingMins}m left`,
        isExpiringSoon: true,
        daysRemaining: 0,
    };
}

// ── Database Mapping Helpers ──────────────────────────────────────────────────
function mapDbRowToStoredQuiz(row: any): StoredQuiz {
    return {
        id: row.id,
        classroomId: row.classroom_id,
        teacherId: row.teacher_id,
        classTitle: row.class_title,
        quizTitle: row.quiz_title,
        subject: row.subject,
        difficulty: row.difficulty,
        questionType: row.question_type,
        gradeLevel: row.grade_level,
        questions: Array.isArray(row.questions) ? row.questions : [],
        answerKey: Array.isArray(row.answer_key) ? row.answer_key : [],
        status: "ARCHIVE",
        createdAt: row.created_at || new Date().toISOString(),
        updatedAt: row.updated_at || new Date().toISOString(),
        isCloudSynced: true,
    };
}

function mapStoredQuizToDbPayload(quiz: StoredQuiz, teacherId: string): any {
    return {
        id: quiz.id,
        teacher_id: teacherId,
        classroom_id: quiz.classroomId || null,
        class_title: quiz.classTitle || null,
        quiz_title: quiz.quizTitle,
        subject: quiz.subject || null,
        difficulty: quiz.difficulty || null,
        question_type: quiz.questionType || null,
        grade_level: quiz.gradeLevel || null,
        questions: quiz.questions || [],
        answer_key: quiz.answerKey || [],
        status: "ARCHIVE",
        updated_at: new Date().toISOString(),
    };
}

// ── Published & Cloud Archive Store ───────────────────────────────────────────

/**
 * Saves a published assessment to the Supabase database (cloud archive)
 * and caches it in local storage.
 * If a matching draft exists on this device, it is automatically removed.
 */
export async function savePublishedQuiz(
    classroomId: string,
    assessment: GeneratedAssessment,
    classTitle?: string
): Promise<StoredQuiz> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    const quizId = (assessment as any).id || `quiz_${Date.now()}`;
    const nowIso = new Date().toISOString();

    let newQuiz: StoredQuiz = {
        ...assessment,
        id: quizId,
        classroomId,
        classTitle: classTitle || (assessment as any).classTitle,
        subject: (assessment as any).subject,
        difficulty: (assessment as any).difficulty,
        questionType: (assessment as any).questionType,
        gradeLevel: (assessment as any).gradeLevel,
        createdAt: (assessment as any).createdAt || nowIso,
        updatedAt: nowIso,
        status: "ARCHIVE",
        isCloudSynced: false,
    };

    // 1. Synchronize to Supabase Cloud Database (archived_assessments table)
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            newQuiz.teacherId = user.id;
            const dbPayload = mapStoredQuizToDbPayload(newQuiz, user.id);
            const { error: dbError } = await supabase
                .from("archived_assessments")
                .upsert(dbPayload);

            if (!dbError) {
                newQuiz.isCloudSynced = true;
            } else {
                console.warn("Could not save to Supabase archived_assessments:", dbError.message);
            }
        }
    } catch (dbErr) {
        console.warn("Database archive save error:", dbErr);
    }

    // 2. Cache in device storage for instant offline access
    try {
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];
        const updated = [
            newQuiz,
            ...existing.filter(
                (q) =>
                    q.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase() &&
                    q.id !== quizId
            ),
        ];
        await AsyncStorage.setItem(key, JSON.stringify(updated));

        // 3. Purge matching draft from local device cache
        try {
            const draftKey = `${DRAFT_PREFIX}${classroomId}`;
            const draftJson = await AsyncStorage.getItem(draftKey);
            if (draftJson) {
                const drafts: StoredQuiz[] = JSON.parse(draftJson);
                const remaining = drafts.filter(
                    (d) =>
                        d.id !== quizId &&
                        d.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase()
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
 * First queries Supabase cloud database to fetch cross-device archives;
 * falls back to local device storage if offline.
 */
export async function getPublishedQuizzes(classroomId: string): Promise<StoredQuiz[]> {
    const key = `${STORAGE_PREFIX}${classroomId}`;

    // 1. Attempt to fetch from Supabase Cloud Database
    try {
        const { data, error } = await supabase
            .from("archived_assessments")
            .select("*")
            .eq("classroom_id", classroomId)
            .order("created_at", { ascending: false });

        if (!error && data && data.length > 0) {
            const cloudQuizzes = data.map(mapDbRowToStoredQuiz);
            // Update local device cache with fresh cloud state
            await AsyncStorage.setItem(key, JSON.stringify(cloudQuizzes));
            return cloudQuizzes;
        }
    } catch (err) {
        console.warn("Could not fetch published quizzes from Supabase, using cache:", err);
    }

    // 2. Fallback to local device cache
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
 * Retrieves all published assessments across ALL classrooms (Global Archive).
 * Queries Supabase cloud database by teacher ID so when a teacher logs in from
 * any other device, their full archive is immediately accessible.
 */
export async function getAllPublishedQuizzes(): Promise<StoredQuiz[]> {
    // 1. Attempt to fetch cloud archives from Supabase
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data, error } = await supabase
                .from("archived_assessments")
                .select("*")
                .eq("teacher_id", user.id)
                .order("created_at", { ascending: false });

            if (!error && data) {
                const cloudList = data.map(mapDbRowToStoredQuiz);

                // Check local storage for any existing un-synced quizzes to back them up to Supabase
                const localKeys = await AsyncStorage.getAllKeys();
                const pubKeys = localKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
                if (pubKeys.length > 0) {
                    const pairs = await AsyncStorage.multiGet(pubKeys);
                    for (const [, val] of pairs) {
                        if (val) {
                            try {
                                const parsed: StoredQuiz[] = JSON.parse(val);
                                for (const localQuiz of parsed) {
                                    if (!cloudList.some((c) => c.id === localQuiz.id)) {
                                        // Upload local archive to Supabase
                                        supabase
                                            .from("archived_assessments")
                                            .upsert(mapStoredQuizToDbPayload(localQuiz, user.id))
                                            .then(() => { });
                                        cloudList.push({ ...localQuiz, isCloudSynced: true });
                                    }
                                }
                            } catch { }
                        }
                    }
                }

                return cloudList.sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
            }
        }
    } catch (cloudErr) {
        console.warn("Failed to fetch cloud archives from Supabase, reading local cache:", cloudErr);
    }

    // 2. Fallback to local storage
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
        return allPublished.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    } catch (err) {
        console.error("Failed to get all published quizzes:", err);
        return [];
    }
}

/**
 * Deletes an archived assessment by ID from both Supabase cloud database
 * and local device cache.
 */
export async function deletePublishedQuiz(classroomId: string, quizId: string): Promise<boolean> {
    // 1. Delete from Supabase cloud database
    try {
        await supabase
            .from("archived_assessments")
            .delete()
            .eq("id", quizId);
    } catch (dbErr) {
        console.warn("Could not delete from Supabase archived_assessments:", dbErr);
    }

    // 2. Delete from local device cache
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
        console.error("Failed to delete published quiz from local cache:", err);
    }
    return false;
}

/**
 * Shuffles questions in an assessment and aligns the answer key with the new question order.
 * Renumbers questions and answer key 1..N.
 */
export function shuffleAssessmentQuestions<T extends GeneratedAssessment>(assessment: T): T {
    if (!assessment || !Array.isArray(assessment.questions) || assessment.questions.length <= 1) {
        return assessment;
    }

    const questions = [...assessment.questions];
    const answerKey = Array.isArray(assessment.answerKey) ? [...assessment.answerKey] : [];

    // Pair each question with its matching answer key item using questionNumber
    const paired = questions.map((q) => {
        const answer = answerKey.find((a) => a.questionNumber === q.questionNumber);
        return {
            question: { ...q },
            answer: answer ? { ...answer } : null,
        };
    });

    // Fisher-Yates shuffle algorithm
    for (let i = paired.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [paired[i], paired[j]] = [paired[j], paired[i]];
    }

    // Renumber 1..N
    const newQuestions = paired.map((item, idx) => ({
        ...item.question,
        questionNumber: idx + 1,
    }));

    const newAnswerKey = paired.map((item, idx) => ({
        questionNumber: idx + 1,
        correctAnswer: item.answer ? item.answer.correctAnswer : "",
        points: item.answer?.points ?? 1,
    }));

    return {
        ...assessment,
        questions: newQuestions,
        answerKey: newAnswerKey,
    };
}

/**
 * Updates an existing published/archived assessment in both Supabase cloud database
 * and local device storage (e.g. after shuffling questions).
 */
export async function updatePublishedQuiz(
    classroomId: string,
    quizId: string,
    updates: Partial<StoredQuiz>
): Promise<StoredQuiz | null> {
    const key = `${STORAGE_PREFIX}${classroomId}`;
    const nowIso = new Date().toISOString();

    try {
        // 1. Fetch current local list
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];
        const index = existing.findIndex((q) => q.id === quizId);

        let targetQuiz: StoredQuiz;
        if (index !== -1) {
            targetQuiz = {
                ...existing[index],
                ...updates,
                updatedAt: nowIso,
            };
            existing[index] = targetQuiz;
            await AsyncStorage.setItem(key, JSON.stringify(existing));
        } else {
            targetQuiz = {
                id: quizId,
                classroomId,
                ...updates,
                updatedAt: nowIso,
            } as StoredQuiz;
        }

        // 2. Synchronize to Supabase Cloud Database
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                targetQuiz.teacherId = user.id;
                const dbPayload = mapStoredQuizToDbPayload(targetQuiz, user.id);
                const { error: dbError } = await supabase
                    .from("archived_assessments")
                    .upsert(dbPayload);

                if (dbError) {
                    console.warn("Could not update Supabase archived_assessments:", dbError.message);
                } else {
                    targetQuiz.isCloudSynced = true;
                }
            }
        } catch (dbErr) {
            console.warn("Database archive update error:", dbErr);
        }

        return targetQuiz;
    } catch (err) {
        console.error("Failed to update published quiz:", err);
        return null;
    }
}

/**
 * Creates a shuffled copy of an archived quiz (e.g. Set B for Section 2)
 * and saves it directly to the archive.
 */
export async function duplicateAsShuffledQuiz(
    originalQuiz: StoredQuiz,
    options?: {
        newTitle?: string;
        targetClassroomId?: string;
        targetClassTitle?: string;
    }
): Promise<StoredQuiz> {
    const shuffled = shuffleAssessmentQuestions(originalQuiz);
    const newQuizId = `quiz_${Date.now()}`;
    const targetClassroomId = options?.targetClassroomId || originalQuiz.classroomId;
    const targetClassTitle = options?.targetClassTitle || originalQuiz.classTitle;
    const newTitle = options?.newTitle?.trim() || `${originalQuiz.quizTitle} (Set B)`;

    const duplicatedQuiz: GeneratedAssessment & Partial<StoredQuiz> = {
        ...shuffled,
        id: newQuizId,
        quizTitle: newTitle,
        classroomId: targetClassroomId,
        classTitle: targetClassTitle,
        subject: originalQuiz.subject,
        difficulty: originalQuiz.difficulty,
        questionType: originalQuiz.questionType,
        gradeLevel: originalQuiz.gradeLevel,
        createdAt: new Date().toISOString(),
    };

    return await savePublishedQuiz(targetClassroomId, duplicatedQuiz as GeneratedAssessment, targetClassTitle);
}

// ── Device-Local Draft Store (Instagram-Style 7-Day Cache) ─────────────────────

/**
 * Saves an assessment as a DRAFT strictly in the current device's local cache.
 * Drafts are not sent to the database and automatically expire after 7 days.
 */
export async function saveDraftQuiz(
    classroomId: string,
    assessment: GeneratedAssessment,
    classTitle?: string
): Promise<StoredQuiz> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    const draftId = (assessment as any).id || `draft_${Date.now()}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + DRAFT_TTL_MS).toISOString();

    const draftQuiz: StoredQuiz = {
        ...assessment,
        id: draftId,
        classroomId,
        classTitle: classTitle || (assessment as any).classTitle,
        subject: (assessment as any).subject,
        difficulty: (assessment as any).difficulty,
        questionType: (assessment as any).questionType,
        gradeLevel: (assessment as any).gradeLevel,
        createdAt: (assessment as any).createdAt || nowIso,
        expiresAt,
        updatedAt: nowIso,
        status: "DRAFT",
    };

    try {
        const existingJson = await AsyncStorage.getItem(key);
        const existing: StoredQuiz[] = existingJson ? JSON.parse(existingJson) : [];

        // Filter out existing duplicates and also purge any expired drafts
        const nonExpiredExisting = existing.filter((d) => !isDraftExpired(d));
        const updated = [
            draftQuiz,
            ...nonExpiredExisting.filter(
                (q) =>
                    q.id !== draftId &&
                    q.quizTitle.trim().toLowerCase() !== assessment.quizTitle.trim().toLowerCase()
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
 * Retrieves all draft assessments for a given classroom from device cache.
 * Automatically purges any drafts older than 7 days.
 */
export async function getDraftQuizzes(classroomId: string): Promise<StoredQuiz[]> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (json) {
            const drafts: StoredQuiz[] = JSON.parse(json);
            const activeDrafts = drafts.filter((d) => !isDraftExpired(d));

            // If some drafts expired, silently clean up AsyncStorage
            if (activeDrafts.length !== drafts.length) {
                AsyncStorage.setItem(key, JSON.stringify(activeDrafts)).catch(() => { });
            }

            return activeDrafts;
        }
    } catch (err) {
        console.error("Failed to load drafts from storage:", err);
    }
    return [];
}

/**
 * Deletes a draft assessment by ID from device cache.
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
 * Publishes an existing draft assessment, moving it from device cache into
 * the Supabase cloud database archive.
 */
export async function publishDraftQuiz(classroomId: string, draftId: string): Promise<StoredQuiz | null> {
    const key = `${DRAFT_PREFIX}${classroomId}`;
    try {
        const json = await AsyncStorage.getItem(key);
        if (!json) return null;
        const drafts: StoredQuiz[] = JSON.parse(json);
        const draft = drafts.find((d) => d.id === draftId);
        if (!draft) return null;

        // Save to cloud archive database
        const published = await savePublishedQuiz(classroomId, draft, draft.classTitle);

        // Remove from local drafts cache
        const remaining = drafts.filter((d) => d.id !== draftId);
        await AsyncStorage.setItem(key, JSON.stringify(remaining));
        return published;
    } catch (err) {
        console.error("Failed to publish draft quiz:", err);
        return null;
    }
}

/**
 * Retrieves all draft assessments across ALL classrooms on this device.
 * Automatically purges drafts older than 7 days.
 */
export async function getAllDraftQuizzes(): Promise<StoredQuiz[]> {
    try {
        const allKeys = await AsyncStorage.getAllKeys();
        const draftKeys = allKeys.filter((k) => k.startsWith(DRAFT_PREFIX));
        if (draftKeys.length === 0) return [];
        const pairs = await AsyncStorage.multiGet(draftKeys);
        const allDrafts: StoredQuiz[] = [];

        for (const [k, val] of pairs) {
            if (val) {
                try {
                    const parsed: StoredQuiz[] = JSON.parse(val);
                    if (Array.isArray(parsed)) {
                        const active = parsed.filter((d) => !isDraftExpired(d));
                        allDrafts.push(...active);

                        // If any expired drafts were filtered, sync the cleaned list back to AsyncStorage
                        if (active.length !== parsed.length) {
                            if (active.length === 0) {
                                AsyncStorage.removeItem(k).catch(() => { });
                            } else {
                                AsyncStorage.setItem(k, JSON.stringify(active)).catch(() => { });
                            }
                        }
                    }
                } catch { }
            }
        }
        return allDrafts.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    } catch (err) {
        console.error("Failed to get all draft quizzes:", err);
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
 * Also removes cloud archives in Supabase for this classroom.
 */
export async function deleteClassroomQuizzes(classroomId: string): Promise<void> {
    try {
        // Delete cloud archives for this classroom from Supabase
        await supabase
            .from("archived_assessments")
            .delete()
            .eq("classroom_id", classroomId);
    } catch (dbErr) {
        console.warn("Could not delete classroom archives from Supabase:", dbErr);
    }

    try {
        await Promise.all([
            AsyncStorage.removeItem(`${STORAGE_PREFIX}${classroomId}`),
            AsyncStorage.removeItem(`${DRAFT_PREFIX}${classroomId}`),
            AsyncStorage.removeItem(`${PERF_STORAGE_PREFIX}${classroomId}`),
        ]);
    } catch (err) {
        console.error("Failed to delete classroom quizzes from storage:", err);
    }
}
