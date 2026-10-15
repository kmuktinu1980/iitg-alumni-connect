// API steel threads for IITG Alumni Connect.
//
//   1. Alumni registration      sign up -> profile -> pending -> organizer approves -> listed
//   2. Student sign-up          IITG email or allow-listed email -> student profile; others refused
//   3. Student booking          alumnus opens slots -> student books -> rules hold
//   4. Calendars                booking shows for both people; invite (.ics) and Google Calendar link are right
//   5. Admin analytics          finished session is counted and listed for organizers
//
// Run:  TEST_SUPABASE_URL=… TEST_SUPABASE_ANON_KEY=… TEST_SUPABASE_SERVICE_ROLE_KEY=… npm run test:api
// See tests/api/harness.ts for what the service-role key is (and isn't) used for.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildIcs } from "@/lib/ics";
import { gcalUrl } from "@/lib/time";
import {
  RUN, allowlistStudent, cleanUp, configured, inHours, makeOrganizer, newPerson, rpc, rpcRefused, service,
  type Person,
} from "./harness";

type Stats = {
  alumni_approved: number; alumni_pending: number; students: number; open_slots: number;
  upcoming_sessions: number; completed_sessions: number; cancelled_sessions: number; completed_minutes: number;
  completed_by_mentor: { alumni_id: string; sessions: number }[];
  recent_completed: { id: string; alumni_id: string; student_id: string; topic: string }[];
};

const BRIEF =
  "Our LoRa flood sensor drains its battery in 4 days even with duty cycling. What should I measure next to find where the power goes?";
const MEET = "https://meet.google.com/abc-defg-hij";

// Shared state: each thread builds on the previous one.
let organizer: Person, alum: Person, student: Person, student2: Person, outsider: Person;
let slotIds: string[] = [];
let bookingId = "";
let bookedSlot: { id: string; starts_at: string; duration_min: number };

