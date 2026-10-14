"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STUDENT_EMAIL_DOMAIN, isStudentEmail } from "@/lib/constants";

type Who = "student" | "alumni";

export function LoginPanel({ initial }: { initial: Who }) {
  const [who, setWho] = useState<Who>(initial);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setErr("Enter a valid email address.");
    if (who === "student" && !isStudentEmail(addr))
      return setErr(`Use your @${STUDENT_EMAIL_DOMAIN} email. Alumni can sign in from the Alumni tab.`);
    setBusy(true);
    const { error } = await createClient().auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirectTo() } });
    setBusy(false);
    if (error) return setErr(error.message.includes("rate") ? "Too many requests. Wait a minute and try again." : "Couldn't send the link. Try again.");
    setSentTo(addr);
  }

  if (sentTo)
    return (
      <div className="panel">
        <h2 className="text-lg font-bold">Check your inbox</h2>
        <p>
          We sent a sign-in link to <b className="font-mono text-[0.92rem]">{sentTo}</b>. Open it in this browser. It
          expires in an hour.
        </p>
        <button className="linkbtn justify-self-start" type="button" onClick={() => setSentTo("")}>
          Use a different email
        </button>
      </div>
    );

  return (
    <div className="panel">
      <div className="inline-flex justify-self-start rounded-full border border-line bg-sunk p-0.5" role="tablist" aria-label="I am">
        {(["student", "alumni"] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={who === w}
            onClick={() => { setWho(w); setErr(""); }}
            className={`rounded-full px-4 py-1 text-[0.86rem] ${who === w ? "bg-surface font-semibold text-ink" : "text-muted"}`}
          >
            {w === "student" ? "Student" : "Alumni"}
          </button>
        ))}
      </div>

      {who === "alumni" && (
        <p className="text-[0.9rem] text-muted">
          Use any email you check. After signing in you can fill your profile from your LinkedIn in a few seconds.
        </p>
      )}

      <form onSubmit={sendLink} className="grid gap-3" noValidate>
        <div className="field">
          <label htmlFor="email" className="field-label">
            {who === "student" ? "Your IITG email" : "Email"}
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={who === "student" ? `yourname@${STUDENT_EMAIL_DOMAIN}` : "you@example.com"}
          />
          {who === "student" && <span className="hint">Only @{STUDENT_EMAIL_DOMAIN} addresses can create student accounts.</span>}
        </div>
        {err && <p role="alert" className="err">{err}</p>}
        <button className="btn justify-self-start" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
