-- ==============================================================================
-- Migration: AI Generation Quota & Rate Limiting System
-- Description:
--   1. Tracks AI assessment generation per teacher.
--   2. Enforces a 10x daily successful generation cap resetting at midnight (Asia/Manila).
--   3. Enforces burst protection (cooldown between requests & 3 requests / 10 mins).
--   4. Counts ONLY successful generations.
-- ==============================================================================

-- 1. Create table for tracking AI generations
CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL DEFAULT 'full_quiz', -- 'full_quiz' or 'single_question'
    cost INT NOT NULL DEFAULT 1,                  -- 1 for full quiz, 0 for single question
    status TEXT NOT NULL DEFAULT 'success',        -- 'success', 'failed', 'rate_limited'
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for high performance querying
CREATE INDEX IF NOT EXISTS idx_ai_logs_teacher_created 
    ON public.ai_generation_logs(teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_logs_teacher_status 
    ON public.ai_generation_logs(teacher_id, status);

-- 3. Row Level Security
ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view own AI generation logs"
    ON public.ai_generation_logs
    FOR SELECT
    USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can insert own AI generation logs"
    ON public.ai_generation_logs
    FOR INSERT
    WITH CHECK (auth.uid() = teacher_id);

-- 4. Server-Side RPC: Check if teacher can generate
CREATE OR REPLACE FUNCTION public.check_ai_quota(
    p_teacher_id UUID,
    p_cost INT DEFAULT 1,
    p_daily_limit INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today_start TIMESTAMPTZ;
    v_used_today INT := 0;
    v_recent_attempts INT := 0;
    v_last_attempt TIMESTAMPTZ;
    v_seconds_since_last INT;
    v_burst_cooldown INT := 25;       -- 25s cooldown between requests
    v_burst_window_limit INT := 3;     -- max 3 requests in 10 minutes
    v_remaining INT;
BEGIN
    -- 1. Midnight Asia/Manila (UTC+8) boundary
    v_today_start := (date_trunc('day', timezone('Asia/Manila', now())) at time zone 'Asia/Manila');

    -- 2. Count successful generations today
    SELECT COALESCE(SUM(cost), 0)
    INTO v_used_today
    FROM public.ai_generation_logs
    WHERE teacher_id = p_teacher_id
      AND status = 'success'
      AND created_at >= v_today_start;

    v_remaining := GREATEST(0, p_daily_limit - v_used_today);

    -- 3. Check Daily Limit
    IF (v_used_today + p_cost) > p_daily_limit THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error_code', 'DAILY_LIMIT_EXCEEDED',
            'message', format('You''ve reached today''s limit of %s quizzes. Resets tomorrow at midnight (Asia/Manila).', p_daily_limit),
            'used_today', v_used_today,
            'remaining_today', v_remaining,
            'daily_limit', p_daily_limit
        );
    END IF;

    -- 4. Check Burst Cooldown (25s since last request)
    SELECT MAX(created_at)
    INTO v_last_attempt
    FROM public.ai_generation_logs
    WHERE teacher_id = p_teacher_id;

    IF v_last_attempt IS NOT NULL THEN
        v_seconds_since_last := EXTRACT(EPOCH FROM (now() - v_last_attempt))::INT;
        IF v_seconds_since_last < v_burst_cooldown THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'error_code', 'COOLDOWN_ACTIVE',
                'message', format('Please wait %s seconds before generating another quiz.', v_burst_cooldown - v_seconds_since_last),
                'cooldown_seconds', v_burst_cooldown - v_seconds_since_last,
                'used_today', v_used_today,
                'remaining_today', v_remaining,
                'daily_limit', p_daily_limit
            );
        END IF;
    END IF;

    -- 5. Check Burst Window (max 3 requests in last 10 minutes)
    SELECT COUNT(*)
    INTO v_recent_attempts
    FROM public.ai_generation_logs
    WHERE teacher_id = p_teacher_id
      AND created_at >= (now() - interval '10 minutes');

    IF v_recent_attempts >= v_burst_window_limit THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error_code', 'BURST_LIMIT',
            'message', 'You''ve generated multiple quizzes recently. Please take a short break before generating again.',
            'cooldown_seconds', 60,
            'used_today', v_used_today,
            'remaining_today', v_remaining,
            'daily_limit', p_daily_limit
        );
    END IF;

    -- 6. Allowed!
    RETURN jsonb_build_object(
        'allowed', true,
        'used_today', v_used_today,
        'remaining_today', v_remaining,
        'daily_limit', p_daily_limit
    );
END;
$$;

-- 5. Server-Side RPC: Record a successful generation
CREATE OR REPLACE FUNCTION public.record_ai_generation_success(
    p_teacher_id UUID,
    p_action_type TEXT DEFAULT 'full_quiz',
    p_cost INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.ai_generation_logs (teacher_id, action_type, cost, status)
    VALUES (p_teacher_id, p_action_type, p_cost, 'success');

    RETURN jsonb_build_object('success', true);
END;
$$;
