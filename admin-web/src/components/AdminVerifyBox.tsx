import { useState, type RefObject } from 'react';
import { Eye, EyeOff, KeyRound, Mail, RotateCw, ShieldCheck } from 'lucide-react';
import type { AdminVerificationPayload, OtpChallengeResponse } from '../lib/adminApi';

export type AdminVerifyMethod = 'password' | 'otp';

export interface AdminVerifyBoxProps {
  idPrefix: string;
  systemEmail: string;
  mode: AdminVerifyMethod;
  onModeChange: (nextMode: AdminVerifyMethod) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  otpCode: string;
  onOtpCodeChange: (value: string) => void;
  otpChallenge: OtpChallengeResponse | null;
  otpCountdown: number;
  otpSending: boolean;
  onSendOrResendOtp: () => void;
  error?: string;
  disabled?: boolean;
  passwordInputRef?: RefObject<HTMLInputElement | null>;
  otpInputRef?: RefObject<HTMLInputElement | null>;
}

export function validateAdminVerifyInput(params: {
  mode: AdminVerifyMethod;
  password: string;
  otpCode: string;
  otpChallenge: OtpChallengeResponse | null;
}): { ok: true; verification: AdminVerificationPayload } | { ok: false; error: string } {
  if (params.mode === 'password') {
    if (!params.password) {
      return { ok: false, error: 'Please re-enter your administrator password to continue.' };
    }
    return { ok: true, verification: { method: 'password', password: params.password } };
  }

  if (!params.otpChallenge) {
    return { ok: false, error: 'Click "Send Gmail OTP" first to receive your 6-digit verification code.' };
  }

  const cleanCode = params.otpCode.trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Please enter the complete 6-digit Gmail verification code.' };
  }

  return {
    ok: true,
    verification: {
      method: 'otp',
      challengeToken: params.otpChallenge.challengeToken,
      code: cleanCode,
    },
  };
}

export function AdminVerifyBox({
  idPrefix,
  systemEmail,
  mode,
  onModeChange,
  password,
  onPasswordChange,
  otpCode,
  onOtpCodeChange,
  otpChallenge,
  otpCountdown,
  otpSending,
  onSendOrResendOtp,
  error,
  disabled = false,
  passwordInputRef,
  otpInputRef,
}: AdminVerifyBoxProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [otpFocused, setOtpFocused] = useState(false);

  const otpDigits = Array.from({ length: 6 }, (_, i) => otpCode[i] || '');

  return (
    <div className="admin-verify-box" role="group" aria-labelledby={`${idPrefix}-verify-heading`}>
      <div className="admin-verify-header">
        <span id={`${idPrefix}-verify-heading`} className="admin-verify-title">
          <ShieldCheck size={14} />
          Admin Identity Verification
        </span>
        <span className="admin-verify-badge">Required before edit</span>
      </div>

      <div className="admin-verify-tabs" role="tablist" aria-label="Verification Method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          className={`admin-verify-tab ${mode === 'password' ? 'active' : ''}`}
          onClick={() => onModeChange('password')}
          disabled={disabled}
        >
          <KeyRound size={13} />
          Re-enter Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'otp'}
          className={`admin-verify-tab ${mode === 'otp' ? 'active' : ''}`}
          onClick={() => onModeChange('otp')}
          disabled={disabled}
        >
          <Mail size={13} />
          Gmail OTP
        </button>
      </div>

      {mode === 'password' ? (
        <div className="admin-verify-panel">
          <label className="admin-verify-label" htmlFor={`${idPrefix}-reauth-password`}>
            Administrator Password
          </label>
          <div className="admin-verify-password-wrap">
            <input
              ref={passwordInputRef}
              id={`${idPrefix}-reauth-password`}
              type={showPassword ? 'text' : 'password'}
              className="admin-verify-password-input"
              autoComplete="current-password"
              placeholder="Re-enter administrator password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              disabled={disabled}
            />
            <button
              type="button"
              className="admin-verify-eye-btn"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-verify-panel">
          <div className="delete-otp-status-row">
            <span className="delete-otp-sent-label">
              {otpSending
                ? 'Sending Gmail OTP…'
                : otpChallenge
                ? 'Sent to '
                : 'Send to '}
              {!otpSending && <strong>{otpChallenge?.systemEmail || systemEmail}</strong>}
            </span>

            {!otpChallenge ? (
              <button
                type="button"
                className="admin-verify-send-otp-btn"
                onClick={onSendOrResendOtp}
                disabled={otpSending || disabled}
              >
                <RotateCw size={12} />
                {otpSending ? 'Sending…' : 'Send Gmail OTP'}
              </button>
            ) : otpCountdown > 0 ? (
              <span className="delete-otp-countdown">Resend in {otpCountdown}s</span>
            ) : (
              <button
                type="button"
                className="delete-otp-resend-btn"
                onClick={onSendOrResendOtp}
                disabled={otpSending || disabled}
              >
                Resend OTP
              </button>
            )}
          </div>

          <div className="delete-otp-cells-wrap">
            <label htmlFor={`${idPrefix}-reauth-otp`} className="visually-hidden">
              6-digit Gmail verification code
            </label>
            <input
              ref={otpInputRef}
              id={`${idPrefix}-reauth-otp`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => onOtpCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onFocus={() => setOtpFocused(true)}
              onBlur={() => setOtpFocused(false)}
              className="delete-otp-hidden-input"
              aria-label="6-digit Gmail verification code"
              disabled={disabled}
            />
            <div className="delete-otp-cells-row" aria-hidden="true">
              {otpDigits.map((digit, idx) => (
                <div
                  key={idx}
                  className={`delete-otp-cell ${digit ? 'filled' : ''} ${
                    otpFocused && idx === Math.min(otpCode.length, 5) ? 'focused' : ''
                  }`}
                >
                  {digit}
                </div>
              ))}
            </div>
          </div>

          {otpChallenge?.sentVia === 'dev_fallback' && otpChallenge.demoOtp && (
            <p className="delete-otp-fallback-note">
              Dev fallback OTP (configure Gmail SMTP for email):{' '}
              <strong>{otpChallenge.demoOtp}</strong>
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="modal-error-banner admin-verify-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
