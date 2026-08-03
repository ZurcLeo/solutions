-- =====================================================
-- MIGRAÇÃO: Trust Domain 'external'
-- [GP-FIX] Adiciona domínio 'external' ao CHECK de trust_events
--
-- Contexto:
--   O googlePlacesService.js dispara eventos com domain='external'
--   (event_type: 'external_place_verified', impact 1-5) mas o
--   CHECK constraint trust_events_domain_check não inclui 'external'.
--   Isso causa violação de constraint em qualquer _fireTrustEvent().
--
-- Peso do domínio: 6 (já definido em trustPassportService.js)
--   Soma atual: account(8) + social(13) + financial(17) + stays(10) +
--               delivery(8) + marketplace(11) + moderation(9) + civic(8) +
--               mobility(8) = 92
--   Com external: + external(6) = 98
--
-- Depende de:
--   20260620000004_trust_mobility_domain.sql (último ALTER do CHECK)
--   20260626000001_google_places_integration.sql (googlePlacesService)
--
-- Agente: claudia-agent | Revisado por: Léo (PO)
-- Data: 2026-06-27
-- =====================================================


-- =====================================================
-- 1. ALTER trust_events CHECK: adicionar domínio 'external'
-- =====================================================

ALTER TABLE public.trust_events
    DROP CONSTRAINT IF EXISTS trust_events_domain_check;

ALTER TABLE public.trust_events
    ADD CONSTRAINT trust_events_domain_check
    CHECK (domain IN (
        'account', 'social', 'financial', 'stays',
        'delivery', 'marketplace', 'moderation', 'civic',
        'mobility', 'external'
    ));


-- =====================================================
-- 2. Documentação: eventos de trust para external
-- =====================================================
-- Eventos registrados pelo googlePlacesService.js:
--
-- | Evento                     | Domínio   | Impact | isNeg | Contexto                                  |
-- |----------------------------|-----------|--------|-------|-------------------------------------------|
-- | external_place_verified    | external  | +1~5   | false | Seller vincula Google Place ao perfil      |
--
-- Impact calculado por rating + reviews:
--   rating >= 4.5 AND reviews >= 100 → impact = 5
--   rating >= 4.0 AND reviews >= 50  → impact = 3
--   rating >= 3.5 AND reviews >= 20  → impact = 1
--   else → 0 (evento não disparado)
--
-- Validador em trustPassportService.js:
-- {
--   key: 'negocio_verificado_externamente',
--   label: 'Negócio Verificado Externamente',
--   domain: 'external',
--   check: (ctx) => ctx.domainAvg.external >= 3.5 && ctx.domainCount.external >= 1
-- }


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. CHECK constraint atualizado:
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.trust_events'::regclass
--   AND conname = 'trust_events_domain_check';
-- Esperado: incluir 'external'.

-- V2. Teste de inserção (substituir IDs reais):
-- INSERT INTO trust_events (user_id, domain, event_type, impact, is_negative, metadata)
-- VALUES ('test-user-id', 'external', 'external_place_verified', 3, false, '{}');
-- Esperado: sucesso (deletar depois: DELETE FROM trust_events WHERE user_id = 'test-user-id').
