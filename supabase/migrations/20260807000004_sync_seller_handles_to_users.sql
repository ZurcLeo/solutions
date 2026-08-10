-- [HANDLE-SYNC] One-time sync: copy seller_profiles.username to users.username
-- for users who have a seller handle but no user handle.
-- This ensures /u/:handle works for seller owners.

UPDATE public.users u
SET
  username = sp.username,
  username_last_changed_at = NOW()
FROM public.seller_profiles sp
WHERE sp.user_id = u.id
  AND sp.username IS NOT NULL
  AND u.username IS NULL;
