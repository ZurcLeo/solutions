-- ============================================================================
-- DOC-001: Cofre de Documentos por Relacionamento — Schema
-- Adds:
--   1. booking_document_vaults — cofre isolado por par cliente+prestador
--   2. booking_documents — documentos no cofre com hash SHA-256
--   3. document_access_log — audit trail imutável (append-only)
--   4. document_ai_analyses — resultados de análise IA
--   5. RPC get_vault_for_booking
--   6. Triggers updated_at
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. booking_document_vaults — cofre por relacionamento
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_document_vaults (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  booking_id        TEXT,
  client_uid        TEXT NOT NULL,
  provider_uid      TEXT NOT NULL,
  authorized_uids   TEXT[] NOT NULL DEFAULT '{}',
  relationship_type TEXT NOT NULL DEFAULT 'booking'
    CHECK (relationship_type IN ('booking', 'continuous')),
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  document_count    INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sealed', 'expired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- booking_id obrigatório se type = 'booking'
  CONSTRAINT vault_booking_required
    CHECK (relationship_type != 'booking' OR booking_id IS NOT NULL),

  -- cliente e prestador devem ser diferentes
  CONSTRAINT vault_different_parties
    CHECK (client_uid != provider_uid)
);

-- Um vault por booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_booking_unique
  ON public.booking_document_vaults (booking_id)
  WHERE booking_id IS NOT NULL;

-- Um vault continuous por par cliente+prestador
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_continuous_unique
  ON public.booking_document_vaults (client_uid, provider_uid)
  WHERE relationship_type = 'continuous';

CREATE INDEX IF NOT EXISTS idx_vault_client
  ON public.booking_document_vaults (client_uid);

CREATE INDEX IF NOT EXISTS idx_vault_provider
  ON public.booking_document_vaults (provider_uid);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_booking_document_vaults_updated_at
  BEFORE UPDATE ON public.booking_document_vaults
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS
ALTER TABLE public.booking_document_vaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY vault_select ON public.booking_document_vaults
  FOR SELECT USING (
    client_uid = auth.uid()::text
    OR provider_uid = auth.uid()::text
    OR auth.uid()::text = ANY(authorized_uids)
  );

CREATE POLICY vault_insert ON public.booking_document_vaults
  FOR INSERT WITH CHECK (
    client_uid = auth.uid()::text
    OR provider_uid = auth.uid()::text
  );

CREATE POLICY vault_update ON public.booking_document_vaults
  FOR UPDATE USING (
    client_uid = auth.uid()::text
    OR provider_uid = auth.uid()::text
  );

COMMENT ON TABLE public.booking_document_vaults IS
  'Cofre de documentos isolado por relacionamento cliente-prestador. LGPD by design.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. booking_documents — documentos no cofre
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_documents (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  vault_id        TEXT NOT NULL REFERENCES public.booking_document_vaults(id) ON DELETE CASCADE,
  uploaded_by     TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  mime_type       TEXT NOT NULL,
  sha256_hash     TEXT,
  share_consent   BOOLEAN NOT NULL DEFAULT false,
  ai_consent      BOOLEAN NOT NULL DEFAULT false,
  document_type   TEXT NOT NULL DEFAULT 'outro'
    CHECK (document_type IN (
      'contrato', 'laudo', 'receita', 'exame', 'declaracao',
      'nota_fiscal', 'procuracao', 'alvara', 'certidao', 'outro'
    )),
  mime_verified   BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ,
  deleted_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_vault
  ON public.booking_documents (vault_id);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by
  ON public.booking_documents (uploaded_by);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_booking_documents_updated_at
  BEFORE UPDATE ON public.booking_documents
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS
ALTER TABLE public.booking_documents ENABLE ROW LEVEL SECURITY;

-- Participantes do vault podem ler documentos
CREATE POLICY documents_select ON public.booking_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.booking_document_vaults v
      WHERE v.id = vault_id
        AND (
          v.client_uid = auth.uid()::text
          OR v.provider_uid = auth.uid()::text
          OR auth.uid()::text = ANY(v.authorized_uids)
        )
    )
  );

-- Participantes do vault podem inserir documentos
CREATE POLICY documents_insert ON public.booking_documents
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.booking_document_vaults v
      WHERE v.id = vault_id
        AND (
          v.client_uid = auth.uid()::text
          OR v.provider_uid = auth.uid()::text
          OR auth.uid()::text = ANY(v.authorized_uids)
        )
    )
  );

-- Apenas quem fez upload pode atualizar (consent, soft-delete)
CREATE POLICY documents_update ON public.booking_documents
  FOR UPDATE USING (
    uploaded_by = auth.uid()::text
  );

COMMENT ON TABLE public.booking_documents IS
  'Documentos dentro de um cofre. SHA-256 para integridade, consent granular share/AI.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. document_access_log — audit trail IMUTÁVEL
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_access_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id TEXT REFERENCES public.booking_documents(id) ON DELETE SET NULL,
  vault_id    TEXT NOT NULL REFERENCES public.booking_document_vaults(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL
    CHECK (action IN (
      'uploaded', 'viewed', 'downloaded', 'shared',
      'consent_granted', 'consent_revoked',
      'ai_analyzed', 'deleted', 'hash_verified', 'exported'
    )),
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NÃO tem updated_at: append-only
);

CREATE INDEX IF NOT EXISTS idx_access_log_document
  ON public.document_access_log (document_id, created_at);

CREATE INDEX IF NOT EXISTS idx_access_log_vault
  ON public.document_access_log (vault_id, created_at);

-- RLS: apenas service_role pode inserir/ler (backend)
ALTER TABLE public.document_access_log ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para authenticated = service_role only
-- O backend usa supabase admin client para acessar

COMMENT ON TABLE public.document_access_log IS
  'Audit trail imutável de acessos a documentos. Sem UPDATE/DELETE policies — append-only.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. document_ai_analyses — resultados IA
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_ai_analyses (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id     TEXT NOT NULL REFERENCES public.booking_documents(id) ON DELETE CASCADE,
  vault_id        TEXT NOT NULL REFERENCES public.booking_document_vaults(id) ON DELETE CASCADE,
  requested_by    TEXT NOT NULL,
  summary         TEXT,
  key_points      JSONB DEFAULT '[]',
  risk_flags      JSONB DEFAULT '[]',
  classification  JSONB DEFAULT '{}',
  model_used      TEXT,
  tokens_used     INT DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_document
  ON public.document_ai_analyses (document_id);

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_document_ai_analyses_updated_at
  BEFORE UPDATE ON public.document_ai_analyses
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS: participantes do vault podem ler
ALTER TABLE public.document_ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_analyses_select ON public.document_ai_analyses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.booking_document_vaults v
      WHERE v.id = vault_id
        AND (
          v.client_uid = auth.uid()::text
          OR v.provider_uid = auth.uid()::text
          OR auth.uid()::text = ANY(v.authorized_uids)
        )
    )
  );

-- Apenas service_role insere (backend faz a análise)

COMMENT ON TABLE public.document_ai_analyses IS
  'Resultados de análise IA de documentos. Requer ai_consent=true no documento.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. RPC: get_vault_for_booking
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_vault_for_booking(p_booking_id TEXT)
RETURNS SETOF public.booking_document_vaults
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.booking_document_vaults
  WHERE booking_id = p_booking_id
    AND (
      client_uid = auth.uid()::text
      OR provider_uid = auth.uid()::text
      OR auth.uid()::text = ANY(authorized_uids)
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_vault_for_booking(TEXT) IS
  'Retorna o vault associado a um booking, com verificação de acesso.';

COMMIT;
