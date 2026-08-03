-- Migration: 20260609000001_caixinha_settings_fields.sql
-- Adiciona campo allow_rifas à tabela caixinhas.
-- Nota: allow_loans é mapeado para permite_emprestimos (já existente).

ALTER TABLE caixinhas
  ADD COLUMN IF NOT EXISTS allow_rifas BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN caixinhas.allow_rifas
  IS 'Habilita criação de rifas dentro da caixinha. Controlado pelo admin/gerente.';
