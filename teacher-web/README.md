# TSEKI · Teacher Web Portal

An intelligent, cloud-synced web companion for Cebu Eastern College (CEC) educators, built alongside the TSEKI mobile assessment application.

---

## 🌟 Key Features

1. **Authentication & Session Management**
   - Direct Supabase Authentication integration matching the mobile app.
   - Protected routes and session persistence with automatic token refresh.

2. **Teacher Dashboard (`/dashboard`)**
   - High-level KPIs: Active Classrooms, Enrolled Students, Assessments Published, and At-Risk Alert counts.
   - Recent classroom cards with theme colors and live student counts.
   - Recent assessment list with status badges and quick actions.

3. **Classroom & Roster Hub (`/classrooms`, `/classrooms/:id`)**
   - Complete classroom creation modal with subject, section, room, schedule, and custom color palette.
   - Full student roster management with search, add student, delete, and cumulative score averages.
   - Student Profile inspection modal displaying individual performance trends and TSEKI pedagogical remediation advice.

4. **AI Assessment Builder & Paper Sheet Exporter (`/assessments`)**
   - **AI-Calibrated Generation**: Prompts calibrated to Bloom's Taxonomy (Recall, Understanding, Application, Analysis, Synthesis).
   - **Question Types**: Multiple Choice (A, B, C, D), True/False (T/F), Identification, Enumeration, and Mixed formats.
   - **Instagram-Style 7-Day Auto-Expiry**: Draft countdown badges with live time-remaining calculations.
   - **Printable Bond-Paper Sheet Exporter**: 1-click preview and print engine supporting Philippine Short (8.5×11") and Long (8.5×13") bond paper with machine-readable optical answer boxes for mobile camera OCR grading.
   - Optional printable official Answer Key sheets.

5. **Pedagogical Analytics & Diagnostics (`/analytics`)**
   - Class average score distribution breakdown (Mastery, Proficient, Developing, Needs Support).
   - **TSEKI Pedagogical Advisor**: Automated instructional recommendations, peer-tutoring pairing suggestions, and targeted intervention strategies.
   - Bloom's Taxonomy mastery progress indicators across cognitive domains.
   - Item diagnostics flagging hardest questions (<50% accuracy) and distractor misconceptions.
   - At-Risk Student Intervention Priority Table (scores ≤50%).

6. **Settings & Preferences (`/settings`)**
   - Faculty profile with Cebu Eastern College affiliation.
   - Default bond paper size preferences (Short vs. Long).
   - Customizable At-Risk threshold slider (40% - 70%).
   - Generative AI engine model selection (`gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-2.5-flash`).
   - Seamless Dark Mode / Light Mode theme toggle.

---

## 🛠 Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **Routing**: React Router v7 (`react-router-dom`)
- **Backend & DB**: Supabase Cloud (`@supabase/supabase-js`)
- **Icons**: Lucide React
- **Design System**: Vanilla CSS Modules with rich variables, HSL color ramps, and dark mode tokens

---

## 🚀 Getting Started

### Development Server
```bash
cd teacher-web
npm run dev
```

### Production Build
```bash
cd teacher-web
npm run build
```
