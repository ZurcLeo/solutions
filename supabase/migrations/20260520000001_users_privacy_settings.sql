-- =====================================================
-- MIGRAÇÃO: Campos de configurações de privacidade na tabela users
-- Descrição: Adiciona colunas que o PrivacySection do frontend
--            envia mas não eram persistidas no Supabase.
-- Depende de: 20260516000004_augment_users_profile_fields.sql
-- Autor: ClaudIA (ElosCloud)
-- Data: 2026-05-20
-- =====================================================

-- 1. Aparecer nas buscas (padrão: true — usuário visível)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS aparece_na_busca BOOLEAN DEFAULT TRUE;

-- 2. Função social (padrão: true — recebe sugestões de conexões)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS funcao_social BOOLEAN DEFAULT TRUE;

-- 3. Visibilidade de atividade (padrão: true — outros vêem contribuições)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS visibilidade_atividade BOOLEAN DEFAULT TRUE;

-- 4. Quem pode adicionar (padrão: 'todos')
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS quem_pode_adicionar TEXT DEFAULT 'todos';

ALTER TABLE users
  ADD CONSTRAINT chk_quem_pode_adicionar
    CHECK (quem_pode_adicionar IN ('todos', 'amigos_de_amigos', 'ninguem'));

-- =====================================================
-- Comentários
-- =====================================================
COMMENT ON COLUMN users.aparece_na_busca IS
  'Se true, o perfil aparece nos resultados de busca de outros usuários.';

COMMENT ON COLUMN users.funcao_social IS
  'Se true, o usuário recebe sugestões de conexão e aparece em recomendações.';

COMMENT ON COLUMN users.visibilidade_atividade IS
  'Se true, outros usuários podem ver contribuições e conquistas deste usuário.';

COMMENT ON COLUMN users.quem_pode_adicionar IS
  'Define quem pode enviar solicitações de conexão: todos | amigos_de_amigos | ninguem.';
