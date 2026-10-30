import * as Print from "expo-print";
import { shareAsync } from "expo-sharing";
import { Platform } from "react-native";
import { GeneratedAssessment, ScannableQuestion } from "./quizGeneratorService";

export type BondPaperSize = "short" | "long";

export interface ExportPaperOptions {
  assessment: GeneratedAssessment;
  classTitle?: string;
  subject?: string;
  includeAnswerKey?: boolean;
  paperSize?: BondPaperSize; // "short" (8.5x11") or "long" (8.5x13")
}

type NormalizedQuestionType = "multiple_choice" | "true_false" | "identification" | "enumeration" | "word_box";

function normalizeQuestionType(type: string): NormalizedQuestionType {
  const t = (type || "").toLowerCase().trim();
  if (t.includes("true") || t.includes("false") || t === "tf") return "true_false";
  if (t.includes("word") || t.includes("bank") || t === "word_box") return "word_box";
  if (t.includes("ident") || t.includes("fill") || t.includes("blank")) return "identification";
  if (t.includes("enum")) return "enumeration";
  return "multiple_choice";
}

function getTypeBadgeLabel(type: string): string {
  const norm = normalizeQuestionType(type);
  if (norm === "true_false") return "TRUE / FALSE";
  if (norm === "identification") return "IDENTIFICATION";
  if (norm === "enumeration") return "ENUMERATION";
  if (norm === "word_box") return "WORD BOX";
  return "MULTIPLE CHOICE";
}

/**
 * Builds dynamic instructions depending on whether the assessment is a single type
 * (Multiple Choice, True/False, Identification, Enumeration) or a Mixed Assessment.
 */
function buildInstructionsHtml(questions: ScannableQuestion[]): string {
  const rawTypes = questions.map((q) => normalizeQuestionType(q.type));
  const uniqueTypes = Array.from(new Set(rawTypes));

  // Single-type assessments
  if (uniqueTypes.length === 1) {
    const type = uniqueTypes[0];
    if (type === "true_false") {
      return `
        <div class="instructions-strip">
          <strong>Instructions (True or False):</strong> Read each statement carefully. Write <strong>T</strong> if the statement is True and <strong>F</strong> if False clearly inside the answer box on the right.
        </div>
      `;
    }
    if (type === "identification") {
      return `
        <div class="instructions-strip">
          <strong>Instructions (Identification):</strong> Read each statement or question carefully. Identify the correct term or concept and write your answer clearly inside the answer box on the right.
        </div>
      `;
    }
    if (type === "enumeration") {
      return `
        <div class="instructions-strip">
          <strong>Instructions (Enumeration):</strong> Enumerate or list the required items for each question. Write each item clearly inside its corresponding numbered box (#1, #2, ...) on the right.
        </div>
      `;
    }
    // Default: multiple_choice
    return `
      <div class="instructions-strip">
        <strong>Instructions (Multiple Choice):</strong> Read each question and choices carefully. Write the letter of your chosen answer (A, B, C, or D) clearly inside the answer box on the right.
      </div>
    `;
  }

  // Single-type Word Box
  if (uniqueTypes.length === 1 && uniqueTypes[0] === "word_box") {
    return `
      <div class="instructions-strip">
        <strong>Instructions (Word Box):</strong> Read each question carefully. Choose the correct answer from the word bank provided below each question and write it clearly inside the answer box on the right.
      </div>
    `;
  }

  // Mixed Assessment: provide tailored instructions for each question type present
  return `
    <div class="instructions-strip">
      <div class="instruction-heading"><strong>General Instructions (Mixed Assessment):</strong> Read each question carefully and write your answers inside the designated box(es) on the right:</div>
      <div class="mixed-instructions-inline">
        ${uniqueTypes.includes("multiple_choice") ? `<span class="mixed-rule">• <strong>Multiple Choice:</strong> Write single letter (A, B, C, or D)</span>` : ""}
        ${uniqueTypes.includes("true_false") ? `<span class="mixed-rule">• <strong>True / False:</strong> Write <strong>T</strong> if True, <strong>F</strong> if False</span>` : ""}
        ${uniqueTypes.includes("identification") ? `<span class="mixed-rule">• <strong>Identification:</strong> Write the exact term, word, or name</span>` : ""}
        ${uniqueTypes.includes("enumeration") ? `<span class="mixed-rule">• <strong>Enumeration:</strong> Write one item per numbered box</span>` : ""}
        ${uniqueTypes.includes("word_box") ? `<span class="mixed-rule">• <strong>Word Box:</strong> Choose the correct word from the word bank and write it in the answer box</span>` : ""}
      </div>
    </div>
  `;
}

