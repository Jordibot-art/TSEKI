-- ==============================================================================
-- Migration: Harden Admin Portal Security (Serverless OTP Nonce Replay Protection)
-- Description:
--   Stores single-use OTP challenge nonces in Postgres so Vercel serverless
--   cold starts and parallel function instances cannot replay used OTPs.
--   Table has RLS enabled with zero public policies (accessible only via
--   SUPABASE_SERVICE_ROLE_KEY on the server).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.admin_otp_nonces (
    nonce TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_otp_nonces_expires_at
    ON public.admin_otp_nonces(expires_at);

ALTER TABLE public.admin_otp_nonces ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke direct client access; only service_role bypasses RLS
REVOKE ALL ON TABLE public.admin_otp_nonces FROM PUBLIC, anon, authenticated;
