import assert from "assert";
import {
    extractCooldownSeconds,
    extractTokenHashFromMagicLink,
    isValidOtpCode,
    isVerifiedEmailMatch,
    normalizeOtpCode,
} from "../../deleteVerificationService";
import { computeEditedGradeEntry, StudentQuizResult } from "../../questionAnalysis";

let passed = 0;
function runTest(name: string, fn: () => void) {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
}

console.log("=== Testing Delete Email Verification Helpers & Grade Sheet Editing ===");

runTest("normalizeOtpCode strips non-digits and caps at 6 digits", () => {
    assert.strictEqual(normalizeOtpCode("12 3-45678"), "123456");
    assert.strictEqual(normalizeOtpCode("abc42"), "42");
    assert.strictEqual(normalizeOtpCode(""), "");
});

runTest("isValidOtpCode validates exact 6-digit numeric codes", () => {
    assert.strictEqual(isValidOtpCode("482910"), true);
    assert.strictEqual(isValidOtpCode("000123"), true);
    assert.strictEqual(isValidOtpCode("48291"), false);
    assert.strictEqual(isValidOtpCode("48291a"), false);
    assert.strictEqual(isValidOtpCode(""), false);
});

runTest("isVerifiedEmailMatch requires case-insensitive match with logged-in teacher email", () => {
    assert.strictEqual(isVerifiedEmailMatch("Teacher@School.edu", "teacher@school.edu "), true);
    assert.strictEqual(isVerifiedEmailMatch("teacher@school.edu", "other@school.edu"), false);
    assert.strictEqual(isVerifiedEmailMatch("teacher@school.edu", null), false);
    assert.strictEqual(isVerifiedEmailMatch("", ""), false);
});

runTest("extractCooldownSeconds detects Supabase OTP rate-limit seconds", () => {
    assert.strictEqual(
        extractCooldownSeconds("For security purposes, you can only request this after 42 seconds."),
        42
    );
    assert.strictEqual(extractCooldownSeconds("Email rate limit exceeded"), 60);
    assert.strictEqual(extractCooldownSeconds("Invalid login credentials"), null);
});

runTest("extractTokenHashFromMagicLink parses Supabase verification URLs safely", () => {
    const hash = extractTokenHashFromMagicLink(
        "https://abcxyz.supabase.co/auth/v1/verify?token=a1b2c3d4e5f6g7h8i9j0&type=magiclink&redirect_to=http://localhost:3000"
    );
    assert.strictEqual(hash, "a1b2c3d4e5f6g7h8i9j0");

    const hash2 = extractTokenHashFromMagicLink(
        "https://tseki.app/confirm?token_hash=99887766554433221100&type=email"
    );
    assert.strictEqual(hash2, "99887766554433221100");

    assert.strictEqual(extractTokenHashFromMagicLink("123456"), null);
    assert.strictEqual(extractTokenHashFromMagicLink("https://example.com/no-token"), null);
});

runTest("computeEditedGradeEntry computes accurate percentage, trims title, and clamps bounds", () => {
    const original: StudentQuizResult = {
        studentId: "stu-1",
        studentName: "Ramos, John Ariel C.",
        classroomId: "cls-1",
        quizId: "quiz-1",
        quizTitle: "Client-Server Systems Quiz",
        scorePercentage: 40,
        totalScore: 2,
        maxScore: 5,
        results: [],
        gradedAt: "2026-11-21T05:00:00Z",
    };

    const edited = computeEditedGradeEntry(original, {
        quizTitle: "  Client-Server Systems Assessment (Revised)  ",
        totalScore: 4,
        maxScore: 5,
    });
    assert.strictEqual(edited.quizTitle, "Client-Server Systems Assessment (Revised)");
    assert.strictEqual(edited.totalScore, 4);
    assert.strictEqual(edited.maxScore, 5);
    assert.strictEqual(edited.scorePercentage, 80);

    // Clamps overflow score to maxScore and negative score to 0
    const clampedHigh = computeEditedGradeEntry(original, { totalScore: 12, maxScore: 10 });
    assert.strictEqual(clampedHigh.totalScore, 10);
    assert.strictEqual(clampedHigh.scorePercentage, 100);

    const clampedLow = computeEditedGradeEntry(original, { totalScore: -3, maxScore: 10 });
    assert.strictEqual(clampedLow.totalScore, 0);
    assert.strictEqual(clampedLow.scorePercentage, 0);
});

console.log(`\nResults: ${passed} passed, 0 failed`);
