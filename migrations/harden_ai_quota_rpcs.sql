-- ==============================================================================
-- Migration: Harden AI Quota SECURITY DEFINER RPCs
-- Description:
--   1. Pins `SET search_path = public` on SECURITY DEFINER functions to prevent
--      search_path hijacking.
--   2. Enforces `auth.uid() = p_teacher_id` (unless invoked by `service_role`)
--      so authenticated users cannot query or exhaust another teacher's quota.
--   3. Restricts EXECUTE permissions to `authenticated` and `service_role`.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.check_ai_quota(
    p_teacher_id UUID,
    p_cost INT DEFAULT 1,
    p_daily_limit INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    v_effective_limit INT := GREATEST(1, LEAST(COALESCE(p_daily_limit, 10), 10));
    v_effective_cost INT := GREATEST(0, COALESCE(p_cost, 1));
BEGIN
    -- Enforce caller ownership unless running with service_role
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_teacher_id THEN
            RAISE EXCEPTION 'Unauthorized: teacher_id does not match authenticated user'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 1. Midnight Asia/Manila (UTC+8) boundary
    v_today_start := (date_trunc('day', timezone('Asia/Manila', now())) at time zone 'Asia/Manila');

    -- 2. Count successful generations today
    SELECT COALESCE(SUM(cost), 0)
    INTO v_used_today
    FROM public.ai_generation_logs
    WHERE teacher_id = p_teacher_id
      AND status = 'success'
      AND created_at >= v_today_start;

    v_remaining := GREATEST(0, v_effective_limit - v_used_today);

    -- 3. Check Daily Limit
    IF (v_used_today + v_effective_cost) > v_effective_limit THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'error_code', 'DAILY_LIMIT_EXCEEDED',
            'message', format('You''ve reached today''s limit of %s quizzes. Resets tomorrow at midnight (Asia/Manila).', v_effective_limit),
            'used_today', v_used_today,
            'remaining_today', v_remaining,
            'daily_limit', v_effective_limit
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
                'daily_limit', v_effective_limit
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
            'daily_limit', v_effective_limit
        );
    END IF;

    -- 6. Allowed
    RETURN jsonb_build_object(
        'allowed', true,
        'used_today', v_used_today,
        'remaining_today', v_remaining,
        'daily_limit', v_effective_limit
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_generation_success(
    p_teacher_id UUID,
    p_action_type TEXT DEFAULT 'full_quiz',
    p_cost INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_safe_cost INT := GREATEST(0, LEAST(COALESCE(p_cost, 1), 10));
    v_safe_action TEXT := CASE
        WHEN p_action_type IN ('full_quiz', 'single_question') THEN p_action_type
        ELSE 'full_quiz'
    END;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL OR auth.uid() <> p_teacher_id THEN
            RAISE EXCEPTION 'Unauthorized: teacher_id does not match authenticated user'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.ai_generation_logs (teacher_id, action_type, cost, status)
    VALUES (p_teacher_id, v_safe_action, v_safe_cost, 'success');

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_quota(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ai_quota(UUID, INT, INT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_ai_generation_success(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ai_generation_success(UUID, TEXT, INT) TO authenticated, service_role;
