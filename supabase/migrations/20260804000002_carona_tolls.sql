-- W3: Pedágios na carona solidária
-- Adiciona colunas de pedágio ao carona_rides para suportar
-- estimativa de pedágio via Google Routes API v2

ALTER TABLE carona_rides
  ADD COLUMN IF NOT EXISTS has_tolls BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS toll_total_brl NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS toll_per_seat_brl NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS toll_split_mode VARCHAR(10) DEFAULT 'absorb';
