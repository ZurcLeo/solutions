-- SCHED-CAP-011: Check-in QR Code
-- Adds check-in support to service_bookings for QR-based attendance tracking.

ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE service_bookings ADD COLUMN IF NOT EXISTS checkin_token TEXT;

-- Index para lookup rápido por token (parcial — só onde token existe)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sb_checkin_token
  ON service_bookings (checkin_token)
  WHERE checkin_token IS NOT NULL;
