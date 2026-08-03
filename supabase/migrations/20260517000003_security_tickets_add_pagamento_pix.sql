-- Migration: 20260517000003_security_tickets_add_pagamento_pix.sql
-- Adiciona 'pagamento_pix' ao CHECK constraint de security_tickets.type.
-- Necessário porque a migration original (20260515000007) foi editada após
-- já ter sido aplicada ao banco live — o Supabase não re-executa migrations
-- marcadas como concluídas, então a constraint antiga ainda está ativa.

ALTER TABLE security_tickets DROP CONSTRAINT IF EXISTS security_tickets_type_check;
ALTER TABLE security_tickets ADD CONSTRAINT security_tickets_type_check
  CHECK (type IN ('login', 'saque', 'kyc', 'email_verify', 'pagamento_pix'));
