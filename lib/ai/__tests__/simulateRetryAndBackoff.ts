import * as fs from "fs";
import * as path from "path";
import { generateAssessmentWithBackupProvider } from "../../quizGeneratorService";

function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), ".env");
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, "utf-8");
            for (const line of content.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#")) continue;
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        }
    } catch (e) {
        // ignore
    }
}

async function runSimulatedTest() {
    loadEnv();
    console.log("=================================================================");
    console.log("  SIMULATING: Gemini AI Busy (429/503) -> Retry Backoff -> Backup ");
    console.log("=================================================================\n");

    const MAX_RETRIES = 2;
    const BASE_BACKOFF_MS = 2000;

    let attempt = 0;
    const simulatedErrors = [
        { status: 429, message: "[GoogleGenerativeAI Error]: 429 Too Many Requests. Resource has been exhausted." },
        { status: 503, message: "[GoogleGenerativeAI Error]: 503 Service Unavailable. Model is overloaded." },
    ];

    while (attempt <= MAX_RETRIES) {
        console.log(`📡 [Attempt ${attempt + 1}/${MAX_RETRIES + 1}] Calling Gemini gemini-3.5-flash-lite...`);

        if (attempt < simulatedErrors.length) {
            const err = simulatedErrors[attempt];
            attempt++;
            const backoffMs = Math.round(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
            const waitSec = Math.ceil(backoffMs / 1000);

            console.log(`⚠️  Gemini returned: [${err.status}] ${err.message}`);
            console.log(`🔔 [UI Notification] "AI is busy right now. Retrying in ${waitSec}s... (Attempt ${attempt + 1}/${MAX_RETRIES + 1})"`);
            console.log(`⏳ Exponential Backoff: Sleeping for ${waitSec} seconds...\n`);

            await new Promise((r) => setTimeout(r, backoffMs));
            console.log(`🔔 [UI Notification] "AI is busy. Retrying assessment generation..."\n`);
            continue;
        }

        break;
    }

    console.log("⚡ All Gemini retries exhausted. Triggering failover to Backup AI...");
    console.log(`🔔 [UI Notification] "Primary AI is busy. Switching to backup AI provider..."\n`);

    const params = {
        topic: "Philippine Geography",
        subject: "Araling Panlipunan",
        gradeLevel: "Grade 7",
        questionType: "Multiple Choice",
        questionCount: 3,
        difficulty: "Medium",
        onStatusUpdate: (status: string, isBusy?: boolean) => {
            console.log(`🔔 [Live Backup Status | busy=${isBusy}]: ${status}`);
        },
        onProviderUsed: (provider: string, model: string) => {
            console.log(`🎉 [Provider Used]: ${provider} (${model})`);
        },
    };

    const promptText = `Generate a 3-question Multiple Choice Quiz on "Philippine Geography" for Grade 7.
Return valid JSON matching:
{
  "quizTitle": "Philippine Geography Assessment",
  "questions": [
    {
      "questionNumber": 1,
      "type": "multiple_choice",
      "questionText": "What is the largest island in the Philippines?",
      "options": ["A) Luzon", "B) Mindanao", "C) Samar", "D) Palawan"],
      "answerBoxesRequired": 1
    }
  ],
  "answerKey": [
    { "questionNumber": 1, "correctAnswer": "A", "points": 1 }
  ]
}`;

    const assessment = await generateAssessmentWithBackupProvider(
        params,
        promptText,
        new Error("Gemini 429 Quota Exceeded")
    );

    console.log("\n=================================================================");
    console.log(`✅ SUCCESSFUL GENERATION VIA BACKUP AI: ${assessment.generatedBy}`);
    console.log(`🏷️  Quiz Title: "${assessment.quizTitle}"`);
    console.log(`📊 Total Questions: ${assessment.questions.length}`);
    assessment.questions.forEach((q) => {
        console.log(`  ${q.questionNumber}. ${q.questionText}`);
        q.options?.forEach((opt) => console.log(`     ${opt}`));
    });
    console.log("=================================================================");
}

runSimulatedTest().catch((err) => {
    console.error("Simulation error:", err);
    process.exit(1);
});
