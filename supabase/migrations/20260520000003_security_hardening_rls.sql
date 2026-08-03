-- =====================================================
-- MIGRAÇÃO: Security Hardening — RLS em Tabelas Públicas
-- Descrição: Ativa RLS e revoga acesso público direto via
--            PostgREST nas tabelas sensíveis que estavam
--            expostas sem proteção no schema public.
-- Autor: infra-agent (delegado por ClaudIA)
-- Data: 2026-05-20
-- Refs: SEC-001 (RLS desabilitado), SEC-003 (exposição PII)
-- =====================================================
-- CONTEXTO DE SEGURANÇA:
--   O Supabase expõe automaticamente o schema public via
--   PostgREST (API REST). Tabelas sem RLS são acessíveis
--   por qualquer portador da anon key (encontrada no frontend).
--   O backend usa service_role key, que ignora RLS por design
--   — ativar RLS NÃO impacta o backend.
-- =====================================================

-- =====================================================
-- 1. role_assignment_audit
--    Dado: log interno de atribuição de roles de sistema.
--    Risco: exposição de quem tem qual papel (admin, etc).
-- =====================================================
ALTER TABLE public.role_assignment_audit ENABLE ROW LEVEL SECURITY;

-- Sem políticas = deny-by-default para anon/authenticated.
-- service_role (backend) continua com acesso total.
REVOKE SELECT ON public.role_assignment_audit FROM anon, authenticated;

COMMENT ON TABLE public.role_assignment_audit IS
    '[SEC-001 — 2026-05-20] RLS ativado. Sem policies públicas. '
    'Acesso exclusivo via service_role (backend). '
    'Dado sensível: histórico de atribuição de roles de sistema.';

-- =====================================================
-- 2. invites
--    PII: email do convidado, nome do remetente,
--         nome do amigo, status, sender_photo_url.
--    Risco: exposição de dados pessoais de convidados
--           e rede social dos usuários.
-- =====================================================
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Sem políticas = deny-by-default para anon/authenticated.
-- O inviteService no backend usa service_role para todas as ops.
REVOKE SELECT ON public.invites FROM anon, authenticated;

COMMENT ON TABLE public.invites IS
    '[SEC-001 + SEC-003 — 2026-05-20] RLS reativado (era DISABLE por premissa '
    'equivocada de que service_role exigia RLS desligado). '
    'PII: email, friend_name, sender_name. Acesso exclusivo via backend.';

-- =====================================================
-- 3. email_logs
--    PII: endereços de email (recipient_to), assuntos,
--         template_data com conteúdo personalizado.
--    Risco: exposição de com quem e sobre o que o
--           sistema se comunicou com cada usuário.
-- =====================================================
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Sem políticas = deny-by-default para anon/authenticated.
REVOKE SELECT ON public.email_logs FROM anon, authenticated;

COMMENT ON TABLE public.email_logs IS
    '[SEC-001 + SEC-003 — 2026-05-20] RLS reativado (era DISABLE). '
    'PII: recipient_to, subject, template_data. '
    'Acesso exclusivo via service_role (emailService no backend).';

-- =====================================================
-- 4. jwt_blacklist
--    Credencial: tokens JWT revogados (strings completas).
--    Risco: exposição de sessões e metadados de usuários;
--           possível uso para análise de padrões de logout.
-- =====================================================
ALTER TABLE public.jwt_blacklist ENABLE ROW LEVEL SECURITY;

-- Sem políticas = deny-by-default para anon/authenticated.
REVOKE SELECT ON public.jwt_blacklist FROM anon, authenticated;

COMMENT ON TABLE public.jwt_blacklist IS
    '[SEC-001 + SEC-003 — 2026-05-20] RLS ativado. '
    'Tokens JWT revogados não devem ser expostos via PostgREST. '
    'Acesso exclusivo via service_role (authService.isTokenBlacklisted).';

-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO (execute no Supabase SQL Editor)
-- =====================================================
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('role_assignment_audit','invites','email_logs','jwt_blacklist');
-- Resultado esperado: rowsecurity = true para todas as 4 tabelas.
--
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('role_assignment_audit','invites','email_logs','jwt_blacklist')
--   AND grantee IN ('anon','authenticated');
-- Resultado esperado: 0 linhas (sem grants para anon/authenticated).
