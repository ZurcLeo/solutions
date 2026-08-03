-- Migration: adiciona name e description à loja de entrega
-- Campos opcionais — o entregador pode personalizar o nome da loja
ALTER TABLE public.delivery_services
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.delivery_services.name        IS 'Nome comercial da loja de entrega (ex: Moto Rápida BH)';
COMMENT ON COLUMN public.delivery_services.description IS 'Descrição livre da loja (até 200 caracteres)';
