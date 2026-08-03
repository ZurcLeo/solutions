-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: MFA TOTP & Backup Codes fields
-- Adds columns for TOTP secret, backup codes, and MFA metadata to users table.
-- Existing columns: mfa_enabled BOOLEAN, mfa_method TEXT (CHECK: sms/totp/both)
-- ═══════════════════════════════════════════════════════════════════════════════

-- TOTP secret (encrypted AES-256-CBC with DOCUMENT_ENCRYPTION_KEY)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;

-- Backup codes (encrypted JSON array)
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT;

-- Backup codes remaining count (for display without decrypting)
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes_count INTEGER DEFAULT 0;

-- Timestamp when MFA was first enabled
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;

-- ── Comments ─────────────────────────────────────────────────────────────────
COMMENT ON COLUMN users.totp_secret IS 'Encrypted TOTP secret (speakeasy base32). AES-256-CBC with DOCUMENT_ENCRYPTION_KEY.';
COMMENT ON COLUMN users.backup_codes IS 'Encrypted JSON array of remaining backup codes. Never exposed to client.';
COMMENT ON COLUMN users.backup_codes_count IS 'Number of remaining backup codes. Safe for client display.';
COMMENT ON COLUMN users.mfa_enabled_at IS 'Timestamp when MFA was first enabled on this account.';
