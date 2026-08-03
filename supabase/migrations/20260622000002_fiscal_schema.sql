-- =====================================================
-- MIGRAÇÃO: Módulo Fiscal — Schema completo
-- [FISCAL-001] 4 tabelas + triggers + RLS
--
-- Tabelas:
--   1. seller_clients              — carteira de clientes do seller
--   2. seller_client_pendencias    — pendências fiscais (core)
--   3. seller_client_pendencia_historico — audit trail imutável
--   4. booking_attachments         — documentos anexados
--
-- Depende de: seller_profiles(id), users(id), seller_team_members, is_seller_team_member()
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-06-22
-- =====================================================


-- =====================================================
-- 1. seller_clients — carteira de clientes
-- =====================================================

CREATE TABLE IF NOT EXISTS public.seller_clients (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_id       TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    client_user_id  TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    apelido         TEXT,
    regime_tributario TEXT,
    notas_internas  TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'archived')),
    created_by      TEXT REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT seller_clients_unique UNIQUE (seller_id, client_user_id)
);

COMMENT ON TABLE public.seller_clients IS
    '[FISCAL-001] Carteira de clientes de um escritório/seller. '
    'client_user_id é FK NOT NULL para users(id) — D2: cliente deve ser usuário verificado. '
    'notas_internas: NUNCA visível ao cliente (filtrado pela API).';

CREATE INDEX IF NOT EXISTS idx_seller_clients_seller_status
    ON public.seller_clients (seller_id, status);

