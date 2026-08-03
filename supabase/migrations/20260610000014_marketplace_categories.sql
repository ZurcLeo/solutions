-- =====================================================
-- MIGRAÇÃO: Taxonomia Dinâmica do Mercado Local
-- [MKTPLACE-CAT-001]
--
-- Descrição:
-- Criação da tabela hierárquica `marketplace_categories` para substituir
-- o hardcode de categorias e regras de fulfillment no frontend/backend.
-- Suporta metadados dinâmicos (JSONB) para nichos como imóveis e veículos.
--
-- Data: 2026-06-10
-- =====================================================

CREATE TABLE IF NOT EXISTS public.marketplace_categories (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 TEXT UNIQUE NOT NULL,
    parent_id            UUID REFERENCES public.marketplace_categories(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    icon                 TEXT,
    fulfillment_defaults TEXT[],    -- Modalidades padrão (ex: '{pickup, local_delivery}')
    metadata_schema      JSONB,     -- Schema de atributos específicos (ex: quartos, vagas)
    active               BOOLEAN DEFAULT true,
    sort_order           INTEGER DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.marketplace_categories IS
    '[MKTPLACE-CAT-001] Taxonomia hierárquica do marketplace. '
    'Define categorias de lojas e produtos, permitindo herança de atributos e regras de fulfillment.';

-- ──────────────────────────────────────────────────────
-- RLS (Row Level Security)
-- ──────────────────────────────────────────────────────
ALTER TABLE public.marketplace_categories ENABLE ROW LEVEL SECURITY;

-- Leitura pública para categorias ativas
CREATE POLICY "marketplace_categories_read_public"
    ON public.marketplace_categories
    FOR SELECT
    TO authenticated
    USING (active = true);

-- Apenas super admins podem gerenciar taxonomia via API (se necessário no futuro)
-- (Backend e Migrations rodam como service_role e ignoram RLS)

-- ──────────────────────────────────────────────────────
-- Seed Data: Categorias Legadas + Novos Ecossistemas
-- ──────────────────────────────────────────────────────

-- 1. Categorias Raiz (As mesmas do hardcode legado)
INSERT INTO public.marketplace_categories (id, slug, name, icon, fulfillment_defaults, sort_order)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'alimentacao', 'Alimentação', 'UtensilsCrossed', '{pickup, local_delivery}', 10),
    ('c0000000-0000-0000-0000-000000000002', 'servicos',    'Serviços',    'Wrench',          '{in_person_service, remote_service}', 20),
    ('c0000000-0000-0000-0000-000000000003', 'produtos',    'Produtos',    'Package',         '{pickup, shipping}', 30),
    ('c0000000-0000-0000-0000-000000000004', 'obra',        'Obra',        'HardHat',         '{in_person_service}', 40),
    ('c0000000-0000-0000-0000-000000000005', 'evento',      'Evento',      'PartyPopper',     '{in_person_service}', 50),
    ('c0000000-0000-0000-0000-000000000006', 'outros',      'Outros',      'LayoutGrid',      '{pickup}', 90),
    
    -- Novo Ecossistema: Imóveis
    ('c0000000-0000-0000-0000-000000000007', 'imoveis',     'Imóveis',     'Building',        '{in_person_service}', 60)
ON CONFLICT (slug) DO UPDATE 
SET name = EXCLUDED.name, fulfillment_defaults = EXCLUDED.fulfillment_defaults, sort_order = EXCLUDED.sort_order;

-- 2. Subcategorias: Imóveis
INSERT INTO public.marketplace_categories (id, parent_id, slug, name, fulfillment_defaults, metadata_schema)
VALUES
    (
        gen_random_uuid(), 
        'c0000000-0000-0000-0000-000000000007', 
        'aluguel_longa_duracao', 
        'Aluguel (Longo Prazo)', 
        '{in_person_service}',
        '{"type": "object", "properties": {"area_m2": {"type": "number"}, "quartos": {"type": "integer"}, "vagas": {"type": "integer"}, "condominio_brl": {"type": "number"}, "iptu_brl": {"type": "number"}, "aceita_pet": {"type": "boolean"}}}'::jsonb
    ),
    (
        gen_random_uuid(), 
        'c0000000-0000-0000-0000-000000000007', 
        'venda', 
        'Venda', 
        '{in_person_service}',
        '{"type": "object", "properties": {"area_m2": {"type": "number"}, "quartos": {"type": "integer"}, "vagas": {"type": "integer"}, "condominio_brl": {"type": "number"}, "iptu_brl": {"type": "number"}, "aceita_financiamento": {"type": "boolean"}}}'::jsonb
    )
ON CONFLICT (slug) DO NOTHING;

-- 3. Subcategorias Opcionais: Serviços
INSERT INTO public.marketplace_categories (id, parent_id, slug, name)
VALUES
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'manutencao', 'Manutenção'),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'reforma',    'Reforma'),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'domesticos', 'Serviços Domésticos'),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'animais',    'Pets e Animais'),
    (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000002', 'financeiro', 'Financeiro e Jurídico')
ON CONFLICT (slug) DO NOTHING;
