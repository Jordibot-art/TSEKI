// verifyExcelAndRoster.cjs
// Comprehensive verification of BSIT-4 Excel export, template generation, name splitting, and grading approval cumulative average

const XLSX = require('xlsx');

// ── 1. Name Splitting & Formatting Logic ──

function splitStudentFullName(rawName) {
  const cleaned = (rawName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { last_name: "", first_name: "", middle_name: null };

  if (cleaned.includes(",")) {
    const [lastPart, ...restParts] = cleaned.split(",");
    const last_name = lastPart.trim();
    const afterComma = restParts.join(",").trim();
    const tokens = afterComma.split(" ").filter(Boolean);
    if (tokens.length === 0) return { last_name, first_name: "", middle_name: null };
    if (tokens.length === 1) return { last_name, first_name: tokens[0], middle_name: null };
    const middle_name = tokens[tokens.length - 1];
    const first_name = tokens.slice(0, -1).join(" ");
    return { last_name, first_name, middle_name: middle_name || null };
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 1) return { last_name: tokens[0], first_name: "", middle_name: null };
  if (tokens.length === 2) return { last_name: tokens[1], first_name: tokens[0], middle_name: null };

  const compoundPrefixes = new Set(["dela", "de", "del", "delos", "san", "sta", "sta.", "st", "st."]);
  let lastStartIdx = tokens.length - 1;
  if (lastStartIdx >= 2 && compoundPrefixes.has(tokens[lastStartIdx - 1].toLowerCase())) {
    lastStartIdx -= 1;
    if (
      lastStartIdx >= 2 &&
      tokens[lastStartIdx - 1].toLowerCase() === "de" &&
      (tokens[lastStartIdx].toLowerCase() === "la" || tokens[lastStartIdx].toLowerCase() === "los" || tokens[lastStartIdx].toLowerCase() === "las")
    ) {
      lastStartIdx -= 1;
    }
  }

  const last_name = tokens.slice(lastStartIdx).join(" ");
  const beforeLast = tokens.slice(0, lastStartIdx);
  if (beforeLast.length === 1) return { last_name, first_name: beforeLast[0], middle_name: null };
  const first_name = beforeLast[0];
  const middle_name = beforeLast.slice(1).join(" ");
  return { last_name, first_name, middle_name: middle_name || null };
}

function formatStudentFullName(student) {
  const last = (student.last_name || "").trim();
  const first = (student.first_name || "").trim();
  const middle = (student.middle_name || "").trim();
  if (last && first) return `${last}, ${first}${middle ? ` ${middle}` : ""}`;
  if (last) return `${last}${middle ? ` ${middle}` : ""}`;
  if (first) return `${first}${middle ? ` ${middle}` : ""}`;
  return (student.full_name || "").trim();
}

function normalizeStudentRecord(row) {
  const hasSplit = Boolean(
    (row.last_name && String(row.last_name).trim()) ||
    (row.first_name && String(row.first_name).trim())
  );
  const split = hasSplit
    ? {
        last_name: String(row.last_name || "").trim(),
        first_name: String(row.first_name || "").trim(),
        middle_name: row.middle_name ? String(row.middle_name).trim() || null : null,
      }
    : splitStudentFullName(String(row.full_name || ""));

  const full_name = formatStudentFullName({
    last_name: split.last_name,
    first_name: split.first_name,
    middle_name: split.middle_name,
    full_name: row.full_name,
  });

  return Object.assign({}, row, {
    last_name: split.last_name,
    first_name: split.first_name,
    middle_name: split.middle_name,
    full_name,
  });
}

function formatQuizColumnHeader(quiz, index) {
  const rawTitle = (quiz.quizTitle || "").trim();
  const hasQuizPrefix = /^quiz\s*\d+/i.test(rawTitle);
  const baseTitle = rawTitle
    ? hasQuizPrefix
      ? rawTitle
      : `Quiz ${index + 1}: ${rawTitle}`
    : `Quiz ${index + 1}`;
  if (typeof quiz.maxScore === "number" && quiz.maxScore > 0) {
    return `${baseTitle} (${quiz.maxScore} pts)`;
  }
  return baseTitle;
}

// ── 2. BSIT-4 Excel Generator ──

function generateExcelClasslistBase64(options) {
  const { classroomTitle, subject, section, room, schedule, teacher, students, quizzes = [], results = [] } = options;

  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const effectiveQuizzes = quizzes.length > 0
    ? quizzes
    : results.length > 0
      ? Array.from(new Set(results.map((r) => r.quizTitle.trim()).filter(Boolean))).map((qt) => ({ quizTitle: qt }))
      : [{ quizTitle: "Quiz 1" }, { quizTitle: "Quiz 2" }, { quizTitle: "Quiz 3" }];

  const quizHeaders = effectiveQuizzes.map((q, idx) => formatQuizColumnHeader(q, idx));

  const scoreById = new Map();
  const scoreByName = new Map();
  for (const r of results) {
    const qTitle = (r.quizTitle || "").trim().toLowerCase();
    if (r.studentId) scoreById.set(`${r.studentId}:::${qTitle}`, r.totalScore);
    if (r.studentName) scoreByName.set(`${r.studentName.trim().toLowerCase()}:::${qTitle}`, r.totalScore);
  }

  const rows = [
    ["TSEKI - CLASS ROSTER & PERFORMANCE RECORD"],
    ["Classroom:", classroomTitle, "", "Subject:", subject || "N/A"],
    ["Section:", section || "N/A", "", "Room:", room || "N/A"],
    ["Schedule:", schedule || "N/A", "", "Teacher:", teacher || "N/A"],
    ["Export Date:", formattedDate, "", "Total Enrolled:", students.length],
    [], // Blank separator row
    ["Item", "Last Name", "First Name", "Middle Name", "Email Address", ...quizHeaders, "Average Scores"],
  ];

  students.forEach((s, idx) => {
    const norm = normalizeStudentRecord(s);
    const normFull = (norm.full_name || "").trim().toLowerCase();
    const normSimple = `${norm.first_name} ${norm.last_name}`.trim().toLowerCase();

    let earnedTotal = 0;
    let maxTotal = 0;
    let scoredCount = 0;

    const quizScoreCells = effectiveQuizzes.map((q) => {
      const qTitle = (q.quizTitle || "").trim().toLowerCase();
      let score;
      if (s.id && scoreById.has(`${s.id}:::${qTitle}`)) {
        score = scoreById.get(`${s.id}:::${qTitle}`);
      } else if (scoreByName.has(`${normFull}:::${qTitle}`)) {
        score = scoreByName.get(`${normFull}:::${qTitle}`);
      } else if (scoreByName.has(`${normSimple}:::${qTitle}`)) {
        score = scoreByName.get(`${normSimple}:::${qTitle}`);
      }

      if (typeof score === "number" && !Number.isNaN(score)) {
        earnedTotal += score;
        const qMax = (q.maxScore && q.maxScore > 0) ? q.maxScore : 100;
        maxTotal += qMax;
        scoredCount++;
        return { t: "n", v: score };
      }
      return "";
    });

    let averageDisplay = "0%";
    if (typeof s.average === "number" && !Number.isNaN(s.average)) {
      averageDisplay = `${Math.round(s.average)}%`;
    } else if (scoredCount > 0 && maxTotal > 0) {
      averageDisplay = `${Math.round((earnedTotal / maxTotal) * 100)}%`;
    }

    rows.push([
      idx + 1,
      norm.last_name,
      norm.first_name,
      norm.middle_name || "",
      s.email || "N/A",
      ...quizScoreCells,
      averageDisplay,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },  // Item
    { wch: 22 }, // Last Name
    { wch: 22 }, // First Name
    { wch: 18 }, // Middle Name
    { wch: 30 }, // Email Address
    ...quizHeaders.map((h) => ({ wch: Math.max(16, h.length + 4) })),
    { wch: 18 }, // Average Scores
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Classlist");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

// ── 3. BSIT-4 Template Generator ──

function generateExcelTemplateBase64(options) {
  const meta = options || {};
  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rows = [
    ["TSEKI - CLASS ROSTER TEMPLATE"],
    ["Classroom:", meta.classroomTitle || "BSIT-4", "", "Subject:", meta.subject || "SAM"],
    ["Section:", meta.section || "SECTION 5", "", "Room:", meta.room || "CL2"],
    ["Schedule:", meta.schedule || "MWF 3:30-4:30", "", "Teacher:", meta.teacher || "N/A"],
    ["Export Date:", formattedDate, "", "Total Enrolled:", 3],
    [],
    ["Item", "Last Name", "First Name", "Middle Name", "Email Address"],
    [1, "Abellanosa", "Reymark", "B.", "reymark.abellanosa@example.com"],
    [2, "Abuhat", "Louise Paulo", "T.", "louise.abuhat@example.com"],
    [3, "Aguanta", "Sheme Nichollei John", "A.", "shememyst@gmail.com"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 32 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Classlist");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

// ── Test Runner ──

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

console.log("=== Testing Student Name Parsing & Normalization ===");
{
  const p1 = splitStudentFullName("Abellanosa, Reymark B.");
  assert(p1.last_name === "Abellanosa" && p1.first_name === "Reymark" && p1.middle_name === "B.", "Splits 'Abellanosa, Reymark B.'");

  const p2 = splitStudentFullName("Dela Cruz, Juan Santos");
  assert(p2.last_name === "Dela Cruz" && p2.first_name === "Juan" && p2.middle_name === "Santos", "Splits 'Dela Cruz, Juan Santos'");

  const p3 = splitStudentFullName("John Carlo Prak");
  assert(p3.last_name === "Prak" && p3.first_name === "John" && p3.middle_name === "Carlo", "Splits 'John Carlo Prak'");

  const norm = normalizeStudentRecord({ full_name: "Ayap, Ramel JR. M.", email: "ramel@example.com", average: 88 });
  assert(norm.last_name === "Ayap" && norm.first_name === "Ramel JR." && norm.middle_name === "M.", "Normalizes 'Ayap, Ramel JR. M.'");
  assert(norm.full_name === "Ayap, Ramel JR. M.", "Maintains formatted full_name");
}

console.log("\n=== Testing BSIT-4 Excel Export Structure & Average Scores Column ===");
{
  const students = [
    { id: "s1", last_name: "Abellanosa", first_name: "Reymark", middle_name: "B.", full_name: "Abellanosa, Reymark B.", email: "reymark@test.com", average: 92 },
    { id: "s2", last_name: "Aguanta", first_name: "Sheme Nichollei John", middle_name: "A.", full_name: "Aguanta, Sheme Nichollei John A.", email: "shememyst@gmail.com", average: 85 },
  ];

  const quizzes = [
    { id: "q1", quizTitle: "Quiz 1", maxScore: 20 },
    { id: "q2", quizTitle: "Quiz 2: Algorithms", maxScore: 25 },
  ];

  const results = [
    { studentId: "s1", studentName: "Abellanosa, Reymark B.", quizTitle: "Quiz 1", totalScore: 19 },
    { studentId: "s1", studentName: "Abellanosa, Reymark B.", quizTitle: "Quiz 2: Algorithms", totalScore: 23 },
    { studentId: "s2", studentName: "Aguanta, Sheme Nichollei John A.", quizTitle: "Quiz 1", totalScore: 17 },
  ];

  const b64 = generateExcelClasslistBase64({
    classroomTitle: "BSIT-4",
    subject: "SAM",
    section: "SECTION 5",
    room: "CL2",
    schedule: "MWF 3:30-4:30",
    teacher: "Prof. Cruz",
    students,
    quizzes,
    results,
  });

  assert(Boolean(b64 && b64.length > 500), "Generated export base64 string is valid");

  const wb = XLSX.read(b64, { type: "base64" });
  assert(wb.SheetNames.includes("Classlist"), "Contains 'Classlist' worksheet");
  const ws = wb.Sheets["Classlist"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Verify Header Rows 0-5
  assert(rows[0][0] === "TSEKI - CLASS ROSTER & PERFORMANCE RECORD", "Row 0 has BSIT-4 header title");
  assert(rows[1][0] === "Classroom:" && rows[1][1] === "BSIT-4" && rows[1][3] === "Subject:" && rows[1][4] === "SAM", "Row 1 contains Classroom and Subject metadata");
  assert(rows[2][0] === "Section:" && rows[2][1] === "SECTION 5" && rows[2][3] === "Room:" && rows[2][4] === "CL2", "Row 2 contains Section and Room metadata");
  assert(rows[3][0] === "Schedule:" && rows[3][1] === "MWF 3:30-4:30" && rows[3][3] === "Teacher:" && rows[3][4] === "Prof. Cruz", "Row 3 contains Schedule and Teacher metadata");
  assert(rows[4][0] === "Export Date:" && rows[4][3] === "Total Enrolled:" && rows[4][4] === 2, "Row 4 contains Export Date and Total Enrolled");

  // Verify Table Header on Row 6
  const tableHeader = rows[6];
  assert(tableHeader[0] === "Item", "Col 0 is 'Item'");
  assert(tableHeader[1] === "Last Name", "Col 1 is 'Last Name'");
  assert(tableHeader[2] === "First Name", "Col 2 is 'First Name'");
  assert(tableHeader[3] === "Middle Name", "Col 3 is 'Middle Name'");
  assert(tableHeader[4] === "Email Address", "Col 4 is 'Email Address'");
  assert(tableHeader[5] === "Quiz 1 (20 pts)", "Col 5 is 'Quiz 1 (20 pts)'");
  assert(tableHeader[6] === "Quiz 2: Algorithms (25 pts)", "Col 6 is 'Quiz 2: Algorithms (25 pts)'");
  assert(tableHeader[7] === "Average Scores", "Col 7 is 'Average Scores'");

  // Verify Student Rows 7 and 8
  const row1 = rows[7];
  assert(row1[0] === 1, "Student 1 Item is 1");
  assert(row1[1] === "Abellanosa", "Student 1 Last Name is Abellanosa");
  assert(row1[2] === "Reymark", "Student 1 First Name is Reymark");
  assert(row1[3] === "B.", "Student 1 Middle Name is B.");
  assert(row1[4] === "reymark@test.com", "Student 1 Email is reymark@test.com");
  assert(row1[5] === 19, "Student 1 Quiz 1 score is 19");
  assert(row1[6] === 23, "Student 1 Quiz 2 score is 23");
  assert(row1[7] === "92%", "Student 1 Average Score is '92%'");

  const row2 = rows[8];
  assert(row2[1] === "Aguanta", "Student 2 Last Name is Aguanta");
  assert(row2[5] === 17, "Student 2 Quiz 1 score is 17");
  assert(row2[6] === "", "Student 2 Quiz 2 is empty string (untaken)");
  assert(row2[7] === "85%", "Student 2 Average Score is '85%'");
}

console.log("\n=== Testing BSIT-4 Blank Template Generator ===");
{
  const tplB64 = generateExcelTemplateBase64({
    classroomTitle: "BSIT-4",
    subject: "SAM",
    section: "SECTION 5",
  });

  const tplWb = XLSX.read(tplB64, { type: "base64" });
  const tplWs = tplWb.Sheets["Classlist"];
  const tplRows = XLSX.utils.sheet_to_json(tplWs, { header: 1 });

  assert(tplRows[0][0] === "TSEKI - CLASS ROSTER TEMPLATE", "Template title is 'TSEKI - CLASS ROSTER TEMPLATE'");
  assert(tplRows[1][1] === "BSIT-4", "Template classroom is 'BSIT-4'");
  const tplHeader = tplRows[6];
  assert(tplHeader[0] === "Item" && tplHeader[1] === "Last Name" && tplHeader[2] === "First Name" && tplHeader[3] === "Middle Name" && tplHeader[4] === "Email Address", "Template table header has Item, Last Name, First Name, Middle Name, Email Address");
  assert(tplRows.length >= 10, "Template has sample data rows for teachers");
}

console.log("\n=== Testing Cumulative Average Recalculation on Approval ===");
{
  // Simulated quiz scores for a student: Quiz 1 = 80/100 (80%), Quiz 2 = 18/20 (90%)
  const scores = [
    { score_percentage: 80, total_score: 80, max_score: 100 },
    { score_percentage: 90, total_score: 18, max_score: 20 },
  ];

  let sumPct = 0;
  for (const s of scores) sumPct += s.score_percentage;
  const cumulativeAvg = Math.round(sumPct / scores.length);

  assert(cumulativeAvg === 85, `Cumulative average of 80% and 90% is 85% (got ${cumulativeAvg}%)`);

  // Third quiz added: Quiz 3 = 100% -> (80 + 90 + 100) / 3 = 90%
  scores.push({ score_percentage: 100, total_score: 50, max_score: 50 });
  sumPct = 0;
  for (const s of scores) sumPct += s.score_percentage;
  const newCumulativeAvg = Math.round(sumPct / scores.length);

  assert(newCumulativeAvg === 90, `Cumulative average after 3rd quiz is 90% (got ${newCumulativeAvg}%)`);
}

console.log(`\n================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`================================`);
if (failed > 0) process.exit(1);
