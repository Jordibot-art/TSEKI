/**
 * AI Assessment Generation Quota & Rate Limiting Configuration
 *
 * All numbers and limits are centralized here for easy tuning.
 * During Capstone defense and testing, simply change `DAILY_LIMIT` to a higher number
 * (e.g. 50 or 100), and lower it for production deployments.
 */

export const AI_QUOTA_CONFIG = {
    /**
     * Daily cap of successful full-quiz generations per teacher.
     * Resets automatically at 12:00 AM (midnight) Asia/Manila time (UTC+8).
     */
    DAILY_LIMIT: 10,

    /**
     * Timezone for daily quota resets (midnight Asia/Manila).
     */
    RESET_TIMEZONE: "Asia/Manila",

    /**
     * Burst cooldown: minimum seconds required between generation requests.
     * Prevents accidental double taps, loops, and helps mitigate upstream rate limits.
     */
    BURST_COOLDOWN_SECONDS: 25,

    /**
     * Extended cooldown penalty applied specifically when a 429 (Too Many Requests)
     * or AI server busy error is encountered.
     */
    RATE_LIMIT_COOLDOWN_SECONDS: 30,

    /**
     * Burst limit window: maximum attempts allowed within a time window.
     * Default: no more than 3 generations in 10 minutes.
     */
    BURST_WINDOW_MINUTES: 10,
    BURST_WINDOW_MAX_ATTEMPTS: 3,

    /**
     * Action costs:
     * - FULL_QUIZ: 1 count against daily quota.
     * - QUESTION_REGENERATE: 0 count (cheaper, uses minimal tokens, exempt from daily cap).
     */
    COSTS: {
        FULL_QUIZ: 1,
        SINGLE_QUESTION: 0,
    },
};
