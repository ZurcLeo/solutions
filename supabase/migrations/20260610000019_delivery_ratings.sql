-- =====================================================
-- MIGRAÇÃO: Sistema de Avaliação Tripartite — Delivery ElosCloud
-- [DELIVERY-RATING-001] tabela delivery_ratings + RPCs de avaliação
--
-- Modelo tripartite: qualquer parte avalia qualquer outra após entrega
--   deliverer → avalia seller e buyer
--   seller    → avalia deliverer e buyer
--   buyer     → avalia deliverer e seller (com opção de anonimato — LGPD)
--
-- Campos legados em delivery_requests (mantidos como legado):
--   seller_rating / buyer_rating / seller_rating_note / buyer_rating_note
--   Esses campos permanecem para compatibilidade retroativa.
--   A nova tabela delivery_ratings substitui o modelo flat por um relacional completo.
--
-- Funções criadas:
--   submit_delivery_rating(...)               — valida e insere avaliação (SECURITY DEFINER)
--   _update_deliverer_avg_rating(request_id)  — recalcula média do entregador
--   get_delivery_ratings_for_request(...)     — lista avaliações visíveis às partes
--
-- RLS em delivery_ratings (trilha de auditoria — imutável):
--   SELECT : is_delivery_request_party(delivery_request_id) — partes veem todas as avaliações
--   INSERT : é parte + rater_id = auth.uid()
--   UPDATE : proibido
--   DELETE : proibido
--
-- Depende de:
--   20260610000001_delivery_schema.sql  (delivery_requests, delivery_services, is_delivery_request_party)
--   20260524000001_marketplace_schema.sql (marketplace_orders, seller_profiles)
--   20260513000000_identity_schema.sql  (users)
--
-- Agente: marketplace-agent | Revisado por: ClaudIA
-- Data: 2026-06-10
-- =====================================================


-- =====================================================
-- 1. Tabela delivery_ratings
-- =====================================================

CREATE TABLE IF NOT EXISTS public.delivery_ratings (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    delivery_request_id  TEXT NOT NULL
                             REFERENCES public.delivery_requests(id) ON DELETE CASCADE,

    -- Quem avaliou
    rater_id             TEXT NOT NULL REFERENCES public.users(id),
    rater_role           TEXT NOT NULL
                             CHECK (rater_role IN ('deliverer', 'seller', 'buyer')),

    -- Quem foi avaliado
    rated_id             TEXT NOT NULL REFERENCES public.users(id),
    rated_role           TEXT NOT NULL
                             CHECK (rated_role IN ('deliverer', 'seller', 'buyer')),

    -- Avaliação
    score                SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment              TEXT CHECK (comment IS NULL OR length(comment) <= 500),
    tags                 TEXT[],       -- ex: ['pontual','cuidadoso','comunicativo']
    is_anonymous         BOOLEAN NOT NULL DEFAULT false,  -- comprador pode avaliar anônimo (LGPD)

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Regras de integridade
    UNIQUE (delivery_request_id, rater_id, rated_id),   -- um par avalia apenas uma vez por pedido
    CHECK (rater_role != rated_role),                    -- papéis distintos obrigatório
    CHECK (rater_id   != rated_id)                       -- sem auto-avaliação
);

COMMENT ON TABLE public.delivery_ratings IS
    '[DELIVERY-RATING-001] Avaliações tripartite pós-entrega. '
    'Cada parte (deliverer, seller, buyer) pode avaliar as outras duas. '
    'Imutável por design: sem UPDATE/DELETE (trilha de auditoria — LGPD art. 37). '
    'Janela de avaliação: 7 dias após delivered_at (verificado na RPC submit_delivery_rating). '
    'Campos legados seller_rating/buyer_rating em delivery_requests mantidos para compatibilidade.';

COMMENT ON COLUMN public.delivery_ratings.is_anonymous IS
    'Quando true, nome e avatar do avaliador são omitidos na RPC get_delivery_ratings_for_request. '
    'Aplica-se principalmente ao comprador (LGPD: direito de não ser identificado em avaliação). '
    'O rater_id ainda é gravado para fins de auditoria — apenas a exibição é ocultada.';

