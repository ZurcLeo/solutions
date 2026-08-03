-- Migration: CHECK constraints for TEXT enum columns in caixinha domain
-- Fixes: 10+ columns without value constraints — prevents invalid data at DB level
-- Pattern: NOT VALID + VALIDATE (zero-downtime for existing data)

-- =====================================================
-- 1. caixinha_members.role
-- =====================================================
ALTER TABLE caixinha_members
  ADD CONSTRAINT chk_caixinha_members_role
  CHECK (role IN ('admin', 'membro', 'removed', 'caixinhamember', 'caixinhamanager'))
  NOT VALID;

ALTER TABLE caixinha_members
  VALIDATE CONSTRAINT chk_caixinha_members_role;

-- =====================================================
-- 2. caixinha_members.status
-- =====================================================
ALTER TABLE caixinha_members
  ADD CONSTRAINT chk_caixinha_members_status
  CHECK (status IN ('ativo', 'inativo', 'pendente'))
  NOT VALID;

ALTER TABLE caixinha_members
  VALIDATE CONSTRAINT chk_caixinha_members_status;

-- =====================================================
-- 3. contribuicoes.status
-- =====================================================
ALTER TABLE contribuicoes
  ADD CONSTRAINT chk_contribuicoes_status
  CHECK (status IN ('confirmada', 'estornada', 'pendente', 'pendente_confirmacao', 'rejeitada', 'sem_comprovante'))
  NOT VALID;

ALTER TABLE contribuicoes
  VALIDATE CONSTRAINT chk_contribuicoes_status;

-- =====================================================
-- 4. emprestimos.status
-- =====================================================
ALTER TABLE emprestimos
  ADD CONSTRAINT chk_emprestimos_status
  CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'parcial', 'quitado'))
  NOT VALID;

ALTER TABLE emprestimos
  VALIDATE CONSTRAINT chk_emprestimos_status;

-- =====================================================
-- 5. transacoes.tipo
-- =====================================================
ALTER TABLE transacoes
  ADD CONSTRAINT chk_transacoes_tipo
  CHECK (tipo IN ('contribuicao', 'emprestimo', 'bonus', 'estorno', 'pagamento_emprestimo', 'distribuicao', 'saque', 'ajuste'))
  NOT VALID;

ALTER TABLE transacoes
  VALIDATE CONSTRAINT chk_transacoes_tipo;

-- =====================================================
-- 6. disputes.type
-- =====================================================
ALTER TABLE disputes
  ADD CONSTRAINT chk_disputes_type
  CHECK (type IN ('RULE_CHANGE', 'LOAN_APPROVAL', 'MEMBER_REMOVAL', 'INITIAL_CONFIG'))
  NOT VALID;

ALTER TABLE disputes
  VALIDATE CONSTRAINT chk_disputes_type;

-- =====================================================
-- 7. disputes.status
-- =====================================================
ALTER TABLE disputes
  ADD CONSTRAINT chk_disputes_status
  CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'))
  NOT VALID;

ALTER TABLE disputes
  VALIDATE CONSTRAINT chk_disputes_status;

-- =====================================================
-- 8. dispute_votes.vote_type
-- =====================================================
ALTER TABLE dispute_votes
  ADD CONSTRAINT chk_dispute_votes_vote_type
  CHECK (vote_type IN ('YES', 'NO', 'ABSTAIN'))
  NOT VALID;

ALTER TABLE dispute_votes
  VALIDATE CONSTRAINT chk_dispute_votes_vote_type;

-- =====================================================
-- 9. caixinha_invites.status
-- =====================================================
ALTER TABLE caixinha_invites
  ADD CONSTRAINT chk_caixinha_invites_status
  CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled', 'expired'))
  NOT VALID;

ALTER TABLE caixinha_invites
  VALIDATE CONSTRAINT chk_caixinha_invites_status;

-- =====================================================
-- 10. caixinha_invites.type
-- =====================================================
ALTER TABLE caixinha_invites
  ADD CONSTRAINT chk_caixinha_invites_type
  CHECK (type IN ('caixinha_invite', 'caixinha_email_invite'))
  NOT VALID;

ALTER TABLE caixinha_invites
  VALIDATE CONSTRAINT chk_caixinha_invites_type;
