-- Lower minimum trust level for passengers from 2 to 1 (Novato).
-- Users can increase their trust level by interacting within rides.
-- Offering rides remains at level 3 (Vizinho de Confiança).

ALTER TABLE public.carona_rides
  ALTER COLUMN required_trust_level SET DEFAULT 1;

-- Update existing rides that still use the old default
UPDATE public.carona_rides
  SET required_trust_level = 1
  WHERE required_trust_level = 2
    AND status IN ('open', 'scheduled');
