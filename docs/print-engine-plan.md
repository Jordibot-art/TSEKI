# Print Engine Plan (v2 – updated after Step 0 review)

---

## 0. Startup Status

**`npm install`** — succeeded (exit 0). 57 vulnerabilities noted (1 low / 43 moderate / 12 high / 1 critical); none are in pdf-lib, fontkit, XLSX, or qrcode-generator. No action needed before starting.

**`npx expo start -c`** — Metro started and cached successfully. React Compiler enabled. No errors observed at startup.

---

## 1. Existing `lib/printEngine` File Inventory

The previous attempt left these files committed on HEAD (now showing as *deleted* in the working tree because a rollback was done). For each:

| File | Decision | Reason |
|---|---|---|
| `types.ts` | ✅ **Reuse with edits** | Already has `PrintPackage`, `LayoutJSON`, `LayoutItem`, `LayoutPage`, `MarkerRect`, `FitResult`, `BoxRect`. Needs `questionNumber`, `subIndex`, `maxChars`, `rect` (rename `box → rect`) per review item 2. |
| `constants.ts` | ✅ **Reuse with edits** | `CORNER_MARKER.size` is 14 pt — correct. QR size is 54 pt — OK. Add `MODULE_MIN_PT = 1.5`. |
| `index.ts` | ✅ **Reuse with edits** | `generatePrintPackage` API is correct. Return shape updated to match review item 3. |
| `measure.ts` | ✅ **Reuse with edits** | Module-level font cache is correct. Convert to singleton loading asset bytes once. |
| `fitDecision.ts` | ✅ **Reuse with edits** | Logic correct; wire to asset-loaded font. |
| `markers.ts` | ✅ **Reuse as-is** | Draws 4 corner squares + safe-zone guard. |
| `qrStamp.ts` | ✅ **Reuse with edits** | Must use `qrcode-generator`, ECL M, size 54–60 pt, module ≥ 1.5 pt. |
| `bookletRenderer.ts` | ✅ **Reuse with edits** | Wire font, update layout coord export. |
| `answerSheetRenderer.ts` | ✅ **Reuse with edits** | Wire font, update coord export, enforce 1-page (2 max) limit. |
| `allInOneRenderer.ts` | ✅ **Reuse with edits** | Wire font, update coord export. |
| `answerKeyRenderer.ts` | ✅ **Reuse with edits** | Needs teacher key table format per sample images. |
| `layoutJson.ts` | ✅ **Reuse with edits** | Update types to new schema. |
| `versionShuffle.ts` | ✅ **Reuse as-is** | Mulberry32 deterministic shuffle correct; Set A = original order. |
| `mobileShare.ts` | ✅ **Reuse as-is** | Handles Sharing + FileSystem write. |
| `smokeTest.ts` | ✅ **Reuse with edits** | Must report font load, layout, PDF build, file write separately. |
| `fonts/embedFonts.ts` | ✅ **Reuse with edits** | Change to load from asset file, not the base64 TS module. |
| `fonts/notoSansFonts.ts` | ❌ **DELETE** | 1.5 MiB of base64 in JS — wrong approach (see Font section). |
| `__tests__/fixtures/sampleQuizzes.ts` | ✅ **Reuse with edits** | Add Filipino-name quiz, symbol quiz, too-long-answer fixture. |
| `__tests__/fontSymbolsTest.ts` | ✅ **Reuse** | Keep. |
| `__tests__/runStep1Tests.ts` | ✅ **Reuse with edits** | Update assertions to new types. |
| `__tests__/runStep2Tests.ts` | ✅ **Reuse with edits** | Change visual comparison to pdfjs-dist + canvas. |
| `__tests__/runStep3Tests.ts` | ✅ **Reuse with edits** | Update to new LayoutJSON schema. |
| `__tests__/runExcelScoreTest.ts` | ✅ **Reuse with edits** | 3 students × 2 quizzes test (Step 6). |
| `__tests__/runSmokeTestCheck.ts` | ✅ **Reuse with edits** | Extend with per-phase timing assertions. |
| `__tests__/targetExportTest.ts` | ✅ **Reuse** | Validates target='LAYOUT_ONLY' path. |
| `lib/scoreExportService.ts` | ❌ **DELETE** | Scores-only export moves into `classListParserService.ts`. No second service. |
| `migrations/add_layout_json_to_archived_assessments.sql` | ✅ **Reuse as-is** | Correct ALTER TABLE. |
| `scripts/generateFontData.ts` | ❌ **DELETE** | Not needed once font is an asset file. |
| `scripts/renderSamplePdfs.ts` | ✅ **Reuse with edits** | Switch to pdfjs-dist + canvas. |

