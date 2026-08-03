-- ============================================================
-- Add 'unroutable' status to pending_webhook_events
--
-- Unroutable events have externalReference that matches no known
-- pattern. They should NOT be retried (retrying won't make the
-- branch appear). They are stored for admin investigation.
-- ============================================================

-- Drop and recreate CHECK constraint to include 'unroutable'
ALTER TABLE pending_webhook_events
  DROP CONSTRAINT IF EXISTS pending_webhook_events_status_check;

ALTER TABLE pending_webhook_events
  ADD CONSTRAINT pending_webhook_events_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'failed', 'abandoned', 'unroutable'));

-- Index for admin queries on unroutable events
CREATE INDEX IF NOT EXISTS idx_pwe_unroutable
  ON pending_webhook_events (created_at DESC)
  WHERE status = 'unroutable';

-- Exclude unroutable from cleanup (they should persist until manually reviewed)
-- The existing cleanup_pending_webhook_events() RPC deletes done/abandoned older than 30d.
-- Unroutable is not in that list, so they persist by default. No change needed.

COMMENT ON COLUMN pending_webhook_events.status IS
  'pending/failed = retry queue, processing = locked, done = success, abandoned = exhausted retries, unroutable = unknown externalReference (needs manual review)';
