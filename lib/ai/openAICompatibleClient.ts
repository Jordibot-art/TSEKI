import { BackupAIConfig, DEFAULT_OPENROUTER_MODELS } from "./aiConfigService";

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
    >;
}

export interface OpenAICallOptions {
    provider: "openrouter" | "ollama" | "groq";
    model: string;
    messages: ChatMessage[];
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    responseFormatJson?: boolean;
    timeoutMs?: number;
    /**
     * OpenRouter only: extra models OpenRouter will try server-side (in the same
     * request) if the primary model is rate-limited / down. Max 3 total.
     */
    fallbackModels?: string[];
    /** Caps output length so slow "thinking" models can't run forever. */
    maxTokens?: number;
    /** OpenRouter only: keeps reasoning models from spending minutes thinking. */
    lowReasoning?: boolean;
}

/** OpenRouter accepts at most 3 entries in the `models` fallback array. */
export const OPENROUTER_MAX_FALLBACK_MODELS = 3;

export interface OpenAICallResult {
    text: string;
    json?: any;
    modelUsed: string;
    latencyMs: number;
}

/**
 * Normalizes Ollama base URL to ensure clean /v1/chat/completions routing.
 */
export function resolveOllamaUrl(rawUrl: string): string {
    let clean = (rawUrl || "http://localhost:11434").trim().replace(/\/+$/, "");
    if (clean.endsWith("/v1/chat/completions")) return clean;
    if (clean.endsWith("/v1")) return `${clean}/chat/completions`;
    return `${clean}/v1/chat/completions`;
}

/**
 * Strips Markdown code blocks and extracts cleanly formatted JSON.
 */
export function extractJsonFromResponse(rawText: string): any {
    const trimmed = rawText.trim();

    // 1. Strip standard ```json ... ``` blocks
    const strippedFences = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(strippedFences);
    } catch {
        // 2. Scan for bracket bounds if there was trailing conversational prose
        const firstBrace = strippedFences.indexOf("{");
        const lastBrace = strippedFences.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const bracketSlice = strippedFences.substring(firstBrace, lastBrace + 1);
            return JSON.parse(bracketSlice);
        }
        throw new Error(`Failed to parse AI response as valid JSON: ${strippedFences.slice(0, 160)}...`);
    }
}

/**
 * Executes a standard OpenAI-compatible chat completion request against
 * OpenRouter, Ollama, or Groq using native fetch.
 */
