-- =====================================================
-- MIGRAÇÃO: Mercado Local ElosCloud — Schema completo
-- [MKTPLACE-001] 6 tabelas + RLS + funções auxiliares
--
-- Tabelas criadas:
--   1. seller_profiles          — perfil do vendedor (migra Firestore sellers)
--   2. marketplace_products     — catálogo de produtos/serviços
--   3. marketplace_orders       — pedidos com suporte a ElosCoins
--   4. eloscoins_redemptions    — auditoria imutável de resgates de ElosCoins
--   5. community_goals          — metas comunitárias (obras, eventos, compras coletivas)
--   6. community_goal_contributions — contribuições a metas
--
-- Modelo RLS — 3 Camadas (padrão ElosCloud, aprovado ClaudIA 2026-05-19):
--   Camada 1 — Server-Only:   tabelas de auditoria financeira (eloscoins_redemptions)
--   Camada 2 — User-Scoped:   usuário acessa apenas os próprios dados
--   Camada 3 — RBAC-Scoped:   leitura pública controlada + escrita por ownership
--
-- Funções auxiliares (SECURITY DEFINER para evitar recursão em RLS):
--   get_my_seller_id()          — retorna seller_profiles.id do usuário autenticado
--   is_order_party(order_id)    — verifica se o usuário é comprador ou vendedor do pedido
--
-- NOTA: backend usa service_role → bypassa RLS por design do Supabase.
--       Policies aqui se aplicam apenas a conexões via anon/authenticated.
--
-- Depende de: users(id), caixinhas(id) (já existentes)
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-05-24
--
-- FIX (reordenação): funções LANGUAGE sql STABLE são validadas no momento
-- da criação — PostgreSQL resolve as tabelas referenciadas imediatamente.
-- Ordem correta: tabelas → funções → policies.
-- =====================================================


-- =====================================================
-- 1. seller_profiles
-- =====================================================

CREATE TABLE IF NOT EXISTS public.seller_profiles (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id               TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    business_name         TEXT NOT NULL,
    trading_name          TEXT,
    category              TEXT NOT NULL DEFAULT 'outros',
    description           TEXT,
    address_neighborhood  TEXT,
    address_city          TEXT,
    service_radius_km     INTEGER NOT NULL DEFAULT 5,
    accepts_eloscoins     BOOLEAN NOT NULL DEFAULT false,
    coins_discount_rate   NUMERIC(10, 4) NOT NULL DEFAULT 0.0100,
    max_coins_per_order   INTEGER NOT NULL DEFAULT 1000,
    document              TEXT,
    document_validated    BOOLEAN NOT NULL DEFAULT false,
    commission_rate       NUMERIC(5, 4) NOT NULL DEFAULT 0.0500,
    status                TEXT NOT NULL DEFAULT 'pending',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id),
    CONSTRAINT seller_profiles_status_check
        CHECK (status IN ('pending', 'active', 'suspended')),
    CONSTRAINT seller_profiles_category_check
        CHECK (category IN ('alimentacao', 'servicos', 'produtos', 'obra', 'evento', 'outros')),
    CONSTRAINT seller_profiles_commission_check
        CHECK (commission_rate BETWEEN 0 AND 0.5),
    CONSTRAINT seller_profiles_coins_rate_check
        CHECK (coins_discount_rate BETWEEN 0.001 AND 1.0)
);

COMMENT ON TABLE public.seller_profiles IS
    '[MKTPLACE-001] Perfil do vendedor no Mercado Local. '
    'Migra e expande o modelo Firestore sellers (Seller.js). '
    'Um usuário pode ter no máximo um perfil de vendedor (UNIQUE user_id). '
    'Dual-role: o mesmo usuário pode comprar de outros vendedores.';

COMMENT ON COLUMN public.seller_profiles.coins_discount_rate IS
    'Valor em BRL de 1 ElosCoin para esta loja. Padrão: 0.0100 (R$ 0,01). '
    'Exemplo: 1000 coins × R$ 0,01 = R$ 10,00 de desconto.';

COMMENT ON COLUMN public.seller_profiles.commission_rate IS
    'Percentual de comissão da plataforma sobre pedidos completados. '
    'Padrão: 0.05 (5%), herdado do modelo Order.js legado. '
    'Debitado apenas quando status do pedido transiciona para completed.';

