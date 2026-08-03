-- =====================================================
-- MIGRAÇÃO: RPC send_sticker_gift — Gift Flow Atômico (ElosCloud)
-- Descrição: Adiciona 'gift' como source válido em xp_events e
--            spend_elo_coins; cria RPC atômica para envio de sticker.
-- Data: 2026-05-20
-- Sprint: 2 — Épico 2
-- =====================================================

-- =====================================================
-- 1. EXPANDIR xp_events.source constraint para incluir 'gift'
-- =====================================================
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_source_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_source_check
    CHECK (source IN (
        -- valores originais
        'task', 'selo', 'streak_bonus', 'daily_challenge',
        'level_up_bonus', 'platform_grant', 'admin', 'penalty',
        -- economia EloCoin
        'purchase', 'boost_purchase', 'tip', 'spend',
        -- gift flow (stickers)
        'gift'
    ));

-- =====================================================
-- 2. ATUALIZAR spend_elo_coins para aceitar 'gift' como source
--    (a função original não aceitava 'gift' na validação interna)
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
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a gastar deve ser maior que zero'
            USING ERRCODE = 'P0003';
    END IF;

    IF p_source NOT IN ('boost_purchase', 'tip', 'spend', 'purchase', 'gift') THEN
        RAISE EXCEPTION 'source inválido: %', p_source
            USING ERRCODE = 'P0004';
    END IF;

    SELECT elo_coins
    INTO v_current_balance
    FROM user_gamification
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuário % não encontrado no sistema de gamificação', p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_current_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente: você tem % EloCoins, mas tentou gastar %.',
            v_current_balance, p_amount
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE user_gamification
    SET elo_coins  = elo_coins - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING elo_coins INTO v_new_balance;

    INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description)
    VALUES (
        p_user_id,
        0,
        -p_amount,
        p_source,
        COALESCE(p_metadata->>'description', 'Gasto de EloCoins: ' || p_source)
    )
    RETURNING id INTO v_event_id;

    IF p_target_user_id IS NOT NULL THEN
        INSERT INTO user_gamification (user_id)
        VALUES (p_target_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        UPDATE user_gamification
        SET elo_coins  = elo_coins + p_amount,
            updated_at = NOW()
        WHERE user_id = p_target_user_id;

        INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description)
        VALUES (
            p_target_user_id,
            0,
            p_amount,
            p_source,
            COALESCE(p_metadata->>'target_description', 'EloCoins recebidos via ' || p_source)
        )
        RETURNING id INTO v_target_event_id;
    END IF;

    RETURN jsonb_build_object(
        'new_balance',           v_new_balance,
        'amount_spent',          p_amount,
        'transaction_id',        v_event_id,
        'target_transaction_id', v_target_event_id,
        'source',                p_source
    );
END;
$$;

COMMENT ON FUNCTION spend_elo_coins IS
    'Debita EloCoins atomicamente (FOR UPDATE). Suporta transferência via p_target_user_id. '
    'Sources válidos: boost_purchase, tip, spend, purchase, gift. '
    'Lança P0001 se saldo insuficiente (nunca saldo negativo).';

