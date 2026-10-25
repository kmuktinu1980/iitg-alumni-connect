-- Quick mentor sign-up:
--   * the meeting link and skills are optional when the profile is first saved,
--     and required before opening slots;
--   * organizers can pre-approve mentors by email or with a shareable invite link.

-- ---------------------------------------------------------------- optional at sign-up
alter table public.alumni_profiles drop constraint if exists alumni_profiles_meeting_link_check;
alter table public.alumni_profiles add constraint alumni_profiles_meeting_link_check
  check (meeting_link = '' or meeting_link ~* '^https://');
alter table public.alumni_profiles alter column meeting_link set default '';

-- ---------------------------------------------------------------- invites
-- Emails an organizer has pre-approved as mentors.
create table if not exists public.alumni_invites (
  email       text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note        text not null default '',
  invited_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Shareable links (e.g. posted in an alumni WhatsApp group). Anyone who signs up
-- through a valid link is approved straight away.
create table if not exists public.invite_links (
  code        text primary key check (code ~ '^[a-z0-9]{8,32}$'),
  label       text not null default '' check (char_length(label) <= 120),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uses    int not null check (max_uses between 1 and 1000),
  uses        int not null default 0,
  revoked     boolean not null default false
);

alter table public.alumni_invites enable row level security;
alter table public.invite_links enable row level security;
revoke all on public.alumni_invites, public.invite_links from anon, authenticated;

-- How each mentor got approved: 'organizer', 'invite:<email>' or 'link:<code>'.
alter table public.profiles add column if not exists approved_via text not null default '';

create or replace function public.invite_link_ok(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invite_links
    where code = lower(trim(coalesce(p_code, ''))) and not revoked and expires_at > now() and uses < max_uses
  ) $$;

-- ---------------------------------------------------------------- save profile
drop function if exists public.save_alumni_profile(text, int, text, text, text, text, text, text, text, text, text[], text[], text, boolean);

create or replace function public.save_alumni_profile(
  p_full_name text, p_grad_year int, p_degree text, p_branch text,
  p_job_title text, p_organization text, p_city text, p_timezone text,
  p_linkedin_url text, p_meeting_link text, p_skills text[], p_advice_areas text[],
  p_bio text, p_visible boolean, p_invite text default null
) returns public.account_status
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; new_status public.account_status; via text := '';
  invite_code text := lower(trim(coalesce(p_invite, '')));
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Please sign in again.'; end if;
  if me.role = 'student' then raise exception 'This account is registered as a student.'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Add your name.'; end if;
  if coalesce(array_length(p_advice_areas, 1), 0) = 0 then raise exception 'Pick at least one area you can advise on.'; end if;
  if trim(coalesce(p_meeting_link, '')) = '' and exists (
       select 1 from public.slots where alumni_id = me.id and starts_at > now()) then
    raise exception 'Keep a meeting link while you have upcoming slots. Students use it to join.';
  end if;

  new_status := me.status;
  if me.status = 'onboarding' then
    new_status := 'pending';
    if exists (select 1 from public.alumni_invites where email = lower(me.email)) then
      new_status := 'approved'; via := 'invite:' || lower(me.email);
    elsif invite_code <> '' then
      -- Claim one use of the link, atomically.
      update public.invite_links set uses = uses + 1
       where code = invite_code and not revoked and expires_at > now() and uses < max_uses;
      if found then new_status := 'approved'; via := 'link:' || invite_code; end if;
    end if;
  end if;

  update public.profiles
     set full_name = trim(p_full_name), role = 'alumni', status = new_status, updated_at = now(),
         approved_via = case when via <> '' then via else approved_via end
   where id = me.id;

  insert into public.alumni_profiles (user_id, grad_year, degree, branch, job_title, organization, city, timezone,
                                      linkedin_url, meeting_link, skills, advice_areas, bio, visible)
  values (me.id, p_grad_year, p_degree, p_branch, trim(p_job_title), trim(p_organization), trim(coalesce(p_city, '')),
          coalesce(nullif(p_timezone, ''), 'UTC'), trim(coalesce(p_linkedin_url, '')), trim(coalesce(p_meeting_link, '')),
          coalesce(p_skills[1:20], '{}'), p_advice_areas, trim(coalesce(p_bio, '')), coalesce(p_visible, true))
  on conflict (user_id) do update set
    grad_year = excluded.grad_year, degree = excluded.degree, branch = excluded.branch,
    job_title = excluded.job_title, organization = excluded.organization, city = excluded.city,
    timezone = excluded.timezone, linkedin_url = excluded.linkedin_url, meeting_link = excluded.meeting_link,
    skills = excluded.skills, advice_areas = excluded.advice_areas, bio = excluded.bio,
    visible = excluded.visible, updated_at = now();

  return new_status;
end $$;

-- Before opening slots: a meeting link (students need it to join) and some skills (matching needs them).
create or replace function public.slot_setup_missing() returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when coalesce(a.meeting_link, '') = '' then 'meeting_link' end,
    case when coalesce(array_length(a.skills, 1), 0) = 0 then 'skills' end
  ], null)
  from public.profiles p left join public.alumni_profiles a on a.user_id = p.id
  where p.id = auth.uid() $$;

