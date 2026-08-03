-- =====================================================
-- MIGRATION: Security Recovery & MFA Fields
-- Description: Adds recovery email, phone verification status,
--              MFA configuration, and password audit columns to
--              the users table. Expands the security_tickets
--              CHECK constraint with new ticket types for phone
--              verification, recovery email, password reset,
--              account recovery, and MFA setup flows.
-- Depends on: 20260513000000_identity_schema.sql (users table)
--             20260516000004_augment_users_profile_fields.sql (telefone column)
--             20260515000007_security_tickets_schema.sql (security_tickets)
-- Author: ClaudIA / auth-agent (ElosCloud)
-- Date: 2026-06-17
-- =====================================================

-- =====================================================
-- 1. RECOVERY EMAIL COLUMNS
-- =====================================================

-- Secondary email used exclusively for account recovery.
-- Must be different from the primary email (enforced at application level).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_email TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_email_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_email_verified_at TIMESTAMPTZ;

-- =====================================================
-- 2. PHONE VERIFICATION STATUS
-- =====================================================

-- Tracks whether the user's telefone (added in 20260516000004)
-- has been verified via SMS OTP through Firebase Phone Auth.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- =====================================================
-- 3. MFA CONFIGURATION
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;

-- Allowed values: 'sms', 'totp', 'both'. NULL when MFA is disabled.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_method TEXT;

-- =====================================================
-- 4. PASSWORD AUDIT
-- =====================================================

-- Tracks when the user last changed their password.
-- Used by security audit to flag stale credentials.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- =====================================================
-- 5. CHECK CONSTRAINT: mfa_method allowed values
-- =====================================================

-- Wrap in DO block so re-running is safe (IF NOT EXISTS for constraints
-- is not supported in PostgreSQL, so we check pg_constraint).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_mfa_method'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_mfa_method
        CHECK (mfa_method IS NULL OR mfa_method IN ('sms', 'totp', 'both'));
  END IF;
END $$;

-- =====================================================
-- 6. EXPAND security_tickets TYPE CHECK CONSTRAINT
-- =====================================================

-- The original constraint (from 20260515000007) allows:
--   ('login', 'saque', 'kyc', 'email_verify', 'pagamento_pix')
--
-- We add: 'phone_verify', 'recovery_email_verify', 'password_reset',
--         'account_recovery', 'mfa_setup'

ALTER TABLE security_tickets
  DROP CONSTRAINT IF EXISTS security_tickets_type_check;

ALTER TABLE security_tickets
  ADD CONSTRAINT security_tickets_type_check
    CHECK (type IN (
      'login',
      'saque',
      'kyc',
      'email_verify',
      'pagamento_pix',
      'phone_verify',
      'recovery_email_verify',
      'password_reset',
      'account_recovery',
      'mfa_setup'
    ));

-- =====================================================
-- 7. INDEX: recovery_email lookups
-- =====================================================

-- Partial index — only rows that have a recovery_email set.
CREATE INDEX IF NOT EXISTS idx_users_recovery_email
  ON users(recovery_email)
  WHERE recovery_email IS NOT NULL;

-- =====================================================
-- 8. RLS — No additional policies needed
-- =====================================================
-- The existing RLS policies on the users table already cover
-- these new columns:
--   - users_select_self  (FOR SELECT USING auth.uid()::text = id)
--   - users_update_self  (FOR UPDATE USING auth.uid()::text = id)
--   - users_select_all_for_admin (admin role can SELECT all)
--
-- The new columns inherit these row-level policies automatically,
-- so each user can only read/update their own recovery & MFA data.
-- No new policy is required.

-- =====================================================
-- 9. COMMENTS
-- =====================================================

COMMENT ON COLUMN users.recovery_email IS
  'Secondary email for account recovery. Must be different from primary email (enforced at app level).';

COMMENT ON COLUMN users.recovery_email_verified IS
  'Whether the recovery_email has been confirmed via OTP sent to that address.';

COMMENT ON COLUMN users.recovery_email_verified_at IS
  'Timestamp of when recovery_email was last verified.';

COMMENT ON COLUMN users.phone_verified IS
  'Whether the user telefone field has been verified via SMS OTP (Firebase Phone Auth).';

COMMENT ON COLUMN users.phone_verified_at IS
  'Timestamp of when phone number was last verified.';

COMMENT ON COLUMN users.mfa_enabled IS
  'Whether multi-factor authentication is active for this user.';

COMMENT ON COLUMN users.mfa_method IS
  'Active MFA method: sms (SMS OTP), totp (authenticator app), or both. NULL when MFA is disabled.';

COMMENT ON COLUMN users.password_changed_at IS
  'Timestamp of last password change. Used for security audits to flag stale credentials.';
