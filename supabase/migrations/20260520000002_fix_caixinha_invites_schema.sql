-- =====================================================
-- MIGRAÇÃO: Ajuste de Schema - Convites e Membros (Sincronização)
-- Descrição: Adiciona colunas faltantes em caixinha_invites
--            e garante compatibilidade de nomes de colunas.
-- Autor: Gemini CLI
-- Data: 2026-05-20
-- =====================================================

-- 1. Ajustar caixinha_invites (Adicionar sender_name e target_name)
-- O erro PGRST204 indicou falta de 'sender_name'
ALTER TABLE public.caixinha_invites
    ADD COLUMN IF NOT EXISTS sender_name TEXT,
    ADD COLUMN IF NOT EXISTS target_name TEXT;

COMMENT ON COLUMN public.caixinha_invites.sender_name IS 'Nome do remetente (desnormalizado para exibição rápida)';
COMMENT ON COLUMN public.caixinha_invites.target_name IS 'Nome do destinatário (desnormalizado para exibição rápida)';

-- 2. Garantir que a tabela users tenha os nomes de coluna esperados pelo legado se necessário
-- No Membro.js, está buscando row.nome e row.foto_do_perfil
-- Mas no identity_schema.sql, as colunas são full_name e avatar_url.
-- Vamos adicionar alias ou colunas de compatibilidade se não quisermos mudar todo o código legado agora.
-- Melhor prática: Manter o schema limpo e ajustar o Model.

-- No entanto, para garantir que o syncUserRoleToSupabase e outros funcionem,
-- vamos garantir que a tabela caixinha_invites esteja 100% aderente ao Model.
