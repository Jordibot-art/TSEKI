/**
 * AI Assessment Generation Quota & Rate Limiting Configuration (teacher-web)
 *
 * Enforces a per-user (teacher_id) 10x daily generation limit that resets
 * every day at 12:00 AM midnight in Manila, Philippines (Asia/Manila, UTC+8).
 */

export const AI_QUOTA_CONFIG = {
  /**
   * Daily cap of successful full-quiz generations per user (teacher_id).
   * Resets automatically at 12:00 AM (midnight) Asia/Manila time (UTC+8).
   */
  DAILY_LIMIT: 10,

  /**
   * Timezone for daily quota resets (midnight Asia/Manila, Philippines).
   */
  RESET_TIMEZONE: "Asia/Manila",

  /**
   * Cooldown between consecutive generation requests (seconds).
   */
  BURST_COOLDOWN_SECONDS: 0,

  /**
   * Cooldown penalty applied when a 429 (Too Many Requests) or busy error occurs.
   */
  RATE_LIMIT_COOLDOWN_SECONDS: 15,

  /**
   * Burst window configuration.
   */
  BURST_WINDOW_MINUTES: 10,
  BURST_WINDOW_MAX_ATTEMPTS: 10,

  /**
   * Action costs:
   * - FULL_QUIZ: 1 count against the user's 10x daily quota.
   * - SINGLE_QUESTION: 0 count.
   */
  COSTS: {
    FULL_QUIZ: 1,
    SINGLE_QUESTION: 0,
  },
};

/**
 * Returns today's date formatted as YYYY-MM-DD in Manila, Philippines (Asia/Manila, UTC+8).
 * Uses deterministic UTC+8 arithmetic so it is 100% consistent across runtimes.
 */
export function getManilaDateString(date: Date = new Date()): string {
  const manilaMs = date.getTime() + 8 * 60 * 60 * 1000;
  const manilaDate = new Date(manilaMs);
  const year = manilaDate.getUTCFullYear();
  const month = String(manilaDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(manilaDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the exact UTC ISO timestamps for 12:00:00.000 AM Manila today
 * and 12:00:00.000 AM Manila tomorrow.
 */
export function getManilaDayBoundsIso(date: Date = new Date()): {
  manilaDate: string;
  startIso: string;
  endIso: string;
} {
  const manilaDate = getManilaDateString(date);
  const startMs = new Date(`${manilaDate}T00:00:00.000+08:00`).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    manilaDate,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}
