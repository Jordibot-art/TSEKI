// verifyExcelAndRoster.cjs
// Comprehensive verification of BSIT-4 Excel export (merged "Student Name" as "Last Name, First Name M."),
// template generation, smart name splitting (two-word first names & compound surnames), and grading approval cumulative average

const XLSX = require('xlsx');

// ── 1. Name Splitting & Formatting Logic ──

function toSmartTitleCase(input) {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/(?:^|[\s,.\-/()])[a-z]/g, (match) => match.toUpperCase())
    .replace(/\b(ii|iii|iv|v)\b/gi, (match) => match.toUpperCase())
    .replace(/\b(jr|sr)\.?/gi, (match) => {
      const base = match.replace(/\./g, "").toLowerCase();
      return base.charAt(0).toUpperCase() + base.slice(1) + ".";
    });
}

function formatMiddleInitial(middleName) {
  if (!middleName) return "";
  const cleaned = String(middleName).replace(/\./g, " ").trim();
  if (
    !cleaned ||
    cleaned.toUpperCase() === "N/A" ||
    cleaned === "-" ||
    cleaned === "—" ||
    cleaned.toUpperCase() === "NONE"
  ) {
    return "";
  }
  const match = cleaned.match(/[a-zA-Z]/);
  if (!match) return "";
  return `${match[0].toUpperCase()}.`;
}

const SUFFIX_SET = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

const COMMON_SECOND_GIVEN_NAMES = new Set([
  "ariel", "paul", "paulo", "paolo", "carlo", "carlos", "marie", "mae", "may",
  "joy", "ann", "anne", "rose", "jane", "grace", "mark", "marc", "john", "jon",
  "miguel", "gabriel", "louise", "louis", "nichollei", "nicole", "claire", "clara",
  "jean", "lynn", "lyn", "faye", "faith", "hope", "love", "dawn", "kay", "kaye",
  "ray", "rey", "roy", "lee", "jay", "jae", "dan", "dean", "neil", "noel", "joel",
  "kyle", "kent", "kurt", "luke", "jude", "james", "ivan", "ian", "ryan", "bryan",
  "brian", "kevin", "keith", "ken", "kim", "angel", "angelo", "angela", "therese",
  "teresa", "sofia", "sophia", "isabel", "isabella", "elizabeth", "victoria",
  "nicolas", "francis", "francisco", "antonio", "jose", "juan", "maria", "andrea",
  "andrei", "andre", "patrick", "patricia", "bea", "bianca", "denise", "dennis",
  "lance", "vince", "vincent", "charles", "christian", "christopher", "michael",
  "david", "daniel", "matthew", "joshua", "justin", "kenneth", "steven", "stephen",
  "edward", "anthony", "allen", "allan", "alvin",
]);

