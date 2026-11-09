# UI Refactor Plan: Production SaaS Aesthetic (Linear / Vercel / Raycast)

## Target App: TSEKI Teacher Web Portal (`teacher-web`)

### Global Design System Rules
- **90% Neutral / 10% Brand Accent:** Primary CTA retains `bg-orange-600 hover:bg-orange-700 text-white`. Secondary elements use sleek neutrals (`bg-zinc-900`, `border-zinc-200`, `bg-zinc-100`).
- **Crisp Borders Over Blurry Shadows:** `1px` structural borders (`border border-zinc-200/80 dark:border-zinc-800`) + micro-shadows (`shadow-xs` / `shadow-sm`). Main background `#FAFAFA` (`bg-zinc-50/80`), elevated cards `#FFFFFF`.
- **Tighter Radii & Control Proportions:** Modals/primary cards `rounded-xl`, controls `rounded-lg`, badges `rounded-md`. Controls standardized to `h-9` or `h-10` with `text-sm`. Numeric indicators with `tabular-nums`.

---

## File Modification Execution Checklist

### Setup: Global Design System Harmonization
- [x] Harmonize neutral palette (`zinc-50` to `zinc-900`), tokens, and tighter radii in `teacher-web/src/index.css`.
- [x] Configure crisp borders, micro-shadows, and `tabular-nums` utility.

### Step 1: App Shell & Left Sidebar
- **Files:** `teacher-web/src/layouts/AppLayout.tsx`, `teacher-web/src/layouts/AppLayout.module.css`
- [x] Tighten navigation items to `h-9 px-3 rounded-lg text-sm font-medium transition-colors`.
- [x] Active route styling: subtle tint (`bg-orange-50/70 text-orange-700 font-medium border border-orange-200/50`) instead of heavy solid block.
- [x] Consolidate bottom footer (`Dark Mode`, `John Ariel` profile, `Sign Out`) into a clean compact block separated by `border-t border-zinc-200/80`.
- [x] Style Sign Out as a subtle icon button / compact muted row instead of standalone red button.

### Step 2: Login View (`/login`)
- **Files:** `teacher-web/src/pages/LoginPage.tsx`, `teacher-web/src/pages/LoginPage.module.css`
- [x] Left Brand Column: Remove floating translucent circles. Replace with subtle SVG dot-matrix/micro-grid pattern overlay (`opacity-15`) on `bg-gradient-to-br from-orange-600 via-orange-600 to-amber-700`.
- [x] Style 4 feature bullets with structured check icons inside translucent square badges (`bg-white/10 border border-white/20 rounded-md p-1`).
- [x] Right Form Column: Constrain container to `max-w-sm w-full mx-auto`. Standardize inputs to `h-10 text-sm rounded-lg border-zinc-300 focus:border-orange-600 focus:ring-2 focus:ring-orange-500/15`.
- [x] Primary button: `h-10 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium text-sm`.

### Step 3: Dashboard View (`/dashboard`)
- **Files:** `teacher-web/src/pages/DashboardPage.tsx`, `teacher-web/src/pages/DashboardPage.module.css`
- [x] Greeting Header: Remove waving hand emoji (`👋`), add uppercase date/semester label (`text-xs font-medium tracking-wider uppercase text-zinc-400`). Primary CTA `+ New Classroom` with `bg-orange-600 hover:bg-orange-700 text-white h-9 px-3 text-sm rounded-lg`.
- [x] 4 KPI Stat Cards: Remove pastel rainbow icon boxes. High-density metric cards (`p-4 rounded-xl border border-zinc-200/80 bg-white`):
  - Top row: Metric label (`text-xs font-medium text-zinc-500`) left + `16px` monochrome icon (`text-zinc-400`) right.
  - Bottom row: Large tabular number (`text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums mt-2`). At-risk students highlighted amber/red only when `> 0`.
- [x] Classrooms & Recent Assessments Panels: Remove orange square icons from assessment rows. List separated by `divide-y divide-zinc-100` with compact padding (`py-3 px-4 hover:bg-zinc-50/60`), title, neutral classroom badge (`bg-zinc-100 text-zinc-600`), refined status pill, right-aligned tabular date.

### Step 4: Classrooms View (`/classrooms`)
- **Files:** `teacher-web/src/pages/ClassroomsPage.tsx`, `teacher-web/src/pages/ClassroomsPage.module.css`
- [x] Search Toolbar: Constrain search bar width to `max-w-sm w-full` (`h-9 text-sm rounded-lg`). Primary CTA `+ Add Classroom` with `bg-orange-600 hover:bg-orange-700 text-white h-9 px-4 text-sm rounded-lg`.
- [x] Classroom Cards: Remove thick orange top border (`border-t-4`). Use clean `1px` border (`border border-zinc-200/80 hover:border-zinc-300 rounded-xl p-5 bg-white transition-all`). Structured header (Subject + section badge), schedule row with muted clock icon, bottom metadata bar (`border-t border-zinc-100 pt-3 mt-4 flex items-center gap-3 text-xs text-zinc-500`).

### Step 5: Assessments & Tests View (`/assessments`)
- **Files:** `teacher-web/src/pages/AssessmentsPage.tsx`, `teacher-web/src/pages/AssessmentsPage.module.css`
- [x] Daily AI Quota Banner: Replace large peach box with compact inline status strip (`px-4 py-2.5 rounded-lg bg-zinc-50 border border-zinc-200/80 flex items-center justify-between text-xs`) with slim progress bar (`w-24 h-1.5 bg-zinc-200 rounded-full overflow-hidden` with `bg-orange-600` fill) and `tabular-nums` for `10 / 10 remaining today`.
- [x] Filter Bar: Place search input (`max-w-xs h-9 text-sm rounded-lg`) and `Status` / `Classroom` dropdowns (`h-9 text-sm rounded-lg bg-white border-zinc-200`) directly on canvas in single flex row.
- [x] Assessment Cards:
  - Remove orange document icon box.
  - Top row: Status badge (`bg-emerald-50 text-emerald-700 border border-emerald-200/60` or draft) + Grade badge (`bg-zinc-100 text-zinc-600`) left, muted trash icon (`text-zinc-400 hover:text-red-600`) right.
  - Footer buttons: `View & Questions` outline (`h-9 text-xs font-medium border border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded-lg`), `Print Sheets` dark neutral (`h-9 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg`).

