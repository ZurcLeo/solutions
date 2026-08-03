-- [MKTPLACE-PIX-001] Persiste código PIX e data de expiração em marketplace_orders
-- para permitir que o comprador recupere o código após sair do checkout.
--
-- Motivation: pixCopiaECola e expirationDate eram retornados apenas no response do
-- createOrder (efêmeros). Se o comprador fechasse a tela antes de pagar, não havia
-- como recuperar sem contatar o suporte.

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS pix_code        TEXT,
  ADD COLUMN IF NOT EXISTS pix_expires_at  TEXT;  -- date string vinda do Asaas, ex: "2024-06-15"

COMMENT ON COLUMN public.marketplace_orders.pix_code IS
  'Código PIX Copia e Cola (pixCopiaECola do Asaas). '
  'Gravado em initiateOrderPayment() para permitir recuperação pelo comprador. '
  'NULL para pedidos não-PIX ou com total_brl = 0 (100% ElosCoins).';

COMMENT ON COLUMN public.marketplace_orders.pix_expires_at IS
  'Data de expiração da cobrança PIX no formato ISO (ex: 2024-06-15T23:59:59Z). '
  'Após essa data, o código é inválido e uma nova cobrança deve ser gerada.';
