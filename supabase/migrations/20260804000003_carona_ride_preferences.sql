-- Granular ride preferences: luggage types, pet conditions, trip vibes
-- W3.1: Replaces simple boolean toggles with structured options

ALTER TABLE carona_rides
  ADD COLUMN IF NOT EXISTS luggage_options JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pet_options JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS conversation_level SMALLINT DEFAULT 50,
  ADD COLUMN IF NOT EXISTS music_level SMALLINT DEFAULT 50;

COMMENT ON COLUMN carona_rides.luggage_options IS 'Tipos de bagagem aceitos: {"backpack":true,"small_suitcase":true,"medium_suitcase":false,"large_suitcase":false}';
COMMENT ON COLUMN carona_rides.pet_options IS 'Condições para pets: {"carrier_only":true,"small_only":true,"extra_seat":false}';
COMMENT ON COLUMN carona_rides.conversation_level IS '0=silêncio, 50=às vezes, 100=adoro conversar';
COMMENT ON COLUMN carona_rides.music_level IS '0=silêncio, 50=às vezes, 100=adoro música';
