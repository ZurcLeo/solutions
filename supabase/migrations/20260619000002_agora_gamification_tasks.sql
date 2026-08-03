-- =============================================================================
-- ÁGORA DIGITAL — Tasks de Gamificação
-- =============================================================================

-- Adicionar 'civic' ao CHECK constraint de category
ALTER TABLE gamification_tasks DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;
ALTER TABLE gamification_tasks ADD CONSTRAINT gamification_tasks_category_check
  CHECK (category = ANY (ARRAY[
    'identidade', 'social', 'financeiro', 'consistencia',
    'comunidade', 'caixinha', 'mercado', 'delivery', 'jogos', 'civic'
  ]));

INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, max_completions, is_active)
VALUES
  ('first_relato',       'Primeiro Relato',        'Crie seu primeiro relato de infraestrutura na Ágora',      'civic', 50, 10, 1, true),
  ('relato_5_reports',   'Relator Ativo',          'Crie 5 relatos de infraestrutura',                        'civic', 100, 25, 1, true),
  ('sign_relato',        'Primeira Assinatura',    'Assine seu primeiro relato comunitário',                   'civic', 30, 5, 1, true),
  ('vote_enquete',       'Voz da Comunidade',      'Vote em uma enquete comunitária',                         'civic', 20, 3, 1, true),
  ('create_enquete',     'Criador de Enquetes',    'Crie uma enquete para a comunidade',                      'civic', 80, 15, 1, true),
  ('relato_resolved',    'Agente de Mudança',      'Tenha um relato seu marcado como resolvido',              'civic', 150, 50, 1, true)
ON CONFLICT (slug) DO NOTHING;
