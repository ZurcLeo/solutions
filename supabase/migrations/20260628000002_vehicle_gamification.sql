-- ============================================================================
-- VEH-002 · Veículo Centralizado — Gamificação (task + selo)
-- ============================================================================

BEGIN;

-- ── Task: register_vehicle (75 XP, 15 coins, single completion) ─────────────

INSERT INTO gamification_tasks (slug, name, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order, metadata)
VALUES (
  'register_vehicle',
  'Cadastrar veículo',
  'identidade',
  75,
  15,
  FALSE,
  1,
  1,
  TRUE,
  180,
  '{"description": "Cadastre seu primeiro veículo na plataforma para entregas ou caronas.", "icon": "🚗"}'::JSONB
)
ON CONFLICT (slug) DO NOTHING;

-- ── Selo: veiculo_verificado (prata, platform-granted, algorítmico) ─────────

INSERT INTO selos (slug, name, description, category, tier, icon_url, is_active, is_platform_grant, grant_criteria)
VALUES (
  'veiculo_verificado',
  'Veículo Verificado',
  'Seu veículo foi verificado pela plataforma. Motorista de confiança!',
  'plataforma',
  'prata',
  'https://api.dicebear.com/7.x/icons/svg?seed=car-verified&icon=car',
  TRUE,
  TRUE,
  '{"type": "algorithmic", "event": "vehicle_verified", "conditions": {"verification_status": "verified"}}'::JSONB
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
