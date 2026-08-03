-- [MKTPLACE-OFFLINE-001] Adiciona 'offline_confirmed' ao check constraint de payment_method
-- para permitir que vendedores confirmem pagamentos recebidos fora da plataforma.
--
-- Erro reportado: "new row for relation \"marketplace_orders\" violates check constraint \"marketplace_orders_payment_method_check\""

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_method_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN ('pix', 'stripe', 'eloscoins', 'hybrid', 'offline_confirmed'));

COMMENT ON COLUMN public.marketplace_orders.payment_method IS
    'Método de pagamento utilizado: pix, stripe, eloscoins, hybrid ou offline_confirmed. '
    'offline_confirmed é usado quando o vendedor confirma manualmente o recebimento fora da plataforma.';
