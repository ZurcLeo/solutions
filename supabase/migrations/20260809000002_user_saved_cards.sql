-- PAY-CARD-001: Cartões salvos via tokenização Asaas
-- Tabela separada de user_payment_methods (que é para contas bancárias/PIX)

CREATE TABLE IF NOT EXISTS public.user_saved_cards (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gateway             TEXT NOT NULL DEFAULT 'asaas',
  gateway_customer_id TEXT NOT NULL,
  gateway_token       TEXT NOT NULL,
  brand               TEXT NOT NULL,
  last_four           TEXT NOT NULL,
  holder_name         TEXT NOT NULL,
  nickname            TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  exp_month           TEXT,
  exp_year            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Apenas 1 cartão padrão por usuário
CREATE UNIQUE INDEX IF NOT EXISTS usc_one_default_per_user
  ON public.user_saved_cards (user_id) WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_usc_user_id ON public.user_saved_cards(user_id);

ALTER TABLE public.user_saved_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY usc_owner ON public.user_saved_cards
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
