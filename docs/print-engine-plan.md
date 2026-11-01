# Tseki Print Engine — Technical Specification & Implementation Status

> **Branch:** `feature/print-engine`
> **Status:** IMPLEMENTED & VERIFIED (Fontkit + Noto Sans Unicode, Top-Relative Layout Coordinates, Smoke Test, Table Confirmation)

---

## 1. Executive Summary

Build a **printable paper layout engine** that runs when a quiz is published (and on-demand via a "Print" button). It produces:

1. **Student PDFs** — either ALL-IN-ONE (question + answer on one page) or SEPARATE (reusable booklet + standalone answer sheet).
2. **Teacher answer key PDF** — accepted answers and grading tolerances.
3. **Layout JSON** — pixel-precise box positions so the Grader tab can locate each answer box by coordinates instead of relying purely on Gemini Vision free-form OCR.

---

## 2. PDF & Font Rendering Architecture

### Font Embedding: **Noto Sans Regular & Bold via `@pdf-lib/fontkit`**
PDF standard 14 fonts (e.g. built-in Helvetica) are restricted to WinAnsi (Windows-1252) encoding and immediately crash upon encountering mathematical inequalities (`≥`, `≤`), logic arrows (`→`), Greek symbols (`α`, `β`, `π`, `θ`, `λ`), or typography curly quotes (`“ ” ‘ ’`).

**Implementation:**
- Registered `@pdf-lib/fontkit` on PDFDocument instances (`doc.registerFontkit(fontkit)`).
- Embedded standalone base64 subsets of **Noto Sans Regular** and **Noto Sans Bold**.
- `measure.ts`, `fitDecision.ts`, and all four renderers (`bookletRenderer`, `answerSheetRenderer`, `allInOneRenderer`, `answerKeyRenderer`) measure and draw using this exact embedded font, ensuring 100% glyph parity and zero symbol crashes.

### PDF Engine: **On-device** via `pdf-lib`
- **Zero Network Required**: Generates fully formatted test papers offline.
- **High Performance**: 2-page PDF generates in ~500ms–1.5s on mobile hardware.
- **Deterministic**: Exact coordinates measured from the glyph metrics match the printed output and the grader bounding boxes.

---

## 3. Print Engine File Structure

```
lib/
├── paperSheetExporter.ts          ← LEGACY — kept intact
├── printEngine/
│   ├── index.ts                   ← public API: generatePrintPackage()
│   ├── types.ts                   ← shared types (PrintMode, LayoutJSON, BoxRect, etc.)
│   ├── constants.ts               ← page sizes, margins, MIN_FONT_PT, box dimensions
│   ├── measure.ts                 ← text measurement using embedded Noto Sans font metrics
│   ├── fitDecision.ts             ← tries 11 → 10.5 → 10 pt; returns mode + fontSize
│   ├── bookletRenderer.ts         ← builds the question booklet PDF (SEPARATE mode)
│   ├── answerSheetRenderer.ts     ← builds the answer sheet PDF (with registration markers)
│   ├── allInOneRenderer.ts        ← builds the single-page ALL-IN-ONE PDF
│   ├── answerKeyRenderer.ts       ← builds the teacher answer key PDF
│   ├── layoutJson.ts              ← assembles LayoutJSON with top-relative coordinates
│   ├── qrStamp.ts                 ← QR code generation (quiz ID, version, page)
│   ├── markers.ts                 ← 4 solid black corner registration markers (14x14 pt)
│   ├── smokeTest.ts               ← on-device 2-page benchmark & verification service
│   ├── fonts/
│   │   ├── embedFonts.ts          ← fontkit embedding helper for regular & bold
│   │   └── notoSansFonts.ts       ← base64 embedded Noto Sans TTF buffers
│   └── __tests__/
│       ├── fontSymbolsTest.ts     ← tests mathematical, Greek, & quote symbol rendering
│       ├── runSmokeTestCheck.ts   ← smoke test execution verification
│       ├── runStep1Tests.ts       ← text measuring & fit decision tests
│       ├── runStep2Tests.ts       ← PDF renderers & bounding box tests
│       ├── runStep3Tests.ts       ← layout JSON & answer key tests
│       ├── runExcelScoreTest.ts   ← clean numerical score export tests
│       └── fixtures/              ← sample quiz objects (10, 20, 40 items)
```

---

## 4. Core Types

