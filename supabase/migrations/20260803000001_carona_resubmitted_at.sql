-- CARONA-GAP-001: Add resubmitted_at to carona_driver_profiles
-- Tracks when a rejected driver resubmits their registration with corrected data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'carona_driver_profiles' AND column_name = 'resubmitted_at'
  ) THEN
    ALTER TABLE public.carona_driver_profiles
      ADD COLUMN resubmitted_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN public.carona_driver_profiles.resubmitted_at IS
  '[CARONA-GAP-001] Timestamp of last resubmission after rejection. NULL if never resubmitted.';
