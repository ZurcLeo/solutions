-- =====================================================
-- MIGRAÇÃO: Mecanismo de Gasto de EloCoins [ELOC-001]
-- Descrição: RPC spend_elo_coins (atômica, anti-negativo),
--            RPC activate_content_boost (spend + boost),
--            expansão dos CHECK constraints de xp_events e content_boosts.
-- Criado por: game-agent / ElosCloud
-- Data: 2026-05-16
-- =====================================================

-- =====================================================
-- 1. EXPANDIR CHECK CONSTRAINT de xp_events.source
--    Adiciona: purchase, boost_purchase, tip, spend
--    (grant_xp já usa os valores antigos via SECURITY DEFINER;
--     novos valores são exclusivos do fluxo de gasto)
-- =====================================================
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_source_check
    CHECK (source IN (
        -- valores originais
        'task', 'selo', 'streak_bonus', 'daily_challenge',
        'level_up_bonus', 'platform_grant', 'admin', 'penalty',
        -- novos: economia EloCoin
        'purchase',        -- compra fiat → coins (ELOC-002)
        'boost_purchase',  -- gasto: boost de conteúdo
        'tip',             -- gasto: gorjeta para outro usuário
        'spend'            -- gasto genérico
    ));

-- =====================================================
-- 2. EXPANDIR content_boosts:
--    a) CHECK constraint de boost_type (adiciona 'user_boost')
--    b) Colunas content_type e content_id para boosts de perfil
-- =====================================================
ALTER TABLE content_boosts DROP CONSTRAINT IF EXISTS content_boosts_boost_type_check;
ALTER TABLE content_boosts ADD CONSTRAINT content_boosts_boost_type_check
    CHECK (boost_type IN (
        'featured',
        'trending',
        'community_pick',
        'platform_highlight',
        'user_boost'       -- novo: boost comprado com EloCoins pelo próprio usuário
    ));

-- Coluna para distinguir boost de post vs. perfil
ALTER TABLE content_boosts
    ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'post'
        CHECK (content_type IN ('post', 'profile'));

-- ID genérico do conteúdo (post_id ou user_id para perfil)
ALTER TABLE content_boosts
    ADD COLUMN IF NOT EXISTS content_id TEXT;

COMMENT ON COLUMN content_boosts.content_type IS 'Tipo do conteúdo impulsionado: post ou profile';
COMMENT ON COLUMN content_boosts.content_id IS 'ID do post ou user_id do perfil impulsionado';

-- =====================================================
-- 3. RPC spend_elo_coins
--    Transação atômica com FOR UPDATE para prevenir
--    race condition (saldo negativo impossível).
--    Suporta transferência (gorjeta) quando
--    p_target_user_id é fornecido.
-- =====================================================
CREATE OR REPLACE FUNCTION spend_elo_coins(
    p_user_id        TEXT,
    p_amount         INTEGER,
    p_source         TEXT,
    p_target_user_id TEXT    DEFAULT NULL,
    p_metadata       JSONB   DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance  INTEGER;
    v_new_balance      INTEGER;
    v_event_id         UUID;
    v_target_event_id  UUID;
BEGIN
    -- Valida amount
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a gastar deve ser maior que zero'
            USING ERRCODE = 'P0003';
    END IF;

    -- Valida source
    IF p_source NOT IN ('boost_purchase', 'tip', 'spend', 'purchase') THEN
        RAISE EXCEPTION 'source inválido: %', p_source
            USING ERRCODE = 'P0004';
    END IF;

    -- Lock na linha do remetente (previne race condition)
    SELECT elo_coins
    INTO v_current_balance
    FROM user_gamification
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuário % não encontrado no sistema de gamificação', p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Verificação de saldo suficiente
    IF v_current_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente: você tem % EloCoins, mas tentou gastar %.',
            v_current_balance, p_amount
            USING ERRCODE = 'P0001';
    END IF;

    -- Debita o remetente
    UPDATE user_gamification
    SET
        elo_coins  = elo_coins - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING elo_coins INTO v_new_balance;

    -- Registra evento de débito
    INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description)
    VALUES (
        p_user_id,
        0,
        -p_amount,
        p_source,
        COALESCE(
            p_metadata->>'description',
            'Gasto de EloCoins: ' || p_source
        )
    )
    RETURNING id INTO v_event_id;

    -- Se há usuário destino (gorjeta / presente): credita
    IF p_target_user_id IS NOT NULL THEN

        -- Garante que o destinatário tem registro de gamificação
        INSERT INTO user_gamification (user_id)
        VALUES (p_target_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        -- Credita o destinatário
        UPDATE user_gamification
        SET
            elo_coins  = elo_coins + p_amount,
            updated_at = NOW()
        WHERE user_id = p_target_user_id;

        -- Registra evento de crédito no destinatário
        INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description)
        VALUES (
            p_target_user_id,
            0,
            p_amount,
            p_source,
            COALESCE(
                p_metadata->>'target_description',
                'EloCoins recebidos via ' || p_source
            )
        )
        RETURNING id INTO v_target_event_id;
    END IF;

    RETURN jsonb_build_object(
        'new_balance',          v_new_balance,
        'amount_spent',         p_amount,
        'transaction_id',       v_event_id,
        'target_transaction_id', v_target_event_id,
        'source',               p_source
    );