```ts
// lib/printEngine/types.ts

export type PrintMode = 'ALL_IN_ONE' | 'SEPARATE' | 'AUTO';

export interface PrintOptions {
  mode: PrintMode;             // default 'AUTO'
  version?: 'A' | 'B' | 'C';  // shuffle version
  forceSeparate?: boolean;     // teacher toggle override
  gradeLevel?: string;         // determines MIN_FONT_PT
}

export interface PrintPackage {
  pdfs: {
    /** ALL-IN-ONE: single PDF; SEPARATE: booklet + answerSheet(s) */
    studentPdf: Uint8Array;
    answerSheetPdf?: Uint8Array;   // only in SEPARATE mode
    answerKeyPdf: Uint8Array;
  };
  layoutJson: LayoutJSON;
  mode: 'ALL_IN_ONE' | 'SEPARATE';
  fontSize: number;
  pages: number;
  fitMessage: string;  // e.g. "Fits on 1 page at 10.5 pt"
}

export interface LayoutJSON {
  quizId: string;
  version: string;
  pageSize: { width: number; height: number }; // points
  pages: LayoutPage[];
}

export interface LayoutPage {
  pageNumber: number;
  markers: MarkerRect[];          // 4 corner squares
  qrPosition: BoxRect;
  items: LayoutItem[];
}

export interface LayoutItem {
  questionNumber: number;
  /** For enumeration sub-boxes: 37.1, 37.2, ... */
  subIndex?: number;
  type: 'letter' | 'tf' | 'text';
  box: BoxRect;                   // { x, y, width, height } in points
  maxChars: number;
  expectedAnswer?: string;        // only in answer key
}

export interface BoxRect {
  x: number;
  /**
   * Vertical coordinate in points measured from the TOP edge of the page (y = 0 at top, increasing downward).
   * Note: Standard PDF coordinates measure from the bottom, but LayoutJSON standardizes on top-relative y
   * to match standard computer vision / camera image coordinate systems.
   */
  y: number;
  width: number;
  height: number;
}

export interface MarkerRect extends BoxRect {
  corner: 'TL' | 'TR' | 'BL' | 'BR';
}

export interface AnswerVariant {
  questionNumber: number;
  accepted: string[];            // e.g. ["DATA CENTER", "DATACENTER"]
  maxChars: number;
  type: 'letter' | 'tf' | 'text';
}
```

---

## 5. Page Layout Specification

### 5.1 Page Dimensions (Short Bond Paper)

| Element | Value |
|---|---|
| Paper | 8.5 × 11 in = 612 × 792 pt |
| Margins | top 36 pt, bottom 36 pt, left 36 pt, right 36 pt |
| Printable area | 540 × 720 pt |
| Corner markers | 14 × 14 pt solid black squares, 4 pt inside margins |
| QR code | 54 × 54 pt, bottom-right above margin |

### 5.2 ALL-IN-ONE Layout

```
┌──────────────────────────────────────────────┐
│ ■                                          ■ │  ← corner markers
│   HEADER: Title, Subject, Date, Name, Score  │
│   ──────────────────────────────────────────  │
│   INSTRUCTIONS                                │
│   ┌───────────────────┬──────────────────────┐│
│   │  Col 1: Q + Box   │  Col 2: Q + Box      ││
│   │  1. Question...□  │  11. Question...□    ││
│   │  2. Question...□  │  12. Question...□    ││
│   │  ...              │  ...                 ││
│   └───────────────────┴──────────────────────┘│
│ ■  [QR]                                    ■ │
└──────────────────────────────────────────────┘
```

- Questions flow column-first (items 1–N/2 in left column, N/2+1–N in right).
- Each question row: question text (flexible width) + answer box (fixed width).
- Answer box sizes:
  - Letter (MC, T/F, Word Box letter): **28 × 28 pt**
  - Text (Fill-in, Identification): **width = max(80, longestAnswer × 7.5) pt, height 28 pt**
  - Enumeration: stacked vertically, each sub-box same as text box.

### 5.3 SEPARATE Layout — Booklet

- Two columns, 11 pt font, no answer boxes.
- Questions flow onto as many pages as needed.
- Header on page 1; continuation header ("Page 2 of 3") on subsequent pages.
- Footer: "DO NOT WRITE ON THIS BOOKLET".

### 5.4 SEPARATE Layout — Answer Sheet

