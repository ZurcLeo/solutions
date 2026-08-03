-- =====================================================
-- MIGRAÇÃO: Tarefa de Gamificação — Verificação de Identidade (KYC)
-- Descrição: Insere a tarefa 'verify_identity' no catálogo de tarefas.
--            Disparada pelo evento 'identity_verified' do KYCService.
-- Autor: ClaudIA / game-agent
-- Data: 2026-05-17
-- =====================================================

INSERT INTO gamification_tasks (
  slug,
  name,
  description,
  category,
  xp_reward,
  coin_reward,
  sort_order
) VALUES (
  'verify_identity',
  'Cidadão Verificado',
  'Confirme sua identidade via CPF para desbloquear operações financeiras completas na plataforma.',
  'identidade',
  100,
  20,
  7   -- Entre verify_email (5) e upload_avatar (10) no onboarding
) ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE gamification_tasks IS 'Inclui tarefa verify_identity — concedida após KYC CPF aprovado pela Receita Federal via InfoSimples.';
