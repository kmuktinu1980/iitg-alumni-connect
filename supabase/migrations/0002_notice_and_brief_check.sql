-- 48-hour minimum notice, and recording the booking brief's specificity check.
--
--   * Students can only book slots that start at least 48 hours from now.
--   * Alumni can't open slots that would already be inside that window.
--   * A cancelled session's slot reopens only if it is still 48+ hours away.
--   * Each booking stores the outcome of the brief check (passed, or booked
--     as written after feedback), so organizers can see brief quality.
--   * The brief ("what do you want to cover") must be at least 40 characters.

create or replace function public.min_notice() returns interval
language sql immutable as $$ select interval '48 hours' $$;

alter table public.bookings add column if not exists brief_check jsonb;

-- ---------------------------------------------------------------- availability
create or replace function public.add_slots(p_starts timestamptz[], p_duration int) returns int
language plpgsql security definer set search_path = public as $$
declare me public.profiles; s timestamptz; added int := 0; future_count int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'alumni' or me.status <> 'approved' then
    raise exception 'Only approved alumni can open slots.';
  end if;
  if p_duration not in (30, 45, 60) then raise exception 'Slots are 30, 45 or 60 minutes.'; end if;

  foreach s in array p_starts loop
    -- Students need 48 hours' notice, so a slot inside that window could never be booked.
    continue when s < now() + public.min_notice();
    continue when exists (
      select 1 from public.slots x
      where x.alumni_id = me.id
        and s < x.starts_at + make_interval(mins => x.duration_min)
        and x.starts_at < s + make_interval(mins => p_duration)
    );
    insert into public.slots (alumni_id, starts_at, duration_min) values (me.id, s, p_duration);
    added := added + 1;
  end loop;

  select count(*) into future_count from public.slots where alumni_id = me.id and starts_at > now();
  if future_count > 60 then
    raise exception 'You can have up to 60 upcoming slots. Remove some first.';
  end if;
  return added;
end $$;

-- ---------------------------------------------------------------- booking
drop function if exists public.book_slot(uuid, text, text);

create or replace function public.book_slot(p_slot uuid, p_topic text, p_note text, p_brief_check jsonb default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; s public.slots; new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'student' or me.status <> 'approved' then
    raise exception 'Only signed-in IITG students can book sessions.';
  end if;
  if char_length(trim(coalesce(p_topic, ''))) < 40 then
    raise exception 'Describe what you want to cover in a sentence or two (at least 40 characters) so your mentor can prepare.';
  end if;

  -- Row lock: concurrent bookings of the same slot queue here.
  select * into s from public.slots where id = p_slot for update;
  if not found then raise exception 'That slot is no longer offered.'; end if;
  if s.is_booked then raise exception 'That slot was just taken. Pick another.'; end if;
  if s.starts_at < now() + public.min_notice() then
    raise exception 'Sessions need to be booked at least 48 hours ahead. Pick a later slot.';
  end if;
  if not public.is_listed_alumni(s.alumni_id) then raise exception 'This mentor is not taking bookings right now.'; end if;

  if exists (select 1 from public.bookings
             where student_id = me.id and alumni_id = s.alumni_id and status = 'booked' and starts_at > now()) then
    raise exception 'You already have an upcoming session with this mentor.';
  end if;
  if (select count(*) from public.bookings where student_id = me.id and status = 'booked' and starts_at > now()) >= 3 then
    raise exception 'You can hold up to 3 upcoming sessions. Cancel one or wait until one is done.';
  end if;

  insert into public.bookings (slot_id, alumni_id, student_id, starts_at, duration_min, topic, note, brief_check)
  values (s.id, s.alumni_id, me.id, s.starts_at, s.duration_min, trim(p_topic), trim(coalesce(p_note, '')), p_brief_check)
  returning id into new_id;

  update public.slots set is_booked = true where id = s.id;
  return new_id;
end $$;

create or replace function public.cancel_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not (b.student_id = auth.uid() or b.alumni_id = auth.uid() or public.is_admin()) then
    raise exception 'Session not found.';
  end if;
  if b.status <> 'booked' then raise exception 'This session is already cancelled.'; end if;
  if b.starts_at + make_interval(mins => b.duration_min) < now() then raise exception 'This session has already happened.'; end if;

  update public.bookings set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = b.id;
  -- Reopen the slot only if another student could still book it.
  update public.slots set is_booked = false where id = b.slot_id and starts_at > now() + public.min_notice();
end $$;

revoke execute on function public.book_slot(uuid, text, text, jsonb), public.min_notice() from public, anon;
grant execute on function public.book_slot(uuid, text, text, jsonb), public.min_notice() to authenticated;
