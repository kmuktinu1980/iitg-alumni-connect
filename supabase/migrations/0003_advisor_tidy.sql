-- Tidy-ups from the Supabase security advisor.
--
-- 1. Pin search_path on the two constant functions (lint 0011). They reference
--    no tables, so this is hygiene rather than a fix.
-- 2. handle_new_user() is a trigger function; nobody needs to call it directly.
--    Supabase grants EXECUTE on new functions to `authenticated` by default, so
--    remove it.
--
-- The remaining "SECURITY DEFINER executable by authenticated" warnings (lint
-- 0029) are intentional: those functions ARE the app's write API. Each one
-- checks auth.uid(), role, status and the booking rules itself, and the
-- is_* / shares_booking helpers must stay executable because RLS policies call
-- them as the signed-in user.

alter function public.student_email_domain() set search_path = '';
alter function public.min_notice() set search_path = '';

revoke execute on function public.handle_new_user() from authenticated, anon, public;
