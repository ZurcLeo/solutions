-- Fix: user_preferences.user_id UUID → TEXT (Firebase UID)
-- Causa do erro: "invalid input syntax for type uuid: <firebase_uid>"
-- users.id é TEXT (Firebase UID), não UUID Supabase Auth.
-- Referência deve ser public.users(id), não auth.users(id).
-- NOTA: RLS policies devem ser dropadas ANTES do ALTER COLUMN TYPE.

-- 1. Dropar RLS policies (obrigatório antes do ALTER TYPE)
DROP POLICY IF EXISTS "user_preferences_select_own"   ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_update_own"   ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_insert_own"   ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_select_admin" ON user_preferences;

-- 2. Remover FK e PK antigas
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_user_id_fkey;
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_pkey;

-- 3. Converter coluna UUID → TEXT
ALTER TABLE user_preferences ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- 4. Recriar PK e FK referenciando public.users(id) TEXT
ALTER TABLE user_preferences ADD PRIMARY KEY (user_id);
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 5. Recriar RLS policies com cast correto: auth.uid()::text = user_id
CREATE POLICY "user_preferences_select_own"
  ON user_preferences FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "user_preferences_update_own"
  ON user_preferences FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "user_preferences_insert_own"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "user_preferences_select_admin"
  ON user_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()::text
        AND role_id IN ('admin', 'moderator')
    )
  );
