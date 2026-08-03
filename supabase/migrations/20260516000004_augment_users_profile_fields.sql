-- =====================================================
-- MIGRAÇÃO: Campos de perfil completo na tabela users
-- Descrição: Adiciona colunas que estavam apenas no Firestore,
--            permitindo que o Supabase seja a fonte primária
--            de escrita/leitura para dados de perfil.
-- Depende de: 20260513000000_identity_schema.sql
-- Autor: ClaudIA (ElosCloud)
-- Data: 2026-05-16
-- =====================================================

-- 1. Descrição/bio do usuário
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS descricao TEXT;

-- 2. Telefone (formato livre — validação no backend)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telefone TEXT;

-- 3. Tipo de conta (ex: 'Cliente', 'Advogado', 'Empresa')
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tipo_de_conta TEXT DEFAULT 'Cliente';

-- 4. Visibilidade do perfil
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS perfil_publico BOOLEAN DEFAULT FALSE;

-- =====================================================
-- 5. RLS — Políticas para os novos campos
-- (herdam as policies existentes de SELECT/UPDATE da tabela users)
-- Nenhuma policy adicional necessária: as existentes já cobrem
-- users_select_self e users_update_self por row inteiro.
-- =====================================================

-- =====================================================
-- 6. Comentários para documentação
-- =====================================================
COMMENT ON COLUMN users.descricao IS
  'Bio/descrição livre do usuário. Equivalente ao campo descricao do Firestore.';

COMMENT ON COLUMN users.telefone IS
  'Telefone do usuário (formato livre). Equivalente ao campo telefone do Firestore.';

COMMENT ON COLUMN users.tipo_de_conta IS
  'Categoria da conta: Cliente, Advogado, Empresa, etc. Default: Cliente.';

COMMENT ON COLUMN users.perfil_publico IS
  'Define se o perfil é visível na busca pública. '
  'false = apenas conexões vêem. true = qualquer usuário autenticado vê.';