/**
 * Builds a clean, professional single-sheet HTML document formatted specifically
 * for 1-page printing on Short (8.5x11") or Long (8.5x13") bond paper, optimized
 * for single-shot camera scanning by the Tseki Vision Grader.
 */
export function buildPaperSheetHtml({
  assessment,
  classTitle = "Classroom Assessment",
  subject = "General Subject",
  includeAnswerKey = false,
  paperSize = "short",
}: ExportPaperOptions): string {
  const totalPoints = assessment.answerKey.reduce((sum, k) => sum + (k.points || 1), 0);
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const isLongPaper = paperSize === "long";
  const pageSizeCss = isLongPaper ? "8.5in 13in" : "8.5in 11in";
  const paperName = isLongPaper ? "Long Bond Paper (8.5\" × 13\")" : "Short Bond Paper (8.5\" × 11\")";

  const questionCount = assessment.questions.length;
  // Use 2 columns if more than 5 questions so everything fits on 1 sheet of bond paper
  const isTwoColumn = questionCount > 5;

  const rawTypes = assessment.questions.map((q) => normalizeQuestionType(q.type));
  const isMixed = new Set(rawTypes).size > 1;

  const instructionsHtml = buildInstructionsHtml(assessment.questions);

  const questionsHtml = assessment.questions
    .map((q) => {
      const answerObj = assessment.answerKey.find((k) => k.questionNumber === q.questionNumber);
      const rawCorrectAnswer = answerObj ? answerObj.correctAnswer : "";
      const points = answerObj ? answerObj.points : 1;

      const normType = normalizeQuestionType(q.type);
      const boxCount = Math.max(1, q.answerBoxesRequired || 1);
      const isTextFill = normType === "identification";
      const isEnum = normType === "enumeration";
      const isWordBox = normType === "word_box";

      // Format answer for answer key
      let formattedAnswer = rawCorrectAnswer;
      if (normType === "true_false") {
        const lower = rawCorrectAnswer.trim().toLowerCase();
        if (lower === "true" || lower === "t") formattedAnswer = "T";
        else if (lower === "false" || lower === "f") formattedAnswer = "F";
      }

      // Options row (for multiple choice or true/false — NOT word_box)
      let optionsHtml = "";
      if (!isWordBox && q.options && q.options.length > 0) {
        optionsHtml = `
          <div class="options-row">
            ${q.options
            .map((opt) => `<span class="option-text">${escapeHtml(opt)}</span>`)
            .join("")}
          </div>
        `;
      }

      // Word Bank box (for word_box type)
      let wordBankHtml = "";
      if (isWordBox && q.options && q.options.length > 0) {
        wordBankHtml = `
          <div class="word-bank-box">
            <div class="word-bank-label">📦 WORD BANK</div>
            <div class="word-bank-chips">
              ${q.options.map((opt) => `<span class="word-bank-chip">${escapeHtml(opt)}</span>`).join("")}
            </div>
          </div>
        `;
      }

      // Parse enumeration items if answer key is included
      let enumItems: string[] = [];
      if (includeAnswerKey && isEnum) {
        enumItems = rawCorrectAnswer
          .split(/(?:^|\s*)[,\n;]+(?:\s*)|(?:\d+[\.\)]\s*)/g)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (enumItems.length === 0 && rawCorrectAnswer) {
          enumItems = [rawCorrectAnswer];
        }
      }

      const boxesHtml = `
        <div class="boxes-cluster ${isEnum && boxCount > 1 ? "boxes-vertical" : ""}">
          ${Array.from({ length: boxCount })
          .map((_, idx) => {
            let filledText = "";
            if (includeAnswerKey) {
              if (isEnum) {
                filledText = enumItems[idx] || (idx === 0 ? rawCorrectAnswer : "");
              } else if (idx === 0) {
                filledText = formattedAnswer;
              }
            }

            const boxClass = isTextFill ? "box-wide" : isEnum ? "box-enum" : isWordBox ? "box-wide" : "box-square";
            const watermark = isEnum && boxCount > 1 && !filledText ? `<span class="box-watermark">#${idx + 1}</span>` : "";

            return `
              <div class="answer-box ${boxClass}">
                ${watermark}
                ${filledText ? `<span class="answer-key-text">${escapeHtml(filledText)}</span>` : ""}
              </div>
            `;
          })
          .join("")}
        </div>
      `;

      return `
        <div class="question-row">
          <div class="q-body">
            <div class="q-statement">
              <span class="q-num">${q.questionNumber}.</span>
              ${isMixed ? `<span class="q-type-badge">${getTypeBadgeLabel(q.type)}</span>` : ""}
              <span class="q-text">${escapeHtml(q.questionText)}</span>
              ${points > 1 ? `<span class="q-pts">(${points}pts)</span>` : ""}
            </div>
            ${optionsHtml}
            ${wordBankHtml}
          </div>
          <div class="q-box-cell">
            ${boxesHtml}
          </div>
        </div>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(assessment.quizTitle)}</title>
  <style>
    @page {
      size: ${pageSizeCss} portrait;
      margin: 6mm 8mm 6mm 8mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #111827;
      font-size: ${questionCount > 15 ? "9.5px" : "10px"};
      line-height: 1.25;
      background: #FFFFFF;
      overflow: hidden;
    }

    /* ── Header ── */
    .sheet-header {
      border-bottom: 2px solid #000000;
      padding-bottom: 4px;
      margin-bottom: 5px;
    }
    .header-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-title-wrap {
      flex: 1;
      padding-right: 12px;
    }
    .org-banner {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.6px;
      color: #4B5563;
      text-transform: uppercase;
    }
    .main-title {
      font-size: 14px;
      font-weight: 800;
      color: #000000;
      margin: 1px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .class-meta {
      font-size: 9.5px;
      color: #374151;
      font-weight: 600;
    }

    /* High-contrast Score Box for quick grading */
    .score-badge-box {
      width: 72px;
      height: 40px;
      border: 2px solid #000000;
      border-radius: 4px;
      text-align: center;
      background-color: #FAFAFA;
      display: flex;
      flex-direction: column;
      justify-content: center;
      flex-shrink: 0;
    }
    .score-badge-label {
      font-size: 7.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #374151;
    }
    .score-badge-val {
      font-size: 12px;
      font-weight: 800;
      color: #000000;
    }

    /* Student info line */
    .student-fields-row {
      display: grid;
      grid-template-columns: 2.5fr 1fr 1fr;
      gap: 12px;
      margin-top: 4px;
      font-size: 9.5px;
    }
    .field-pair {
      display: flex;
      align-items: flex-end;
    }
    .field-pair strong {
      font-weight: 700;
      margin-right: 4px;
      white-space: nowrap;
    }
    .field-underline {
      flex: 1;
      border-bottom: 1px solid #111827;
      height: 13px;
    }

    /* Concise Instructions */
    .instructions-strip {
      background-color: #F3F4F6;
      border-left: 3px solid #111827;
      padding: 3px 8px;
      font-size: 8.8px;
      color: #374151;
      margin-bottom: 5px;
      border-radius: 0 3px 3px 0;
      line-height: 1.35;
    }
    .instruction-heading {
      font-size: 8.5px;
      margin-bottom: 2px;
    }
    .mixed-instructions-inline {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      margin-top: 2px;
    }
    .mixed-rule {
      font-size: 8.2px;
      color: #1F2937;
    }

    /* ── Questions Layout ── */
    .questions-grid {
      display: ${isTwoColumn ? "grid" : "flex"};
      grid-template-columns: ${isTwoColumn ? "1fr 1fr" : "none"};
      flex-direction: ${isTwoColumn ? "none" : "column"};
      gap: ${questionCount > 15 ? "4px 14px" : "6px 16px"};
    }

    .question-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: ${questionCount > 15 ? "3px" : "4px"};
      border-bottom: 1px dashed #E5E7EB;
      page-break-inside: avoid;
    }

    .q-body {
      flex: 1;
      padding-right: 8px;
    }
    .q-statement {
      color: #111827;
      line-height: 1.25;
    }
    .q-num {
      font-weight: 800;
      color: #000000;
      margin-right: 2px;
    }
    .q-type-badge {
      display: inline-block;
      font-size: 7.5px;
      font-weight: 800;
      color: #374151;
      background-color: #E5E7EB;
      padding: 0.5px 4px;
      border-radius: 3px;
      margin-right: 3px;
      vertical-align: middle;
      letter-spacing: 0.2px;
    }
    .q-text {
      font-weight: 600;
      color: #1F2937;
      font-size: ${questionCount > 15 ? "9.5px" : "10px"};
    }
    .q-pts {
      font-size: 8.5px;
      color: #6B7280;
      margin-left: 2px;
    }

    /* Options: clean text list */
    .options-row {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 8px;
      margin-top: 2px;
      padding-left: 12px;
    }
    .option-text {
      font-size: ${questionCount > 15 ? "8.5px" : "9px"};
      color: #374151;
      font-weight: 500;
    }

    /* ── High-Contrast Black Answer Box (Camera Detection Optimized) ── */
    .q-box-cell {
      flex-shrink: 0;
      padding-top: 1px;
    }
    .boxes-cluster {
      display: flex;
      gap: 3px;
    }
    .boxes-vertical {
      flex-direction: column;
      gap: 2px;
    }
    .answer-box {
      border: 2px solid #000000;
      border-radius: 2px;
      background-color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .box-square {
      width: 25px;
      height: 25px;
    }
    .box-wide {
      width: 75px;
      height: 25px;
      padding: 0 4px;
    }
    .box-enum {
      width: 75px;
      height: 22px;
      padding: 0 4px;
    }
    .box-watermark {
      font-size: 7.5px;
      font-weight: 700;
      color: #9CA3AF;
    }
    .answer-key-text {
      font-size: 9.5px;
      font-weight: 800;
      color: #2563EB;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    /* Compact Footer */
    .sheet-footer {
      position: absolute;
      bottom: 3mm;
      left: 8mm;
      right: 8mm;
      display: flex;
      justify-content: space-between;
      font-size: 8px;
      color: #9CA3AF;
      border-top: 1px dashed #E5E7EB;
      padding-top: 2px;
    }
  </style>
</head>
<body>
  <div class="sheet-header">
    <div class="header-top-row">
      <div class="header-title-wrap">
        <div class="org-banner">Tseki Smart Assessment System • ${paperName}</div>
        <div class="main-title">${escapeHtml(assessment.quizTitle)}</div>
        <div class="class-meta">${escapeHtml(classTitle)} • ${escapeHtml(subject)}</div>
      </div>
      <div class="score-badge-box">
        <div class="score-badge-label">Score</div>
        <div class="score-badge-val">____ / ${totalPoints}</div>
      </div>
    </div>

    <div class="student-fields-row">
      <div class="field-pair">
        <strong>Name:</strong>
        <div class="field-underline"></div>
      </div>
      <div class="field-pair">
        <strong>Date:</strong>
        <div class="field-underline" style="padding-left: 4px;">${currentDate}</div>
      </div>
      <div class="field-pair">
        <strong>Section:</strong>
        <div class="field-underline"></div>
      </div>
    </div>
  </div>

  ${instructionsHtml}

  <div class="questions-grid">
    ${questionsHtml}
  </div>

  <div class="sheet-footer">
    <span>Tseki 1-Sheet Vision Grader Form • ${assessment.questions.length} Items</span>
    <span>SINGLE PAGE ONLY (Do not detach)</span>
  </div>
</body>
</html>
`;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates a PDF file guaranteed to fit on 1 single sheet of Short or Long bond paper,
 * and launches the system print / share / save sheet.
 */
export async function exportPaperSheet(options: ExportPaperOptions): Promise<string> {
  const html = buildPaperSheetHtml(options);

  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return "";
  }

  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
  });

  const paperLabel = options.paperSize === "long" ? "Long Bond Paper" : "Short Bond Paper";

  await shareAsync(uri, {
    UTI: ".pdf",
    mimeType: "application/pdf",
    dialogTitle: `Export ${options.assessment.quizTitle} (${paperLabel})`,
  });

  return uri;
}