---

## 2. Font Loading: Asset File, Not Base64 JS

### Why the base64 approach was wrong
`fonts/notoSansFonts.ts` was 1.5 MiB of inline base64 strings. This is decoded into memory **at JS parse time**, doubling peak RAM and inflating the Metro bundle. It is not the Expo-recommended pattern.

### Correct approach in Expo
1. Copy `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` into `assets/fonts/`.
2. Register them in `app.json` under `expo.fonts` so they are bundled in the native binary.
3. In `embedFonts.ts`, read the bytes with `expo-asset` + `expo-file-system`:

```ts
// lib/printEngine/fonts/embedFonts.ts
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

async function loadFontBytes(assetModule: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();               // no-op if already bundled
  const b64 = await FileSystem.readAsStringAsync(asset.localUri!, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
```

4. Cache the decoded `Uint8Array` in a module-level singleton — file read happens **once per app session**.
5. Each `PDFDocument` calls `doc.embedFont(cachedBytes)` which **subsets only used glyphs** — the subset in a typical 40-item quiz is well under 50 KB.

### Why this is possible in Expo
`expo-asset` + `expo-file-system` work in Expo Go, dev builds, and production builds. The `localUri` of a bundled asset is always a readable file path on device. No additional native module is needed.

**Font sizes on disk:** NotoSans-Regular.ttf ~550 KB; NotoSans-Bold.ttf ~560 KB. The Metro bundle saves ~400 KB vs. the old base64 approach.

---

## 3. LayoutJSON Full Schema

All coordinates use **PDF points** (1/72 inch). `y = 0` is the **top** of the page; `y` increases downward. Conversion from pdf-lib's bottom-origin coordinate happens once in `layoutJson.ts`:

```ts
// lib/printEngine/layoutJson.ts
// pdf-lib uses y from BOTTOM. We standardize on y from TOP:
//   topY = pageHeight - (pdfBottomY + rectHeight)
// This matches camera image coordinate systems where y=0 is the top-left pixel.
export const topY = (pdfBottomY: number, rectHeight: number, pageHeight: number) =>
  pageHeight - pdfBottomY - rectHeight;
```

```ts
// lib/printEngine/types.ts — canonical schema

export type BoxType = 'letter' | 'tf' | 'text' | 'word_box';

export interface Rect {
  x: number;      // left edge, points from left of page
  y: number;      // top edge, points from TOP of page (NOT pdf-lib native)
  width: number;
  height: number;
}

export interface MarkerRect extends Rect {
  corner: 'TL' | 'TR' | 'BL' | 'BR';
}

export interface QRRect extends Rect {
  content: string;  // "<quizId>|<version>|<docType>|<page>/<totalPages>"
}

export interface LayoutItem {
  questionNumber: number;   // 1-based, continuous across parts
  subIndex?: number;        // enumeration sub-boxes: 1, 2, 3 → label "37.1", "37.2" …
  type: BoxType;
  rect: Rect;               // exact box position on the page
  maxChars: number;         // max accepted answer length in characters
}

export interface LayoutPage {
  pageNumber: number;
  markers: MarkerRect[];    // always exactly 4
  qr: QRRect;
  items: LayoutItem[];
}

export interface LayoutJSON {
  quizId: string;
  version: 'A' | 'B' | 'C';
  pageSize: { width: number; height: number }; // in points
  pages: LayoutPage[];
  answerVariants: AnswerVariant[];              // accepted answers per question
  createdAt: string;                           // ISO 8601
}
```

---

## 4. PrintPackage Result Type

