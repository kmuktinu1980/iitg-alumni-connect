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
  const [code, setCode] = useState("");

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setErr("Enter a valid email address.");
    setBusy(true);
    const supabase = createClient();
    if (who === "student" && !isStudentEmail(addr)) {
      // Not an institute address: allowed only if an organizer has allow-listed it.
      const { data: allowed } = await supabase.rpc("is_student_email", { p_email: addr });
      if (!allowed) {
        setBusy(false);
        return setErr(`Use your @${STUDENT_EMAIL_DOMAIN} email. Alumni can sign in from the Alumni tab.`);
      }
    }
    const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirectTo() } });
    setBusy(false);
    if (error)
      return setErr(
        /rate|too many|security purposes/i.test(error.message)
          ? "Sign-in emails are limited for now. Wait a few minutes and try again, or use a link you've already received."
          : "Couldn't send the email. Try again.",
      );
    setSentTo(addr);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const token = code.replace(/\D/g, "");
    if (token.length < 6) return setErr("Enter the code from the email.");
    setBusy(true);
    const { error } = await createClient().auth.verifyOtp({ email: sentTo, token, type: "email" });
    if (error) {
      setBusy(false);
      return setErr(
        /expired|invalid/i.test(error.message)
          ? "That code didn't work. Check it, or use the newest email if you requested more than one. Codes expire after an hour."
          : "Couldn't sign you in. Try again.",
      );
    }
    window.location.assign("/"); // "/" sends you to the right place
  }

  if (sentTo)
    return (
      <div className="panel">
        <h2 className="text-lg font-bold">Check your inbox</h2>
        <p>
          We emailed <b className="font-mono text-[0.92rem]">{sentTo}</b>. Type the code from that email here. You can
          also tap the link in it if you're on this device.
        </p>
        <form onSubmit={verifyCode} className="grid gap-3" noValidate>
          <div className="field max-w-[14rem]">
            <label htmlFor="otp" className="field-label">Sign-in code</label>
            <input
              id="otp"
              className="input tabular text-center text-[1.25rem] tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
          </div>
          {err && <p role="alert" className="err">{err}</p>}
          <button className="btn justify-self-start" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-[0.86rem] text-muted">
          No email after a minute? Check spam or promotions.{" "}
          <button className="linkbtn" type="button" onClick={() => { setSentTo(""); setCode(""); setErr(""); }}>
            Use a different email
          </button>
        </p>
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
          Use any email you check. We'll email you a code, then you describe yourself in a few lines (typing or
          dictating) and we fill in your profile.
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
          {busy ? "Sending…" : "Email me a sign-in code"}
        </button>
      </form>
    </div>
  );
}
