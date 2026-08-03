-- =====================================================
-- MIGRAÇÃO: Limpeza de Categorias de Loja + Business Hours
-- [STORE-TYPE-001] 2026-06-11
--
-- Mudanças:
--   1. Atualiza CHECK de seller_profiles.category:
--      - Remove 'obra' e 'evento' (agora são subcategorias de 'servicos'/'produtos')
--      - Adiciona 'imoveis' (já existe em marketplace_categories)
--      - Final: alimentacao | servicos | produtos | imoveis | outros
--
--   2. Adiciona coluna business_hours JSONB em seller_profiles
--      Formato: {"mon": [{"open":"HH:MM","close":"HH:MM"}], ..., "sun": null}
--      null = dia fechado; array vazio = sem horários configurados
--
--   3. Promove 'obra' e 'evento' de top-level para subcategorias em
--      marketplace_categories (parent_id aponta para 'servicos' e 'produtos')
--
-- Decisões aprovadas (Léo + ClaudIA, 2026-06-11):
--   DA-STORE-001: 'obra' e 'evento' NÃO são categorias de loja — são subcategorias
--   DA-STORE-002: Horário de funcionamento como JSONB em seller_profiles (MVP)
--   DA-STORE-003: Cleanup seguro — nenhum vendedor real em produção
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- =====================================================


-- =====================================================
-- 1. ATUALIZAÇÃO DO CHECK CONSTRAINT seller_profiles.category
-- =====================================================
-- Remove constraint antiga (inclui 'obra' e 'evento', sem 'imoveis')
-- Adiciona nova constraint sem 'obra'/'evento', com 'imoveis'
-- =====================================================

ALTER TABLE public.seller_profiles
    DROP CONSTRAINT IF EXISTS seller_profiles_category_check;

ALTER TABLE public.seller_profiles
    ADD CONSTRAINT seller_profiles_category_check
        CHECK (category IN ('alimentacao', 'servicos', 'produtos', 'imoveis', 'outros'));

COMMENT ON COLUMN public.seller_profiles.category IS
    '[STORE-TYPE-001] Tipo principal da loja.
     alimentacao = restaurante/padaria/lanchonete → aba Cardápio + Pedidos
     servicos    = prestadores em geral           → aba Serviços + Agendamento
     produtos    = loja de produtos físicos       → aba Catálogo + Pedidos
     imoveis     = imobiliária/corretor (CRECI)   → aba Imóveis + Agendamento
     outros      = categoria genérica             → aba Catálogo + Pedidos
     Obs: obra e evento são subcategorias de servicos/produtos (marketplace_categories).';


-- =====================================================
-- 2. COLUNA business_hours EM seller_profiles
-- =====================================================
-- Formato JSONB:
--   chaves: "mon","tue","wed","thu","fri","sat","sun"
--   valor null  = dia fechado
--   valor array = lista de intervalos {open: "HH:MM", close: "HH:MM"}
--
-- Exemplo:
--   {
--     "mon": [{"open":"08:00","close":"12:00"},{"open":"14:00","close":"18:00"}],
--     "tue": [{"open":"08:00","close":"18:00"}],
--     "sat": [{"open":"09:00","close":"13:00"}],
--     "sun": null
--   }
-- =====================================================

ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT NULL;

COMMENT ON COLUMN public.seller_profiles.business_hours IS
    '[STORE-TYPE-001] Horário de funcionamento da loja (store-level, diferente de service_availability).
     Formato: {"mon":..., "tue":..., "wed":..., "thu":..., "fri":..., "sat":..., "sun":...}.
     Cada valor: null (fechado) ou array de {open:"HH:MM", close:"HH:MM"}.
     Múltiplos intervalos por dia são suportados (ex: manhã + tarde).
     null total = horário não configurado (exibir "Consulte a loja" no frontend).';


