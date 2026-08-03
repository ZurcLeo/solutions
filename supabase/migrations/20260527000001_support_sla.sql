-- =====================================================
-- MIGRAÇÃO: SLA (Service Level Agreement) para support_tickets
-- Adiciona prazos de primeiro atendimento e resolução,
-- tracking de breach e índices para alertas.
-- Data: 2026-05-27
-- =====================================================

-- Colunas SLA
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS first_response_due_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_due_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_responded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_breached             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sla_first_response_breached BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN support_tickets.first_response_due_at       IS 'Prazo para a primeira resposta do agente (calculado na criação com base na prioridade).';
COMMENT ON COLUMN support_tickets.resolution_due_at           IS 'Prazo para resolução completa do ticket.';
COMMENT ON COLUMN support_tickets.first_responded_at          IS 'Timestamp da primeira nota pública do agente (marca SLA de primeiro atendimento cumprido).';
COMMENT ON COLUMN support_tickets.sla_breached                IS 'TRUE quando resolution_due_at < now() e ticket ainda não resolvido.';
COMMENT ON COLUMN support_tickets.sla_first_response_breached IS 'TRUE quando first_response_due_at < now() e first_responded_at ainda é NULL.';

-- Índices para queries de "tickets em risco de breach"
CREATE INDEX IF NOT EXISTS idx_support_tickets_first_response_due
  ON support_tickets (first_response_due_at)
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_support_tickets_resolution_due
  ON support_tickets (resolution_due_at)
  WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_support_tickets_sla_breached
  ON support_tickets (sla_breached)
  WHERE sla_breached = TRUE AND status NOT IN ('resolved', 'closed');