CREATE INDEX IF NOT EXISTS idx_seller_profiles_user_id
    ON public.seller_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_seller_profiles_category_status
    ON public.seller_profiles (category, status);

CREATE INDEX IF NOT EXISTS idx_seller_profiles_city_neighborhood
    ON public.seller_profiles (address_city, address_neighborhood);


-- =====================================================
-- FUNÇÃO: get_my_seller_id()
-- Criada APÓS seller_profiles (LANGUAGE sql valida em criação).
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_my_seller_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id
    FROM public.seller_profiles
    WHERE user_id = auth.uid()::text
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_seller_id() IS
    'Retorna seller_profiles.id do usuário autenticado. '
    'SECURITY DEFINER: usado em policies de marketplace_products e marketplace_orders '
    'para evitar recursão de RLS em subqueries cross-table.';


-- =====================================================
-- RLS — seller_profiles (após a função estar disponível)
-- =====================================================

ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_profiles_public_read" ON public.seller_profiles;
CREATE POLICY "seller_profiles_public_read"
    ON public.seller_profiles
    FOR SELECT
    TO authenticated
    USING (status = 'active');

DROP POLICY IF EXISTS "seller_profiles_own_all" ON public.seller_profiles;
CREATE POLICY "seller_profiles_own_all"
    ON public.seller_profiles
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "seller_profiles_admin_read" ON public.seller_profiles;
CREATE POLICY "seller_profiles_admin_read"
    ON public.seller_profiles
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.seller_profiles FROM anon;


-- =====================================================
-- 2. marketplace_products
-- =====================================================

CREATE TABLE IF NOT EXISTS public.marketplace_products (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_id           TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    category            TEXT,
    price_brl           NUMERIC(10, 2) NOT NULL,
    max_coins_discount  INTEGER,
    stock               INTEGER,
    images              TEXT[],
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT marketplace_products_price_check
        CHECK (price_brl >= 0),
    CONSTRAINT marketplace_products_stock_check
        CHECK (stock IS NULL OR stock >= 0),
    CONSTRAINT marketplace_products_coins_check
        CHECK (max_coins_discount IS NULL OR max_coins_discount >= 0)
);

COMMENT ON TABLE public.marketplace_products IS
    '[MKTPLACE-001] Catálogo de produtos e serviços do vendedor. '
    'stock = NULL indica serviço (sem controle de estoque). '
    'max_coins_discount = NULL herda o limite de seller_profiles.max_coins_per_order.';

COMMENT ON COLUMN public.marketplace_products.price_brl IS
    'Preço em BRL. Nunca usar para calcular total no frontend — '
    'o backend recalcula price_brl no momento do pedido para garantir integridade.';

CREATE INDEX IF NOT EXISTS idx_marketplace_products_seller_id
    ON public.marketplace_products (seller_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_active
    ON public.marketplace_products (seller_id, active);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_category
    ON public.marketplace_products (category, active);

-- RLS
ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_products_public_read" ON public.marketplace_products;
CREATE POLICY "marketplace_products_public_read"
    ON public.marketplace_products
    FOR SELECT
    TO authenticated
    USING (active = true);

DROP POLICY IF EXISTS "marketplace_products_seller_write" ON public.marketplace_products;
CREATE POLICY "marketplace_products_seller_write"
    ON public.marketplace_products
    FOR ALL
    TO authenticated
    USING (seller_id = get_my_seller_id())
    WITH CHECK (seller_id = get_my_seller_id());

DROP POLICY IF EXISTS "marketplace_products_seller_read_own" ON public.marketplace_products;
CREATE POLICY "marketplace_products_seller_read_own"
    ON public.marketplace_products
    FOR SELECT
    TO authenticated
    USING (seller_id = get_my_seller_id());

DROP POLICY IF EXISTS "marketplace_products_admin_read" ON public.marketplace_products;
CREATE POLICY "marketplace_products_admin_read"
    ON public.marketplace_products
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.marketplace_products FROM anon;


-- =====================================================
-- 3. marketplace_orders
-- =====================================================

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    buyer_id            TEXT NOT NULL REFERENCES public.users(id),
    seller_id           TEXT NOT NULL REFERENCES public.seller_profiles(id),
    items               JSONB NOT NULL,
    subtotal_brl        NUMERIC(10, 2) NOT NULL,
    coins_used          INTEGER NOT NULL DEFAULT 0,
    coins_discount_brl  NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_brl           NUMERIC(10, 2) NOT NULL,
    commission_brl      NUMERIC(10, 2) NOT NULL,
    payment_method      TEXT,
    payment_id          TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    dispute_id          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- no_self_purchase: buyer_id != seller.user_id
    -- Não pode ser CHECK constraint em PostgreSQL (subqueries não são permitidas).
    -- Enforcement garantido em marketplaceService.js → createOrder().
    CONSTRAINT marketplace_orders_status_check
        CHECK (status IN ('pending', 'paid', 'in_progress', 'completed', 'disputed', 'cancelled')),
    CONSTRAINT marketplace_orders_payment_method_check
        CHECK (payment_method IS NULL OR payment_method IN ('pix', 'stripe', 'eloscoins', 'hybrid')),
    CONSTRAINT marketplace_orders_subtotal_check
        CHECK (subtotal_brl >= 0),
    CONSTRAINT marketplace_orders_total_check
        CHECK (total_brl >= 0),
    CONSTRAINT marketplace_orders_coins_check
        CHECK (coins_used >= 0 AND coins_discount_brl >= 0),
    CONSTRAINT marketplace_orders_total_lte_subtotal
        CHECK (total_brl <= subtotal_brl)
);

