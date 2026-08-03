-- Migration: veículo do usuário em user_preferences
-- Permite registro básico de veículo antes de criar loja de entrega

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS vehicle_type  text CHECK (vehicle_type IN ('bike','moto','car','van')),
  ADD COLUMN IF NOT EXISTS vehicle_plate text;

COMMENT ON COLUMN user_preferences.vehicle_type  IS 'Tipo de veículo para entregas (bike/moto/car/van)';
COMMENT ON COLUMN user_preferences.vehicle_plate IS 'Placa do veículo (opcional, LGPD — visível só ao próprio usuário)';
