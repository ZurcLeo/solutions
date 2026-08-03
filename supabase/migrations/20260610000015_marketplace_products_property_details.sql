-- =====================================================
-- MIGRAÇÃO: Atributos Dinâmicos para Produtos/Imóveis
-- [MKTPLACE-IMOV-001]
--
-- Descrição:
-- Adiciona a coluna JSONB `property_details` à tabela `marketplace_products`
-- para permitir o armazenamento flexível de metadados específicos de imóveis
-- (área, quartos, vagas, IPTU, etc.) sem poluir o schema base.
--
-- Data: 2026-06-10
-- =====================================================

ALTER TABLE public.marketplace_products
    ADD COLUMN IF NOT EXISTS property_details JSONB;

COMMENT ON COLUMN public.marketplace_products.property_details IS
    '[MKTPLACE-IMOV-001] Detalhes específicos de imóveis (JSONB). '
    'Exemplo: {"area_m2": 120, "quartos": 3, "vagas": 2, "condominio_brl": 500}';

-- Índice GIN para buscas performáticas dentro do JSONB no futuro (ex: imóveis com 2+ quartos)
CREATE INDEX IF NOT EXISTS idx_marketplace_products_property_details 
    ON public.marketplace_products USING GIN (property_details);
