-- Migration: seller_profiles_approval
-- Adiciona campo status_note e inclui 'rejected' como status válido.

-- 1. Adicionar coluna status_note (motivo da rejeição ou nota do aprovador)
ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS status_note TEXT;

-- 2. Ampliar o CHECK de status para incluir 'rejected'
--    (DROP CONSTRAINT IF EXISTS é seguro; o nome pode variar)
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'seller_profiles'::regclass
    AND contype = 'c'
    AND conname ILIKE '%status%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE seller_profiles DROP CONSTRAINT %I', cname);
  END IF;
END;
$$;

ALTER TABLE seller_profiles
  ADD CONSTRAINT seller_profiles_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'rejected'));
