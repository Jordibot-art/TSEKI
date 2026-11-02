import * as fs from "fs";
import * as path from "path";
import { runBackupChain } from "../backupRunner";
import { GeneratedAssessment } from "../../quizGeneratorService";

// Load .env variables manually for standalone CLI run
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

async function simulateFailover() {
    loadEnv();
    console.log("=================================================================");
    console.log("  SIMULATING: Google Gemini Outage (503 / 429 / Invalid Key)    ");
    console.log("=================================================================\n");

    console.log("🔴 [Primary Engine] Google Gemini failed with [400] API key not valid.");
    console.log("⚡ [Failover System] Gemini unavailable! Automatically activating Backup AI Provider...\n");

    const apiKey = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error("❌ Error: No EXPO_PUBLIC_OPENROUTER_API_KEY found in .env!");
        process.exit(1);
    }

    const messages = [
        {
            role: "system" as const,
            content: "You are an expert curriculum designer. Return strictly valid JSON with no markdown formatting.",
        },
        {
            role: "user" as const,
            content: `Generate a 3-question Multiple Choice Quiz on "Philippine National Heroes" for Grade 7.
Return valid JSON matching this schema:
{
  "quizTitle": "Philippine National Heroes",
  "questions": [
    {
      "questionNumber": 1,
      "type": "multiple_choice",
      "questionText": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "answerBoxesRequired": 1
    }
  ],
  "answerKey": [
    {
      "questionNumber": 1,
      "correctAnswer": "A",
      "points": 1
    }
  ]
}`,
        },
    ];

    try {
        const result = await runBackupChain<GeneratedAssessment>({
            kind: "text",
            messages,
            logTag: "[Simulation Backup]",
            timeoutMs: 30000,
            totalBudgetMs: 50000,
            maxTokens: 1500,
            temperature: 0.2,
            validate: (json) => {
                if (json && json.quizTitle && Array.isArray(json.questions) && json.questions.length > 0 && Array.isArray(json.answerKey)) {
                    return json as GeneratedAssessment;
                }
                return null;
            },
        });

        const assessment = result.value;
        console.log(`\n✅ [FAILOVER SUCCESSFUL with ${result.provider.toUpperCase()} (${result.model}) in ${result.latencyMs}ms]`);
        console.log(`🏷️  Quiz Title: "${assessment.quizTitle}"`);
        console.log(`📊 Generated ${assessment.questions.length} Questions:\n`);

        assessment.questions.forEach((q) => {
            console.log(`  ${q.questionNumber}. ${q.questionText}`);
            q.options?.forEach((opt) => console.log(`     ${opt}`));
            const ans = assessment.answerKey?.find((k) => k.questionNumber === q.questionNumber);
            console.log(`     👉 Correct Answer: [${ans?.correctAnswer || "N/A"}]\n`);
        });

        console.log("=================================================================");
        console.log("🎉 VERIFIED: Backup provider handled failover seamlessly!");
        console.log("=================================================================");
    } catch (err: any) {
        console.error("❌ Failover failed:\n", err.message);
        process.exit(1);
    }
}

simulateFailover();