COMMENT ON COLUMN public.delivery_ratings.tags IS
    'Tags qualitativas opcionais. Exemplos por papel: '
    'deliverer: pontual, cuidadoso, comunicativo, rápido, educado. '
    'seller: produto_correto, bem_embalado, respondeu_rapido, pedido_pronto_no_prazo. '
    'buyer: pagamento_correto, facil_de_encontrar, educado, disponivel_na_entrega.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_delivery_ratings_request_id
    ON public.delivery_ratings (delivery_request_id);

CREATE INDEX IF NOT EXISTS idx_delivery_ratings_rater_id
    ON public.delivery_ratings (rater_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_ratings_rated_id
    ON public.delivery_ratings (rated_id, rated_role, score);

CREATE INDEX IF NOT EXISTS idx_delivery_ratings_rated_deliverer
    ON public.delivery_ratings (rated_id, created_at DESC)
    WHERE rated_role = 'deliverer';


-- =====================================================
-- RLS — delivery_ratings (Camada 2: partes do pedido)
-- =====================================================

ALTER TABLE public.delivery_ratings ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer parte do pedido vê todas as avaliações
DROP POLICY IF EXISTS "delivery_ratings_parties_read" ON public.delivery_ratings;
CREATE POLICY "delivery_ratings_parties_read"
    ON public.delivery_ratings
    FOR SELECT
    TO authenticated
    USING (is_delivery_request_party(delivery_request_id));

-- INSERT: somente parte do pedido, e rater_id deve ser o próprio usuário
DROP POLICY IF EXISTS "delivery_ratings_party_insert" ON public.delivery_ratings;
CREATE POLICY "delivery_ratings_party_insert"
    ON public.delivery_ratings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        rater_id = auth.uid()::text
        AND is_delivery_request_party(delivery_request_id)
    );

-- UPDATE/DELETE: proibido para todos (imutável)
DROP POLICY IF EXISTS "delivery_ratings_no_update" ON public.delivery_ratings;
CREATE POLICY "delivery_ratings_no_update"
    ON public.delivery_ratings
    FOR UPDATE
    TO authenticated
    USING (false);

DROP POLICY IF EXISTS "delivery_ratings_no_delete" ON public.delivery_ratings;
CREATE POLICY "delivery_ratings_no_delete"
    ON public.delivery_ratings
    FOR DELETE
    TO authenticated
    USING (false);

-- Admin pode ler
DROP POLICY IF EXISTS "delivery_ratings_admin_read" ON public.delivery_ratings;
CREATE POLICY "delivery_ratings_admin_read"
    ON public.delivery_ratings
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.delivery_ratings FROM anon;


-- =====================================================
-- 2. RPC _update_deliverer_avg_rating (PRIVADA)
--    Recalcula average_rating do entregador na delivery_services
-- =====================================================

