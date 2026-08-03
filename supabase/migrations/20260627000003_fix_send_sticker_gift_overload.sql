-- =====================================================
-- MIGRAÇÃO: Fix send_sticker_gift overload
-- Data: 2026-06-27
-- Bug: POST /api/posts/:id/gifts retorna 400
--
-- Contexto:
--   A migration 20260520000009 criou send_sticker_gift com 5 params.
--   A migration 20260525000005 fez CREATE OR REPLACE com 6 params
--   (adicionando p_message). Em PostgreSQL, como a assinatura difere,
--   isso criou um OVERLOAD (duas funções com o mesmo nome) em vez de
--   substituir. PostgREST pode falhar ao resolver a ambiguidade,
--   retornando erro 400 genérico ao frontend.
--
-- Solução:
--   DROP da versão antiga (5 params) para garantir que apenas a
--   versão com p_message (6 params) exista. PostgREST resolve
--   unambiguamente.
-- =====================================================

-- 1. Drop da versão antiga (5 params) — seguro: nenhum caller usa
--    a versão sem p_message (o backend sempre passa p_message).
DROP FUNCTION IF EXISTS public.send_sticker_gift(TEXT, TEXT, UUID, TEXT, TEXT);

-- 2. Verificação: garantir que a versão de 6 params existe e é INVOKER
DO $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'send_sticker_gift'
      AND pronargs = 6
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'send_sticker_gift(6 params) não encontrada — aplicar migration 20260525000005 primeiro';
  END IF;
END $$;
