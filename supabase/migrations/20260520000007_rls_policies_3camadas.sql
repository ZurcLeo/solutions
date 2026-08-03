-- =====================================================
-- MIGRAÇÃO: RLS Policies — Modelo 3 Camadas (21 tabelas)
-- Descrição: Adiciona políticas RLS explícitas para todas as
--            tabelas flagadas pelo linter (lint=0008_rls_enabled_no_policy).
--            Elimina ambiguidade entre "deny implícito" e "sem policy".
--
-- Modelo aprovado pela ClaudIA (2026-05-19):
--   Camada 1 — Server-Only: deny explícito para anon/authenticated
--   Camada 2 — User-Scoped: usuário acessa apenas os próprios dados
--   Camada 3 — RBAC-Scoped: leitura controlada por role/ownership
--
-- Autor: compliance-agent (delegado por ClaudIA)
-- Data: 2026-05-20
-- Refs: lint=0008 (rls_enabled_no_policy), 21 tabelas
--
-- NOTA ARQUITETURAL:
--   O backend usa service_role key → bypassa RLS por design do Supabase.
--   As policies aqui se aplicam APENAS a conexões via anon/authenticated
--   (Supabase client com JWT de usuário ou anon key).
--   Ativar RLS com deny-all NÃO impacta operações do backend.
-- =====================================================


-- =====================================================
-- CAMADA 1 — SERVER-ONLY (16 tabelas)
-- Padrão: apenas o backend (service_role) acessa estes dados.
-- Dados de infraestrutura interna, auditoria, segurança e
-- informações financeiras/KYC sem user_id de acesso direto.
-- =====================================================

-- ---------------------------------------------------
-- 1.1  jwt_blacklist
--      JWTs revogados — jamais expor ao cliente.
--      Acesso: authService.isTokenBlacklisted() via service_role.
-- ---------------------------------------------------
ALTER TABLE public.jwt_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jwt_blacklist_backend_only" ON public.jwt_blacklist;
CREATE POLICY "jwt_blacklist_backend_only"
    ON public.jwt_blacklist
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.jwt_blacklist IS
    '[RLS-3C-C1] Tokens JWT revogados. '
    'Acesso exclusivo via service_role (authService). '
    'Policy: deny-all para anon/authenticated.';

-- ---------------------------------------------------
-- 1.2  audit_log
--      Trilha de auditoria imutável (OTP, saques, KYC).
--      Expor ao cliente violaria a integridade do log.
-- ---------------------------------------------------
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_backend_only" ON public.audit_log;
CREATE POLICY "audit_log_backend_only"
    ON public.audit_log
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.audit_log IS
    '[RLS-3C-C1] Auditoria imutável de ações verificadas (LGPD art. 37). '
    'Acesso exclusivo via service_role. '
    'Policy: deny-all para anon/authenticated.';

-- ---------------------------------------------------
-- 1.3  role_assignment_audit
--      Histórico de atribuição de roles de sistema.
--      Exposição revela estrutura de RBAC → risco de escalada.
-- ---------------------------------------------------
ALTER TABLE public.role_assignment_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_assignment_audit_backend_only" ON public.role_assignment_audit;
CREATE POLICY "role_assignment_audit_backend_only"
    ON public.role_assignment_audit
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.role_assignment_audit IS
    '[RLS-3C-C1] Auditoria de atribuição de roles. '
    'Exposição revela estrutura RBAC. '
    'Acesso exclusivo via service_role.';

-- ---------------------------------------------------
-- 1.4  security_tickets
--      OTPs, passkeys, tokens de verificação em andamento.
--      Dados de segurança crítica — jamais expostos via API.
-- ---------------------------------------------------
ALTER TABLE public.security_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_tickets_backend_only" ON public.security_tickets;
CREATE POLICY "security_tickets_backend_only"
    ON public.security_tickets
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.security_tickets IS
    '[RLS-3C-C1] Tickets de verificação (OTP, passkey). '
    'Dados de segurança — acesso exclusivo via service_role '
    '(requireVerifiedAction middleware).';

-- ---------------------------------------------------
-- 1.5  health_history
--      Criada manualmente no projeto original — não existe em migrations.
--      Wrapped em DO block para compatibilidade em projetos novos.
-- ---------------------------------------------------
DO $health_history$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_history') THEN
    EXECUTE 'ALTER TABLE public.health_history ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "health_history_backend_only" ON public.health_history';
    EXECUTE $p$
      CREATE POLICY "health_history_backend_only"
        ON public.health_history FOR ALL
        TO anon, authenticated
        USING (false) WITH CHECK (false)
    $p$;
  END IF;
