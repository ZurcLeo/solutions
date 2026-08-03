-- =====================================================
-- MIGRAÇÃO: Augmentar user_connections (ElosCloud)
-- Descrição: Adiciona campos de contexto social à tabela
--            user_connections para substituir completamente
--            os dados do Firestore (amigosAutorizados[],
--            dados do remetente, timestamps de decisão).
-- Depende de: 20260513000005_social_feed_schema.sql
-- Autor: infra-agent (ElosCloud)
-- Data: 2026-05-16
-- =====================================================

-- =====================================================
-- 1. NOVOS CAMPOS — ADD COLUMN IF NOT EXISTS
-- =====================================================

-- Flag "melhor amigo" — substitui amigosAutorizados[] do Firestore
ALTER TABLE user_connections
    ADD COLUMN IF NOT EXISTS is_best_friend BOOLEAN DEFAULT false NOT NULL;

-- Dados de exibição do remetente na listagem de solicitações pendentes
ALTER TABLE user_connections
    ADD COLUMN IF NOT EXISTS sender_name      TEXT,
    ADD COLUMN IF NOT EXISTS sender_email     TEXT,
    ADD COLUMN IF NOT EXISTS sender_photo_url TEXT;

-- Mensagem opcional enviada junto à solicitação de conexão
ALTER TABLE user_connections
    ADD COLUMN IF NOT EXISTS mensagem TEXT;

-- Timestamps de decisão (aceite / rejeição)
ALTER TABLE user_connections
    ADD COLUMN IF NOT EXISTS data_aceite    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS data_rejeicao  TIMESTAMPTZ;

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Consultas de melhores amigos (filtro frequente no feed social)
CREATE INDEX IF NOT EXISTS idx_user_conn_best_friend
    ON user_connections(user_id, is_best_friend)
    WHERE is_best_friend = true;

-- Índice em status (já existe em 20260513000005, criado sem IF NOT EXISTS)
-- Recriamos aqui com IF NOT EXISTS para garantir idempotência em ambientes
-- onde a migration base foi reescrita ou o índice foi dropado manualmente.
CREATE INDEX IF NOT EXISTS idx_user_conn_status
    ON user_connections(status);

-- Busca por email do remetente (ex.: deduplicação, lookup por email)
CREATE INDEX IF NOT EXISTS idx_user_conn_sender_email
    ON user_connections(sender_email)
    WHERE sender_email IS NOT NULL;

-- =====================================================
-- 3. POLÍTICAS RLS
-- O backend usa service_role key que bypassa RLS.
-- As políticas abaixo implementam boas práticas para
-- acesso direto via client Supabase (ex: mobile/web SDK).
-- =====================================================

-- SELECT: cada parte da conexão vê apenas suas próprias linhas
-- (já criada na migration base — mantida aqui como referência,
--  não recriamos para não conflitar com a policy existente)

-- INSERT: somente o próprio usuário pode abrir uma solicitação
DROP POLICY IF EXISTS connections_insert_self ON user_connections;
CREATE POLICY connections_insert_self ON user_connections
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::text);

-- UPDATE: qualquer das duas partes pode atualizar (aceitar/rejeitar/marcar melhor amigo)
DROP POLICY IF EXISTS connections_update_involved ON user_connections;
CREATE POLICY connections_update_involved ON user_connections
    FOR UPDATE
    USING  (user_id = auth.uid()::text OR connected_user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text OR connected_user_id = auth.uid()::text);

-- DELETE: qualquer das duas partes pode remover a conexão
DROP POLICY IF EXISTS connections_delete_involved ON user_connections;
CREATE POLICY connections_delete_involved ON user_connections
    FOR DELETE
    USING (user_id = auth.uid()::text OR connected_user_id = auth.uid()::text);

-- =====================================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON COLUMN user_connections.is_best_friend IS
    'Marca a conexão como "melhor amigo". '
    'Equivalente ao array amigosAutorizados[] do Firestore: '
    'quando true, o connected_user_id tem acesso privilegiado '
    'ao conteúdo restrito do user_id (ex: posts visibilidade=friends).';

COMMENT ON COLUMN user_connections.sender_name IS
    'Nome de exibição do usuário que enviou a solicitação (user_id). '
    'Desnormalizado para evitar JOIN no carregamento de solicitações pendentes.';

COMMENT ON COLUMN user_connections.sender_email IS
    'E-mail do remetente da solicitação. '
    'Usado para deduplicação e notificações.';

COMMENT ON COLUMN user_connections.sender_photo_url IS
    'URL da foto de perfil do remetente no momento do envio. '
    'Snapshot para exibição mesmo que o perfil seja alterado posteriormente.';

COMMENT ON COLUMN user_connections.mensagem IS
    'Mensagem opcional enviada pelo remetente junto à solicitação de conexão. '
    'Exibida para o destinatário na tela de solicitações pendentes.';

COMMENT ON COLUMN user_connections.data_aceite IS
    'Timestamp de quando connected_user_id aceitou a solicitação '
    '(status transicionou de pending → active).';

COMMENT ON COLUMN user_connections.data_rejeicao IS
    'Timestamp de quando connected_user_id rejeitou a solicitação '
    '(status transicionou de pending → rejected).';
