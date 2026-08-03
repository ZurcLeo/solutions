-- =====================================================
-- MIGRAÇÃO: CPF e data de nascimento na tabela users
-- Descrição: Adiciona campos necessários para criar subcontas
--            Asaas por caixinha (PAYMENT-001). CPF e birthDate
--            saem do Firestore e passam a ter Supabase como
--            fonte primária.
-- Depende de: 20260516000004_augment_users_profile_fields.sql
-- Autor: payment-agent (ElosCloud)
-- Data: 2026-05-23
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

COMMENT ON COLUMN users.cpf IS
  'CPF do usuário (apenas dígitos, sem pontos/traços). Validado via Infosimples no fluxo de criação de caixinha.';

COMMENT ON COLUMN users.data_nascimento IS
  'Data de nascimento do usuário. Coletada e verificada no fluxo de criação de caixinha. Usada para criar subconta Asaas.';
