-- Admin Analytics API: one call, organizers only.
--
-- A session counts as "completed" once it was booked (not cancelled) and its
-- end time has passed. Counts and the recent-completed list are computed here
-- so the Organizer page, tests and any future reporting agree on definitions.

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Only organizers can do this.'; end if;

  with b as (
    select bk.*, bk.starts_at + make_interval(mins => bk.duration_min) as ends_at
    from public.bookings bk
  )
  select jsonb_build_object(
    'alumni_approved',    (select count(*) from public.profiles where role = 'alumni' and status = 'approved'),
    'alumni_pending',     (select count(*) from public.profiles where role = 'alumni' and status = 'pending'),
    'students',           (select count(*) from public.profiles where role = 'student'),
    'open_slots',         (select count(*) from public.slots s
                             where not s.is_booked and s.starts_at > now() + public.min_notice()
                               and public.is_listed_alumni(s.alumni_id)),
    'upcoming_sessions',  (select count(*) from b where status = 'booked' and ends_at > now()),
    'completed_sessions', (select count(*) from b where status = 'booked' and ends_at <= now()),
    'cancelled_sessions', (select count(*) from b where status = 'cancelled'),
    'completed_minutes',  (select coalesce(sum(duration_min), 0) from b where status = 'booked' and ends_at <= now()),
    'match_searches',     (select count(*) from public.match_requests where method <> 'autofill'),
    'completed_by_mentor', coalesce((
      select jsonb_agg(x order by x.sessions desc, x.name)
      from (
        select b.alumni_id, p.full_name as name, count(*) as sessions
        from b join public.profiles p on p.id = b.alumni_id
        where b.status = 'booked' and b.ends_at <= now()
        group by b.alumni_id, p.full_name
      ) x
    ), '[]'::jsonb),
    'recent_completed', coalesce((
      select jsonb_agg(x order by x.starts_at desc)
      from (
        select b.id, b.starts_at, b.duration_min, b.topic,
               b.alumni_id, pa.full_name as alumni_name,
               b.student_id, ps.full_name as student_name
        from b
        join public.profiles pa on pa.id = b.alumni_id
        join public.profiles ps on ps.id = b.student_id
        where b.status = 'booked' and b.ends_at <= now()
        order by b.starts_at desc
        limit 25
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
