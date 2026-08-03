-- =====================================================
-- MIGRAÇÃO: Carona Solidária — Trust Domain 'mobility'
-- [CARONA-004] Adiciona domínio 'mobility' ao Trust Passport
--
-- Contexto:
--   O Trust Passport usa domínios para categorizar eventos de confiança.
--   Carona solidária precisa de um domínio próprio porque é estruturalmente
--   diferente de delivery (mobilidade compartilhada vs entrega de pacotes).
--
-- Peso do domínio: 8 (mesmo peso que 'civic')
--   Atual: account(9) + social(14) + financial(18) + stays(11) +
--          delivery(9) + marketplace(12) + moderation(9) + civic(8) = 90
--   Novo:  + mobility(8) = 98
--
-- Alterações no backend (Sprint C2):
--   trustPassportService.js:
--     DOMAINS → adicionar 'mobility'
--     DOMAIN_WEIGHTS → adicionar mobility: 8
--     VALIDATOR_DEFS → adicionar motorista_solidario
--     HIGH_IMPACT_EVENTS → adicionar ride_cancelled_driver
--
-- Depende de:
--   20260617000006_trust_passport_schema.sql (trust_events)
--   20260619000001_agora_digital_schema.sql (adicionou 'civic')
--
-- Agente: claudia-agent | Revisado por: Léo (PO)
-- Data: 2026-06-20
-- =====================================================


-- =====================================================
-- 1. ALTER trust_events CHECK: adicionar domínio 'mobility'
-- =====================================================

ALTER TABLE public.trust_events
    DROP CONSTRAINT IF EXISTS trust_events_domain_check;

ALTER TABLE public.trust_events
    ADD CONSTRAINT trust_events_domain_check
    CHECK (domain IN (
        'account', 'social', 'financial', 'stays',
        'delivery', 'marketplace', 'moderation', 'civic',
        'mobility'
    ));


-- =====================================================
-- 2. Documentação: eventos de trust para carona
-- =====================================================
-- Eventos registrados pelo caronaService.js (Sprint C2):
--
-- | Evento                     | Domínio   | Impact | isNeg | Contexto                          |
-- |----------------------------|-----------|--------|-------|-----------------------------------|
-- | ride_completed_driver      | mobility  | +3     | false | Motorista completou viagem        |
-- | ride_completed_passenger   | mobility  | +2     | false | Passageiro completou viagem       |
-- | ride_cancelled_driver      | mobility  | -3     | true  | Motorista cancelou < 2h partida   |
-- | ride_rated_5star           | mobility  | +3     | false | Recebeu avaliação 5 estrelas      |
-- | ride_report_upheld         | mobility  | -5     | true  | Denúncia procedente (admin)       |
--
-- Validador novo em trustPassportService.js:
-- {
--   key: 'motorista_solidario',
--   label: 'Motorista Solidário',
--   domain: 'mobility',
--   check: (ctx) => ctx.domainAvg.mobility >= 4.0 && ctx.domainCount.mobility >= 3
-- }


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. CHECK constraint atualizado:
-- SELECT pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.trust_events'::regclass
--   AND conname = 'trust_events_domain_check';
-- Esperado: incluir 'mobility'.

-- V2. Teste de inserção (substituir IDs reais):
-- INSERT INTO trust_events (user_id, domain, event_type, impact, is_negative, metadata)
-- VALUES ('test-user-id', 'mobility', 'ride_completed_driver', 3, false, '{}');
-- Esperado: sucesso (e deletar depois: DELETE FROM trust_events WHERE user_id = 'test-user-id').
