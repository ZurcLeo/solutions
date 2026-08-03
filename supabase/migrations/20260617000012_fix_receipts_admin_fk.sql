-- ============================================================================
-- Fix: contribution_receipts.admin_id FK should reference users, not seller_profiles
-- ============================================================================

ALTER TABLE public.contribution_receipts
  DROP CONSTRAINT IF EXISTS contribution_receipts_admin_id_fkey;

ALTER TABLE public.contribution_receipts
  ADD CONSTRAINT contribution_receipts_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE RESTRICT;
