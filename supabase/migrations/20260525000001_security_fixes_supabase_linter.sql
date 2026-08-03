-- =====================================================
-- MIGRAÇÃO: Security Fixes — Supabase Advisor Warnings
-- [SEC-LINT-001] Corrige todos os WARNINGs do Supabase Database Linter
--
-- Problemas corrigidos:
--  [A] search_path mutable em spend_elo_coins e send_sticker_gift
--      Causa: migrations 20260520000009 fizeram CREATE OR REPLACE sem incluir
--      SET search_path, resetando o fix aplicado em 20260520000005.
--      Fix: ALTER FUNCTION ... SET search_path = public
--
--  [B] RLS always-true em post_hashtags (INSERT e DELETE)
--      Cause: policies com WITH CHECK (true) / USING (true) sem restrição de role
--      Fix: substituir por policies que exigem autenticação + ownership do post
--
--  [C] Public bucket avatars permite listagem global (SELECT irrestrito)
--      Causa: policy "Public Access" sem restrição de path nem de role
--      Fix: remover política ampla; adicionar policy que permite listar apenas
--      a própria pasta (URLs públicas continuam funcionando via bucket public=true)
--
--  [D] SECURITY DEFINER functions executáveis por anon via PostgREST:
--      get_my_seller_id, increment_post_gifts_count, is_caixinha_member,
--      is_order_party, send_sticker_gift
--
--      ATENÇÃO — distinção crítica entre dois grupos:
--
--      Grupo 1 — Funções helper de RLS (is_caixinha_member, get_my_seller_id,
--      is_order_party): são chamadas dentro de políticas RLS. Em PostgreSQL,
--      o check de EXECUTE privilege se aplica ao role ativo no momento da
--      avaliação da policy. Revogar EXECUTE de 'authenticated' quebraria as
--      queries de usuários autenticados nas tabelas que usam essas policies.
--      Fix seguro: REVOKE apenas de 'anon' → bloqueia exploração anônima via
--      PostgREST sem impactar RLS de usuários autenticados.
--
--      Grupo 2 — increment_post_gifts_count (trigger-only) e send_sticker_gift
--      (backend-only via service_role): não são chamadas de policies RLS.
--      Fix completo: REVOKE de PUBLIC, anon e authenticated.
--
-- Autor: infra-agent (ElosCloud)
-- Data: 2026-05-25
-- Refs: lint=0011 (search_path), lint=0024 (rls_always_true),
--       lint=0025 (public_bucket_listing), lint=0028 (anon_definer),
--       lint=0029 (auth_definer)
-- =====================================================


-- =====================================================
-- [A] FIX: search_path para spend_elo_coins e send_sticker_gift
-- =====================================================
-- CREATE OR REPLACE FUNCTION sem SET search_path reseta o proconfig,
-- anulando o ALTER FUNCTION da migration 20260520000005.
-- Reaplicamos via ALTER FUNCTION (não altera lógica nem grants existentes).

ALTER FUNCTION public.spend_elo_coins(text, integer, text, text, jsonb)
    SET search_path = public;

ALTER FUNCTION public.send_sticker_gift(text, text, uuid, text, text)
    SET search_path = public;


-- =====================================================
-- [B] FIX: RLS policies always-true em post_hashtags
-- =====================================================
-- As policies atuais permitem INSERT e DELETE irrestrito para qualquer
-- role (sem restrição de TO), incluindo anon. O backend usa service_role
-- (bypassa RLS por design), portanto não depende dessas policies.
-- Substituímos por policies que exigem: (1) autenticação e (2) ser dono do post.

DROP POLICY IF EXISTS "post_hashtags_insert_service" ON public.post_hashtags;
DROP POLICY IF EXISTS "post_hashtags_delete_service" ON public.post_hashtags;

-- INSERT: apenas o autor do post pode adicionar hashtags ao próprio post
CREATE POLICY "post_hashtags_insert_owner"
    ON public.post_hashtags
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id        = post_id
              AND p.usuario_id = auth.uid()::text
        )
    );

-- DELETE: apenas o autor do post pode remover hashtags do próprio post
CREATE POLICY "post_hashtags_delete_owner"
    ON public.post_hashtags
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.posts p
            WHERE p.id        = post_id
              AND p.usuario_id = auth.uid()::text
        )
    );