```ts
export interface PrintPackage {
  studentPdf:     Uint8Array;           // question booklet (SEPARATE) or combined (ALL-IN-ONE)
  answerSheetPdf?: Uint8Array;          // SEPARATE mode only
  answerKeyPdf:   Uint8Array;           // teacher answer key (always generated)
  layoutJson:     LayoutJSON;           // grader coordinate map
  mode:           'ALL_IN_ONE' | 'SEPARATE';
  fontSize:       number;               // actual font size used (pt)
  pages:          number;               // page count of the student document
  fitMessage:     string;               // e.g. "Fits on 1 page at 10.5 pt"
}
```

There is **no** `pdfBase64` field. Callers that need base64 use `uint8ArrayToBase64()` in `index.ts`.

---

## 5. Mixed Assessment Part Ordering

- Parts follow **the order the teacher ticked them** in the UI (I, II, III in tick order).
- Extra questions go to the **first ticked types** in tick order.
- **No alphabetical sort.** Tick order is canonical.
- The Gemini prompt requests questions in part order (all Part I first, then Part II, etc.).
- Version shuffle (mulberry32) shuffles question *positions* on the answer sheet but does not change part assignments.

---

## 6. QR Code Specification

| Parameter | Value |
|---|---|
| Library | `qrcode-generator` |
| Error correction | M (15% recovery) |
| Overall size | 54 – 60 pt (target 56 pt) |
| Module minimum | 1.5 pt |
| Content format | `<quizId>\|<version>\|<docType>\|<page>/<totalPages>` |
| Example content | `QZ-20261101-40\|A\|SHEET\|1/1` |
| Placement | Top-right of every page, outside corner marker safe zone |

**Decode test:** Use `pdfjs-dist` to render the page to a PNG buffer (Node), then decode with `jsQR`. Runs in `__tests__/runStep2Tests.ts` — not on device.

---

## 7. Visual Comparison Tool

Use **`pdfjs-dist` + `canvas`** (Node.js) in `scripts/renderSamplePdfs.ts`:
- Renders each page to a PNG buffer on desktop.
- No native modules, no device needed.
- Compare with reference images in `docs/` using `pixelmatch` or `sharp.diff`.
- Threshold: ≤ 2% pixel difference acceptable (font hinting may vary slightly).

Do **not** use `react-native-pdf` or pdf-lib for visual checks — neither runs in Node.

---

## 8. Page Limits

| Document | Limit |
|---|---|
| Answer sheet | 1 page; overflow to "Sheet 2 of 2" allowed; hard max 2 pages |
| Question booklet | No hard limit; font-fit algorithm applies only in ALL-IN-ONE mode |
| ALL-IN-ONE student sheet | 1 page; if it doesn't fit at min font size → switch to SEPARATE |
| Answer key | 1 page typical; overflow to page 2 allowed |

---

## 9. Excel Export Clarification

### Existing roster export — do not change
- Button: **"Download Excel (.xlsx)"** in classroom screen (`classroom.tsx` line 996).
- Calls `generateExcelClasslistBase64()` from `lib/classListParserService.ts`.
- Exports a **student roster** with names, email, attendance, average grade percentage.
- This must remain completely unchanged.

### New scores-only export (Feature B, Step 6)
- A new function `generateScoreExportBase64(options: ScoreExportOptions): string` added to `lib/classListParserService.ts` (not a separate file, not a new library).
- Called from a new **"Export Quiz Scores (.xlsx)"** button in the Grader/results screen (Step 7).
- **Rules:**
  - One row per student, one column per quiz (header = quiz title).
  - Score cell = plain number: `{ t: 'n', v: 20 }` — not a string, not a percentage.
  - Blank cell (not `"-"`) if student did not take the quiz.
  - No percentages, grades, remarks, ranks, or averages.
- **Test (Step 6):** 3 students × 2 quizzes. Asserts: correct header row, numeric score cells, blank cell for skipped quiz.

---

## 10. Teacher Answer Key PDF

Format matches the sample provided:

