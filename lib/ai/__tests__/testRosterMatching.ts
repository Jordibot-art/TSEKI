import assert from "assert";
import { formatExtractedStudentName } from "../../gradingService";
import { matchStudentToRoster, StudentRosterItem } from "../../batchGradingQueue";

console.log("=== Testing Student Name Formatting & Anti-Duplicate Roster Matching ===");

// 1. Canonical Name Formatting (Lastname, Firstname M.)
{
    const r1 = formatExtractedStudentName({
        lastName: "RAMOS",
        firstName: "JOHN ARIEL",
        middleName: "Coran",
    });
    assert.strictEqual(r1.studentName, "Ramos, John Ariel C.");
    assert.strictEqual(r1.lastName, "Ramos");
    assert.strictEqual(r1.firstName, "John Ariel");
    assert.strictEqual(r1.middleName, "C.");

    const r2 = formatExtractedStudentName({
        lastName: "DELA CRUZ",
        firstName: "JUAN MIGUEL",
        middleName: "SANTOS",
    });
    assert.strictEqual(r2.studentName, "Dela Cruz, Juan Miguel S.");
    assert.strictEqual(r2.middleName, "S.");

    const r3 = formatExtractedStudentName({
        lastName: "ramos",
        firstName: "john ariel",
        middleName: "",
    });
    assert.strictEqual(r3.studentName, "Ramos, John Ariel");
    assert.strictEqual(r3.middleName, null);

    const r4 = formatExtractedStudentName({
        studentName: "John Ariel Coran Ramos",
    });
    assert.strictEqual(r4.studentName, "Ramos, John Ariel C.");
    assert.strictEqual(r4.middleName, "C.");

    const r5 = formatExtractedStudentName({
        lastName: "N/A",
        firstName: "",
        middleName: "NONE",
        studentName: "Unknown",
    });
    assert.strictEqual(r5.studentName, "Unknown");
    assert.strictEqual(r5.middleName, null);
    console.log("✔ Name formatting tests passed (Lastname, Firstname M.)");
}

// 2. Roster Matching & Duplicate Prevention
const roster: StudentRosterItem[] = [
    {
        id: "stu-1",
        last_name: "Ramos",
        first_name: "John Ariel",
        middle_name: "C.",
        full_name: "Ramos, John Ariel C.",
        email: null,
        average: 55,
    },
    {
        id: "stu-2",
        last_name: "Dela Cruz",
        first_name: "Juan Miguel",
        middle_name: "S.",
        full_name: "Dela Cruz, Juan Miguel S.",
        email: null,
        average: 88,
    },
];

// Exact match
{
    const m = matchStudentToRoster("Ramos, John Ariel C.", roster);
    assert.strictEqual(m?.student.id, "stu-1");
}

// Full middle name on paper vs middle initial in roster
{
    const m = matchStudentToRoster("RAMOS, JOHN ARIEL Coran", roster, {
        lastName: "RAMOS",
        firstName: "JOHN ARIEL",
        middleName: "Coran",
    });
    assert.strictEqual(m?.student.id, "stu-1");
}

// Handwriting OCR 1-letter typo ("Arel" instead of "Ariel" — exact screenshot repro!)
{
    const m = matchStudentToRoster("Ramos, John Arel C.", roster, {
        lastName: "Ramos",
        firstName: "John Arel",
        middleName: "C.",
    });
    assert.strictEqual(m?.student.id, "stu-1");
    assert.ok((m?.confidence ?? 0) >= 0.9, `Expected >= 0.9 confidence, got ${m?.confidence}`);
}

// Handwriting OCR typo + full middle name + ALL CAPS
{
    const m = matchStudentToRoster("RAMOS, JOHN AREL CORAN", roster, {
        lastName: "RAMOS",
        firstName: "JOHN AREL",
        middleName: "Coran",
    });
    assert.strictEqual(m?.student.id, "stu-1");
}

// Missing middle name on second assessment paper
{
    const m = matchStudentToRoster("Ramos, John Ariel", roster, {
        lastName: "Ramos",
        firstName: "John Ariel",
        middleName: null,
    });
    assert.strictEqual(m?.student.id, "stu-1");
}

// Flipped First/Last order
{
    const m = matchStudentToRoster("John Arel Coran Ramos", roster);
    assert.strictEqual(m?.student.id, "stu-1");
}

// Accidentally swapped Last Name & First Name fields on paper
{
    const m = matchStudentToRoster("John Ariel, Ramos C.", roster, {
        lastName: "John Ariel",
        firstName: "Ramos",
        middleName: "C.",
    });
    assert.strictEqual(m?.student.id, "stu-1");
}

// Compound surname spacing difference
{
    const m = matchStudentToRoster("Delacruz, Juan Miguel S.", roster, {
        lastName: "Delacruz",
        firstName: "Juan Miguel",
        middleName: "S.",
    });
    assert.strictEqual(m?.student.id, "stu-2");
}

// Sibling / distinct student protection — must NOT falsely match!
{
    const m1 = matchStudentToRoster("Ramos, Maria Clara C.", roster, {
        lastName: "Ramos",
        firstName: "Maria Clara",
        middleName: "C.",
    });
    assert.strictEqual(m1, null, "Must not merge distinct sibling Ramos, Maria Clara C.");

    const m2 = matchStudentToRoster("Ramos, John Mark C.", roster, {
        lastName: "Ramos",
        firstName: "John Mark",
        middleName: "C.",
    });
    assert.strictEqual(m2, null, "Must not merge distinct student Ramos, John Mark C.");
}

// Ambiguity protection when two roster students share First + Last
{
    const rosterWithTwoJohns: StudentRosterItem[] = [
        ...roster,
        {
            id: "stu-3",
            last_name: "Ramos",
            first_name: "John Mark",
            middle_name: "C.",
            full_name: "Ramos, John Mark C.",
            email: null,
            average: 78,
        },
    ];
    const ambiguous = matchStudentToRoster("Ramos, John C.", rosterWithTwoJohns, {
        lastName: "Ramos",
        firstName: "John",
        middleName: "C.",
    });
    assert.strictEqual(ambiguous, null, "Must not blindly guess when two roster students match equally");

    // Still unambiguously matches John Arel -> John Ariel!
    const clear = matchStudentToRoster("Ramos, John Arel C.", rosterWithTwoJohns, {
        lastName: "Ramos",
        firstName: "John Arel",
        middleName: "C.",
    });
    assert.strictEqual(clear?.student.id, "stu-1");
}

console.log("✔ All roster fuzzy matching & anti-duplicate tests passed!");
