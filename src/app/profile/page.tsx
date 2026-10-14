import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { StudentProfileForm } from "@/components/StudentProfileForm";
import { AlumniProfileEditor } from "@/components/AlumniProfileEditor";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const v = await getViewer();
  if (!v) redirect("/login");
  const { profile } = v;
  // Pending alumni may review their profile too.
  if (!profile.role || profile.status === "onboarding") redirect("/onboarding");
  if (profile.status === "rejected") redirect("/pending");

  if (profile.role === "student") {
    const { data: s } = await v.supabase
      .from("student_profiles")
      .select("branch, year_of_study, project_title, project_summary, seeking")
      .eq("user_id", v.user.id)
      .single();
    return (
      <section className="grid gap-3.5">
        <h1 className="text-[1.6rem] font-bold">My profile</h1>
        <p className="lede">Alumni see this when you book them. Keep your project current so they can prepare.</p>
        <StudentProfileForm
          isNew={false}
          initial={{
            fullName: profile.full_name,
            branch: s?.branch ?? "",
            year: s?.year_of_study ?? "",
            projectTitle: s?.project_title ?? "",
            projectSummary: s?.project_summary ?? "",
            seeking: s?.seeking ?? "",
          }}
        />
      </section>
    );
  }

  // The meeting link isn't readable through the user's own client (column privacy), so read it server-side.
  const { data: a } = await createAdminClient()
    .from("alumni_profiles")
    .select("*")
    .eq("user_id", v.user.id)
    .single();

  return (
    <section className="grid gap-3.5">
      <h1 className="text-[1.6rem] font-bold">My profile</h1>
      <p className="lede">
        {profile.status === "pending"
          ? "An organizer is reviewing your profile. You can still make changes."
          : "This is what students see when you're suggested as a mentor."}
      </p>
      <AlumniProfileEditor
        isNew={false}
        initial={{
          fullName: profile.full_name,
          gradYear: a?.grad_year ?? "",
          degree: a?.degree ?? "B.Tech",
          branch: a?.branch ?? "",
          jobTitle: a?.job_title ?? "",
          organization: a?.organization ?? "",
          city: a?.city ?? "",
          linkedinUrl: a?.linkedin_url ?? "",
          meetingLink: a?.meeting_link ?? "",
          skills: a?.skills ?? [],
          adviceAreas: a?.advice_areas ?? [],
          bio: a?.bio ?? "",
          visible: a?.visible ?? true,
        }}
      />
    </section>
  );
}
