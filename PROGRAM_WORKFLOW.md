# TSEKI (Check) - Program Workflow & System Architecture

> **Version:** 1.0.0  
> **Framework:** Expo SDK 54 / React Native 0.81  
> **Backend & Auth:** Supabase (PostgreSQL, Auth, Realtime)  
> **AI Engine:** Google Gemini AI (`gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-2.5-flash`)  
> **Storage & Cache:** AsyncStorage + Supabase Cloud Sync  

---

## 1. Executive Summary

**TSEKI** (a play on the Filipino word *"Tseki"* meaning "Check" / "Mark") is an intelligent, offline-capable mobile platform designed for teachers. It streamlines the full teaching-assessment lifecycle:
1. **Curriculum & Assessment Creation:** AI-assisted quiz generation from prompts or uploaded curriculum documents (PDF, DOCX, TXT), calibrated according to Bloom's Taxonomy.
2. **Standardized Paper Generation:** Formats assessments into printable bond-paper worksheets (Short 8.5×11" or Long 8.5×13") equipped with machine-readable, optical answer boxes.
3. **AI Vision Camera Grading:** Automated mobile grading that reads handwritten answers directly from physical test sheets via Gemini Multimodal Vision, matching them against digital answer keys with manual teacher override.
4. **Pedagogical Analytics & Diagnostics:** Instant item analysis (difficulty index, question-type breakdown) and actionable pedagogical guidance tailored for individual at-risk students and entire classrooms.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TD
    subgraph UI_Layer ["Client Application (Expo / React Native)"]
        AUTH["app/index.tsx<br/>(Auth, OTP, Session)"]
        HOME["app/homepage.tsx<br/>(Classroom Dashboard & Alerts)"]
        CLASS["app/classroom.tsx<br/>(Classroom Hub)"]
        SETTINGS["app/settings.tsx<br/>(Assessments & Profiles)"]

        subgraph TABS ["Classroom Screen Tabs"]
            TAB_RECORD["Record Tab<br/>(Student Roster & Profile)"]
            TAB_BUILDER["components/AIBuilderTab.tsx<br/>(Assessment Generator)"]
            TAB_GRADER["components/GraderTab.tsx<br/>(Camera Scanner & Optical Grader)"]
            TAB_TRACKER["components/TrackerTab.tsx<br/>(Analytics & Pedagogical Advisor)"]
        end
    end

    subgraph SERVICE_LAYER ["Core Service & Business Logic (lib/)"]
        PARSER["documentParserService.ts<br/>(PDF, DOCX, TXT Extract)"]
        GENERATOR["quizGeneratorService.ts<br/>(Gemini Prompting & Bloom Schema)"]
        EXPORTER["paperSheetExporter.ts<br/>(HTML-to-PDF Print Engine)"]
        GRADING["gradingService.ts<br/>(Gemini Vision Handwriting OCR)"]
        ADVICE["pedagogicalAdvice.ts<br/>(Heuristic & AI Teacher Advice)"]
        ANALYSIS["questionAnalysis.ts<br/>(Item Difficulty & Distractor Diagnostics)"]
        STORE["quizStore.ts & alertStore.ts<br/>(Dual-Layer Storage & Sync)"]
    end

    subgraph BACKEND_LAYER ["External Services & Cloud Infrastructure"]
        GEMINI["Google Gemini Generative AI<br/>(gemini-3.5-flash-lite / 3.6-flash)"]
        SUPABASE["Supabase Cloud<br/>(Postgres DB, Auth, Realtime)"]
        LOCAL_STORAGE["AsyncStorage<br/>(Offline Drafts, Theme, Fast Cache)"]
    end

    AUTH -->|Session Handshake| SUPABASE
    HOME --> CLASS
    HOME --> SETTINGS
    CLASS --> TAB_RECORD
    CLASS --> TAB_BUILDER
    CLASS --> TAB_GRADER
    CLASS --> TAB_TRACKER

    TAB_BUILDER --> PARSER
    TAB_BUILDER --> GENERATOR
    TAB_BUILDER --> EXPORTER
    TAB_BUILDER --> STORE

    TAB_GRADER --> GRADING
    TAB_GRADER --> ANALYSIS
    TAB_GRADER --> STORE

    TAB_TRACKER --> ANALYSIS
    TAB_TRACKER --> ADVICE
    TAB_RECORD --> ADVICE

    GENERATOR --> GEMINI
    GRADING --> GEMINI
    STORE --> SUPABASE
    STORE --> LOCAL_STORAGE
