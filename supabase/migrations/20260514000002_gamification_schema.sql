-- =====================================================
-- MIGRAÇÃO: Sistema de Gamificação (ElosCloud)
-- Descrição: Níveis, tarefas, selos, XP, streaks,
--            desafios diários e boosts de conteúdo.
-- Criado por: ClaudIA (Orquestradora) / time ElosCloud
-- Data: 2026-05-14
-- Supabase Project: olbvaswrnsappuzazgoy
-- =====================================================

-- =====================================================
-- 1. TABELA gamification_levels
--    Define os 10 níveis e seus limiares de XP
-- =====================================================
CREATE TABLE gamification_levels (
    level_num       INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,           -- "Semente", "Broto", "Raiz", etc.
    xp_required     INTEGER NOT NULL,        -- XP total para atingir este nível
    icon_url        TEXT,
    color_hex       TEXT NOT NULL DEFAULT '#6366F1',
    description     TEXT,
    perks           JSONB DEFAULT '{}',      -- benefícios desbloqueados neste nível
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE gamification_levels IS 'Definição dos 10 níveis de progressão da gamificação';

-- Seed: níveis (XP cumulativo)
INSERT INTO gamification_levels (level_num, name, xp_required, color_hex, description, perks) VALUES
    (1,  'Semente',     0,      '#94A3B8', 'Você chegou. Bem-vindo à ElosCloud.',          '{"elo_coins_bonus": 10}'),
    (2,  'Broto',       150,    '#4ADE80', 'Primeiros vínculos formados.',                 '{"elo_coins_bonus": 20, "badge_slots": 3}'),
    (3,  'Raiz',        400,    '#22C55E', 'Estabilidade financeira básica conquistada.',  '{"elo_coins_bonus": 35, "badge_slots": 5}'),
    (4,  'Elo',         800,    '#3B82F6', 'Você conecta pessoas ao redor.',               '{"elo_coins_bonus": 55, "badge_slots": 6, "content_boost": true}'),
    (5,  'Parceiro',    1500,   '#6366F1', 'A comunidade confia em você.',                 '{"elo_coins_bonus": 80, "badge_slots": 8, "content_boost": true}'),
    (6,  'Guardião',    2500,   '#8B5CF6', 'Você protege e sustenta caixinhas.',           '{"elo_coins_bonus": 110, "badge_slots": 10, "content_boost": true, "dispute_vote_weight": 2}'),
    (7,  'Mentor',      4000,   '#EC4899', 'Você guia e inspira outros membros.',          '{"elo_coins_bonus": 150, "badge_slots": 12, "content_boost": true, "dispute_vote_weight": 2}'),
    (8,  'Liderança',   6000,   '#F59E0B', 'Suas decisões moldam a comunidade.',           '{"elo_coins_bonus": 200, "badge_slots": 15, "content_boost": true, "dispute_vote_weight": 3}'),
    (9,  'Embaixador',  9000,   '#EF4444', 'Você representa a ElosCloud no mundo.',        '{"elo_coins_bonus": 280, "badge_slots": 20, "content_boost": true, "dispute_vote_weight": 3}'),
    (10, 'Fundador',    13000,  '#F97316', 'Pilar inabalável da nossa comunidade.',        '{"elo_coins_bonus": 500, "badge_slots": 999, "content_boost": true, "dispute_vote_weight": 5, "founder_badge": true}')
ON CONFLICT (level_num) DO NOTHING;

-- =====================================================
-- 2. TABELA gamification_tasks
--    Catálogo de tarefas disponíveis na plataforma
-- =====================================================
CREATE TABLE gamification_tasks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  TEXT UNIQUE NOT NULL,  -- identificador único legível
    name                  TEXT NOT NULL,
    description           TEXT,
    category              TEXT NOT NULL CHECK (category IN (
                              'identidade', 'social', 'financeiro',
                              'consistencia', 'comunidade', 'caixinha'
                          )),
    xp_reward             INTEGER NOT NULL DEFAULT 0,
    coin_reward           INTEGER NOT NULL DEFAULT 0,
    is_repeatable         BOOLEAN DEFAULT FALSE,
    repeat_interval_days  INTEGER,               -- cooldown em dias (para repetíveis)
    max_completions       INTEGER DEFAULT 1,     -- NULL = ilimitado
    target_count          INTEGER DEFAULT 1,     -- para tarefas progressivas (ex: convidar 5 amigos)
    is_active             BOOLEAN DEFAULT TRUE,
    sort_order            INTEGER DEFAULT 0,
    icon_url              TEXT,
    metadata              JSONB DEFAULT '{}',    -- config extra (ex: {"min_level": 3})
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE gamification_tasks IS 'Catálogo de tarefas e missões da gamificação';
COMMENT ON COLUMN gamification_tasks.slug IS 'Identificador usado no backend para acionar completions (ex: complete_profile, first_invite)';
COMMENT ON COLUMN gamification_tasks.target_count IS 'Para tarefas multi-etapa: quantas ações são necessárias para completar';

-- Seed: catálogo de tarefas iniciais
INSERT INTO gamification_tasks (slug, name, description, category, xp_reward, coin_reward, is_repeatable, max_completions, target_count, sort_order) VALUES
    -- Identidade
    ('complete_profile',        'Perfil Completo',              'Preencha nome, bio e foto de perfil',                          'identidade',   80,  15, FALSE, 1, 1, 10),
    ('upload_avatar',           'Foto de Perfil',               'Adicione uma foto de perfil',                                  'identidade',   30,  5,  FALSE, 1, 1, 11),
    ('verify_email',            'Email Verificado',             'Confirme seu endereço de email',                               'identidade',   50,  10, FALSE, 1, 1, 12),
    ('first_login',             'Bem-vindo!',                   'Faça seu primeiro login na ElosCloud',                         'identidade',   20,  50, FALSE, 1, 1, 1),

    -- Social
    ('first_invite',            'Primeiro Convite',             'Convide um amigo para a ElosCloud',                            'social',       60,  10, FALSE, 1, 1, 20),
    ('invite_5_friends',        'Rede de Conexões',             'Convide 5 amigos para a ElosCloud',                            'social',       150, 30, FALSE, 1, 5, 21),
    ('first_post',              'Primeira Publicação',          'Publique algo no seu feed social',                             'social',       40,  5,  FALSE, 1, 1, 22),
    ('post_10_times',           'Voz Ativa',                    'Publique 10 conteúdos no feed',                                'social',       120, 20, FALSE, 1, 10, 23),
    ('receive_10_reactions',    'Conteúdo que Conecta',         'Receba 10 reações em suas publicações',                        'social',       100, 15, FALSE, 1, 10, 24),
    ('make_5_connections',      'Construtor de Elos',           'Conecte-se com 5 pessoas',                                     'social',       80,  10, FALSE, 1, 5, 25),
    ('comment_10_posts',        'Participativo',                'Comente em 10 publicações de outros usuários',                 'social',       60,  8,  FALSE, 1, 10, 26),
    ('gift_sent',               'Doador',                       'Envie um presente para um amigo',                              'social',       50,  10, TRUE,  NULL, 1, 27),

    -- Financeiro
    ('create_first_caixinha',   'Fundador de Caixinha',         'Crie sua primeira caixinha',                                   'financeiro',   100, 20, FALSE, 1, 1, 30),
    ('join_caixinha',           'Membro de Caixinha',           'Entre em uma caixinha existente',                              'financeiro',   60,  10, FALSE, 1, 1, 31),
    ('first_contribution',      'Primeira Contribuição',        'Realize sua primeira contribuição mensal',                     'financeiro',   80,  15, FALSE, 1, 1, 32),
    ('pay_on_time_3months',     'Pontualidade Prata',           'Pague em dia por 3 meses consecutivos',                        'financeiro',   200, 40, FALSE, 1, 3, 33),
    ('pay_on_time_6months',     'Pontualidade Ouro',            'Pague em dia por 6 meses consecutivos',                        'financeiro',   400, 80, FALSE, 1, 6, 34),
    ('invite_to_caixinha',      'Recrutador',                   'Convide alguém para sua caixinha',                             'caixinha',     50,  8,  FALSE, 1, 1, 35),

    -- Consistência
    ('streak_7days',            'Semana Perfeita',              'Acesse a ElosCloud por 7 dias seguidos',                       'consistencia', 100, 20, FALSE,  NULL, 7, 40),
    ('streak_30days',           'Mês Dedicado',                 'Acesse a ElosCloud por 30 dias seguidos',                      'consistencia', 400, 80, TRUE,  NULL, 30, 41),
    ('streak_100days',          'Comprometimento Total',        'Acesse a ElosCloud por 100 dias seguidos',                     'consistencia', 1000,200, FALSE, 3, 100, 42),
    ('daily_login',             'Login Diário',                 'Acesse a plataforma hoje',                                     'consistencia', 100, 20, TRUE,  NULL, 7, 40),

    -- Comunidade
    ('vote_dispute',            'Voto Comunitário',             'Participe de uma votação de disputa',                          'comunidade',   30,  5,  TRUE,  NULL, 1, 50),
    ('resolve_dispute',         'Mediador',                     'Ajude a resolver uma disputa na sua caixinha',                 'comunidade',   80,  15, TRUE,  NULL, 1, 51),
    ('help_member',             'Solidariedade',                'Auxilie um membro da caixinha em dificuldade (aprovação coletiva)','comunidade',60, 10, TRUE,  NULL, 1, 52)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- 3. TABELA user_gamification
--    Estado de gamificação de cada usuário
-- =====================================================
CREATE TABLE user_gamification (
    user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp            INTEGER DEFAULT 0,
    current_level       INTEGER DEFAULT 1 REFERENCES gamification_levels(level_num),
    elo_coins           INTEGER DEFAULT 0,
    streak_days         INTEGER DEFAULT 0,
    longest_streak      INTEGER DEFAULT 0,
    last_activity_date  DATE,
    tasks_completed     INTEGER DEFAULT 0,
    selos_earned        INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE user_gamification IS 'Estado atual de gamificação de cada usuário (XP, nível, streak, moedas)';

-- =====================================================
-- 4. TABELA user_tasks
--    Progresso e histórico de tarefas por usuário
-- =====================================================
CREATE TABLE user_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES gamification_tasks(id),
    status          TEXT DEFAULT 'available' CHECK (status IN ('available', 'in_progress', 'completed')),
    progress        INTEGER DEFAULT 0,        -- progresso atual (ex: 3 de 5 convites)
    completions     INTEGER DEFAULT 0,        -- quantas vezes já completou (para repetíveis)
    last_completed_at TIMESTAMPTZ,
    xp_granted_total  INTEGER DEFAULT 0,      -- XP total acumulado nesta tarefa
    coins_granted_total INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, task_id)
);

