-- ============================================================
-- SECURITY: Remove INSERT/UPDATE RLS policies from user_subscriptions
--
-- Rationale: All writes to user_subscriptions go through the backend
-- using SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS). These policies
-- are unnecessary attack surface. Only SELECT is needed for reads.
--
-- Risk mitigated: An attacker who signs up via Supabase native auth
-- (which is enabled without email confirmation) could potentially
-- INSERT arbitrary subscriptions with premium plan_slugs.
-- ============================================================

-- Remove permissive INSERT policy
DROP POLICY IF EXISTS "subscriptions_own_insert" ON public.user_subscriptions;

-- Remove permissive UPDATE policy
DROP POLICY IF EXISTS "subscriptions_own_update" ON public.user_subscriptions;

-- Revoke INSERT/UPDATE/DELETE from authenticated role (defense in depth)
REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;

-- SELECT stays: users can read their own subscriptions via RLS
-- (though in practice the backend reads with service_role too)

COMMENT ON TABLE public.user_subscriptions IS
  'Write access restricted to backend service_role only. RLS INSERT/UPDATE policies removed 2026-07-09 (security hardening).';
