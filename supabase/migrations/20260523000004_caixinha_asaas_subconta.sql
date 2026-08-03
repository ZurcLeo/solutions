-- =====================================================
-- MIGRAÇÃO: Subconta Asaas por caixinha (PAYMENT-001)
-- Descrição: Adiciona colunas de subconta Asaas à tabela
--            caixinhas e cria tabela de segredos com RLS
--            restrita ao service_role.
-- Depende de: 20260513000001_caixinha_core_schema.sql
-- Autor: payment-agent (ElosCloud)
-- Data: 2026-05-23
-- =====================================================

-- 1. Colunas públicas na tabela caixinhas
ALTER TABLE caixinhas
  ADD COLUMN IF NOT EXISTS asaas_wallet_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subconta_status TEXT DEFAULT 'not_created';

-- Valores possíveis para asaas_subconta_status:
--   not_created  → caixinha criada mas subconta ainda não foi tentada
--   pending_data → tentativa falhou por falta de dados do admin (CPF/birthDate)
--   active       → subconta criada com sucesso, walletId disponível
--   failed       → erro na criação (ex: rejeição do Asaas por dados inválidos)

COMMENT ON COLUMN caixinhas.asaas_wallet_id IS
  'walletId da subconta Asaas desta caixinha. Usado no split de cobranças PIX para segregar fundos.';

COMMENT ON COLUMN caixinhas.asaas_subconta_status IS
  'Status da subconta Asaas: not_created | pending_data | active | failed';

-- 2. Tabela de segredos da subconta (acesso restrito a service_role)
CREATE TABLE IF NOT EXISTS caixinha_asaas_secrets (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  caixinha_id  TEXT NOT NULL REFERENCES caixinhas(id) ON DELETE CASCADE,
  asaas_api_key TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (caixinha_id)
);

COMMENT ON TABLE caixinha_asaas_secrets IS
  'API keys das subcontas Asaas por caixinha. Acesso restrito ao service_role — nunca expor ao cliente.';

COMMENT ON COLUMN caixinha_asaas_secrets.asaas_api_key IS
  'apiKey da subconta Asaas. Retornado somente no momento da criação — não pode ser recuperado depois.';

-- 3. RLS: somente service_role tem acesso
ALTER TABLE caixinha_asaas_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_select" ON caixinha_asaas_secrets
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "service_role_only_insert" ON caixinha_asaas_secrets
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_only_update" ON caixinha_asaas_secrets
  FOR UPDATE USING (auth.role() = 'service_role');

-- 4. Índice para lookup por caixinha_id
CREATE INDEX IF NOT EXISTS idx_caixinha_asaas_secrets_caixinha_id
  ON caixinha_asaas_secrets (caixinha_id);
