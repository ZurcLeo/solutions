-- =====================================================
-- MIGRAÇÃO: Reparo de sincronia tarefa ↔ selo
-- Problema: selos concedidos fora do fluxo de tarefas
-- deixam user_tasks com progresso desatualizado.
-- Caso concreto: invite_squad · invite_5_friends
-- Data: 2026-05-25
-- =====================================================

-- ──────────────────────────────────────────────────────
-- 1. Mapeamento task_slug → selo_slug
--    Espelha o taskToSeloMap do gamificationService.js
-- ──────────────────────────────────────────────────────
WITH task_selo_map (task_slug, selo_slug) AS (
  VALUES
    ('complete_profile',      'profile_complete'),
    ('first_login',           'welcome'),
    ('first_connection',      'first_elo'),
    ('create_first_caixinha', 'caixinha_founder'),
    ('streak_7days',          'week_warrior'),
    ('streak_30days',         'month_champion'),
    ('streak_100days',        'centenarian'),
    ('invite_5_friends',      'invite_squad'),
    ('make_5_connections',    'connector_5'),
    ('pay_on_time_3months',   'faithful_payer_3m'),
    ('pay_on_time_6months',   'faithful_payer_6m'),
    ('resolve_dispute',       'community_mediator')
),

-- Usuários que possuem o selo mas cuja tarefa NÃO está completed
inconsistent AS (
  SELECT
    us.user_id,
    gt.id     AS task_id,
    gt.target_count,
    us.granted_at
  FROM user_selos us
  JOIN selos s           ON s.id = us.selo_id
  JOIN task_selo_map tsm ON tsm.selo_slug = s.slug
  JOIN gamification_tasks gt ON gt.slug = tsm.task_slug
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_tasks ut
    WHERE ut.user_id = us.user_id
      AND ut.task_id = gt.id
      AND ut.status  = 'completed'
  )
)

-- ──────────────────────────────────────────────────────
-- 2a. Atualiza linhas existentes em user_tasks
-- ──────────────────────────────────────────────────────
UPDATE user_tasks ut
SET
  status              = 'completed',
  progress            = inc.target_count,
  completions         = GREATEST(ut.completions, 1),
  last_completed_at   = COALESCE(ut.last_completed_at, inc.granted_at),
  updated_at          = NOW()
FROM inconsistent inc
WHERE ut.user_id = inc.user_id
  AND ut.task_id = inc.task_id;

-- ──────────────────────────────────────────────────────
-- 2b. Insere linhas ausentes em user_tasks
-- ──────────────────────────────────────────────────────
WITH task_selo_map (task_slug, selo_slug) AS (
  VALUES
    ('complete_profile',      'profile_complete'),
    ('first_login',           'welcome'),
    ('first_connection',      'first_elo'),
    ('create_first_caixinha', 'caixinha_founder'),
    ('streak_7days',          'week_warrior'),
    ('streak_30days',         'month_champion'),
    ('streak_100days',        'centenarian'),
    ('invite_5_friends',      'invite_squad'),
    ('make_5_connections',    'connector_5'),
    ('pay_on_time_3months',   'faithful_payer_3m'),
    ('pay_on_time_6months',   'faithful_payer_6m'),
    ('resolve_dispute',       'community_mediator')
)
INSERT INTO user_tasks (user_id, task_id, status, progress, completions, last_completed_at)
SELECT
  us.user_id,
  gt.id,
  'completed',
  gt.target_count,
  1,
  us.granted_at
FROM user_selos us
JOIN selos s           ON s.id  = us.selo_id
JOIN task_selo_map tsm ON tsm.selo_slug = s.slug
JOIN gamification_tasks gt ON gt.slug = tsm.task_slug
WHERE NOT EXISTS (
  SELECT 1 FROM user_tasks ut
  WHERE ut.user_id = us.user_id AND ut.task_id = gt.id
)
ON CONFLICT (user_id, task_id) DO NOTHING;
