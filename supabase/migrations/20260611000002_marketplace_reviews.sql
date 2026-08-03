-- =====================================================
-- MIGRAÇÃO: Sistema de Avaliações do Marketplace
-- [MKTPLACE-REVIEW-001] 2026-06-11
--
-- Compradores avaliam lojas após pedido concluído (status = 'completed').
-- Diferente de delivery_ratings (tripartite, por entrega),
-- aqui o modelo é buyer → seller_profile, vinculado a um pedido.
--
-- Mudanças:
--   1. ADD avg_rating, total_reviews em seller_profiles
--   2. CREATE TABLE marketplace_reviews (imutável — sem UPDATE/DELETE)
--   3. RLS: leitura pública; escrita via RPC SECURITY DEFINER
--   4. FUNCTION _update_seller_avg_rating(p_seller_id)
--   5. FUNCTION submit_marketplace_review(order_id, rating, comment, anonymous)
--   6. FUNCTION reply_to_marketplace_review(review_id, reply)
--   7. Tarefas de gamificação para avaliações
--
-- Todos os IDs são TEXT (padrão do schema marketplace — gen_random_uuid()::text)
--
-- Depende de:
--   20260524000001_marketplace_schema.sql (seller_profiles, marketplace_orders)
--   20260513000000_identity_schema.sql    (users)
--
-- Agente: uxui-agent | Revisado por: ClaudIA
-- Data: 2026-06-11
-- =====================================================


-- =====================================================
-- 1. Colunas de rating em seller_profiles
-- =====================================================

ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS avg_rating    NUMERIC(3,2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS total_reviews INTEGER      DEFAULT 0   NOT NULL;

COMMENT ON COLUMN public.seller_profiles.avg_rating IS
    '[MKTPLACE-REVIEW-001] Média das avaliações recebidas (1–5). '
    'NULL = sem avaliações ainda. Atualizado por _update_seller_avg_rating após cada submit.';

COMMENT ON COLUMN public.seller_profiles.total_reviews IS
    '[MKTPLACE-REVIEW-001] Total de avaliações recebidas. '
    'Atualizado atomicamente junto com avg_rating.';


-- =====================================================
-- 2. Tabela marketplace_reviews
-- =====================================================

CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
    id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Contexto
    seller_id         TEXT        NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    order_id          TEXT        NOT NULL UNIQUE REFERENCES public.marketplace_orders(id),
    buyer_id          TEXT        NOT NULL REFERENCES public.users(id),

    -- Avaliação
    rating            SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment           TEXT        CHECK (comment IS NULL OR char_length(comment) <= 500),
    is_anonymous      BOOLEAN     NOT NULL DEFAULT false,

    -- Resposta do vendedor
    seller_reply      TEXT        CHECK (seller_reply IS NULL OR char_length(seller_reply) <= 500),
    seller_replied_at TIMESTAMPTZ,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.marketplace_reviews IS
    '[MKTPLACE-REVIEW-001] Avaliações de compradores sobre lojas do marketplace. '
    'Um pedido = uma avaliação (UNIQUE order_id). '
    'Imutável: sem UPDATE/DELETE direto (audit trail — LGPD art. 37). '
    'Respostas do vendedor via reply_to_marketplace_review (SECURITY DEFINER).';

COMMENT ON COLUMN public.marketplace_reviews.is_anonymous IS
    'LGPD: quando true, nome/avatar do comprador são omitidos na exibição pública. '
    'buyer_id ainda é gravado para auditoria interna.';

COMMENT ON COLUMN public.marketplace_reviews.order_id IS
    'UNIQUE: garante exatamente uma avaliação por pedido.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_seller
    ON public.marketplace_reviews (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_buyer
    ON public.marketplace_reviews (buyer_id, created_at DESC);


-- =====================================================
-- RLS — marketplace_reviews
-- =====================================================

ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;

-- Leitura pública (StoreFront — visitantes não-autenticados também podem ver)
DROP POLICY IF EXISTS "marketplace_reviews_public_read" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_public_read"
    ON public.marketplace_reviews
    FOR SELECT
    USING (true);

-- INSERT delegado à RPC submit_marketplace_review (SECURITY DEFINER)
-- A RPC valida ownership do pedido e status 'completed' antes de inserir.
DROP POLICY IF EXISTS "marketplace_reviews_rpc_insert" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_rpc_insert"
    ON public.marketplace_reviews
    FOR INSERT
    TO authenticated
    WITH CHECK (buyer_id = auth.uid()::text);

-- UPDATE: apenas para seller_reply (via reply_to_marketplace_review — SECURITY DEFINER)
DROP POLICY IF EXISTS "marketplace_reviews_seller_reply" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_seller_reply"
    ON public.marketplace_reviews
    FOR UPDATE
    TO authenticated
    USING (
        seller_id = get_my_seller_id()
        AND seller_reply IS NULL   -- só uma resposta por avaliação
    )
    WITH CHECK (seller_id = get_my_seller_id());

-- DELETE: proibido (audit trail)
DROP POLICY IF EXISTS "marketplace_reviews_no_delete" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_no_delete"
    ON public.marketplace_reviews
    FOR DELETE
    TO authenticated
    USING (false);

-- Admin: leitura completa
DROP POLICY IF EXISTS "marketplace_reviews_admin_read" ON public.marketplace_reviews;
CREATE POLICY "marketplace_reviews_admin_read"
    ON public.marketplace_reviews
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));


