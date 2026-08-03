-- S4: Atualiza commission_rate de 5% para 2% (decisão D2)
-- Monetização "Brasileirinho": per_transaction = 2% | subscription = R$29.90/mês (0%)
-- A taxa é aplicada sobre total_brl (BRL efetivo, excluindo ElosCoins discount).
-- Arredondamento: round_brl() uma vez na fronteira de cobrança.

BEGIN;

-- 1. Atualiza default da coluna
ALTER TABLE public.seller_profiles
  ALTER COLUMN commission_rate SET DEFAULT 0.0200;

-- 2. Atualiza sellers existentes que ainda estão no default antigo (5%)
--    Preserva sellers com rates customizadas (diferentes de 0.05)
UPDATE public.seller_profiles
   SET commission_rate = 0.0200,
       updated_at      = NOW()
 WHERE commission_rate = 0.0500;

-- 3. Atualiza o CHECK constraint para refletir nova faixa (max 10% em vez de 50%)
ALTER TABLE public.seller_profiles
  DROP CONSTRAINT IF EXISTS seller_profiles_commission_rate_check;

ALTER TABLE public.seller_profiles
  ADD CONSTRAINT seller_profiles_commission_rate_check
  CHECK (commission_rate BETWEEN 0 AND 0.10);

-- 4. Adiciona coluna subscription_grace_days com default 7 (D3: grace period configurável)
--    Permite que admin ajuste o período de graça por vendedor se necessário.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'seller_profiles'
      AND column_name  = 'subscription_grace_days'
  ) THEN
    ALTER TABLE public.seller_profiles
      ADD COLUMN subscription_grace_days INTEGER NOT NULL DEFAULT 7;
  END IF;
END $$;

COMMIT;
