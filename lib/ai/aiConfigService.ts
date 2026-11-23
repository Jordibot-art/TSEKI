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
// Ordered by live benchmark (10-question quiz, Nov 2026): fastest model that
// returns valid JSON first. OpenRouter tries up to 3 of these server-side in a
// single request, so 429/upstream failures fail over in ~1s instead of 40s.
export const DEFAULT_OPENROUTER_MODELS = [
    "cohere/north-mini-code:free",                          // ~14s, valid JSON
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",   // ~27s, valid JSON
    "nvidia/nemotron-3.5-super-vl:free",
    "dots-studio/dots-3-note-preview:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",                                      // OpenRouter auto-router (last resort)
];

// Vision-capable free models (image input) for camera grading
export const DEFAULT_OPENROUTER_VISION_MODELS = [
    "nvidia/nemotron-3.5-super-vl:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "dots-studio/dots-3-note-preview:free",
    "google/gemma-4-26b-a4b-it:free",
    "openrouter/free",
];

/**
 * Older defaults that are now slow, tiny, or rate-limited. If one of these is
 * still saved on the device (and the teacher never picked it explicitly), we
 * transparently upgrade to the current fastest default.
 */
export const LEGACY_OPENROUTER_DEFAULTS = [
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "meta-llama/llama-3.3-70b-instruct:free",
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
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
];

export const DEFAULT_GROQ_VISION_MODELS = [
    "meta-llama/llama-3.2-11b-vision-preview",
    "llama-3.2-11b-vision-preview",
    "meta-llama/llama-3.2-90b-vision-preview",
];

function normalizeOpenRouterModel(model?: string | null): string {
    const m = (model || "").trim();
    if (!m || LEGACY_OPENROUTER_DEFAULTS.includes(m)) return DEFAULT_OPENROUTER_MODELS[0];
    return m;
}

// ── Storage Keys ─────────────────────────────────────────────────────────────
// Sensitive API keys are stored in hardware-backed expo-secure-store on native
// platforms (iOS Keychain / Android Keystore), while non-sensitive preferences
// live in AsyncStorage. Legacy AsyncStorage keys are transparently migrated and
// purged on first native read.
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

const SECURE_STORE_KEYS = {
    OPENROUTER_KEY: "tseki_ai_openrouter_key",
    GROQ_KEY: "tseki_ai_groq_key",
};

/**
 * Dynamically loads AsyncStorage to support cross-runtime execution
 * (Node CLI unit tests vs. mobile app).
 */
async function getStorage() {
    // If running in pure Node.js CLI environment without React Native or DOM, skip AsyncStorage
    if (typeof (global as any).nativeCallSyncHook === "undefined" && typeof window === "undefined") {
        return null;
    }
    try {
        const mod = await import("@react-native-async-storage/async-storage");
        return mod.default || mod;
    } catch {
        return null;
    }
}

function isReactNativeRuntime(): boolean {
    if (typeof navigator !== "undefined" && (navigator as any).product === "ReactNative") {
        return true;
    }
    return (
        typeof (global as any).nativeCallSyncHook !== "undefined" ||
        typeof (global as any).__turboModuleProxy !== "undefined"
    );
}

/**
 * Dynamically loads expo-secure-store when running on native iOS/Android
 * (supports both Legacy Bridge and Expo SDK 54 Bridgeless New Architecture).
 * Returns null on web or pure Node test runtimes.
 */
async function getSecureStore() {
    if (!isReactNativeRuntime()) {
        return null;
    }
    try {
        const { Platform } = await import("react-native");
        if (Platform.OS !== "ios" && Platform.OS !== "android") {
            return null;
        }
        const mod = await import("expo-secure-store");
        if (typeof mod.getItemAsync === "function" && typeof mod.setItemAsync === "function") {
            return mod;
        }
        return null;
    } catch {
        return null;
    }
}

async function readSecretWithMigration(
    secureStore: Awaited<ReturnType<typeof getSecureStore>>,
    storage: Awaited<ReturnType<typeof getStorage>>,
    secureKey: string,
    legacyAsyncKey: string,
    legacyValue: string | null
): Promise<string | null> {
    if (!secureStore) {
        return legacyValue;
    }
    try {
        const existingSecure = await secureStore.getItemAsync(secureKey);
        if (existingSecure !== null) {
            // Ensure any leftover legacy plaintext copy is scrubbed
            if (legacyValue && storage) {
                try {
                    await storage.removeItem(legacyAsyncKey);
                } catch {
                    // non-fatal
                }
            }
            return existingSecure;
        }

        // One-time transparent migration from AsyncStorage -> SecureStore
        if (legacyValue && legacyValue.trim()) {
            const trimmed = legacyValue.trim();
            await secureStore.setItemAsync(secureKey, trimmed);
            if (storage) {
                try {
                    await storage.removeItem(legacyAsyncKey);
                } catch {
                    // non-fatal
                }
            }
            return trimmed;
        }
        return null;
    } catch {
        return legacyValue;
    }
}

/**
 * Retrieves the current backup AI configuration, checking SecureStore (for secrets)
 * and AsyncStorage (for preferences) first, then falling back to EXPO_PUBLIC_* env vars.
 */
