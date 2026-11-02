/**
 * Safely resolves the active Google Gemini API key.
 * Defends against stale Metro bundler in-memory caches, accidental env prefixes,
 * or invalid mock keys from prior failover testing.
 */
export function getGeminiApiKey(): string {
    const raw = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (raw && !raw.includes("invalid_test_key") && raw.trim().length > 15) {
        return raw.replace(/^EXPO_PUBLIC_GEMINI_API_KEY=/, "").trim();
    }
    return "";
}