CREATE INDEX IF NOT EXISTS idx_seller_clients_client_user
    ON public.seller_clients (client_user_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.fn_seller_clients_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_seller_clients_updated_at ON public.seller_clients;
CREATE TRIGGER trg_seller_clients_updated_at
    BEFORE UPDATE ON public.seller_clients
    FOR EACH ROW EXECUTE FUNCTION public.fn_seller_clients_updated_at();


-- =====================================================
-- 2. seller_client_pendencias — core do módulo
-- =====================================================

CREATE TABLE IF NOT EXISTS public.seller_client_pendencias (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_client_id        TEXT NOT NULL REFERENCES public.seller_clients(id) ON DELETE CASCADE,
    seller_id               TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    tipo                    TEXT NOT NULL
                            CHECK (tipo IN ('intimacao', 'notificacao', 'oficio', 'obrigacao_acessoria', 'outro')),
    titulo                  TEXT NOT NULL,
    descricao               TEXT,
    prazo_legal             TIMESTAMPTZ NOT NULL,
    responsavel_user_id     TEXT REFERENCES public.users(id),
    criado_por_user_id      TEXT NOT NULL REFERENCES public.users(id),
    status                  TEXT NOT NULL DEFAULT 'aberta'
                            CHECK (status IN ('aberta', 'em_andamento', 'concluida', 'vencida', 'cancelada')),
    ciencia_registrada_em   TIMESTAMPTZ,
    ciencia_registrada_por  TEXT REFERENCES public.users(id),
    concluida_em            TIMESTAMPTZ,
    concluida_por           TEXT REFERENCES public.users(id),
    metadata                JSONB DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.seller_client_pendencias IS
    '[FISCAL-001] Pendências fiscais de clientes. Core do módulo de gestão de obrigações. '
    'ciencia_registrada_em/por: rastreia quem tomou ciência e quando. '
    'criado_por_user_id: imutável — quem criou a pendência.';

CREATE INDEX IF NOT EXISTS idx_pendencias_seller_status_prazo
    ON public.seller_client_pendencias (seller_id, status, prazo_legal);

CREATE INDEX IF NOT EXISTS idx_pendencias_prazo_status_open
    ON public.seller_client_pendencias (prazo_legal, status)
    WHERE status IN ('aberta', 'em_andamento');

CREATE INDEX IF NOT EXISTS idx_pendencias_responsavel
    ON public.seller_client_pendencias (responsavel_user_id)
    WHERE status IN ('aberta', 'em_andamento');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.fn_pendencias_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_pendencias_updated_at ON public.seller_client_pendencias;
CREATE TRIGGER trg_pendencias_updated_at
    BEFORE UPDATE ON public.seller_client_pendencias
    FOR EACH ROW EXECUTE FUNCTION public.fn_pendencias_updated_at();


-- =====================================================
-- 3. seller_client_pendencia_historico — audit trail imutável
-- =====================================================

CREATE TABLE IF NOT EXISTS public.seller_client_pendencia_historico (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    pendencia_id    TEXT NOT NULL REFERENCES public.seller_client_pendencias(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    acao            TEXT NOT NULL
                    CHECK (acao IN ('criou', 'atribuiu', 'comentou', 'concluiu', 'reabriu', 'venceu', 'cancelou')),
    descricao       TEXT,
    snapshot_status TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- SEM updated_at — tabela IMUTÁVEL por design
);

COMMENT ON TABLE public.seller_client_pendencia_historico IS
    '[FISCAL-001] Audit trail imutável de pendências. Append-only. '
    'SEM policy de UPDATE — registros nunca são modificados. '
    'user_id usa COALESCE(app.current_user_id, auth.uid(), system) via trigger.';

CREATE INDEX IF NOT EXISTS idx_historico_pendencia
    ON public.seller_client_pendencia_historico (pendencia_id, created_at);


-- =====================================================
-- 4. Trigger de auditoria — fn_audit_pendencia_update
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_audit_pendencia_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id TEXT;
BEGIN
    -- Risco 2 mitigação: COALESCE com fallback explícito
    v_user_id := COALESCE(
        current_setting('app.current_user_id', true),
        auth.uid()::text,
        'system'
    );

    -- Status changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.seller_client_pendencia_historico
            (pendencia_id, user_id, acao, descricao, snapshot_status)
        VALUES (
            NEW.id,
            v_user_id,
            CASE NEW.status
                WHEN 'concluida' THEN 'concluiu'
                WHEN 'vencida'   THEN 'venceu'
                WHEN 'cancelada' THEN 'cancelou'
                WHEN 'aberta'    THEN 'reabriu'
                ELSE 'comentou'
            END,
            'Status: ' || OLD.status || ' → ' || NEW.status,
            NEW.status
        );
    END IF;

    -- Responsável changed
    IF OLD.responsavel_user_id IS DISTINCT FROM NEW.responsavel_user_id THEN
        INSERT INTO public.seller_client_pendencia_historico
            (pendencia_id, user_id, acao, descricao, snapshot_status)
        VALUES (
            NEW.id,
            v_user_id,
            'atribuiu',
            'Responsável alterado para: ' || COALESCE(NEW.responsavel_user_id, '(nenhum)'),
            NEW.status
        );
    END IF;

    -- Prazo changed
    IF OLD.prazo_legal IS DISTINCT FROM NEW.prazo_legal THEN
        INSERT INTO public.seller_client_pendencia_historico
            (pendencia_id, user_id, acao, descricao, snapshot_status)
        VALUES (
            NEW.id,
            v_user_id,
            'comentou',
            'Prazo alterado: ' || OLD.prazo_legal::text || ' → ' || NEW.prazo_legal::text,
            NEW.status
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_pendencia_update ON public.seller_client_pendencias;
CREATE TRIGGER trg_audit_pendencia_update
    AFTER UPDATE ON public.seller_client_pendencias
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_pendencia_update();


-- =====================================================
-- 5. booking_attachments — documentos por booking
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_attachments (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    booking_id      TEXT NOT NULL,
    uploaded_by     TEXT NOT NULL REFERENCES public.users(id),
    file_name       TEXT NOT NULL,
    file_url        TEXT NOT NULL,
    file_size_bytes INT,
    mime_type       TEXT,
    descricao       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Imutável — sem updated_at
);

COMMENT ON TABLE public.booking_attachments IS
    '[FISCAL-001] Documentos anexados a bookings/pendências. '
    'D4: retidos 5 anos, depois removidos do Storage (registro permanece). '
    'booking_id é FK soft — pode referenciar service_bookings ou pendencias.';

CREATE INDEX IF NOT EXISTS idx_booking_attachments_booking
    ON public.booking_attachments (booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_attachments_uploaded_by
    ON public.booking_attachments (uploaded_by);


-- =====================================================
-- 6. RLS
-- =====================================================

ALTER TABLE public.seller_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_client_pendencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_client_pendencia_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_attachments ENABLE ROW LEVEL SECURITY;

-- ── seller_clients ──

-- Equipe da loja: leitura e escrita
CREATE POLICY "seller_clients_team_all"
    ON public.seller_clients
    FOR ALL
    TO authenticated
    USING (public.is_seller_team_member(seller_id))
    WITH CHECK (public.is_seller_team_member(seller_id));

-- Cliente vê seu próprio registro (sem notas_internas — filtrado pela API)
CREATE POLICY "seller_clients_own_read"
    ON public.seller_clients
    FOR SELECT
    TO authenticated
    USING (client_user_id = auth.uid()::text);

-- ── seller_client_pendencias ──

-- Equipe via is_seller_team_member
CREATE POLICY "pendencias_team_all"
    ON public.seller_client_pendencias
    FOR ALL
    TO authenticated
    USING (public.is_seller_team_member(seller_id))
    WITH CHECK (public.is_seller_team_member(seller_id));

-- Cliente vê suas pendências via JOIN com seller_clients
CREATE POLICY "pendencias_client_read"
    ON public.seller_client_pendencias
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_clients sc
            WHERE sc.id = seller_client_pendencias.seller_client_id
              AND sc.client_user_id = auth.uid()::text
        )
    );

-- ── seller_client_pendencia_historico ──

-- Apenas equipe lê; INSERT somente via trigger SECURITY DEFINER
CREATE POLICY "historico_team_read"
    ON public.seller_client_pendencia_historico
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.seller_client_pendencias p
            WHERE p.id = seller_client_pendencia_historico.pendencia_id
              AND public.is_seller_team_member(p.seller_id)
        )
    );

-- ── booking_attachments ──

-- Equipe vê todos da loja (via booking_id que referencia pendência/booking da loja)
-- Simplificação: quem fez upload vê, e autenticados podem inserir
CREATE POLICY "attachments_uploader_read"
    ON public.booking_attachments
    FOR SELECT
    TO authenticated
    USING (uploaded_by = auth.uid()::text);

CREATE POLICY "attachments_auth_insert"
    ON public.booking_attachments
    FOR INSERT
    TO authenticated
    WITH CHECK (uploaded_by = auth.uid()::text);

-- Uploader pode deletar (soft — backend controla janela de 24h)
CREATE POLICY "attachments_uploader_delete"
    ON public.booking_attachments
    FOR DELETE
    TO authenticated
    USING (uploaded_by = auth.uid()::text);


-- =====================================================
-- 7. Security: restrict functions
-- =====================================================

REVOKE EXECUTE ON FUNCTION public.fn_audit_pendencia_update() FROM PUBLIC, anon;
