-- ==============================================================================
-- Migration: Verified 2-Step Teacher Registration & Private Storage Bucket
-- Description:
--   1. Extends `public.teachers` with split name columns, `school_name`,
--      multi-select `grade_levels TEXT[]`, auto-uppercased `subjects TEXT[]`,
--      and `school_id_back_url` (Back of Physical Teacher ID).
--   2. Updates RLS policies on `public.teachers` and adds a `SECURITY DEFINER`
--      helper `public.submit_teacher_verification` so re-registrations with the
--      same verified email (e.g. after an Auth user was deleted and `user_id`
--      became NULL via ON DELETE SET NULL) never fail with an RLS USING error.
--   3. Creates private Supabase Storage bucket `teacher-verification-docs`
--      (0/1 GB Free Tier Storage) with strict per-user folder RLS policies
--      so only the applicant and Admin service_role can access ID/selfie photos.
-- ==============================================================================

-- 1. Extend public.teachers columns (additive & backwards-compatible)
ALTER TABLE public.teachers
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS middle_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS school_name TEXT,
    ADD COLUMN IF NOT EXISTS grade_levels TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS subjects TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS school_id_back_url TEXT;

CREATE INDEX IF NOT EXISTS idx_teachers_school_name ON public.teachers(school_name);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON public.teachers(user_id);

-- 2. Allow authenticated teachers to view, insert, and update their own pending/rejected
--    registration by user_id OR verified JWT email (handles orphaned user_id IS NULL rows
--    left behind when an account is deleted from Supabase Auth and re-registered).
DROP POLICY IF EXISTS "Teachers can view own registration" ON public.teachers;
CREATE POLICY "Teachers can view own registration"
    ON public.teachers
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );

DROP POLICY IF EXISTS "Teachers can insert own registration" ON public.teachers;
CREATE POLICY "Teachers can insert own registration"
    ON public.teachers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND (
            coalesce(auth.jwt() ->> 'email', '') = ''
            OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );

DROP POLICY IF EXISTS "Teachers can update own pending registration" ON public.teachers;
CREATE POLICY "Teachers can update own pending registration"
    ON public.teachers
    FOR UPDATE
    TO authenticated
    USING (
        (
            auth.uid() = user_id
            OR (
                (user_id IS NULL OR status IN ('pending', 'rejected'))
                AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
        )
        AND status IN ('pending', 'rejected')
    )
    WITH CHECK (
        auth.uid() = user_id
        AND status = 'pending'
    );

-- 2b. SECURITY DEFINER RPC for atomic Step 2 submission (safely re-binds orphaned
--     rows for the same verified email when status is pending/rejected)
CREATE OR REPLACE FUNCTION public.submit_teacher_verification(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_jwt_email TEXT := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
    v_email TEXT := lower(trim(coalesce(p_payload ->> 'email', v_jwt_email)));
    v_existing_status TEXT;
    v_grade_levels TEXT[] := ARRAY(
        SELECT jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(p_payload -> 'grade_levels') = 'array' THEN p_payload -> 'grade_levels'
                ELSE '[]'::jsonb
            END
        )
    );
    v_subjects TEXT[] := ARRAY(
        SELECT jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(p_payload -> 'subjects') = 'array' THEN p_payload -> 'subjects'
                ELSE '[]'::jsonb
            END
        )
    );
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to submit teacher verification.'
            USING ERRCODE = '42501';
    END IF;

    IF v_email = '' OR (v_jwt_email <> '' AND v_email <> v_jwt_email) THEN
        RAISE EXCEPTION 'Registration email must match your authenticated account email.'
            USING ERRCODE = '42501';
    END IF;

    SELECT status INTO v_existing_status
    FROM public.teachers
    WHERE lower(email) = v_email
    LIMIT 1;

    IF v_existing_status IS NOT NULL AND v_existing_status NOT IN ('pending', 'rejected') THEN
        RAISE EXCEPTION 'Cannot overwrite an already-% teacher record.', v_existing_status
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.teachers (
        user_id,
        username,
        email,
        full_name,
        first_name,
        middle_name,
        last_name,
        school_name,
        teacher_id,
        grade_level,
        grade_levels,
        subject,
        strand,
        subjects,
        school_id_url,
        school_id_back_url,
        facial_verification_url,
        status,
        rejection_reason
    )
    VALUES (
        v_uid,
        coalesce(nullif(trim(p_payload ->> 'username'), ''), split_part(v_email, '@', 1)),
        v_email,
        coalesce(nullif(trim(p_payload ->> 'full_name'), ''), 'Teacher'),
        nullif(trim(p_payload ->> 'first_name'), ''),
        nullif(trim(p_payload ->> 'middle_name'), ''),
        nullif(trim(p_payload ->> 'last_name'), ''),
        nullif(trim(p_payload ->> 'school_name'), ''),
        nullif(trim(p_payload ->> 'teacher_id'), ''),
        nullif(trim(p_payload ->> 'grade_level'), ''),
        v_grade_levels,
        nullif(trim(p_payload ->> 'subject'), ''),
        nullif(trim(p_payload ->> 'strand'), ''),
        v_subjects,
        nullif(trim(p_payload ->> 'school_id_url'), ''),
        nullif(trim(p_payload ->> 'school_id_back_url'), ''),
        nullif(trim(p_payload ->> 'facial_verification_url'), ''),
        'pending',
        NULL
    )
    ON CONFLICT (email) DO UPDATE
    SET
        user_id = EXCLUDED.user_id,
        username = EXCLUDED.username,
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        middle_name = EXCLUDED.middle_name,
        last_name = EXCLUDED.last_name,
        school_name = EXCLUDED.school_name,
        teacher_id = EXCLUDED.teacher_id,
        grade_level = EXCLUDED.grade_level,
        grade_levels = EXCLUDED.grade_levels,
        subject = EXCLUDED.subject,
        strand = EXCLUDED.strand,
        subjects = EXCLUDED.subjects,
        school_id_url = EXCLUDED.school_id_url,
        school_id_back_url = EXCLUDED.school_id_back_url,
        facial_verification_url = EXCLUDED.facial_verification_url,
        status = 'pending',
        rejection_reason = NULL,
        updated_at = now();

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_teacher_verification(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_teacher_verification(JSONB) TO authenticated, service_role;

-- 3. Create Private Supabase Storage Bucket for Teacher ID (Front/Back) & Face Selfie
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'teacher-verification-docs',
    'teacher-verification-docs',
    false,
    5242880, -- 5 MB max per image (compressed client uploads are ~150-300 KB)
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Storage RLS Policies: Each authenticated teacher can only access `<auth.uid()>/*`
--    Admin Portal reads via SUPABASE_SERVICE_ROLE_KEY (short-lived signed URLs).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Teachers can upload own verification photos'
    ) THEN
        CREATE POLICY "Teachers can upload own verification photos"
            ON storage.objects
            FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = 'teacher-verification-docs'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Teachers can update own verification photos'
    ) THEN
        CREATE POLICY "Teachers can update own verification photos"
            ON storage.objects
            FOR UPDATE
            TO authenticated
            USING (
                bucket_id = 'teacher-verification-docs'
                AND (storage.foldername(name))[1] = auth.uid()::text
            )
            WITH CHECK (
                bucket_id = 'teacher-verification-docs'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Teachers can view own verification photos'
    ) THEN
        CREATE POLICY "Teachers can view own verification photos"
            ON storage.objects
            FOR SELECT
            TO authenticated
            USING (
                bucket_id = 'teacher-verification-docs'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END $$;
