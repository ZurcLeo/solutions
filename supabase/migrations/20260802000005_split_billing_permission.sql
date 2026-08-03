-- Migration: Split can_manage_settings into operational settings + billing
-- Previously can_manage_settings controlled both shop config (profile, hours,
-- address, delivery) AND financial config (subscription, addons, billing).
-- This migration adds can_manage_billing to the permissions JSONB so owners
-- can grant operational access without exposing plan/billing changes.
--
-- Permissions are stored in seller_team_members.permissions JSONB.
-- Existing members with can_manage_settings=true do NOT get can_manage_billing
-- (conservative — owner grants explicitly).

-- 0. Fix any rows where permissions is not a JSONB object (e.g. '[]' or NULL)
UPDATE seller_team_members
  SET permissions = '{}'::jsonb
  WHERE permissions IS NULL
     OR jsonb_typeof(permissions) != 'object';

-- 1. Set can_manage_billing=false for all existing team members that don't have it yet
UPDATE seller_team_members
  SET permissions = permissions || '{"can_manage_billing": false}'::jsonb
  WHERE NOT (permissions ? 'can_manage_billing');

-- 2. Set can_manage_billing=true for existing owners (implicit full access)
UPDATE seller_team_members
  SET permissions = jsonb_set(permissions, '{can_manage_billing}', 'true')
  WHERE role = 'owner';

COMMENT ON COLUMN seller_team_members.permissions IS
  'JSONB de permissoes granulares. Chaves: '
  'can_manage_catalog, can_manage_orders, can_manage_clients, can_manage_pendencias, '
  'can_manage_settings (shop config), can_manage_billing (subscription/plan/addons), '
  'can_view_financials, can_manage_team. Owner tem todas implicitamente.';
