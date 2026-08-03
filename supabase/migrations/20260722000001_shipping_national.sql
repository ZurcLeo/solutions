-- =============================================================================
-- SHIP-001: Shipping Nacional — Melhor Envio
-- Frete nacional como fallback para produtos físicos não perecíveis.
--
-- Tabelas novas:
--   seller_shipping_config      — configuração de envio do seller (CEP origem, dados remetente)
--   shipping_orders             — pedidos de frete no Melhor Envio (cotação → entrega)
--   shipping_tracking_events    — eventos de rastreio (timeline)
--
-- Zero-downtime: CREATE TABLE + CREATE INDEX (sem ALTER em tabelas existentes)
-- Data: 2026-07-22
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. seller_shipping_config — Configuração de envio nacional do seller
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.seller_shipping_config (
    id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    seller_id                TEXT NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,

    -- Toggle principal
    accepts_national_shipping BOOLEAN NOT NULL DEFAULT false,

    -- Endereço de origem (remetente para cotação e etiqueta)
    origin_postal_code       TEXT,              -- CEP do remetente (ex: '01310100')
    origin_address           TEXT,              -- Logradouro
    origin_number            TEXT,              -- Número
    origin_district          TEXT,              -- Bairro
    origin_city              TEXT,              -- Cidade
    origin_state_abbr        TEXT               -- UF (ex: 'SP')
                             CHECK (origin_state_abbr IS NULL OR length(origin_state_abbr) = 2),

    -- Dados do remetente (obrigatórios para gerar etiqueta ME)
    sender_name              TEXT,              -- Nome completo ou razão social
    sender_phone             TEXT,              -- Telefone com DDD
    sender_email             TEXT,              -- E-mail do remetente
    sender_document          TEXT,              -- CPF ou CNPJ (sem formatação)

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Um seller tem no máximo uma configuração de shipping
    CONSTRAINT uq_shipping_config_seller UNIQUE (seller_id)
);

COMMENT ON TABLE public.seller_shipping_config IS
    '[SHIP-001] Configuração de envio nacional via Melhor Envio. '
    'CEP de origem + dados do remetente para cotação e geração de etiqueta.';

-- Trigger updated_at (reutiliza trg_fn_set_updated_at existente)
CREATE OR REPLACE TRIGGER trg_shipping_config_updated_at
    BEFORE UPDATE ON public.seller_shipping_config
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS: seller vê/edita apenas sua própria configuração
ALTER TABLE public.seller_shipping_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY sel_own_shipping_config ON public.seller_shipping_config
    FOR ALL
    USING (
        seller_id IN (
            SELECT id FROM public.seller_profiles
            WHERE user_id = auth.uid()::text
        )
    )
    WITH CHECK (
        seller_id IN (
            SELECT id FROM public.seller_profiles
            WHERE user_id = auth.uid()::text
        )
    );


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. shipping_orders — Pedidos de frete no Melhor Envio
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shipping_orders (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    order_id          TEXT NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,

    -- Dados do Melhor Envio
    me_order_id       TEXT,                    -- UUID do pedido no ME (preenchido após POST /cart)
    me_service_id     INT,                     -- ID do serviço: 1=PAC, 2=SEDEX, 3=.Package, 4=.Com, 17=Mini
    carrier_name      TEXT,                    -- 'Correios', 'JadLog'
    service_name      TEXT,                    -- 'PAC', 'SEDEX', '.Package', '.Com', 'Mini Envios'

    -- Rastreio
    tracking_code     TEXT,                    -- Código de rastreio (preenchido após postagem)
    label_url         TEXT,                    -- URL da etiqueta para impressão

    -- Status lifecycle
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                          'pending',           -- cotação solicitada
                          'quoted',            -- cotação retornada
                          'cart',              -- adicionado ao carrinho ME
                          'paid',              -- etiqueta comprada no ME
                          'generated',         -- etiqueta gerada, pronta para impressão
                          'posted',            -- objeto postado nos Correios/transportadora
                          'in_transit',        -- em trânsito
                          'delivered',         -- entregue
                          'cancelled'          -- cancelado
                      )),

    -- Valores
    quoted_price      NUMERIC(10, 2),          -- preço cotado pelo ME
    shipping_fee      NUMERIC(10, 2),          -- preço final cobrado
    estimated_days    INT,                     -- prazo estimado em dias úteis

    -- Debug
    me_raw_response   JSONB,                   -- resposta bruta do ME (cotação, compra, etc.)

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shipping_orders IS
    '[SHIP-002] Pedidos de frete nacional via Melhor Envio. '
    'Lifecycle: pending → quoted → cart → paid → generated → posted → in_transit → delivered. '
    'me_order_id é o UUID no Melhor Envio, tracking_code é o código dos Correios/transportadora.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_shipping_orders_order_id
    ON public.shipping_orders (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_orders_me_order_id
    ON public.shipping_orders (me_order_id) WHERE me_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_orders_status
    ON public.shipping_orders (status);

CREATE INDEX IF NOT EXISTS idx_shipping_orders_tracking_code
    ON public.shipping_orders (tracking_code) WHERE tracking_code IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_shipping_orders_updated_at
    BEFORE UPDATE ON public.shipping_orders
    FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- RLS: seller vê via marketplace_orders.seller_id → seller_profiles.user_id
-- RLS: buyer vê via marketplace_orders.buyer_id
ALTER TABLE public.shipping_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY sel_shipping_orders_seller ON public.shipping_orders
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.marketplace_orders mo
            JOIN public.seller_profiles sp ON sp.id = mo.seller_id
            WHERE mo.id = shipping_orders.order_id
              AND sp.user_id = auth.uid()::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.marketplace_orders mo
            JOIN public.seller_profiles sp ON sp.id = mo.seller_id
            WHERE mo.id = shipping_orders.order_id
              AND sp.user_id = auth.uid()::text
        )
    );

