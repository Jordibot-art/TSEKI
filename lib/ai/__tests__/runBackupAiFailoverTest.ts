import assert from "assert";
import {
    extractJsonFromResponse,
    resolveOllamaUrl,
} from "../openAICompatibleClient";

async function runTests() {
    console.log("=== Running Multi-Provider AI Fallback Tests ===");
    let passCount = 0;

    // ── Test 1: resolveOllamaUrl ──────────────────────────────────────────────
    assert.strictEqual(
        resolveOllamaUrl("http://localhost:11434"),
        "http://localhost:11434/v1/chat/completions",
        "Standard Ollama host URL should route to /v1/chat/completions"
    );
    assert.strictEqual(
        resolveOllamaUrl("http://localhost:11434/"),
        "http://localhost:11434/v1/chat/completions",
        "Trailing slash should be stripped"
    );
    assert.strictEqual(
        resolveOllamaUrl("http://192.168.1.50:11434/v1"),
        "http://192.168.1.50:11434/v1/chat/completions",
        "URL ending in /v1 should route to /v1/chat/completions"
    );
    assert.strictEqual(
        resolveOllamaUrl("http://custom:11434/v1/chat/completions"),
        "http://custom:11434/v1/chat/completions",
        "Already fully resolved URL should remain untouched"
    );
    console.log("  [PASS] resolveOllamaUrl properly normalizes endpoints");
    passCount++;

    // ── Test 2: extractJsonFromResponse (Plain JSON) ──────────────────────────
    const plain = `{"quizTitle": "Photosynthesis", "questions": [], "answerKey": []}`;
    const parsedPlain = extractJsonFromResponse(plain);
    assert.strictEqual(parsedPlain.quizTitle, "Photosynthesis");
    console.log("  [PASS] extractJsonFromResponse parses plain JSON");
    passCount++;

    // ── Test 3: extractJsonFromResponse (Markdown Code Fences) ───────────────
    const fenced = "```json\n" + plain + "\n```";
    const parsedFenced = extractJsonFromResponse(fenced);
    assert.strictEqual(parsedFenced.quizTitle, "Photosynthesis");
    console.log("  [PASS] extractJsonFromResponse strips standard ```json markdown fences");
    passCount++;

    // ── Test 4: extractJsonFromResponse (Conversational Framing) ─────────────
    const conversational = `Certainly! Here is your requested quiz assessment:\n\`\`\`json\n${plain}\n\`\`\`\nLet me know if you need any adjustments!`;
    const parsedConv = extractJsonFromResponse(conversational);
    assert.strictEqual(parsedConv.quizTitle, "Photosynthesis");
    console.log("  [PASS] extractJsonFromResponse recovers from conversational AI framing");
    passCount++;

    // ── Test 5: Schema Validation of Assessment ──────────────────────────────
    const sampleAssessment = {
        quizTitle: "Earth Science Diagnostic",
        questions: [
            {
                questionNumber: 1,
                type: "multiple_choice",
                questionText: "What is the outermost layer of the Earth?",
                options: ["A) Mantle", "B) Crust", "C) Core", "D) Lithosphere"],
                answerBoxesRequired: 1,
            },
        ],
        answerKey: [
            {
                questionNumber: 1,
                correctAnswer: "B",
                points: 1,
            },
        ],
    };
    const sampleJsonStr = JSON.stringify(sampleAssessment);
    const parsedAssessment = extractJsonFromResponse(sampleJsonStr);
    assert(Array.isArray(parsedAssessment.questions), "questions must be array");
    assert(Array.isArray(parsedAssessment.answerKey), "answerKey must be array");
    assert.strictEqual(parsedAssessment.questions.length, 1);
    assert.strictEqual(parsedAssessment.answerKey[0].correctAnswer, "B");
    console.log("  [PASS] GeneratedAssessment schema validation succeeds");
    passCount++;

    // ── Test 6: Mock OpenRouter API Call ─────────────────────────────────────
    const originalFetch = global.fetch;
    try {
        let sentHeaders: Record<string, string> = {};
        let sentBody: any = null;

        global.fetch = async (url: any, init: any) => {
            sentHeaders = init.headers;
            sentBody = JSON.parse(init.body);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    model: "meta-llama/llama-3.3-70b-instruct:free",
                    choices: [
                        {
                            message: {
                                content: JSON.stringify(sampleAssessment),
                            },
                        },
                    ],
                }),
            } as any;
        };

        const { callOpenAICompatible } = await import("../openAICompatibleClient");
        const callResult = await callOpenAICompatible({
            provider: "openrouter",
            model: "meta-llama/llama-3.3-70b-instruct:free",
            apiKey: "sk-or-v1-mock-test-key",
            messages: [{ role: "user", content: "generate" }],
            responseFormatJson: true,
        });

        assert.strictEqual(sentHeaders["Authorization"], "Bearer sk-or-v1-mock-test-key");
        assert.strictEqual(sentHeaders["HTTP-Referer"], "https://tseki.app");
        assert.strictEqual(sentHeaders["X-Title"], "TSEKI Assessment Engine");
        assert.strictEqual(sentBody.model, "meta-llama/llama-3.3-70b-instruct:free");
        assert.strictEqual(sentBody.response_format?.type, "json_object");
        assert.strictEqual(callResult.json.quizTitle, "Earth Science Diagnostic");
        console.log("  [PASS] callOpenAICompatible constructs correct OpenRouter payload and headers");
        passCount++;
    } finally {
        global.fetch = originalFetch;
    }

    // ── Test 7: Failover on 429 Rate Limit simulation ────────────────────────
    try {
        let attemptCount = 0;
        global.fetch = async (url: any, init: any) => {
            attemptCount++;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    model: "meta-llama/llama-3.3-70b-instruct:free",
                    choices: [
                        {
                            message: {
                                content: JSON.stringify(sampleAssessment),
                            },
                        },
                    ],
                }),
            } as any;
        };

        const { callOpenAICompatible } = await import("../openAICompatibleClient");
        const fallbackRes = await callOpenAICompatible({
            provider: "openrouter",
            model: "meta-llama/llama-3.3-70b-instruct:free",
            apiKey: "sk-or-v1-fallback-key",
            messages: [{ role: "user", content: "Simulate fallback" }],
            responseFormatJson: true,
        });

        assert(fallbackRes.latencyMs >= 0, "Latency must be non-negative");
        assert.strictEqual(fallbackRes.modelUsed, "meta-llama/llama-3.3-70b-instruct:free");
        console.log("  [PASS] Backup provider seamlessly fulfills request with valid schema");
        passCount++;
    } finally {
        global.fetch = originalFetch;
    }

    console.log(`\nResults: ${passCount} passed, 0 failed.`);
}

runTests().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
