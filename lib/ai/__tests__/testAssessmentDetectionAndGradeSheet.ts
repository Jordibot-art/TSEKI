import assert from "assert";
import {
    getDisambiguatedQuizLabel,
    matchAssessmentByQr,
    matchAssessmentToCatalog,
    parseTsekiQrPayload,
} from "../../assessmentDetector";
import { resolveNonCollidingQuizTitle, StudentQuizResult } from "../../questionAnalysis";
import type { StoredQuiz } from "../../quizStore";

function makeQuiz(overrides: Partial<StoredQuiz> & { id: string; quizTitle: string; count: number; q1: string; q2?: string }): StoredQuiz {
    const questions = Array.from({ length: overrides.count }, (_, idx) => ({
        questionNumber: idx + 1,
        type: "multiple_choice" as const,
        questionText: idx === 0 ? overrides.q1 : idx === 1 && overrides.q2 ? overrides.q2 : `Sample question ${idx + 1}`,
        options: ["A) One", "B) Two", "C) Three", "D) Four"],
        correctAnswer: "A",
        points: 1,
        answerBoxesRequired: 1,
    }));
    const answerKey = questions.map((q) => ({
        questionNumber: q.questionNumber,
        correctAnswer: q.correctAnswer,
        points: 1,
    }));
    return {
        id: overrides.id,
        classroomId: "cls-1",
        quizTitle: overrides.quizTitle,
        questions,
        answerKey,
        createdAt: overrides.createdAt || "2026-11-20T00:00:00Z",
        layoutJson: overrides.layoutJson,
    };
}

const quizClientServer5 = makeQuiz({
    id: "quiz_cs_5",
    quizTitle: "Introduction to Client-Server Systems & Server Hardware Assessment",
    count: 5,
    q1: "In the client-server model, what is the primary role of the client?",
    q2: "Which of the following is an example of server memory designed to detect and fix data corruption?",
    createdAt: "2026-11-18T08:00:00Z",
    layoutJson: {
        quizId: "QZ-237673",
        version: "A",
        pageSize: { width: 612, height: 792 },
        pages: [],
        answerVariants: [],
        createdAt: "2026-11-18T08:00:00Z",
    },
});

const quizClientServer20 = makeQuiz({
    id: "quiz_cs_20",
    quizTitle: "Introduction to Client-Server Systems & Server Hardware Assessment",
    count: 20,
    q1: "An IT administrator wants to partition a distributed application so that tasks are efficiently split.",
    q2: "Which hardware component handles redundant hot-swappable power delivery in rackmount servers?",
    createdAt: "2026-11-21T08:00:00Z",
});

const quizFreeElec5 = makeQuiz({
    id: "quiz_free_elec_5",
    quizTitle: "FREE ELEC 3 Midterm Module Assessment (Weeks 5-8)",
    count: 5,
    q1: "What is another term commonly used for requirements gathering?",
    q2: "Which type of requirements describes what the system must do?",
    createdAt: "2026-11-20T08:00:00Z",
});

const catalog = [quizClientServer20, quizFreeElec5, quizClientServer5];

let passed = 0;
function runTest(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
}

console.log("=== Testing Assessment Auto-Detection & Multi-Assessment Grade Sheet ===");

runTest("parseTsekiQrPayload parses canonical pipe-delimited QR and bare codes", () => {
    const p1 = parseTsekiQrPayload("QZ-237673|A|ALL_IN_ONE|1/1");
    assert.deepStrictEqual(p1, { quizId: "QZ-237673", version: "A", docType: "ALL_IN_ONE", page: "1/1" });

    const p2 = parseTsekiQrPayload("quiz_cs_20|B|SHEET|1/2");
    assert.strictEqual(p2?.quizId, "quiz_cs_20");
    assert.strictEqual(p2?.version, "B");

    assert.strictEqual(parseTsekiQrPayload("https://example.com"), null);
});

runTest("matchAssessmentByQr matches by StoredQuiz.id or layoutJson.quizId instantaneously", () => {
    const mLayout = matchAssessmentByQr("QZ-237673|A|ALL_IN_ONE|1/1", catalog);
    assert.strictEqual(mLayout?.quiz.id, "quiz_cs_5");
    assert.strictEqual(mLayout?.method, "qr_exact");

    const mId = matchAssessmentByQr("quiz_cs_20|A|SHEET|1/1", catalog);
    assert.strictEqual(mId?.quiz.id, "quiz_cs_20");

    assert.strictEqual(matchAssessmentByQr("QZ-UNKNOWN|A|SHEET|1/1", catalog), null);
});