CREATE POLICY sel_shipping_orders_buyer ON public.shipping_orders
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.marketplace_orders mo
            WHERE mo.id = shipping_orders.order_id
              AND mo.buyer_id = auth.uid()::text
        )
    );


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. shipping_tracking_events — Eventos de rastreio (timeline)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shipping_tracking_events (
    id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    shipping_order_id  TEXT NOT NULL REFERENCES public.shipping_orders(id) ON DELETE CASCADE,

    status             TEXT NOT NULL,              -- status do evento (ex: 'posted', 'in_transit', 'out_for_delivery', 'delivered')
    description        TEXT,                       -- descrição textual do evento
    location           TEXT,                       -- localidade (ex: 'CDD São Paulo / SP')
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- quando o evento ocorreu
    raw_payload        JSONB,                      -- payload bruto do webhook ME

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shipping_tracking_events IS
    '[SHIP-004] Eventos de rastreio de envios. Cada mudança de status no Melhor Envio '
    'gera um registro para montar a timeline de acompanhamento.';

-- Índice composto para timeline ordenada
CREATE INDEX IF NOT EXISTS idx_tracking_events_order_occurred
    ON public.shipping_tracking_events (shipping_order_id, occurred_at DESC);

-- RLS: mesma lógica de shipping_orders (via join shipping_orders → marketplace_orders)
ALTER TABLE public.shipping_tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sel_tracking_events_seller ON public.shipping_tracking_events
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.shipping_orders so
            JOIN public.marketplace_orders mo ON mo.id = so.order_id
            JOIN public.seller_profiles sp ON sp.id = mo.seller_id
            WHERE so.id = shipping_tracking_events.shipping_order_id
              AND sp.user_id = auth.uid()::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shipping_orders so
            JOIN public.marketplace_orders mo ON mo.id = so.order_id
            JOIN public.seller_profiles sp ON sp.id = mo.seller_id
            WHERE so.id = shipping_tracking_events.shipping_order_id
              AND sp.user_id = auth.uid()::text
        )
    );

CREATE POLICY sel_tracking_events_buyer ON public.shipping_tracking_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.shipping_orders so
            JOIN public.marketplace_orders mo ON mo.id = so.order_id
            WHERE so.id = shipping_tracking_events.shipping_order_id
              AND mo.buyer_id = auth.uid()::text
        )
    );