COMMENT ON TABLE user_tasks IS 'Rastreamento de progresso e conclusões de tarefas por usuário';

-- Índices
CREATE INDEX idx_user_tasks_user_id ON user_tasks(user_id);
CREATE INDEX idx_user_tasks_status ON user_tasks(status);
CREATE INDEX idx_user_tasks_task_id ON user_tasks(task_id);

-- =====================================================
-- 5. TABELA selos
--    Catálogo de todos os selos (badges) disponíveis
-- =====================================================
CREATE TABLE selos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    category            TEXT NOT NULL CHECK (category IN (
                            'conquista', 'plataforma', 'especial', 'caixinha', 'social',
                            'financeiro', 'comunidade'
                        )),
    tier                TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'prata', 'ouro', 'diamante')),
    icon_url            TEXT,
    color_hex           TEXT DEFAULT '#CD7F32',
    is_active           BOOLEAN DEFAULT TRUE,
    is_platform_grant   BOOLEAN DEFAULT FALSE,   -- pode ser concedido pelo algoritmo
    grant_criteria      JSONB DEFAULT '{}',       -- critérios para concessão automática
    xp_bonus            INTEGER DEFAULT 0,        -- XP bônus ao receber o selo
    coin_bonus          INTEGER DEFAULT 0,
    is_unique           BOOLEAN DEFAULT TRUE,     -- FALSE = pode ganhar mais de uma vez
    sort_order          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE selos IS 'Catálogo de selos (badges) — conquistas, plataforma, especiais e caixinha';
