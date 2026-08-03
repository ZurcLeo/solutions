-- =====================================================
-- MIGRAÇÃO: Idempotência nativa na RPC spend_elo_coins [BARTER-RPC-001]
-- Descrição: Adiciona p_idempotency_key à função spend_elo_coins
--            e coluna idempotency_key em xp_events para verificação atômica.
-- Agente: infra-agent / ElosCloud
-- Data: 2026-05-25
-- =====================================================

-- =====================================================
-- 1. Adicionar coluna idempotency_key em xp_events
--    Usada pela RPC para checar duplicatas antes de debitar.
--    Índice parcial UNIQUE (somente quando NOT NULL).
-- =====================================================
ALTER TABLE xp_events
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS xp_events_idempotency_key_idx
    ON xp_events (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN xp_events.idempotency_key IS
    'Chave de idempotência para débitos de EloCoins. '
    'Garante que a mesma operação não seja processada mais de uma vez.';

-- =====================================================
-- 2. Substituir spend_elo_coins com suporte a p_idempotency_key
--    Lógica de idempotência:
--      - Se p_idempotency_key IS NOT NULL e já existe em xp_events
--        → retorna sucesso sem debitar (campo idempotent=true no retorno)
--      - Se p_idempotency_key IS NOT NULL e é nova
--        → procede com o débito e armazena a chave no INSERT de xp_events
--      - Se p_idempotency_key IS NULL (default)
--        → comportamento original, sem verificação de idempotência
-- =====================================================
CREATE OR REPLACE FUNCTION spend_elo_coins(
    p_user_id          TEXT,
    p_amount           INTEGER,
    p_source           TEXT,
    p_target_user_id   TEXT    DEFAULT NULL,
    p_metadata         JSONB   DEFAULT '{}',
    p_idempotency_key  TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance   INTEGER;
    v_new_balance       INTEGER;
    v_event_id          UUID;
    v_target_event_id   UUID;
    v_existing_event_id UUID;
BEGIN
    -- -------------------------------------------------------
    -- VERIFICAÇÃO DE IDEMPOTÊNCIA (antes de qualquer lock)
    -- -------------------------------------------------------
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id
        INTO v_existing_event_id
        FROM xp_events
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            -- Operação já foi processada anteriormente.
            -- Retorna o saldo atual sem debitar novamente.
            SELECT elo_coins
            INTO v_new_balance
            FROM user_gamification
            WHERE user_id = p_user_id;

            RETURN jsonb_build_object(
                'new_balance',           COALESCE(v_new_balance, 0),
                'amount_spent',          p_amount,
                'transaction_id',        v_existing_event_id,
                'target_transaction_id', NULL,
                'source',                p_source,
                'idempotent',            TRUE
            );
        END IF;
    END IF;

    -- -------------------------------------------------------
    -- VALIDAÇÕES
    -- -------------------------------------------------------
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a gastar deve ser maior que zero'
            USING ERRCODE = 'P0003';
    END IF;

    IF p_source NOT IN ('boost_purchase', 'tip', 'spend', 'purchase') THEN
        RAISE EXCEPTION 'source inválido: %', p_source
            USING ERRCODE = 'P0004';
    END IF;

    -- -------------------------------------------------------
    -- LOCK + VERIFICAÇÃO DE SALDO
    -- -------------------------------------------------------
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

    -- -------------------------------------------------------
    -- DÉBITO DO REMETENTE
    -- -------------------------------------------------------
    UPDATE user_gamification
    SET
        elo_coins  = elo_coins - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING elo_coins INTO v_new_balance;

    -- Registra evento de débito (armazena idempotency_key se fornecida)
    INSERT INTO xp_events (user_id, xp_delta, coin_delta, source, description, idempotency_key)
    VALUES (
        p_user_id,
        0,
        -p_amount,
        p_source,
        COALESCE(
            p_metadata->>'description',
            'Gasto de EloCoins: ' || p_source
        ),
        p_idempotency_key
    )
    RETURNING id INTO v_event_id;

    -- -------------------------------------------------------
    -- CRÉDITO DO DESTINATÁRIO (gorjeta / presente)
    -- -------------------------------------------------------
    IF p_target_user_id IS NOT NULL THEN

        INSERT INTO user_gamification (user_id)
        VALUES (p_target_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        UPDATE user_gamification
        SET
            elo_coins  = elo_coins + p_amount,
            updated_at = NOW()
        WHERE user_id = p_target_user_id;

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

    -- -------------------------------------------------------
    -- RETORNO
    -- -------------------------------------------------------
    RETURN jsonb_build_object(
        'new_balance',           v_new_balance,
        'amount_spent',          p_amount,
        'transaction_id',        v_event_id,
        'target_transaction_id', v_target_event_id,
        'source',                p_source,
        'idempotent',            FALSE
    );
END;
$$;

-- Remove a sobrecarga antiga (5 parâmetros) para evitar ambiguidade
DROP FUNCTION IF EXISTS spend_elo_coins(TEXT, INTEGER, TEXT, TEXT, JSONB);

COMMENT ON FUNCTION spend_elo_coins(TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT) IS
    'Debita EloCoins atomicamente. Usa FOR UPDATE para prevenir race condition. '
    'Suporta idempotência via p_idempotency_key (verifica xp_events antes de debitar). '
    'Suporta transferência (gorjeta) via p_target_user_id. '
    'Lança exceção P0001 se saldo insuficiente (nunca saldo negativo). '
    'Retorno inclui campo idempotent=true quando operação já foi processada anteriormente.';
