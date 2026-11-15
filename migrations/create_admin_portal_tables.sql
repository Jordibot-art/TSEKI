-- ==============================================================================
-- Migration: Tseki Admin Portal Tables (Teachers Approval, Admin OTPs, Audit Logs)
-- ==============================================================================

-- 1. Registered Teachers table
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    username TEXT,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    teacher_id TEXT,
    grade_level TEXT,
    subject TEXT,
    strand TEXT,
    school_id_url TEXT,
    facial_verification_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    rejection_reason TEXT,
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_status ON public.teachers(status);
CREATE INDEX IF NOT EXISTS idx_teachers_created_at ON public.teachers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teachers_email ON public.teachers(email);

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION public.set_teachers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teachers_updated_at ON public.teachers;
CREATE TRIGGER trg_teachers_updated_at
    BEFORE UPDATE ON public.teachers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_teachers_updated_at();

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

-- Teachers can view and register their own record
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teachers' AND policyname = 'Teachers can view own registration'
    ) THEN
        CREATE POLICY "Teachers can view own registration"
            ON public.teachers
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'teachers' AND policyname = 'Teachers can insert own registration'
    ) THEN
        CREATE POLICY "Teachers can insert own registration"
            ON public.teachers
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- 2. Admin Activity Logs table
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    teacher_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'Admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at
    ON public.admin_activity_logs(created_at DESC);

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

-- 3. Admin OTP Codes table (used by Admin Web server / serverless functions via service role)
CREATE TABLE IF NOT EXISTS public.admin_otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'login'
        CHECK (purpose IN ('login', 'delete_teacher')),
    target_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_otp_codes_email_purpose
    ON public.admin_otp_codes(email, purpose, created_at DESC);

ALTER TABLE public.admin_otp_codes ENABLE ROW LEVEL SECURITY;
