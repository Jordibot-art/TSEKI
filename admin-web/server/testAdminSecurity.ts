import assert from "node:assert/strict";
import {
  getConfiguredAdminPassword,
  getSecret,
  timingSafeStringEqual,
} from "./adminBackend.ts";

console.log("=== Testing Admin Backend Production Security Guards ===");

const envMap = process.env as Record<string, string | undefined>;
const origNodeEnv = envMap.NODE_ENV;
const origAdminPw = envMap.ADMIN_PASSWORD;
const origOtpSecret = envMap.ADMIN_OTP_SECRET;

try {
  envMap.NODE_ENV = "production";
  delete envMap.ADMIN_PASSWORD;
  delete envMap.ADMIN_OTP_SECRET;

  assert.throws(
    () => getConfiguredAdminPassword(),
    /ADMIN_PASSWORD is not configured/,
    "Production must refuse hardcoded fallback admin password"
  );
  assert.throws(
    () => getSecret(),
    /ADMIN_OTP_SECRET is not configured/,
    "Production must refuse derivable HMAC signing secret"
  );

  envMap.ADMIN_OTP_SECRET = "short";
  assert.throws(
    () => getSecret(),
    /at least 16 characters/,
    "Production must reject weak short ADMIN_OTP_SECRET"
  );

  envMap.ADMIN_PASSWORD = "strong-prod-password-123";
  envMap.ADMIN_OTP_SECRET = "0123456789abcdef0123456789abcdef";
  assert.equal(getConfiguredAdminPassword(), "strong-prod-password-123");
  assert.equal(getSecret(), "0123456789abcdef0123456789abcdef");

  assert.equal(timingSafeStringEqual("abc123", "abc123"), true);
  assert.equal(timingSafeStringEqual("abc123", "abc124"), false);
  assert.equal(timingSafeStringEqual("abc", "abcdef"), false);
} finally {
  if (origNodeEnv === undefined) delete envMap.NODE_ENV;
  else envMap.NODE_ENV = origNodeEnv;
  if (origAdminPw === undefined) delete envMap.ADMIN_PASSWORD;
  else envMap.ADMIN_PASSWORD = origAdminPw;
  if (origOtpSecret === undefined) delete envMap.ADMIN_OTP_SECRET;
  else envMap.ADMIN_OTP_SECRET = origOtpSecret;
}

console.log("ALL ADMIN BACKEND SECURITY GUARD TESTS PASSED!");
