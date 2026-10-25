import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/viewer";

export default async function Landing() {
  const v = await getViewer();
  if (v) redirect(homeFor(v.profile));

  return (
    <>
      <section className="grid gap-4 pt-4">
        <p className="label-cap">IIT Guwahati · student–alumni mentoring</p>
        <h1 className="max-w-[18ch] text-4xl font-bold sm:text-5xl">Thirty minutes with someone who has done it.</h1>
        <p className="lede text-[1.02rem]">
          Students describe their project and what they're stuck on. We suggest the alumni whose experience fits, and
          you book a slot they've opened on their calendar.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link href="/login?as=student" className="btn">I'm a student</Link>
          <Link href="/login?as=alumni" className="btn btn-ghost">I'm an alumnus, I want to help</Link>
        </div>
      </section>

      <section className="grid gap-4">
        <p className="label-cap">How it works</p>
        <ol className="grid gap-5 sm:grid-cols-3">
          {[
            ["Alumni open slots", "Volunteers add their skills, the areas they can advise on, and a few times a month that suit them."],
            ["Students describe the ask", "Project plus question in, ranked mentor suggestions out, each with the reason it fits."],
            ["Book and meet", "One click books the slot. Both of you get a calendar invite with the meeting link and the project brief."],
          ].map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
              <span className="row-span-2 font-mono font-medium text-river">{i + 1}</span>
              <b className="font-semibold">{t}</b>
              <span className="text-[0.92rem] text-muted">{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="panel">
          <h2 className="text-lg font-bold">For students</h2>
          <p className="text-[0.92rem] text-muted">
            Sign in with your <span className="font-mono">@iitg.ac.in</span> email. You're in straight away.
          </p>
        </div>
        <div className="panel">
          <h2 className="text-lg font-bold">For alumni</h2>
          <p className="text-[0.92rem] text-muted">
            Sign in with any email, describe yourself in a few lines, and we fill in your profile. Invited mentors can open slots
            straight away; otherwise an organizer checks your profile first, usually within a day.
          </p>
        </div>
      </section>
    </>
  );
}