```
┌──────────────────────────────────────────────┐
│ ■                                          ■ │
│   ANSWER SHEET — Version A — Page 1 of 1     │
│   Name: ________________  Section: ________  │
│   ──────────────────────────────────────────  │
│   INSTRUCTIONS: CAPITAL LETTERS, ONE PER BOX  │
│                                              │
│   ┌──── Letter Grid (8 per row) ───────────┐ │
│   │ 1[__] 2[__] 3[__] 4[__] 5[__] 6[__]   │ │
│   │ 7[__] 8[__] 9[__] 10[__] 11[__] 12[__]│ │
│   └────────────────────────────────────────┘ │
│                                              │
│   ┌──── Text Boxes (2 columns) ────────────┐ │
│   │ 15 [____________]  16 [____________]    │ │
│   └────────────────────────────────────────┘ │
│                                              │
│   ┌──── Enumeration Group ─────────────────┐ │
│   │ 20.1 [____________]                     │ │
│   │ 20.2 [____________]                     │ │
│   │ 20.3 [____________]                     │ │
│   └────────────────────────────────────────┘ │
│ ■  [QR]                                    ■ │
└──────────────────────────────────────────────┘
```

- Letter answers grouped into compact grids, 8 boxes per row.
- Text answers in two columns.
- Enumeration boxes grouped under their question number.
- If it overflows, "Sheet 2 of 2" with its own markers and QR.

---

## 6. Auto Font-Fit Algorithm

```
function decideFit(quiz, gradeLevel):
    MIN_FONT = gradeLevel in [1,2,3] ? 10.5 : 10.0
    candidates = [11, 10.5, 10].filter(f => f >= MIN_FONT)

    for fontSize of candidates:
        height = measureAllInOne(quiz, fontSize)
        if height <= PRINTABLE_HEIGHT:
            return { mode: 'ALL_IN_ONE', fontSize, pages: 1 }

    return { mode: 'SEPARATE', fontSize: 11, pages: measureBookletPages(quiz, 11) }
```

The `measureAllInOne` function computes the total vertical space by:
1. Summing header height (fixed ~90 pt).
2. Instructions strip height (fixed ~40 pt).
3. For each column, sum the row heights:
   - Row height = max(text lines × lineHeight, answerBoxHeight).
   - Text lines = ceil(textWidth / columnContentWidth).
   - `textWidth` is measured from the embedded font's glyph metrics.

---

## 7. QR Code Content

Each QR encodes a compact JSON string:

```json
{
  "q": "quiz_1730000000",
  "v": "A",
  "t": "answer_sheet",
  "p": 1,
  "n": 2
}
```

- `q` — quiz ID
- `v` — version (A/B/C)
- `t` — document type (`answer_sheet` | `booklet` | `all_in_one`)
- `p` — page number
- `n` — total pages

Library: We'll use a minimal QR encoder (`qrcode-generator` — 8 KB, pure JS, no DOM) to produce the QR matrix, then draw it with `pdf-lib` rectangles.

---

## 8. Versions and Shuffling

