-- =====================================================
-- MIGRAÇÃO: Tarefas de Gamificação — KYC Fase 3
-- Descrição: Insere tarefas de gamificação para verificação de
--            documento (OCR) e CNPJ (organizações).
-- Autor: ClaudIA / compliance-agent
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
) VALUES
  (
    'verify_document',
    'Documentação Completa',
    'Envie seu RG ou CNH para verificação completa de identidade e desbloqueie operações de maior valor.',
    'identidade',
    150,
    30,
    8
  ),
  (
    'verify_cnpj',
    'Empresa Verificada',
    'Verifique seu CNPJ na Receita Federal e obtenha certidão negativa da PGFN para operar como organização.',
    'identidade',
    200,
    50,
    9
  )
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE gamification_tasks IS
  'Inclui tarefas KYC Fase 3: verify_document (OCR) e verify_cnpj (CNPJ + PGFN). '
  'Disparadas pelos eventos document_verified e cnpj_verified do KYCService.';