-- =====================================================
-- 3. FUNÇÃO DE VALIDAÇÃO DE business_hours (opcional, fire-and-forget)
-- =====================================================
-- Verifica que o JSONB tem estrutura válida:
--   - Chaves permitidas: mon, tue, wed, thu, fri, sat, sun
--   - Cada valor: null ou array de objetos com "open" e "close"
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_business_hours(hours JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    allowed_keys TEXT[] := ARRAY['mon','tue','wed','thu','fri','sat','sun'];
    day_key TEXT;
    day_val JSONB;
    slot JSONB;
BEGIN
    IF hours IS NULL THEN RETURN TRUE; END IF;

    -- Verificar que só existem chaves permitidas
    FOR day_key IN SELECT jsonb_object_keys(hours) LOOP
        IF NOT (day_key = ANY(allowed_keys)) THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    -- Verificar estrutura de cada dia
    FOREACH day_key IN ARRAY allowed_keys LOOP
        day_val := hours -> day_key;

        -- null é válido (fechado), pular
        IF day_val IS NULL OR day_val = 'null'::jsonb THEN CONTINUE; END IF;

        -- Deve ser array
        IF jsonb_typeof(day_val) != 'array' THEN RETURN FALSE; END IF;

        -- Cada elemento deve ter "open" e "close"
        FOR slot IN SELECT jsonb_array_elements(day_val) LOOP
            IF NOT (slot ? 'open' AND slot ? 'close') THEN
                RETURN FALSE;
            END IF;
        END LOOP;
    END LOOP;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.validate_business_hours(JSONB) IS
    '[STORE-TYPE-001] Valida estrutura do JSONB de business_hours.
     Aceita null (não configurado) ou objeto com chaves mon..sun,
     cada uma sendo null (fechado) ou array de {open, close}.
     Usada pelo backend antes de salvar.';

GRANT EXECUTE ON FUNCTION public.validate_business_hours(JSONB) TO authenticated;


-- =====================================================
-- 4. PROMOÇÃO DE 'obra' E 'evento' PARA SUBCATEGORIAS
-- =====================================================
-- Estes slugs existiam como top-level mas devem ser subcategorias:
--   'obra'   → subcategoria de 'servicos' (c0000000-0000-0000-0000-000000000002)
--   'evento' → subcategoria de 'servicos' (DJ, buffet, garçom) E
--              subcategoria de 'produtos' (c0000000-0000-0000-0000-000000000003) (ingressos)
--
-- Estratégia: atualizar parent_id para mover de top-level para subcategoria.
-- Se não existir na tabela, não fazer nada (migration idempotente).
-- =====================================================

-- Mover 'obra' para subcategoria de 'servicos'
UPDATE public.marketplace_categories
SET
    parent_id  = 'c0000000-0000-0000-0000-000000000002',  -- servicos
    sort_order = 99  -- por último na lista de subcategorias
WHERE slug = 'obra'
  AND parent_id IS NULL;  -- só move se ainda for top-level

-- Mover 'evento' para subcategoria de 'servicos'
-- (serviços de evento: DJ, buffet, garçom, cerimonialistas)
UPDATE public.marketplace_categories
SET
    parent_id  = 'c0000000-0000-0000-0000-000000000002',  -- servicos
    sort_order = 98
WHERE slug = 'evento'
  AND parent_id IS NULL;  -- só move se ainda for top-level

-- Garantir que 'imoveis' existe como top-level (já deve existir pela migration 20260610000014)
-- Se não existir, inserir
INSERT INTO public.marketplace_categories (id, slug, name, icon, fulfillment_defaults, sort_order)
VALUES (
    'c0000000-0000-0000-0000-000000000007',
    'imoveis',
    'Imóveis',
    'Building',
    '{in_person_service}',
    60
)
ON CONFLICT (id) DO NOTHING;

-- Garantir que 'evento' como subcategoria de 'produtos' também existe
-- (ingressos, folhetos, kits de evento físico)
INSERT INTO public.marketplace_categories (id, parent_id, slug, name, fulfillment_defaults)
VALUES (
    gen_random_uuid(),
    'c0000000-0000-0000-0000-000000000003',  -- produtos
    'evento_produto',
    'Evento (Ingressos/Materiais)',
    '{pickup, shipping}'
)
ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- 5. ATUALIZAR ÍNDICE DE seller_profiles.category
-- =====================================================
-- Recriar o índice parcial para excluir os valores removidos.
-- (Os valores 'obra'/'evento' podem ainda existir como lixo histórico
--  se houver dados, mas o CHECK já os bloqueia em novos INSERTs.)
-- =====================================================

DROP INDEX IF EXISTS public.idx_seller_profiles_category_status;
CREATE INDEX IF NOT EXISTS idx_seller_profiles_category_status
    ON public.seller_profiles (category, status)
    WHERE status IN ('active', 'pending');

COMMENT ON INDEX public.idx_seller_profiles_category_status IS
    '[STORE-TYPE-001] Índice parcial para busca de vendedores por categoria e status.';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO [STORE-TYPE-001]
-- Execute no Supabase SQL Editor após aplicar esta migration.
-- =====================================================

-- V1. Confirmar novos valores válidos no CHECK:
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.seller_profiles'::regclass
--   AND conname  = 'seller_profiles_category_check';
-- Esperado: CHECK (category IN ('alimentacao', 'servicos', 'produtos', 'imoveis', 'outros'))

-- V2. Confirmar coluna business_hours criada:
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'seller_profiles'
--   AND column_name  = 'business_hours';
-- Esperado: 1 linha com data_type = 'jsonb', column_default = null

-- V3. Confirmar função de validação criada:
--
-- SELECT validate_business_hours('{"mon":[{"open":"08:00","close":"18:00"}],"sun":null}'::jsonb);
-- Esperado: true

-- V4. Confirmar que 'obra' e 'evento' agora têm parent_id (subcategorias):
--
-- SELECT slug, parent_id
-- FROM public.marketplace_categories
-- WHERE slug IN ('obra', 'evento')
-- ORDER BY slug;
-- Esperado: 2 linhas com parent_id preenchido (c0000000-0000-0000-0000-000000000002)

-- V5. Smoke test — inserção com categoria 'imoveis' deve funcionar:
-- (Requer user_id válido em ambiente de teste)
--
-- INSERT INTO public.seller_profiles (user_id, business_name, category)
-- VALUES ('test-user-id', 'Imobiliária Teste', 'imoveis');
-- Esperado: sucesso

-- V6. Smoke test — inserção com categoria 'obra' deve FALHAR:
--
-- INSERT INTO public.seller_profiles (user_id, business_name, category)
-- VALUES ('test-user-id-2', 'Construtora Teste', 'obra');
-- Esperado: ERROR — violates check constraint "seller_profiles_category_check"

-- V7. Smoke test — business_hours válido:
--
-- UPDATE public.seller_profiles
-- SET business_hours = '{"mon":[{"open":"08:00","close":"18:00"}],"tue":null}'::jsonb
-- WHERE id = 'algum-id-de-teste';
-- Esperado: 1 linha atualizada