```

---

## 3. End-to-End Program Workflows

### 3.1 Workflow 1: Authentication & Teacher Onboarding
Controls teacher identity, persistent sessions, and secure verification.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant App as app/index.tsx
    participant Supa as Supabase Auth
    participant Async as AsyncStorage

    Teacher->>App: Launch TSEKI
    App->>Async: Check "tseki_remember_me"
    alt Remember Me == true & Session Active
        App->>Supa: Validate Session
        Supa-->>App: Session OK
        App->>App: Navigate to /homepage
    else No Active Session or Remember Me == false
        App->>Teacher: Show Welcome / Login Screen
    end

    alt New Teacher Registration
        Teacher->>App: Fill Name, Email, Password
        App->>Supa: supabase.auth.signUp()
        Supa-->>Teacher: Sends 6-Digit Email OTP
        App->>Teacher: Show OTP Verification Screen
        Teacher->>App: Enter 6-Digit Code
        App->>Supa: verifyOtp({ type: 'signup', token })
        Supa-->>App: Token Confirmed & Session Established
        App->>App: Navigate to /homepage
    else Existing Teacher Login
        Teacher->>App: Enter Email & Password (Toggle Remember Me)
        App->>Supa: supabase.auth.signInWithPassword()
        Supa-->>App: Auth Token Received
        App->>Async: Save "tseki_remember_me" = true/false
        App->>App: Navigate to /homepage
    end
```

---

### 3.2 Workflow 2: Classroom & Roster Management
Manages classes, subject sections, and student rosters.

```mermaid
flowchart TD
    A[Teacher lands on Homepage] --> B[Fetch Classrooms from Supabase]
    B --> C{Classrooms exist?}
    C -->|No| D[Display Empty State: 'Add your first class']
    C -->|Yes| E[Render Classroom Cards with Live Badges<br/>Students, Published Quizzes, Flagged At-Risk Count]

    A --> F[Tap '+ Add Classroom']
    F --> G[Modal: Enter Title, Subject, Section, Room, Schedule, Theme Color]
    G --> H[Save to Supabase 'classrooms' table]
    H --> B

    E --> I[Tap Classroom Card]
    I --> J[Navigate to /classroom with parameters]
    J --> K[Default Tab: 'Record']
    K --> L[View Roster List & Class Averages]
    K --> M[Add Student Modal: Full Name + Email]
    M --> N[Insert into Supabase 'students' table]
    N --> L
    L --> O[Tap Student Row -> Open Student Profile Modal]
    O --> P[View Student History, Weak Areas & TSEKI Pedagogical Advice]
```

---

### 3.3 Workflow 3: AI Assessment Generation & Paper Sheet Export (`AIBuilderTab`)
Generates pedagogical quizzes using Google Gemini AI, formats them with scannable answer boxes, and exports printable bond-paper PDFs.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant Tab as AIBuilderTab.tsx
    participant Parser as documentParserService.ts
    participant Engine as quizGeneratorService.ts
    participant Gemini as Google Gemini AI
    participant Store as quizStore.ts
    participant Exporter as paperSheetExporter.ts

    Teacher->>Tab: Select Subject, Grade (7-12), Question Type, Count, & Difficulty
    alt Document-Based Quiz Generation
        Teacher->>Tab: Upload File (PDF, DOCX, TXT)
        Tab->>Parser: parseDocumentFile(fileUri)
        Parser-->>Tab: Extracted Syllabus / Lesson Text
    else Topic-Based Quiz Generation
        Teacher->>Tab: Type Topic / Learning Competency
    end

    Teacher->>Tab: Tap "Generate Scannable Quiz"
    Tab->>Engine: generateScannableQuiz(params)
    Note over Engine,Gemini: Injects Bloom's Taxonomy Difficulty Prompts<br/>(Easy=Recall, Med=Application, Hard=Synthesis)<br/>and forces strict JSON output with scannable box layout
    Engine->>Gemini: Call gemini-3.5-flash-lite (fallback: 3.6-flash, 2.5-flash)
    Gemini-->>Engine: JSON { quizTitle, questions[], answerKey[] }
    Engine-->>Tab: Validated GeneratedAssessment Object

    Tab->>Teacher: Display Interactive Quiz Preview
    Teacher->>Tab: (Optional) Edit questions, options, or answer keys

    alt Save as 7-Day Expiring Draft
        Teacher->>Tab: Tap "Save Draft"
        Tab->>Store: saveDraftQuiz(classroomId, quiz)
        Note over Store: Attaches 7-day TTL (Instagram-style timer).<br/>Saves locally to AsyncStorage & syncs to cloud.
    else Publish to Classroom
        Teacher->>Tab: Tap "Publish Assessment"
        Tab->>Store: savePublishedQuiz(classroomId, quiz)
        Store-->>Tab: Status = "PUBLISHED" (Ready for Grader)
    end

    alt Print Physical Paper Sheets
        Teacher->>Tab: Tap "Export Paper Sheet"
        Teacher->>Tab: Select Bond Paper Size (Short 8.5x11" or Long 8.5x13")
        Tab->>Exporter: exportPaperSheet(options)
        Note over Exporter: Generates scannable HTML grid<br/>with student info header & black answer boxes
        Exporter->>Exporter: expo-print -> Generate PDF
        Exporter->>Teacher: expo-sharing -> Native Share / Print Dialog
    end
