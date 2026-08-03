CREATE TABLE IF NOT EXISTS user_payment_methods (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name    TEXT,
  bank_code    TEXT,
  last_digits  TEXT,
  encrypted    JSONB,
  is_validated BOOLEAN NOT NULL DEFAULT false,
  validated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upm_user_id ON user_payment_methods(user_id);

ALTER TABLE user_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY upm_owner ON user_payment_methods
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
