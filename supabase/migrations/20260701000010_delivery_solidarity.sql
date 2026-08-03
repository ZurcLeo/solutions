-- =====================================================
-- MIGRAÇÃO: DELIVERY-SOL-001 — Entrega Solidária
--
-- Adiciona modo solidário às entregas:
--   - is_solidarity: boolean flag para pular taxa mínima
--   - tip_amount: gorjeta voluntária pós-entrega
--   - gamification task para entregas solidárias concluídas
--
-- Depende de:
--   20260610000001_delivery_schema.sql (delivery_requests)
--   20260514000002_gamification_schema.sql (gamification_tasks)
--
-- Agente: marketplace-agent | Data: 2026-07-01
-- =====================================================

-- 1. Adiciona colunas à delivery_requests
ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS is_solidarity BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(8,2) NOT NULL DEFAULT 0
    CHECK (tip_amount >= 0);

COMMENT ON COLUMN public.delivery_requests.is_solidarity IS
  '[DELIVERY-SOL-001] Quando true, a taxa mínima (minimum_fee) é ignorada. '
  'O entregador recebe apenas o custo por km calculado pela fórmula raw. '
  'Incentiva entregas curtas e solidárias na comunidade.';

COMMENT ON COLUMN public.delivery_requests.tip_amount IS
  '[DELIVERY-SOL-001] Gorjeta voluntária adicionada pelo comprador após a entrega. '
  'Valor em BRL. Default 0. Máximo R$ 500,00 (validado no backend).';

-- 2. Gamification task: entrega solidária concluída
INSERT INTO public.gamification_tasks (
  slug, name, description, category,
  xp_reward, coin_reward,
  is_repeatable, max_completions, target_count,
  is_active
) VALUES (
  'delivery_solidarity_completed',
  'Entrega Solidária',
  'Concluiu uma entrega no modo solidário, sem taxa mínima.',
  'mercado',
  80, 20,
  true, NULL, 1,
  true
) ON CONFLICT (slug) DO NOTHING;