runTest("matchAssessmentToCatalog distinguishes 5-item vs 20-item quizzes with identical truncated titles", () => {
    const match5 = matchAssessmentToCatalog(
        {
            detectedTitle: "Introduction to Client-Server Systems & Server Har",
            detectedItemCount: 5,
            detectedQ1Snippet: "In the client-server model, what is the primary role of the client?",
            detectedQ2Snippet: "Which of the following is an example of server memory designed to detect",
        },
        catalog
    );
    assert.strictEqual(match5?.quiz.id, "quiz_cs_5", "Must pick 5-item Client-Server quiz, not 20-item");

    const match20 = matchAssessmentToCatalog(
        {
            detectedTitle: "Introduction to Client-Server Systems & Server Har",
            detectedItemCount: 20,
            detectedQ1Snippet: "An IT administrator wants to partition a distributed application",
        },
        catalog
    );
    assert.strictEqual(match20?.quiz.id, "quiz_cs_20", "Must pick 20-item Client-Server quiz");
});

runTest("matchAssessmentToCatalog matches exact footer quizCode even without title or questions", () => {
    const m = matchAssessmentToCatalog({ detectedQuizCode: "QZ-237673" }, catalog);
    assert.strictEqual(m?.quiz.id, "quiz_cs_5");
    assert.strictEqual(m?.method, "code_exact");
});

runTest("matchAssessmentToCatalog matches different topic (FREE ELEC 3) cleanly", () => {
    const m = matchAssessmentToCatalog(
        {
            detectedTitle: "FREE ELEC 3 Midterm Module",
            detectedItemCount: 5,
            detectedQ1Snippet: "What is another term commonly used for requirements gathering?",
        },
        catalog
    );
    assert.strictEqual(m?.quiz.id, "quiz_free_elec_5");
});

runTest("getDisambiguatedQuizLabel disambiguates duplicate titles by item count while keeping unique titles plain", () => {
    assert.strictEqual(
        getDisambiguatedQuizLabel(quizFreeElec5, catalog),
        "FREE ELEC 3 Midterm Module Assessment (Weeks 5-8)"
    );
    assert.strictEqual(
        getDisambiguatedQuizLabel(quizClientServer5, catalog),
        "Introduction to Client-Server Systems & Server Hardware Assessment (5 items)"
    );
    assert.strictEqual(
        getDisambiguatedQuizLabel(quizClientServer20, catalog),
        "Introduction to Client-Server Systems & Server Hardware Assessment (20 items)"
    );
});

runTest("resolveNonCollidingQuizTitle preserves distinct assessments sharing a title while allowing re-grades", () => {
    const existing: StudentQuizResult[] = [
        {
            studentId: "stu-1",
            studentName: "Ramos, John Ariel C.",
            classroomId: "cls-1",
            quizId: "quiz_cs_20",
            quizTitle: "Introduction to Client-Server Systems & Server Hardware Assessment",
            scorePercentage: 55,
            totalScore: 11,
            maxScore: 20,
            results: [],
            gradedAt: "2026-11-18T10:00:00Z",
        },
    ];

    // Recording a DIFFERENT 5-item assessment with the same title must NOT overwrite the 20-item record!
    const titleFor5Item = resolveNonCollidingQuizTitle(existing, {
        quizId: "quiz_cs_5",
        quizTitle: "Introduction to Client-Server Systems & Server Hardware Assessment",
        maxScore: 5,
        gradedAt: "2026-11-21T05:40:00Z",
    });
    assert.strictEqual(
        titleFor5Item,
        "Introduction to Client-Server Systems & Server Hardware Assessment (5 pts)"
    );

    // Re-scanning the SAME 20-item assessment updates cleanly in place
    const titleForRegrade20 = resolveNonCollidingQuizTitle(existing, {
        quizId: "quiz_cs_20",
        quizTitle: "Introduction to Client-Server Systems & Server Hardware Assessment",
        maxScore: 20,
        gradedAt: "2026-11-21T05:45:00Z",
    });
    assert.strictEqual(
        titleForRegrade20,
        "Introduction to Client-Server Systems & Server Hardware Assessment"
    );
});

console.log(`\nResults: ${passed} passed, 0 failed`);
