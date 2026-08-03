-- ============================================================================
-- AGENDA-001: Agenda Compartilhada + Substágios de Pipeline
-- ============================================================================
-- Extends ops_pipeline_stages with substages (self-ref parent_stage_id)
-- Extends ops_tasks with task_type, scheduling, document_refs
-- Multi-role RLS: admin=all, seller team=own seller, assignee=assigned tasks
-- SQL View: unified_timeline_events (ops_tasks + service_bookings)
-- RPC: get_seller_ids_for_user (for Socket room joining)
-- ============================================================================

-- ── 1. Substágios em ops_pipeline_stages ───────────────────────────────────

ALTER TABLE ops_pipeline_stages
  ADD COLUMN IF NOT EXISTS parent_stage_id TEXT
    REFERENCES ops_pipeline_stages(id) ON DELETE CASCADE;

-- Substágio único dentro do pai
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_substage_unique
  ON ops_pipeline_stages (parent_stage_id, slug)
  WHERE parent_stage_id IS NOT NULL;

-- Lookup rápido de substágios de um stage
CREATE INDEX IF NOT EXISTS idx_ops_substages_parent
  ON ops_pipeline_stages (parent_stage_id)
  WHERE parent_stage_id IS NOT NULL;

-- ── 2. Agenda fields em ops_tasks ──────────────────────────────────────────

-- task_type discriminator
ALTER TABLE ops_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'pipeline'
    CHECK (task_type IN ('pipeline', 'agenda', 'milestone', 'seller_internal'));

-- Substágio dentro do stage
ALTER TABLE ops_tasks
  ADD COLUMN IF NOT EXISTS substage_id TEXT
    REFERENCES ops_pipeline_stages(id) ON DELETE SET NULL;

-- Scheduling fields
ALTER TABLE ops_tasks
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_minutes INT;

-- Document refs (JSONB array of {name, storage_path, mime_type, size, uploaded_at})
ALTER TABLE ops_tasks
  ADD COLUMN IF NOT EXISTS document_refs JSONB NOT NULL DEFAULT '[]';

-- Relaxar stage_id NOT NULL para seller_internal tasks
ALTER TABLE ops_tasks ALTER COLUMN stage_id DROP NOT NULL;

-- Constraints de integridade
ALTER TABLE ops_tasks
  ADD CONSTRAINT chk_ops_tasks_schedule_required
    CHECK (task_type IN ('pipeline', 'milestone') OR scheduled_at IS NOT NULL OR task_type = 'seller_internal'),
  ADD CONSTRAINT chk_ops_tasks_schedule_end_after_start
    CHECK (scheduled_end IS NULL OR scheduled_end > scheduled_at),
  ADD CONSTRAINT chk_ops_tasks_stage_required
    CHECK (stage_id IS NOT NULL OR task_type = 'seller_internal');

-- Indexes para queries de agenda
CREATE INDEX IF NOT EXISTS idx_ops_tasks_schedule
  ON ops_tasks (scheduled_at, scheduled_end)
  WHERE task_type IN ('agenda', 'milestone', 'seller_internal')
    AND NOT is_archived;

CREATE INDEX IF NOT EXISTS idx_ops_tasks_seller_schedule
  ON ops_tasks (seller_id, scheduled_at)
  WHERE NOT is_archived;

CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee_schedule
  ON ops_tasks (assignee_id, scheduled_at)
  WHERE NOT is_archived;

-- ── 3. Expandir ops_activity_log action CHECK ──────────────────────────────

-- Drop e recria constraint de action (ADD novas ações)
ALTER TABLE ops_activity_log
  DROP CONSTRAINT IF EXISTS ops_activity_log_action_check;

ALTER TABLE ops_activity_log
  ADD CONSTRAINT ops_activity_log_action_check
    CHECK (action IN (
      'created', 'moved', 'assigned', 'priority_changed',
      'edited', 'commented', 'archived', 'unarchived',
      'due_date_set', 'due_date_changed',
      'tag_added', 'tag_removed',
      'link_added', 'link_removed',
      'scheduled', 'rescheduled',
      'document_attached', 'document_removed',
      'substage_changed'
    ));

-- ── 4. RLS multi-role em ops_tasks ─────────────────────────────────────────

-- Drop política admin-only existente
DROP POLICY IF EXISTS ops_tasks_admin ON ops_tasks;

-- SELECT: admin=tudo | seller team member=agenda/seller_internal do seu seller | assignee=tasks atribuídas (exceto pipeline)
CREATE POLICY ops_tasks_select ON ops_tasks
  FOR SELECT USING (
    -- Admin vê tudo
    check_global_role(auth.uid()::TEXT, 'admin')
    -- Seller team member vê tasks do seu seller (agenda + seller_internal)
    OR (
      task_type IN ('agenda', 'seller_internal', 'milestone')
      AND seller_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM seller_team_members stm
        WHERE stm.seller_id = ops_tasks.seller_id
          AND stm.user_id = auth.uid()::TEXT
          AND stm.status = 'active'
      )
    )
    -- Assignee vê tasks atribuídas a ele (exceto pipeline — pipeline é admin-only)
    OR (
      task_type != 'pipeline'
      AND assignee_id = auth.uid()::TEXT
    )
  );

