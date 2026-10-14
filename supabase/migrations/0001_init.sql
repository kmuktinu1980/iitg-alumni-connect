-- IITG Alumni Connect: schema, security rules and booking logic.
--
-- Design:
--   * Clients only READ through row-level security (RLS).
--   * Every WRITE goes through a SECURITY DEFINER function below, which checks
--     who is calling and enforces the rules (one booking per slot, approval,
--     IITG email domain, limits). Clients have no direct insert/update/delete.
--   * Private fields (emails, meeting links) are not readable by other users;
--     the server reads them with the service-role key after its own checks.

-- ---------------------------------------------------------------- types
create type public.user_role as enum ('student', 'alumni');
create type public.account_status as enum ('onboarding', 'pending', 'approved', 'rejected');
create type public.booking_status as enum ('booked', 'cancelled');

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.user_role,
  status      public.account_status not null default 'onboarding',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.alumni_profiles (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  grad_year     int  not null check (grad_year between 1995 and 2100),
  degree        text not null,
  branch        text not null,
  job_title     text not null,
  organization  text not null,
  city          text not null default '',
  timezone      text not null default 'UTC',
  linkedin_url  text not null default '' check (linkedin_url = '' or linkedin_url ~* '^https://'),
  meeting_link  text not null check (meeting_link ~* '^https://'),
  skills        text[] not null default '{}',
  advice_areas  text[] not null default '{}',
  bio           text not null default '' check (char_length(bio) <= 1200),
  visible       boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table public.student_profiles (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  branch           text not null,
  year_of_study    text not null,
  project_title    text not null check (char_length(project_title) between 1 and 200),
  project_summary  text not null default '' check (char_length(project_summary) <= 2000),
  seeking          text not null check (char_length(seeking) between 1 and 2000),
  updated_at       timestamptz not null default now()
);

create table public.slots (
  id            uuid primary key default gen_random_uuid(),
  alumni_id     uuid not null references public.alumni_profiles (user_id) on delete cascade,
  starts_at     timestamptz not null,
  duration_min  int not null check (duration_min in (30, 45, 60)),
  is_booked     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (alumni_id, starts_at)
);
create index slots_open_idx on public.slots (alumni_id, starts_at) where not is_booked;

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  slot_id           uuid references public.slots (id) on delete set null,
  alumni_id         uuid not null references public.profiles (id) on delete cascade,
  student_id        uuid not null references public.profiles (id) on delete cascade,
  starts_at         timestamptz not null,
  duration_min      int not null,
  topic             text not null check (char_length(topic) between 1 and 1000),
  note              text not null default '' check (char_length(note) <= 500),
  status            public.booking_status not null default 'booked',
  cancelled_by      uuid references public.profiles (id) on delete set null,
  cancelled_at      timestamptz,
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now()
);
-- The real guarantee against double booking: one active booking per slot.
create unique index bookings_one_active_per_slot on public.bookings (slot_id) where status = 'booked';
create index bookings_student_idx on public.bookings (student_id, starts_at);
create index bookings_alumni_idx on public.bookings (alumni_id, starts_at);

create table public.match_requests (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  query       jsonb not null,
  results     jsonb not null default '[]',
  method      text not null,
  created_at  timestamptz not null default now()
);
create index match_requests_student_idx on public.match_requests (student_id, created_at);

-- ---------------------------------------------------------------- settings
-- Change the domain here if student emails move.
create or replace function public.student_email_domain() returns text
language sql immutable as $$ select 'iitg.ac.in'::text $$;

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'approved' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_listed_alumni(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.alumni_profiles a on a.user_id = p.id
    where p.id = p_user and p.role = 'alumni' and p.status = 'approved' and a.visible
  )
$$;

create or replace function public.shares_booking(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings b
    where (b.student_id = auth.uid() and b.alumni_id = p_other)
       or (b.alumni_id = auth.uid() and b.student_id = p_other)
  )
$$;

