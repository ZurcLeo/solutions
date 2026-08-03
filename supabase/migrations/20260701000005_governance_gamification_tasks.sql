-- ============================================================================
-- GOV-002 · EloCoins Governance — Gamification Tasks
-- ============================================================================

BEGIN;

-- ── Task: create_proposal (50 XP, 10 coins, repeatable) ─────────────────────

INSERT INTO gamification_tasks (slug, name, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order, metadata)
VALUES (
  'create_proposal',
  'Criar proposta de governança',
  'comunidade',
  50,
  10,
  TRUE,
  10,
  1,
  TRUE,
  200,
  '{"description": "Crie uma proposta de governança para a comunidade ElosCloud.", "icon": "🗳️"}'::JSONB
)
ON CONFLICT (slug) DO NOTHING;

-- ── Task: vote_governance (20 XP, 5 coins, repeatable) ──────────────────────

INSERT INTO gamification_tasks (slug, name, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order, metadata)
VALUES (
  'vote_governance',
  'Votar em proposta de governança',
  'comunidade',
  20,
  5,
  TRUE,
  50,
  1,
  TRUE,
  201,
  '{"description": "Participe da governança votando em propostas da comunidade.", "icon": "✅"}'::JSONB
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