-- =====================================================
-- 3. FUNCTION _update_seller_avg_rating (PRIVADA)
--    Recalcula avg_rating + total_reviews em seller_profiles
-- =====================================================

CREATE OR REPLACE FUNCTION public._update_seller_avg_rating(p_seller_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_avg   NUMERIC(3,2);
    v_total INTEGER;
BEGIN
    SELECT
        ROUND(AVG(rating)::NUMERIC, 2),
        COUNT(*)::INTEGER
    INTO v_avg, v_total
    FROM public.marketplace_reviews
    WHERE seller_id = p_seller_id;

    UPDATE public.seller_profiles
    SET
        avg_rating    = v_avg,
        total_reviews = COALESCE(v_total, 0),
        updated_at    = NOW()
    WHERE id = p_seller_id;
END;
$$;

COMMENT ON FUNCTION public._update_seller_avg_rating(TEXT) IS
    '[MKTPLACE-REVIEW-001] Recalcula seller_profiles.avg_rating e total_reviews. '
    'Chamada internamente por submit_marketplace_review após cada avaliação. '
    'SECURITY DEFINER: necessário para atualizar seller_profiles sem RLS do chamador. '
    'Prefixo _ indica função privada — não exposta ao role authenticated.';


-- =====================================================
-- 4. FUNCTION submit_marketplace_review (SECURITY DEFINER)
--    Ponto único de entrada para submissão de avaliação
-- =====================================================

CREATE OR REPLACE FUNCTION public.submit_marketplace_review(
    p_order_id     TEXT,
    p_rating       SMALLINT,
    p_comment      TEXT    DEFAULT NULL,
    p_is_anonymous BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer_id TEXT := auth.uid()::text;
    v_order    RECORD;
    v_review   RECORD;
BEGIN
    -- Autenticação
    IF v_buyer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthenticated',
            'message', 'Login necessário para avaliar.');
    END IF;

    -- Valida rating
    IF p_rating NOT BETWEEN 1 AND 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_rating',
            'message', 'Avaliação deve ser entre 1 e 5 estrelas.');
    END IF;

    -- Valida tamanho do comentário
    IF p_comment IS NOT NULL AND char_length(p_comment) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'comment_too_long',
            'message', 'Comentário deve ter no máximo 500 caracteres.');
    END IF;

    -- Busca o pedido
    SELECT id, seller_id, buyer_id, status, updated_at
    INTO v_order
    FROM public.marketplace_orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'order_not_found',
            'message', 'Pedido não encontrado.');
    END IF;

    -- Verifica ownership (apenas o comprador do pedido pode avaliar)
    IF v_order.buyer_id <> v_buyer_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'forbidden',
            'message', 'Você não é o comprador deste pedido.');
    END IF;

    -- Pedido concluído?
    IF v_order.status <> 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'order_not_completed',
            'message', 'Só é possível avaliar pedidos concluídos.');
    END IF;

    -- Janela de avaliação: 90 dias após conclusão
    IF v_order.updated_at < NOW() - INTERVAL '90 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'review_window_expired',
            'message', 'O prazo de avaliação expirou (90 dias após conclusão).');
    END IF;

    -- Insere avaliação; UNIQUE em order_id captura duplicatas
    BEGIN
        INSERT INTO public.marketplace_reviews (
            seller_id, order_id, buyer_id, rating, comment, is_anonymous
        ) VALUES (
            v_order.seller_id,
            p_order_id,
            v_buyer_id,
            p_rating,
            p_comment,
            COALESCE(p_is_anonymous, false)
        )
        RETURNING * INTO v_review;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'already_reviewed',
                'message', 'Você já avaliou este pedido.');
    END;

    -- Atualiza média do vendedor (na mesma transação)
    PERFORM public._update_seller_avg_rating(v_order.seller_id);

    RETURN jsonb_build_object('success', true, 'review_id', v_review.id);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'internal_error',
        'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.submit_marketplace_review(TEXT, SMALLINT, TEXT, BOOLEAN) IS
    '[MKTPLACE-REVIEW-001] Submissão de avaliação de loja — ponto único de entrada. '
    'Validações: autenticado, rating 1–5, comment ≤ 500, pedido existe, comprador é o auth, '
    'pedido concluído, janela 90 dias, sem duplicata (UNIQUE order_id). '
    'Atualiza avg_rating e total_reviews em seller_profiles atomicamente. '
    'Retorna { success, review_id } ou { success: false, error, message }.';

