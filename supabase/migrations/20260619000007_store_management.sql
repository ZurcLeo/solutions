-- =====================================================
-- MIGRAÇÃO: Gestão de Loja — Desativação, Exclusão e Controle de Produtos
-- [MKTPLACE-MGT-001]
--
-- Funcionalidades:
--   1. seller_profiles: novos status 'inactive' (auto-pausa) e 'deleted' (exclusão definitiva)
--   2. marketplace_products: coluna deleted_at para soft-delete verdadeiro
--   3. RPC has_active_orders_for_product — verifica se produto tem pedidos ativos
--   4. RPC has_active_orders_for_seller — verifica se loja tem pedidos ativos
--
-- Autor: marketplace-agent (ElosCloud)
-- Data: 2026-06-18
-- =====================================================

-- 1. Expandir CHECK de status em seller_profiles para incluir 'inactive' e 'deleted'
ALTER TABLE public.seller_profiles
  DROP CONSTRAINT IF EXISTS seller_profiles_status_check;

ALTER TABLE public.seller_profiles
  ADD CONSTRAINT seller_profiles_status_check
    CHECK (status IN ('pending', 'active', 'suspended', 'rejected', 'inactive', 'deleted'));

-- Colunas temporais para rastreamento
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.seller_profiles.deactivated_at IS
  'Timestamp de quando o vendedor auto-desativou a loja (status=inactive). NULL se ativa.';
COMMENT ON COLUMN public.seller_profiles.deleted_at IS
  'Timestamp de exclusão definitiva pelo vendedor (status=deleted). Tombstone — dados preservados para auditoria.';

-- 2. Adicionar deleted_at em marketplace_products
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.marketplace_products.deleted_at IS
  'Soft-delete pelo vendedor. Produto fica invisível mas dados preservados para pedidos históricos.';

-- Índice parcial para queries de produtos ativos (exclui deletados)
CREATE INDEX IF NOT EXISTS idx_marketplace_products_not_deleted
  ON public.marketplace_products (seller_id, active)
  WHERE deleted_at IS NULL;

-- 3. RPC: verifica se um produto tem pedidos ativos
CREATE OR REPLACE FUNCTION public.has_active_orders_for_product(p_product_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketplace_orders
    WHERE status IN ('pending', 'paid', 'in_progress')
      AND items::jsonb @> ('[{"product_id":"' || p_product_id || '"}]')::jsonb
  );
$$;

COMMENT ON FUNCTION public.has_active_orders_for_product(TEXT) IS
  'Verifica se existe pelo menos um pedido ativo (pending/paid/in_progress) que contenha o produto.';

-- 4. RPC: verifica se um vendedor tem pedidos ativos
CREATE OR REPLACE FUNCTION public.has_active_orders_for_seller(p_seller_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketplace_orders
    WHERE seller_id = p_seller_id
      AND status IN ('pending', 'paid', 'in_progress')
  );
$$;

COMMENT ON FUNCTION public.has_active_orders_for_seller(TEXT) IS
  'Verifica se o vendedor tem pedidos ativos (pending/paid/in_progress). Impede exclusão de loja com pedidos pendentes.';

-- 5. Atualizar RLS de marketplace_products:
--    Leitura pública agora exclui produtos com deleted_at (além de active=false)
DROP POLICY IF EXISTS "marketplace_products_public_read" ON public.marketplace_products;
CREATE POLICY "marketplace_products_public_read"
  ON public.marketplace_products
  FOR SELECT
  TO authenticated
  USING (active = true AND deleted_at IS NULL);

-- Dono vê tudo (inclusive inativos e deletados, para histórico)
DROP POLICY IF EXISTS "marketplace_products_own_all" ON public.marketplace_products;
CREATE POLICY "marketplace_products_own_all"
  ON public.marketplace_products
  FOR ALL
  TO authenticated
  USING (seller_id = public.get_my_seller_id())
  WITH CHECK (seller_id = public.get_my_seller_id());

-- 6. Atualizar RLS de seller_profiles: leitura pública exclui 'inactive' e 'deleted'
DROP POLICY IF EXISTS "seller_profiles_public_read" ON public.seller_profiles;
CREATE POLICY "seller_profiles_public_read"
  ON public.seller_profiles
  FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Dono vê seu perfil em qualquer status (inclusive inactive/deleted)
-- (já existe seller_profiles_own_all — não precisa recriar)
