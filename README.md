# IITG Alumni Connect

A mentoring site for IIT Guwahati. Alumni volunteer their skills and open slots on their calendar; students describe their project and the advice they want, get alumni ranked by fit, and book a slot. Both sides get an email with a calendar invite and the meeting link.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres, Auth, row-level security) · Vercel (hosting + daily cron) · Resend (email) · Claude API (matching).

---

## How it works

| Who | Signs in with | Gets in |
|---|---|---|
| Students | Email link to their `@iitg.ac.in` address | Immediately (the domain is the proof) |
| Alumni | Email link to any address; profile auto-filled from a few lines they type or dictate, or their LinkedIn PDF | Immediately if invited (pre-approved email or invite link), otherwise after an organizer approves them |
| Organizers | Any of the above, then marked admin in the database | Organizer page |

- **Alumni** describe themselves in a few lines (guided prompts and an example; phone dictation works) or upload their LinkedIn PDF, and Claude fills in batch, branch, role, skills, advice areas and a bio, plus up to three follow-up questions for anything missing. Only the essentials are needed to sign up; the meeting link (Zoom/Meet) and skills are asked for before their first slot. Then they open 30/45/60-minute slots, one-off or weekly.
- **Invites:** on the Organizer page, pre-approve mentors by email, or create an invite link (`/join/<code>`, with an expiry and a sign-up limit) to post in an alumni group. Mentors who come in either way skip the approval wait; the profile records how each was approved (`profiles.approved_via`).
- **Students** describe their project and question. Claude reads every listed alumni profile and returns up to five with a fit score and a one-line reason. If the API key is missing or the call fails, a keyword ranking is used instead.
- **Booking** is first come, first served, at least **48 hours ahead** so mentors have time to read the brief. The database guarantees one booking per slot, one upcoming session per student–mentor pair, and at most three upcoming sessions per student. A cancelled slot reopens only if it's still 48+ hours away.
- **Specificity check:** before a booking goes through, the student's "what do you want to cover" is checked. Obviously vague briefs ("career guidance", "help with my project") are caught by simple rules; anything else is judged by Claude (Haiku by default). If the brief is too vague, the student sees what's missing and a sharper rewrite of their own text, with `[brackets]` for details only they know. They can use it, edit, or book as written. The outcome is stored on the booking (`brief_check`) so organizers can see brief quality.
- **Email:** booking confirmation with a calendar invite to both people, cancellation (removes the event), a reminder the day before, and an approval email to alumni.
- **Privacy:** students never see alumni emails; meeting links are shown only to the student who booked; an alumnus sees a student's project and email only once that student books them.

## Repository layout

```
supabase/migrations/                Schema, security rules and all write logic
supabase/tests/schema.test.mjs      49 tests run against an in-memory Postgres
src/app/                            Pages: /, /login, /onboarding, /pending, /find,
                                    /sessions, /availability, /profile, /admin
src/app/actions.ts                  Server actions (each calls a database function)
src/app/api/match/route.ts          Matching endpoint (rate-limited, logged)
src/app/api/cron/reminders/route.ts Daily reminder job
src/lib/matching.ts                 Claude ranking + keyword fallback
src/lib/brief-check.ts, brief-rules.ts  Specificity check (Claude + rules)
src/lib/email.ts, src/lib/ics.ts    Emails and calendar invites
```

All writes go through `SECURITY DEFINER` database functions that check who is calling. Clients can only read, and only what row-level security allows. The service-role key is used on the server only for emails, private fields and the organizer page, each after the app has checked the user.

---

## Setup (about 45 minutes)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough for a pilot). Pick a region near India, such as Mumbai.
2. Open **SQL Editor** and run each file in `supabase/migrations/` in order (`0001_init.sql`, `0002_notice_and_brief_check.sql`, `0003_advisor_tidy.sql`, `0004_student_allowlist.sql`, `0005_admin_stats.sql`, `0006_quick_signup.sql`).
3. **Authentication → URL Configuration**
   - Site URL: your production URL, e.g. `https://iitg-alumni-connect.vercel.app`
   - Redirect URLs: add `https://YOUR-DOMAIN/auth/callback` and `http://localhost:3000/auth/callback`
4. **Authentication → Sign In / Providers → Email:** enabled (the default). Everyone signs in with an emailed link; no Google or LinkedIn app setup is needed.
   - **Recommended, for links opened on phones:** under **Authentication → Emails → Templates** (needs custom SMTP), edit both **Confirm signup** and **Magic Link** so the link is
     `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
     The default link only works in the same browser that requested it, which fails when someone opens the email in their mail app.
5. **Authentication → Emails → SMTP Settings:** turn on custom SMTP with your Resend credentials (step 2). Supabase's built-in sender is rate-limited to a handful of emails per hour, which isn't enough for real sign-ins.
6. **Project Settings → API:** copy the project URL, the `anon` key and the `service_role` key.

### 2. Resend (email)

1. Create an account at [resend.com](https://resend.com) and verify a domain you control (add the DNS records it shows).
2. Create an API key.
3. Choose a from-address on that domain, e.g. `IITG Alumni Connect <connect@yourdomain.org>`.
4. Use the same domain for Supabase SMTP (host `smtp.resend.com`, port 465, user `resend`, password = API key).

### 3. Claude API (matching)

Create a key at [console.anthropic.com](https://console.anthropic.com) **inside a workspace** (pick the workspace, e.g. Default, before clicking Create Key; an organization-level key fails with "not scoped to a workspace" unless you also set `ANTHROPIC_WORKSPACE_ID`). The API is billed separately from Claude Pro/Max plans, so add prepaid credit under Billing. It powers three things:

- **Matching** uses `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Cost per search grows with the number of alumni; each student is limited to 20 searches a day.
- **The specificity check** uses `ANTHROPIC_CHECK_MODEL` (default `claude-haiku-5-5`). It's one short call per booking attempt.

