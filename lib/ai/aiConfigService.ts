export type AIProvider = "openrouter" | "ollama" | "groq";

export interface BackupAIConfig {
    enabled: boolean;
    provider: AIProvider;
    openRouterKey?: string;
    openRouterModel: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    groqKey?: string;
    groqModel: string;
}

// ── Default Free & Calibrated Models ──────────────────────────────────────────
export const DEFAULT_OPENROUTER_MODELS = [
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "cohere/north-mini-code:free",
    "google/gemma-4-31b-it:free",
];

export const DEFAULT_OPENROUTER_VISION_MODELS = [
    "nvidia/nemotron-3.5-super-vl:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

export const DEFAULT_OLLAMA_MODELS = [
    "llama3.2",
    "llama3.1",
    "qwen2.5",
    "mistral",
];

export const DEFAULT_OLLAMA_VISION_MODELS = [
    "llama3.2-vision",
    "llava",
];

export const DEFAULT_GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
];

export const DEFAULT_GROQ_VISION_MODELS = [
    "llama-3.2-11b-vision-preview",
];

// ── AsyncStorage Keys ────────────────────────────────────────────────────────
const STORAGE_KEYS = {
    ENABLED: "tseki_ai_backup_enabled",
    PROVIDER: "tseki_ai_backup_provider",
    OPENROUTER_KEY: "tseki_ai_openrouter_key",
    OPENROUTER_MODEL: "tseki_ai_openrouter_model",
    OLLAMA_URL: "tseki_ai_ollama_url",
    OLLAMA_MODEL: "tseki_ai_ollama_model",
    GROQ_KEY: "tseki_ai_groq_key",
    GROQ_MODEL: "tseki_ai_groq_model",
};

/**
 * Dynamically loads AsyncStorage to support cross-runtime execution
 * (Node CLI unit tests vs. mobile app).
 */
async function getStorage() {
    try {
        const mod = await import("@react-native-async-storage/async-storage");
        return mod.default || mod;
    } catch {
        return null;
    }
}

/**
 * Retrieves the current backup AI configuration, checking AsyncStorage first
 * and falling back to EXPO_PUBLIC_* environment variables.
 */
export async function getAIConfig(): Promise<BackupAIConfig> {
    try {
        const storage = await getStorage();
        if (storage) {
            const [
                enabledStr,
                providerStr,
                openRouterKeyStr,
                openRouterModelStr,
                ollamaUrlStr,
                ollamaModelStr,
                groqKeyStr,
                groqModelStr,
            ] = await storage.multiGet([
                STORAGE_KEYS.ENABLED,
                STORAGE_KEYS.PROVIDER,
                STORAGE_KEYS.OPENROUTER_KEY,
                STORAGE_KEYS.OPENROUTER_MODEL,
                STORAGE_KEYS.OLLAMA_URL,
                STORAGE_KEYS.OLLAMA_MODEL,
                STORAGE_KEYS.GROQ_KEY,
                STORAGE_KEYS.GROQ_MODEL,
            ]);

            const envProvider = (process.env.EXPO_PUBLIC_BACKUP_AI_PROVIDER || "openrouter").toLowerCase() as AIProvider;
            const validProvider = (providerStr[1] as AIProvider) || (["openrouter", "ollama", "groq"].includes(envProvider) ? envProvider : "openrouter");

            return {
                enabled: enabledStr[1] !== null ? enabledStr[1] === "true" : true,
                provider: validProvider,
                openRouterKey: openRouterKeyStr[1] || process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || "",
                openRouterModel: openRouterModelStr[1] || process.env.EXPO_PUBLIC_OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODELS[0],
                ollamaBaseUrl: ollamaUrlStr[1] || process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434",
                ollamaModel: ollamaModelStr[1] || process.env.EXPO_PUBLIC_OLLAMA_MODEL || DEFAULT_OLLAMA_MODELS[0],
                groqKey: groqKeyStr[1] || process.env.EXPO_PUBLIC_GROQ_API_KEY || "",
                groqModel: groqModelStr[1] || process.env.EXPO_PUBLIC_GROQ_MODEL || DEFAULT_GROQ_MODELS[0],
            };
        }
    } catch (err) {
        console.warn("[AIConfig] Failed to load from storage, using environment defaults:", err);
    }

    const envProvider = (process.env.EXPO_PUBLIC_BACKUP_AI_PROVIDER || "openrouter").toLowerCase() as AIProvider;
    return {
        enabled: true,
        provider: ["openrouter", "ollama", "groq"].includes(envProvider) ? envProvider : "openrouter",
        openRouterKey: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || "",
        openRouterModel: process.env.EXPO_PUBLIC_OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODELS[0],
        ollamaBaseUrl: process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434",
        ollamaModel: process.env.EXPO_PUBLIC_OLLAMA_MODEL || DEFAULT_OLLAMA_MODELS[0],
        groqKey: process.env.EXPO_PUBLIC_GROQ_API_KEY || "",
        groqModel: process.env.EXPO_PUBLIC_GROQ_MODEL || DEFAULT_GROQ_MODELS[0],
    };
}

/**
 * Persists updated backup AI configuration to AsyncStorage.
 */
export async function saveAIConfig(config: Partial<BackupAIConfig>): Promise<void> {
    const storage = await getStorage();
    if (!storage) return;

    const pairs: [string, string][] = [];

    if (config.enabled !== undefined) pairs.push([STORAGE_KEYS.ENABLED, String(config.enabled)]);
    if (config.provider !== undefined) pairs.push([STORAGE_KEYS.PROVIDER, config.provider]);
    if (config.openRouterKey !== undefined) pairs.push([STORAGE_KEYS.OPENROUTER_KEY, config.openRouterKey.trim()]);
    if (config.openRouterModel !== undefined) pairs.push([STORAGE_KEYS.OPENROUTER_MODEL, config.openRouterModel.trim()]);
    if (config.ollamaBaseUrl !== undefined) pairs.push([STORAGE_KEYS.OLLAMA_URL, config.ollamaBaseUrl.trim()]);
    if (config.ollamaModel !== undefined) pairs.push([STORAGE_KEYS.OLLAMA_MODEL, config.ollamaModel.trim()]);
    if (config.groqKey !== undefined) pairs.push([STORAGE_KEYS.GROQ_KEY, config.groqKey.trim()]);
    if (config.groqModel !== undefined) pairs.push([STORAGE_KEYS.GROQ_MODEL, config.groqModel.trim()]);

    if (pairs.length > 0) {
        await storage.multiSet(pairs);
    }
}