END;
$$;

COMMENT ON FUNCTION spend_elo_coins IS
    'Debita EloCoins atomicamente. Usa FOR UPDATE para prevenir race condition. '
    'Suporta transferência (gorjeta) via p_target_user_id. '
    'Lança exceção P0001 se saldo insuficiente (nunca saldo negativo).';

-- =====================================================
-- 4. RPC activate_content_boost
--    Gasta EloCoins E ativa o boost atomicamente.
--    Se spend_elo_coins falhar (ex: saldo insuficiente),
--    o boost NÃO é inserido (rollback automático).
-- =====================================================
CREATE OR REPLACE FUNCTION activate_content_boost(
    p_user_id        TEXT,
    p_content_type   TEXT,     -- 'post' | 'profile'
    p_content_id     TEXT,
    p_duration_hours INTEGER,
    p_cost           INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_spend_result JSONB;
    v_boost_id     UUID;
    v_expires_at   TIMESTAMPTZ;
BEGIN
    -- Valida content_type
    IF p_content_type NOT IN ('post', 'profile') THEN
        RAISE EXCEPTION 'content_type inválido: %. Use post ou profile', p_content_type
            USING ERRCODE = 'P0005';
    END IF;

    -- Valida duração (1h a 168h = 7 dias)
    IF p_duration_hours < 1 OR p_duration_hours > 168 THEN
        RAISE EXCEPTION 'duration_hours deve estar entre 1 e 168 horas'
            USING ERRCODE = 'P0006';
    END IF;

    -- Gasta os coins (lança exceção se saldo insuficiente → rollback automático)
    v_spend_result := spend_elo_coins(
        p_user_id,
        p_cost,
        'boost_purchase',
        NULL,
        jsonb_build_object(
            'description',        'Boost de ' || p_content_type || ' comprado',
            'content_type',       p_content_type,
            'content_id',         p_content_id,
            'duration_hours',     p_duration_hours
        )
    );

    v_expires_at := NOW() + (p_duration_hours || ' hours')::INTERVAL;

    -- Insere o boost somente após gasto bem-sucedido
    INSERT INTO content_boosts (
        user_id,
        post_id,
        content_type,
        content_id,
        boost_type,
        boost_factor,
        reason,
        granted_by,
        starts_at,
        expires_at,
        is_active
    )
    VALUES (
        p_user_id,
        CASE WHEN p_content_type = 'post' THEN p_content_id ELSE NULL END,
        p_content_type,
        p_content_id,
        'user_boost',
        1.5,
        'Boost comprado com EloCoins (' || p_duration_hours || 'h)',
        p_user_id,
        NOW(),
        v_expires_at,
        TRUE
    )
    RETURNING id INTO v_boost_id;

    RETURN jsonb_build_object(
        'success',          TRUE,
        'boost_id',         v_boost_id,
        'content_type',     p_content_type,
        'content_id',       p_content_id,
        'expires_at',       v_expires_at,
        'new_balance',      (v_spend_result->>'new_balance')::INTEGER,
        'transaction_id',   v_spend_result->>'transaction_id'
    );
END;
$$;

COMMENT ON FUNCTION activate_content_boost IS
    'Gasta EloCoins e ativa boost de conteúdo atomicamente. '
    'Se o gasto falhar (saldo insuficiente), o boost não é criado. '
    'Suporta boost de post (post_id preenchido) e de perfil (post_id NULL).';
