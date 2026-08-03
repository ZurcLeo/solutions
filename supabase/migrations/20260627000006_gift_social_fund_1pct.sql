-- ELOCOIN-FUND-001: 1% fundo social em gifts
-- O sender paga sticker_price + 1% (arredondado para cima, mínimo 1 ECC).
-- O receiver recebe sticker_price integral.
-- O 1% é registrado como burn (deflação → fundo social).

CREATE OR REPLACE FUNCTION send_sticker_gift(
    p_sender_id       TEXT,
    p_receiver_id     TEXT,
    p_sticker_id      UUID,
    p_post_id         TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_message         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_sticker         sticker_catalog%ROWTYPE;
    v_spend_result    JSONB;
    v_gift_id         TEXT;
    v_sticker_count   INTEGER;
    v_user_count      INTEGER;
    v_existing_gift   JSONB;
    v_safe_message    TEXT;
    v_social_fund_fee INTEGER;
BEGIN
    -- -----------------------------------------------
    -- 1. IDEMPOTÊNCIA: retorna imediatamente se key já foi processada
    -- -----------------------------------------------
    IF p_idempotency_key IS NOT NULL THEN
        SELECT jsonb_build_object(
            'gift_id',            id,
            'sticker_id',         sticker_id,
            'sticker_name',       tipo,
            'amount_spent',       valor,
            'sender_new_balance', NULL,
            'receiver_user_id',   to_user_id,
            'idempotent',         true
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
    -- 5. CALCULAR taxa fundo social (1%, mínimo 1 ECC)
    -- -----------------------------------------------
    v_social_fund_fee := GREATEST(CEIL(v_sticker.eloscoin_price * 0.01), 1);

    -- -----------------------------------------------
    -- 6. DEBITAR sender + CREDITAR receiver (atômico)
    --    Sender paga: sticker_price + 1% fundo social
    --    Receiver recebe: sticker_price integral
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
        ),
        v_social_fund_fee  -- p_burn_amount → contribuição fundo social
    );

    -- -----------------------------------------------
    -- 7. INSERIR gift record — inclui message (trunca se > 100)
    -- -----------------------------------------------
    v_gift_id      := gen_random_uuid()::text;
    v_safe_message := CASE
        WHEN p_message IS NULL            THEN NULL
        WHEN char_length(p_message) > 100 THEN LEFT(p_message, 100)
        ELSE p_message
    END;

    INSERT INTO gifts (
        id,
        post_id,
        from_user_id,
        to_user_id,
        tipo,
        valor,
        sticker_id,
        idempotency_key,
        status,
        message
    ) VALUES (
        v_gift_id,
        p_post_id,
        p_sender_id,
        p_receiver_id,
        'sticker',
        v_sticker.eloscoin_price,
        p_sticker_id,
        p_idempotency_key,
        'completed',
        v_safe_message
    );

    -- -----------------------------------------------
    -- 8. INSERIR no mural do receiver (user_stickers)
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
    -- 9. RETORNAR resultado
    -- -----------------------------------------------
    RETURN jsonb_build_object(
        'gift_id',            v_gift_id,
        'sticker_id',         p_sticker_id,
        'sticker_name',       v_sticker.name,
        'sticker_image_url',  v_sticker.image_url,
        'amount_spent',       v_sticker.eloscoin_price,
        'social_fund_fee',    v_social_fund_fee,
        'total_cost',         v_sticker.eloscoin_price + v_social_fund_fee,
        'sender_new_balance', (v_spend_result->>'new_balance')::INTEGER,
        'receiver_user_id',   p_receiver_id,
        'message',            v_safe_message,
        'idempotent',         false
    );
END;
$$;

-- Atualizar descrição do burn em spend_elo_coins para refletir fundo social
COMMENT ON FUNCTION send_sticker_gift(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) IS
    'Envia um sticker como gift de forma 100% atômica. '
    'Passos: idempotência → validação do sticker (ativo/expirado/esgotado/limite por user) '
    '→ debit/credit via spend_elo_coins (FOR UPDATE) com 1% fundo social → insert gifts + user_stickers. '
    'Sender paga: sticker_price + 1% (mín 1 ECC) de contribuição ao fundo social. '
    'Receiver recebe: sticker_price integral. '
    'Qualquer falha reverte toda a transação. '
    'Parâmetro p_message armazena mensagem opcional (máx 100 chars, trunca silenciosamente). '
    'Erros: P0001=saldo insuficiente, P0010=sticker inativo, P0011=expirado, '
    'P0012=esgotado, P0013=limite por usuário.';
