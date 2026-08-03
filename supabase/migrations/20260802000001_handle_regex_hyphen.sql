-- [HANDLE-003] Expandir regex de username para aceitar hifen (-)
-- Regra: letras minusculas, numeros e hifen; nao comeca/termina com hifen; 3-30 chars
-- Nenhum handle existente e invalidado (superset da regex anterior)

-- 1. Dropar constraint antigo
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format;

-- 2. Criar constraint novo com hifen permitido
ALTER TABLE users
  ADD CONSTRAINT users_username_format
  CHECK (
    username IS NULL
    OR (
      username ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
      AND username !~ '--'
    )
  );

-- Nota: a regex exige min 3 chars (1 + 1 + 1) e max 30 (1 + 28 + 1)
-- O AND NOT '--' impede hifens consecutivos