export async function callOpenAICompatible(options: OpenAICallOptions): Promise<OpenAICallResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 35000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        let endpointUrl = "";
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (options.provider === "openrouter") {
            endpointUrl = "https://openrouter.ai/api/v1/chat/completions";
            const key = options.apiKey?.trim();
            if (!key) {
                throw new Error("Missing OpenRouter API Key. Please provide an OpenRouter key in Settings or .env.");
            }
            headers["Authorization"] = `Bearer ${key}`;
            headers["HTTP-Referer"] = "https://tseki.app";
            headers["X-Title"] = "TSEKI Assessment Engine";
        } else if (options.provider === "ollama") {
            endpointUrl = resolveOllamaUrl(options.baseUrl || "http://localhost:11434");
        } else if (options.provider === "groq") {
            endpointUrl = "https://api.groq.com/openai/v1/chat/completions";
            const key = options.apiKey?.trim();
            if (!key) {
                throw new Error("Missing Groq API Key. Please provide a Groq key in Settings or .env.");
            }
            headers["Authorization"] = `Bearer ${key}`;
        }

        const bodyPayload: Record<string, any> = {
            model: options.model,
            messages: options.messages,
            temperature: typeof options.temperature === "number" ? options.temperature : 0.2,
        };

        if (typeof options.maxTokens === "number" && options.maxTokens > 0) {
            bodyPayload.max_tokens = Math.round(options.maxTokens);
        }

        if (options.provider === "openrouter") {
            const chain = Array.from(
                new Set([options.model, ...(options.fallbackModels || [])].filter(Boolean))
            ).slice(0, OPENROUTER_MAX_FALLBACK_MODELS);
            if (chain.length > 1) {
                bodyPayload.models = chain;
            }
            if (options.lowReasoning) {
                bodyPayload.reasoning = { effort: "low", exclude: true };
            }
        }

        if (options.responseFormatJson) {
            bodyPayload.response_format = { type: "json_object" };
            if (options.provider === "ollama") {
                bodyPayload.format = "json";
            }
        }

        const res = await fetch(endpointUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
        });

        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
            let errorDetail = "";
            try {
                const errJson = await res.json();
                const upstreamRaw = errJson.error?.metadata?.raw;
                errorDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
                if (typeof upstreamRaw === "string" && upstreamRaw.length > 0) {
                    errorDetail += ` (${upstreamRaw.slice(0, 160)})`;
                }
            } catch {
                errorDetail = await res.text().catch(() => res.statusText);
            }
            const httpErr: any = new Error(`[${options.provider.toUpperCase()} ${res.status}] ${errorDetail}`);
            httpErr.status = res.status;
            throw httpErr;
        }

        const data = await res.json();
        if (data?.error) {
            // OpenRouter can return HTTP 200 with an error body when every fallback failed
            const bodyErr: any = new Error(
                `[${options.provider.toUpperCase()} ${data.error.code || "error"}] ${data.error.message || "Provider returned error"}`
            );
            bodyErr.status = Number(data.error.code) || undefined;
            throw bodyErr;
        }
        const choice = data?.choices?.[0];
        const content = choice?.message?.content || "";

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            throw new Error(`Empty response content received from ${options.provider} (${data?.model || options.model}).`);
        }

        let parsedJson: any = undefined;
        if (options.responseFormatJson) {
            parsedJson = extractJsonFromResponse(content);
        }

        return {
            text: content,
            json: parsedJson,
            modelUsed: data?.model || options.model,
            latencyMs,
        };
    } catch (err: any) {
        if (err.name === "AbortError") {
            throw new Error(`Connection to ${options.provider} timed out after ${Math.round(timeout / 1000)}s.`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Tests connection to the configured backup provider by sending a lightweight ping.
 */
export async function testBackupConnection(config: BackupAIConfig): Promise<{
    success: boolean;
    latencyMs: number;
    message: string;
    model: string;
}> {
    const modelToUse =
        config.provider === "openrouter"
            ? (config.openRouterModel || DEFAULT_OPENROUTER_MODELS[0])
            : config.provider === "ollama"
            ? (config.ollamaModel || "llama3.2")
            : (config.groqModel || "llama-3.3-70b-versatile");

    const apiKey =
        config.provider === "openrouter"
            ? config.openRouterKey
            : config.provider === "groq"
            ? config.groqKey
            : undefined;

    try {
        const result = await callOpenAICompatible({
            provider: config.provider,
            model: modelToUse,
            apiKey,
            baseUrl: config.ollamaBaseUrl,
            messages: [
                {
                    role: "system",
                    content: "You are a connectivity test assistant. Respond strictly with: {\"status\": \"ok\", \"provider\": \"working\"}",
                },
                {
                    role: "user",
                    content: "ping",
                },
            ],
            responseFormatJson: true,
            timeoutMs: 15000,
            maxTokens: 300,
            lowReasoning: true,
            fallbackModels:
                config.provider === "openrouter"
                    ? DEFAULT_OPENROUTER_MODELS.filter((m) => m !== modelToUse)
                    : undefined,
        });

        return {
            success: true,
            latencyMs: result.latencyMs,
            message: `Successfully connected to ${config.provider.toUpperCase()} (${result.modelUsed}) in ${result.latencyMs}ms.`,
            model: result.modelUsed,
        };
    } catch (err: any) {
        return {
            success: false,
            latencyMs: 0,
            message: err.message || "Failed to connect to AI provider.",
            model: modelToUse,
        };
    }
}
