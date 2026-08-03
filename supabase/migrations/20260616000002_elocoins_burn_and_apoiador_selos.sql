-- =====================================================
-- MIGRAÇÃO: Burn 5% em tips + Selos Apoiador
-- Épico: ELOCOIN-004, ELOCOIN-005
-- =====================================================

-- =====================================================
-- 1. Adicionar 'burn' ao CHECK constraint de xp_events.source
-- =====================================================
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_source_check
    CHECK (source IN (
        'task', 'selo', 'streak_bonus', 'daily_challenge',
        'level_up_bonus', 'platform_grant', 'admin', 'penalty',
        'purchase', 'boost_purchase', 'tip', 'spend',
        'gift',  -- sticker gifts (já existente)
        'burn'   -- ELOCOIN-004: combustão deflacionária
    ));

-- =====================================================
-- 2. Atualizar RPC spend_elo_coins com suporte a burn
--    p_burn_amount DEFAULT 0 = sem burn (backwards compatible)
--    Quando > 0: sender perde (amount + burn), receiver ganha (amount)
--    Burn registrado como evento separado com source='burn'
-- =====================================================
CREATE OR REPLACE FUNCTION spend_elo_coins(
    p_user_id        TEXT,
    p_amount         INTEGER,
    p_source         TEXT,
    p_target_user_id TEXT    DEFAULT NULL,
    p_metadata       JSONB   DEFAULT '{}',
    p_burn_amount    INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance  INTEGER;
    v_total_debit      INTEGER;
    v_new_balance      INTEGER;
    v_event_id         UUID;
    v_target_event_id  UUID;
    v_burn_event_id    UUID;
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

    -- Valida burn
    IF p_burn_amount < 0 THEN
        RAISE EXCEPTION 'burn_amount não pode ser negativo'
            USING ERRCODE = 'P0005';
    END IF;

    v_total_debit := p_amount + p_burn_amount;

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

    -- Verificação de saldo suficiente (amount + burn)
    IF v_current_balance < v_total_debit THEN
        RAISE EXCEPTION 'Saldo insuficiente: você tem % EloCoins, mas precisa de % (% + % de burn).',
            v_current_balance, v_total_debit, p_amount, p_burn_amount
            USING ERRCODE = 'P0001';
    END IF;

    -- Debita o remetente (amount + burn)
    UPDATE user_gamification
    SET
        elo_coins  = elo_coins - v_total_debit,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING elo_coins INTO v_new_balance;

    -- Registra evento de débito (apenas o amount, sem o burn)
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

    -- Registra evento de burn separado (se houver)
    IF p_burn_amount > 0 THEN
        INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description)
        VALUES (
            p_user_id,
            0,
            -p_burn_amount,
            'burn',
            'Combustão deflacionária (' || p_burn_amount || ' EloCoins)'
        )
        RETURNING id INTO v_burn_event_id;
    END IF;

    -- Se há usuário destino (gorjeta / presente): credita
    IF p_target_user_id IS NOT NULL THEN

        -- Garante que o destinatário tem registro de gamificação
        INSERT INTO user_gamification (user_id)
        VALUES (p_target_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        -- Credita o destinatário (apenas p_amount, sem o burn)
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
        'burn_amount',          p_burn_amount,
        'total_debit',          v_total_debit,
        'transaction_id',       v_event_id,
        'burn_transaction_id',  v_burn_event_id,
        'target_transaction_id', v_target_event_id,
        'source',               p_source
    );
END;
$$;

-- =====================================================
-- 3. Selos Apoiador — ELOCOIN-005
-- =====================================================

-- Selo: Apoiador da Comunidade (1ª compra de EloCoins)
INSERT INTO selos (slug, name, description, category, tier, color_hex, is_active, is_platform_grant, grant_criteria, xp_bonus, coin_bonus, sort_order)
VALUES (
    'apoiador_comunidade',
    'Apoiador da Comunidade',
    'Adquiriu EloCoins para apoiar a plataforma',
    'financeiro',
    'ouro',
    '#F5A623',
    true,
    true,
    '{"trigger": "first_elocoin_purchase", "min_purchases": 1}'::jsonb,
    100,
    0,
    50
)
ON CONFLICT (slug) DO NOTHING;

-- Selo: Acelerador de Impacto (3+ compras ou ≥15.000 EC total)
INSERT INTO selos (slug, name, description, category, tier, color_hex, is_active, is_platform_grant, grant_criteria, xp_bonus, coin_bonus, sort_order)
VALUES (
    'acelerador_impacto',
    'Acelerador de Impacto',
    'Apoiador recorrente: 3+ compras ou 15.000+ EloCoins adquiridos',
    'financeiro',
    'diamante',
    '#B388FF',
    true,
    true,
    '{"trigger": "recurring_elocoin_purchase", "min_purchases": 3, "or_min_total_coins": 15000}'::jsonb,
    250,
    0,
    51
)
ON CONFLICT (slug) DO NOTHING;
