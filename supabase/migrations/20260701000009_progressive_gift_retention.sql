-- ELOC-PROG-001: Progressive EloCoins retention in send_sticker_gift
--
-- Replaces the FIXED 5% community fee with a PROGRESSIVE fee based on
-- the sender's gamification level:
--
--   Level 1-2  → 1% retention
--   Level 3-4  → 2% retention
--   Level 5-6  → 3% retention
--   Level 7-8  → 4% retention
--   Level 9-10 → 5% retention
--
-- Rationale: lower-level users (newer) pay less, rewarding early
-- participation and making the fee proportional to engagement depth.
--
-- Social fund: 20% of the community fee (minimum 1 ECC)
-- Deflation burn: remaining 80% of the community fee
-- Minimum total fee: 1 ECC (unchanged)
--
-- Return payload now includes `retention_pct` and `sender_level`
-- for frontend transparency.

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
    v_sticker          sticker_catalog%ROWTYPE;
    v_spend_result     JSONB;
    v_gift_id          TEXT;
    v_sticker_count    INTEGER;
    v_user_count       INTEGER;
    v_existing_gift    JSONB;
    v_safe_message     TEXT;
    v_sender_level     INTEGER;
    v_retention_pct    NUMERIC;    -- progressive retention percentage
    v_community_fee    INTEGER;    -- total fee (social + deflation)
    v_social_fund      INTEGER;    -- 20% of community_fee (min 1 ECC)
    v_burn_amount      INTEGER;    -- 80% of community_fee (deflation)
    v_receiver_amount  INTEGER;    -- remainder for the receiver
    v_social_pct       NUMERIC;    -- actual social % for metadata
    v_burn_pct         NUMERIC;    -- actual burn % for metadata