- **LinkedIn autofill** uses `ANTHROPIC_MODEL`. One call per profile; limited to 10 a day per person.

Without a key, matching uses keyword overlap, the specificity check uses rules only, and alumni fill their profile by hand.

### 4. Deploy to Vercel

1. Import this GitHub repo at [vercel.com/new](https://vercel.com/new).
2. Add the environment variables from `.env.example`:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase `anon` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` key (keep secret) |
   | `NEXT_PUBLIC_SITE_URL` | Your production URL |
   | `ANTHROPIC_API_KEY` | Claude API key |
   | `RESEND_API_KEY` | Resend API key |
   | `EMAIL_FROM` | e.g. `IITG Alumni Connect <connect@yourdomain.org>` |
   | `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |

3. Deploy. `vercel.json` schedules the reminder job daily at 13:30 UTC (7 PM IST); Vercel sends `CRON_SECRET` automatically.

### 5. Make yourself an organizer

Sign in once on the live site, then run this in the Supabase SQL Editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

Reload the site and the **Organizer** tab appears. New alumni wait there for approval.

---

## Tests

| Command | What it covers | Needs |
|---|---|---|
| `npm run test:db` | Booking, privacy, analytics and invite rules in an in-memory Postgres (49 tests) | Nothing |
| `npm run test:api` | The five steel threads over the real Supabase API, as real signed-in users (27 tests) | A Supabase API to point at |

**The API steel threads** (`tests/api/steel-threads.test.ts`):

1. **Alumni registration:** sign up → profile → pending → only an organizer can approve → listed for students. Also: pre-approved emails and invite links skip review (links stop at their limit); meeting link and skills required before the first slot.
2. **Student sign-up:** `@iitg.ac.in` approved instantly; other emails refused; allow-listed emails accepted; students never see emails or meeting links.
3. **Student booking:** slots inside 48 hours skipped; one-line briefs refused; one booking per slot; one upcoming session per mentor; alumni can't book.
4. **Calendars:** the session appears for both people and nobody else; the mentor sees the project brief; the calendar invite and Google Calendar link have the right time, people and meeting link; cancelling removes it and reopens the slot.
5. **Admin analytics:** organizers only; a session counts as completed once its time passes (time-travelled in the test); cancelled sessions never count as completed.

**Run them locally** against a throwaway Supabase built from the migrations (needs Postgres 16 on port 54322):

```bash
bash tests/stack/start.sh                      # Auth + PostgREST + migrations, about 5 seconds
set -a && . tests/stack/.env.test && set +a
npm run test:api
```

**Or against a Supabase project** (ideally a separate test project): set `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY` and `TEST_SUPABASE_SERVICE_ROLE_KEY`. Each run creates throwaway accounts tagged with a run id (no emails are sent) and deletes everything it created.

**CI:** `.github/workflows/tests.yml` runs the type-check, database tests and API steel threads on every push and pull request, against a fresh Postgres each time.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase keys; email and Claude keys are optional
npm run dev                  # http://localhost:3000
npm run test:db              # schema and booking-rule tests (no Supabase needed)
npm run typecheck
```

Without `RESEND_API_KEY`, emails are logged to the console instead of sent. Without `ANTHROPIC_API_KEY`, matching uses keyword overlap.

## Things to know

- **Letting a non-IITG email register as a student** (testing, or a student whose institute email isn't working): in the SQL Editor run
  `insert into public.student_email_allowlist (email, note) values ('name@gmail.com', 'why');`
  and remove it later with `delete from public.student_email_allowlist where email = 'name@gmail.com';`

- **Student email domain** is `iitg.ac.in`, set in `public.student_email_domain()` in the migration and `STUDENT_EMAIL_DOMAIN` in `src/lib/constants.ts`. Change both if needed.
- **Institute mail filters** sometimes delay sign-in links to `@iitg.ac.in`. If students report missing links, ask IT to allow your sending domain.
- **One role per account.** To test both sides yourself, use a student account and a separate alumni account.
- **Limits** (in the migrations): slots are 30, 45 or 60 minutes and must be booked at least 48 hours ahead (`public.min_notice()`, mirrored by `MIN_NOTICE_HOURS` in `src/lib/constants.ts`; change both together); briefs need at least 40 characters; 60 upcoming slots per alumnus; 3 upcoming sessions per student.
