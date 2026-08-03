-- [VEH-PRICING VP-1] Tarifas por veículo + status manutenção
-- Permite tarifas individuais por veículo (nullable = usa fallback da loja/default)
-- + controle de habilitação para entrega + report de manutenção

-- Colunas de tarifa por veículo (nullable = usa fallback da loja)
ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS price_per_km   NUMERIC(10,2) DEFAULT NULL CHECK (price_per_km IS NULL OR price_per_km >= 0.50),
  ADD COLUMN IF NOT EXISTS base_fee       NUMERIC(10,2) DEFAULT NULL CHECK (base_fee IS NULL OR base_fee >= 0),
  ADD COLUMN IF NOT EXISTS minimum_fee    NUMERIC(10,2) DEFAULT NULL CHECK (minimum_fee IS NULL OR minimum_fee >= 0),
  ADD COLUMN IF NOT EXISTS delivery_enabled     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_status   TEXT NOT NULL DEFAULT 'operational'
    CHECK (maintenance_status IN ('operational', 'maintenance', 'retired')),
  ADD COLUMN IF NOT EXISTS maintenance_reported_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS maintenance_notes   TEXT DEFAULT NULL;

-- Index para queries de matching (veículos disponíveis para entrega)
CREATE INDEX IF NOT EXISTS idx_vehicles_delivery_eligible
  ON user_vehicles (user_id, delivery_enabled, maintenance_status, is_active)
  WHERE delivery_enabled = true AND maintenance_status = 'operational' AND is_active = true;

-- Gamification task para report de manutenção
INSERT INTO gamification_tasks (slug, name, description, xp_reward, coin_reward, is_repeatable, category)
VALUES ('report_vehicle_maintenance', 'Reportar manutenção do veículo', 'Reportou necessidade de manutenção de um veículo', 15, 5, true, 'delivery')
ON CONFLICT (slug) DO NOTHING;
