-- ============================================================
-- Paradas intermediárias de carona (W2)
-- Motorista pode declarar 0-3 paradas ao criar/editar viagem
-- ============================================================

CREATE TABLE IF NOT EXISTS carona_ride_stops (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ride_id     TEXT NOT NULL REFERENCES carona_rides(id) ON DELETE CASCADE,
  stop_order  SMALLINT NOT NULL CHECK (stop_order >= 0 AND stop_order <= 2),
  address     TEXT NOT NULL,
  neighborhood TEXT,
  city        TEXT NOT NULL,
  state       VARCHAR(60),
  cep         TEXT,
  lat         NUMERIC(10,7),
  lng         NUMERIC(10,7),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (ride_id, stop_order)
);

-- Index para busca por ride_id + ordem
CREATE INDEX IF NOT EXISTS idx_carona_ride_stops_ride
  ON carona_ride_stops (ride_id, stop_order);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE carona_ride_stops ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer usuário autenticado pode ver paradas de rides visíveis
CREATE POLICY "carona_ride_stops_select"
  ON carona_ride_stops FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: apenas o driver do ride pode inserir paradas
CREATE POLICY "carona_ride_stops_insert"
  ON carona_ride_stops FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM carona_rides
      WHERE carona_rides.id = ride_id
        AND carona_rides.driver_id = auth.uid()::text
    )
  );

-- UPDATE: apenas o driver do ride
CREATE POLICY "carona_ride_stops_update"
  ON carona_ride_stops FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM carona_rides
      WHERE carona_rides.id = ride_id
        AND carona_rides.driver_id = auth.uid()::text
    )
  );

-- DELETE: apenas o driver do ride
CREATE POLICY "carona_ride_stops_delete"
  ON carona_ride_stops FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM carona_rides
      WHERE carona_rides.id = ride_id
        AND carona_rides.driver_id = auth.uid()::text
    )
  );

-- ── Grants (necessários para PostgREST expor a tabela) ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON carona_ride_stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON carona_ride_stops TO service_role;
