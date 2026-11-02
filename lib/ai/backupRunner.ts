import {
    AIProvider,
    BackupAIConfig,
    DEFAULT_GROQ_MODELS,
    DEFAULT_GROQ_VISION_MODELS,
    DEFAULT_OLLAMA_MODELS,
    DEFAULT_OLLAMA_VISION_MODELS,
    DEFAULT_OPENROUTER_MODELS,
    DEFAULT_OPENROUTER_VISION_MODELS,
    getAIConfig,
} from "./aiConfigService";
import {
    callOpenAICompatible,
    ChatMessage,
    extractJsonFromResponse,
    OPENROUTER_MAX_FALLBACK_MODELS,
} from "./openAICompatibleClient";

export type BackupTaskKind = "text" | "vision";

export interface BackupRunOptions<T> {
    kind: BackupTaskKind;
    messages: ChatMessage[];
    /** Returns the parsed value if valid, or null to treat the reply as a failure. */
    validate: (json: any) => T | null;
    /** Per-request timeout. */
    timeoutMs: number;
    /** Hard ceiling for the whole backup chain so the UI never hangs for minutes. */
    totalBudgetMs: number;
    maxTokens?: number;
    temperature?: number;
    logTag?: string;
    /** Inject config (tests). Defaults to getAIConfig(). */
    config?: BackupAIConfig;
}

export interface BackupRunResult<T> {
    value: T;
    provider: AIProvider;
    model: string;
    latencyMs: number;
}

interface ProviderPlan {
    provider: AIProvider;
    apiKey?: string;
    baseUrl?: string;
    /** Each entry is one HTTP request. OpenRouter groups up to 3 models per request. */
    attempts: { model: string; fallbacks: string[] }[];
}

/** At most this many HTTP requests per provider (protects the 50/day free quota). */
const MAX_REQUESTS_PER_PROVIDER = 2;

function uniq(list: (string | undefined)[]): string[] {
    return Array.from(new Set(list.filter((m): m is string => !!m && m.trim().length > 0).map((m) => m.trim())));
}

function buildAttempts(provider: AIProvider, models: string[]) {
    const attempts: { model: string; fallbacks: string[] }[] = [];
    if (provider === "openrouter") {
        for (let i = 0; i < models.length && attempts.length < MAX_REQUESTS_PER_PROVIDER; i += OPENROUTER_MAX_FALLBACK_MODELS) {
            const group = models.slice(i, i + OPENROUTER_MAX_FALLBACK_MODELS);
            attempts.push({ model: group[0], fallbacks: group.slice(1) });
        }
    } else {
        for (const m of models.slice(0, MAX_REQUESTS_PER_PROVIDER)) {
            attempts.push({ model: m, fallbacks: [] });
        }
    }
    return attempts;
}

/**
 * Builds the provider chain: the provider selected in Settings first, then any
 * other cloud provider the teacher has a key for (so a dead OpenRouter quota can
 * still fall through to Groq, and vice-versa). Ollama is only used when it is
 * explicitly selected, because a missing local server would just time out.
 */
export function buildProviderPlans(config: BackupAIConfig, kind: BackupTaskKind): ProviderPlan[] {
    // Failover priority: Groq first (high speed LPU), then OpenRouter / OpenAI
    const order: AIProvider[] = uniq(["groq", config.provider, "openrouter"]) as AIProvider[];
    const plans: ProviderPlan[] = [];

    for (const provider of order) {
        if (provider === "openrouter") {
            const key = config.openRouterKey?.trim();
            if (!key) continue;
            const models =
                kind === "vision"
                    ? DEFAULT_OPENROUTER_VISION_MODELS
                    : uniq([config.openRouterModel, ...DEFAULT_OPENROUTER_MODELS]);
            plans.push({ provider, apiKey: key, attempts: buildAttempts(provider, models) });
        } else if (provider === "groq") {
            const key = config.groqKey?.trim();
            if (!key) continue;
            const models = kind === "vision" ? DEFAULT_GROQ_VISION_MODELS : uniq([config.groqModel, ...DEFAULT_GROQ_MODELS]);
            plans.push({ provider, apiKey: key, attempts: buildAttempts(provider, models) });
        } else if (provider === "ollama" && config.provider === "ollama") {
            const models =
                kind === "vision" ? DEFAULT_OLLAMA_VISION_MODELS : uniq([config.ollamaModel, ...DEFAULT_OLLAMA_MODELS]);
            plans.push({ provider, baseUrl: config.ollamaBaseUrl, attempts: buildAttempts(provider, models) });
        }
    }
    return plans;
}