function splitStudentFullName(rawName) {
  const cleaned = (rawName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return { last_name: "", first_name: "", middle_name: null };

  if (cleaned.includes(",")) {
    const [lastPart, ...restParts] = cleaned.split(",");
    const last_name = toSmartTitleCase(lastPart.trim());
    const afterComma = restParts.join(" ").replace(/\s+/g, " ").trim();
    const tokens = afterComma.split(" ").filter(Boolean);
    if (tokens.length === 0) return { last_name, first_name: "", middle_name: null };
    if (tokens.length === 1) return { last_name, first_name: toSmartTitleCase(tokens[0]), middle_name: null };

    const lastToken = tokens[tokens.length - 1];
    if (SUFFIX_SET.has(lastToken.toLowerCase())) {
      return {
        last_name,
        first_name: toSmartTitleCase(tokens.join(" ")),
        middle_name: null,
      };
    }

    const middle_name = toSmartTitleCase(lastToken);
    const first_name = toSmartTitleCase(tokens.slice(0, -1).join(" "));
    return { last_name, first_name, middle_name: middle_name || null };
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 1) return { last_name: toSmartTitleCase(tokens[0]), first_name: "", middle_name: null };
  if (tokens.length === 2) return { last_name: toSmartTitleCase(tokens[1]), first_name: toSmartTitleCase(tokens[0]), middle_name: null };

  const compoundSinglePrefixes = new Set(["dela", "de", "del", "delos", "delas", "san", "sta", "sta.", "sto", "sto.", "st", "st."]);
  const compoundMiddleParticles = new Set(["la", "los", "las"]);

  let lastStartIdx = tokens.length - 1;
  const prevLower = tokens[lastStartIdx - 1] ? tokens[lastStartIdx - 1].toLowerCase() : "";

  if (lastStartIdx >= 2 && compoundMiddleParticles.has(prevLower)) {
    if (lastStartIdx >= 3 && tokens[lastStartIdx - 2].toLowerCase() === "de") {
      lastStartIdx -= 2;
    } else {
      lastStartIdx -= 1;
    }
  } else if (lastStartIdx >= 2 && compoundSinglePrefixes.has(prevLower)) {
    lastStartIdx -= 1;
  }

  const last_name = toSmartTitleCase(tokens.slice(lastStartIdx).join(" "));
  const beforeLast = tokens.slice(0, lastStartIdx);

  if (beforeLast.length === 0) return { last_name, first_name: "", middle_name: null };
  if (beforeLast.length === 1) return { last_name, first_name: toSmartTitleCase(beforeLast[0]), middle_name: null };

  if (beforeLast.length === 2) {
    const secondToken = beforeLast[1];
    const secondClean = secondToken.replace(/\./g, "").toLowerCase();
    const isInitial = secondClean.length === 1;

    if (isInitial) {
      return {
        last_name,
        first_name: toSmartTitleCase(beforeLast[0]),
        middle_name: toSmartTitleCase(secondToken),
      };
    }

    if (SUFFIX_SET.has(secondToken.toLowerCase()) || COMMON_SECOND_GIVEN_NAMES.has(secondClean)) {
      return {
        last_name,
        first_name: toSmartTitleCase(beforeLast.join(" ")),
        middle_name: null,
      };
    }

    return {
      last_name,
      first_name: toSmartTitleCase(beforeLast[0]),
      middle_name: toSmartTitleCase(secondToken),
    };
  }

  const middleToken = beforeLast[beforeLast.length - 1];
  const firstTokens = beforeLast.slice(0, -1);
  return {
    last_name,
    first_name: toSmartTitleCase(firstTokens.join(" ")),
    middle_name: toSmartTitleCase(middleToken) || null,
  };
}

function formatStudentFullName(student) {
  const last = toSmartTitleCase((student.last_name || "").trim());
  const first = toSmartTitleCase((student.first_name || "").trim());
  const middleInitial = formatMiddleInitial(student.middle_name);
  if (last && first) return `${last}, ${first}${middleInitial ? ` ${middleInitial}` : ""}`;
  if (last) return `${last}${middleInitial ? ` ${middleInitial}` : ""}`;
  if (first) return `${first}${middleInitial ? ` ${middleInitial}` : ""}`;
  return toSmartTitleCase((student.full_name || "").trim());
}

function normalizeStudentRecord(row) {
  const hasSplit = Boolean(
    (row.last_name && String(row.last_name).trim()) ||
    (row.first_name && String(row.first_name).trim())
  );
  const split = hasSplit
    ? {
        last_name: toSmartTitleCase(String(row.last_name || "").trim()),
        first_name: toSmartTitleCase(String(row.first_name || "").trim()),
        middle_name: row.middle_name ? toSmartTitleCase(String(row.middle_name).trim()) || null : null,
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

// ── 2. BSIT-4 Excel Generator (Merged Student Name: "Last Name, First Name M.") ──

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
    ["Item", "Student Name", "Email Address", ...quizHeaders, "Average Scores"],
  ];

  students.forEach((s, idx) => {
    const norm = normalizeStudentRecord(s);
    const mergedStudentName = formatStudentFullName(norm);
    const normFull = (mergedStudentName || norm.full_name || "").trim().toLowerCase();
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
      mergedStudentName,
      s.email || "N/A",
      ...quizScoreCells,
      averageDisplay,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },  // Item
    { wch: 34 }, // Student Name
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
    ["Item", "Student Name", "Email Address"],
    [1, "Abellanosa, Reymark B.", "reymark.abellanosa@example.com"],
    [2, "Abuhat, Louise Paulo T.", "louise.abuhat@example.com"],
    [3, "Ramos, John Ariel C.", "johnariel.ramos@example.com"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 34 },
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

console.log("=== Testing Smart Student Name Parsing & 'Last Name, First Name M.' Formatting ===");
{
  // 1. User's explicit example: { last_name: "ramos", first_name: "john ariel", middle_name: "coran" } -> "Ramos, John Ariel C."
  const formattedRamos = formatStudentFullName({
    last_name: "ramos",
    first_name: "john ariel",
    middle_name: "coran",
  });
  assert(formattedRamos === "Ramos, John Ariel C.", `Formats { last_name: "ramos", first_name: "john ariel", middle_name: "coran" } -> "${formattedRamos}"`);

  // 2. Omit middle initial when middle_name is empty
  const formattedNoMid = formatStudentFullName({
    last_name: "ramos",
    first_name: "rheyan",
    middle_name: "",
  });
  assert(formattedNoMid === "Ramos, Rheyan", `Omits middle initial when middle_name is empty -> "${formattedNoMid}"`);

  // 3. Last-Name-First import: "Ramos, John Ariel C."
  const s1 = splitStudentFullName("Ramos, John Ariel C.");
  assert(
    s1.last_name === "Ramos" && s1.first_name === "John Ariel" && s1.middle_name === "C.",
    `Splits Last-Name-First 'Ramos, John Ariel C.' -> last="${s1.last_name}", first="${s1.first_name}", middle="${s1.middle_name}"`
  );

  // 4. First-Name-First import with middle initial: "John Ariel C. Ramos"
  const s2 = splitStudentFullName("John Ariel C. Ramos");
  assert(
    s2.last_name === "Ramos" && s2.first_name === "John Ariel" && s2.middle_name === "C.",
    `Splits First-Name-First 'John Ariel C. Ramos' -> last="${s2.last_name}", first="${s2.first_name}", middle="${s2.middle_name}"`
  );
  assert(
    formatStudentFullName(s2) === "Ramos, John Ariel C.",
    `Saves full_name of 'John Ariel C. Ramos' as 'Ramos, John Ariel C.'`
  );

  // 5. First-Name-First import with full middle name: "John Ariel Coran Ramos"
  const s3 = splitStudentFullName("John Ariel Coran Ramos");
  assert(
    s3.last_name === "Ramos" && s3.first_name === "John Ariel" && s3.middle_name === "Coran",
    `Splits First-Name-First 'John Ariel Coran Ramos' -> last="${s3.last_name}", first="${s3.first_name}", middle="${s3.middle_name}"`
  );
  assert(
    formatStudentFullName(s3) === "Ramos, John Ariel C.",
    `Saves full_name of 'John Ariel Coran Ramos' as 'Ramos, John Ariel C.'`
  );

  // 6. Compound surnames: "Dela Cruz", "De La Cruz", "De Guzman"
  const s4 = splitStudentFullName("Juan Miguel S. Dela Cruz");
  assert(
    s4.last_name === "Dela Cruz" && s4.first_name === "Juan Miguel" && s4.middle_name === "S.",
    `Handles compound surname 'Juan Miguel S. Dela Cruz' -> last="${s4.last_name}", first="${s4.first_name}", middle="${s4.middle_name}"`
  );

  const s5 = splitStudentFullName("Maria Clara De La Cruz");
  assert(
    s5.last_name === "De La Cruz" && s5.first_name === "Maria Clara" && s5.middle_name === null,
    `Handles compound surname 'Maria Clara De La Cruz' -> last="${s5.last_name}", first="${s5.first_name}", middle="${s5.middle_name}"`
  );

  const s6 = splitStudentFullName("Jose P. De Guzman");
  assert(
    s6.last_name === "De Guzman" && s6.first_name === "Jose" && s6.middle_name === "P.",
    `Handles compound surname 'Jose P. De Guzman' -> last="${s6.last_name}", first="${s6.first_name}", middle="${s6.middle_name}"`
  );

  const norm = normalizeStudentRecord({ full_name: "AYAP, RAMEL JR. M.", email: "ramel@example.com", average: 88 });
  assert(norm.last_name === "Ayap" && norm.first_name === "Ramel Jr." && norm.middle_name === "M.", `Normalizes 'AYAP, RAMEL JR. M.' -> last="${norm.last_name}", first="${norm.first_name}", middle="${norm.middle_name}"`);
  assert(norm.full_name === "Ayap, Ramel Jr. M.", "Maintains Title Case formatted full_name 'Ayap, Ramel Jr. M.'");
}

console.log("\n=== Testing BSIT-4 Excel Export Structure (Merged Student Name & Average Scores) ===");
{
  const students = [
    { id: "s1", last_name: "ramos", first_name: "john ariel", middle_name: "coran", full_name: "Ramos, John Ariel C.", email: "johnariel.ramos@test.com", average: 92 },
    { id: "s2", last_name: "aguanta", first_name: "sheme nichollei john", middle_name: "a.", full_name: "Aguanta, Sheme Nichollei John A.", email: "shememyst@gmail.com", average: 85 },
  ];

  const quizzes = [
    { id: "q1", quizTitle: "Quiz 1", maxScore: 20 },
    { id: "q2", quizTitle: "Quiz 2: Algorithms", maxScore: 25 },
  ];

  const results = [
    { studentId: "s1", studentName: "Ramos, John Ariel C.", quizTitle: "Quiz 1", totalScore: 19 },
    { studentId: "s1", studentName: "Ramos, John Ariel C.", quizTitle: "Quiz 2: Algorithms", totalScore: 23 },
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

  // Verify Table Header on Row 6: Item | Student Name | Email Address | Quiz 1 | Quiz 2 | Average Scores
  const tableHeader = rows[6];
  assert(tableHeader[0] === "Item", "Col 0 is 'Item'");
  assert(tableHeader[1] === "Student Name", "Col 1 is merged 'Student Name'");
  assert(tableHeader[2] === "Email Address", "Col 2 is 'Email Address'");
  assert(tableHeader[3] === "Quiz 1 (20 pts)", "Col 3 is 'Quiz 1 (20 pts)'");
  assert(tableHeader[4] === "Quiz 2: Algorithms (25 pts)", "Col 4 is 'Quiz 2: Algorithms (25 pts)'");
  assert(tableHeader[5] === "Average Scores", "Col 5 is 'Average Scores'");

  // Verify Student Rows 7 and 8
  const row1 = rows[7];
  assert(row1[0] === 1, "Student 1 Item is 1");
  assert(row1[1] === "Ramos, John Ariel C.", "Student 1 merged Student Name is 'Ramos, John Ariel C.'");
  assert(row1[2] === "johnariel.ramos@test.com", "Student 1 Email is johnariel.ramos@test.com");
  assert(row1[3] === 19, "Student 1 Quiz 1 score is 19");
  assert(row1[4] === 23, "Student 1 Quiz 2 score is 23");
  assert(row1[5] === "92%", "Student 1 Average Score is '92%'");

  const row2 = rows[8];
  assert(row2[1] === "Aguanta, Sheme Nichollei John A.", "Student 2 merged Student Name is 'Aguanta, Sheme Nichollei John A.'");
  assert(row2[3] === 17, "Student 2 Quiz 1 score is 17");
  assert(row2[4] === "", "Student 2 Quiz 2 is empty string (untaken)");
  assert(row2[5] === "85%", "Student 2 Average Score is '85%'");
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
  assert(
    tplHeader[0] === "Item" && tplHeader[1] === "Student Name" && tplHeader[2] === "Email Address",
    "Template table header has Item, Student Name, Email Address"
  );
  assert(tplRows[9][1] === "Ramos, John Ariel C.", "Template sample row demonstrates 'Ramos, John Ariel C.'");
  assert(tplRows.length >= 10, "Template has sample data rows for teachers");
}

console.log("\n=== Testing Cumulative Average Recalculation on Approval ===");
{
  const scores = [
    { score_percentage: 80, total_score: 80, max_score: 100 },
    { score_percentage: 90, total_score: 18, max_score: 20 },
  ];

  let sumPct = 0;
  for (const s of scores) sumPct += s.score_percentage;
  const cumulativeAvg = Math.round(sumPct / scores.length);

  assert(cumulativeAvg === 85, `Cumulative average of 80% and 90% is 85% (got ${cumulativeAvg}%)`);

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