create or replace function public.save_slot_setup(p_meeting_link text, p_skills text[]) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles; link text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'alumni' then raise exception 'Only alumni can do this.'; end if;
  -- An empty link keeps the one already saved.
  select coalesce(nullif(trim(coalesce(p_meeting_link, '')), ''), meeting_link) into link
    from public.alumni_profiles where user_id = me.id;
  if coalesce(link, '') !~* '^https://[^\s/]+\.[^\s]+$' then raise exception 'Add your meeting link.'; end if;
  if coalesce(array_length(p_skills, 1), 0) = 0 then raise exception 'Add at least one skill.'; end if;
  update public.alumni_profiles
     set meeting_link = link, skills = p_skills[1:20], updated_at = now()
   where user_id = me.id;
end $$;

create or replace function public.add_slots(p_starts timestamptz[], p_duration int) returns int
language plpgsql security definer set search_path = public as $$
declare me public.profiles; a public.alumni_profiles; s timestamptz; added int := 0; future_count int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.role <> 'alumni' or me.status <> 'approved' then
    raise exception 'Only approved alumni can open slots.';
  end if;
  select * into a from public.alumni_profiles where user_id = me.id;
  if coalesce(a.meeting_link, '') = '' then raise exception 'Add your meeting link before opening slots.'; end if;
  if coalesce(array_length(a.skills, 1), 0) = 0 then raise exception 'Add a few skills before opening slots, so students can find you.'; end if;
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

-- ---------------------------------------------------------------- organizer tools
create or replace function public.admin_add_invites(p_emails text[], p_note text default '') returns int
language plpgsql security definer set search_path = public as $$
declare e text; n int := 0; clean text;
begin
  if not public.is_admin() then raise exception 'Organizers only.'; end if;
  foreach e in array coalesce(p_emails, '{}') loop
    clean := lower(trim(e));
    continue when clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    insert into public.alumni_invites (email, note, invited_by) values (clean, left(coalesce(p_note, ''), 200), auth.uid())
    on conflict (email) do nothing;
    if found then n := n + 1; end if;
    -- Someone already waiting for approval with this email is approved now.
    update public.profiles set status = 'approved', approved_via = 'invite:' || clean, updated_at = now()
     where lower(email) = clean and role = 'alumni' and status = 'pending';
  end loop;
  return n;
end $$;

create or replace function public.admin_remove_invite(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Organizers only.'; end if;
  delete from public.alumni_invites where email = lower(trim(p_email));
end $$;

create or replace function public.admin_create_invite_link(p_label text, p_days int, p_max_uses int) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin() then raise exception 'Organizers only.'; end if;
  if p_days not between 1 and 90 then raise exception 'Links can last 1 to 90 days.'; end if;
  if p_max_uses not between 1 and 1000 then raise exception 'Allow between 1 and 1000 sign-ups.'; end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12); -- 48 random bits, lowercase hex
  insert into public.invite_links (code, label, created_by, expires_at, max_uses)
  values (c, left(trim(coalesce(p_label, '')), 120), auth.uid(), now() + make_interval(days => p_days), p_max_uses);
  return c;
end $$;

create or replace function public.admin_revoke_invite_link(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Organizers only.'; end if;
  update public.invite_links set revoked = true where code = lower(trim(p_code));
end $$;

revoke all on function
  public.invite_link_ok(text),
  public.save_alumni_profile(text, int, text, text, text, text, text, text, text, text, text[], text[], text, boolean, text),
  public.slot_setup_missing(), public.save_slot_setup(text, text[]),
  public.admin_add_invites(text[], text), public.admin_remove_invite(text),
  public.admin_create_invite_link(text, int, int), public.admin_revoke_invite_link(text)
from public, anon;
grant execute on function public.invite_link_ok(text) to anon, authenticated;
grant execute on function
  public.save_alumni_profile(text, int, text, text, text, text, text, text, text, text, text[], text[], text, boolean, text),
  public.slot_setup_missing(), public.save_slot_setup(text, text[]),
  public.admin_add_invites(text[], text), public.admin_remove_invite(text),
  public.admin_create_invite_link(text, int, int), public.admin_revoke_invite_link(text)
to authenticated;
