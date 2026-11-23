-- ==============================================================================
-- Migration: Cancel Incomplete Step 2 Teacher Registration
-- Description:
--   Allows an authenticated teacher who has completed Step 1 + Email OTP but
--   decides to cancel during Step 2 (Identity Photo Upload) to cleanly delete
--   their incomplete `auth.users` account (and any unsubmitted `public.teachers`
--   draft row) so:
--     1. Incomplete Step 1 registrations are NOT left saved in Supabase / Admin Portal.
--     2. The teacher can register again immediately with the exact same email.
--
-- Security:
--   - `SECURITY DEFINER` scoped strictly to `auth.uid()` (self-only).
--   - Refuses to delete unless `raw_user_meta_data ->> 'needs_identity_verification'`
--     is explicitly `true` AND no submitted/approved/rejected/suspended row exists
--     in `public.teachers`.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cancel_incomplete_teacher_registration()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_meta JSONB;
    v_teacher_status TEXT;
    v_has_docs BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to cancel registration.'
            USING ERRCODE = '42501';
    END IF;

    SELECT raw_user_meta_data INTO v_meta
    FROM auth.users
    WHERE id = v_uid;

    IF v_meta IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'deleted', false);
    END IF;

    -- Safety guard: only allow self-deletion while still awaiting Step 2 verification
    IF coalesce((v_meta ->> 'needs_identity_verification')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Only incomplete registrations awaiting Step 2 verification can be cancelled.'
            USING ERRCODE = '42501';
    END IF;

    SELECT
        status,
        (
            nullif(trim(coalesce(school_id_url, '')), '') IS NOT NULL
            OR nullif(trim(coalesce(facial_verification_url, '')), '') IS NOT NULL
        )
    INTO v_teacher_status, v_has_docs
    FROM public.teachers
    WHERE user_id = v_uid
    LIMIT 1;

    IF v_teacher_status IS NOT NULL AND (v_teacher_status <> 'pending' OR v_has_docs) THEN
        RAISE EXCEPTION 'Cannot cancel a registration that has already been submitted.'
            USING ERRCODE = '42501';
    END IF;

    -- Remove any incomplete draft row in public.teachers
    DELETE FROM public.teachers
    WHERE user_id = v_uid
      AND status = 'pending'
      AND nullif(trim(coalesce(school_id_url, '')), '') IS NULL
      AND nullif(trim(coalesce(facial_verification_url, '')), '') IS NULL;

    -- Remove the incomplete auth.users record so the email can be used to register again
    DELETE FROM auth.users
    WHERE id = v_uid;

    RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_incomplete_teacher_registration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_incomplete_teacher_registration() TO authenticated, service_role;