COMMENT ON COLUMN selos.is_platform_grant IS 'TRUE = o algoritmo da plataforma pode conceder automaticamente por engajamento social';
COMMENT ON COLUMN selos.grant_criteria IS 'JSON com critérios de concessão automática (ex: {"min_reactions_30d": 50, "min_posts_30d": 10})';

-- Seed: selos iniciais
INSERT INTO selos (slug, name, description, category, tier, color_hex, is_platform_grant, grant_criteria, xp_bonus, coin_bonus, sort_order) VALUES
    -- Conquistas (earned por tarefas)
    ('welcome',                 'Bem-vindo!',                   'Fez seu primeiro acesso à ElosCloud',                      'conquista', 'bronze',  '#94A3B8', FALSE, '{}',                                   20,   50,  1),
    ('profile_complete',        'Identidade Completa',          'Preencheu todos os dados do perfil',                       'conquista', 'bronze',  '#94A3B8', FALSE, '{}',                                   50,   10,  2),
    ('first_elo',               'Primeiro Elo',                 'Fez sua primeira conexão na plataforma',                   'conquista', 'bronze',  '#94A3B8', FALSE, '{}',                                   40,   8,   3),
    ('caixinha_founder',        'Fundador de Caixinha',         'Criou sua primeira caixinha',                              'caixinha',  'prata',   '#C0C0C0', FALSE, '{}',                                   100,  20,  10),
    ('faithful_payer_3m',       'Pagador Fiel — Prata',         '3 meses de contribuições em dia',                         'financeiro','prata',   '#C0C0C0', FALSE, '{}',                                   200,  40,  11),
    ('faithful_payer_6m',       'Pagador Fiel — Ouro',          '6 meses de contribuições em dia',                         'financeiro','ouro',    '#FFD700', FALSE, '{}',                                   400,  80,  12),
    ('week_warrior',            'Guerreiro da Semana',          '7 dias de acesso consecutivos',                            'conquista', 'bronze',  '#94A3B8', FALSE, '{}',                                   60,   12,  20),
    ('month_champion',          'Campeão do Mês',               '30 dias de acesso consecutivos',                           'conquista', 'prata',   '#C0C0C0', FALSE, '{}',                                   300,  60,  21),
    ('centenarian',             'Centenário',                   '100 dias de acesso consecutivos',                          'conquista', 'ouro',    '#FFD700', FALSE, '{}',                                   800,  160, 22),
    ('community_mediator',      'Mediador Comunitário',         'Resolveu 5 disputas na comunidade',                        'comunidade','prata',   '#C0C0C0', FALSE, '{}',                                   200,  40,  30),
    ('connector_5',             'Construtor de Redes',          'Conectou-se com 5 pessoas',                                'social',    'bronze',  '#94A3B8', FALSE, '{}',                                   50,   10,  31),
    ('invite_squad',            'Embaixador de Convites',       'Convidou 5 amigos para a ElosCloud',                       'social',    'prata',   '#C0C0C0', FALSE, '{}',                                   150,  30,  32),
    ('founder_level',           'Fundador da Comunidade',       'Atingiu o nível máximo: Fundador',                         'conquista', 'diamante','#B9F2FF', FALSE, '{}',                                   1000, 500, 99),

    -- Plataforma (concedidos pelo algoritmo)
    ('trending_content',        'Conteúdo em Destaque',         'Sua publicação foi destacada pelo algoritmo da ElosCloud',  'plataforma','prata',   '#6366F1', TRUE,  '{"min_reactions_7d": 20}',             100,  25,  50),
    ('community_voice',         'Voz da Comunidade',            'Você é uma referência na plataforma',                       'plataforma','ouro',    '#6366F1', TRUE,  '{"min_reactions_30d": 100, "min_posts_30d": 5}', 300, 75, 51),
    ('social_influencer',       'Influenciador Social',         'Conteúdo com alto impacto na rede ElosCloud',              'plataforma','diamante','#6366F1', TRUE,  '{"min_reactions_30d": 500, "min_connections": 50}', 800, 200, 52),
    ('platform_champion',       'Destaque da Plataforma',       'Reconhecido pela ElosCloud por contribuições excepcionais', 'plataforma','diamante','#6366F1', TRUE,  '{"manual_grant": true}',               500,  150, 53),

    -- Especiais (edição limitada)
    ('early_adopter',           'Pioneiro',                     'Um dos primeiros membros da ElosCloud',                    'especial',  'ouro',    '#F59E0B', FALSE, '{"max_users": 1000}',                   500,  100, 70),
    ('beta_tester',             'Beta Tester',                  'Participou do período beta da plataforma',                  'especial',  'prata',   '#F59E0B', FALSE, '{"beta_period": true}',                 200,  50,  71)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- 6. TABELA user_selos