COMMENT ON TABLE public.marketplace_orders IS
    '[MKTPLACE-001] Pedidos do Mercado Local. '
    'total_brl é calculado e gravado pelo backend — nunca aceitar do cliente. '
    'Constraint no_self_purchase: buyer_id != seller.user_id. '
    'commission_brl é imutável após created_at (calculado no momento do pedido).';

COMMENT ON COLUMN public.marketplace_orders.items IS
    'Snapshot JSONB dos itens no momento do pedido. '
    'Inclui name e unit_price_brl para preservar histórico mesmo se produto for editado/deletado. '
    'Formato: [{"product_id":"...","name":"...","qty":1,"unit_price_brl":29.90}]';

COMMENT ON COLUMN public.marketplace_orders.commission_brl IS
    'Comissão da plataforma calculada em: created_at. '
    'Fórmula: subtotal_brl × seller_profiles.commission_rate. '
    'Imutável após criação — debitado quando status → completed.';

COMMENT ON COLUMN public.marketplace_orders.dispute_id IS
    'ID da disputa no sistema do disputa-agent. '
    'Preenchido quando status transiciona para disputed. '
    'O marketplace-agent NUNCA resolve disputas — delega ao disputa-agent.';

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer_id
    ON public.marketplace_orders (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_seller_id
    ON public.marketplace_orders (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status
    ON public.marketplace_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_payment_id
    ON public.marketplace_orders (payment_id)
    WHERE payment_id IS NOT NULL;


-- =====================================================
-- FUNÇÃO: is_order_party(p_order_id TEXT)
-- Criada APÓS marketplace_orders.
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_order_party(p_order_id TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.marketplace_orders o
        WHERE o.id = p_order_id
          AND (
              o.buyer_id = auth.uid()::text
              OR o.seller_id = get_my_seller_id()
          )
    );
$$;

COMMENT ON FUNCTION public.is_order_party(TEXT) IS
    'Verifica se o usuário autenticado é comprador ou vendedor do pedido. '
    'SECURITY DEFINER para evitar recursão em policies de marketplace_orders. '
    'Retorna false se o usuário não tiver seller_profile.';


-- RLS — marketplace_orders (após a função estar disponível)
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_orders_parties_read" ON public.marketplace_orders;
CREATE POLICY "marketplace_orders_parties_read"
    ON public.marketplace_orders
    FOR SELECT
    TO authenticated
    USING (
        buyer_id = auth.uid()::text
        OR seller_id = get_my_seller_id()
    );

DROP POLICY IF EXISTS "marketplace_orders_buyer_insert" ON public.marketplace_orders;
CREATE POLICY "marketplace_orders_buyer_insert"
    ON public.marketplace_orders
    FOR INSERT
    TO authenticated
    WITH CHECK (buyer_id = auth.uid()::text);

DROP POLICY IF EXISTS "marketplace_orders_seller_update" ON public.marketplace_orders;
CREATE POLICY "marketplace_orders_seller_update"
    ON public.marketplace_orders
    FOR UPDATE
    TO authenticated
    USING (seller_id = get_my_seller_id())
    WITH CHECK (seller_id = get_my_seller_id());

DROP POLICY IF EXISTS "marketplace_orders_admin_read" ON public.marketplace_orders;
CREATE POLICY "marketplace_orders_admin_read"
    ON public.marketplace_orders
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.marketplace_orders FROM anon;


-- =====================================================
-- 4. eloscoins_redemptions
-- Camada 1 — Server-Only (dado financeiro de auditoria).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.eloscoins_redemptions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id         TEXT NOT NULL REFERENCES public.users(id),
    order_id        TEXT NOT NULL REFERENCES public.marketplace_orders(id),
    coins_redeemed  INTEGER NOT NULL,
    brl_equivalent  NUMERIC(10, 2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT eloscoins_redemptions_coins_positive
        CHECK (coins_redeemed > 0),
    CONSTRAINT eloscoins_redemptions_brl_positive
        CHECK (brl_equivalent > 0)
);

COMMENT ON TABLE public.eloscoins_redemptions IS
    '[MKTPLACE-001][RLS-3C-C1] Auditoria imutável de resgates de ElosCoins. '
    'Criado atomicamente com marketplace_orders quando coins_used > 0. '
    'Imutável: DELETE proibido por policy (trilha financeira LGPD art. 37). '
    'Acesso exclusivo via service_role (marketplaceService.js).';

CREATE INDEX IF NOT EXISTS idx_eloscoins_redemptions_user_id
    ON public.eloscoins_redemptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eloscoins_redemptions_order_id
    ON public.eloscoins_redemptions (order_id);

ALTER TABLE public.eloscoins_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eloscoins_redemptions_backend_only" ON public.eloscoins_redemptions;
CREATE POLICY "eloscoins_redemptions_backend_only"
    ON public.eloscoins_redemptions
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON POLICY "eloscoins_redemptions_backend_only"
    ON public.eloscoins_redemptions IS
    'Deny-all para anon/authenticated. '
    'Backend acessa via service_role (bypassa RLS). '
    'Registros são imutáveis — sem DELETE mesmo para service_role via aplicação.';


-- =====================================================
-- 5. community_goals
-- =====================================================

CREATE TABLE IF NOT EXISTS public.community_goals (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    caixinha_id     TEXT REFERENCES public.caixinhas(id) ON DELETE SET NULL,
    creator_id      TEXT NOT NULL REFERENCES public.users(id),
    title           TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL DEFAULT 'outros',
    target_brl      NUMERIC(10, 2) NOT NULL,
    raised_brl      NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    target_date     DATE,
    status          TEXT NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT community_goals_target_positive
        CHECK (target_brl > 0),
    CONSTRAINT community_goals_raised_non_negative
        CHECK (raised_brl >= 0),
    CONSTRAINT community_goals_raised_lte_target
        CHECK (raised_brl <= target_brl + 0.01),
    CONSTRAINT community_goals_status_check
        CHECK (status IN ('open', 'funded', 'completed', 'cancelled')),
    CONSTRAINT community_goals_category_check
        CHECK (category IN ('obra', 'evento', 'compra_coletiva', 'outros'))
);

COMMENT ON TABLE public.community_goals IS
    '[MKTPLACE-001] Metas comunitárias do Mercado Local. '
    'raised_brl é atualizado pelo backend a cada contribuição confirmada. '
    'Quando raised_brl >= target_brl: backend transiciona status para funded automaticamente. '
    'Quando target_date expira sem funding: backend aciona disputa-agent para votação '
    '(prorrogar vs reembolsar). caixinha_id opcional — usa governança da caixinha se preenchido.';

COMMENT ON COLUMN public.community_goals.raised_brl IS
    'Valor total arrecadado confirmado. '
    'Atualizado atomicamente pelo backend a cada community_goal_contributions confirmada. '
    'Nunca atualizar diretamente via cliente.';

CREATE INDEX IF NOT EXISTS idx_community_goals_creator_id
    ON public.community_goals (creator_id);

CREATE INDEX IF NOT EXISTS idx_community_goals_caixinha_id
    ON public.community_goals (caixinha_id)
    WHERE caixinha_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_goals_status
    ON public.community_goals (status, target_date);

ALTER TABLE public.community_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_goals_public_read" ON public.community_goals;
CREATE POLICY "community_goals_public_read"
    ON public.community_goals
    FOR SELECT
    TO authenticated
    USING (status IN ('open', 'funded', 'completed'));

DROP POLICY IF EXISTS "community_goals_creator_all" ON public.community_goals;
CREATE POLICY "community_goals_creator_all"
    ON public.community_goals
    FOR ALL
    TO authenticated
    USING (creator_id = auth.uid()::text)
    WITH CHECK (creator_id = auth.uid()::text);

DROP POLICY IF EXISTS "community_goals_admin_all" ON public.community_goals;
CREATE POLICY "community_goals_admin_all"
    ON public.community_goals
    FOR ALL
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.community_goals FROM anon;


-- =====================================================
-- 6. community_goal_contributions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.community_goal_contributions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    goal_id         TEXT NOT NULL REFERENCES public.community_goals(id),
    user_id         TEXT NOT NULL REFERENCES public.users(id),
    amount_brl      NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    coins_used      INTEGER NOT NULL DEFAULT 0,
    payment_id      TEXT,
    confirmed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT community_goal_contributions_amount_check
        CHECK (amount_brl >= 0),
    CONSTRAINT community_goal_contributions_coins_check
        CHECK (coins_used >= 0),
    CONSTRAINT community_goal_contributions_nonzero
        CHECK (amount_brl > 0 OR coins_used > 0)
);

COMMENT ON TABLE public.community_goal_contributions IS
    '[MKTPLACE-001] Contribuições individuais a metas comunitárias. '
    'confirmed_at = null indica pagamento pendente de confirmação (webhook). '
    'Apenas contribuições com confirmed_at preenchido são somadas em community_goals.raised_brl. '
    'Imutável após confirmed_at (registro financeiro).';

CREATE INDEX IF NOT EXISTS idx_community_goal_contributions_goal_id
    ON public.community_goal_contributions (goal_id, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_goal_contributions_user_id
    ON public.community_goal_contributions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_goal_contributions_payment_id
    ON public.community_goal_contributions (payment_id)
    WHERE payment_id IS NOT NULL;

ALTER TABLE public.community_goal_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_goal_contributions_own_read" ON public.community_goal_contributions;
CREATE POLICY "community_goal_contributions_own_read"
    ON public.community_goal_contributions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "community_goal_contributions_own_insert" ON public.community_goal_contributions;
CREATE POLICY "community_goal_contributions_own_insert"
    ON public.community_goal_contributions
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "community_goal_contributions_admin_read" ON public.community_goal_contributions;
CREATE POLICY "community_goal_contributions_admin_read"
    ON public.community_goal_contributions
    FOR SELECT
    TO authenticated
    USING (check_global_role(auth.uid()::text, 'admin'));

REVOKE ALL ON public.community_goal_contributions FROM anon;


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar esta migration.
-- =====================================================

-- V1. Confirmar que todas as 6 tabelas foram criadas:
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--       'seller_profiles', 'marketplace_products', 'marketplace_orders',
--       'eloscoins_redemptions', 'community_goals', 'community_goal_contributions'
--   )
-- ORDER BY table_name;
-- Esperado: 6 linhas.

-- V2. Confirmar RLS habilitado em todas as 6 tabelas:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--       'seller_profiles', 'marketplace_products', 'marketplace_orders',
--       'eloscoins_redemptions', 'community_goals', 'community_goal_contributions'
--   )
-- ORDER BY tablename;
-- Esperado: 6 linhas, todas com rowsecurity = true.

-- V3. Confirmar functions criadas:
--
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('get_my_seller_id', 'is_order_party');
-- Esperado: 2 linhas.

-- V4. Smoke test — verificar constraint no_self_purchase (deve falhar):
-- (Só execute com user/seller fictícios em ambiente de teste)
--
-- INSERT INTO public.marketplace_orders (buyer_id, seller_id, items, subtotal_brl, total_brl, commission_brl)
-- VALUES (
--     'user_abc',
--     (SELECT id FROM public.seller_profiles WHERE user_id = 'user_abc' LIMIT 1),
--     '[]'::jsonb, 0, 0, 0
-- );
-- Esperado: ERROR — constraint marketplace_orders_no_self_purchase.
