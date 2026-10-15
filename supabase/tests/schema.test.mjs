import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

// Applies every migration in the given directory, in filename order.
const db = new PGlite();
const dir = process.argv[2];
const migrations = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  grant usage on schema public to authenticated, anon;
`);
for (const f of migrations) await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
const T = "Validate the LoRa sensor design and power budget before field trials";

const U = {
  alum: "00000000-0000-0000-0000-00000000000a",
  stu1: "00000000-0000-0000-0000-000000000001",
  stu2: "00000000-0000-0000-0000-000000000002",
  outsider: "00000000-0000-0000-0000-00000000000f",
  admin: "00000000-0000-0000-0000-0000000000ad",
  stu3: "00000000-0000-0000-0000-000000000003",
};
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
   ('${U.alum}', 'Alum@gmail.com', '{"full_name":"Asha Alum"}'),
   ('${U.stu1}', 'stu1@iitg.ac.in', '{}'),
   ('${U.stu2}', 'stu2@iitg.ac.in', '{}'),
   ('${U.outsider}', 'someone@gmail.com', '{}'),
   ('${U.admin}', 'admin@gmail.com', '{}'),
   ('${U.stu3}', 'stu3@iitg.ac.in', '{}');
  update public.profiles set is_admin = true where id = '${U.admin}';
`);

