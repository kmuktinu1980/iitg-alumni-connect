import type { Metadata } from "next";
import { requireViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { batchLabel } from "@/lib/time";
import { minNoticeCutoff } from "@/lib/constants";
import { LocalTime } from "@/components/LocalTime";
import { StatusButtons } from "./StatusButtons";
import { InviteManager, type InviteRow, type LinkRow } from "./InviteManager";

export const metadata: Metadata = { title: "Organizer" };

type AdminStats = {
  alumni_approved: number;
  alumni_pending: number;
  students: number;
  open_slots: number;
  upcoming_sessions: number;
  completed_sessions: number;
  cancelled_sessions: number;
  completed_minutes: number;
  match_searches: number;
  completed_by_mentor: { alumni_id: string; name: string; sessions: number }[];
  recent_completed: {
    id: string; starts_at: string; duration_min: number; topic: string;
    alumni_id: string; alumni_name: string; student_id: string; student_name: string;
  }[];
};

type AlumniRow = {
  user_id: string;
  grad_year: number;
  degree: string;
  branch: string;
  job_title: string;
  organization: string;
  city: string;
  linkedin_url: string;
  skills: string[];
  bio: string;
  visible: boolean;
};

export default async function AdminPage() {
  const v = await requireViewer({ admin: true });
  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const [{ data: people }, { data: alumni }, { data: studentRows }, { data: slots }, { data: bookings }, { data: statsData, error: statsError }] = await Promise.all([
    db.from("profiles").select("id, full_name, email, role, status, created_at").not("role", "is", null),
    db.from("alumni_profiles").select("user_id, grad_year, degree, branch, job_title, organization, city, linkedin_url, skills, bio, visible"),
    db.from("student_profiles").select("user_id, branch, year_of_study, project_title"),
    db.from("slots").select("alumni_id").eq("is_booked", false).gt("starts_at", minNoticeCutoff().toISOString()),
    db.from("bookings").select("id, alumni_id, student_id, starts_at, topic, status").order("starts_at"),
    // Analytics come from the admin_stats() API, called as the signed-in organizer.
    v.supabase.rpc("admin_stats"),
  ]);
  if (statsError) throw statsError;
  const [{ data: inviteRows }, { data: linkRows }] = await Promise.all([
    db.from("alumni_invites").select("email, note, created_at").order("created_at", { ascending: false }),
    db.from("invite_links").select("code, label, expires_at, max_uses, uses, revoked, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const st = statsData as AdminStats;

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const alumniById = new Map(((alumni ?? []) as AlumniRow[]).map((a) => [a.user_id, a]));
  const openByAlumni = new Map<string, number>();
  for (const s of slots ?? []) openByAlumni.set(s.alumni_id, (openByAlumni.get(s.alumni_id) ?? 0) + 1);
  const all = bookings ?? [];
  const upcoming = all.filter((b) => b.status === "booked" && b.starts_at > nowIso);
  const sessionsBy = new Map<string, number>();
  for (const b of all) if (b.status === "booked") sessionsBy.set(b.alumni_id, (sessionsBy.get(b.alumni_id) ?? 0) + 1);
  const studentSessions = new Map<string, { upcoming: number; done: number }>();
  for (const b of all) {
    if (b.status !== "booked") continue;
    const c = studentSessions.get(b.student_id) ?? { upcoming: 0, done: 0 };
    if (b.starts_at > nowIso) c.upcoming++;
    else c.done++;
    studentSessions.set(b.student_id, c);
  }
  const studentById = new Map((studentRows ?? []).map((r) => [r.user_id as string, r as { branch: string; year_of_study: string; project_title: string }]));

  const alumniPeople = (people ?? []).filter((p) => p.role === "alumni");
  const pending = alumniPeople.filter((p) => p.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const listed = alumniPeople.filter((p) => p.status !== "pending").sort((a, b) => (alumniById.get(a.id)?.grad_year ?? 0) - (alumniById.get(b.id)?.grad_year ?? 0));
  const students = (people ?? []).filter((p) => p.role === "student").sort((a, b) => b.created_at.localeCompare(a.created_at));

  const byEmail = new Map((people ?? []).map((p) => [String(p.email ?? "").toLowerCase(), p]));
  const statusWord = (s: string) => (s === "approved" ? "Approved" : s === "pending" ? "Awaiting review" : s === "rejected" ? "Not approved" : "Signing up");
  const invites: InviteRow[] = (inviteRows ?? []).map((i) => {
    const p = byEmail.get(i.email);
    return { email: i.email, note: i.note, joined: p ? `${p.full_name || "Signed up"} · ${statusWord(p.status)}` : null };
  });
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://iitg-alumni-connect.vercel.app").replace(/\/$/, "");

  const stats: [string, number][] = [
    ["Alumni approved", st.alumni_approved],
    ["Awaiting review", st.alumni_pending],
    ["Students", st.students],
    ["Open slots", st.open_slots],
    ["Upcoming sessions", st.upcoming_sessions],
    ["Completed sessions", st.completed_sessions],
    ["Mentoring hours", Math.round((st.completed_minutes / 60) * 10) / 10],
    ["Match searches", st.match_searches],
  ];

  return (
    <>
      <section className="grid gap-3.5">
        <h1 className="text-[1.6rem] font-bold">Organizer</h1>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          {stats.map(([k, n]) => (
            <div key={k} className="rounded-[10px] border border-line bg-surface px-4 py-3.5">
              <span className="label-cap">{k}</span>
              <b className="block font-mono text-[1.6rem] font-medium tabular">{n}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-[1.25rem] font-bold">Alumni awaiting review</h2>
        {pending.length === 0 ? (
          <p className="text-muted">Nobody is waiting. New alumni sign-ups appear here.</p>
        ) : (
          pending.map((p) => {
            const a = alumniById.get(p.id);
            return (
              <article key={p.id} className="card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[1.08rem] font-bold">{p.full_name}</h3>
                  <span className="font-mono text-[0.8rem] text-muted">{p.email}</span>
                </div>
                {a && (
                  <>
                    <p className="text-[0.9rem]">
                      {[a.job_title, a.organization].filter(Boolean).join(" · ")} — <span className="font-mono">{batchLabel(a)}</span>
                      {a.city ? ` · ${a.city}` : ""}
                    </p>
                    {a.skills.length > 0 && <p className="text-[0.86rem] text-muted">{a.skills.join(", ")}</p>}
                    {a.bio && <p className="text-[0.9rem]">{a.bio}</p>}
                    {a.linkedin_url && (
                      <a href={a.linkedin_url} target="_blank" rel="noopener noreferrer" className="justify-self-start text-[0.86rem]">
                        Check LinkedIn ↗
                      </a>
                    )}
                  </>
                )}
                <StatusButtons userId={p.id} current="pending" />
              </article>
            );
          })
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[1.25rem] font-bold">Invite mentors</h2>
        <InviteManager site={site} invites={invites} links={(linkRows ?? []) as LinkRow[]} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-[1.25rem] font-bold">Upcoming sessions</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted">No sessions booked yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse text-[0.88rem]">
              <thead>
                <tr>{["When", "Mentor", "Student", "Topic"].map((h) => <th key={h} className="label-cap border-b border-line px-3 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id} className="border-b border-line last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono tabular"><LocalTime iso={b.starts_at} /></td>
                    <td className="px-3 py-2">{byId.get(b.alumni_id)?.full_name ?? "—"}</td>
                    <td className="px-3 py-2">{byId.get(b.student_id)?.full_name ?? "—"}</td>
                    <td className="px-3 py-2">{b.topic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[1.25rem] font-bold">Completed sessions</h2>
        {st.recent_completed.length === 0 ? (
          <p className="text-muted">None yet. Sessions show up here once their end time has passed.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse text-[0.88rem]">
              <thead>
                <tr>{["When", "Mentor", "Student", "Topic"].map((h) => <th key={h} className="label-cap border-b border-line px-3 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {st.recent_completed.map((b) => (
                  <tr key={b.id} className="border-b border-line last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono tabular"><LocalTime iso={b.starts_at} /></td>
                    <td className="px-3 py-2">{b.alumni_name || "—"}</td>
                    <td className="px-3 py-2">{b.student_name || "—"}</td>
                    <td className="px-3 py-2">{b.topic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {st.completed_by_mentor.length > 0 && (
          <p className="text-[0.86rem] text-muted">
            Most sessions: {st.completed_by_mentor.slice(0, 5).map((m) => `${m.name} (${m.sessions})`).join(", ")}
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[1.25rem] font-bold">Alumni</h2>
        {listed.length === 0 ? (
          <p className="text-muted">No reviewed alumni yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse text-[0.88rem]">
              <thead>
                <tr>{["Name", "Batch", "Role", "Open slots", "Sessions", "Status"].map((h) => <th key={h} className="label-cap border-b border-line px-3 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {listed.map((p) => {
                  const a = alumniById.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-3 py-2">{p.full_name}<div className="font-mono text-[0.76rem] text-muted">{p.email}</div></td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{a ? batchLabel(a) : "—"}</td>
                      <td className="px-3 py-2">{a ? [a.job_title, a.organization].filter(Boolean).join(" · ") : "—"}</td>
                      <td className="px-3 py-2 font-mono tabular">{openByAlumni.get(p.id) ?? 0}</td>
                      <td className="px-3 py-2 font-mono tabular">{sessionsBy.get(p.id) ?? 0}</td>
                      <td className="px-3 py-2">
                        <div className="grid gap-1.5">
                          <span className={`pill justify-self-start ${p.status === "approved" ? (a?.visible === false ? "pill-booked" : "pill-open") : "pill-off"}`}>
                            {p.status === "approved" ? (a?.visible === false ? "Hidden by self" : "Approved") : "Rejected"}
                          </span>
                          <StatusButtons userId={p.id} current={p.status as "approved" | "rejected"} compact />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.25rem] font-bold">Students</h2>
          <span className="font-mono text-[0.8rem] text-muted">{students.length} signed up</span>
        </div>
        {students.length === 0 ? (
          <p className="text-muted">No students have signed up yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <table className="w-full border-collapse text-[0.88rem]">
              <thead>
                <tr>{["Name", "Branch · year", "Project", "Sessions", "Joined"].map((h) => <th key={h} className="label-cap border-b border-line px-3 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {students.map((p) => {
                  const sp = studentById.get(p.id);
                  const c = studentSessions.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-3 py-2">
                        {p.full_name || "—"}
                        <div className="font-mono text-[0.76rem] text-muted">{p.email}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{sp ? `${sp.branch} · ${sp.year_of_study}` : "—"}</td>
                      <td className="px-3 py-2">{sp?.project_title || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono tabular">
                        {c ? `${c.upcoming} upcoming · ${c.done} done` : "0"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono tabular"><LocalTime iso={p.created_at} mode="day" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
