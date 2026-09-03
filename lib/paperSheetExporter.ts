import * as Print from "expo-print";
import { shareAsync } from "expo-sharing";
import { Platform } from "react-native";
import { GeneratedAssessment } from "./quizGeneratorService";

export type BondPaperSize = "short" | "long";

export interface ExportPaperOptions {
    assessment: GeneratedAssessment;
    classTitle?: string;
    subject?: string;
    includeAnswerKey?: boolean;
    paperSize?: BondPaperSize; // "short" (8.5x11") or "long" (8.5x13")
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

    const questionsHtml = assessment.questions
        .map((q) => {
            const answerObj = assessment.answerKey.find((k) => k.questionNumber === q.questionNumber);
            const correctAnswer = answerObj ? answerObj.correctAnswer : "";
            const points = answerObj ? answerObj.points : 1;

            let optionsHtml = "";
            if (q.options && q.options.length > 0) {
                optionsHtml = `
          <div class="options-row">
            ${q.options
                .map((opt) => `<span class="option-text">${escapeHtml(opt)}</span>`)
                .join("")}
          </div>
        `;
            }

            const boxCount = Math.max(1, q.answerBoxesRequired || 1);
            const isTextFill = q.type === "fill_blank";

            const boxesHtml = `
        <div class="boxes-cluster">
          ${Array.from({ length: boxCount })
                .map((_, idx) => {
                    const filledText = includeAnswerKey && idx === 0 ? escapeHtml(correctAnswer) : "";
                    return `
              <div class="answer-box ${isTextFill ? "box-wide" : "box-square"}">
                ${filledText ? `<span class="answer-key-text">${filledText}</span>` : ""}
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
              <span class="q-text">${escapeHtml(q.questionText)}</span>
              ${points > 1 ? `<span class="q-pts">(${points}pts)</span>` : ""}
            </div>
            ${optionsHtml}
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
      padding: 2.5px 8px;
      font-size: 9px;
      color: #374151;
      margin-bottom: 6px;
      border-radius: 0 3px 3px 0;
    }

    /* ── Questions Layout (Clean, authentic paper format — NO outer boxes!) ── */
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
      border-bottom: 1px dashed #E5E7EB; /* Clean, subtle separator line */
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

    /* Options: clean text list (no bulky pills) */
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
    .answer-box {
      border: 2px solid #000000;
      border-radius: 2px;
      background-color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .box-square {
      width: 25px;
      height: 25px;
    }
    .box-wide {
      width: 60px;
      height: 25px;
    }
    .answer-key-text {
      font-size: 10.5px;
      font-weight: 800;
      color: #2563EB;
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

  <div class="instructions-strip">
    <strong>Instructions:</strong> Write your answer clearly inside the black box on the right. For multiple choice, write the single letter (A, B, C, D). Fits on 1 single sheet.
  </div>

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
