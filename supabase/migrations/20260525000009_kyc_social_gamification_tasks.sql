-- =====================================================
-- MIGRAÇÃO: Tasks de Gamificação — KYC Social e Barter
-- Descrição: Insere no catálogo as tarefas de moderação comunitária
--            (Padrinho Responsável, Verificador Voluntário) e de
--            economia de troca (Primeira Troca, Anfitrião de Troca).
--
-- Épico: SOCIAL-KYC | Tasks: GAME-MOD-001
-- Desbloqueado por: SOCIAL-KYC-001 (migration 20260525000008)
-- Triggers mapeados em gamificationService.eventMap (GAME-MOD-002)
--
-- Autor: game-agent (delegado por ClaudIA)
-- Data: 2026-05-25
-- =====================================================

-- Estender o CHECK constraint de category para incluir 'mercado'
-- (Loja Social barter é um módulo distinto dos outros)
ALTER TABLE gamification_tasks
  DROP CONSTRAINT IF EXISTS gamification_tasks_category_check;

ALTER TABLE gamification_tasks
  ADD CONSTRAINT gamification_tasks_category_check
  CHECK (category IN (
    'identidade', 'social', 'financeiro',
    'consistencia', 'comunidade', 'caixinha', 'mercado'
  ));

INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, sort_order)
VALUES
  ('godfather_responsible',
   'Padrinho Responsável',
   'Denunciou um convidado infrator antes do banimento, protegendo a comunidade',
   'social',
   200,
   50,
   1010),

  ('community_kyc_verified',
   'Verificador Voluntário',
   'Verificou a identidade de um vizinho no Círculo de Confiança',
   'social',
   500,
   100,
   1020),

  ('barter_completed',
   'Primeira Troca',
   'Completou uma troca na Loja Social',
   'mercado',
   150,
   30,
   1030),

  ('barter_accepted',
   'Anfitrião de Troca',
   'Aceitou uma solicitação de troca como vendedor',
   'mercado',
   100,
   20,
   1040)

ON CONFLICT (slug) DO NOTHING;