### Step 6: AI Assessment Builder Modal
- **Files:** `teacher-web/src/pages/AssessmentsPage.tsx`, `teacher-web/src/pages/AssessmentsPage.module.css`
- [x] 3-Part Fixed Architecture (`max-w-xl w-full rounded-xl bg-white border border-zinc-200 shadow-xl overflow-hidden flex flex-col max-h-[85vh]`):
  1. Fixed Header (`px-6 py-4 border-b border-zinc-200 flex items-center justify-between shrink-0`): Title, subtitle, compact quota pill, close button.
  2. Scrollable Body (`px-6 py-5 overflow-y-auto space-y-4 flex-1`): Inputs/selects standardized to `h-9 text-sm rounded-lg`.
  3. Sticky Footer (`px-6 py-3.5 bg-zinc-50/80 border-t border-zinc-200 flex items-center justify-end gap-2.5 shrink-0`): Cancel (`h-9 px-4 text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg`), Generate CTA (`h-9 px-4 text-xs font-medium bg-orange-600 hover:bg-orange-700 text-white rounded-lg`).
- [x] Question Type Grid: 6 pills (`h-9 px-3 text-xs font-medium rounded-lg border transition-all`), selected: `border-orange-600 bg-orange-50/50 text-orange-700 ring-1 ring-orange-600`, unselected: `border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`.
- [x] Curriculum Dropzone: Neutral dropzone (`p-4 border border-dashed border-zinc-300 hover:border-zinc-400 rounded-lg bg-zinc-50/50 flex items-center justify-center gap-3 text-left`) with subtle neutral upload icon.

### Step 7: TSEKI Mobile Authentication & Brand Parity for `teacher-web`
- **Files:** `teacher-web/src/pages/LoginPage.tsx`, `teacher-web/src/pages/LoginPage.module.css`, `teacher-web/src/components/AnimatedTsekiLogo.tsx`, `teacher-web/src/components/AnimatedTsekiLogo.module.css`
- [x] Parity with `TSEKI MOBILE` (`app/index.tsx`):
  - Brand Mark: Circle with inner dot + `TSEKI` header.
  - Interactive Animated Mascot: `AnimatedTsekiLogo` with continuous gentle breathing float and waving arm animation, plus interactive hop on click.
  - Welcome View ("Hello !"): Friendly hero greeting with `LOGIN` and `SIGNUP` buttons.
  - Login View ("Welcome!"): Clean inputs, Remember Me persistence (`localStorage`), Forgot Password link, `LOGIN` CTA, and switch to Sign up.
  - Register View ("Hi!"): Full Name, Email, Password, Confirm Password, `SIGN UP` CTA, and switch to Sign in.
  - Verification View ("Verification"): 6-cell interactive OTP display with auto-focus, paste support, 60s resend timer, and `VERIFY` CTA.
  - Forgot Password Modal: Centered dialog for email-based reset via Supabase Auth with success confirmation.
- [x] App Sidebar & Header Logo: Replaced generic orange checkmark square with official TSEKI Mascot logo across expanded and collapsed sidebar states.
- [x] AI Assessment Generating Animation:
  - Eliminated header collision where modal title overlapped the animation.
  - Ported exact TSEKI Mobile [`AssessmentGeneratingAnimation.tsx`](file:///d:/TSEKI/components/AssessmentGeneratingAnimation.tsx): floating question card with subtle back deck card, Question 1..5 tag, 1pt badge, question stem skeleton, options A/B/C with alternating green `Key ✓` badge, sweeping laser synthesis beam with trail, pulsing dot, 4 sequential stages, smooth continuous forward progress bar, and tabular-nums live percentage.
  - Ported exact TSEKI Mobile [`PublishingQuizAnimation.tsx`](file:///d:/TSEKI/components/PublishingQuizAnimation.tsx): 4-corner calibration anchors, master key badge, scannable QR badge, locked key rows, sweeping laser beam, and smooth progress tracking.

### Step 8: Strict Export Restriction (Only Published Classroom Assessments Can Be Exported)
- **Files:** `teacher-web/src/pages/AssessmentsPage.tsx`, `teacher-web/src/pages/AssessmentsPage.module.css`
- [x] Removed "Export Paper Sheet (PDF)" button from the AI Assessment Builder generation/review modal. Users can only "Save 7-Day Draft" or "Publish to Classroom".
- [x] In the assessment cards grid: Draft cards now display "Publish Draft" instead of "Print Sheets". "Print Sheets" is strictly limited to published assessments (`quiz.status === "PUBLISHED"`).
- [x] In the View Assessment modal: Draft quizzes display an informational notice banner explaining that drafts cannot be exported to PDF, with a direct "Publish to Classroom" action button. Only published assessments display the "Print Scannable Sheet (PDF)" button.
- [x] Added guard inside `handleOpenExportModal` ensuring non-published assessments and drafts cannot open the PDF export modal.
- [x] Built and verified via `npm --prefix teacher-web run build`.

---

## Verification
- [x] Run `npm run build` in `teacher-web` to verify zero TypeScript errors, valid JSX, and successful bundling.
- [x] Inspect visual consistency across all targeted routes.