--    Selos conquistados por cada usuário
-- =====================================================
CREATE TABLE user_selos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selo_id         UUID NOT NULL REFERENCES selos(id),
    granted_by      TEXT DEFAULT 'system',       -- 'system', 'platform', ou user_id do admin
    grant_reason    TEXT,
    is_pinned       BOOLEAN DEFAULT FALSE,        -- destaque no perfil
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, selo_id)
);

COMMENT ON TABLE user_selos IS 'Registro de selos conquistados por cada usuário';

-- Índices
CREATE INDEX idx_user_selos_user_id ON user_selos(user_id);
CREATE INDEX idx_user_selos_granted_at ON user_selos(granted_at);
CREATE INDEX idx_user_selos_is_pinned ON user_selos(user_id, is_pinned) WHERE is_pinned = TRUE;

-- =====================================================
-- 7. TABELA xp_events
--    Log de auditoria de todos os ganhos de XP
-- =====================================================
CREATE TABLE xp_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    xp_delta    INTEGER NOT NULL,                -- positivo ou negativo
    coin_delta  INTEGER DEFAULT 0,
    source      TEXT NOT NULL CHECK (source IN (
                    'task', 'selo', 'streak_bonus', 'daily_challenge',
                    'level_up_bonus', 'platform_grant', 'admin', 'penalty'
                )),
    source_id   TEXT,                            -- UUID da task/selo que originou
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE xp_events IS 'Auditoria imutável de todos os ganhos e perdas de XP e EloCoins';

