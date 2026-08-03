-- =====================================================
-- MIGRAÇÃO: OPS-009 — Links entre Tasks e Entidades Externas
-- Descrição: Tabela ops_task_links vincula tasks do pipeline a tickets de suporte,
--            pedidos ou delivery requests para rastreabilidade cross-domain.
-- Data: 2026-07-26
-- =====================================================

-- =====================================================
-- 1. TABELA ops_task_links
-- =====================================================
CREATE TABLE IF NOT EXISTS ops_task_links (
  id         TEXT PRIMARY KEY DEFAULT ('otl_' || replace(gen_random_uuid()::TEXT, '-', '')),
  task_id    TEXT NOT NULL REFERENCES ops_tasks(id) ON DELETE CASCADE,
  link_type  TEXT NOT NULL CHECK (link_type IN ('support_ticket', 'order', 'delivery_request')),
  link_id    TEXT NOT NULL,
  link_meta  JSONB DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, link_type, link_id)
);

-- =====================================================
-- 2. ÍNDICES
-- =====================================================
CREATE INDEX idx_ops_task_links_task ON ops_task_links(task_id);
CREATE INDEX idx_ops_task_links_lookup ON ops_task_links(link_type, link_id);

-- =====================================================
-- 3. RLS — admin-only (mesma policy das outras tabelas ops_*)
-- =====================================================
ALTER TABLE ops_task_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY ops_task_links_admin ON ops_task_links
  FOR ALL USING (check_global_role(auth.uid()::TEXT, 'admin'));
