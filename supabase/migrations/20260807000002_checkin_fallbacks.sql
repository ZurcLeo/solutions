-- [SCHED-CAP-011] Check-in fallback: PIN + manual provider check-in
-- Adds checked_in_by column to track who performed the check-in

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS checked_in_by TEXT DEFAULT 'client'
    CHECK (checked_in_by IN ('client', 'provider'));
