-- MOD-CORE Sprint 1 — Arquitetura de Módulos
-- Tabelas: platform_modules, user_module_preferences
-- Seed: 9 módulos iniciais

-- Catálogo de módulos gerenciado pela plataforma
CREATE TABLE IF NOT EXISTS platform_modules (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  icon             TEXT,                    -- nome do ícone lucide-react
  pillar           TEXT,                    -- social|financeiro|juridico|mercado|gamificacao|suporte
  status           TEXT DEFAULT 'em_breve'
                   CHECK (status IN ('ativo','beta','em_breve','visao')),
  is_toggleable    BOOLEAN DEFAULT true,    -- false = sempre ativo (núcleo)
  parent_module_id TEXT REFERENCES platform_modules(id),
  requires         JSONB DEFAULT '[]',      -- dependências de outros módulos
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Preferências por usuário (toggle individual)
-- user_id TEXT pois users.id = Firebase UID (TEXT), não UUID Supabase
CREATE TABLE IF NOT EXISTS user_module_preferences (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id  TEXT NOT NULL REFERENCES platform_modules(id) ON DELETE CASCADE,
  enabled    BOOLEAN DEFAULT true,
  config     JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, module_id)
);

-- Índice para busca por usuário
CREATE INDEX IF NOT EXISTS idx_user_module_prefs_user ON user_module_preferences(user_id);

-- RLS
ALTER TABLE platform_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_module_preferences ENABLE ROW LEVEL SECURITY;

-- platform_modules: leitura pública; escrita apenas admin
CREATE POLICY "platform_modules_read" ON platform_modules
  FOR SELECT USING (true);

CREATE POLICY "platform_modules_admin_write" ON platform_modules
  FOR ALL
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'adm-master')
  );

-- user_module_preferences: usuário lê/escreve apenas as suas; admin lê todas
-- Cast necessário: auth.uid() retorna UUID, mas user_id é TEXT (Firebase UID)
CREATE POLICY "prefs_own" ON user_module_preferences
  FOR ALL
  USING (auth.uid()::text = user_id);

CREATE POLICY "prefs_admin_read" ON user_module_preferences
  FOR SELECT
  USING (
    check_global_role(auth.uid()::text, 'admin')
    OR check_global_role(auth.uid()::text, 'adm-master')
  );

-- Trigger updated_at (reutiliza função se já existir)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_module_prefs_updated_at
  BEFORE UPDATE ON user_module_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed: módulos iniciais da plataforma
INSERT INTO platform_modules (id, name, description, icon, pillar, status, is_toggleable, parent_module_id) VALUES
  ('mercado_local',     'Mercado Local',          'Compre e venda na sua comunidade',                          'ShoppingBag',    'mercado',     'ativo',    false, NULL),
  ('loja_padrao',       'Loja Padrão',            'Anuncie produtos e receba pagamentos',                      'Store',          'mercado',     'ativo',    true,  'mercado_local'),
  ('loja_delivery',     'Delivery & Frete',       'Ofereça entrega local para seus clientes',                  'Truck',          'mercado',     'em_breve', true,  'mercado_local'),
  ('loja_social',       'Loja Social (Escambo)',  'Troque produtos sem dinheiro real',                         'ArrowLeftRight', 'mercado',     'em_breve', true,  'mercado_local'),
  ('memoria_viva',      'Memória Viva',           'Registre memórias, histórias e conquistas da comunidade',   'BookOpen',       'social',      'beta',     true,  NULL),
  ('escola_viva',       'Escola Viva',            'Aprenda e ensine na sua comunidade',                        'GraduationCap',  'social',      'em_breve', true,  NULL),
  ('saude_popular',     'Saúde Popular',          'Acesso a informações e recursos de saúde comunitária',      'Heart',          'suporte',     'em_breve', true,  NULL),
  ('olho_do_imposto',   'Olho do Imposto',        'Transparência fiscal e acompanhamento de gastos públicos',  'Eye',            'juridico',    'em_breve', true,  NULL),
  ('mobilidade_urbana', 'Mobilidade Urbana',      'Transporte coletivo, caronas e mobilidade comunitária',     'MapPin',         'suporte',     'em_breve', true,  NULL)
ON CONFLICT (id) DO NOTHING;
