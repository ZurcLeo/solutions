-- ============================================================================
-- DOC-001: Cofre de Documentos — Gamification Tasks + Selo
-- 3 tasks + 1 selo para incentivar uso do cofre de documentos.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Expandir CHECK constraint de category para incluir 'vault'
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.gamification_tasks
    DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;
ALTER TABLE public.gamification_tasks
    ADD CONSTRAINT gamification_tasks_category_check
    CHECK (category IN (
        'identidade', 'social', 'financeiro',
        'consistencia', 'comunidade', 'caixinha',
        'delivery', 'mobilidade', 'civic', 'fiscal',
        'jogos', 'mercado', 'tecnologia', 'vault'
    ));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Tasks
-- ──────────────────────────────────────────────────────────────────────────────

-- Task 1: Primeiro upload no cofre (100 XP, 10 coins)
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order)
VALUES (
  'first_vault_upload',
  'Primeiro Documento no Cofre',
  'Envie seu primeiro documento para o cofre seguro de documentos',
  'vault', 100, 10, FALSE, 1, 1, TRUE, 1300
)
ON CONFLICT (slug) DO NOTHING;

-- Task 2: Compartilhar documento (30 XP, repeatable)
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order)
VALUES (
  'vault_document_shared',
  'Documento Compartilhado',
  'Compartilhe um documento do cofre com seu prestador de serviço',
  'vault', 30, 0, TRUE, 50, 1, TRUE, 1301
)
ON CONFLICT (slug) DO NOTHING;

-- Task 3: Análise IA de documento (50 XP, 5 coins)
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, is_active, sort_order)
VALUES (
  'vault_ai_analysis',
  'Análise Inteligente',
  'Solicite uma análise por IA de um documento no cofre',
  'vault', 50, 5, TRUE, 20, 1, TRUE, 1302
)
ON CONFLICT (slug) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Selo: Cofre Seguro (bronze, algorítmico)
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO selos (slug, name, description, category, tier, icon_url, is_platform_grant, grant_criteria)
VALUES (
  'cofre_seguro',
  'Cofre Seguro',
  'Utiliza o cofre de documentos para proteger seus arquivos com segurança',
  'plataforma', 'bronze', 'shield_lock',
  TRUE,
  '{"event": "vault_first_upload", "min_documents": 1}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
