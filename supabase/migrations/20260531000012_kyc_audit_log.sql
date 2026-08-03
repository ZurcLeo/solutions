-- Migration: kyc_audit_log
-- Propósito: Tabela de auditoria para consultas KYC ao scraper da Receita Federal.
--            Armazena APENAS metadados — ZERO PII.
--            CPF, data de nascimento e nome raw NUNCA são gravados aqui.
-- Origem: [KYC-RF-001] Scraper Direto Receita Federal

-- ─────────────────────────────────────────────────────────────
-- Tabela kyc_audit_log
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kyc_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        REFERENCES public.users(id) ON DELETE SET NULL,
  result       text        NOT NULL
                           CHECK (result IN (
                             'REGULAR',
                             'PENDENTE_DE_REGULARIZACAO',
                             'CANCELADA',
                             'SUSPENSA',
                             'NULA',
                             'ERROR',
                             'CIRCUIT_OPEN',
                             'DEFERRED'
                           )),
  name_match   boolean,            -- booleano apenas — NUNCA o nome raw
  duration_ms  integer,            -- latência da consulta em ms
  provider     text        NOT NULL DEFAULT 'receita-federal-direct',
  error_type   text                 -- UNAVAILABLE | PARSE_ERROR | INVALID_DATA | CIRCUIT_OPEN | null
               CHECK (error_type IN (
                 'UNAVAILABLE', 'PARSE_ERROR', 'INVALID_DATA', 'CIRCUIT_OPEN', NULL
               )),
  verified_at  timestamptz NOT NULL DEFAULT now()

  -- NUNCA adicionar colunas: cpf, cpf_raw, birthdate, nome, name_raw
);

COMMENT ON TABLE public.kyc_audit_log IS
  'Auditoria de consultas KYC. Sem PII — CPF, nascimento e nome raw nunca são gravados.';

COMMENT ON COLUMN public.kyc_audit_log.user_id     IS 'Firebase UID (text) do usuário que solicitou a verificação. NULL se conta deletada.';
COMMENT ON COLUMN public.kyc_audit_log.result      IS 'Resultado da consulta: situação cadastral ou ERROR.';
COMMENT ON COLUMN public.kyc_audit_log.name_match  IS 'Booleano: nome Receita ≈ nome declarado. NUNCA o nome em si.';
COMMENT ON COLUMN public.kyc_audit_log.duration_ms IS 'Latência da consulta HTTP à Receita Federal em milissegundos.';
COMMENT ON COLUMN public.kyc_audit_log.provider    IS 'Provedor usado: receita-federal-direct ou infosimples (legado).';
COMMENT ON COLUMN public.kyc_audit_log.error_type  IS 'Tipo de erro quando result=ERROR. NULL em caso de sucesso.';

-- ─────────────────────────────────────────────────────────────
-- RLS — Imutável por design (auditoria): sem UPDATE, sem DELETE
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.kyc_audit_log ENABLE ROW LEVEL SECURITY;

-- Apenas admin pode ler
CREATE POLICY "kyc_audit_admin_read"
  ON public.kyc_audit_log
  FOR SELECT
  USING (check_global_role(auth.uid()::text, 'admin'));

-- INSERT permitido apenas via service role (backend)
-- UPDATE e DELETE: sem políticas → bloqueado por RLS para todos os roles

-- ─────────────────────────────────────────────────────────────
-- Índices
-- ─────────────────────────────────────────────────────────────

-- Consulta por usuário ordenada por data (painel admin, histórico de tentativas)
CREATE INDEX IF NOT EXISTS idx_kyc_audit_user_id
  ON public.kyc_audit_log (user_id, verified_at DESC);

-- Consulta por resultado (monitoring de taxa de erro, circuit breaker stats)
CREATE INDEX IF NOT EXISTS idx_kyc_audit_result
  ON public.kyc_audit_log (result, verified_at DESC);

-- Consulta por provider (para comparação InfoSimples vs scraper direto durante transição)
CREATE INDEX IF NOT EXISTS idx_kyc_audit_provider
  ON public.kyc_audit_log (provider, verified_at DESC);