```
TEACHER COPY - ANSWER KEY
<Quiz Title>

#      | Type            | Correct answer           | Points | Grader rule
-------|-----------------|--------------------------|--------|---------------------------
1      | Multiple choice | B                        | 1      | Single letter
4      | True / False    | T                        | 1      | T or F only
6      | Identification  | DATA CENTER              | 1      | Accept DATACENTER, DATA-CENTER
12.1–12.3 | Enumeration  | TOWER, RACK, BLADE       | 3      | 1 pt per box, no order, no repeats

Grading notes:
• Quiz ID: QZ-... | Version A | N items | N points
• Each page has its own QR code (quiz ID, version, page number).
• Scan the 4 corner squares first to straighten the photo, then read each answer box.
• Normalize OCR text: uppercase, trim spaces, strip punctuation.
• Send any box where OCR confidence is low to the teacher review screen.
```

### Answer Variants
```ts
export interface AnswerVariant {
  questionNumber: number;
  accepted: string[];   // e.g. ["DATA CENTER", "DATACENTER", "DATA-CENTER"]
  maxChars: number;
  type: QuestionType;
}
```
Stored in `layoutJson.answerVariants[]`.

### Answer Length Validation
- Fill-in-blank, identification, and enumeration: **1–3 words, ≤ 25 characters**.
- Rule injected into the Gemini prompt.
- After generation, answers > 25 chars are flagged in the builder review screen (Step 7).
- Box width sized from the longest accepted variant (capped at 25 chars → ~256 pt at Noto Sans 10 pt).

---

## 11. Migration File

**File:** `migrations/add_layout_json_to_archived_assessments.sql`

```sql
-- Tseki Print Engine: adds layout_json column to archived_assessments
ALTER TABLE archived_assessments
  ADD COLUMN IF NOT EXISTS layout_json JSONB DEFAULT NULL;

COMMENT ON COLUMN archived_assessments.layout_json IS
  'Top-origin coordinate map of all answer boxes and registration markers, used by the camera grader.';
```

**Do not run it automatically.** Command to apply:
```
supabase db push
```

---

## 12. Step 5 Grader Approach (On-Device, No Edge Function)

1. Teacher taps "Scan" in the Grader tab.
2. Camera captures full-resolution photo.
3. **Shrink to ~1600 px wide** with `expo-image-manipulator`.
4. **Detect 4 corner squares** on the small image: threshold the image, find 4 solid-black blobs near the corners (known position ± tolerance). Pure JS — no WASM, no Edge Function.
5. **Compute perspective transform**: map detected corners to known PDF corner positions.
6. **Crop each answer box**: map `LayoutItem.rect` through the transform, crop with `expo-image-manipulator`.
7. **Return crops** as URIs to the existing OCR logic.
8. **Low-confidence fallback**: < 4 corners found, or degenerate transform → `confidence = 'low'` for all boxes → existing review screen handles them.

**Expo Go vs. dev build:** All steps work in Expo Go. A dev build is needed only if high-resolution image memory exceeds Expo Go limits (unlikely at 1600 px).

---

## 13. Performance Requirements (Acceptance Criteria)

### Targets (measure on real device, release/preview build — NOT Expo Go or dev mode)

| Operation | Target |
|---|---|
| Publish (save + layout-only pass) | < 0.3 s |
| Background PDF generation (40-item quiz) | ~ 2 s |
| Open cached PDF | < 1 s |
| Excel export (40 students × 10 quizzes) | ~ 1.5 s |

**These are targets, not claimed measurements. Real numbers will be reported in the Step 4 smoke test. The smoke test must report separately: font load, layout pass, PDF build, file write.**

### Architecture rules

**Publish is non-blocking:**
1. Publish → save quiz metadata → run layout-only pass (math only, no `doc.save()`) → write `layoutJson` to Supabase → return.
2. Kick off PDF generation via `InteractionManager.runAfterInteractions()`.
3. Show a non-blocking "Preparing print files…" chip; dismiss on completion.

**PDF caching:**
- Key: `{quizId}_{version}_{contentHash}` (`contentHash` = fast hash of serialized questions).
- Storage: `FileSystem.cacheDirectory + 'tseki_pdfs/'`.
- Invalidation: if quiz `updated_at` changes → regenerate; otherwise serve the cached file.

