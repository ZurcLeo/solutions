-- RISCO-02: RLS policy de DELETE na tabela caixinhas (defesa em profundidade)
-- O middleware requireCaixinhaAdmin já faz a verificação no backend;
-- esta policy é a segunda camada de proteção.

ALTER TABLE caixinhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caixinhas_delete_admin_only ON caixinhas;

CREATE POLICY caixinhas_delete_admin_only
  ON caixinhas
  FOR DELETE
  USING (
    admin_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    OR
    current_setting('role', true) = 'service_role'
  );
