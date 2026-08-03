-- ============================================================================
-- OPS-001: Operations Panel — Pipeline, Tasks, Metrics, Notifications
-- ============================================================================
-- 5 tables: ops_pipeline_stages, ops_tasks, ops_activity_log,
--           ops_metrics_snapshots, ops_notification_channels
-- RLS: admin-only on all tables
-- ============================================================================

-- ── 1. ops_pipeline_stages — Kanban columns ─────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_pipeline_stages (
  id          TEXT PRIMARY KEY DEFAULT ('ops_stg_' || replace(gen_random_uuid()::TEXT, '-', '')),
  slug        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default stages
INSERT INTO ops_pipeline_stages (slug, label, sort_order, color, is_terminal) VALUES
  ('lead',         'Lead',         0, '#6366F1', false),
  ('onboarding',   'Onboarding',   1, '#F59E0B', false),
  ('integracoes',  'Integracoes',  2, '#8B5CF6', false),
  ('ativo',        'Ativo',        3, '#10B981', false),
  ('risco',        'Em Risco',     4, '#EF4444', false),
  ('churned',      'Churned',      5, '#6B7280', true)
ON CONFLICT (slug) DO NOTHING;

-- Auto-update trigger
CREATE OR REPLACE TRIGGER trg_ops_pipeline_stages_updated_at
  BEFORE UPDATE ON ops_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ── 2. ops_tasks — Kanban cards ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_tasks (
  id          TEXT PRIMARY KEY DEFAULT ('ops_' || replace(gen_random_uuid()::TEXT, '-', '')),
  title       TEXT NOT NULL,
  description TEXT,
  stage_id    TEXT NOT NULL REFERENCES ops_pipeline_stages(id) ON DELETE RESTRICT,
  seller_id   TEXT REFERENCES seller_profiles(id),
  assignee_id TEXT REFERENCES users(id),
  priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date    DATE,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  sort_order  INT  NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ops_tasks_stage_active
  ON ops_tasks (stage_id, sort_order) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee
  ON ops_tasks (assignee_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_ops_tasks_seller
  ON ops_tasks (seller_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_ops_tasks_due_date
  ON ops_tasks (due_date) WHERE NOT is_archived AND due_date IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_ops_tasks_updated_at
  BEFORE UPDATE ON ops_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ── 3. ops_activity_log — Task history ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_activity_log (
  id         TEXT PRIMARY KEY DEFAULT ('oal_' || replace(gen_random_uuid()::TEXT, '-', '')),
  task_id    TEXT NOT NULL REFERENCES ops_tasks(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL
               CHECK (action IN (
                 'created', 'moved', 'assigned', 'priority_changed',
                 'edited', 'commented', 'archived', 'unarchived',
                 'due_date_set', 'due_date_changed',
                 'tag_added', 'tag_removed'
               )),
  from_value TEXT,
  to_value   TEXT,
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_activity_log_task
  ON ops_activity_log (task_id, created_at DESC);

-- ── 4. ops_metrics_snapshots — Daily aggregations ───────────────────────────

CREATE TABLE IF NOT EXISTS ops_metrics_snapshots (
  id               TEXT PRIMARY KEY DEFAULT ('oms_' || replace(gen_random_uuid()::TEXT, '-', '')),
  snapshot_date    DATE NOT NULL UNIQUE,
  gmv_brl          NUMERIC(14,2) NOT NULL DEFAULT 0,
  mrr_brl          NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_brl   NUMERIC(14,2) NOT NULL DEFAULT 0,
  active_sellers   INT NOT NULL DEFAULT 0,
  total_sellers    INT NOT NULL DEFAULT 0,
  total_users      INT NOT NULL DEFAULT 0,
  new_users_today  INT NOT NULL DEFAULT 0,
  new_sellers_today INT NOT NULL DEFAULT 0,
  open_tickets     INT NOT NULL DEFAULT 0,
  sla_breached     INT NOT NULL DEFAULT 0,
  avg_csat         NUMERIC(3,1),
  churn_rate       NUMERIC(5,2),
  tasks_pending    INT NOT NULL DEFAULT 0,
  tasks_overdue    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. ops_notification_channels — Slack/Notion config ──────────────────────

CREATE TABLE IF NOT EXISTS ops_notification_channels (
  id          TEXT PRIMARY KEY DEFAULT ('onc_' || replace(gen_random_uuid()::TEXT, '-', '')),
  channel     TEXT NOT NULL CHECK (channel IN ('slack', 'notion')),
  webhook_url TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_ops_notification_channels_updated_at
  BEFORE UPDATE ON ops_notification_channels
  FOR EACH ROW EXECUTE FUNCTION trg_fn_set_updated_at();

-- ── RLS: Admin-only on all tables ───────────────────────────────────────────

ALTER TABLE ops_pipeline_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_activity_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_metrics_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_notification_channels ENABLE ROW LEVEL SECURITY;

-- Policy: admin full access
CREATE POLICY ops_pipeline_stages_admin ON ops_pipeline_stages
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));

CREATE POLICY ops_tasks_admin ON ops_tasks
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));

CREATE POLICY ops_activity_log_admin ON ops_activity_log
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));

CREATE POLICY ops_metrics_snapshots_admin ON ops_metrics_snapshots
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));

CREATE POLICY ops_notification_channels_admin ON ops_notification_channels
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));
