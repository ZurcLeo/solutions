-- =====================================================================
-- Adicionar categorias de notificação: pedidos, entregas, mobilidade
-- Necessário para push gates em delivery, marketplace e carona
-- =====================================================================

-- Atualizar registros existentes que já têm notification_prefs mas não têm as novas categorias
UPDATE user_preferences
SET notification_prefs = jsonb_set(
  notification_prefs,
  '{events}',
  COALESCE(notification_prefs->'events', '{}'::jsonb) || '{
    "pedidos":     {"push": true, "email": true},
    "entregas":    {"push": true, "email": false},
    "mobilidade":  {"push": true, "email": false}
  }'::jsonb
),
updated_at = NOW()
WHERE notification_prefs IS NOT NULL
  AND NOT (notification_prefs->'events' ? 'pedidos');