```

---

### 3.4 Workflow 4: Optical Scanning & AI Test Grading (`GraderTab`)
Automates paper grading using on-device cameras and Gemini Vision OCR.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant Grader as GraderTab.tsx
    participant Store as quizStore.ts
    participant Picker as expo-image-picker
    participant Engine as gradingService.ts
    participant Gemini as Google Gemini Vision
    participant Analysis as questionAnalysis.ts
    participant AlertStore as alertStore.ts
    participant Supa as Supabase (students table)

    Teacher->>Grader: Open Grader Tab
    Grader->>Store: getPublishedQuizzes(classroomId)
    Store-->>Grader: List of Published Assessments
    Teacher->>Grader: Select Target Quiz

    Teacher->>Grader: Tap "Scan Test Paper" (Camera or Gallery)
    Grader->>Picker: launchCameraAsync() / launchImageLibraryAsync()
    Picker-->>Grader: Captured Paper Image
    Grader->>Grader: Convert image to Base64

    Grader->>Engine: gradeStudentTest(imageBase64, answerKey)
    Note over Engine,Gemini: Sends image + official Answer Key.<br/>Prompts Gemini Vision to extract student name,<br/>OCR handwritten boxes, and match with Key.
    Engine->>Gemini: GenerateContent with Multimodal payload
    Gemini-->>Engine: JSON { studentName, totalScore, maxScore, results[] }
    Engine-->>Grader: Verified GradingResponse

    Grader->>Teacher: Display Interactive Score Banner & Item Breakdown
    Teacher->>Grader: (Optional) Adjust detected student name or override item marks

    Teacher->>Grader: Tap "Save Grade to Roster"
    Grader->>Analysis: saveStudentQuizResult(studentQuizResult)
    Grader->>Store: saveQuizPerformanceRecord(classroomId, record)
    Grader->>Supa: Recalculate and update student cumulative average

    alt Score <= 50% (At-Risk Threshold)
        Grader->>AlertStore: saveRosterAlert({ studentId, alertType: 'HIGH RISK', scorePercentage })
        Note over AlertStore: Generates Teacher Notification badge on Homepage
    end

    Grader-->>Teacher: Show Success Alert & Reset for Next Student Sheet
```

---

### 3.5 Workflow 5: Diagnostic Item Analysis & Pedagogical Advice (`TrackerTab`)
Transforms raw test results into actionable instructional insights.

```mermaid
flowchart TD
    A[Teacher opens Tracker Tab] --> B[Fetch Performance Records & Student Roster]
    B --> C[Compute Classroom Metrics: Class Average, Passing Rate, Grade Distribution]
    B --> D[Compute Item Analysis via questionAnalysis.ts]

    D --> E[Identify Hardest Questions: Accuracy < 50%]
    D --> F[Identify Easiest Questions: Accuracy > 80%]
    D --> G[Flag Misconceptions & Distractor Patterns]

    B --> H{Are students scoring <= 50%?}
    H -->|Yes| I[List At-Risk Students under 'Needs Support']
    H -->|No| J[Display 'All students performing on track']

    C & D & I --> K[pedagogicalAdvice.ts: generateClassroomAdvice]
    K --> L[Render TSEKI Pedagogical Advice Banner: Focus Topics, Small-group remediation, Pacing guidance]

    I --> M[Tap At-Risk Student]
    M --> N[pedagogicalAdvice.ts: generateStudentAdvice]
    N --> O[Displays tailored 1-on-1 remediation recommendations based on specific missed question types]
```

---

### 3.6 Workflow 6: Centralized Assessment Lifecycle & Settings (`SettingsScreen`)
Oversees global preferences, account credentials, and cross-classroom assessments.

