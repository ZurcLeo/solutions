-- RECALL-FIX-001 item C: Expirar bookings confirmed com horário já passado.
-- Booking confirmed cujo scheduled_at + duration_minutes já passou não deveria
-- permanecer "confirmed" indefinidamente — transiciona para expired.

CREATE OR REPLACE FUNCTION expire_stale_confirmed_bookings()
RETURNS TABLE(booking_id UUID, client_id UUID, provider_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE service_bookings sb
  SET
    status       = 'expired',
    cancelled_at = NOW(),
    cancelled_by = 'system'
  WHERE sb.status = 'confirmed'
    AND (sb.scheduled_at + (COALESCE(sb.duration_minutes, 60) || ' minutes')::INTERVAL) < NOW()
  RETURNING sb.id AS booking_id, sb.client_id, sb.provider_id;
END;
$$;

COMMENT ON FUNCTION expire_stale_confirmed_bookings IS
  'RECALL-FIX-001C: Expira bookings confirmed cujo horário de término já passou. Cron via bookingService.';
