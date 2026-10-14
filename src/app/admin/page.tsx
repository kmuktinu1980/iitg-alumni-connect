import type { Metadata } from "next";
import { requireViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { batchLabel } from "@/lib/time";
import { LocalTime } from "@/components/LocalTime";
import { StatusButtons } from "./StatusButtons";

export const metadata: Metadata = { title: "Organizer" };

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
  await requireViewer({ admin: true });
  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const [{ data: people }, { data: alumni }, { data: slots }, { data: bookings }, { count: matchCount }] = await Promise.all([
    db.from("profiles").select("id, full_name, email, role, status, created_at").not("role", "is", null),
    db.from("alumni_profiles").select("user_id, grad_year, degree, branch, job_title, organization, city, linkedin_url, skills, bio, visible"),
    db.from("slots").select("alumni_id").eq("is_booked", false).gt("starts_at", nowIso),
    db.from("bookings").select("id, alumni_id, student_id, starts_at, topic, status").order("starts_at"),
    db.from("match_requests").select("id", { count: "exact", head: true }),
  ]);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const alumniById = new Map(((alumni ?? []) as AlumniRow[]).map((a) => [a.user_id, a]));
  const openByAlumni = new Map<string, number>();
  for (const s of slots ?? []) openByAlumni.set(s.alumni_id, (openByAlumni.get(s.alumni_id) ?? 0) + 1);
  const all = bookings ?? [];
  const upcoming = all.filter((b) => b.status === "booked" && b.starts_at > nowIso);
  const done = all.filter((b) => b.status === "booked" && b.starts_at <= nowIso);
  const sessionsBy = new Map<string, number>();
  for (const b of all) if (b.status === "booked") sessionsBy.set(b.alumni_id, (sessionsBy.get(b.alumni_id) ?? 0) + 1);

  const alumniPeople = (people ?? []).filter((p) => p.role === "alumni");
  const pending = alumniPeople.filter((p) => p.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const listed = alumniPeople.filter((p) => p.status !== "pending").sort((a, b) => (alumniById.get(a.id)?.grad_year ?? 0) - (alumniById.get(b.id)?.grad_year ?? 0));
  const students = (people ?? []).filter((p) => p.role === "student");

  const stats: [string, number][] = [
    ["Alumni approved", alumniPeople.filter((p) => p.status === "approved").length],
    ["Awaiting review", pending.length],
    ["Students", students.length],
    ["Open slots", [...openByAlumni.values()].reduce((a, b) => a + b, 0)],
    ["Upcoming sessions", upcoming.length],
    ["Completed", done.length],
    ["Match searches", matchCount ?? 0],
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
    </>
  );
}
