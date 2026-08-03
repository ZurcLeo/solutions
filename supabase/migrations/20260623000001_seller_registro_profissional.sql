-- ============================================================================
-- Migration: Registro Profissional Verificado
-- Adiciona campos de registro profissional (CRC, OAB, CRM, etc.) ao seller_profiles.
-- ============================================================================

ALTER TABLE seller_profiles
  ADD COLUMN registro_profissional_tipo TEXT
    CHECK (registro_profissional_tipo IN ('CRC','OAB','CRM','CREA','CAU','COREN','CRP','CRN','outro')),
  ADD COLUMN registro_profissional_numero TEXT,
  ADD COLUMN registro_profissional_uf TEXT,
  ADD COLUMN registro_profissional_verificado BOOLEAN DEFAULT false,
  ADD COLUMN registro_profissional_verificado_em TIMESTAMPTZ;

CREATE INDEX idx_seller_registro_tipo ON seller_profiles(registro_profissional_tipo)
  WHERE registro_profissional_tipo IS NOT NULL;
