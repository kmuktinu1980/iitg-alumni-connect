import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const db = new PGlite();
const migration = fs.readFileSync(process.argv[2], "utf8");

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  grant usage on schema public to authenticated, anon;
`);
await db.exec(migration);

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
await expectErr("pending alumni can't open slots", () => as(U.alum, `select public.add_slots(array[now() + interval '2 days'], 30)`), /approved alumni/);
await expectErr("non-admin can't approve", () => as(U.alum, `select public.admin_set_status($1, 'approved')`, [U.alum]), /organizers/);
await expectOk("admin approves alumnus", () => as(U.admin, `select public.admin_set_status($1, 'approved')`, [U.alum]));
await expectOk("re-saving profile keeps approved status", async () => { const r = await alum(); if (r.rows[0].s !== "approved") throw new Error(r.rows[0].s); });

const added = await expectOk("add_slots skips past + overlapping", async () => {
  const r = await as(U.alum, `select public.add_slots(array[
     now() + interval '2 days', now() + interval '2 days 15 minutes', now() - interval '1 day',
     now() + interval '3 days', now() + interval '4 days'], 30) as n`);
  if (r.rows[0].n !== 3) throw new Error("added " + r.rows[0].n); return r;
});
const slots = (await db.query(`select id from public.slots order by starts_at`)).rows.map(r => r.id);

let b1;
await expectOk("student books a slot", async () => { b1 = (await as(U.stu1, `select public.book_slot($1, 'Validate sensor', '') as id`, [slots[0]])).rows[0].id; });
await expectErr("second student can't take the same slot", () => as(U.stu2, `select public.book_slot($1, 'x', '')`, [slots[0]]), /just taken/);
await expectErr("one upcoming session per mentor", () => as(U.stu1, `select public.book_slot($1, 'x', '')`, [slots[1]]), /already have an upcoming/);
await expectErr("alumni can't book", () => as(U.alum, `select public.book_slot($1, 'x', '')`, [slots[1]]), /students/);
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
await expectOk("another student can now book the reopened slot", () => as(U.stu2, `select public.book_slot($1, 'Career', '')`, [slots[0]]));
await expectOk("hidden alumnus disappears from listings", async () => {
  await as(U.alum, `select public.save_alumni_profile('Asha Alum', 2001, 'B.Tech', 'ECE', 'Director', 'Acme', 'Seattle', 'UTC', '', 'https://meet.google.com/abc', array['IoT'], array['Research'], '', false)`);
  const r = await as(U.stu3, `select user_id from public.alumni_profiles`); if (r.rows.length !== 0) throw new Error(r.rows.length);
  await expectErr("can't book a hidden alumnus", () => as(U.stu3, `select public.book_slot($1, 'x', '')`, [slots[2]]), /not taking bookings/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
