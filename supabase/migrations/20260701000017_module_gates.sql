-- ============================================================================
-- MOD-CORE: Seed dos 5 módulos ativáveis por admin + usuário
-- ============================================================================
-- Módulos: caixinhas, mobilidade_urbana (já existe), jogos, cidadania, juridico
-- Cada módulo pode ser habilitado/desabilitado globalmente pelo admin
-- e individualmente pelo usuário via user_module_preferences.
-- ============================================================================

-- 1) Ativar mobilidade_urbana (já existe na seed original como 'em_breve')
UPDATE platform_modules
SET status = 'ativo'
WHERE id = 'mobilidade_urbana';

-- 2) Inserir os 4 novos módulos (ON CONFLICT para idempotência)
INSERT INTO platform_modules (id, name, description, icon, pillar, status, is_toggleable) VALUES
  ('caixinhas',  'Caixinhas',          'Poupanca coletiva, contribuicoes e emprestimos comunitarios', 'PiggyBank',  'financeiro',  'ativo', true),
  ('jogos',      'Jogos e Concursos',  'Rifas, bolao, amigo secreto e desafios comunitarios',        'Dice5',      'jogos',       'ativo', true),
  ('cidadania',  'Cidadania',          'Agora Digital: relatos, enquetes e informativos civicos',     'Landmark',   'cidadania',   'ativo', true),
  ('juridico',   'Juridico',           'Transparencia fiscal, contratos e governanca comunitaria',    'Scale',      'juridico',    'ativo', true)
ON CONFLICT (id) DO UPDATE SET
  status      = EXCLUDED.status,
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  pillar      = EXCLUDED.pillar;