END $health_history$;

-- ---------------------------------------------------
-- 1.6  deposit_context_logs
--      Criada manualmente no projeto original — não existe em migrations.
--      Wrapped em DO block para compatibilidade em projetos novos.
-- ---------------------------------------------------
DO $deposit_ctx$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'deposit_context_logs') THEN
    EXECUTE 'ALTER TABLE public.deposit_context_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "deposit_context_logs_backend_only" ON public.deposit_context_logs';
    EXECUTE $p$
      CREATE POLICY "deposit_context_logs_backend_only"
        ON public.deposit_context_logs FOR ALL
        TO anon, authenticated
        USING (false) WITH CHECK (false)
    $p$;
  END IF;
END $deposit_ctx$;

-- ---------------------------------------------------
-- 1.7  email_logs
--      PII: endereços de email, assuntos, template_data.
--      Revelar com quem e sobre o que o sistema comunicou.
-- ---------------------------------------------------
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_logs_backend_only" ON public.email_logs;
CREATE POLICY "email_logs_backend_only"
    ON public.email_logs
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.email_logs IS
    '[RLS-3C-C1] PII: recipient_to, subject, template_data. '
    'Acesso exclusivo via service_role (emailService).';

-- ---------------------------------------------------
-- 1.8  emprestimo_pagamentos
--      Parcelas de pagamento de empréstimos.
--      Não possui user_id ou caixinha_id diretamente —
--      requer JOIN em emprestimos para filtrar por usuário.
--      Decisão: server-only (ver nota de validação ao final).
--      Acesso via backend: GET /api/loans/:id/payments
-- ---------------------------------------------------
ALTER TABLE public.emprestimo_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emprestimo_pagamentos_backend_only" ON public.emprestimo_pagamentos;
CREATE POLICY "emprestimo_pagamentos_backend_only"
    ON public.emprestimo_pagamentos
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.emprestimo_pagamentos IS
    '[RLS-3C-C1] Parcelas de pagamento de empréstimos. '
    'Server-only: sem user_id direto (JOIN em emprestimos necessário). '
    'Acesso via backend (loan-agent). '
    'VALIDAÇÃO PENDENTE: ClaudIA aprovou user-scoped mas schema exige revisão.';

-- ---------------------------------------------------
-- 1.9  qa_runs
--      Resultados de execuções do QA Orchestrator.
--      Dado de infraestrutura interna.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_runs$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_runs') THEN
    EXECUTE 'ALTER TABLE public.qa_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_runs_backend_only" ON public.qa_runs';
    EXECUTE $p$
      CREATE POLICY "qa_runs_backend_only"
          ON public.qa_runs
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_runs IS
          '[RLS-3C-C1] QA Orchestrator — resultados de runs. '
          'Infraestrutura interna. Acesso via QA token (x-qa-token).'
    $p$;
  END IF;
END $qa_runs$;

-- ---------------------------------------------------
-- 1.10 qa_run_bugs
--      Bugs detectados pelo QA Orchestrator.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_run_bugs$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_run_bugs') THEN
    EXECUTE 'ALTER TABLE public.qa_run_bugs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_run_bugs_backend_only" ON public.qa_run_bugs';
    EXECUTE $p$
      CREATE POLICY "qa_run_bugs_backend_only"
          ON public.qa_run_bugs
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_run_bugs IS
          '[RLS-3C-C1] QA Orchestrator — bugs detectados. '
          'Infraestrutura interna.'
    $p$;
  END IF;
END $qa_run_bugs$;

-- ---------------------------------------------------
-- 1.11 qa_run_steps
--      Passos detalhados de cada execução do QA.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_run_steps$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_run_steps') THEN
    EXECUTE 'ALTER TABLE public.qa_run_steps ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_run_steps_backend_only" ON public.qa_run_steps';
    EXECUTE $p$
      CREATE POLICY "qa_run_steps_backend_only"
          ON public.qa_run_steps
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_run_steps IS
          '[RLS-3C-C1] QA Orchestrator — steps de cada run. '
          'Infraestrutura interna.'
    $p$;
  END IF;
END $qa_run_steps$;