-- Índices
CREATE INDEX idx_xp_events_user_id ON xp_events(user_id);
CREATE INDEX idx_xp_events_created_at ON xp_events(created_at);
CREATE INDEX idx_xp_events_source ON xp_events(source);

-- =====================================================
-- 8. TABELA daily_challenges
--    Desafio diário rotativo (XP multiplicado)
-- =====================================================
CREATE TABLE daily_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES gamification_tasks(id),
    valid_date      DATE NOT NULL UNIQUE,
    xp_multiplier   NUMERIC DEFAULT 2.0,         -- ex: 2x o XP normal da tarefa
    coin_multiplier NUMERIC DEFAULT 1.5,
    description     TEXT,                        -- ex: "Desafio de Quinta: convide um amigo"
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE daily_challenges IS 'Desafio diário com XP multiplicado para manter engajamento';

-- =====================================================
-- 9. TABELA content_boosts
--    Boosts de conteúdo concedidos algoritmicamente
--    (vincula ao sistema de selos da plataforma)
-- =====================================================
CREATE TABLE content_boosts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id         TEXT REFERENCES posts(id) ON DELETE SET NULL,
    boost_type      TEXT NOT NULL CHECK (boost_type IN (
                        'featured',          -- destaque no feed
                        'trending',          -- trending local
                        'community_pick',    -- curado pela comunidade
                        'platform_highlight' -- destaque da plataforma
                    )),
    boost_factor    NUMERIC DEFAULT 1.5,         -- multiplicador de alcance
    reason          TEXT,
    granted_by      TEXT DEFAULT 'system',       -- 'system', 'admin', ou user_id
    starts_at       TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,                 -- NULL = permanente
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE content_boosts IS 'Boosts algorítmicos de conteúdo — vinculados ao selo de plataforma';

-- Índices
CREATE INDEX idx_content_boosts_user_id ON content_boosts(user_id);
CREATE INDEX idx_content_boosts_post_id ON content_boosts(post_id);
CREATE INDEX idx_content_boosts_active ON content_boosts(is_active, expires_at);

-- =====================================================
-- 10. FUNÇÕES RPC (lógica transacional no banco)
-- =====================================================

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_gamification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_gamification_updated_at
    BEFORE UPDATE ON user_gamification
    FOR EACH ROW EXECUTE FUNCTION update_gamification_updated_at();

CREATE TRIGGER trg_user_tasks_updated_at
    BEFORE UPDATE ON user_tasks
    FOR EACH ROW EXECUTE FUNCTION update_gamification_updated_at();

