-- IMOV-008: Campo CRECI para corretores de imóveis
ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS creci text;

CREATE INDEX IF NOT EXISTS idx_seller_profiles_creci
  ON seller_profiles(creci)
  WHERE creci IS NOT NULL;
