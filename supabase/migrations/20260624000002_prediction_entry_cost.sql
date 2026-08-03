-- 20260624000002_prediction_entry_cost.sql
-- Palpites pagos com ElosCoins: custo por palpite definido pelo criador

-- Custo por palpite (10–50 ElosCoins, NULL = gratuito legacy)
ALTER TABLE games ADD COLUMN IF NOT EXISTS entry_cost INTEGER
  CHECK (entry_cost IS NULL OR (entry_cost >= 10 AND entry_cost <= 50));

COMMENT ON COLUMN games.entry_cost IS 'Custo em ElosCoins por palpite (10-50). NULL = gratuito.';

-- Registro do custo efetivamente pago em cada entry (auditoria, imutável)
ALTER TABLE prediction_entries ADD COLUMN IF NOT EXISTS cost_paid INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN prediction_entries.cost_paid IS 'ElosCoins debitados ao registrar este palpite. 0 = gratuito.';
