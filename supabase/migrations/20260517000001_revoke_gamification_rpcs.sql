-- =====================================================
-- MIGRAÇÃO: Defesa em profundidade — RPCs de gamificação
-- Descrição: Revoga acesso público às funções SECURITY DEFINER
--            de gamificação. Elas só devem ser chamadas pelo
--            backend Node.js via service_role key.
--
-- Contexto de arquitetura:
--   Frontend → POST /api/gamification/* (verifyToken obrigatório)
--            → gamificationService.js
--            → Supabase RPC (service_role)
--
--   O frontend NUNCA chama supabase.rpc() diretamente.
--   Ver: backend/eloscloudapp/services/gamificationService.js
--
-- Referência: [SEC-005] — auditoria 2026-05-17
-- =====================================================

-- Revogar acesso às RPCs de escrita com SECURITY DEFINER
-- Roles alvo: PUBLIC (engloba todos), anon (não-autenticado), authenticated (usuário logado)
-- O service_role (usado pelo backend) mantém acesso porque não é afetado pelo REVOKE.

REVOKE EXECUTE ON FUNCTION public.init_user_gamification(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_xp(TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_task(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_selo(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_daily_streak(TEXT)
  FROM PUBLIC, anon, authenticated;

-- Trigger helper: não exposta como RPC, mas revogar por precaução
REVOKE EXECUTE ON FUNCTION public.update_gamification_updated_at()
  FROM PUBLIC, anon, authenticated;

-- =====================================================
-- VERIFICAÇÃO (rodar após aplicar para confirmar)
-- =====================================================
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'init_user_gamification', 'grant_xp', 'complete_task',
--     'grant_selo', 'update_daily_streak'
--   )
-- ORDER BY routine_name, grantee;
-- Resultado esperado: nenhuma linha para grantee = 'PUBLIC', 'anon' ou 'authenticated'
-- =====================================================
