import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getViewer, homeFor } from "@/lib/viewer";
import { LoginPanel } from "./LoginPanel";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ as?: string; error?: string; invite?: string }> }) {
  const v = await getViewer();
  if (v) redirect(homeFor(v.profile));
  const sp = await searchParams;
  return (
    <section className="grid max-w-xl gap-4">
      <h1 className="text-[1.6rem] font-bold">Sign in</h1>
      {sp.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-4 py-3 text-[0.92rem]">
          {sp.error === "browser"
            ? "That sign-in link was opened in a different browser from the one you requested it in (email apps often use their own browser). Request a new email and type the code from it here instead."
            : "That sign-in link didn't work. Links work once and expire after an hour. Request a new one below."}
        </p>
      )}
      {sp.invite === "ok" && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-[0.92rem]">
          You've been invited as a mentor. Sign in, fill in your profile, and you can open slots straight away: no approval wait.
        </p>
      )}
      {sp.invite === "expired" && (
        <p role="alert" className="rounded-lg bg-amber-soft px-4 py-3 text-[0.92rem]">
          That invite link has expired or been used up. You can still sign up below; an organizer will approve your profile, usually within a day.
        </p>
      )}
      <LoginPanel initial={sp.as === "alumni" ? "alumni" : "student"} />
    </section>
  );
}
