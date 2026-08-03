-- =====================================================
-- MIGRAÇÃO: Contratos Digitais — Schema Fundação
-- Épico: ÉPICO-002 · Sprint Contratos-1
-- Autor: infra-agent + compliance-agent
-- Data: 2026-05-18
--
-- Tabelas:
--   contracts               — contrato gerado por empréstimo
--   contract_signatories    — lista de partes que devem assinar
--   contract_signature_events — audit trail imutável (append-only)
--
-- Decisões de produto consolidadas:
--   - Tipo 1 (bilateral):    tomador + admin da caixinha
--   - Tipo 2 (multilateral): tomador + todos os membros votantes
--   - requires_lawyer:       future-proof — enforcement em sprint futuro
--   - FKs TEXT (não UUID):   IDs do Firebase são strings
--   - retain_until:          calculado no momento da liquidação do empréstimo
--                            (regra: liquidação + 10 anos — Código Civil Art. 205)
-- =====================================================

-- =====================================================
-- 1. ENUM: tipos de contrato
-- =====================================================

DO $$ BEGIN
  CREATE TYPE contract_type AS ENUM ('bilateral', 'multilateral');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE contract_status AS ENUM (
    'draft',                  -- gerado, ainda não enviado ao Clicksign
    'pending_signatures',     -- enviado ao Clicksign, aguardando assinaturas
    'fully_signed',           -- todas as partes assinaram
    'cancelled',              -- cancelado (membro saiu, prazo expirou, etc.)
    'expired',                -- expires_at atingido sem todas as assinaturas
    'pending_lawyer_review'   -- future-proof: aguarda advogado assinar
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE signatory_role AS ENUM (
    'borrower',   -- tomador do empréstimo
    'approver',   -- admin que aprovou (Tipo 1)
    'member',     -- membro votante (Tipo 2)
    'lawyer'      -- advogado (future-proof, quando requires_lawyer=true)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE signature_event_type AS ENUM (
    'created',          -- contrato gerado e enviado ao Clicksign
    'sent_to_signer',   -- link de assinatura enviado ao signatário
    'viewed',           -- signatário abriu o documento
    'signed',           -- signatário assinou
    'refused',          -- signatário recusou assinar
    'cancelled',        -- contrato cancelado
    'expired',          -- envelope expirou no Clicksign
    'clicksign_webhook' -- evento bruto recebido via webhook Clicksign
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- 2. TABELA: contracts
-- =====================================================

CREATE TABLE IF NOT EXISTS contracts (
  -- Identificação
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  caixinha_id             TEXT NOT NULL,   -- FK TEXT (IDs Firebase são strings)
  loan_id                 TEXT,            -- FK TEXT — pode ser NULL (contratos não ligados a empréstimo no futuro)

  -- Tipo e status
  type                    contract_type NOT NULL,
  status                  contract_status NOT NULL DEFAULT 'draft',

  -- Clicksign
  clicksign_document_key  TEXT,            -- chave do documento no Clicksign
  clicksign_envelope_key  TEXT,            -- chave do envelope (lista de signatários)

  -- Integridade do documento
  document_hash           TEXT,            -- SHA-256 do PDF original (antes da criptografia)

  -- Storage (Supabase Storage — bucket contracts/)
  storage_path            TEXT,            -- ex: {caixinha_id}/{contract_id}/contract.pdf.enc
  clicksign_report_path   TEXT,            -- ex: {caixinha_id}/{contract_id}/clicksign_report.pdf.enc

  -- Valor (para futura lógica de limiar de advogado)
  value_total             NUMERIC(12,2) NOT NULL,

  -- Advogado (future-proof — enforcement em sprint futuro)
  requires_lawyer         BOOLEAN NOT NULL DEFAULT FALSE,
  lawyer_id               TEXT,            -- FK TEXT → users.id (quando requires_lawyer=true)
  lawyer_signed_at        TIMESTAMPTZ,

  -- Prazos
  expires_at              TIMESTAMPTZ NOT NULL,  -- prazo máximo para coleta de todas as assinaturas

  -- Conclusão
  fully_signed_at         TIMESTAMPTZ,     -- preenchido quando todas as partes assinaram

  -- LGPD / Retenção
  -- Calculado no momento da liquidação do empréstimo: liquidacao_at + 10 anos (CC Art. 205)
  -- Preenchido pelo loan-agent ao registrar liquidação.
  retain_until            TIMESTAMPTZ,

  -- Cancelamento
  cancelled_at            TIMESTAMPTZ,
  cancellation_reason     TEXT,            -- ex: 'member_left', 'timeout', 'borrower_request'

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contracts IS
  'Contratos digitais gerados por empréstimos nas caixinhas. Assinados via Clicksign. PDF criptografado no Supabase Storage (AES-256-GCM).';

COMMENT ON COLUMN contracts.type IS
  'bilateral = 1×1 (tomador + admin); multilateral = 1×N (tomador + todos os membros votantes).';

COMMENT ON COLUMN contracts.document_hash IS
  'SHA-256 do PDF original (plaintext, antes da criptografia). Usado para verificação de integridade.';

COMMENT ON COLUMN contracts.requires_lawyer IS
  'Future-proof: contratos acima de valor limite exigirão assinatura de advogado. Enforcement em sprint futuro.';

COMMENT ON COLUMN contracts.expires_at IS
  'Prazo máximo para coleta de todas as assinaturas. Após esse prazo o status muda para expired e o contrato é cancelado automaticamente.';

COMMENT ON COLUMN contracts.retain_until IS
  'LGPD: data máxima de retenção do contrato. Calculado como: data de liquidação do empréstimo + 10 anos (CC Art. 205). Preenchido pelo loan-agent na liquidação.';

-- =====================================================
-- 3. TABELA: contract_signatories
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_signatories (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id             TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL,   -- FK TEXT → users.id

  -- Role desta parte no contrato
  role                    signatory_role NOT NULL,

  -- Clicksign
  clicksign_signer_key    TEXT,            -- chave do signatário no envelope Clicksign

  -- Resultado da assinatura
  signed_at               TIMESTAMPTZ,
  refused_at              TIMESTAMPTZ,
  refusal_reason          TEXT,

  -- Evidências de não-repúdio (capturadas no momento da assinatura)
  sign_ip                 TEXT,
  sign_user_agent         TEXT,
  sign_document_hash      TEXT,            -- SHA-256 do documento no momento da assinatura deste signatário

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_signatories IS
  'Partes que devem (ou deveram) assinar o contrato. Bilateral: 2 linhas. Multilateral: N+1 linhas (tomador + membros).';

COMMENT ON COLUMN contract_signatories.sign_document_hash IS
  'Hash SHA-256 do PDF no momento exato em que este signatário assinou. Garante que o documento não foi alterado entre assinaturas.';

-- =====================================================
-- 4. TABELA: contract_signature_events
-- Audit trail imutável — NUNCA atualizar ou deletar linhas.
-- =====================================================

CREATE TABLE IF NOT EXISTS contract_signature_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  signatory_id    UUID REFERENCES contract_signatories(id) ON DELETE RESTRICT,

  event_type      signature_event_type NOT NULL,

  -- Payload bruto do webhook Clicksign (preservado para auditoria futura)
  event_data      JSONB,

  -- Evidências de rastreabilidade
  ip_address      TEXT,
  user_agent      TEXT,
  document_hash   TEXT,   -- hash do documento no momento do evento

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()

  -- SEM updated_at — tabela append-only por design
  -- RLS bloqueia UPDATE e DELETE (ver abaixo)
);

COMMENT ON TABLE contract_signature_events IS
  'Audit trail imutável de todos os eventos do ciclo de vida do contrato. Append-only via RLS. Nunca deletar ou atualizar.';

-- =====================================================
-- 5. ÍNDICES
-- =====================================================

-- contracts: busca por caixinha e loan
CREATE INDEX IF NOT EXISTS idx_contracts_caixinha
  ON contracts(caixinha_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contracts_loan
  ON contracts(loan_id)
  WHERE loan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_status
  ON contracts(status)
  WHERE status IN ('pending_signatures', 'pending_lawyer_review');

CREATE INDEX IF NOT EXISTS idx_contracts_expires
  ON contracts(expires_at)
  WHERE status = 'pending_signatures';

-- signatories: busca por contrato e por usuário
CREATE INDEX IF NOT EXISTS idx_signatories_contract
  ON contract_signatories(contract_id);

CREATE INDEX IF NOT EXISTS idx_signatories_user
  ON contract_signatories(user_id);

CREATE INDEX IF NOT EXISTS idx_signatories_pending
  ON contract_signatories(contract_id)
  WHERE signed_at IS NULL AND refused_at IS NULL;

-- events: busca por contrato (cronológica)
CREATE INDEX IF NOT EXISTS idx_events_contract
  ON contract_signature_events(contract_id, created_at ASC);

-- =====================================================
-- 6. TRIGGER: updated_at em contracts
-- =====================================================

CREATE OR REPLACE FUNCTION update_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_contracts_updated_at();

-- =====================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================
-- O backend usa service_role (bypassa RLS).
-- As políticas abaixo são defesa em profundidade para
-- chamadas via anon/authenticated key (SDK do frontend).
-- =====================================================

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signature_events ENABLE ROW LEVEL SECURITY;

-- contracts: signatário pode ver seus próprios contratos + admins globais
-- Usa check_global_role (SECURITY DEFINER) para não expor user_roles diretamente.
CREATE POLICY "contracts_select_by_signatory"
  ON contracts FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR EXISTS (
      SELECT 1 FROM contract_signatories cs
      WHERE cs.contract_id = contracts.id
        AND cs.user_id = auth.uid()::text
    )
  );

-- contracts: apenas service_role cria/atualiza/deleta
-- (sem policies de INSERT/UPDATE/DELETE = bloqueado para authenticated/anon)

-- signatories: signatário vê todas as partes do mesmo contrato (transparência entre partes)
CREATE POLICY "signatories_select_own_contract"
  ON contract_signatories FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR EXISTS (
      SELECT 1 FROM contract_signatories cs2
      WHERE cs2.contract_id = contract_signatories.contract_id
        AND cs2.user_id = auth.uid()::text
    )
  );

-- events: signatário do contrato pode ver o audit trail
CREATE POLICY "events_select_by_signatory"
  ON contract_signature_events FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR EXISTS (
      SELECT 1 FROM contract_signatories cs
      WHERE cs.contract_id = contract_signature_events.contract_id
        AND cs.user_id = auth.uid()::text
    )
  );

-- events: bloqueio explícito de UPDATE e DELETE (append-only)
CREATE POLICY "events_no_update"
  ON contract_signature_events FOR UPDATE
  USING (FALSE);

CREATE POLICY "events_no_delete"
  ON contract_signature_events FOR DELETE
  USING (FALSE);

-- =====================================================
-- 8. COMENTÁRIOS FINAIS
-- =====================================================

COMMENT ON POLICY "events_no_update" ON contract_signature_events IS
  'Audit trail é imutável. Nenhuma role pode atualizar eventos — nem service_role via RLS (mas service_role bypassa RLS; o ContractService não deve emitir UPDATEs nessa tabela).';

COMMENT ON POLICY "events_no_delete" ON contract_signature_events IS
  'Audit trail é imutável. Deleção proibida via RLS. Apenas expire via retain_until (processo LGPD controlado manualmente).';
