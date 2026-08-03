-- ============================================================================
-- PIX Direto — Comprovantes de contribuição (pagamento direto ao admin)
-- ============================================================================

-- 1. Tabela contribution_receipts
CREATE TABLE IF NOT EXISTS public.contribution_receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caixinha_id   TEXT NOT NULL REFERENCES public.caixinhas(id) ON DELETE CASCADE,
  contributor_id TEXT NOT NULL,
  admin_id      TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),

  -- Modo de pagamento que originou este comprovante
  payment_mode  TEXT NOT NULL DEFAULT 'pix_direto'
    CHECK (payment_mode IN ('pix_direto', 'pix_asaas')),

  -- Ciclo de vida do comprovante
  status        TEXT NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN (
      'pending_upload',     -- QR gerado, aguardando upload
      'pending_review',     -- Upload feito, aguardando revisão do admin
      'auto_approved',      -- Aprovado automaticamente (amount match + prazo)
      'admin_approved',     -- Aprovado manualmente pelo admin
      'admin_rejected',     -- Rejeitado pelo admin
      'expired'             -- Expirou sem upload (48h)
    )),

  -- Comprovante (Supabase Storage)
  receipt_url   TEXT,
  receipt_path  TEXT,

  -- Idempotência: payment_id usado pelo ledgerService.creditMember
  payment_id    TEXT UNIQUE,

  -- Dados da revisão
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  rejection_reason TEXT,
  admin_notes   TEXT,

  -- Expiração (48h para upload do comprovante)
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_contribution_receipts_caixinha
  ON public.contribution_receipts(caixinha_id, status);

CREATE INDEX idx_contribution_receipts_contributor
  ON public.contribution_receipts(contributor_id, caixinha_id);

CREATE INDEX idx_contribution_receipts_admin
  ON public.contribution_receipts(admin_id, status);

CREATE INDEX idx_contribution_receipts_expires
  ON public.contribution_receipts(expires_at)
  WHERE status = 'pending_upload';

-- 2. Coluna pix_direto_enabled na tabela caixinhas
ALTER TABLE public.caixinhas
  ADD COLUMN IF NOT EXISTS pix_direto_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. Trigger updated_at
CREATE OR REPLACE FUNCTION public.trg_contribution_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contribution_receipts_updated_at
  BEFORE UPDATE ON public.contribution_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_contribution_receipts_updated_at();

-- 4. RLS
ALTER TABLE public.contribution_receipts ENABLE ROW LEVEL SECURITY;

-- Contribuinte vê os seus comprovantes
CREATE POLICY receipts_contributor_select
  ON public.contribution_receipts
  FOR SELECT
  TO authenticated
  USING (contributor_id = auth.uid()::text);

-- Admin vê comprovantes da caixinha dele
CREATE POLICY receipts_admin_select
  ON public.contribution_receipts
  FOR SELECT
  TO authenticated
  USING (admin_id = auth.uid()::text);

-- Contribuinte pode inserir (via backend, mas RLS garante escopo)
CREATE POLICY receipts_contributor_insert
  ON public.contribution_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (contributor_id = auth.uid()::text);

-- Contribuinte pode atualizar (upload do comprovante, apenas status pending_upload)
CREATE POLICY receipts_contributor_update
  ON public.contribution_receipts
  FOR UPDATE
  TO authenticated
  USING (contributor_id = auth.uid()::text AND status = 'pending_upload')
  WITH CHECK (contributor_id = auth.uid()::text);

-- Admin pode atualizar (aprovar/rejeitar)
CREATE POLICY receipts_admin_update
  ON public.contribution_receipts
  FOR UPDATE
  TO authenticated
  USING (admin_id = auth.uid()::text);

-- Service role tem acesso total (backend)
CREATE POLICY receipts_service_all
  ON public.contribution_receipts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Comentário na tabela
COMMENT ON TABLE public.contribution_receipts IS
  'Comprovantes de pagamento PIX Direto. O contribuinte paga na chave PIX do admin e faz upload do comprovante.';
