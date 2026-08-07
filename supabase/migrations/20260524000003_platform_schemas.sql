-- =====================================================
-- MIGRAÇÃO: Sectorização da Plataforma ElosCloud
-- Descrição: Cria os 6 schemas de pilar + coluna email_sector
--            em email_logs + tabela de referência platform_pillars.
--
-- IMPORTANTE: As tabelas existentes em `public` NÃO são movidas.
-- Os schemas são namespaces para novas tabelas futuras de cada pilar.
--
-- Pilares:
--   social      — Comunidade & Conexões
--   financeiro  — Finanças Comunitárias
--   juridico    — Legal & Contratos
--   mercado     — Comércio Local
--   gamificacao — Conquistas & Missões
--   suporte     — Central de Atendimento
--
-- Autor: ClaudIA + compliance-agent
-- Data: 2026-05-24
-- =====================================================

-- =====================================================
-- 1. SCHEMAS DE PILAR
-- =====================================================

CREATE SCHEMA IF NOT EXISTS social;
COMMENT ON SCHEMA social IS 'Pilar Social: posts, amizades, mensagens, reações, presentes, comentários.';

CREATE SCHEMA IF NOT EXISTS financeiro;
COMMENT ON SCHEMA financeiro IS 'Pilar Financeiro: caixinhas, contribuições, empréstimos, rifas, concursos.';

CREATE SCHEMA IF NOT EXISTS juridico;
COMMENT ON SCHEMA juridico IS 'Pilar Jurídico: contratos digitais, assinaturas, validação OAB, documentos.';

CREATE SCHEMA IF NOT EXISTS mercado;
COMMENT ON SCHEMA mercado IS 'Pilar Mercado: lojas locais, produtos, pedidos, avaliações, metas comunitárias.';

CREATE SCHEMA IF NOT EXISTS gamificacao;
COMMENT ON SCHEMA gamificacao IS 'Pilar Gamificação: XP, níveis, missões, selos, ElosCoins, desafios diários.';

CREATE SCHEMA IF NOT EXISTS suporte;
COMMENT ON SCHEMA suporte IS 'Pilar Suporte: tickets, mensagens, SLA, knowledge base, CSAT.';

