-- SCHED-CAP-013: Waitlist / Fila de Espera
-- Permite que clientes entrem na fila de espera para slots lotados.
-- Quando uma vaga abre (cancelamento/no-show), o proximo da fila e promovido automaticamente.

CREATE TABLE IF NOT EXISTS booking_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id TEXT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    position INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired', 'cancelled')),
    promoted_booking_id TEXT REFERENCES service_bookings(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    promoted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    UNIQUE (service_id, client_id, scheduled_at, status)
);

-- RLS (idempotente)
ALTER TABLE booking_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_user_read ON booking_waitlist;
CREATE POLICY waitlist_user_read ON booking_waitlist
  FOR SELECT USING (auth.uid()::text = client_id::text);

DROP POLICY IF EXISTS waitlist_admin_all ON booking_waitlist;
CREATE POLICY waitlist_admin_all ON booking_waitlist
  FOR ALL USING (
    check_global_role(auth.uid()::text, 'admin')
  );

-- Indices
CREATE INDEX IF NOT EXISTS idx_bw_service_slot ON booking_waitlist (service_id, scheduled_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_bw_client ON booking_waitlist (client_id) WHERE status = 'waiting';

COMMENT ON TABLE booking_waitlist IS '[SCHED-CAP-013] Fila de espera para slots lotados. Clientes podem entrar na fila; quando uma vaga abre (cancelamento/no-show), o proximo da fila e promovido automaticamente.';