-- New sign-up -> profile row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- onboarding
create or replace function public.save_student_profile(
  p_full_name text, p_branch text, p_year text,
  p_project_title text, p_project_summary text, p_seeking text
) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Please sign in again.'; end if;
  if me.role = 'alumni' then raise exception 'This account is registered as an alumnus. Sign in with your IITG email to use a student account.'; end if;
  if me.email not like '%@' || public.student_email_domain() then
    raise exception 'Student accounts need an @% email. Sign in with your institute email.', public.student_email_domain();
  end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Add your name.'; end if;

  update public.profiles
     set full_name = trim(p_full_name),
         role = 'student',
         status = case when status = 'onboarding' then 'approved'::public.account_status else status end,
         updated_at = now()
   where id = me.id;

  insert into public.student_profiles (user_id, branch, year_of_study, project_title, project_summary, seeking)
  values (me.id, p_branch, p_year, trim(p_project_title), trim(coalesce(p_project_summary, '')), trim(p_seeking))
  on conflict (user_id) do update set
    branch = excluded.branch, year_of_study = excluded.year_of_study,
    project_title = excluded.project_title, project_summary = excluded.project_summary,
    seeking = excluded.seeking, updated_at = now();
end $$;

create or replace function public.save_alumni_profile(
  p_full_name text, p_grad_year int, p_degree text, p_branch text,
  p_job_title text, p_organization text, p_city text, p_timezone text,
  p_linkedin_url text, p_meeting_link text, p_skills text[], p_advice_areas text[],
  p_bio text, p_visible boolean
) returns public.account_status
language plpgsql security definer set search_path = public as $$
declare me public.profiles; new_status public.account_status;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Please sign in again.'; end if;
  if me.role = 'student' then raise exception 'This account is registered as a student.'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Add your name.'; end if;
  if coalesce(array_length(p_skills, 1), 0) = 0 then raise exception 'Add at least one skill.'; end if;
  if coalesce(array_length(p_advice_areas, 1), 0) = 0 then raise exception 'Pick at least one area you can advise on.'; end if;

  new_status := case when me.status = 'onboarding' then 'pending'::public.account_status else me.status end;

  update public.profiles
     set full_name = trim(p_full_name), role = 'alumni', status = new_status, updated_at = now()
   where id = me.id;

  insert into public.alumni_profiles (user_id, grad_year, degree, branch, job_title, organization, city, timezone,
                                      linkedin_url, meeting_link, skills, advice_areas, bio, visible)
  values (me.id, p_grad_year, p_degree, p_branch, trim(p_job_title), trim(p_organization), trim(coalesce(p_city, '')),
          coalesce(nullif(p_timezone, ''), 'UTC'), trim(coalesce(p_linkedin_url, '')), trim(p_meeting_link),
          p_skills[1:20], p_advice_areas, trim(coalesce(p_bio, '')), coalesce(p_visible, true))
  on conflict (user_id) do update set
    grad_year = excluded.grad_year, degree = excluded.degree, branch = excluded.branch,
    job_title = excluded.job_title, organization = excluded.organization, city = excluded.city,
    timezone = excluded.timezone, linkedin_url = excluded.linkedin_url, meeting_link = excluded.meeting_link,
    skills = excluded.skills, advice_areas = excluded.advice_areas, bio = excluded.bio,
    visible = excluded.visible, updated_at = now();

  return new_status;
end $$;

-- ---------------------------------------------------------------- availability
-- Adds slots, skipping any in the past (< 1 hour away) or overlapping existing ones.
-- Returns how many were added.
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
    continue when s < now() + interval '1 hour';
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