-- =====================================================
-- [C] FIX: Bucket avatars — restringir SELECT para evitar listagem global
-- =====================================================
-- A policy "Public Access" permite enumerar TODOS os arquivos do bucket
-- avatars via Supabase Storage API (listagem). O bucket `public=true`
-- já garante acesso direto por URL sem precisar de policy SELECT.
-- Substituímos por uma policy que restringe a listagem à pasta do próprio
-- usuário (convenção de path: {auth.uid()}/filename).

DROP POLICY IF EXISTS "Public Access" ON storage.objects;

CREATE POLICY "avatars_list_own_folder"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- NOTA: URLs públicas (https://project.supabase.co/storage/v1/object/public/avatars/...)
-- continuam funcionando sem autenticação — esse acesso é gerenciado pelo CDN
-- do Supabase via bucket.public=true, independente das policies RLS aqui.


-- =====================================================
-- [D] REVOKE EXECUTE em SECURITY DEFINER functions
-- =====================================================

-- ── Grupo 2: Funções NÃO usadas em policies RLS ──────────────────────────
-- Seguro revogar de PUBLIC, anon e authenticated.
-- Backend usa service_role (superuser) → nunca afetado por REVOKE.

-- increment_post_gifts_count() é TRIGGER FUNCTION — nunca deve ser
-- chamada via PostgREST (/rest/v1/rpc/increment_post_gifts_count).
REVOKE EXECUTE ON FUNCTION public.increment_post_gifts_count()
    FROM PUBLIC, anon, authenticated;

-- send_sticker_gift() é chamada exclusivamente pelo backend via service_role.
-- Revogar authenticated é seguro: não há policy RLS que a invoque.
REVOKE EXECUTE ON FUNCTION public.send_sticker_gift(text, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated;

-- ── Grupo 1: Funções helpers de policies RLS ─────────────────────────────
-- Revogar de 'authenticated' quebraria as policies RLS que as chamam.
-- Revogamos apenas de 'anon' (e PUBLIC para garantir herança) →
-- bloqueia chamadas anônimas via PostgREST sem impactar RLS autenticado.
-- Os warnings lint=0029 (authenticated_security_definer) persistirão para
-- estas 3 funções — isso é o comportamento correto dado o uso em RLS.

-- get_my_seller_id() — usada em policies de marketplace_products e marketplace_orders
REVOKE EXECUTE ON FUNCTION public.get_my_seller_id()
    FROM PUBLIC, anon;

-- is_caixinha_member(text, text) — usada em policies de caixinha_members e caixinhas
REVOKE EXECUTE ON FUNCTION public.is_caixinha_member(text, text)
    FROM PUBLIC, anon;

-- is_order_party(text) — usada em policies de marketplace_orders
REVOKE EXECUTE ON FUNCTION public.is_order_party(text)
    FROM PUBLIC, anon;

-- Re-grant para authenticated (necessário pois REVOKE FROM PUBLIC removeu herança)
GRANT EXECUTE ON FUNCTION public.get_my_seller_id()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_caixinha_member(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_order_party(text)    TO authenticated;


-- =====================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- =====================================================

-- [A] Confirmar search_path fixo em spend_elo_coins e send_sticker_gift:
-- SELECT proname, proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN ('spend_elo_coins', 'send_sticker_gift')
--   AND proconfig IS NOT NULL;
-- Esperado: 2 linhas com 'search_path=public'.

-- [B] Confirmar policies de post_hashtags corrigidas:
-- SELECT policyname, cmd, qual, with_check, roles
-- FROM pg_policies
-- WHERE tablename = 'post_hashtags' AND cmd IN ('INSERT', 'DELETE');
-- Esperado: 2 linhas — post_hashtags_insert_owner e post_hashtags_delete_owner.
-- Ambas devem conter EXISTS com condição de usuario_id.

-- [C] Confirmar que "Public Access" foi substituída:
-- SELECT policyname, cmd, roles, qual
-- FROM pg_policies
-- WHERE tablename = 'objects' AND schemaname = 'storage'
--   AND bucket_id = 'avatars';
-- Esperado: policy "avatars_list_own_folder" TO authenticated com path check.

-- [D] Confirmar grants:
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--       'increment_post_gifts_count', 'send_sticker_gift',
--       'get_my_seller_id', 'is_caixinha_member', 'is_order_party'
--   )
--   AND grantee IN ('anon', 'public');
-- Esperado: 0 linhas (anon e public não devem ter EXECUTE nestas funções).
