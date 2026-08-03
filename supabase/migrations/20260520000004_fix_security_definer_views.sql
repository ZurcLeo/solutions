-- =====================================================
-- MIGRAÇÃO: Security Fix — Views com Bypass de RLS
-- Descrição: Corrige views que executavam sob privilégios
--            do owner (postgres/superuser), ignorando RLS
--            das tabelas subjacentes.
--
--            v_user_gamification → security_invoker=true
--              Usuários vêem apenas próprios dados.
--
--            v_leaderboard → REVOKE acesso direto PostgREST
--              Acessível somente via backend (service_role).
--              O backend filtra campos antes de retornar.
--
--            user_selos_public_profile → corrige policy
--              com condição USING (TRUE) — era effectively open.
--
-- Autor: infra-agent (delegado por ClaudIA)
-- Data: 2026-05-20
-- Refs: SEC-002 (Views com SECURITY DEFINER bypass RLS)
-- =====================================================
-- CONTEXTO TÉCNICO (PostgreSQL 15+):
--   Em PG 15+, CREATE VIEW sem opções usa security_invoker=FALSE
--   por padrão: a view executa com os privilégios do owner da view
--   (geralmente postgres/superuser no Supabase, que tem BYPASSRLS).
--   Isso ignora todas as RLS policies das tabelas subjacentes.
--   Solução: security_invoker=TRUE faz a view executar com
--   privilégios do chamador, respeitando suas RLS policies.
-- =====================================================

-- =====================================================
-- 1. Corrigir policy incompleta em user_selos
--    A policy user_selos_public_profile original tinha
--    USING com subquery sem filtro (era efetivamente TRUE).
-- =====================================================
DROP POLICY IF EXISTS user_selos_public_profile ON user_selos;

-- Nova policy: selos visíveis apenas para usuários que
-- habilitaram visibilidade de atividade (opt-in pelo usuário).
-- visibilidade_atividade DEFAULT TRUE (opt-out, não opt-in).
CREATE POLICY user_selos_public_profile ON user_selos
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM users u
            WHERE u.id = user_selos.user_id
              AND u.visibilidade_atividade = TRUE
        )
    );

COMMENT ON POLICY user_selos_public_profile ON user_selos IS
    '[SEC-002 FIX — 2026-05-20] Substituiu policy com USING (TRUE) implícito. '
    'Agora respeita configuração visibilidade_atividade do usuário dono do selo.';

-- =====================================================
-- 2. Recriar v_user_gamification com security_invoker=true
--    Garante que cada usuário vê APENAS seus próprios dados.
--    A policy user_gamification_select_self é respeitada:
--    USING (auth.uid()::text = user_id)
-- =====================================================
DROP VIEW IF EXISTS public.v_user_gamification;

CREATE VIEW public.v_user_gamification
WITH (security_invoker = true)
AS
SELECT
    ug.user_id,
    u.full_name,
    u.avatar_url,
    ug.total_xp,
    ug.current_level,
    gl.name            AS level_name,
    gl.color_hex       AS level_color,
    gl.icon_url        AS level_icon,
    gl.perks           AS level_perks,
    COALESCE(
        (SELECT xp_required
         FROM gamification_levels
         WHERE level_num = ug.current_level + 1),
        99999
    )                  AS xp_next_level,
    ug.elo_coins,
    ug.streak_days,
    ug.longest_streak,
    ug.tasks_completed,
    ug.selos_earned,
    ug.last_activity_date,
    ug.created_at
FROM user_gamification ug
JOIN users             u  ON u.id           = ug.user_id
JOIN gamification_levels gl ON gl.level_num = ug.current_level;

-- Usuários autenticados podem consultar (via Supabase client com JWT)
-- Anônimos não têm acesso à view de gamificação pessoal
REVOKE SELECT ON public.v_user_gamification FROM anon;
GRANT  SELECT ON public.v_user_gamification TO authenticated;

COMMENT ON VIEW public.v_user_gamification IS
    '[SEC-002 FIXED — 2026-05-20] security_invoker=true: respeita a RLS policy '
    'user_gamification_select_self (USING auth.uid()::text = user_id). '
    'Cada usuário autenticado vê apenas seus próprios dados de gamificação. '
    'elo_coins incluído pois é dado financeiro do próprio usuário.';

-- =====================================================
-- 3. Recriar v_leaderboard — bloquear acesso direto PostgREST
--    Estratégia: manter a view para consulta interna do backend
--    (que usa service_role e bypass RLS), mas bloquear acesso
--    direto por anon/authenticated via PostgREST.
--
--    Por que NÃO usar security_invoker=true aqui:
--    A policy user_gamification_select_self restringe a uma
--    única linha (o próprio usuário), o que quebraria o ranking.
--    Adicionar policy permissiva exporia elo_coins a todos.
--    A solução correta é: backend como gatekeeper, com endpoint
--    /api/gamification/leaderboard que filtra colunas seguras.
-- =====================================================

-- Recriar sem alteração de estrutura para garantir estado limpo
DROP VIEW IF EXISTS public.v_leaderboard;

CREATE VIEW public.v_leaderboard AS
SELECT
    ROW_NUMBER() OVER (ORDER BY ug.total_xp DESC) AS rank,
    ug.user_id,
    u.full_name,
    u.avatar_url,
    ug.total_xp,
    ug.current_level,
    gl.name        AS level_name,
    gl.color_hex,
    ug.selos_earned,
    ug.streak_days
FROM user_gamification ug
JOIN users             u  ON u.id           = ug.user_id
JOIN gamification_levels gl ON gl.level_num = ug.current_level
ORDER BY ug.total_xp DESC
LIMIT 100;

-- CRÍTICO: bloquear acesso direto via PostgREST para anon e authenticated.
-- O backend usa service_role (que tem acesso total e bypass de RLS),
-- então o endpoint /api/gamification/leaderboard continua funcionando.
-- Usuários que tentarem chamar o endpoint PostgREST diretamente recebem 403.
REVOKE SELECT ON public.v_leaderboard FROM anon, authenticated;

COMMENT ON VIEW public.v_leaderboard IS
    '[SEC-002 — 2026-05-20] Acesso direto via PostgREST bloqueado para '
    'anon e authenticated. Acessível APENAS via backend com service_role '
    '(endpoint GET /api/gamification/leaderboard). '
    'O backend filtra visibilidade_atividade e colunas seguras antes de retornar. '
    'NOTA: security_invoker=true não foi aplicado pois quebraria o ranking '
    '(RLS user_gamification_select_self retornaria só a linha própria). '
    'Arquitetura correta: backend é o único gatekeeper do leaderboard.';

-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO (execute no Supabase SQL Editor)
-- =====================================================
-- 1. Confirmar security_invoker na v_user_gamification:
-- SELECT viewname, definition
-- FROM pg_views
-- WHERE schemaname = 'public'
--   AND viewname IN ('v_user_gamification', 'v_leaderboard');
--
-- 2. Confirmar grants bloqueados:
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('v_user_gamification', 'v_leaderboard')
--   AND grantee IN ('anon', 'authenticated');
-- Resultado esperado para v_leaderboard: 0 linhas.
-- Resultado esperado para v_user_gamification: 1 linha (authenticated/SELECT).
--
-- 3. Testar acesso:
-- SET ROLE authenticated;
-- SELECT * FROM v_leaderboard; -- deve retornar permission denied
-- SELECT * FROM v_user_gamification; -- deve retornar apenas dados do usuário logado
-- RESET ROLE;
