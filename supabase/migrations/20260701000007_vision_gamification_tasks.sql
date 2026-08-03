-- ============================================================================
-- VISION-002 · Vision Extraction — Gamificacao (task)
-- ============================================================================

BEGIN;

-- Expandir CHECK constraint de category para incluir 'tecnologia'
ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;
ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category IN (
        'identidade', 'social', 'financeiro',
        'consistencia', 'comunidade', 'caixinha',
        'delivery', 'mobilidade', 'civic', 'fiscal',
        'jogos', 'mercado', 'tecnologia'
    ));

-- ── Task: use_vision_extraction (10 XP, 5 coins, repeatable) ────────────────

INSERT INTO gamification_tasks (slug, name, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order, metadata)
VALUES (
  'use_vision_extraction',
  'Usar extracao visual',
  'tecnologia',
  10,
  5,
  TRUE,
  50,
  1,
  TRUE,
  190,
  '{"description": "Extraia dados de uma imagem usando a tecnologia de visao da ElosCloud.", "icon": "📷"}'::JSONB
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