```mermaid
flowchart TD
    A[Teacher opens Settings] --> B{Choose Setting Action}
    
    B --> C[Manage Profile]
    C --> C1[Edit Display Name -> supabase.auth.updateUser]
    C --> C2[Change Password -> supabase.auth.updateUser]
    
    B --> D[Theme Settings]
    D --> D1[Toggle Light / Dark Mode]
    D1 --> D2[Save preference to AsyncStorage & update ThemeContext]
    
    B --> E[Centralized Assessments Drawer]
    E --> E1[Drafts Tab]
    E1 --> E2[Shows All Drafts across all classes with 7-Day Countdown Badges]
    E2 --> E3[Actions: Inspect Questions, Publish Draft, Delete Draft]
    
    E --> E4[Archive / Published Tab]
    E4 --> E5[Shows All Historical Assessments]
    E5 --> E6[Actions: Inspect Question Breakdown, Re-export Bond Paper PDF, Delete Quiz]

    B --> F[Sign Out]
    F --> F1[Clear 'tseki_remember_me' from AsyncStorage]
    F1 --> F2[supabase.auth.signOut()]
    F2 --> F3[Redirect to Welcome Screen]
```

---

## 4. Key Data Entities & Relationship Schema

```mermaid
erDiagram
    TEACHER ||--o{ CLASSROOM : owns
    CLASSROOM ||--o{ STUDENT : enrolls
    CLASSROOM ||--o{ QUIZ : contains
    QUIZ ||--o{ QUIZ_PERFORMANCE_RECORD : aggregates
    STUDENT ||--o{ STUDENT_QUIZ_RESULT : achieves
    STUDENT ||--o{ ROSTER_ALERT : triggers

    TEACHER {
        string id PK
        string email
        string full_name
    }

    CLASSROOM {
        string id PK
        string teacher_id FK
        string title
        string subject
        string section
        string room
        string schedule
        string color
    }

    STUDENT {
        string id PK
        string classroom_id FK
        string full_name
        string email
        float average
    }

    QUIZ {
        string id PK
        string classroom_id FK
        string quiz_title
        string subject
        string difficulty
        string question_type
        json questions
        json answer_key
        string status "DRAFT | PUBLISHED | ARCHIVE"
        datetime created_at
        datetime expires_at
    }

    STUDENT_QUIZ_RESULT {
        string student_id FK
        string classroom_id FK
        string quiz_title
        float score_percentage
        int total_score
        int max_score
        json item_results
        datetime graded_at
    }

    ROSTER_ALERT {
        string id PK
        string student_id FK
        string classroom_id FK
        string alert_type "HIGH RISK | URGENT REVIEW"
        float score_percentage
        string message
        boolean is_read
    }
```

---

## 5. Technical Specifications & Design Decisions

| Subsystem | Technology / Package | Design Rationale |
| :--- | :--- | :--- |
| **Routing & Navigation** | `expo-router` v6 | File-based routing with native stack navigation, matching modern Expo standards. |
| **Styling & Theming** | Vanilla StyleSheet + `ThemeContext` | Light / Dark mode with high-contrast Orange (`#FF6B00`) branding, avoiding heavy utility overhead. |
| **Cloud Database & Auth** | `@supabase/supabase-js` | Instant email OTP authentication, relational tables, and row-level security for multi-tenant teachers. |
| **Local Cache & Offline** | `@react-native-async-storage/async-storage` | Seamless offline-first access for draft assessments, theme preferences, and cached classroom alerts. |
| **AI Generation & Vision** | `@google/generative-ai` | Multimodal model cascade (`gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-2.5-flash`) providing high-speed OCR and pedagogical item synthesis. |
| **Document Ingestion** | `expo-document-picker` + `documentParserService` | Ingests PDF syllabus guidelines, Word docs, and lesson notes to ground AI assessments in teacher-provided curricula. |
| **Physical Paper Generation** | `expo-print` + `expo-sharing` | Standardized bond-paper printing (Short 8.5×11" / Long 8.5×13") with clean optical square grids for consistent camera recognition. |
| **Optical Grading** | `expo-image-picker` + `gradingService` | Captures papers via phone camera, extracts handwritten student responses within bounding boxes, and cross-checks with answer keys. |

---

## 6. Error Handling & Reliability Measures

1. **AI Model Cascade & Fallback:**  
   If the primary `gemini-3.5-flash-lite` encounters rate limits or service interruptions, requests automatically cascade to `gemini-3.6-flash` and `gemini-2.5-flash`.
2. **Deterministic Grading Mathematical Guarantee:**  
   The scoring engine recalculates all points awarded on the client to guarantee mathematical consistency between the score banner and individual item markings.
3. **7-Day Draft Auto-Expiry Lifecycle:**  
   Unpublished drafts enforce a strict 7-day TTL countdown badge to avoid local memory leaks and obsolete assessment accumulation.
4. **Offline Resilience:**  
   Assessment drafts and alert states are stored in AsyncStorage, preserving teacher progress even during network dropouts.
