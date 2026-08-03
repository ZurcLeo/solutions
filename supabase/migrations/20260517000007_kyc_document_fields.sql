-- =====================================================
-- MIGRAÇÃO: KYC Fase 3 — Campos de OCR de Documentos + CNPJ/PGFN
-- Descrição: Expande a tabela user_kyc_verifications com colunas
--            necessárias para verificação por OCR (RG/CNH/Passaporte)
--            e consulta CNPJ + PGFN (organizações).
--            Atualiza o CHECK constraint de `level` para incluir 'cnpj'.
-- Autor: ClaudIA / compliance-agent
-- Data: 2026-05-17
-- =====================================================

-- =====================================================
-- 1. ATUALIZAR CHECK CONSTRAINT DO CAMPO level
-- Adiciona 'cnpj' ao conjunto de valores permitidos.
-- =====================================================

ALTER TABLE user_kyc_verifications
  DROP CONSTRAINT IF EXISTS user_kyc_verifications_level_check;

ALTER TABLE user_kyc_verifications
  ADD CONSTRAINT user_kyc_verifications_level_check
    CHECK (level IN ('cpf', 'document', 'cnpj', 'full'));

-- =====================================================
-- 2. COLUNAS DE DOCUMENTO (OCR)
-- =====================================================

ALTER TABLE user_kyc_verifications
  ADD COLUMN IF NOT EXISTS document_type TEXT
    CHECK (document_type IN ('rg', 'cnh', 'passport')),
  ADD COLUMN IF NOT EXISTS document_number_hash TEXT,   -- SHA-256(numero_documento) — NUNCA plaintext
  ADD COLUMN IF NOT EXISTS document_expiry       DATE,  -- Data de validade (OK armazenar)
  ADD COLUMN IF NOT EXISTS document_name_match   BOOLEAN; -- Nome do documento bate com o perfil?

COMMENT ON COLUMN user_kyc_verifications.document_type IS 'Tipo de documento enviado para OCR: rg, cnh ou passport.';
COMMENT ON COLUMN user_kyc_verifications.document_number_hash IS 'SHA-256(numero_do_documento) — para detectar uso do mesmo documento em múltiplas contas. NUNCA armazene o número em plaintext.';
COMMENT ON COLUMN user_kyc_verifications.document_expiry IS 'Data de validade do documento (RG/CNH/Passaporte). Seguro armazenar.';
COMMENT ON COLUMN user_kyc_verifications.document_name_match IS 'TRUE se o nome extraído pelo OCR bate (fuzzy) com o nome cadastrado no perfil do usuário.';

-- =====================================================
-- 3. COLUNAS DE CNPJ / PGFN
-- =====================================================

ALTER TABLE user_kyc_verifications
  ADD COLUMN IF NOT EXISTS cnpj_hash             TEXT,   -- SHA-256(cnpj_digits) — NUNCA plaintext
  ADD COLUMN IF NOT EXISTS cnpj_last4            TEXT,   -- Últimos 4 dígitos do CNPJ (referência de UI)
  ADD COLUMN IF NOT EXISTS receita_cnpj_situation TEXT,  -- Situação cadastral retornada pela Receita
  ADD COLUMN IF NOT EXISTS pgfn_status           TEXT
    CHECK (pgfn_status IN ('regular', 'irregular', 'unknown'));

COMMENT ON COLUMN user_kyc_verifications.cnpj_hash IS 'SHA-256(cnpj_digits_only) — permite detectar uso do mesmo CNPJ em múltiplas contas. NUNCA armazene o CNPJ em plaintext.';
COMMENT ON COLUMN user_kyc_verifications.cnpj_last4 IS 'Últimos 4 dígitos do CNPJ — para referência de UI. Não é suficiente para identificar o CNPJ.';
COMMENT ON COLUMN user_kyc_verifications.receita_cnpj_situation IS 'Situação cadastral retornada pela Receita Federal: ATIVA, SUSPENSA, INAPTA, etc.';
COMMENT ON COLUMN user_kyc_verifications.pgfn_status IS 'Resultado da consulta à PGFN: regular (certidão negativa), irregular (débitos federais), unknown (serviço indisponível).';

-- =====================================================
-- 4. ÍNDICES
-- =====================================================

-- Detecção de duplicidade: mesmo número de documento em contas diferentes
CREATE INDEX IF NOT EXISTS idx_kyc_document_hash
  ON user_kyc_verifications(document_number_hash)
  WHERE document_number_hash IS NOT NULL;

-- Detecção de duplicidade: mesmo CNPJ em contas diferentes
CREATE INDEX IF NOT EXISTS idx_kyc_cnpj_hash
  ON user_kyc_verifications(cnpj_hash)
  WHERE cnpj_hash IS NOT NULL;

-- =====================================================
-- 5. COMENTÁRIO DA TABELA (atualizar)
-- =====================================================

COMMENT ON TABLE user_kyc_verifications IS
  'Histórico imutável de tentativas de verificação de identidade (KYC). '
  'Fases: cpf (Receita Federal), document (OCR RG/CNH/Passaporte), cnpj (Receita CNPJ + PGFN), full. '
  'Dados sensíveis NUNCA armazenados em plaintext — apenas SHA-256 hashes.';
