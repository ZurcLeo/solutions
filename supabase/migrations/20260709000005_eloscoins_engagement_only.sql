-- =============================================================================
-- Migration: ElosCoins como moeda exclusiva de engajamento
-- Data: 2026-07-09
-- Objetivo: Remover infraestrutura de venda por R$, reconfigurar selos para
--           critérios de engajamento comunitário, limpar dados de teste.
-- =============================================================================

-- 1. Deletar registros de compra de teste (source='purchase')
DELETE FROM xp_events WHERE source = 'purchase';

-- 2. Recalcular saldo de elo_coins em user_gamification para todos os usuários
--    afetados (soma real de coin_delta em xp_events)
UPDATE user_gamification ug
SET elo_coins = COALESCE(
  (SELECT SUM(xe.coin_delta) FROM xp_events xe WHERE xe.user_id = ug.user_id),
  0
),
updated_at = NOW();

-- 3a. Expandir CHECK constraint de category na tabela selos para incluir 'engajamento'
ALTER TABLE selos DROP CONSTRAINT IF EXISTS selos_category_check;
ALTER TABLE selos ADD CONSTRAINT selos_category_check
    CHECK (category IN (
        'conquista', 'plataforma', 'especial', 'caixinha', 'social',
        'financeiro', 'comunidade', 'engajamento'
    ));

-- 3b. Reconfigurar selos: apoiador_comunidade → engajamento (30d streak OU 50+ tasks)
UPDATE selos
SET
  name            = 'Apoiador da Comunidade',
  description     = 'Engajamento consistente: 30+ dias de streak ou 50+ missões completadas',
  category        = 'engajamento',
  grant_criteria  = '{"trigger": "engagement_milestone", "min_streak_days": 30, "or_min_tasks": 50}'::jsonb
WHERE slug = 'apoiador_comunidade';

-- 4. Reconfigurar selos: acelerador_impacto → engajamento avançado
UPDATE selos
SET
  name            = 'Acelerador de Impacto',
  description     = 'Engajamento de elite: nível 7+ ou 100+ missões ou 200+ dias de streak',
  category        = 'engajamento',
  grant_criteria  = '{"trigger": "engagement_elite", "min_level": 7, "or_min_tasks": 100, "or_min_streak_days": 200}'::jsonb
WHERE slug = 'acelerador_impacto';

-- 5. Revogar selos de apoiador/acelerador concedidos por compra (dados de teste)
DELETE FROM user_selos WHERE selo_id IN (
  SELECT id FROM selos WHERE slug IN ('apoiador_comunidade', 'acelerador_impacto')
);