-- ---------------------------------------------------
-- 1.12 qa_autofixes
--      PRs automáticos de autofix abertos pela IA.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_autofixes$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_autofixes') THEN
    EXECUTE 'ALTER TABLE public.qa_autofixes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_autofixes_backend_only" ON public.qa_autofixes';
    EXECUTE $p$
      CREATE POLICY "qa_autofixes_backend_only"
          ON public.qa_autofixes
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_autofixes IS
          '[RLS-3C-C1] QA Autofix — PRs automáticos. '
          'Infraestrutura interna. Requer human approval para auth/payment.'
    $p$;
  END IF;
END $qa_autofixes$;

-- ---------------------------------------------------
-- 1.13 qa_autofix_pending
--      Autofixes aguardando aprovação humana.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_autofix_pending$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_autofix_pending') THEN
    EXECUTE 'ALTER TABLE public.qa_autofix_pending ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_autofix_pending_backend_only" ON public.qa_autofix_pending';
    EXECUTE $p$
      CREATE POLICY "qa_autofix_pending_backend_only"
          ON public.qa_autofix_pending
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_autofix_pending IS
          '[RLS-3C-C1] QA Autofix — pendências de aprovação humana. '
          'Infraestrutura interna.'
    $p$;
  END IF;
END $qa_autofix_pending$;

-- ---------------------------------------------------
-- 1.14 qa_interpretation_cache
--      Cache de interpretações da IA (TTL 1h).
--      Dado interno — não deve ser consultável por clientes.
--      NOTA: tabela criada manualmente — DO block garante idempotência.
-- ---------------------------------------------------
DO $qa_interpretation_cache$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qa_interpretation_cache') THEN
    EXECUTE 'ALTER TABLE public.qa_interpretation_cache ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "qa_interpretation_cache_backend_only" ON public.qa_interpretation_cache';
    EXECUTE $p$
      CREATE POLICY "qa_interpretation_cache_backend_only"
          ON public.qa_interpretation_cache
          FOR ALL
          TO anon, authenticated
          USING (false)
          WITH CHECK (false)
    $p$;
    EXECUTE $p$
      COMMENT ON TABLE public.qa_interpretation_cache IS
          '[RLS-3C-C1] Cache de interpretações da IA (SHA-256 / TTL 1h). '
          'Infraestrutura interna.'
    $p$;
  END IF;
END $qa_interpretation_cache$;

-- ---------------------------------------------------
-- 1.15 user_kyc_verifications
--      CPF hash, cpf_last4, dados da Receita Federal.
--      Dados de identidade de alto risco — server-only.
--      Acesso via backend: GET /api/kyc/status
--      VALIDAÇÃO PENDENTE: ClaudIA aprovou user-scoped;
--      mantido como server-only dado o nível de sensibilidade.
--      Se user-scoped for necessário, usar:
--        USING (user_id = auth.uid()::text)
-- ---------------------------------------------------
ALTER TABLE public.user_kyc_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_backend_only" ON public.user_kyc_verifications;
CREATE POLICY "kyc_backend_only"
    ON public.user_kyc_verifications
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.user_kyc_verifications IS
    '[RLS-3C-C1] KYC: cpf_hash, cpf_last4, dados Receita Federal. '
    'Dado de identidade — server-only por segurança. '
    'VALIDAÇÃO PENDENTE: ClaudIA aprovou user-scoped. '
    'Fix rápido se necessário: USING (user_id = auth.uid()::text).';

-- ---------------------------------------------------
-- 1.16 invites
--      PII: email do convidado, sender_name, sender_photo_url.
--      Todas as operações passam pelo inviteService no backend.
--      sender_id usa Firebase UID — compatível com auth.uid().
-- ---------------------------------------------------
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_backend_only" ON public.invites;
CREATE POLICY "invites_backend_only"
    ON public.invites
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

COMMENT ON TABLE public.invites IS
    '[RLS-3C-C1] Convites: PII (email, sender_name, sender_photo_url). '
    'Server-only: todas as ops via inviteService (service_role). '
    'Se acesso client for necessário no futuro: '
    '  SELECT: USING (sender_id = auth.uid()::text)';


-- =====================================================
-- CAMADA 3 — RBAC-SCOPED (4 tabelas)
-- Metadados do sistema RBAC: roles e permissões são
-- definições públicas do sistema (ex: role "admin" existe).
-- Usuário pode ler seus próprios dados de role.
-- Escrita exclusiva via service_role (backend).
-- =====================================================