CREATE OR REPLACE FUNCTION public._update_deliverer_avg_rating(p_request_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_service_id TEXT;
    v_avg        NUMERIC(3, 2);
BEGIN
    -- Obtém service_id do pedido
    SELECT service_id INTO v_service_id
    FROM public.delivery_requests
    WHERE id = p_request_id;

    IF v_service_id IS NULL THEN RETURN; END IF;

    -- Calcula média de todas as avaliações recebidas pelo entregador neste service
    SELECT ROUND(AVG(dr.score)::NUMERIC, 2)
    INTO   v_avg
    FROM   public.delivery_ratings dr
    JOIN   public.delivery_requests req ON req.id = dr.delivery_request_id
    WHERE  req.service_id = v_service_id
      AND  dr.rated_role  = 'deliverer';

    -- Atualiza perfil do entregador
    UPDATE public.delivery_services
    SET    average_rating = COALESCE(v_avg, 0.00),
           updated_at     = NOW()
    WHERE  id = v_service_id;
END;
$$;

COMMENT ON FUNCTION public._update_deliverer_avg_rating(TEXT) IS
    '[DELIVERY-RATING-001] Recalcula delivery_services.average_rating após nova avaliação. '
    'Chamada internamente por submit_delivery_rating quando rated_role = ''deliverer''. '
    'SECURITY DEFINER: necessário para atualizar delivery_services sem RLS do chamador. '
    'Prefixo _ indica função privada — não exposta ao role authenticated.';


-- =====================================================
-- 3. RPC submit_delivery_rating (SECURITY DEFINER)
--    Ponto de entrada único para submissão de avaliação
-- =====================================================

CREATE OR REPLACE FUNCTION public.submit_delivery_rating(
    p_request_id TEXT,
    p_rated_id   TEXT,
    p_rated_role TEXT,
    p_score      SMALLINT,
    p_comment    TEXT    DEFAULT NULL,
    p_tags       TEXT[]  DEFAULT NULL,
    p_anonymous  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rater_id    TEXT := auth.uid()::text;
    v_rater_role  TEXT;
    v_req         RECORD;
    v_order       RECORD;
    v_new_id      TEXT;
BEGIN
    -- 0. Validações de input
    IF p_rated_role NOT IN ('deliverer', 'seller', 'buyer') THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_role',
            'message', 'rated_role deve ser deliverer, seller ou buyer.');
    END IF;
    IF p_score NOT BETWEEN 1 AND 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_score',
            'message', 'score deve estar entre 1 e 5.');
    END IF;
    IF p_comment IS NOT NULL AND length(p_comment) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'comment_too_long',
            'message', 'comment deve ter no máximo 500 caracteres.');
    END IF;

    -- 1. Carrega o pedido
    SELECT dr.*, mo.buyer_id
    INTO   v_req
    FROM   public.delivery_requests dr
    JOIN   public.marketplace_orders mo ON mo.id = dr.order_id
    WHERE  dr.id = p_request_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_found',
            'message', 'Pedido de entrega não encontrado.');
    END IF;

    -- 2. Verifica status (só avalia após entregue)
    IF v_req.status NOT IN ('delivered', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_delivered',
            'message', 'Só é possível avaliar pedidos entregues ou concluídos.');
    END IF;

    -- 3. Verifica janela de 7 dias
    IF v_req.delivered_at IS NOT NULL
       AND v_req.delivered_at < NOW() - INTERVAL '7 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'window_expired',
            'message', 'O prazo de avaliação (7 dias) expirou para este pedido.');
    END IF;

    -- 4. Determina rater_role
    IF get_my_delivery_service_id() = v_req.service_id THEN
        v_rater_role := 'deliverer';
    ELSIF get_my_seller_id() = v_req.seller_id THEN
        v_rater_role := 'seller';
    ELSIF v_rater_id = v_req.buyer_id THEN
        v_rater_role := 'buyer';
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'not_a_party',
            'message', 'Você não é parte deste pedido de entrega.');
    END IF;

    -- 5. Valida que não está avaliando a si mesmo e que os papéis são distintos
    IF v_rater_id = p_rated_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'self_rating',
            'message', 'Não é permitido avaliar a si mesmo.');
    END IF;
    IF v_rater_role = p_rated_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'same_role',
            'message', 'Avaliador e avaliado devem ter papéis distintos.');
    END IF;

    -- 6. Verifica duplo voto
    IF EXISTS (
        SELECT 1 FROM public.delivery_ratings
        WHERE delivery_request_id = p_request_id
          AND rater_id            = v_rater_id
          AND rated_id            = p_rated_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_rated',
            'message', 'Você já avaliou esta pessoa para este pedido.');
    END IF;

    -- 7. Insere avaliação
    INSERT INTO public.delivery_ratings (
        delivery_request_id,
        rater_id, rater_role,
        rated_id, rated_role,
        score, comment, tags, is_anonymous
    )
    VALUES (
        p_request_id,
        v_rater_id, v_rater_role,
        p_rated_id, p_rated_role,
        p_score, p_comment, p_tags, p_anonymous
    )
    RETURNING id INTO v_new_id;

    -- 8. Recalcula média do entregador se foi avaliado
    IF p_rated_role = 'deliverer' THEN
        PERFORM public._update_deliverer_avg_rating(p_request_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'rating_id', v_new_id);

EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_rated',
        'message', 'Você já avaliou esta pessoa para este pedido.');
END;
$$;

COMMENT ON FUNCTION public.submit_delivery_rating(TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT[], BOOLEAN) IS
    '[DELIVERY-RATING-001] Submissão de avaliação tripartite — ponto único de entrada. '
    'Validações: status delivered/completed, janela 7 dias, é parte do pedido, '
    'sem auto-avaliação, sem duplo voto, papéis distintos. '
    'Retorna { success, rating_id } ou { success: false, error, message }. '
    'SECURITY DEFINER: usa get_my_delivery_service_id() e get_my_seller_id() sem recursão RLS.';

GRANT EXECUTE ON FUNCTION public.submit_delivery_rating(TEXT, TEXT, TEXT, SMALLINT, TEXT, TEXT[], BOOLEAN)
    TO authenticated;


-- =====================================================
-- 4. RPC get_delivery_ratings_for_request
--    Lista avaliações de um pedido (partes do pedido apenas)
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_delivery_ratings_for_request(p_request_id TEXT)
RETURNS TABLE (
    id                   TEXT,
    delivery_request_id  TEXT,
    rater_id             TEXT,
    rater_name           TEXT,    -- null se is_anonymous = true
    rater_avatar         TEXT,    -- null se is_anonymous = true
    rater_role           TEXT,
    rated_id             TEXT,
    rated_role           TEXT,
    score                SMALLINT,
    comment              TEXT,    -- null se is_anonymous = true
    tags                 TEXT[],
    is_anonymous         BOOLEAN,
    created_at           TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verifica que o usuário é parte do pedido
    IF NOT is_delivery_request_party(p_request_id) THEN
        RAISE EXCEPTION 'not_a_party: Você não é parte deste pedido.';
    END IF;

    RETURN QUERY
    SELECT
        dr.id,
        dr.delivery_request_id,
        dr.rater_id,
        CASE WHEN dr.is_anonymous THEN NULL ELSE u.display_name END   AS rater_name,
        CASE WHEN dr.is_anonymous THEN NULL ELSE u.photo_url    END   AS rater_avatar,
        dr.rater_role,
        dr.rated_id,
        dr.rated_role,
        dr.score,
        CASE WHEN dr.is_anonymous THEN NULL ELSE dr.comment     END   AS comment,
        dr.tags,
        dr.is_anonymous,
        dr.created_at
    FROM  public.delivery_ratings dr
    LEFT JOIN public.users u ON u.id = dr.rater_id
    WHERE dr.delivery_request_id = p_request_id
    ORDER BY dr.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_delivery_ratings_for_request(TEXT) IS
    '[DELIVERY-RATING-001] Lista avaliações de um pedido. '
    'Acesso restrito às partes do pedido (is_delivery_request_party). '
    'Avaliadores anônimos têm rater_name, rater_avatar e comment omitidos. '
    'rater_id ainda é retornado (auditoria interna) — não exibir no frontend para anônimos.';

GRANT EXECUTE ON FUNCTION public.get_delivery_ratings_for_request(TEXT) TO authenticated;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar.
-- =====================================================

-- V1. Tabela criada:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'delivery_ratings';
-- Esperado: 1 linha.

-- V2. RLS habilitado:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'delivery_ratings';
-- Esperado: rowsecurity = true.

-- V3. Funções criadas:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'submit_delivery_rating',
--     '_update_deliverer_avg_rating',
--     'get_delivery_ratings_for_request'
--   );
-- Esperado: 3 linhas.

-- V4. Teste funcional (substituir UUIDs reais):
-- SELECT public.submit_delivery_rating(
--   'req-id-aqui', 'user-id-avaliado', 'deliverer', 3, 'Boa entrega', null, false
-- );
-- Esperado: { "success": true, "rating_id": "..." }
-- ou { "success": false, "error": "not_a_party" } se não for parte do pedido.
