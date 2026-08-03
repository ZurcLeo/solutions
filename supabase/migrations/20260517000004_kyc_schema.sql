-- =====================================================
-- MIGRAÇÃO: KYC / Verificação de Identidade (ElosCloud)
-- Descrição: Tabela de verificações KYC por usuário (CPF via InfoSimples/Receita Federal).
--            Dados sensíveis NUNCA armazenados em plaintext — apenas hashes.
-- Autor: ClaudIA / compliance-agent
-- Data: 2026-05-17
-- =====================================================

-- =====================================================
-- 1. COLUNAS KYC NA TABELA users
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none'
    CHECK (kyc_status IN ('none', 'pending', 'verified', 'failed', 'manual_review')),
  ADD COLUMN IF NOT EXISTS kyc_level TEXT DEFAULT 'none'
    CHECK (kyc_level IN ('none', 'cpf', 'document', 'full')),
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.kyc_status IS 'Status atual do KYC: none (não iniciado), pending (em análise), verified (aprovado), failed (reprovado), manual_review (revisão humana).';
COMMENT ON COLUMN users.kyc_level IS 'Nível de verificação alcançado: none, cpf (Receita Federal), document (OCR), full (biométrico).';
COMMENT ON COLUMN users.kyc_verified_at IS 'Timestamp da aprovação mais recente do KYC.';

-- =====================================================
-- 2. TABELA user_kyc_verifications
-- Histórico imutável de tentativas de verificação KYC.
-- =====================================================

CREATE TABLE IF NOT EXISTS user_kyc_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identificação civil (NUNCA plaintext)
  cpf_hash        TEXT,    -- SHA-256(cpf) — para busca de duplicidade entre usuários
  cpf_last4       TEXT,    -- Últimos 4 dígitos para referência de UI (ex: "***-89")

  -- Resultado da verificação
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'failed', 'manual_review')),
  level           TEXT NOT NULL DEFAULT 'cpf'
                    CHECK (level IN ('cpf', 'document', 'full')),

  -- Dados retornados pela Receita Federal (sem CPF — apenas para conferência de nome/nascimento)
  -- Armazenados APENAS se status = 'verified', e sem campos que revelem CPF
  receita_name    TEXT,    -- Nome completo retornado pela Receita
  receita_situation TEXT,  -- "REGULAR", "SUSPENSA", etc.
  name_match      BOOLEAN, -- Nome do usuário bate com o da Receita?
  birth_match     BOOLEAN, -- Data de nascimento bate?

  -- Rastreabilidade
  failed_reason   TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  ip_address      TEXT,
  user_agent      TEXT,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 3. ÍNDICES
-- =====================================================

-- Busca por usuário (dashboard KYC)
CREATE INDEX IF NOT EXISTS idx_kyc_user_id
  ON user_kyc_verifications(user_id);

-- Busca de duplicidade: mesmo CPF em contas diferentes (fraude)
CREATE INDEX IF NOT EXISTS idx_kyc_cpf_hash
  ON user_kyc_verifications(cpf_hash)
  WHERE cpf_hash IS NOT NULL;

-- Busca por status (fila de revisão manual)
CREATE INDEX IF NOT EXISTS idx_kyc_status
  ON user_kyc_verifications(status)
  WHERE status IN ('pending', 'manual_review');

-- Histórico por usuário mais recente primeiro
CREATE INDEX IF NOT EXISTS idx_kyc_user_created
  ON user_kyc_verifications(user_id, created_at DESC);

-- =====================================================
-- 4. TRIGGER: updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_kyc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_kyc_updated_at
  BEFORE UPDATE ON user_kyc_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_kyc_updated_at();

-- =====================================================
-- 5. ROW LEVEL SECURITY
-- O backend usa service_role (bypassa RLS).
-- Nenhuma política de acesso direto — dados KYC são altamente sensíveis.
-- =====================================================

ALTER TABLE user_kyc_verifications ENABLE ROW LEVEL SECURITY;

-- Sem políticas explícitas = acesso negado para anon/authenticated por padrão.
-- Apenas service_role (backend) pode ler/escrever.

-- =====================================================
-- 6. COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE user_kyc_verifications IS 'Histórico imutável de tentativas de verificação de identidade (KYC). CPF nunca armazenado em plaintext — apenas SHA-256 hash.';
COMMENT ON COLUMN user_kyc_verifications.cpf_hash IS 'SHA-256(cpf_digits_only) — permite detectar duplicidade sem expor o CPF. Nunca armazene o CPF em plaintext.';
COMMENT ON COLUMN user_kyc_verifications.cpf_last4 IS 'Últimos 4 dígitos numéricos do CPF — para referência de UI (ex: "***-89"). Não é suficiente para identificar o CPF.';
COMMENT ON COLUMN user_kyc_verifications.receita_name IS 'Nome completo retornado pela Receita Federal. Armazenado apenas quando status = verified.';
COMMENT ON COLUMN user_kyc_verifications.name_match IS 'TRUE se o nome declarado pelo usuário bate (ilike fuzzy) com o nome da Receita.';
