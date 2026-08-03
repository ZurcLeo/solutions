-- Migration: notification_jobs e user_notification_preferences
-- Substitui as coleções Firestore 'notification_jobs' e 'user_notification_preferences'

-- =====================================================
-- 1. TABELA notification_jobs (fila de notificações)
-- =====================================================
CREATE TABLE notification_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    importance      TEXT DEFAULT 'low',
    channels        JSONB NOT NULL DEFAULT '[]',
    content         JSONB NOT NULL DEFAULT '{}',
    dedup_key       TEXT,
    recipient_email TEXT,
    status          TEXT DEFAULT 'pending',  -- 'pending','processing','completed','failed','retrying'
    attempts        JSONB DEFAULT '[]',
    triggered_by    TEXT,
    metadata        JSONB DEFAULT '{}',
    last_attempt_at TIMESTAMPTZ,
    next_retry_at   TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotência por dedup_key
CREATE UNIQUE INDEX idx_notification_jobs_dedup_key ON notification_jobs(dedup_key)
    WHERE dedup_key IS NOT NULL;

CREATE INDEX idx_notification_jobs_user_id ON notification_jobs(user_id);
CREATE INDEX idx_notification_jobs_status  ON notification_jobs(status);
CREATE INDEX idx_notification_jobs_created ON notification_jobs(created_at DESC);

COMMENT ON TABLE notification_jobs IS 'Fila de jobs de notificação (in-app + email) com retry e idempotência';

-- =====================================================
-- 2. TABELA user_notification_preferences
-- =====================================================
CREATE TABLE user_notification_preferences (
    user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    global_opt_out_email BOOLEAN DEFAULT FALSE,
    channels             JSONB DEFAULT '{}',  -- { "loan_approved": ["in_app","email"], ... }
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trigger_notification_prefs_updated_at
    BEFORE UPDATE ON user_notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

COMMENT ON TABLE user_notification_preferences IS 'Preferências de canal de notificação por usuário';

-- =====================================================
-- 3. RLS (serviço de backend usa service_role, sem RLS ativo)
-- =====================================================
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver apenas os próprios jobs e preferências
CREATE POLICY notification_jobs_select_self ON notification_jobs
    FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY notification_prefs_self ON user_notification_preferences
    FOR ALL USING (user_id = auth.uid()::text);
