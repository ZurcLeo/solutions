-- =====================================================
-- MIGRAÇÃO: Adiciona status waiting_user_response ao support_tickets
-- Permite registrar quando o ticket aguarda resposta do usuário
-- após uma nota pública de agente.
-- Data: 2026-05-26
-- =====================================================

ALTER TABLE support_tickets
DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE support_tickets
ADD CONSTRAINT support_tickets_status_check
CHECK (status IN ('open', 'pending', 'assigned', 'in_progress', 'waiting_user_response', 'resolved', 'closed'));

COMMENT ON COLUMN support_tickets.status IS 'Ciclo de vida: open → pending → assigned → in_progress → waiting_user_response → resolved → closed.';