-- RPC: Inicializar gamificação de novo usuário
CREATE OR REPLACE FUNCTION init_user_gamification(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO user_gamification (user_id, total_xp, current_level, elo_coins)
    VALUES (p_user_id, 0, 1, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Concede o selo de boas-vindas
    INSERT INTO user_selos (user_id, selo_id, granted_by, grant_reason)
    SELECT p_user_id, id, 'system', 'Primeiro acesso à ElosCloud'
    FROM selos WHERE slug = 'welcome'
    ON CONFLICT (user_id, selo_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Conceder XP e EloCoins atomicamente
CREATE OR REPLACE FUNCTION grant_xp(
    p_user_id    TEXT,
    p_xp         INTEGER,
    p_coins      INTEGER DEFAULT 0,
    p_source     TEXT DEFAULT 'task',
    p_source_id  TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
    new_xp      INTEGER,
    new_level   INTEGER,
    leveled_up  BOOLEAN,
    new_coins   INTEGER
) AS $$
DECLARE
    v_old_level     INTEGER;
    v_new_level     INTEGER;
    v_new_xp        INTEGER;
    v_new_coins     INTEGER;
    v_leveled_up    BOOLEAN := FALSE;
BEGIN
    -- Garante que o registro existe
    INSERT INTO user_gamification (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    -- Atualiza XP e coins
    UPDATE user_gamification
    SET
        total_xp  = total_xp + p_xp,
        elo_coins = elo_coins + p_coins
    WHERE user_id = p_user_id
    RETURNING
        current_level,
        total_xp,
        elo_coins
    INTO v_old_level, v_new_xp, v_new_coins;

    -- Calcula novo nível
    SELECT COALESCE(MAX(level_num), 1)
    INTO v_new_level
    FROM gamification_levels
    WHERE xp_required <= v_new_xp;

    -- Atualiza nível se subiu
    IF v_new_level > v_old_level THEN
        v_leveled_up := TRUE;
        UPDATE user_gamification
        SET current_level = v_new_level
        WHERE user_id = p_user_id;
    END IF;

    -- Registra o evento de XP
    INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, source_id, description)
    VALUES (p_user_id, p_xp, p_coins, p_source, p_source_id, p_description);

    RETURN QUERY SELECT v_new_xp, v_new_level, v_leveled_up, v_new_coins;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Completar uma tarefa
CREATE OR REPLACE FUNCTION complete_task(
    p_user_id   TEXT,
    p_task_slug TEXT
)
RETURNS TABLE (
    success         BOOLEAN,
    message         TEXT,
    xp_granted      INTEGER,
    coins_granted   INTEGER,
    leveled_up      BOOLEAN,
    new_level       INTEGER
) AS $$
DECLARE
    v_task          gamification_tasks%ROWTYPE;
    v_user_task     user_tasks%ROWTYPE;
    v_result        RECORD;
    v_can_complete  BOOLEAN := TRUE;
    v_msg           TEXT := 'ok';
BEGIN
    -- Busca a tarefa
    SELECT * INTO v_task FROM gamification_tasks WHERE slug = p_task_slug AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Tarefa não encontrada ou inativa', 0, 0, FALSE, 0;
        RETURN;
    END IF;

    -- Busca ou cria o progresso do usuário nesta tarefa
    INSERT INTO user_tasks (user_id, task_id, status, progress, completions)
    VALUES (p_user_id, v_task.id, 'available', 0, 0)
    ON CONFLICT (user_id, task_id) DO NOTHING;

    SELECT * INTO v_user_task FROM user_tasks
    WHERE user_id = p_user_id AND task_id = v_task.id;

    -- Validações
    IF v_task.is_repeatable = FALSE AND v_user_task.completions >= 1 THEN
        RETURN QUERY SELECT FALSE, 'Tarefa já concluída', 0, 0, FALSE, 0;
        RETURN;
    END IF;

    IF v_task.max_completions IS NOT NULL AND v_user_task.completions >= v_task.max_completions THEN
        RETURN QUERY SELECT FALSE, 'Limite de completions atingido', 0, 0, FALSE, 0;
        RETURN;
    END IF;

    IF v_task.is_repeatable AND v_task.repeat_interval_days IS NOT NULL
       AND v_user_task.last_completed_at IS NOT NULL
       AND v_user_task.last_completed_at > NOW() - (v_task.repeat_interval_days || ' days')::INTERVAL THEN
        RETURN QUERY SELECT FALSE, 'Aguarde o cooldown para repetir', 0, 0, FALSE, 0;
        RETURN;
    END IF;

    -- Marca como completa e concede XP
    UPDATE user_tasks
    SET
        status            = 'completed',
        progress          = v_task.target_count,
        completions       = completions + 1,
        last_completed_at = NOW(),
        xp_granted_total  = xp_granted_total + v_task.xp_reward,
        coins_granted_total = coins_granted_total + v_task.coin_reward
    WHERE user_id = p_user_id AND task_id = v_task.id;

    UPDATE user_gamification
    SET tasks_completed = tasks_completed + 1
    WHERE user_id = p_user_id;

    -- Concede XP e coins
    SELECT * INTO v_result FROM grant_xp(
        p_user_id, v_task.xp_reward, v_task.coin_reward,
        'task', v_task.id::TEXT, 'Tarefa: ' || v_task.name
    );

    RETURN QUERY SELECT TRUE, 'Tarefa concluída com sucesso!',
        v_task.xp_reward, v_task.coin_reward,
        v_result.leveled_up, v_result.new_level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Conceder um selo
CREATE OR REPLACE FUNCTION grant_selo(
    p_user_id    TEXT,
    p_selo_slug  TEXT,
    p_granted_by TEXT DEFAULT 'system',
    p_reason     TEXT DEFAULT NULL
)
RETURNS TABLE (
    success     BOOLEAN,
    message     TEXT,
    xp_bonus    INTEGER,
    coin_bonus  INTEGER
) AS $$
DECLARE
    v_selo  selos%ROWTYPE;
BEGIN
    SELECT * INTO v_selo FROM selos WHERE slug = p_selo_slug AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Selo não encontrado', 0, 0;
        RETURN;
    END IF;

    INSERT INTO user_selos (user_id, selo_id, granted_by, grant_reason)
    VALUES (p_user_id, v_selo.id, p_granted_by, p_reason)
    ON CONFLICT (user_id, selo_id) DO NOTHING;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Usuário já possui este selo', 0, 0;
        RETURN;
    END IF;

    -- Bônus de XP pelo selo
    IF v_selo.xp_bonus > 0 OR v_selo.coin_bonus > 0 THEN
        PERFORM grant_xp(p_user_id, v_selo.xp_bonus, v_selo.coin_bonus,
                         'selo', v_selo.id::TEXT, 'Selo conquistado: ' || v_selo.name);
    END IF;

    UPDATE user_gamification
    SET selos_earned = selos_earned + 1
    WHERE user_id = p_user_id;

    RETURN QUERY SELECT TRUE, 'Selo concedido!', v_selo.xp_bonus, v_selo.coin_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Atualizar streak diário
CREATE OR REPLACE FUNCTION update_daily_streak(p_user_id TEXT)
RETURNS TABLE (
    streak_days     INTEGER,
    longest_streak  INTEGER,
    streak_broken   BOOLEAN,
    bonus_xp        INTEGER
) AS $$
DECLARE
    v_last_date     DATE;
    v_today         DATE := CURRENT_DATE;
    v_streak        INTEGER;
    v_longest       INTEGER;
    v_bonus         INTEGER := 0;
    v_broken        BOOLEAN := FALSE;
BEGIN
    INSERT INTO user_gamification (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT last_activity_date, streak_days, longest_streak
    INTO v_last_date, v_streak, v_longest
    FROM user_gamification WHERE user_id = p_user_id;

    IF v_last_date = v_today THEN
        -- Já acessou hoje, sem mudança
        RETURN QUERY SELECT v_streak, v_longest, FALSE, 0;
        RETURN;
    END IF;

    IF v_last_date = v_today - 1 THEN
        -- Dia consecutivo
        v_streak := v_streak + 1;
        IF v_streak > v_longest THEN v_longest := v_streak; END IF;

        -- Bônus por marcos de streak
        IF v_streak IN (7, 30, 100) THEN
            v_bonus := CASE v_streak
                WHEN 7   THEN 50
                WHEN 30  THEN 200
                WHEN 100 THEN 500
            END;
        ELSE
            v_bonus := 5; -- pequeno bônus diário
        END IF;
    ELSE
        -- Streak quebrado
        v_broken := TRUE;
        v_streak := 1;
        v_bonus := 5; -- bônus de retorno
    END IF;

    UPDATE user_gamification
    SET
        streak_days        = v_streak,
        longest_streak     = v_longest,
        last_activity_date = v_today
    WHERE user_id = p_user_id;

    -- Concede bônus de XP pelo streak
    IF v_bonus > 0 THEN
        PERFORM grant_xp(p_user_id, v_bonus, 0, 'streak_bonus', NULL,
                         'Streak de ' || v_streak || ' dias');
    END IF;

    RETURN QUERY SELECT v_streak, v_longest, v_broken, v_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 11. VIEWS (consultas comuns pré-construídas)
-- =====================================================

-- View: estado completo de gamificação de um usuário
CREATE OR REPLACE VIEW v_user_gamification AS
SELECT
    ug.user_id,
    u.full_name,
    u.avatar_url,
    ug.total_xp,
    ug.current_level,
    gl.name AS level_name,
    gl.color_hex AS level_color,
    gl.icon_url AS level_icon,
    gl.perks AS level_perks,
    COALESCE(
        (SELECT xp_required FROM gamification_levels
         WHERE level_num = ug.current_level + 1), 99999
    ) AS xp_next_level,
    ug.elo_coins,
    ug.streak_days,
    ug.longest_streak,
    ug.tasks_completed,
    ug.selos_earned,
    ug.last_activity_date,
    ug.created_at
FROM user_gamification ug
JOIN users u ON u.id = ug.user_id
JOIN gamification_levels gl ON gl.level_num = ug.current_level;

-- View: leaderboard global (top 100 por XP)
CREATE OR REPLACE VIEW v_leaderboard AS
SELECT
    ROW_NUMBER() OVER (ORDER BY ug.total_xp DESC) AS rank,
    ug.user_id,
    u.full_name,
    u.avatar_url,
    ug.total_xp,
    ug.current_level,
    gl.name AS level_name,
    gl.color_hex,
    ug.selos_earned,
    ug.streak_days
FROM user_gamification ug
JOIN users u ON u.id = ug.user_id
JOIN gamification_levels gl ON gl.level_num = ug.current_level
ORDER BY ug.total_xp DESC
LIMIT 100;

-- =====================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_selos ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE selos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_boosts ENABLE ROW LEVEL SECURITY;

-- Tabelas de catálogo: leitura pública
CREATE POLICY gamification_levels_public_read ON gamification_levels FOR SELECT USING (TRUE);
CREATE POLICY gamification_tasks_public_read ON gamification_tasks FOR SELECT USING (is_active = TRUE);
CREATE POLICY selos_public_read ON selos FOR SELECT USING (is_active = TRUE);
CREATE POLICY daily_challenges_public_read ON daily_challenges FOR SELECT USING (TRUE);

-- Dados do usuário: apenas o próprio dono lê
CREATE POLICY user_gamification_select_self ON user_gamification
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY user_tasks_select_self ON user_tasks
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY user_selos_select_self ON user_selos
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY xp_events_select_self ON xp_events
    FOR SELECT USING (auth.uid()::text = user_id);

-- Selos podem ser vistos no perfil público (se o usuário permitir)
CREATE POLICY user_selos_public_profile ON user_selos
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = user_selos.user_id
            -- TODO: adicionar campo perfil_publico quando migrar tabela users completa
        )
    );

-- Admins veem tudo
CREATE POLICY user_gamification_admin ON user_gamification
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()::text AND ur.role_id = 'admin'
        )
    );

