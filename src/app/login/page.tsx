import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getViewer, homeFor } from "@/lib/viewer";
import { LoginPanel } from "./LoginPanel";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ as?: string; error?: string }> }) {
  const v = await getViewer();
  if (v) redirect(homeFor(v.profile));
  const sp = await searchParams;
  return (
    <section className="grid max-w-xl gap-4">
      <h1 className="text-[1.6rem] font-bold">Sign in</h1>
      {sp.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-4 py-3 text-[0.92rem]">
          {sp.error === "browser"
            ? "That sign-in link was opened in a different browser from the one you requested it in (email apps often use their own browser). Request a new link and open it in this browser, or copy the link from the email and paste it here."
            : "That sign-in link didn't work. Links work once and expire after an hour. Request a new one below."}
        </p>
      )}
      <LoginPanel initial={sp.as === "alumni" ? "alumni" : "student"} />
    </section>
  );
}
