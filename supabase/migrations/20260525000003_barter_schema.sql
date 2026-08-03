-- BARTER-001: Loja Social (Escambo) ElosCloud
-- Origem: docs/REPORTS/LAUDO_ESTRATEGICO_MERCADO_LOCAL.md
-- Pedágio de seriedade: 50 EloCoins para anunciar ou solicitar troca
--
-- NOTA DE ADAPTAÇÃO:
--   marketplace_products.price_brl é NOT NULL na migration 20260524000001.
--   Esta migration torna price_brl opcional e adiciona constraint CHECK
--   (price_brl IS NOT NULL OR is_barter_only = true) para garantir consistência.
--   Depende de: 20260524000001_marketplace_schema.sql

-- ============================================================
-- 1. Alterar marketplace_products para suportar barter
-- ============================================================
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS is_barter_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wishlist JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Tornar price_brl opcional (produtos barter não têm preço em BRL)
ALTER TABLE public.marketplace_products
  ALTER COLUMN price_brl DROP NOT NULL;

-- Remover constraint de preço positivo original (será recriada mais abrangente abaixo)
ALTER TABLE public.marketplace_products
  DROP CONSTRAINT IF EXISTS marketplace_products_price_check;

-- Produto tem preço BRL válido, OU é barter_only
ALTER TABLE public.marketplace_products
  ADD CONSTRAINT price_or_barter_required
  CHECK (price_brl IS NOT NULL OR is_barter_only = true);

-- Quando price_brl está preenchido, deve ser >= 0
ALTER TABLE public.marketplace_products
  ADD CONSTRAINT marketplace_products_price_check
  CHECK (price_brl IS NULL OR price_brl >= 0);

-- Índice para filtrar produtos barter
CREATE INDEX IF NOT EXISTS idx_products_barter
  ON public.marketplace_products(is_barter_only)
  WHERE is_barter_only = true;

COMMENT ON COLUMN public.marketplace_products.is_barter_only IS
  '[BARTER-001] Quando true, produto só está disponível para troca (sem preço em BRL). '
  'price_brl deve ser NULL quando is_barter_only = true.';

COMMENT ON COLUMN public.marketplace_products.wishlist IS
  '[BARTER-001] Lista de itens/serviços que o vendedor aceita como troca. '
  'Formato sugerido: [{"tipo": "servico", "descricao": "aula de inglês"}]';

-- ============================================================
-- 2. Tabela trade_requests (solicitações de troca)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trade_requests (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id               TEXT NOT NULL REFERENCES public.marketplace_products(id),
  requester_id             TEXT NOT NULL REFERENCES public.users(id),
  offer_description        TEXT NOT NULL,
  offer_product_id         TEXT REFERENCES public.marketplace_products(id),
  coins_paid               INTEGER NOT NULL DEFAULT 50 CHECK (coins_paid >= 0),
  coins_idempotency_key    TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  rejected_reason          TEXT,
  accepted_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_requests_product
  ON public.trade_requests(product_id);

CREATE INDEX IF NOT EXISTS idx_trade_requests_requester
  ON public.trade_requests(requester_id);

CREATE INDEX IF NOT EXISTS idx_trade_requests_status
  ON public.trade_requests(status);

COMMENT ON TABLE public.trade_requests IS
  '[BARTER-001] Solicitações de troca no sistema de escambo (Loja Social). '
  'coins_idempotency_key garante que a mesma solicitação não é processada duas vezes. '
  '50 EloCoins são debitados como pedágio de seriedade (não reembolsáveis em cancelamento).';

ALTER TABLE public.trade_requests ENABLE ROW LEVEL SECURITY;

-- Solicitante vê suas próprias solicitações
CREATE POLICY "trade_requester_sees_own" ON public.trade_requests
  FOR SELECT USING (requester_id = auth.uid()::text);

-- Dono do produto vê solicitações para seus produtos
CREATE POLICY "trade_product_owner_sees" ON public.trade_requests
  FOR SELECT USING (
    product_id IN (
      SELECT mp.id
      FROM public.marketplace_products mp
      JOIN public.seller_profiles sp ON sp.id = mp.seller_id
      WHERE sp.user_id = auth.uid()::text
    )
  );

-- Solicitante pode inserir (backend valida coins antes)
CREATE POLICY "trade_request_insert" ON public.trade_requests
  FOR INSERT WITH CHECK (requester_id = auth.uid()::text);

-- UPDATE apenas pelo sistema via service_role (backend gerencia transições de status)
CREATE POLICY "trade_request_update_system" ON public.trade_requests
  FOR UPDATE USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.trade_requests FROM anon;

-- ============================================================
-- 3. Verificação pós-migration
-- ============================================================
DO $$ BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'is_barter_only'
  ) = 1, 'FALHOU: coluna is_barter_only não criada';

  ASSERT (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'wishlist'
  ) = 1, 'FALHOU: coluna wishlist não criada';

  ASSERT (
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'trade_requests'
  ) = 1, 'FALHOU: trade_requests não criada';

  RAISE NOTICE 'BARTER-001 migration OK — is_barter_only, wishlist, trade_requests';
END $$;
