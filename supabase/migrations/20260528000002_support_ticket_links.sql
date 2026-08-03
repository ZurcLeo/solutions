-- migration: 20260528000002_support_ticket_links
-- épico: SUPP-LINK-001 — Tickets Vinculados
-- NOTA: support_tickets.id é TEXT; RLS usa check_global_role() (padrão do projeto)

CREATE TABLE IF NOT EXISTS public.support_ticket_links (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        TEXT        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  linked_ticket_id TEXT        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  link_type        TEXT        NOT NULL CHECK (link_type IN ('duplicate', 'related', 'parent')),
  created_by       TEXT        NOT NULL,                       -- uid do agente
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_ticket_links_no_self  CHECK (ticket_id <> linked_ticket_id),
  CONSTRAINT support_ticket_links_unique   UNIQUE (ticket_id, linked_ticket_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_stl_ticket_id        ON public.support_ticket_links(ticket_id);
CREATE INDEX IF NOT EXISTS idx_stl_linked_ticket_id ON public.support_ticket_links(linked_ticket_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.support_ticket_links ENABLE ROW LEVEL SECURITY;

-- SELECT: dono do ticket ou agente/admin
CREATE POLICY stl_select ON public.support_ticket_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets st
      WHERE st.id = ticket_id
        AND (
          st.user_id = auth.uid()::TEXT
          OR check_global_role(auth.uid()::TEXT, 'admin')
          OR check_global_role(auth.uid()::TEXT, 'support')
        )
    )
  );

-- INSERT: apenas agentes/admins
CREATE POLICY stl_insert ON public.support_ticket_links
  FOR INSERT WITH CHECK (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR check_global_role(auth.uid()::TEXT, 'support')
  );

-- DELETE: apenas agentes/admins
CREATE POLICY stl_delete ON public.support_ticket_links
  FOR DELETE USING (
    check_global_role(auth.uid()::TEXT, 'admin')
    OR check_global_role(auth.uid()::TEXT, 'support')
  );
