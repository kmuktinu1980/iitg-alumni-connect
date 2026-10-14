import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getViewer, homeFor } from "@/lib/viewer";

export const metadata: Metadata = { title: "Awaiting approval" };

export default async function Pending() {
  const v = await getViewer();
  if (!v) redirect("/login");
  const { status } = v.profile;
  if (status !== "pending" && status !== "rejected") redirect(homeFor(v.profile));

  return (
    <section className="grid max-w-2xl gap-4">
      {status === "pending" ? (
        <>
          <h1 className="text-[1.6rem] font-bold">Thanks for volunteering</h1>
          <p className="lede">
            An organizer reviews every new alumni profile before students can see it, usually within a day. We'll email
            you at <span className="font-mono text-ink">{v.user.email}</span> as soon as you're approved, and then you
            can open slots on your calendar.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/profile" className="btn btn-quiet">Review my profile</Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-[1.6rem] font-bold">We couldn't confirm your profile</h1>
          <p className="lede">
            An organizer wasn't able to verify this account as an IIT Guwahati alumnus. If that's a mistake, reply to
            the program organizers with your batch and branch and they'll take another look.
          </p>
        </>
      )}
    </section>
  );
}
