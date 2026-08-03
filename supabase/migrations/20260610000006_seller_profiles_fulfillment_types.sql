-- =====================================================
-- MIGRAÇÃO: fulfillment_types em seller_profiles
-- [HYPER-006] Permite que o vendedor defina quais modalidades
-- de entrega sua loja aceita globalmente.
--
-- Data: 2026-06-10
-- =====================================================

ALTER TABLE public.seller_profiles
    ADD COLUMN IF NOT EXISTS fulfillment_types TEXT[] NOT NULL DEFAULT '{pickup}';

-- Reutiliza a constraint de tipos válidos definida para produtos
ALTER TABLE public.seller_profiles
    ADD CONSTRAINT seller_profiles_fulfillment_check
    CHECK (
        cardinality(fulfillment_types) > 0
        AND fulfillment_types <@ ARRAY[
            'pickup',
            'local_delivery',
            'shipping',
            'in_person_service',
            'remote_service',
            'barter_meeting'
        ]::TEXT[]
    );

COMMENT ON COLUMN public.seller_profiles.fulfillment_types IS
    '[HYPER-006] Modalidades de entrega aceitas pela loja. '
    'Serve como filtro global e padrão para novos produtos.';

-- Índice GIN para buscas eficientes
CREATE INDEX IF NOT EXISTS idx_seller_profiles_fulfillment
    ON public.seller_profiles USING GIN (fulfillment_types);
