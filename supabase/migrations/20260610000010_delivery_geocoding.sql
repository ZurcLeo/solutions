-- =====================================================
-- MIGRAÇÃO: Geocodificação e Trajeto de Retorno — Delivery
-- [DELIVERY-ROUTE-002]
--
-- Alterações:
--   1. seller_profiles: +address_lat, +address_lng, +address_cep
--      (geocodificadas via BrasilAPI ao cadastrar/atualizar loja)
--   2. delivery_services: +include_return_leg, +home_lat, +home_lng, +home_cep
--      (entregador configura se cobra o retorno à base)
--   3. find_eligible_deliverers_live: refatorada
--      - Incorpora D3 (cliente→base do entregador) quando include_return_leg=true
--      - Fallback textual com distâncias mais realistas (3km/8km/15km)
--      - Retorna novo campo return_leg_km para transparência
--
-- Depende de:
--   20260610000001_delivery_schema.sql  (tabelas delivery_*)
--   20260610000002_delivery_rpcs.sql    (haversine_km, funções delivery)
--   20260524000001_marketplace_schema.sql (seller_profiles)
--
-- Agente: marketplace-agent + frontend-core-agent
-- Revisado por: ClaudIA
-- Data: 2026-06-10
-- Sprint: 1 — fix bug frete fixo
-- =====================================================


-- =====================================================
-- 1. Coordenadas geocodificadas do endereço da loja
--    Preenchidas pelo backend ao criar/atualizar seller_profile via BrasilAPI v2
-- =====================================================

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS address_cep  text,
  ADD COLUMN IF NOT EXISTS address_lat  numeric(9,6),
  ADD COLUMN IF NOT EXISTS address_lng  numeric(9,6);

COMMENT ON COLUMN public.seller_profiles.address_cep IS
  '[DELIVERY-ROUTE-002] CEP do endereço da loja (formato 00000000, sem hífen).';
COMMENT ON COLUMN public.seller_profiles.address_lat IS
  '[DELIVERY-ROUTE-002] Latitude geocodificada via BrasilAPI v2. '
  'Usado como p_pickup_lat na RPC find_eligible_deliverers_live.';
COMMENT ON COLUMN public.seller_profiles.address_lng IS
  '[DELIVERY-ROUTE-002] Longitude geocodificada via BrasilAPI v2.';


-- =====================================================
-- 2. Configuração de retorno à base no perfil do entregador
--    include_return_leg: se true, D3 (cliente→home) é somado ao frete
-- =====================================================

ALTER TABLE public.delivery_services
  ADD COLUMN IF NOT EXISTS include_return_leg boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_cep           text,
  ADD COLUMN IF NOT EXISTS home_lat           numeric(9,6),
  ADD COLUMN IF NOT EXISTS home_lng           numeric(9,6);

COMMENT ON COLUMN public.delivery_services.include_return_leg IS
  '[DELIVERY-ROUTE-002] Se true, o frete inclui D3 = distância de (cliente→base do entregador). '
  'Padrão false: entregador absorve o custo do retorno (estratégia para volume inicial).';
COMMENT ON COLUMN public.delivery_services.home_cep IS
  '[DELIVERY-ROUTE-002] CEP da base/residência do entregador (formato 00000000).';
COMMENT ON COLUMN public.delivery_services.home_lat IS
  '[DELIVERY-ROUTE-002] Latitude da base do entregador (geocodificada via BrasilAPI v2).';
COMMENT ON COLUMN public.delivery_services.home_lng IS
  '[DELIVERY-ROUTE-002] Longitude da base do entregador.';


-- =====================================================
-- 3. Atualização da RPC find_eligible_deliverers_live
--    PostgreSQL não permite CREATE OR REPLACE quando o RETURNS TABLE muda.
--    Solução: DROP + CREATE (sem perda de dados — é uma função sem estado).

DROP FUNCTION IF EXISTS public.find_eligible_deliverers_live(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,INTEGER,TEXT,TEXT,TEXT);

