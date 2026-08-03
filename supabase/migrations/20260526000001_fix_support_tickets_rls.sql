-- =====================================================
-- MIGRAÇÃO: Corrige RLS da tabela support_tickets
-- Problema: A policy de SELECT só permitia o próprio usuário
--           ou admin. Agentes com role 'support' não conseguiam
--           ver tickets de outros usuários.
-- Data: 2026-05-26
-- =====================================================

-- Substituir a policy de SELECT para incluir role 'support'
DROP POLICY IF EXISTS support_tickets_select ON support_tickets;

CREATE POLICY support_tickets_select ON support_tickets
    FOR SELECT USING (
        user_id = auth.uid()::text
        OR check_global_role(auth.uid()::text, 'admin')
        OR check_global_role(auth.uid()::text, 'support')
    );

-- Policy de UPDATE para agentes de suporte e admins
DROP POLICY IF EXISTS support_tickets_update ON support_tickets;

CREATE POLICY support_tickets_update ON support_tickets
    FOR UPDATE USING (
        check_global_role(auth.uid()::text, 'admin')
        OR check_global_role(auth.uid()::text, 'support')
        OR assigned_to = auth.uid()::text
    );
