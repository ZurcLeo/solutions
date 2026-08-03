-- ============================================================================
-- Migration: Webhook Subscriptions (ElosCloud ↔ IconChat Integration)
-- Épico: Integração Bidirecional de Webhooks
-- Wave 0 — Foundation
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. webhook_subscriptions — config per-seller para webhook outbound
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_id       TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL DEFAULT 'icon_chat'
                    CHECK (provider IN ('icon_chat')),
    endpoint_url    TEXT NOT NULL,
    hmac_secret     TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    icon_tenant_id  TEXT,
    events_enabled  TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT webhook_subscriptions_seller_provider_unique
        UNIQUE (seller_id, provider)
);

COMMENT ON TABLE public.webhook_subscriptions IS 'Configuração de webhook outbound por seller. Um seller pode ter no máximo 1 subscription por provider.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_webhook_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webhook_subscriptions_updated_at
    BEFORE UPDATE ON public.webhook_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_webhook_subscriptions_updated_at();

-- ---------------------------------------------------------------------------
-- 2. webhook_delivery_log — cada tentativa de envio (idempotência + auditoria)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.webhook_delivery_log (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_id        TEXT NOT NULL,
    subscription_id TEXT NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'failed', 'abandoned')),
    http_status     INTEGER,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    last_error      TEXT,
    next_retry_at   TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT webhook_delivery_log_event_unique
        UNIQUE (event_id, subscription_id)
);

COMMENT ON TABLE public.webhook_delivery_log IS 'Log de entregas de webhook outbound. UNIQUE(event_id, subscription_id) garante idempotência.';

-- Index para retry job: busca webhooks falhados prontos para re-tentativa
CREATE INDEX IF NOT EXISTS idx_wdl_retry
    ON public.webhook_delivery_log (status, next_retry_at)
    WHERE status IN ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- 3. webhook_return_events — eventos de retorno do IconChat (dedup + auditoria)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.webhook_return_events (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_id        TEXT NOT NULL UNIQUE,
    event_type      TEXT NOT NULL,
    seller_id       TEXT REFERENCES public.seller_profiles(id),
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processed', 'failed')),
    processed_at    TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.webhook_return_events IS 'Eventos recebidos do IconChat (canal de retorno). event_id UNIQUE garante dedup.';

-- Index para processamento pendente
CREATE INDEX IF NOT EXISTS idx_wre_pending
    ON public.webhook_return_events (status)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. RLS — admin-only write, seller read-own
-- ---------------------------------------------------------------------------

ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_return_events ENABLE ROW LEVEL SECURITY;

-- webhook_subscriptions: service_role full access (backend opera como service_role)
CREATE POLICY "webhook_subscriptions_service_role"
    ON public.webhook_subscriptions
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "webhook_delivery_log_service_role"
    ON public.webhook_delivery_log
    FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "webhook_return_events_service_role"
    ON public.webhook_return_events
    FOR ALL
    USING (true)
    WITH CHECK (true);

COMMIT;
