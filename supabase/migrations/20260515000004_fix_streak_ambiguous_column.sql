-- =====================================================
-- FIX: update_daily_streak — column reference ambiguous
-- PostgreSQL confundia os OUT parameters do RETURNS TABLE
-- (streak_days, longest_streak) com as colunas de
-- user_gamification de mesmo nome no SELECT...INTO.
-- Fix: qualificar com alias de tabela (ug.*).
-- =====================================================

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

    -- Qualificado com alias para evitar ambiguidade com OUT parameters
    SELECT ug.last_activity_date, ug.streak_days, ug.longest_streak
    INTO v_last_date, v_streak, v_longest
    FROM user_gamification ug WHERE ug.user_id = p_user_id;

    IF v_last_date = v_today THEN
        -- Já acessou hoje, sem mudança
        RETURN QUERY SELECT v_streak, v_longest, FALSE::BOOLEAN, 0::INTEGER;
        RETURN;
    END IF;

    IF v_last_date = v_today - 1 THEN
        -- Dia consecutivo
        v_streak := v_streak + 1;
        IF v_streak > v_longest THEN v_longest := v_streak; END IF;

        IF v_streak IN (7, 30, 100) THEN
            v_bonus := CASE v_streak
                WHEN 7   THEN 50
                WHEN 30  THEN 200
                WHEN 100 THEN 500
            END;
        ELSE
            v_bonus := 5;
        END IF;
    ELSE
        -- Streak quebrado
        v_broken := TRUE;
        v_streak := 1;
        v_bonus := 5;
    END IF;

    UPDATE user_gamification
    SET
        streak_days        = v_streak,
        longest_streak     = v_longest,
        last_activity_date = v_today
    WHERE user_id = p_user_id;

    IF v_bonus > 0 THEN
        PERFORM grant_xp(p_user_id, v_bonus, 0, 'streak_bonus', NULL,
                         'Streak de ' || v_streak || ' dias');
    END IF;

    RETURN QUERY SELECT v_streak, v_longest, v_broken, v_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