-- Content boosts: dono vê seus próprios
CREATE POLICY content_boosts_select_owner ON content_boosts
    FOR SELECT USING (auth.uid()::text = user_id);

-- =====================================================
-- 13. COMENTÁRIOS FINAIS
-- =====================================================
COMMENT ON TABLE gamification_tasks IS 'Catálogo de tarefas e missões — ativadas pelo backend via slug';
COMMENT ON TABLE user_gamification IS 'Estado de gamificação por usuário: XP, nível, streak, EloCoins';
COMMENT ON TABLE xp_events IS 'Log imutável de todos os ganhos de XP (para auditoria e dispute)';
COMMENT ON TABLE selos IS 'Catálogo de selos (badges) — is_platform_grant=true: concedíveis algoritmicamente';
COMMENT ON TABLE content_boosts IS 'Boosts de alcance de conteúdo vinculados ao algoritmo de engajamento';
COMMENT ON FUNCTION grant_xp IS 'Concede XP e EloCoins atomicamente, verifica level-up, registra evento';
COMMENT ON FUNCTION complete_task IS 'Valida e registra conclusão de tarefa, dispara grant_xp internamente';
COMMENT ON FUNCTION grant_selo IS 'Concede um selo ao usuário (com bônus de XP se aplicável)';
COMMENT ON FUNCTION update_daily_streak IS 'Atualiza streak diário, detecta quebra, concede bônus por marcos';