**Font singleton:**
- `getFontSingleton()` loads asset bytes once per app session.
- `doc.embedFont(bytes)` subsets per document (only glyphs used in that quiz).

**Chunked build:**
- Generate one PDF page per chunk; yield to UI between pages via `setTimeout(resolve, 0)`.

**Excel export:**
- One Supabase query for all quiz results (no N+1).
- One synchronous pass with SheetJS `aoa_to_sheet`.
- Write to `FileSystem.cacheDirectory`, then share.
- Use existing `xlsx` library; do not add another.

### If a goal cannot be met
Report: which goal, measured time, and a concrete fix proposal before proceeding to the next step.

---

## 14. File Map

```
lib/printEngine/
  index.ts               — generatePrintPackage(), uint8ArrayToBase64(), mergePdfs()
  types.ts               — PrintOptions, PrintPackage, LayoutJSON, LayoutItem, LayoutPage, Rect …
  constants.ts           — page dims, margins, corner size, QR config, font config, answer-box config
  measure.ts             — measureTextWidth(), wrapText(), measureQuestionHeight(), getFontSingleton()
  fitDecision.ts         — decideFit(): tries 11 → 10.5 → 10 pt, returns FitResult
  markers.ts             — drawCornerMarkers(page, dims)
  qrStamp.ts             — stampQR(page, content, position)
  bookletRenderer.ts     — renderBookletPDF()
  answerSheetRenderer.ts — renderAnswerSheetPDF()
  allInOneRenderer.ts    — renderAllInOnePDF()
  answerKeyRenderer.ts   — renderAnswerKeyPDF()
  layoutJson.ts          — buildLayoutJSON(), topY() coordinate conversion
  versionShuffle.ts      — shuffleAssessmentForVersion() — mulberry32
  mobileShare.ts         — sharePdfFile(), cacheAndOpenPdf()
  smokeTest.ts           — runSmokeTest() — per-phase timings
  fonts/
    embedFonts.ts        — getFontSingleton(), embedPrintFonts(doc)
    notoSansFonts.ts     — DELETED

assets/fonts/
  NotoSans-Regular.ttf   — new (replaces base64 module)
  NotoSans-Bold.ttf      — new (replaces base64 module)

lib/classListParserService.ts
  generateExcelClasslistBase64()    — roster export (UNCHANGED)
  generateScoreExportBase64()       — NEW: scores-only (Feature B, Step 6)

migrations/
  add_layout_json_to_archived_assessments.sql  — DO NOT RUN; apply with: supabase db push
```

---

## 15. PDF Layout Appearance

### Question Booklet
- **Header:** `TSEKI SMART ASSESSMENT SYSTEM | QUESTION BOOKLET` · QR code top-right
- **Sub-header:** Quiz title (bold large) · `BSIT-4 | Quiz 2 | Version A`
- **Banner:** `Do NOT write on this booklet. Write every answer on your ANSWER SHEET.`
- **Body:** Two-column layout, Noto Sans 11/10.5/10 pt
- **Parts:** `TEST I | MULTIPLE CHOICE (12 pts)` + instruction line, continuous numbering
- **Word box:** `WORD BANK` table with lettered choices, embedded between parts
- **Footer:** `Tseki Question Booklet | QZ-… | Version A | 40 Items — Do not write … | Page 1 of 2`

### Answer Sheet
- Corner squares (14 pt solid black) at all 4 corners
- QR code every page
- Letter/TF sections: 8-per-row compact grids (25 × 27 pt boxes)
- Text sections (Fill-in, Identification): wide 2-column boxes (~256 pt wide)
- Enumeration: 3-column sub-boxes labeled `37.1`, `37.2` …
- Instructions: dark ink, CAPS, one answer per box
- Footer: `Sheet 1 of 1` / `Sheet 2 of 2`

### Teacher Answer Key
- Title: `TEACHER COPY - ANSWER KEY`
- Table: `# | Type | Correct answer | Points | Grader rule`
- Enumeration span rows: `12.1–12.3 | Enumeration | TOWER, RACK, BLADE | 3 | 1 pt per box`
- Grading notes at bottom

---

*v2 — updated after Step 0 review. No feature code written yet.*
