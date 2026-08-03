-- =====================================================
-- MIGRAÇÃO: Adicionar data_nascimento à tabela users
-- Descrição: Campo necessário para verificação KYC via Receita Federal.
--            Não é sensível (diferente do CPF) — armazenado como DATE.
-- Autor: ClaudIA / compliance-agent
-- Data: 2026-05-17
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

COMMENT ON COLUMN users.data_nascimento IS 'Data de nascimento do usuário. Usada para consulta à Receita Federal no fluxo KYC. Não é dado sensível — não requer criptografia.';