create or replace function public.remove_slot(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.slots;
begin
  select * into s from public.slots where id = p_slot for update;
  if not found or s.alumni_id <> auth.uid() then raise exception 'Slot not found.'; end if;
  if s.is_booked then raise exception 'A student has booked this slot. Cancel the session first.'; end if;
  delete from public.slots where id = p_slot;
end $$;

-- ---------------------------------------------------------------- booking
create or replace function public.book_slot(p_slot uuid, p_topic text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; s public.slots; new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'student' or me.status <> 'approved' then
    raise exception 'Only signed-in IITG students can book sessions.';
  end if;
  if coalesce(trim(p_topic), '') = '' then raise exception 'Add what you want to cover.'; end if;

  -- Row lock: concurrent bookings of the same slot queue here.
  select * into s from public.slots where id = p_slot for update;
  if not found then raise exception 'That slot is no longer offered.'; end if;
  if s.is_booked then raise exception 'That slot was just taken. Pick another.'; end if;
  if s.starts_at < now() + interval '1 hour' then raise exception 'That slot starts too soon to book.'; end if;
  if not public.is_listed_alumni(s.alumni_id) then raise exception 'This mentor is not taking bookings right now.'; end if;

  if exists (select 1 from public.bookings
             where student_id = me.id and alumni_id = s.alumni_id and status = 'booked' and starts_at > now()) then
    raise exception 'You already have an upcoming session with this mentor.';
  end if;
  if (select count(*) from public.bookings where student_id = me.id and status = 'booked' and starts_at > now()) >= 3 then
    raise exception 'You can hold up to 3 upcoming sessions. Cancel one or wait until one is done.';
  end if;

  insert into public.bookings (slot_id, alumni_id, student_id, starts_at, duration_min, topic, note)
  values (s.id, s.alumni_id, me.id, s.starts_at, s.duration_min, trim(p_topic), trim(coalesce(p_note, '')))
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
  -- Reopen the slot unless it is about to start.
  update public.slots set is_booked = false where id = b.slot_id and starts_at > now() + interval '1 hour';
end $$;

-- ---------------------------------------------------------------- admin
create or replace function public.admin_set_status(p_user uuid, p_status public.account_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only organizers can do this.'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'Invalid status.'; end if;
  update public.profiles set status = p_status, updated_at = now() where id = p_user and role is not null;
  if not found then raise exception 'User not found.'; end if;
end $$;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles         enable row level security;
alter table public.alumni_profiles  enable row level security;
alter table public.student_profiles enable row level security;
alter table public.slots            enable row level security;
alter table public.bookings         enable row level security;
alter table public.match_requests   enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin()
  or (public.is_approved() and public.is_listed_alumni(id))
  or public.shares_booking(id)
);

create policy alumni_read on public.alumni_profiles for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
  or (public.is_approved() and public.is_listed_alumni(user_id))
  or public.shares_booking(user_id)
);

create policy students_read on public.student_profiles for select to authenticated using (
  user_id = auth.uid() or public.is_admin() or public.shares_booking(user_id)
);

create policy slots_read on public.slots for select to authenticated using (
  alumni_id = auth.uid() or public.is_admin()
  or (public.is_approved() and public.is_listed_alumni(alumni_id))
);

create policy bookings_read on public.bookings for select to authenticated using (
  student_id = auth.uid() or alumni_id = auth.uid() or public.is_admin()
);

create policy match_read on public.match_requests for select to authenticated using (
  student_id = auth.uid() or public.is_admin()
);

-- No write policies: clients cannot insert/update/delete directly.
-- Column-level privacy: other users never see emails or meeting links.
revoke all on public.profiles, public.alumni_profiles, public.student_profiles,
              public.slots, public.bookings, public.match_requests from anon, authenticated;

grant select (id, full_name, role, status, is_admin, created_at) on public.profiles to authenticated;
grant select (user_id, grad_year, degree, branch, job_title, organization, city, timezone,
              linkedin_url, skills, advice_areas, bio, visible, updated_at) on public.alumni_profiles to authenticated;
grant select on public.student_profiles, public.slots, public.bookings, public.match_requests to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.save_student_profile(text, text, text, text, text, text),
  public.save_alumni_profile(text, int, text, text, text, text, text, text, text, text, text[], text[], text, boolean),
  public.add_slots(timestamptz[], int),
  public.remove_slot(uuid),
  public.book_slot(uuid, text, text),
  public.cancel_booking(uuid),
  public.admin_set_status(uuid, public.account_status),
  public.is_admin(), public.is_approved(), public.is_listed_alumni(uuid), public.shares_booking(uuid),
  public.student_email_domain()
to authenticated;
