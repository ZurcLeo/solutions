-- Migration: Streak freeze por comportamento real
-- Contribuição paga = 1 dia de streak protegido automaticamente
-- (Auditoria UX 2026 — Item 6)

-- 1. Coluna de freeze em user_gamification
ALTER TABLE user_gamification
  ADD COLUMN IF NOT EXISTS streak_freeze_days INTEGER DEFAULT 0;

COMMENT ON COLUMN user_gamification.streak_freeze_days IS
  'Dias de streak protegidos acumulados. Concedidos automaticamente por contribuição paga. '
  'Consumidos por update_daily_streak quando o usuário perde exatamente 1 dia de acesso.';

-- 2. RPC para conceder dias de freeze (chamada por gamificationService)
CREATE OR REPLACE FUNCTION grant_streak_freeze(p_user_id TEXT, p_days INTEGER DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_new INTEGER;
BEGIN
    INSERT INTO user_gamification (user_id, streak_freeze_days)
    VALUES (p_user_id, p_days)
    ON CONFLICT (user_id) DO UPDATE
      SET streak_freeze_days = COALESCE(user_gamification.streak_freeze_days, 0) + p_days
    RETURNING streak_freeze_days INTO v_new;
    RETURN v_new;
END;
$$;

COMMENT ON FUNCTION grant_streak_freeze IS
  'Concede p_days dias de streak freeze ao usuário. Idempotente via upsert.';

-- 3. Atualiza update_daily_streak para consumir freeze quando streak quebraria
--    O DROP é necessário porque a assinatura de retorno muda (novo campo freeze_used).
DROP FUNCTION IF EXISTS update_daily_streak(TEXT);

CREATE OR REPLACE FUNCTION update_daily_streak(p_user_id TEXT)
RETURNS TABLE (
    streak_days     INTEGER,
    longest_streak  INTEGER,
    streak_broken   BOOLEAN,
    bonus_xp        INTEGER,
    freeze_used     BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_last_date   DATE;
    v_today       DATE    := CURRENT_DATE;
    v_streak      INTEGER;
    v_longest     INTEGER;
    v_freeze      INTEGER;
    v_bonus       INTEGER := 0;
    v_broken      BOOLEAN := FALSE;
    v_freeze_used BOOLEAN := FALSE;
BEGIN
    INSERT INTO user_gamification (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT last_activity_date,
           streak_days,
           longest_streak,
           COALESCE(streak_freeze_days, 0)
    INTO   v_last_date, v_streak, v_longest, v_freeze
    FROM   user_gamification
    WHERE  user_id = p_user_id;

    -- Já acessou hoje — sem mudança
    IF v_last_date = v_today THEN
        RETURN QUERY SELECT v_streak, v_longest, FALSE, 0, FALSE;
        RETURN;
    END IF;

    IF v_last_date = v_today - 1 THEN
        -- Dia consecutivo normal
        v_streak := v_streak + 1;
        IF v_streak > v_longest THEN v_longest := v_streak; END IF;

        v_bonus := CASE v_streak
            WHEN 7   THEN 50
            WHEN 30  THEN 200
            WHEN 100 THEN 500
            ELSE 5
        END;

    ELSIF v_last_date = v_today - 2 AND v_freeze > 0 THEN
        -- Exatamente 1 dia perdido + freeze disponível → protege o streak
        v_streak      := v_streak + 1;
        v_freeze_used := TRUE;
        IF v_streak > v_longest THEN v_longest := v_streak; END IF;
        v_bonus := 5;

    ELSE
        -- Streak quebrado (gap > 1 dia, ou gap = 1 mas sem freeze)
        v_broken := TRUE;
        v_streak := 1;
        v_bonus  := 5; -- bônus de retorno
    END IF;

    UPDATE user_gamification
    SET
        streak_days        = v_streak,
        longest_streak     = v_longest,
        last_activity_date = v_today,
        streak_freeze_days = GREATEST(
            0,
            COALESCE(streak_freeze_days, 0) - (CASE WHEN v_freeze_used THEN 1 ELSE 0 END)
        )
    WHERE user_id = p_user_id;

    IF v_bonus > 0 THEN
        PERFORM grant_xp(
            p_user_id, v_bonus, 0, 'streak_bonus', NULL,
            CASE WHEN v_freeze_used
                 THEN 'Streak protegido por contribuição (dia ' || v_streak || ')'
                 ELSE 'Streak de ' || v_streak || ' dias'
            END
        );
    END IF;

    RETURN QUERY SELECT v_streak, v_longest, v_broken, v_bonus, v_freeze_used;
END;
$$;

COMMENT ON FUNCTION update_daily_streak IS
  'Atualiza streak diário. Consome 1 freeze_day se o usuário perdeu exatamente 1 dia '
  'e tem freeze disponível (concedido por contribuição paga).';
