-- PREFS-004: Consolidate dual notification preference systems
-- Backfills user_preferences.notification_prefs from legacy user_notification_preferences
-- After this migration, the new system (user_preferences) is the sole source of truth.
-- The legacy table (user_notification_preferences) is NOT dropped — just no longer read.

-- Map legacy event keys (Portuguese) to new system keys (English/mixed):
--   pagamentos  -> payments
--   convites    -> invites
--   mensagens   -> messages
--   sistema     -> security
--   caixinhas   -> caixinhas (same)
--   pedidos     -> pedidos (same)
--   entregas    -> entregas (same)
--   mobilidade  -> mobilidade (same)

-- Backfill: for users who have legacy prefs but no new-system prefs row,
-- create the new row. For users who have both, merge the legacy email opt-out
-- and per-event settings into the new system.

-- 1. Upsert: copy global_opt_out_email into notification_prefs.channels.email = !opt_out
--    and map legacy per-event channels into notification_prefs.events
INSERT INTO user_preferences (user_id, notification_prefs, updated_at)
SELECT
  unp.user_id,
  jsonb_build_object(
    'channels', jsonb_build_object(
      'push',  true,
      'email', NOT unp.global_opt_out_email,
      'sms',   false
    ),
    'events', jsonb_build_object(
      'payments',   jsonb_build_object(
        'push',  COALESCE((unp.channels->'pagamentos') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'pagamentos') @> '"email"'::jsonb, true)
      ),
      'invites',    jsonb_build_object(
        'push',  COALESCE((unp.channels->'convites') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'convites') @> '"email"'::jsonb, true)
      ),
      'caixinhas',  jsonb_build_object(
        'push',  COALESCE((unp.channels->'caixinhas') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'caixinhas') @> '"email"'::jsonb, true)
      ),
      'messages',   jsonb_build_object(
        'push',  COALESCE((unp.channels->'mensagens') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'mensagens') @> '"email"'::jsonb, false)
      ),
      'security',   jsonb_build_object('push', true, 'email', true),
      'pedidos',    jsonb_build_object(
        'push',  COALESCE((unp.channels->'pedidos') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'pedidos') @> '"email"'::jsonb, true)
      ),
      'entregas',   jsonb_build_object(
        'push',  COALESCE((unp.channels->'entregas') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'entregas') @> '"email"'::jsonb, false)
      ),
      'mobilidade', jsonb_build_object(
        'push',  COALESCE((unp.channels->'mobilidade') @> '"in_app"'::jsonb, true),
        'email', COALESCE((unp.channels->'mobilidade') @> '"email"'::jsonb, false)
      )
    )
  ),
  NOW()
FROM user_notification_preferences unp
WHERE NOT EXISTS (
  SELECT 1 FROM user_preferences up WHERE up.user_id = unp.user_id
)
ON CONFLICT (user_id) DO NOTHING;

-- 2. For users who already have a user_preferences row: merge the legacy email opt-out
--    into their existing notification_prefs (only if they had legacy prefs)
UPDATE user_preferences up
SET notification_prefs = jsonb_set(
  jsonb_set(
    up.notification_prefs,
    '{channels,email}',
    to_jsonb(NOT unp.global_opt_out_email)
  ),
  '{events}',
  -- Merge: keep existing new-system events, overlay with legacy-mapped events
  COALESCE(up.notification_prefs->'events', '{}'::jsonb) || jsonb_build_object(
    'payments',   jsonb_build_object(
      'push',  COALESCE((unp.channels->'pagamentos') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'payments'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'pagamentos') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'payments'->>'email')::boolean, true))
    ),
    'invites',    jsonb_build_object(
      'push',  COALESCE((unp.channels->'convites') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'invites'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'convites') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'invites'->>'email')::boolean, true))
    ),
    'caixinhas',  jsonb_build_object(
      'push',  COALESCE((unp.channels->'caixinhas') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'caixinhas'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'caixinhas') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'caixinhas'->>'email')::boolean, true))
    ),
    'messages',   jsonb_build_object(
      'push',  COALESCE((unp.channels->'mensagens') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'messages'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'mensagens') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'messages'->>'email')::boolean, false))
    ),
    'security',   jsonb_build_object('push', true, 'email', true),
    'pedidos',    jsonb_build_object(
      'push',  COALESCE((unp.channels->'pedidos') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'pedidos'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'pedidos') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'pedidos'->>'email')::boolean, true))
    ),
    'entregas',   jsonb_build_object(
      'push',  COALESCE((unp.channels->'entregas') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'entregas'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'entregas') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'entregas'->>'email')::boolean, false))
    ),
    'mobilidade', jsonb_build_object(
      'push',  COALESCE((unp.channels->'mobilidade') @> '"in_app"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'mobilidade'->>'push')::boolean, true)),
      'email', COALESCE((unp.channels->'mobilidade') @> '"email"'::jsonb,
               COALESCE((up.notification_prefs->'events'->'mobilidade'->>'email')::boolean, false))
    )
  )
),
updated_at = NOW()
FROM user_notification_preferences unp
WHERE up.user_id = unp.user_id;

-- NOTE: user_notification_preferences table is intentionally NOT dropped.
-- It remains as a read-only archive. Backend code will no longer read from it.

COMMENT ON TABLE user_notification_preferences
  IS 'DEPRECATED (PREFS-004): Legacy notification preferences. Replaced by user_preferences.notification_prefs. Do not read from this table.';