-- INSERT: admin=tudo | seller owner/manager=seller_internal do seu seller
CREATE POLICY ops_tasks_insert ON ops_tasks
  FOR INSERT WITH CHECK (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR (
      task_type = 'seller_internal'
      AND seller_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM seller_team_members stm
        WHERE stm.seller_id = ops_tasks.seller_id
          AND stm.user_id = auth.uid()::TEXT
          AND stm.status = 'active'
          AND stm.role IN ('owner', 'manager')
      )
    )
  );

-- UPDATE: admin=tudo | seller owner/manager=seller_internal do seu seller
CREATE POLICY ops_tasks_update ON ops_tasks
  FOR UPDATE USING (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR (
      task_type = 'seller_internal'
      AND seller_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM seller_team_members stm
        WHERE stm.seller_id = ops_tasks.seller_id
          AND stm.user_id = auth.uid()::TEXT
          AND stm.status = 'active'
          AND stm.role IN ('owner', 'manager')
      )
    )
  );

-- DELETE: admin only (soft-delete via is_archived é preferido)
CREATE POLICY ops_tasks_delete ON ops_tasks
  FOR DELETE USING (
    check_global_role(auth.uid()::TEXT, 'admin')
  );

-- ops_pipeline_stages, ops_activity_log, ops_notification_channels = admin-only (inalterado)

-- ── 5. SQL View: unified_timeline_events ───────────────────────────────────

CREATE OR REPLACE VIEW unified_timeline_events AS
  -- ops_tasks (agenda, milestone, seller_internal)
  SELECT
    t.id,
    t.task_type AS event_type,
    t.title,
    t.description,
    t.seller_id,
    t.assignee_id,
    t.scheduled_at,
    t.scheduled_end,
    t.duration_minutes,
    t.priority,
    t.stage_id,
    t.substage_id,
    t.is_archived,
    t.created_at,
    'ops_task' AS source
  FROM ops_tasks t
  WHERE t.task_type IN ('agenda', 'milestone', 'seller_internal')
    AND NOT t.is_archived

  UNION ALL

  -- service_bookings (pending, confirmed)
  SELECT
    b.id,
    'booking' AS event_type,
    COALESCE(p.name, 'Agendamento') AS title,
    b.notes AS description,
    b.provider_id AS seller_id,
    b.client_id AS assignee_id,
    b.scheduled_at,
    b.scheduled_end,
    NULL::INT AS duration_minutes,
    CASE b.status
      WHEN 'confirmed' THEN 'medium'
      WHEN 'pending' THEN 'low'
      ELSE 'low'
    END AS priority,
    NULL::TEXT AS stage_id,
    NULL::TEXT AS substage_id,
    false AS is_archived,
    b.created_at,
    'service_booking' AS source
  FROM service_bookings b
  LEFT JOIN marketplace_products p ON p.id = b.service_id
  WHERE b.status IN ('pending', 'confirmed');

-- ── 6. RPC: get_seller_ids_for_user ────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_seller_ids_for_user(p_user_id TEXT)
  RETURNS TEXT[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $$
  SELECT COALESCE(
    array_agg(stm.seller_id),
    '{}'::TEXT[]
  )
  FROM seller_team_members stm
  WHERE stm.user_id = p_user_id
    AND stm.status = 'active';
$$;

-- ── 7. Seed substágios para stages existentes ──────────────────────────────

-- Lead substágios
INSERT INTO ops_pipeline_stages (slug, label, sort_order, color, parent_stage_id)
SELECT sub.slug, sub.label, sub.sort_order, sub.color, s.id
FROM ops_pipeline_stages s,
  (VALUES
    ('novo',        'Novo',        0, '#818CF8'),
    ('contactado',  'Contactado',  1, '#6366F1'),
    ('validado',    'Validado',    2, '#4F46E5'),
    ('agendado',    'Agendado',    3, '#4338CA'),
    ('excluido',    'Excluido',    4, '#9CA3AF')
  ) AS sub(slug, label, sort_order, color)
WHERE s.slug = 'lead' AND s.parent_stage_id IS NULL
ON CONFLICT DO NOTHING;

-- Onboarding substágios
INSERT INTO ops_pipeline_stages (slug, label, sort_order, color, parent_stage_id)
SELECT sub.slug, sub.label, sub.sort_order, sub.color, s.id
FROM ops_pipeline_stages s,
  (VALUES
    ('documentacao',  'Documentacao',  0, '#FBBF24'),
    ('configuracao',  'Configuracao',  1, '#F59E0B'),
    ('treinamento',   'Treinamento',   2, '#D97706'),
    ('concluido',     'Concluido',     3, '#B45309')
  ) AS sub(slug, label, sort_order, color)
WHERE s.slug = 'onboarding' AND s.parent_stage_id IS NULL
ON CONFLICT DO NOTHING;
