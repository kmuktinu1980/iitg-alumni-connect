import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getViewer, homeFor } from "@/lib/viewer";
import { STUDENT_EMAIL_DOMAIN, isStudentEmail } from "@/lib/constants";
import { StudentProfileForm } from "@/components/StudentProfileForm";
import { AlumniProfileForm } from "@/components/AlumniProfileForm";

export const metadata: Metadata = { title: "Join" };

function Stepper({ active }: { active: 1 | 2 }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-[0.86rem] text-muted" aria-label="Alumni setup">
      {["Your profile", "Organizer approval", "Open slots"].map((l, i) => (
        <li key={l} className={`inline-flex items-center gap-2 ${i + 1 === active ? "font-semibold text-ink" : ""}`}
          aria-current={i + 1 === active ? "step" : undefined}>
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border font-mono text-[0.76rem] ${
            i + 1 === active ? "border-river bg-river text-river-ink" : "border-line"}`}>{i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (v.profile.role && v.profile.status !== "onboarding") redirect(homeFor(v.profile));

  const email = v.user.email ?? "";
  const canBeStudent = isStudentEmail(email);
  const sp = await searchParams;
  const as = sp.as === "student" || sp.as === "alumni" ? sp.as : canBeStudent ? "student" : "alumni";
  const metaName = String(v.user.user_metadata?.full_name ?? v.user.user_metadata?.name ?? "");

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.6rem] font-bold">{as === "student" ? "Your student profile" : "Your alumni profile"}</h1>
        <span className="text-[0.84rem] text-muted">
          Signed in as <span className="font-mono">{email}</span>
        </span>
      </div>

      {as === "student" && !canBeStudent ? (
        <div className="empty">
          <b className="text-ink">Student accounts need an @{STUDENT_EMAIL_DOMAIN} email</b>
          <span>Sign out and sign back in with your institute email, or continue as an alumnus.</span>
          <Link href="/onboarding?as=alumni" className="justify-self-start">Continue as an alumnus</Link>
        </div>
      ) : as === "student" ? (
        <>
          <p className="lede">Tell alumni what you're working on. The clearer your question, the better your matches.</p>
          <StudentProfileForm isNew initial={{ fullName: metaName, branch: "", year: "", projectTitle: "", projectSummary: "", seeking: "" }} />
        </>
      ) : (
        <>
          <Stepper active={1} />
          <p className="lede">
            Students see this when they're matched with you; skills and advice areas drive the matching. An organizer
            reviews new profiles, then you open slots on your calendar.
          </p>
          <AlumniProfileForm
            isNew
            initial={{
              fullName: metaName, gradYear: "", degree: "B.Tech", branch: "", jobTitle: "", organization: "", city: "",
              linkedinUrl: "", meetingLink: "", skills: [], adviceAreas: [], bio: "", visible: true,
            }}
          />
          {canBeStudent && (
            <p className="text-[0.9rem] text-muted">
              Current student? <Link href="/onboarding?as=student">Create a student profile instead</Link>
            </p>
          )}
        </>
      )}
      {v.profile.is_admin && (
        <p className="text-[0.9rem] text-muted">
          You're an organizer. You can skip this and <Link href="/admin">go to the organizer view</Link>.
        </p>
      )}
    </section>
  );
}