-- =====================================================
-- 3. RPC send_sticker_gift — transação atômica completa
--
--    Passos (todos em um único transaction block implícito):
--    1. Idempotência: retorna gift existente se key já usada
--    2. Valida sticker (ativo, expiração, max_quantity, per_user_limit)
--    3. Debita sender + credita receiver via spend_elo_coins
--    4. Insere gift record
--    5. Insere user_sticker no mural do receiver
-- =====================================================
CREATE OR REPLACE FUNCTION send_sticker_gift(
    p_sender_id       TEXT,
    p_receiver_id     TEXT,
    p_sticker_id      UUID,
    p_post_id         TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sticker         sticker_catalog%ROWTYPE;
    v_spend_result    JSONB;
    v_gift_id         TEXT;
    v_sticker_count   INTEGER;
    v_user_count      INTEGER;
    v_existing_gift   JSONB;
BEGIN
    -- -----------------------------------------------
    -- 1. IDEMPOTÊNCIA: retorna imediatamente se key já foi processada
    -- -----------------------------------------------
    IF p_idempotency_key IS NOT NULL THEN
        SELECT jsonb_build_object(
            'gift_id',          id,
            'sticker_id',       sticker_id,
            'sticker_name',     tipo,
            'amount_spent',     valor,
            'sender_new_balance', NULL,
            'receiver_user_id', to_user_id,
            'idempotent',       true
        )
        INTO v_existing_gift
        FROM gifts
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF v_existing_gift IS NOT NULL THEN
            RETURN v_existing_gift;
        END IF;
    END IF;

    -- -----------------------------------------------
    -- 2. VALIDAR STICKER (ativo + não expirado)
    -- -----------------------------------------------
    SELECT * INTO v_sticker
    FROM sticker_catalog
    WHERE id = p_sticker_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sticker não encontrado ou inativo'
            USING ERRCODE = 'P0010';
    END IF;

    IF v_sticker.available_until IS NOT NULL AND v_sticker.available_until < NOW() THEN
        RAISE EXCEPTION 'Sticker fora do período de venda (expirou em %)', v_sticker.available_until
            USING ERRCODE = 'P0011';
    END IF;

    -- -----------------------------------------------
    -- 3. VERIFICAR max_quantity (limite global de emissão)
    -- -----------------------------------------------
    IF v_sticker.max_quantity IS NOT NULL THEN
        SELECT COUNT(*) INTO v_sticker_count
        FROM user_stickers
        WHERE sticker_id = p_sticker_id;

        IF v_sticker_count >= v_sticker.max_quantity THEN
            RAISE EXCEPTION 'Sticker esgotado (emissão máxima de % unidades atingida)', v_sticker.max_quantity
                USING ERRCODE = 'P0012';
        END IF;
    END IF;

    -- -----------------------------------------------
    -- 4. VERIFICAR per_user_limit (limite por destinatário)
    -- -----------------------------------------------
    IF v_sticker.per_user_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_user_count
        FROM user_stickers
        WHERE sticker_id = p_sticker_id
          AND owner_user_id = p_receiver_id;

        IF v_user_count >= v_sticker.per_user_limit THEN
            RAISE EXCEPTION 'Usuário já atingiu o limite deste sticker (máx %)', v_sticker.per_user_limit
                USING ERRCODE = 'P0013';
        END IF;
    END IF;

    -- -----------------------------------------------
    -- 5. DEBITAR sender + CREDITAR receiver (atômico)
    --    Se falhar (saldo insuficiente, user não encontrado),
    --    a exceção propaga e toda a função reverte.
    -- -----------------------------------------------
    v_spend_result := spend_elo_coins(
        p_sender_id,
        v_sticker.eloscoin_price,
        'gift',
        p_receiver_id,
        jsonb_build_object(
            'description',        'Gift: ' || v_sticker.name,
            'target_description', 'Sticker recebido: ' || v_sticker.name,
            'sticker_id',         p_sticker_id
        )
    );

    -- -----------------------------------------------
    -- 6. INSERIR gift record
    --    Mantém campos legados (tipo, valor) para compatibilidade
    --    com Gift.getByPostId() que ainda lê o schema antigo.
    -- -----------------------------------------------
    v_gift_id := gen_random_uuid()::text;

    INSERT INTO gifts (
        id,
        post_id,
        from_user_id,
        to_user_id,
        tipo,
        valor,
        sticker_id,
        idempotency_key,
        status
    ) VALUES (
        v_gift_id,
        p_post_id,
        p_sender_id,
        p_receiver_id,
        'sticker',                      -- tipo legado = 'sticker'
        v_sticker.eloscoin_price,       -- valor legado = preço em EloCoins
        p_sticker_id,
        p_idempotency_key,
        'completed'
    );

    -- -----------------------------------------------
    -- 7. INSERIR no mural do receiver (user_stickers)
    -- -----------------------------------------------
    INSERT INTO user_stickers (
        owner_user_id,
        sticker_id,
        from_user_id,
        post_id
    ) VALUES (
        p_receiver_id,
        p_sticker_id,
        p_sender_id,
        p_post_id
    );

    -- -----------------------------------------------
    -- 8. RETORNAR resultado
    -- -----------------------------------------------
    RETURN jsonb_build_object(
        'gift_id',           v_gift_id,
        'sticker_id',        p_sticker_id,
        'sticker_name',      v_sticker.name,
        'amount_spent',      v_sticker.eloscoin_price,
        'sender_new_balance', (v_spend_result->>'new_balance')::INTEGER,
        'receiver_user_id',  p_receiver_id,
        'idempotent',        false
    );
END;
$$;

COMMENT ON FUNCTION send_sticker_gift IS
    'Envia um sticker como gift de forma 100% atômica. '
    'Passos: idempotência → validação do sticker (ativo/expirado/esgotado/limite por user) '
    '→ debit/credit via spend_elo_coins (FOR UPDATE) → insert gifts + user_stickers. '
    'Qualquer falha reverte toda a transação. '
    'Erros: P0001=saldo insuficiente, P0010=sticker inativo, P0011=expirado, '
    'P0012=esgotado, P0013=limite por usuário.';
