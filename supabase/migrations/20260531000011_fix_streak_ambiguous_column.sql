-- Fix: update_daily_streak — column reference "streak_days" is ambiguous
-- A migration 20260531000006_streak_freeze reescreveu o RPC sem o alias de tabela,
-- reintroduzindo o mesmo bug corrigido em 20260515000004.
-- Fix: qualificar todas as colunas lidas de user_gamification com alias "ug.".

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

    -- Alias "ug." obrigatório para evitar ambiguidade com OUT parameters
    SELECT ug.last_activity_date,
           ug.streak_days,
           ug.longest_streak,
           COALESCE(ug.streak_freeze_days, 0)
    INTO   v_last_date, v_streak, v_longest, v_freeze
    FROM   user_gamification ug
    WHERE  ug.user_id = p_user_id;

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
        -- Streak quebrado
        v_broken := TRUE;
        v_streak := 1;
        v_bonus  := 5;
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