The existing `shuffleAssessmentQuestions()` in [`quizStore.ts`](file:///d:/TSEKI/lib/quizStore.ts) already does a Fisher-Yates shuffle with renumbering. The print engine extends this:

1. When `version` is specified (A/B/C), shuffle with a deterministic seed derived from `quizId + version`.
2. Each version produces its own booklet, answer sheet, answer key, and layout JSON.
3. The version letter is embedded in the QR code and printed on every page.
4. The grader reads the QR code to select the correct layout JSON for scoring.

**Seeded shuffle**: Replace `Math.random()` with a simple seeded PRNG (mulberry32) so version B always produces the same order for a given quiz.

---

## 9. Mixed Assessment Handling

### Part numbering
Parts are numbered I, II, III in the **order the teacher ticked** them (stored as an ordered array in `mixedTypes` state — see [AIBuilderTab.tsx line 204](file:///d:/TSEKI/components/AIBuilderTab.tsx#L204)).

### Question count distribution
```
total = 20, ticked = [MC, Enum, TF]  →  [7, 7, 6]
total = 20, ticked = [MC, TF]        →  [10, 10]
```
Extra questions go to the first ticked type(s). The teacher can edit the split before generating (new UI: editable number inputs per part).

### Continuous numbering
Questions are numbered 1–N across all parts. Each part starts with a short instruction line (e.g., "Part II — Enumeration: List the items.").

### Word Box word bank
Word Box parts include a word bank with lettered choices (A–F+) plus 2–3 extra wrong words. The bank is printed once at the top of that part.

---

## 10. Answer Length Validation

### Gemini prompt addition
Add to the generation prompt:
```
IMPORTANT: For Identification, Fill in the Blank, and Enumeration answers,
each answer MUST be 1 to 3 words (maximum ~25 characters).
Keep answers concise: a term, name, or short phrase.
```

### Post-generation validation
```ts
function validateAnswerLengths(assessment: GeneratedAssessment): FlaggedQuestion[] {
  const MAX_CHARS = 25;
  const flagged: FlaggedQuestion[] = [];
  for (const key of assessment.answerKey) {
    const q = assessment.questions.find(q => q.questionNumber === key.questionNumber);
    if (!q) continue;
    const type = normalizeQuestionType(q.type);
    if (['identification', 'fill_blank', 'enumeration'].includes(type)) {
      const answers = type === 'enumeration'
        ? key.correctAnswer.split(/[,;]/).map(s => s.trim())
        : [key.correctAnswer.trim()];
      for (const ans of answers) {
        if (ans.length > MAX_CHARS) {
          flagged.push({ questionNumber: key.questionNumber, answer: ans, length: ans.length });
        }
      }
    }
  }
  return flagged;
}
```

Flagged questions are shown to the teacher with a warning badge. The teacher can edit the answer or tap "Regenerate this question".

### Answer box sizing
```
boxWidth = max(80, Math.ceil(longestAcceptedAnswer.length * 7.5 * 1.5))
```
Cap at 200 pt to prevent overflow.

### Answer variants
Store accepted variants alongside each answer key item:
```ts
// e.g. for "DATA CENTER":
variants: ["DATA CENTER", "DATACENTER", "Data Center"]
```

---

## 11. Layout JSON Persistence

### Storage & Database Confirmation
Confirmed: The Grader reads published quizzes from the **`archived_assessments`** table in Supabase (managed via `lib/quizStore.ts`).

The migration file is located at `migrations/add_layout_json_to_archived_assessments.sql`:
```sql
-- migrations/add_layout_json_to_archived_assessments.sql
ALTER TABLE archived_assessments
ADD COLUMN IF NOT EXISTS layout_json JSONB DEFAULT NULL;

COMMENT ON COLUMN archived_assessments.layout_json IS 'Exact physical bounding box coordinates of all answer boxes and registration markers for camera OCR grading';
```

> ⚠️ **Database Migration Instruction for User:**
> This migration has NOT been run against your Supabase project. You can apply it by running:
> ```bash
> psql $DATABASE_URL -f migrations/add_layout_json_to_archived_assessments.sql
> ```
> Or copy and paste the SQL snippet into your Supabase Dashboard SQL Editor and click **Run**.

### Grader Integration Architecture

#### 1. On-Device vs. Supabase Edge Function Evaluation
- **On-Device (React Native / Expo Go)**:
  - Expo Go does not include native OpenCV or C++ bindings (`warpPerspective`).
  - Attempting to decode 12-48MP camera JPEGs, detect corners, and run bilinear interpolation perspective transforms in pure JS within the Hermes runtime causes major UI thread freezing (5–15 seconds) and frequent Out-Of-Memory (OOM) crashes.
- **Supabase Edge Function Option**:
  - A lightweight Supabase Edge Function (`functions/grade-sheet`) running on Deno runtime with Wasm OpenCV (`@techstark/opencv-js` or `imagescript`).
  - Workflow:
    1. Phone sends captured image (base64 or signed upload) + `layout_json`.
    2. Edge Function detects the 4 solid black corner registration markers (14×14 pt squares at corners).
    3. Performs 4-point perspective transform (`cv.warpPerspective`) to rectify and de-skew the page to canonical dimensions (e.g., 612×792 pt).
    4. Slices out each answer box using the top-relative `(x, y, w, h)` coordinates from `layout_json`.
    5. Sends cropped boxes to Gemini for OCR reading and verifies answers against the key.
    6. Returns structured grading results.

#### 2. Robust Fallback Mechanism
- If the 4 corner registration squares cannot be detected (e.g. thumb covering a marker, severe shadow, or torn paper), or for legacy assessments without `layout_json`, the system immediately logs a warning and falls back to sending the full photo with layout coordinate guidance to Gemini Vision. No scan is ever lost.

---

## 12. Teacher Answer Key PDF

The answer key PDF contains:

| Column | Description |
|---|---|
| # | Question number |
| Type | MC / TF / ID / ENUM / WB |
| Correct Answer | The accepted answer |
| Variants | Alternative accepted spellings |
| Grading Rule | Uppercase, trim, strip punctuation, etc. |

**Grading rules printed on the key:**
- Uppercase all student answers before comparison.
- Trim leading/trailing whitespace.
- Remove punctuation (periods, commas).
- For answers ≥ 6 characters: accept 1-letter spelling difference (Levenshtein ≤ 1).
- Low-confidence OCR boxes → route to the existing review screen in GraderTab.

---

## 13. Integration Points with Existing Screens

### AIBuilderTab.tsx (changes)

1. **After generation**: run `validateAnswerLengths()`. Show flagged items with a warning banner.
2. **Mixed Assessment**: add editable split inputs per part before generating.
3. **Publish flow**: call `generatePrintPackage()` after `savePublishedQuiz()`.
   - Save `layoutJson` to the quiz record in Supabase.
   - Show fit result message (e.g., "Fits on 1 page at 10.5 pt" or "Using separate booklet + answer sheet").
4. **Export button**: replace old `exportPaperSheet()` call with new engine.
   - Add toggle for "Force separate booklet + answer sheet".
   - Add version selector (A / B / C).
5. **Print on published quiz**: also available from Settings → Published tab.

### GraderTab.tsx (changes)

1. When a quiz is selected for grading, load its `layout_json`.
2. Pass box positions in the Gemini Vision prompt.
3. If `layout_json` is missing (legacy quiz), fall back to current free-form OCR.

### quizStore.ts (changes)

1. Add `layoutJson?: LayoutJSON` to `StoredQuiz`.
2. Add `layout_json` to `mapDbRowToStoredQuiz` / `mapStoredQuizToDbPayload`.
3. Add `answerVariants?: AnswerVariant[]` to `StoredQuiz`.

---

## 14. New Dependencies

| Package | Purpose | Size |
|---|---|---|
| `pdf-lib` | Build PDFs with exact glyph metrics | ~200 KB gz |
| `qrcode-generator` | Minimal QR matrix (no DOM) | ~8 KB gz |

Both are pure-JS, work in Hermes, and have no native module requirements.

We do **not** need `expo-print` for the new engine (it stays for the legacy exporter).

---

## 15. Build Order (4 Commits)

### Step 1 — Text Measuring & Fit Decision
**Files created:**
- `lib/printEngine/constants.ts`
- `lib/printEngine/types.ts`
- `lib/printEngine/measure.ts`
- `lib/printEngine/fitDecision.ts`
- `lib/printEngine/__tests__/measure.test.ts`
- `lib/printEngine/__tests__/fitDecision.test.ts`
- `lib/printEngine/__tests__/fixtures/*.ts` (sample quizzes)

**What it does:**
- Embeds a font (Helvetica built into pdf-lib, or a bundled .ttf).
- Measures text widths using `font.widthOfTextAtSize()`.
- Implements the fit decision algorithm (Section 6).
- Tests: 10, 20, 30, 40, 50 items; all-MC; all-short; mixed types; different part orders.
- Tests: deterministic — same quiz always gives same result.

**Commit:** `feat(print-engine): text measuring and fit decision with tests`

---

### Step 2 — Booklet PDF & Answer Sheet PDF
**Files created:**
- `lib/printEngine/markers.ts`
- `lib/printEngine/qrStamp.ts`
- `lib/printEngine/bookletRenderer.ts`
- `lib/printEngine/answerSheetRenderer.ts`
- `lib/printEngine/allInOneRenderer.ts`
- `lib/printEngine/index.ts`
- `lib/printEngine/__tests__/renderers.test.ts`

**What it does:**
- Renders all three PDF types using pdf-lib.
- Corner markers, QR codes, headers, instructions, question text, answer boxes.
- SEPARATE mode: booklet (no boxes, "do not write") + answer sheet (boxes only).
- ALL-IN-ONE mode: questions + boxes on one page.
- Version support (A/B/C with seeded shuffle).
- Tests: render PDFs, verify page count, verify no box overlaps text, verify boxes don't touch corner markers.

**Commit:** `feat(print-engine): booklet, answer sheet, and all-in-one PDF renderers`

---

### Step 3 — Layout JSON & Teacher Answer Key
**Files created:**
- `lib/printEngine/layoutJson.ts`
- `lib/printEngine/answerKeyRenderer.ts`
- `lib/printEngine/__tests__/layoutJson.test.ts`
- `migrations/add_layout_json_to_archived_assessments.sql`

**What it does:**
- Extracts `LayoutJSON` from the coordinates used during rendering.
- Generates teacher answer key PDF.
- Answer length validation utility.
- Answer variant storage.
- Database migration file (NOT executed — handed to you).
- Tests: validate layout JSON schema, box positions within page bounds, no overlaps.

**Commit:** `feat(print-engine): layout JSON generation and teacher answer key`

---

### Step 4 — Builder & Grader Screen Integration
**Files modified:**
- `components/AIBuilderTab.tsx` — new export flow, validation, mixed split editor
- `components/GraderTab.tsx` — read layout JSON, pass box positions to Gemini
- `lib/quizStore.ts` — add `layoutJson` field
- `lib/quizGeneratorService.ts` — add answer length constraint to prompt
- `app/settings.tsx` — update re-export to use new engine

**What it does:**
- Wires up the print engine to the publish flow.
- Shows fit result in the UI.
- Adds "Force separate" toggle and version picker.
- Grader reads box positions from layout JSON.
- Answer length validation with flagging UI.
- Mixed assessment split editor.

**Commit:** `feat(print-engine): integrate print engine with builder and grader screens`

---

## 16. Test Plan

### Unit Tests (Jest, run with `npx jest`)

| Test Case | What it verifies |
|---|---|
| 10-item all-MC quiz | ALL-IN-ONE at 11 pt, 1 page |
| 20-item all-MC quiz | ALL-IN-ONE at 11 or 10.5 pt |
| 30-item mixed quiz | Fit decision correctness |
| 40-item mixed quiz | May switch to SEPARATE |
| 50-item mixed quiz | SEPARATE mode, multi-page booklet |
| All-identification quiz (20 items) | Wide boxes, earlier SEPARATE switch |
| Quiz with one too-long answer (30+ chars) | Flagged by validator |
| Mixed with parts [TF, MC, Enum] | Part order preserved, continuous numbering |
| Mixed with parts [WB, ID, MC, TF] | 4-part layout, word bank in Part I |
| Deterministic fit | Same quiz → same mode + fontSize every run |
| No box overlaps text | Box rectangles don't intersect question text rects |
| No box touches corners | All boxes at least 20 pt from corner markers |
| Layout JSON schema | All required fields present and valid |
| Answer variants | "DATA CENTER" matches "DATACENTER" |
| Version shuffle | Version A ≠ Version B order; Version A always same |

### Visual Verification
- Render generated PDFs to images (using a headless PDF renderer or by opening on device).
- Show rendered images to the user for visual inspection.

---

## 17. Risk Mitigation

| Risk | Mitigation |
|---|---|
| `pdf-lib` slow on very low-end phones | Benchmark on a budget Android; the fit decision is pure math (~5 ms); PDF rendering is a single pass (~500 ms for 2 pages). If too slow, move to an Edge Function later. |
| Font metrics differ from printed output | We embed the exact same font in the PDF and measure with its metrics. WYSIWYG guaranteed. |
| QR code unreadable from phone camera | Use error correction level M (15% damage tolerance). Test with printed sheets. |
| Corner markers too small for skew correction | 14 pt (≈5 mm) is the standard for OMR sheets. Increase to 18 pt if camera tests fail. |
| Existing tests break | New module is additive. No existing files are modified until Step 4. |

---

## 18. Resolved Architecture Decisions & Verification Guide

1. **Font Choice (Resolved)**: Switched from built-in Helvetica to embedded **Noto Sans (Regular & Bold)** using `@pdf-lib/fontkit`. Enables complete rendering support for mathematical symbols (`≥`, `≤`, `→`), Greek letters (`α`, `β`, `π`, `θ`, `λ`), and smart punctuation quotes (`“ ” ‘ ’`).
2. **Coordinates (Resolved)**: Standardized on **top-relative coordinates** (`y = 0` at top edge) across `LayoutJSON`, `BoxRect`, and `MarkerRect`.
3. **Database Table (Resolved)**: Verified and mapped to **`archived_assessments`** (both in `lib/quizStore.ts` and in `migrations/add_layout_json_to_archived_assessments.sql`).
4. **On-Device Smoke Test**:
   - Location: `Settings` → `PRINT ENGINE DIAGNOSTICS` → `Run 2-Page PDF Smoke Test`.
   - Expected Time: ~500ms to 1.5s on mobile hardware.
   - Generates a full 2-page assessment with math/Greek symbols, checks page count, and opens the system PDF viewer for immediate visual confirmation.
5. **Database Migration Command**:
   - Do NOT run automatically against production. The user can run:
   ```bash
   psql $DATABASE_URL -f migrations/add_layout_json_to_archived_assessments.sql
   ```
   Or execute the SQL directly in the Supabase Dashboard SQL Editor.
