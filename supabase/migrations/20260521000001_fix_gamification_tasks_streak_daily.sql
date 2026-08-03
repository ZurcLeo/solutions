-- =====================================================
-- MIGRATION DELTA: Ajuste streak_7days e daily_login
-- Data: 2026-05-21
-- =====================================================

UPDATE gamification_tasks
SET
    name                 = 'Semana Perfeita',
    description          = 'Acesse a ElosCloud por 7 dias seguidos',
    category             = 'consistencia',
    xp_reward            = 100,
    coin_reward          = 20,
    is_repeatable        = FALSE,
    max_completions      = NULL,
    target_count         = 7,
    sort_order           = 40,
    updated_at           = NOW()
WHERE slug = 'streak_7days';

UPDATE gamification_tasks
SET
    name                 = 'Login Diário',
    description          = 'Acesse a plataforma hoje',
    category             = 'consistencia',
    xp_reward            = 100,
    coin_reward          = 20,
    is_repeatable        = TRUE,
    max_completions      = NULL,
    target_count         = 7,
    sort_order           = 40,
    updated_at           = NOW()
WHERE slug = 'daily_login';
