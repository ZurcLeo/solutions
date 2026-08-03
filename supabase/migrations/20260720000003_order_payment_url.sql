-- Adiciona coluna para armazenar link de pagamento hospedado (Asaas invoiceUrl)
ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS payment_url TEXT;

-- Comentario descritivo
COMMENT ON COLUMN marketplace_orders.payment_url IS 'URL hospedada de pagamento (Asaas invoiceUrl). Populada para PIX e cartao.';
