-- ============================================================================
-- Migration: Normaliza users.telefone para digits-only
-- Data: 2026-07-20
-- Contexto: O campo telefone aceita formato livre (TEXT), mas o resolver
--   IconChat (iconPhoneResolver.js) faz match exato com candidatos digit-only.
--   Telefones salvos com máscara (+, espaços, hífens, parênteses) não são
--   encontrados pelo matching, causando "customer_not_found" silencioso.
--
-- Guards (conforme requisição):
--   (a) Colisão: detecta telefones que colidem após normalização
--   (b) Escopo mínimo: só toca linhas com caracteres não-dígito
--   (c) Backup: salva id + telefone original para rollback
-- ============================================================================

BEGIN;

-- ── 1. Backup das linhas afetadas (rollback manual se necessário) ──────────
CREATE TABLE IF NOT EXISTS public._telefone_normalization_backup (
  user_id   TEXT PRIMARY KEY,
  telefone_original TEXT NOT NULL,
  telefone_normalized TEXT NOT NULL,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Popula backup com linhas que têm caracteres não-dígito
INSERT INTO public._telefone_normalization_backup (user_id, telefone_original, telefone_normalized)
SELECT
  id,
  telefone,
  regexp_replace(telefone, '\D', '', 'g')
FROM public.users
WHERE telefone IS NOT NULL
  AND telefone ~ '\D'
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. Detectar colisões (mesmo telefone normalizado, usuários diferentes) ─
-- Se houver colisões, a migration AVISA mas NÃO aborta — as colisões são
-- registradas no backup para resolução manual. O campo telefone não tem
-- UNIQUE constraint, então o UPDATE não falha.
DO $$
DECLARE
  collision_count INT;
BEGIN
  SELECT count(*) INTO collision_count
  FROM (
    SELECT regexp_replace(telefone, '\D', '', 'g') AS normalized
    FROM public.users
    WHERE telefone IS NOT NULL
      AND telefone ~ '\D'
    GROUP BY regexp_replace(telefone, '\D', '', 'g')
    HAVING count(*) > 1
  ) dupes;

  IF collision_count > 0 THEN
    RAISE WARNING '[normalize_telefone] % telefone(s) colidem após normalização — verificar _telefone_normalization_backup',
      collision_count;
  END IF;

  -- Incluir colisões cross (dados já normalizados vs. dados sendo normalizados)
  SELECT count(*) INTO collision_count
  FROM public.users u1
  JOIN public.users u2
    ON u1.id != u2.id
    AND u1.telefone !~ '\D'  -- u1 já está normalizado
    AND u2.telefone ~ '\D'   -- u2 será normalizado
    AND u1.telefone = regexp_replace(u2.telefone, '\D', '', 'g');

  IF collision_count > 0 THEN
    RAISE WARNING '[normalize_telefone] % colisão(ões) cross (normalizado existente vs. sendo normalizado) — verificar manualmente',
      collision_count;
  END IF;
END $$;

-- ── 3. Normalizar: remover tudo que não é dígito ──────────────────────────
UPDATE public.users
SET
  telefone = regexp_replace(telefone, '\D', '', 'g'),
  updated_at = now()
WHERE telefone IS NOT NULL
  AND telefone ~ '\D';

COMMIT;
