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
          That sign-in link didn't work. It may have expired or been opened in a different browser. Request a new one below.
        </p>
      )}
      <LoginPanel initial={sp.as === "alumni" ? "alumni" : "student"} />
    </section>
  );
}