export async function getAIConfig(): Promise<BackupAIConfig> {
    try {
        const [storage, secureStore] = await Promise.all([getStorage(), getSecureStore()]);
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

            const [secureOpenRouterKey, secureGroqKey] = await Promise.all([
                readSecretWithMigration(
                    secureStore,
                    storage,
                    SECURE_STORE_KEYS.OPENROUTER_KEY,
                    STORAGE_KEYS.OPENROUTER_KEY,
                    openRouterKeyStr[1]
                ),
                readSecretWithMigration(
                    secureStore,
                    storage,
                    SECURE_STORE_KEYS.GROQ_KEY,
                    STORAGE_KEYS.GROQ_KEY,
                    groqKeyStr[1]
                ),
            ]);

            const envProvider = (process.env.EXPO_PUBLIC_BACKUP_AI_PROVIDER || "groq").toLowerCase() as AIProvider;
            const validProvider = (providerStr[1] as AIProvider) || (["groq", "openrouter", "ollama"].includes(envProvider) ? envProvider : "groq");

            return {
                enabled: enabledStr[1] !== null ? enabledStr[1] === "true" : true,
                provider: validProvider,
                openRouterKey: secureOpenRouterKey || process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || "",
                openRouterModel: normalizeOpenRouterModel(openRouterModelStr[1] || process.env.EXPO_PUBLIC_OPENROUTER_MODEL),
                ollamaBaseUrl: ollamaUrlStr[1] || process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434",
                ollamaModel: ollamaModelStr[1] || process.env.EXPO_PUBLIC_OLLAMA_MODEL || DEFAULT_OLLAMA_MODELS[0],
                groqKey: secureGroqKey || process.env.EXPO_PUBLIC_GROQ_API_KEY || "",
                groqModel: groqModelStr[1] || process.env.EXPO_PUBLIC_GROQ_MODEL || DEFAULT_GROQ_MODELS[0],
            };
        }
    } catch (err) {
        console.warn("[AIConfig] Failed to load from storage, using environment defaults:", err);
    }

    const envProvider = (process.env.EXPO_PUBLIC_BACKUP_AI_PROVIDER || "groq").toLowerCase() as AIProvider;
    return {
        enabled: true,
        provider: ["groq", "openrouter", "ollama"].includes(envProvider) ? envProvider : "groq",
        openRouterKey: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || "",
        openRouterModel: normalizeOpenRouterModel(process.env.EXPO_PUBLIC_OPENROUTER_MODEL),
        ollamaBaseUrl: process.env.EXPO_PUBLIC_OLLAMA_BASE_URL || "http://localhost:11434",
        ollamaModel: process.env.EXPO_PUBLIC_OLLAMA_MODEL || DEFAULT_OLLAMA_MODELS[0],
        groqKey: process.env.EXPO_PUBLIC_GROQ_API_KEY || "",
        groqModel: process.env.EXPO_PUBLIC_GROQ_MODEL || DEFAULT_GROQ_MODELS[0],
    };
}

/**
 * Persists updated backup AI configuration.
 * API keys are saved in expo-secure-store on iOS/Android and removed from plaintext AsyncStorage.
 */
export async function saveAIConfig(config: Partial<BackupAIConfig>): Promise<void> {
    const [storage, secureStore] = await Promise.all([getStorage(), getSecureStore()]);
    if (!storage && !secureStore) return;

    const pairs: [string, string][] = [];

    if (config.enabled !== undefined) pairs.push([STORAGE_KEYS.ENABLED, String(config.enabled)]);
    if (config.provider !== undefined) pairs.push([STORAGE_KEYS.PROVIDER, config.provider]);
    if (config.openRouterModel !== undefined) pairs.push([STORAGE_KEYS.OPENROUTER_MODEL, config.openRouterModel.trim()]);
    if (config.ollamaBaseUrl !== undefined) pairs.push([STORAGE_KEYS.OLLAMA_URL, config.ollamaBaseUrl.trim()]);
    if (config.ollamaModel !== undefined) pairs.push([STORAGE_KEYS.OLLAMA_MODEL, config.ollamaModel.trim()]);
    if (config.groqModel !== undefined) pairs.push([STORAGE_KEYS.GROQ_MODEL, config.groqModel.trim()]);

    const saveSecret = async (secureKey: string, legacyKey: string, value: string) => {
        const trimmed = value.trim();
        if (secureStore) {
            if (trimmed) {
                await secureStore.setItemAsync(secureKey, trimmed);
            } else {
                await secureStore.deleteItemAsync(secureKey);
            }
            // Scrub any legacy plaintext entry in AsyncStorage
            if (storage) {
                try {
                    await storage.removeItem(legacyKey);
                } catch {
                    // non-fatal
                }
            }
        } else if (storage) {
            pairs.push([legacyKey, trimmed]);
        }
    };

    if (config.openRouterKey !== undefined) {
        await saveSecret(SECURE_STORE_KEYS.OPENROUTER_KEY, STORAGE_KEYS.OPENROUTER_KEY, config.openRouterKey);
    }
    if (config.groqKey !== undefined) {
        await saveSecret(SECURE_STORE_KEYS.GROQ_KEY, STORAGE_KEYS.GROQ_KEY, config.groqKey);
    }

    if (storage && pairs.length > 0) {
        await storage.multiSet(pairs);
    }
}