GRANT EXECUTE ON FUNCTION public.submit_marketplace_review(TEXT, SMALLINT, TEXT, BOOLEAN)
    TO authenticated;


-- =====================================================
-- 5. FUNCTION reply_to_marketplace_review (SECURITY DEFINER)
--    Vendedor responde a uma avaliação (uma vez por avaliação)
-- =====================================================

CREATE OR REPLACE FUNCTION public.reply_to_marketplace_review(
    p_review_id TEXT,
    p_reply     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id TEXT := auth.uid()::text;
    v_review  RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
    END IF;

    IF p_reply IS NULL OR char_length(trim(p_reply)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'empty_reply',
            'message', 'A resposta não pode ser vazia.');
    END IF;

    IF char_length(p_reply) > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'reply_too_long',
            'message', 'A resposta deve ter no máximo 500 caracteres.');
    END IF;

    -- Busca a avaliação e verifica que é o vendedor
    SELECT r.*, sp.user_id AS seller_user_id
    INTO v_review
    FROM public.marketplace_reviews r
    JOIN public.seller_profiles sp ON sp.id = r.seller_id
    WHERE r.id = p_review_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'review_not_found',
            'message', 'Avaliação não encontrada.');
    END IF;

    IF v_review.seller_user_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'forbidden',
            'message', 'Apenas o vendedor desta loja pode responder.');
    END IF;

    IF v_review.seller_reply IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'already_replied',
            'message', 'Você já respondeu esta avaliação.');
    END IF;

    UPDATE public.marketplace_reviews
    SET
        seller_reply      = p_reply,
        seller_replied_at = NOW()
    WHERE id = p_review_id;

    RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'internal_error',
        'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.reply_to_marketplace_review(TEXT, TEXT) IS
    '[MKTPLACE-REVIEW-001] Resposta do vendedor a uma avaliação recebida. '
    'Apenas o dono da loja pode responder; apenas uma resposta por avaliação. '
    'SECURITY DEFINER: necessário para UPDATE via RLS seller_reply policy.';

GRANT EXECUTE ON FUNCTION public.reply_to_marketplace_review(TEXT, TEXT)
    TO authenticated;


-- =====================================================
-- 6. Gamificação: tarefas de avaliação
-- =====================================================

INSERT INTO public.gamification_tasks (slug, name, description, category, xp_reward, is_repeatable, max_completions, is_active)
VALUES
    ('review_given',            'Avaliou uma compra',              'Avaliou uma compra no Mercado Local',         'mercado', 30,  true,  NULL, true),
    ('review_10',               'Avaliador frequente',             'Avaliou 10 compras no Mercado Local',         'mercado', 200, false, 1,    true),
    ('review_received_5_stars', 'Loja bem avaliada',               'Sua loja recebeu uma avaliação 5 estrelas',   'mercado', 100, true,  NULL, true)
ON CONFLICT (slug) DO NOTHING;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- V1. Tabela e colunas:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'marketplace_reviews';
-- Esperado: id, seller_id, order_id, buyer_id, rating, comment, is_anonymous,
--           seller_reply, seller_replied_at, created_at

-- V2. Colunas em seller_profiles:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'seller_profiles'
--   AND column_name IN ('avg_rating', 'total_reviews');
-- Esperado: 2 linhas

-- V3. Funções criadas:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('submit_marketplace_review','reply_to_marketplace_review','_update_seller_avg_rating');
-- Esperado: 3 linhas

-- V4. Teste funcional (substituir IDs reais):
-- SELECT public.submit_marketplace_review('order-id-aqui', 5, 'Ótima loja!', false);
-- Esperado: { "success": true, "review_id": "..." }
-- ou { "success": false, "error": "order_not_completed" } se pedido não concluído