-- =====================================================
-- 2. TABELA DE REFERÊNCIA: platform_pillars
--    Fonte de verdade dos pilares para uso em FKs,
--    dashboards de admin e categorização de tickets.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.platform_pillars (
    id            TEXT PRIMARY KEY,               -- 'social' | 'financeiro' | 'juridico' | 'mercado' | 'gamificacao' | 'suporte'
    label         TEXT NOT NULL,                  -- nome exibido ao usuário
    label_en      TEXT NOT NULL,                  -- nome em inglês (i18n)
    description   TEXT,
    color_primary TEXT NOT NULL,                  -- hex, ex: '#4F46E5'
    color_surface TEXT NOT NULL,                  -- hex claro para fundo de cards
    icon_name     TEXT NOT NULL,                  -- nome do ícone lucide-react
    route         TEXT NOT NULL,                  -- rota frontend base
    email_from    TEXT NOT NULL,                  -- remetente de email do pilar
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order    SMALLINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed dos 6 pilares
INSERT INTO public.platform_pillars
    (id, label, label_en, description, color_primary, color_surface, icon_name, route, email_from, sort_order)
VALUES
    ('social',      'Comunidade',  'Community',    'Posts, amigos, mensagens, reações e presentes.',                       '#4F46E5', '#EEF2FF', 'Globe',          '/social',      'comunidade@eloscloud.com',  1),
    ('financeiro',  'Finanças',    'Finance',      'Caixinhas, contribuições, empréstimos e rifas.',                       '#059669', '#ECFDF5', 'Wallet',         '/financeiro',  'financeiro@eloscloud.com',  2),
    ('juridico',    'Jurídico',    'Legal',        'Contratos digitais, assinaturas e validação OAB.',                     '#7C3AED', '#F5F3FF', 'Scale',          '/juridico',    'juridico@eloscloud.com',    3),
    ('mercado',     'Mercado',     'Marketplace',  'Lojas locais, produtos, pedidos e metas comunitárias.',                '#D97706', '#FFFBEB', 'Store',          '/mercado',     'comercial@eloscloud.com',   4),
    ('gamificacao', 'Conquistas',  'Achievements', 'Missões, XP, níveis, selos e loja de ElosCoins.',                     '#DC2626', '#FEF2F2', 'Gamepad2',       '/game',        'conquistas@eloscloud.com',  5),
    ('suporte',     'Suporte',     'Support',      'Central de atendimento, tickets, IA assistente e knowledge base.',    '#0284C7', '#F0F9FF', 'HeadphonesIcon', '/ajuda/chamados', 'suporte@eloscloud.com',  6)
ON CONFLICT (id) DO UPDATE SET
    label         = EXCLUDED.label,
    label_en      = EXCLUDED.label_en,
    description   = EXCLUDED.description,
    color_primary = EXCLUDED.color_primary,
    color_surface = EXCLUDED.color_surface,
    icon_name     = EXCLUDED.icon_name,
    route         = EXCLUDED.route,
    email_from    = EXCLUDED.email_from,
    sort_order    = EXCLUDED.sort_order;

-- RLS: leitura pública (catálogo de pilares não é dado sensível)
ALTER TABLE public.platform_pillars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_pillars_public_read"
    ON public.platform_pillars
    FOR SELECT
    USING (TRUE);

-- Apenas service role escreve (gerenciado via migration, nunca pela aplicação)
CREATE POLICY "platform_pillars_service_write"
    ON public.platform_pillars
    FOR ALL
    USING (FALSE)
    WITH CHECK (FALSE);

COMMENT ON TABLE public.platform_pillars IS 'Catálogo canônico dos pilares da plataforma ElosCloud. Fonte de verdade para cores, ícones, rotas e remetentes de email.';

-- =====================================================
-- 3. COLUNA email_sector em email_logs
--    Rastreia qual pilar originou cada email.
--    Alimentada pelo emailService.js via resolveSectorFrom().
-- =====================================================

ALTER TABLE public.email_logs
    ADD COLUMN IF NOT EXISTS email_sector TEXT
        REFERENCES public.platform_pillars(id)
        ON DELETE SET NULL;

-- Preenche registros históricos baseado no template_type
UPDATE public.email_logs SET email_sector =
    CASE template_type
        WHEN 'otp'                     THEN NULL   -- segurança não é pilar na tabela pillars
        WHEN 'convite'                 THEN 'social'
        WHEN 'convite_lembrete'        THEN 'social'
        WHEN 'welcome'                 THEN 'social'
        WHEN 'caixinha_invite'         THEN 'financeiro'
        WHEN 'seller_approved'         THEN 'mercado'
        WHEN 'seller_rejected'         THEN 'mercado'
        WHEN 'support_ticket_created'  THEN 'suporte'
        WHEN 'support_ticket_update'   THEN 'suporte'
        WHEN 'support_ticket_resolved' THEN 'suporte'
        ELSE                                'suporte'
    END
WHERE email_sector IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_sector
    ON public.email_logs(email_sector, created_at DESC);

COMMENT ON COLUMN public.email_logs.email_sector IS 'Pilar da plataforma que originou o email. FK para platform_pillars. OTP usa NULL pois segurança é cross-cutting.';

-- =====================================================
-- 4. PILAR DE SEGURANÇA — entrada separada para email_sector
--    OTP e emails de segurança usam setor 'seguranca'
--    (não é um pilar de produto, é infra de acesso)
-- =====================================================

-- Tabela auxiliar para setores de email que não são pilares de produto
CREATE TABLE IF NOT EXISTS public.email_sectors (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    email_from  TEXT NOT NULL,
    reply_to    TEXT NOT NULL,
    description TEXT,
    is_pillar   BOOLEAN NOT NULL DEFAULT TRUE  -- FALSE = setor interno (ex: segurança)
);

INSERT INTO public.email_sectors
    (id, label, email_from, reply_to, description, is_pillar)
VALUES
    ('seguranca',   'Segurança',   'seguranca@eloscloud.com',   'noreply@eloscloud.com',  'OTP, 2FA, reset de senha, alertas de sessão.',                  FALSE),
    ('social',      'Comunidade',  'comunidade@eloscloud.com',  'suporte@eloscloud.com',  'Convites de amizade, lembretes, boas-vindas.',                  TRUE),
    ('financeiro',  'Finanças',    'financeiro@eloscloud.com',  'suporte@eloscloud.com',  'Caixinha invite, contribuições, empréstimos.',                  TRUE),
    ('mercado',     'Mercado',     'comercial@eloscloud.com',   'suporte@eloscloud.com',  'Aprovação de loja, rejeição, pedidos.',                         TRUE),
    ('juridico',    'Jurídico',    'juridico@eloscloud.com',    'juridico@eloscloud.com', 'Contratos, validação OAB.',                                     TRUE),
    ('gamificacao', 'Conquistas',  'conquistas@eloscloud.com',  'noreply@eloscloud.com',  'Level up, selos conquistados, missões concluídas.',             TRUE),
    ('suporte',     'Suporte',     'suporte@eloscloud.com',     'suporte@eloscloud.com',  'Tickets criados, atualizados, resolvidos. Fallback padrão.',    TRUE)
ON CONFLICT (id) DO UPDATE SET
    label       = EXCLUDED.label,
    email_from  = EXCLUDED.email_from,
    reply_to    = EXCLUDED.reply_to,
    description = EXCLUDED.description,
    is_pillar   = EXCLUDED.is_pillar;

ALTER TABLE public.email_sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sectors_public_read"
    ON public.email_sectors
    FOR SELECT
    USING (TRUE);

CREATE POLICY "email_sectors_service_write"
    ON public.email_sectors
    FOR ALL
    USING (FALSE)
    WITH CHECK (FALSE);

COMMENT ON TABLE public.email_sectors IS 'Catálogo de setores de email da plataforma. Inclui setores de produto (pilares) e setores internos (segurança). Fonte de verdade para o emailService.js.';

-- =====================================================
-- 5. GRANT de uso nos novos schemas para service role
-- =====================================================

GRANT USAGE ON SCHEMA social      TO service_role, authenticated;
GRANT USAGE ON SCHEMA financeiro  TO service_role, authenticated;
GRANT USAGE ON SCHEMA juridico    TO service_role, authenticated;
GRANT USAGE ON SCHEMA mercado     TO service_role, authenticated;
GRANT USAGE ON SCHEMA gamificacao TO service_role, authenticated;
GRANT USAGE ON SCHEMA suporte     TO service_role, authenticated;

-- anon só precisa de USAGE onde houver dados públicos (ex: catálogo de mercado)
GRANT USAGE ON SCHEMA mercado     TO anon;
GRANT USAGE ON SCHEMA gamificacao TO anon;
