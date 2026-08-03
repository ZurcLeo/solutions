-- ============================================================================
-- VEH-001 · Veículo Centralizado — Tabela user_vehicles + FK + backfill
-- ============================================================================
-- Cria tabela centralizada de veículos, adiciona FKs em delivery_services e
-- carona_driver_profiles, e faz backfill dos dados fragmentados.
-- ============================================================================

BEGIN;

-- ── 1. Tabela user_vehicles ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_vehicles (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  vehicle_type        TEXT NOT NULL CHECK (vehicle_type IN ('bike', 'moto', 'carro', 'van', 'caminhonete')),
  plate               TEXT,
  model               TEXT,
  color               TEXT,
  year                INT,
  renavam             TEXT,
  nickname            TEXT,
  is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  vehicle_doc_url     TEXT,
  vehicle_photo_url   TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Placa obrigatória para veículos motorizados
  CONSTRAINT chk_plate_required CHECK (
    vehicle_type = 'bike' OR (plate IS NOT NULL AND char_length(plate) >= 6)
  ),

  -- RENAVAM se informado deve ter 11 dígitos
  CONSTRAINT chk_renavam_format CHECK (
    renavam IS NULL OR renavam ~ '^\d{11}$'
  )
);

-- Placa única entre veículos ativos (ignora inativos e bikes sem placa)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_vehicles_plate_unique
  ON user_vehicles (upper(plate))
  WHERE is_active = TRUE AND plate IS NOT NULL;

-- Índice para consultas por usuário
CREATE INDEX IF NOT EXISTS idx_user_vehicles_user_active
  ON user_vehicles (user_id)
  WHERE is_active = TRUE;

-- ── 2. Trigger updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_fn_user_vehicles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_vehicles_updated_at
  BEFORE UPDATE ON user_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_user_vehicles_updated_at();

-- ── 3. Trigger: garantir veículo primário único por usuário ─────────────────

CREATE OR REPLACE FUNCTION trg_fn_ensure_single_primary_vehicle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_primary = TRUE AND NEW.is_active = TRUE THEN
    UPDATE user_vehicles
    SET is_primary = FALSE
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_primary = TRUE
      AND is_active = TRUE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ensure_single_primary_vehicle
  BEFORE INSERT OR UPDATE OF is_primary ON user_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_ensure_single_primary_vehicle();

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE user_vehicles ENABLE ROW LEVEL SECURITY;

-- Dono: CRUD nos próprios veículos
CREATE POLICY "uv_owner_all" ON user_vehicles
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Admin: leitura de todos (para verificação)
CREATE POLICY "uv_admin_select" ON user_vehicles
  FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
  );

-- ── 5. ALTER delivery_services — adicionar vehicle_id ───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'delivery_services' AND column_name = 'vehicle_id'
  ) THEN
    ALTER TABLE delivery_services
      ADD COLUMN vehicle_id TEXT REFERENCES user_vehicles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 6. ALTER carona_driver_profiles — adicionar vehicle_id ──────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'carona_driver_profiles' AND column_name = 'vehicle_id'
  ) THEN
    ALTER TABLE carona_driver_profiles
      ADD COLUMN vehicle_id TEXT REFERENCES user_vehicles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 7. Backfill: carona_driver_profiles → user_vehicles + link ──────────────

-- Cria veículos a partir de perfis de carona que não foram cobertos pelo backfill anterior
INSERT INTO user_vehicles (id, user_id, vehicle_type, plate, model, color, year, is_primary, verification_status)
SELECT
  'veh_' || substr(gen_random_uuid()::text, 1, 12),
  cdp.user_id,
  cdp.vehicle_type,
  cdp.vehicle_plate,
  cdp.vehicle_model,
  cdp.vehicle_color,
  cdp.vehicle_year,
  TRUE,
  cdp.verification_status
FROM carona_driver_profiles cdp
WHERE NOT EXISTS (
  SELECT 1 FROM user_vehicles uv
  WHERE uv.user_id = cdp.user_id
    AND uv.vehicle_type = cdp.vehicle_type
    AND (
      (uv.plate IS NOT NULL AND uv.plate = cdp.vehicle_plate)
      OR (uv.plate IS NULL AND cdp.vehicle_plate IS NULL)
    )
)
ON CONFLICT DO NOTHING;

-- Vincula carona_driver_profiles ao veículo backfillado correspondente
UPDATE carona_driver_profiles cdp
SET vehicle_id = (
  SELECT uv.id FROM user_vehicles uv
  WHERE uv.user_id = cdp.user_id
    AND uv.vehicle_type = cdp.vehicle_type
    AND (
      (uv.plate IS NOT NULL AND uv.plate = cdp.vehicle_plate)
      OR (uv.plate IS NULL AND cdp.vehicle_plate IS NULL)
    )
  LIMIT 1
)
WHERE cdp.vehicle_id IS NULL;

COMMIT;
