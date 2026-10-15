-- Let specific non-IITG emails register as students (testing, visiting
-- students, or students whose institute email isn't working yet).
--
-- Add someone:    insert into public.student_email_allowlist (email, note) values ('name@gmail.com', 'why');
-- Remove someone: delete from public.student_email_allowlist where email = 'name@gmail.com';

create table if not exists public.student_email_allowlist (
  email       text primary key check (email = lower(email)),
  note        text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.student_email_allowlist enable row level security;
revoke all on public.student_email_allowlist from anon, authenticated;

-- True for @iitg.ac.in addresses and allow-listed ones. Callable before
-- sign-in so the login page can check an address.
create or replace function public.is_student_email(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(trim(coalesce(p_email, ''))) like '%@' || public.student_email_domain()
      or exists (select 1 from public.student_email_allowlist a where a.email = lower(trim(coalesce(p_email, ''))))
$$;

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
  if not public.is_student_email(me.email) then
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

revoke execute on function public.is_student_email(text) from public;
grant execute on function public.is_student_email(text) to anon, authenticated;