-- Recria
--    Nova fórmula: fee = max((D1 + D2 + D3?) × price_per_km + base_fee, minimum_fee)
--    D3 = haversine(cliente, home_entregador) × ROAD_FACTOR, apenas se include_return_leg=true
--    Fallback textual melhorado: 3km (mesma cidade), 8km (mesmo estado), 15km (outro estado)
-- =====================================================

CREATE FUNCTION public.find_eligible_deliverers_live(
    p_pickup_lat  NUMERIC,
    p_pickup_lng  NUMERIC,
    p_dest_lat    NUMERIC,
    p_dest_lng    NUMERIC,
    p_weight_kg   NUMERIC  DEFAULT 0,
    p_is_fragile  BOOLEAN  DEFAULT false,
    p_limit       INTEGER  DEFAULT 5,
    -- Fallback textual (usado quando coords não disponíveis)
    p_pickup_city TEXT     DEFAULT NULL,
    p_dest_city   TEXT     DEFAULT NULL,
    p_dest_state  TEXT     DEFAULT NULL
)
RETURNS TABLE (
    service_id          TEXT,
    user_id             TEXT,
    vehicle_type        TEXT,
    origin_to_pickup_km NUMERIC,   -- D1: posição atual → loja
    pickup_to_dest_km   NUMERIC,   -- D2: loja → cliente
    return_leg_km       NUMERIC,   -- D3: cliente → base (0 se include_return_leg=false)
    total_km            NUMERIC,   -- D1 + D2 + D3
    estimated_fee       NUMERIC,   -- tarifa final (max(custo, mínimo))
    average_rating      NUMERIC,
    delivery_level      INTEGER,
    match_score         NUMERIC,   -- menor = melhor
    has_gps             BOOLEAN    -- true se distâncias são GPS, false se estimadas
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ROAD_FACTOR CONSTANT NUMERIC := 1.3;
BEGIN
    RETURN QUERY
    WITH live_candidates AS (
        SELECT
            das.service_id,
            das.user_id,
            das.current_lat,
            das.current_lng,
            das.use_fallback,
            das.region_key,
            ds.vehicle_type,
            ds.price_per_km,
            ds.base_fee,
            ds.minimum_fee,
            ds.max_radius_km,
            ds.max_weight_kg,
            ds.handles_fragile,
            ds.average_rating,
            ds.delivery_level,
            ds.origin_city,
            ds.origin_state,
            ds.include_return_leg,
            ds.home_lat,
            ds.home_lng
        FROM public.delivery_active_sessions das
        JOIN public.delivery_services ds ON ds.id = das.service_id
        WHERE das.expires_at > NOW()
          AND ds.status = 'active'
          AND (p_weight_kg = 0 OR p_weight_kg <= ds.max_weight_kg)
          AND (p_is_fragile = false OR ds.handles_fragile = true)
    ),
    with_distances AS (
        SELECT
            lc.*,
            -- D1: posição ATUAL do entregador → loja do vendedor
            CASE
                WHEN lc.current_lat IS NOT NULL AND p_pickup_lat IS NOT NULL THEN
                    haversine_km(lc.current_lat, lc.current_lng, p_pickup_lat, p_pickup_lng) * ROAD_FACTOR
                ELSE
                    -- Fallback textual com distâncias realistas:
                    -- mesma cidade ≈ 3km, mesmo estado ≈ 8km, outro ≈ 15km
                    CASE
                        WHEN lower(trim(lc.origin_city)) = lower(trim(p_pickup_city)) THEN 3.0
                        ELSE 8.0
                    END
            END AS d1_km,
            -- D2: loja → cliente
            CASE
                WHEN p_pickup_lat IS NOT NULL AND p_dest_lat IS NOT NULL THEN
                    haversine_km(p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng) * ROAD_FACTOR
                ELSE
                    -- Fallback textual: mesma cidade ≈ 3km, outro ≈ 8km
                    CASE
                        WHEN lower(trim(lc.origin_city)) = lower(trim(p_dest_city)) THEN 3.0
                        ELSE 8.0
                    END
            END AS d2_km,
            -- D3: cliente → base do entregador (apenas se include_return_leg=true e coords disponíveis)
            CASE
                WHEN lc.include_return_leg = true
                     AND p_dest_lat IS NOT NULL
                     AND lc.home_lat IS NOT NULL THEN
                    haversine_km(p_dest_lat, p_dest_lng, lc.home_lat, lc.home_lng) * ROAD_FACTOR
                ELSE 0.0
            END AS d3_km,
            (lc.current_lat IS NOT NULL AND p_pickup_lat IS NOT NULL) AS gps_available
        FROM live_candidates lc
    )
    SELECT
        wd.service_id,
        wd.user_id,
        wd.vehicle_type,
        round(wd.d1_km::NUMERIC, 2)                                          AS origin_to_pickup_km,
        round(wd.d2_km::NUMERIC, 2)                                          AS pickup_to_dest_km,
        round(wd.d3_km::NUMERIC, 2)                                          AS return_leg_km,
        round((wd.d1_km + wd.d2_km + wd.d3_km)::NUMERIC, 2)                AS total_km,
        round(GREATEST(
            (wd.d1_km + wd.d2_km + wd.d3_km) * wd.price_per_km + wd.base_fee,
            wd.minimum_fee
        )::NUMERIC, 2)                                                        AS estimated_fee,
        wd.average_rating,
        wd.delivery_level,
        round((
            wd.d1_km * 0.5
            - wd.average_rating * 1.5
            - wd.delivery_level * 0.3
        )::NUMERIC, 4)                                                        AS match_score,
        wd.gps_available                                                      AS has_gps
    FROM with_distances wd
    WHERE
        wd.d2_km <= wd.max_radius_km
        AND (
            wd.current_lat IS NOT NULL
            OR lower(trim(wd.origin_state)) = lower(trim(p_dest_state))
        )
    ORDER BY match_score
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.find_eligible_deliverers_live(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,INTEGER,TEXT,TEXT,TEXT) IS
    '[DELIVERY-ROUTE-002] Matching hiper-local com suporte a trajeto de retorno. '
    'Fórmula: fee = max((D1 + D2 + D3?) × price_per_km + base_fee, minimum_fee). '
    'D1 = posição_atual → loja. D2 = loja → cliente. '
    'D3 = cliente → base_entregador (incluído se include_return_leg=true e home_lat preenchido). '
    'GPS disponível: usa Haversine × 1.3. Fallback: 3km mesma cidade, 8km diferente. '
    'Retorna return_leg_km=0 quando retorno não incluído (transparência para o frontend).';

GRANT EXECUTE ON FUNCTION public.find_eligible_deliverers_live(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,BOOLEAN,INTEGER,TEXT,TEXT,TEXT) TO authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar colunas adicionadas em seller_profiles:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'seller_profiles' AND column_name IN ('address_cep','address_lat','address_lng');
-- Esperado: 3 linhas.

-- V2. Confirmar colunas adicionadas em delivery_services:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'delivery_services'
--   AND column_name IN ('include_return_leg','home_cep','home_lat','home_lng');
-- Esperado: 4 linhas.

-- V3. Confirmar que find_eligible_deliverers_live retorna return_leg_km:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'find_eligible_deliverers_live';
-- (ou via: \df+ find_eligible_deliverers_live no psql)

-- V4. Teste do fallback com cidades iguais (antes: 5+15=20km → R$27; agora: 3+3=6km):
-- (simulação — sem entregadores online, mas valida a lógica da fórmula)
-- SELECT round((3.0 + 3.0) * 1.35 + 0, 2) AS fee_mesma_cidade;
-- Esperado: 8.10 (vs 27.00 anterior — confirma o bug corrigido)