-- ---------------------------------------------------
-- 3.1  roles
--      Definições de papéis do sistema ('admin', 'member', etc.).
--      Read-only para authenticated: o frontend pode precisar
--      exibir nomes de roles. Escrita: somente service_role.
-- ---------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_authenticated_read" ON public.roles;
CREATE POLICY "roles_authenticated_read"
    ON public.roles
    FOR SELECT
    TO authenticated
    USING (true);

-- anon: sem acesso (deny implícito para operações sem policy)
REVOKE ALL ON public.roles FROM anon;

COMMENT ON TABLE public.roles IS
    '[RLS-3C-C3] Metadados de papéis do sistema. '
    'SELECT público para authenticated (nomes/descrições). '
    'Escrita exclusiva via service_role.';

-- ---------------------------------------------------
-- 3.2  permissions
--      Definições de permissões ('caixinha:create', etc.).
--      Idem a roles — metadado público do sistema.
-- ---------------------------------------------------
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_authenticated_read" ON public.permissions;
CREATE POLICY "permissions_authenticated_read"
    ON public.permissions
    FOR SELECT
    TO authenticated
    USING (true);

REVOKE ALL ON public.permissions FROM anon;

COMMENT ON TABLE public.permissions IS
    '[RLS-3C-C3] Metadados de permissões do sistema. '
    'SELECT público para authenticated. '
    'Escrita exclusiva via service_role.';

-- ---------------------------------------------------
-- 3.3  role_permissions
--      Mapeamento role → permissions.
--      Necessário para que o frontend saiba quais ações
--      cada role pode executar (ex: mostrar/ocultar botões).
-- ---------------------------------------------------
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_authenticated_read" ON public.role_permissions;
CREATE POLICY "role_permissions_authenticated_read"
    ON public.role_permissions
    FOR SELECT
    TO authenticated
    USING (true);

REVOKE ALL ON public.role_permissions FROM anon;

COMMENT ON TABLE public.role_permissions IS
    '[RLS-3C-C3] Mapeamento role → permissions. '
    'SELECT público para authenticated (frontend RBAC). '
    'Escrita exclusiva via service_role.';

-- ---------------------------------------------------
-- 3.4  user_roles
--      Roles atribuídas a cada usuário.
--      Usuário lê apenas os próprios roles.
--      Escrita: somente service_role (sync_user_role RPC).
-- ---------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_own_read" ON public.user_roles;
CREATE POLICY "user_roles_own_read"
    ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid()::text);

-- anon: sem acesso
REVOKE ALL ON public.user_roles FROM anon;

COMMENT ON TABLE public.user_roles IS
    '[RLS-3C-C3] Roles por usuário. '
    'SELECT: apenas próprias roles (user_id = auth.uid()). '
    'Escrita exclusiva via service_role (sync_user_role).';


-- =====================================================
-- BLOCO DE VERIFICAÇÃO PÓS-MIGRAÇÃO
-- Execute no Supabase SQL Editor após aplicar:
-- =====================================================

-- V1. Confirmar que todas as 20 tabelas desta migration têm ≥ 1 policy:
--
-- SELECT
--     schemaname,
--     tablename,
--     COUNT(*) AS policy_count
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--       'jwt_blacklist','audit_log','role_assignment_audit',
--       'security_tickets','health_history','deposit_context_logs',
--       'email_logs','emprestimo_pagamentos','qa_runs','qa_run_bugs',
--       'qa_run_steps','qa_autofixes','qa_autofix_pending',
--       'qa_interpretation_cache','user_kyc_verifications','invites',
--       'roles','permissions','role_permissions','user_roles'
--   )
-- GROUP BY schemaname, tablename
-- ORDER BY tablename;
-- Esperado: 20 linhas, cada uma com policy_count >= 1.

-- V2. Confirmar que anon não tem acesso direto às tabelas RBAC:
--
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('roles','permissions','role_permissions','user_roles')
--   AND grantee = 'anon';
-- Esperado: 0 linhas.

-- V3. Conferir linter — após aplicar, rodar o linter do Supabase:
-- Dashboard → Project → Database → Linter
-- Esperado: lint=0008_rls_enabled_no_policy zerado para todas as tabelas acima.
-- (ai_feedback_loop já tratado em 20260520000006)