/** Errors that mean "this provider is unusable right now" — skip its remaining attempts. */
function isProviderFatal(err: any): boolean {
    const status = Number(err?.status);
    const msg = String(err?.message || "").toLowerCase();
    if (status === 401 || status === 402 || status === 403) return true;
    if (msg.includes("free-models-per-day") || msg.includes("daily") || msg.includes("insufficient credits")) return true;
    if (msg.includes("network request failed") && msg.includes("ollama")) return true;
    return false;
}

function friendlyReason(err: any): string {
    const msg = String(err?.message || "Unknown error");
    const lower = msg.toLowerCase();
    if (lower.includes("free-models-per-day") || lower.includes("daily")) {
        return "OpenRouter free daily limit (50 requests/day) reached. It resets at 00:00 UTC (08:00 PH time).";
    }
    if (Number(err?.status) === 401) return "API key was rejected. Re-check the key in Settings.";
    if (lower.includes("timed out")) return msg;
    if (Number(err?.status) === 429 || lower.includes("429")) {
        return "Free models are busy (rate-limited upstream). Wait a minute and try again.";
    }
    return msg;
}

/**
 * Runs a request through the backup providers with a hard time budget.
 * Throws an Error with a teacher-friendly explanation if everything fails.
 */
export async function runBackupChain<T>(opts: BackupRunOptions<T>): Promise<BackupRunResult<T>> {
    const tag = opts.logTag || "[Backup AI]";
    const config = opts.config || (await getAIConfig());

    if (!config.enabled) {
        throw new Error("Backup AI is turned off in Settings.");
    }

    const plans = buildProviderPlans(config, opts.kind);
    if (plans.length === 0) {
        throw new Error(
            "No backup AI provider is configured. Add a free OpenRouter or Groq API key in Settings → AI Engine & Backup Provider."
        );
    }

    const startedAt = Date.now();
    const deadline = startedAt + opts.totalBudgetMs;
    const reasons: string[] = [];

    for (const plan of plans) {
        for (const attempt of plan.attempts) {
            const remaining = deadline - Date.now();
            if (remaining < 5000) {
                reasons.push("time budget exhausted");
                break;
            }

            const label = [attempt.model, ...attempt.fallbacks].join(" → ");
            console.log(`${tag} Trying ${plan.provider}: ${label}`);
            const t0 = Date.now();

            try {
                const res = await callOpenAICompatible({
                    provider: plan.provider,
                    model: attempt.model,
                    fallbackModels: attempt.fallbacks,
                    apiKey: plan.apiKey,
                    baseUrl: plan.baseUrl,
                    messages: opts.messages,
                    responseFormatJson: true,
                    temperature: opts.temperature ?? 0.2,
                    maxTokens: opts.maxTokens,
                    lowReasoning: true,
                    timeoutMs: Math.min(opts.timeoutMs, remaining),
                });

                let json = res.json;
                if (!json) {
                    try {
                        json = extractJsonFromResponse(res.text);
                    } catch {
                        json = null;
                    }
                }
                const value = json ? opts.validate(json) : null;
                if (value) {
                    const latencyMs = Date.now() - t0;
                    console.log(`${tag} ✓ ${plan.provider} (${res.modelUsed}) answered in ${latencyMs}ms`);
                    return { value, provider: plan.provider, model: res.modelUsed, latencyMs };
                }
                reasons.push(`${plan.provider}/${res.modelUsed}: reply was not valid JSON for this task`);
                console.warn(`${tag} ${plan.provider} (${res.modelUsed}) returned invalid JSON, trying next...`);
            } catch (err: any) {
                reasons.push(`${plan.provider}: ${friendlyReason(err)}`);
                console.warn(`${tag} ${plan.provider} failed after ${Date.now() - t0}ms: ${err?.message}`);
                if (isProviderFatal(err)) break; // skip this provider's other attempts
            }
        }
        if (deadline - Date.now() < 5000) break;
    }

    const unique = Array.from(new Set(reasons));
    throw new Error(`Backup AI could not finish the request.\n• ${unique.join("\n• ")}`);
}
