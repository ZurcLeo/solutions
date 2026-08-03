-- =====================================================
-- MIGRAÇÃO: Adicionar role 'gerente' ao sistema de caixinhas
-- Descrição: Papel intermediário entre admin e membro.
--   - Gerente pode: adicionar membros, ver relatórios
--   - Gerente NÃO pode: excluir caixinha, remover membros, transferir admin
-- Autor: ClaudIA / Léo
-- Data: 2026-06-16
-- =====================================================

-- 1. Normalizar roles legadas do Firestore antes de adicionar constraint
--    caixinhamanager → admin  (era o papel de quem gerencia a caixinha)
--    caixinhamember  → membro (era o membro regular)
UPDATE caixinha_members SET role = 'admin'  WHERE role = 'caixinhamanager';
UPDATE caixinha_members SET role = 'membro' WHERE role = 'caixinhamember';
-- Qualquer outro valor desconhecido → membro (safety net)
UPDATE caixinha_members SET role = 'membro' WHERE role NOT IN ('admin', 'gerente', 'membro', 'removed');

-- 2. Adicionar CHECK constraint para validar roles permitidas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'caixinha_members_role_check'
  ) THEN
    ALTER TABLE caixinha_members
      ADD CONSTRAINT caixinha_members_role_check
      CHECK (role IN ('admin', 'gerente', 'membro', 'removed'));
  END IF;
END $$;

-- 2. Função utilitária: verifica se usuário tem pelo menos o nível de role exigido
--    Hierarquia: admin (3) > gerente (2) > membro (1) > removed (0)
CREATE OR REPLACE FUNCTION check_caixinha_role_level(
  p_caixinha_id TEXT,
  p_user_id TEXT,
  p_min_role TEXT DEFAULT 'membro'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role TEXT;
  v_role_level INT;
  v_min_level INT;
BEGIN
  -- Mapa de níveis
  SELECT CASE role
    WHEN 'admin'   THEN 3
    WHEN 'gerente'  THEN 2
    WHEN 'membro'   THEN 1
    ELSE 0
  END INTO v_role_level
  FROM caixinha_members
  WHERE caixinha_id = p_caixinha_id
    AND user_id = p_user_id
    AND status = 'ativo'
    AND active = true
  LIMIT 1;

  IF v_role_level IS NULL THEN
    RETURN FALSE;
  END IF;

  v_min_level := CASE p_min_role
    WHEN 'admin'   THEN 3
    WHEN 'gerente'  THEN 2
    WHEN 'membro'   THEN 1
    ELSE 0
  END;

  RETURN v_role_level >= v_min_level;
END;
$$;

-- 3. Índice para buscas por role (útil para listar gerentes)
CREATE INDEX IF NOT EXISTS idx_caixinha_members_role
  ON caixinha_members(caixinha_id, role)
  WHERE status = 'ativo';

COMMENT ON FUNCTION check_caixinha_role_level IS
  'Verifica se o usuário tem nível de role >= ao exigido na caixinha. Hierarquia: admin > gerente > membro > removed.';
