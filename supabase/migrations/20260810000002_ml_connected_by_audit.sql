-- [BUG-006] Audit trail: quem conectou a conta ML
-- Evita cegueira sobre qual user_id executou o OAuth connect
ALTER TABLE seller_external_accounts
  ADD COLUMN IF NOT EXISTS connected_by TEXT;

COMMENT ON COLUMN seller_external_accounts.connected_by
  IS 'user_id of who performed the OAuth connect (audit trail)';
