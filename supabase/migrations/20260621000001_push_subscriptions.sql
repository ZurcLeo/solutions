-- ============================================================================
-- PUSH SUBSCRIPTIONS — Web Push API (W3C VAPID) subscription storage
-- ============================================================================
-- Stores W3C PushSubscription objects for native push notifications.
-- Subscriptions are managed per user per device. Inactive subs are soft-deleted.
-- LGPD: No biometric or sensitive data stored — only opaque push endpoints.
-- Zero Firebase dependency — uses standard Web Push API with VAPID keys.
-- ============================================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  subscription JSONB NOT NULL,
  device_name  TEXT,
  device_type  TEXT CHECK (device_type IN ('web', 'android', 'ios')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,

  UNIQUE(user_id, endpoint)
);

-- 2. Indexes
CREATE INDEX idx_push_subs_user_active
  ON push_subscriptions(user_id)
  WHERE active = TRUE;

CREATE INDEX idx_push_subs_endpoint
  ON push_subscriptions(endpoint)
  WHERE active = TRUE;

-- 3. RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can see their own subscriptions
CREATE POLICY push_subs_select_self ON push_subscriptions
  FOR SELECT USING (auth.uid()::text = user_id);

-- Users can delete (unsubscribe) their own subscriptions
CREATE POLICY push_subs_delete_self ON push_subscriptions
  FOR DELETE USING (auth.uid()::text = user_id);

-- Service role (backend) can insert new subscriptions
CREATE POLICY push_subs_insert_service ON push_subscriptions
  FOR INSERT WITH CHECK (TRUE);

-- Service role (backend) can update (deactivate subs, update last_used_at)
CREATE POLICY push_subs_update_service ON push_subscriptions
  FOR UPDATE USING (TRUE);
