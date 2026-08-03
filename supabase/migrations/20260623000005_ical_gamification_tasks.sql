-- =====================================================
-- MIGRAÇÃO: iCal Sync — Tasks e Selo de Gamificação
-- [ICAL-SYNC] Lei do Time: triggers de gamificação
--
-- Evento mapeado em gamificationService.triggerEvent:
--   ical_sync_configured → ical_sync_configured (task slug)
--
-- Depende de:
--   20260514000002_gamification_schema.sql  (gamification_tasks, selos)
--   20260622000004_fiscal_gamification_tasks.sql (último CHECK de category)
--   20260623000003_ical_sync_schema.sql (tabela property_ical_sources)
--
-- Agente: marketplace-agent | Revisado por: Léo (PO)
-- Data: 2026-06-23
-- =====================================================


-- =====================================================
-- 1. Task de gamificação — iCal Sync
-- =====================================================

INSERT INTO public.gamification_tasks (
    slug, name, description,
    category, xp_reward, coin_reward,
    is_repeatable, max_completions, target_count,
    sort_order
) VALUES (
    'ical_sync_configured',
    'Conectar calendário externo',
    'Configure a sincronização iCal com Airbnb, Booking ou outro calendário.',
    'mercado', 50, 5,
    FALSE, 1, 1,
    1100
) ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- 2. Selo — Anfitrião Conectado (conquista, prata)
-- =====================================================

INSERT INTO public.selos (
    slug, name, description,
    category, tier, color_hex,
    is_active, is_platform_grant, grant_criteria,
    xp_bonus, coin_bonus, sort_order
) VALUES (
    'anfitriao_conectado',
    'Anfitrião Conectado',
    'Configurou sincronização iCal bilateral com plataformas externas.',
    'conquista', 'prata', '#3B82F6',
    TRUE, FALSE, '{}'::jsonb,
    60, 10, 40
) ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Task inserida:
-- SELECT slug, name, xp_reward, coin_reward, is_repeatable
-- FROM public.gamification_tasks
-- WHERE slug = 'ical_sync_configured';
-- Esperado: 1 linha.

-- V2. Selo inserido:
-- SELECT slug, name, category, tier
-- FROM public.selos
-- WHERE slug = 'anfitriao_conectado';
-- Esperado: 1 linha.