BEGIN
    -- -----------------------------------------------
    -- 1. IDEMPOTÊNCIA
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
    -- 3. VERIFICAR max_quantity
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
    -- 4. VERIFICAR per_user_limit
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
    -- 5. RESOLVER nível do sender (progressive retention)
    --    Se sem registro de gamificação → default level 1
    -- -----------------------------------------------
    SELECT COALESCE(current_level, 1)
    INTO v_sender_level
    FROM user_gamification
    WHERE user_id = p_sender_id;

    IF NOT FOUND THEN
        v_sender_level := 1;
    END IF;

    -- Clamp para range válido [1-10]
    v_sender_level := GREATEST(1, LEAST(v_sender_level, 10));

    -- -----------------------------------------------
    -- 6. CALCULAR split econômico PROGRESSIVO
    --
    --    Level 1-2  → 1%    Level 5-6  → 3%    Level 9-10 → 5%
    --    Level 3-4  → 2%    Level 7-8  → 4%
    --
    --    Fee mínimo: 1 ECC
    --    Social fund: 20% do fee (min 1 ECC)
    --    Burn: 80% restante do fee
    -- -----------------------------------------------
    v_retention_pct := CASE
        WHEN v_sender_level <= 2 THEN 0.01   -- 1%
        WHEN v_sender_level <= 4 THEN 0.02   -- 2%
        WHEN v_sender_level <= 6 THEN 0.03   -- 3%
        WHEN v_sender_level <= 8 THEN 0.04   -- 4%
        ELSE                          0.05   -- 5%
    END;

    v_community_fee   := GREATEST(CEIL(v_sticker.eloscoin_price * v_retention_pct), 1);
    v_receiver_amount := v_sticker.eloscoin_price - v_community_fee;

    -- Proteção: receiver nunca recebe menos que 0
    IF v_receiver_amount < 0 THEN
        v_receiver_amount := 0;
        v_community_fee   := v_sticker.eloscoin_price;
    END IF;

    -- Split do community fee: 20% social fund / 80% deflation burn
    v_social_fund := GREATEST(CEIL(v_community_fee * 0.20), 1);
    v_burn_amount := v_community_fee - v_social_fund;

    -- Se o fee é muito pequeno, tudo vai pro social fund (mín 1 ECC)
    IF v_burn_amount < 0 THEN
        v_burn_amount := 0;
        v_social_fund := v_community_fee;
    END IF;

    -- Calcular percentuais reais para metadata (arredondados para 1 decimal)
    v_social_pct := ROUND((v_retention_pct * 100) * 0.20, 1);
    v_burn_pct   := ROUND((v_retention_pct * 100) * 0.80, 1);

    -- -----------------------------------------------
    -- 7. DEBITAR sender + CREDITAR receiver (atômico)
    --    p_amount     = v_receiver_amount (credited to receiver)
    --    p_burn_amount = v_community_fee   (removed from economy)
    --    Total debit  = receiver + fee = sticker_price
    -- -----------------------------------------------
    v_spend_result := spend_elo_coins(
        p_sender_id,
        v_receiver_amount,
        'gift',
        p_receiver_id,
        jsonb_build_object(
            'description',        'Gift: ' || v_sticker.name,
            'target_description', 'Sticker recebido: ' || v_sticker.name,
            'sticker_id',         p_sticker_id,
            'sticker_price',      v_sticker.eloscoin_price,
            'community_fee',      v_community_fee,
            'social_fund',        v_social_fund,
            'burn_deflation',     v_burn_amount,
            'social_fund_pct',    v_social_pct,
            'burn_pct',           v_burn_pct,
            'retention_pct',      (v_retention_pct * 100),
            'sender_level',       v_sender_level,
            'progressive',        true
        ),
        v_community_fee  -- p_burn_amount → removed from economy
    );

    -- -----------------------------------------------
    -- 8. INSERIR gift record
    -- -----------------------------------------------
    v_gift_id      := gen_random_uuid()::text;
    v_safe_message := CASE
        WHEN p_message IS NULL            THEN NULL
        WHEN char_length(p_message) > 100 THEN LEFT(p_message, 100)
        ELSE p_message
    END;

    INSERT INTO gifts (
        id, post_id, from_user_id, to_user_id,
        tipo, valor, sticker_id, idempotency_key, status, message
    ) VALUES (
        v_gift_id, p_post_id, p_sender_id, p_receiver_id,
        'sticker', v_sticker.eloscoin_price, p_sticker_id,
        p_idempotency_key, 'completed', v_safe_message
    );

    -- -----------------------------------------------
    -- 9. INSERIR no mural do receiver (user_stickers)
    -- -----------------------------------------------
    INSERT INTO user_stickers (
        owner_user_id, sticker_id, from_user_id, post_id
    ) VALUES (
        p_receiver_id, p_sticker_id, p_sender_id, p_post_id
    );

    -- -----------------------------------------------
    -- 10. RETORNAR resultado (includes progressive fields)
    -- -----------------------------------------------
    RETURN jsonb_build_object(
        'gift_id',            v_gift_id,
        'sticker_id',         p_sticker_id,
        'sticker_name',       v_sticker.name,
        'sticker_image_url',  v_sticker.image_url,
        'sticker_price',      v_sticker.eloscoin_price,
        'receiver_amount',    v_receiver_amount,
        'community_fee',      v_community_fee,
        'social_fund',        v_social_fund,
        'burn_deflation',     v_burn_amount,
        'retention_pct',      (v_retention_pct * 100),
        'sender_level',       v_sender_level,
        'sender_new_balance', (v_spend_result->>'new_balance')::INTEGER,
        'receiver_user_id',   p_receiver_id,
        'message',            v_safe_message,
        'idempotent',         false
    );
END;
$$;

COMMENT ON FUNCTION send_sticker_gift(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) IS
    'Envia sticker gift atomicamente com retenção PROGRESSIVA baseada no nível do sender. '
    'Tiers: L1-2→1%, L3-4→2%, L5-6→3%, L7-8→4%, L9-10→5%. '
    'Fee mínimo: 1 ECC. Do fee total: 20% fundo social (min 1 ECC) + 80% deflação. '
    'Sem registro de gamificação → default level 1 (1% — benefício da dúvida). '
    'Retorno inclui retention_pct e sender_level para transparência no frontend. '
    'Erros: P0001=saldo insuficiente, P0010=inativo, P0011=expirado, P0012=esgotado, P0013=limite.';
