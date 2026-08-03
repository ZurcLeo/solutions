-- =====================================================
-- MIGRAÇÃO: Domínio Convites (ElosCloud)
-- Descrição: Tabela de convites de usuários para substituir
--            a coleção `convites` do Firestore.
-- Autor: ElosCloud
-- Data: 2026-05-15
-- =====================================================

-- =====================================================
-- 1. TABELA invites
-- =====================================================
CREATE TABLE IF NOT EXISTS invites (
    invite_id          TEXT PRIMARY KEY,                -- UUID gerado na aplicação (uuidv4)
    email              TEXT NOT NULL,
    friend_name        TEXT    NOT NULL DEFAULT '',
    sender_id          TEXT    NOT NULL,                -- Firebase Auth UID do remetente
    sender_name        TEXT    NOT NULL DEFAULT '',
    sender_photo_url   TEXT    NOT NULL DEFAULT '',
    status             TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'validated', 'used', 'canceled')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL,            -- createdAt + 5 dias (calculado no backend)
    last_sent_at       TIMESTAMPTZ,
    resend_count       INTEGER NOT NULL DEFAULT 0,
    validated_at       TIMESTAMPTZ,
    validated_by       TEXT,                            -- Firebase UID do usuário que validou
    used_at            TIMESTAMPTZ,
    used_by            TEXT,                            -- Firebase UID do novo usuário registrado
    canceled_at        TIMESTAMPTZ,
    canceled_by        TEXT,                            -- Firebase UID ou 'system'
    caixinha_invite_id TEXT,                            -- Ref. ao convite de caixinha vinculado
    caixinha_id        TEXT                             -- ID da caixinha vinculada
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================

-- Busca por email (findByEmail)
CREATE INDEX IF NOT EXISTS idx_invites_email
    ON invites(email);

-- Busca por remetente (getPendingBySender, getBySenderId)
CREATE INDEX IF NOT EXISTS idx_invites_sender_id
    ON invites(sender_id);

-- Filtro por status (getExpiredInvites, cancelExpiredInvites)
CREATE INDEX IF NOT EXISTS idx_invites_status
    ON invites(status);

-- Ordenação temporal + filtros compostos
CREATE INDEX IF NOT EXISTS idx_invites_created_at
    ON invites(created_at DESC);

-- Filtro combinado para limpeza de expirados
CREATE INDEX IF NOT EXISTS idx_invites_status_created
    ON invites(status, created_at);

-- =====================================================
-- 3. RLS
-- RLS desabilitado — o backend usa service_role key para
-- todas as operações. Habilitar + criar policies quando
-- houver acesso direto via client Supabase (ex: mobile).
-- =====================================================
ALTER TABLE invites DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 4. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================
COMMENT ON TABLE invites IS
    'Convites enviados por usuários para novos membros. '
    'Substitui a coleção "convites" do Firestore. '
    'TTL padrão: 5 dias (expires_at = created_at + 5d).';

COMMENT ON COLUMN invites.invite_id IS
    'UUID v4 gerado no backend — usado nas URLs de convite '
    '(/invite/validate/:invite_id). Não gerado pelo Postgres.';

COMMENT ON COLUMN invites.status IS
    'Ciclo: pending → validated → used | canceled. '
    '"pending": aguardando uso. '
    '"validated": convidado validou email/nome, aguarda registro. '
    '"used": convite consumido, novo usuário registrado. '
    '"canceled": cancelado manualmente ou pelo sistema (expirado).';

COMMENT ON COLUMN invites.expires_at IS
    'Data de expiração calculada no momento do envio (created_at + INVITE_EXPIRATION_DAYS).';

COMMENT ON COLUMN invites.sender_id IS
    'Firebase Auth UID do usuário que enviou o convite. '
    'Referência lógica para a tabela users (não FK para evitar '
    'problemas durante a janela de sync Firebase→Supabase).';