let pass = 0, fail = 0;
async function as(user, sql, params = [], role = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false);`);
  if (role) await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}
async function expectOk(name, fn){ try { const r = await fn(); console.log("PASS", name); pass++; return r; } catch(e){ console.log("FAIL", name, "->", e.message); fail++; } }
async function expectErr(name, fn, re){ try { await fn(); console.log("FAIL", name, "-> no error"); fail++; } catch(e){ if (re.test(e.message)) { console.log("PASS", name, "|", e.message); pass++; } else { console.log("FAIL", name, "-> wrong error:", e.message); fail++; } } }

const stud = (u) => as(u, `select public.save_student_profile('Stu', 'CSE', '3rd year', 'Flood sensor', 'LoRa mesh', 'Hardware validation')`);
const alum = () => as(U.alum, `select public.save_alumni_profile('Asha Alum', 2001, 'B.Tech', 'ECE', 'Director', 'Acme', 'Seattle', 'America/Los_Angeles', '', 'https://meet.google.com/abc', array['IoT','Embedded'], array['Startups & founding'], 'Bio', true) as s`);

await expectOk("profile row created on sign-up (email lowercased)", async () => {
  const r = await db.query(`select email, full_name, status from public.profiles where id = $1`, [U.alum]);
  if (r.rows[0].email !== "alum@gmail.com" || r.rows[0].status !== "onboarding") throw new Error(JSON.stringify(r.rows));
});
await expectErr("non-IITG email can't become a student", () => stud(U.outsider), /iitg\.ac\.in/);
await expectOk("IITG student auto-approved", async () => { await stud(U.stu1); await stud(U.stu2); await stud(U.stu3);
  const r = await db.query(`select status from public.profiles where id=$1`, [U.stu1]); if (r.rows[0].status !== "approved") throw new Error(r.rows[0].status); });
await expectOk("alumni sign-up goes to pending", async () => { const r = await alum(); if (r.rows[0].s !== "pending") throw new Error(r.rows[0].s); });
await expectErr("pending alumni can't open slots", () => as(U.alum, `select public.add_slots(array[now() + interval '3 days'], 30)`), /approved alumni/);
await expectErr("non-admin can't approve", () => as(U.alum, `select public.admin_set_status($1, 'approved')`, [U.alum]), /organizers/);
await expectOk("admin approves alumnus", () => as(U.admin, `select public.admin_set_status($1, 'approved')`, [U.alum]));
await expectOk("re-saving profile keeps approved status", async () => { const r = await alum(); if (r.rows[0].s !== "approved") throw new Error(r.rows[0].s); });

await expectOk("add_slots skips past, inside-48h and overlapping slots", async () => {
  const r = await as(U.alum, `select public.add_slots(array[
     now() + interval '3 days', now() + interval '3 days 15 minutes', now() - interval '1 day',
     now() + interval '30 hours', now() + interval '4 days', now() + interval '5 days'], 30) as n`);
  if (r.rows[0].n !== 3) throw new Error("added " + r.rows[0].n); return r;
});
const slots = (await db.query(`select id from public.slots order by starts_at`)).rows.map(r => r.id);

let b1;
await expectErr("vague one-word brief is rejected", () => as(U.stu1, `select public.book_slot($1, 'Career', '')`, [slots[0]]), /at least 40 characters/);
await expectOk("student books a slot; brief check is stored", async () => {
  b1 = (await as(U.stu1, `select public.book_slot($1, $2, '', '{"verdict":"specific","method":"claude"}'::jsonb) as id`, [slots[0], T])).rows[0].id;
  const r = await db.query(`select brief_check->>'verdict' as v from public.bookings where id=$1`, [b1]);
  if (r.rows[0].v !== "specific") throw new Error(JSON.stringify(r.rows));
});
await expectErr("second student can't take the same slot", () => as(U.stu2, `select public.book_slot($1, $2, '')`, [slots[0], T]), /just taken/);
await expectErr("one upcoming session per mentor", () => as(U.stu1, `select public.book_slot($1, $2, '')`, [slots[1], T]), /already have an upcoming/);
await expectErr("alumni can't book", () => as(U.alum, `select public.book_slot($1, $2, '')`, [slots[1], T]), /students/);
await expectErr("can't remove a booked slot", () => as(U.alum, `select public.remove_slot($1)`, [slots[0]]), /booked/);
await expectErr("unique index blocks a raw double booking", () => db.query(
  `insert into public.bookings (slot_id, alumni_id, student_id, starts_at, duration_min, topic) select id, alumni_id, $2, starts_at, 30, 't' from public.slots where id=$1`, [slots[0], U.stu2]), /duplicate key/);

// row-level security and column privacy
await expectErr("students can't read other people's emails", () => as(U.stu2, `select email from public.profiles`), /permission denied/);
await expectErr("students can't read meeting links directly", () => as(U.stu2, `select meeting_link from public.alumni_profiles`), /permission denied/);
await expectErr("no direct writes from clients", () => as(U.stu2, `update public.slots set is_booked=false`), /permission denied/);
await expectOk("approved student sees listed alumni + open slots", async () => {
  const a = await as(U.stu2, `select user_id from public.alumni_profiles`);
  const s = await as(U.stu2, `select id from public.slots where not is_booked`);
  if (a.rows.length !== 1 || s.rows.length !== 2) throw new Error(`alumni ${a.rows.length}, slots ${s.rows.length}`);
});
await expectOk("students can't see each other's bookings", async () => {
  const r = await as(U.stu2, `select id from public.bookings`); if (r.rows.length !== 0) throw new Error(r.rows.length);
});
await expectOk("alumnus sees only students who booked them", async () => {
  const r = await as(U.alum, `select user_id from public.student_profiles`);
  if (r.rows.length !== 1 || r.rows[0].user_id !== U.stu1) throw new Error(JSON.stringify(r.rows));
});
await expectOk("onboarding user can't see alumni yet", async () => {
  const r = await as(U.outsider, `select user_id from public.alumni_profiles`); if (r.rows.length !== 0) throw new Error(r.rows.length);
});

await expectErr("other student can't cancel", () => as(U.stu2, `select public.cancel_booking($1)`, [b1]), /not found/);
await expectOk("student cancels; slot reopens", async () => {
  await as(U.stu1, `select public.cancel_booking($1)`, [b1]);
  const r = await db.query(`select is_booked from public.slots where id=$1`, [slots[0]]); if (r.rows[0].is_booked) throw new Error("still booked");
});
await expectOk("another student can now book the reopened slot", () => as(U.stu2, `select public.book_slot($1, $2, '')`, [slots[0], T]));
await expectOk("hidden alumnus disappears from listings", async () => {
  await as(U.alum, `select public.save_alumni_profile('Asha Alum', 2001, 'B.Tech', 'ECE', 'Director', 'Acme', 'Seattle', 'UTC', '', 'https://meet.google.com/abc', array['IoT'], array['Research'], '', false)`);
  const r = await as(U.stu3, `select user_id from public.alumni_profiles`); if (r.rows.length !== 0) throw new Error(r.rows.length);
  await expectErr("can't book a hidden alumnus", () => as(U.stu3, `select public.book_slot($1, $2, '')`, [slots[2], T]), /not taking bookings/);
});

// 48-hour notice
await expectErr("can't book a slot less than 48 hours away", async () => {
  await as(U.alum, `select public.save_alumni_profile('Asha Alum', 2001, 'B.Tech', 'ECE', 'Director', 'Acme', 'Seattle', 'UTC', '', 'https://meet.google.com/abc', array['IoT'], array['Research'], '', true)`);
  const id = (await db.query(`insert into public.slots (alumni_id, starts_at, duration_min) values ($1, now() + interval '30 hours', 30) returning id`, [U.alum])).rows[0].id;
  await as(U.stu3, `select public.book_slot($1, $2, '')`, [id, T]);
}, /48 hours ahead/);
await expectOk("cancelling inside 48 hours does not reopen the slot", async () => {
  const sid = (await db.query(`insert into public.slots (alumni_id, starts_at, duration_min, is_booked) values ($1, now() + interval '20 hours', 30, true) returning id`, [U.alum])).rows[0].id;
  const bid = (await db.query(`insert into public.bookings (slot_id, alumni_id, student_id, starts_at, duration_min, topic) values ($1, $2, $3, now() + interval '20 hours', 30, $4) returning id`, [sid, U.alum, U.stu3, T])).rows[0].id;
  await as(U.stu3, `select public.cancel_booking($1)`, [bid]);
  const r = await db.query(`select is_booked from public.slots where id=$1`, [sid]);
  if (!r.rows[0].is_booked) throw new Error("slot reopened inside the 48-hour window");
});

// student allow-list
await expectErr("non-IITG email still can't become a student", () => stud(U.outsider), /iitg\.ac\.in/);
await expectOk("allow-listed email can become a student", async () => {
  await db.query(`insert into public.student_email_allowlist (email, note) values ('someone@gmail.com', 'test')`);
  await stud(U.outsider);
  const r = await db.query(`select role, status from public.profiles where id=$1`, [U.outsider]);
  if (r.rows[0].role !== "student" || r.rows[0].status !== "approved") throw new Error(JSON.stringify(r.rows));
});
await expectOk("is_student_email is case-insensitive and callable before sign-in", async () => {
  const r = await as("", `select public.is_student_email('SomeOne@Gmail.com ') a, public.is_student_email('x@iitg.ac.in') b, public.is_student_email('x@gmail.com') c`, [], "anon");
  if (!(r.rows[0].a && r.rows[0].b && !r.rows[0].c)) throw new Error(JSON.stringify(r.rows));
});
await expectErr("clients can't read the allow-list", () => as(U.stu1, `select * from public.student_email_allowlist`), /permission denied/);

// admin analytics
await expectErr("non-organizers can't read analytics", () => as(U.stu1, `select public.admin_stats()`), /organizers/);
await expectOk("finished session appears in analytics", async () => {
  const before = (await as(U.admin, `select public.admin_stats() s`)).rows[0].s;
  // A booked session whose end time has passed (simulates the session date arriving).
  const sid = (await db.query(`insert into public.slots (alumni_id, starts_at, duration_min, is_booked) values ($1, now() - interval '2 hours', 45, true) returning id`, [U.alum])).rows[0].id;
  const bid = (await db.query(`insert into public.bookings (slot_id, alumni_id, student_id, starts_at, duration_min, topic) values ($1, $2, $3, now() - interval '2 hours', 45, $4) returning id`, [sid, U.alum, U.stu2, T])).rows[0].id;
  const after = (await as(U.admin, `select public.admin_stats() s`)).rows[0].s;
  if (after.completed_sessions !== before.completed_sessions + 1) throw new Error(`completed ${before.completed_sessions} -> ${after.completed_sessions}`);
  if (after.completed_minutes !== before.completed_minutes + 45) throw new Error(`minutes ${before.completed_minutes} -> ${after.completed_minutes}`);
  if (!after.recent_completed.some((r) => r.id === bid && r.alumni_name === "Asha Alum")) throw new Error("not in recent_completed");
  if (!after.completed_by_mentor.some((m) => m.alumni_id === U.alum)) throw new Error("not in completed_by_mentor");
});
await expectOk("upcoming and cancelled sessions are not counted as completed", async () => {
  const s = (await as(U.admin, `select public.admin_stats() s`)).rows[0].s;
  const r = await db.query(`select count(*)::int n from public.bookings where status='booked' and starts_at + make_interval(mins => duration_min) <= now()`);
  if (s.completed_sessions !== r.rows[0].n) throw new Error(`${s.completed_sessions} vs ${r.rows[0].n}`);
  if (s.cancelled_sessions < 1) throw new Error("expected the earlier cancelled booking to be counted as cancelled");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
