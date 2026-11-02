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
}

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
                errorDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
            } catch {
                errorDetail = await res.text().catch(() => res.statusText);
            }
            throw new Error(`[${options.provider.toUpperCase()} ${res.status}] ${errorDetail}`);
        }

        const data = await res.json();
        const choice = data?.choices?.[0];
        const content = choice?.message?.content || "";

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            throw new Error(`Empty response content received from ${options.provider} (${options.model}).`);
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
            timeoutMs: 12000,
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