describe.skipIf(!configured)(`API steel threads (run ${RUN})`, () => {
  beforeAll(async () => {
    organizer = await newPerson("organizer");
    await makeOrganizer(organizer);
  });
  afterAll(cleanUp);

  // ----------------------------------------------------------------- 1
  describe("1. Alumni registration", () => {
    test("sign-up creates a profile awaiting onboarding", async () => {
      alum = await newPerson("alum", "example.com", "Priya Raman");
      const { data, error } = await alum.client.from("profiles").select("role, status, full_name").eq("id", alum.id).single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ role: null, status: "onboarding", full_name: "Priya Raman" });
    });

    test("submitting the alumni profile puts it in review", async () => {
      const status = await rpc<string>(alum, "save_alumni_profile", {
        p_full_name: "Priya Raman", p_grad_year: 2012, p_degree: "B.Tech", p_branch: "ECE",
        p_job_title: "Engineering Manager", p_organization: "Qualcomm", p_city: "Bengaluru", p_timezone: "Asia/Kolkata",
        p_linkedin_url: "https://www.linkedin.com/in/example", p_meeting_link: MEET,
        p_skills: ["Embedded systems", "Bluetooth Low Energy", "Power optimization"],
        p_advice_areas: ["Embedded systems & IoT", "Semiconductor & hardware industry"],
        p_bio: "Low-power IoT firmware at Qualcomm.", p_visible: true,
      });
      expect(status).toBe("pending");
    });

    test("pending alumni can't open slots and aren't visible to students", async () => {
      expect(await rpcRefused(alum, "add_slots", { p_starts: [inHours(72).toISOString()], p_duration: 30 })).toMatch(/approved alumni/);
      const probe = await newPerson("probe", "iitg.ac.in");
      await rpc(probe, "save_student_profile", {
        p_full_name: "Probe", p_branch: "CSE", p_year: "2nd year", p_project_title: "Probe", p_project_summary: "", p_seeking: "Probe",
      });
      const { data } = await probe.client.from("alumni_profiles").select("user_id").eq("user_id", alum.id);
      expect(data).toEqual([]);
    });

    test("only organizers can approve", async () => {
      expect(await rpcRefused(alum, "admin_set_status", { p_user: alum.id, p_status: "approved" })).toMatch(/organizers/);
      await rpc(organizer, "admin_set_status", { p_user: alum.id, p_status: "approved" });
      const { data } = await alum.client.from("profiles").select("status").eq("id", alum.id).single();
      expect(data?.status).toBe("approved");
    });
  });

  // ----------------------------------------------------------------- 2
  describe("2. Student sign-up", () => {
    test("an @iitg.ac.in email becomes an approved student straight away", async () => {
      student = await newPerson("student", "iitg.ac.in", "Arjun Das");
      await rpc(student, "save_student_profile", {
        p_full_name: "Arjun Das", p_branch: "ECE", p_year: "3rd year",
        p_project_title: "Flood sensor network", p_project_summary: "LoRa mesh of battery sensors on Brahmaputra tributaries",
        p_seeking: "How to make sensors last a monsoon season",
      });
      const { data } = await student.client.from("profiles").select("role, status").eq("id", student.id).single();
      expect(data).toEqual({ role: "student", status: "approved" });
    });

    test("other emails are refused as students", async () => {
      outsider = await newPerson("outsider", "example.com");
      const msg = await rpcRefused(outsider, "save_student_profile", {
        p_full_name: "Outsider", p_branch: "CSE", p_year: "1st year", p_project_title: "X", p_project_summary: "", p_seeking: "X",
      });
      expect(msg).toMatch(/iitg\.ac\.in/);
    });

    test("an allow-listed email can sign up as a student, and the check works before sign-in", async () => {
      student2 = await newPerson("student2", "example.com", "Meera Iyer");
      await allowlistStudent(student2.email);
      const anon = (await import("@supabase/supabase-js")).createClient(
        process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, { auth: { persistSession: false } },
      );
      expect((await anon.rpc("is_student_email", { p_email: student2.email.toUpperCase() })).data).toBe(true);
      expect((await anon.rpc("is_student_email", { p_email: outsider.email })).data).toBe(false);
      await rpc(student2, "save_student_profile", {
        p_full_name: "Meera Iyer", p_branch: "CSE", p_year: "4th year", p_project_title: "Campus app", p_project_summary: "", p_seeking: "Career",
      });
    });

    test("students see the approved alumnus but never emails or meeting links", async () => {
      const { data } = await student.client.from("alumni_profiles").select("user_id, job_title").eq("user_id", alum.id);
      expect(data).toEqual([{ user_id: alum.id, job_title: "Engineering Manager" }]);
      expect((await student.client.from("alumni_profiles").select("meeting_link")).error?.message).toMatch(/permission denied/);
      expect((await student.client.from("profiles").select("email")).error?.message).toMatch(/permission denied/);
    });
  });

  // ----------------------------------------------------------------- 3
  describe("3. Student booking slots", () => {
    test("the alumnus opens slots; ones inside 48 hours are skipped", async () => {
      const added = await rpc<number>(alum, "add_slots", {
        p_starts: [inHours(30).toISOString(), inHours(72).toISOString(), inHours(96).toISOString()],
        p_duration: 30,
      });
      expect(added).toBe(2);
      const { data } = await alum.client.from("slots").select("id, starts_at, duration_min").eq("alumni_id", alum.id).order("starts_at");
      slotIds = (data ?? []).map((s) => s.id);
      expect(slotIds).toHaveLength(2);
      bookedSlot = data![0];
    });

    test("the student sees the open slots", async () => {
      const { data } = await student.client.from("slots").select("id").eq("alumni_id", alum.id).eq("is_booked", false);
      expect((data ?? []).map((s) => s.id).sort()).toEqual([...slotIds].sort());
    });

    test("a one-line brief is refused", async () => {
      expect(await rpcRefused(student, "book_slot", { p_slot: slotIds[0], p_topic: "Career advice", p_note: "" })).toMatch(/40 characters/);
    });

    test("the student books a slot", async () => {
      bookingId = await rpc<string>(student, "book_slot", {
        p_slot: slotIds[0], p_topic: BRIEF, p_note: "I'll share my circuit diagram",
        p_brief_check: { verdict: "specific", method: "test" },
      });
      expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("nobody else can take that slot, and the student can't book the same mentor twice", async () => {
      expect(await rpcRefused(student2, "book_slot", { p_slot: slotIds[0], p_topic: BRIEF, p_note: "" })).toMatch(/just taken/);
      expect(await rpcRefused(student, "book_slot", { p_slot: slotIds[1], p_topic: BRIEF, p_note: "" })).toMatch(/already have an upcoming/);
    });

    test("alumni can't book", async () => {
      expect(await rpcRefused(alum, "book_slot", { p_slot: slotIds[1], p_topic: BRIEF, p_note: "" })).toMatch(/students/);
    });
  });

  // ----------------------------------------------------------------- 4
  describe("4. Booked slots on calendars", () => {
    test("the session shows on the student's and the alumnus's schedules, and on nobody else's", async () => {
      const cols = "id, slot_id, alumni_id, student_id, starts_at, duration_min, topic, status";
      const mine = await student.client.from("bookings").select(cols).eq("id", bookingId).single();
      const theirs = await alum.client.from("bookings").select(cols).eq("id", bookingId).single();
      const other = await student2.client.from("bookings").select("id").eq("id", bookingId);
      expect(mine.data).toMatchObject({ slot_id: bookedSlot.id, alumni_id: alum.id, student_id: student.id, status: "booked", topic: BRIEF });
      expect(new Date(mine.data!.starts_at).getTime()).toBe(new Date(bookedSlot.starts_at).getTime());
      expect(theirs.data).toEqual(mine.data);
      expect(other.data).toEqual([]);
    });

    test("the alumnus can now see the student's project brief", async () => {
      const { data } = await alum.client.from("student_profiles").select("project_title").eq("user_id", student.id).single();
      expect(data?.project_title).toBe("Flood sensor network");
    });

    test("the slot is marked booked and drops out of the open list", async () => {
      const { data } = await student2.client.from("slots").select("id, is_booked").eq("id", bookedSlot.id).single();
      expect(data?.is_booked).toBe(true);
    });

    test("the calendar invite both people receive has the right time, people and meeting link", () => {
      const start = new Date(bookedSlot.starts_at);
      const ics = buildIcs({
        uid: `booking-${bookingId}@iitg-alumni-connect`, method: "REQUEST", sequence: 0, start, durationMin: bookedSlot.duration_min,
        summary: "IITG Alumni Connect: Arjun Das × Priya Raman", description: `Topic: ${BRIEF}\nJoin: ${MEET}`, location: MEET,
        organizerEmail: "connect@example.org", attendees: [{ name: "Priya Raman", email: alum.email }, { name: "Arjun Das", email: student.email }],
      });
      const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const unfolded = ics.replace(/\r\n /g, "");
      expect(unfolded).toContain(`DTSTART:${stamp(start)}`);
      expect(unfolded).toContain(`DTEND:${stamp(new Date(start.getTime() + 30 * 60_000))}`);
      expect(unfolded).toContain(`mailto:${alum.email}`);
      expect(unfolded).toContain(`mailto:${student.email}`);
      expect(unfolded).toContain(`LOCATION:${MEET}`);
      expect(unfolded).toContain("METHOD:REQUEST");
      expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    });

    test("the Add to Google Calendar link covers the same 30 minutes", () => {
      const url = new URL(gcalUrl("IITG Alumni Connect: Priya Raman", bookedSlot.starts_at, 30, "Topic"));
      const [from, to] = url.searchParams.get("dates")!.split("/");
      const parse = (s: string) => Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
      expect(parse(from)).toBe(new Date(bookedSlot.starts_at).getTime());
      expect(parse(to) - parse(from)).toBe(30 * 60_000);
    });

    test("cancelling removes it from both calendars and reopens the slot", async () => {
      // Book the second slot with the other student, cancel it, and check the effects.
      const b2 = await rpc<string>(student2, "book_slot", { p_slot: slotIds[1], p_topic: BRIEF, p_note: "" });
      await rpc(alum, "cancel_booking", { p_booking: b2 });
      const { data: bk } = await student2.client.from("bookings").select("status, cancelled_by").eq("id", b2).single();
      expect(bk).toEqual({ status: "cancelled", cancelled_by: alum.id });
      const { data: slot } = await student2.client.from("slots").select("is_booked").eq("id", slotIds[1]).single();
      expect(slot?.is_booked).toBe(false);
      const cancel = buildIcs({
        uid: `booking-${b2}@iitg-alumni-connect`, method: "CANCEL", sequence: 1, start: new Date(), durationMin: 30,
        summary: "x", description: "x", location: MEET, organizerEmail: "connect@example.org", attendees: [],
      });
      expect(cancel).toContain("METHOD:CANCEL");
      expect(cancel).toContain("STATUS:CANCELLED");
      expect(cancel).toContain(`UID:booking-${b2}@iitg-alumni-connect`);
    });
  });

  // ----------------------------------------------------------------- 5
  describe("5. Finished sessions in admin analytics", () => {
    let before: Stats;

    test("only organizers can read analytics", async () => {
      expect(await rpcRefused(student, "admin_stats")).toMatch(/organizers/);
      expect(await rpcRefused(alum, "admin_stats")).toMatch(/organizers/);
      before = await rpc<Stats>(organizer, "admin_stats");
      expect(before.recent_completed.some((r) => r.id === bookingId)).toBe(false);
    });

    test("once the session's time has passed, it counts as completed", async () => {
      // Time travel: move the booked session to yesterday, as if the date had arrived and passed.
      const yesterday = inHours(-24).toISOString();
      const admin = service();
      expect((await admin.from("slots").update({ starts_at: yesterday }).eq("id", bookedSlot.id)).error).toBeNull();
      expect((await admin.from("bookings").update({ starts_at: yesterday }).eq("id", bookingId)).error).toBeNull();

      const after = await rpc<Stats>(organizer, "admin_stats");
      expect(after.completed_sessions).toBe(before.completed_sessions + 1);
      expect(after.upcoming_sessions).toBe(before.upcoming_sessions - 1);
      expect(after.completed_minutes).toBe(before.completed_minutes + 30);
      expect(after.recent_completed.find((r) => r.id === bookingId)).toMatchObject({
        alumni_id: alum.id, student_id: student.id, topic: BRIEF,
      });
      expect(after.completed_by_mentor.find((m) => m.alumni_id === alum.id)?.sessions).toBe(1);
    });

    test("a finished session can't be cancelled", async () => {
      expect(await rpcRefused(student, "cancel_booking", { p_booking: bookingId })).toMatch(/already happened/);
    });

    test("a cancelled session is counted as cancelled, never as completed, even after its time passes", async () => {
      const snap = await rpc<Stats>(organizer, "admin_stats");
      // student2 books the reopened second slot, then cancels it.
      const b3 = await rpc<string>(student2, "book_slot", { p_slot: slotIds[1], p_topic: BRIEF, p_note: "" });
      await rpc(student2, "cancel_booking", { p_booking: b3 });
      // Its date then passes, too.
      const lastWeek = inHours(-24 * 7).toISOString();
      expect((await service().from("bookings").update({ starts_at: lastWeek }).eq("id", b3)).error).toBeNull();

      const s = await rpc<Stats>(organizer, "admin_stats");
      expect(s.cancelled_sessions).toBe(snap.cancelled_sessions + 1);
      expect(s.completed_sessions).toBe(snap.completed_sessions);
      expect(s.completed_minutes).toBe(snap.completed_minutes);
      expect(s.recent_completed.some((r) => r.id === b3)).toBe(false);
    });
  });
});

if (!configured) {
  test.skip("API steel threads: set TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY and TEST_SUPABASE_SERVICE_ROLE_KEY to run", () => {});
}
