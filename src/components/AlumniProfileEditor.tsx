"use client";

import { useRef, useState } from "react";
import { AlumniProfileForm, type AlumniInitial } from "@/components/AlumniProfileForm";
import { FormError } from "@/components/Field";

type Filled = Omit<AlumniInitial, "linkedinUrl" | "meetingLink" | "visible" | "gradYear"> & {
  gradYear: number | null;
  iitgFound: boolean;
};

/**
 * Alumni profile with "Fill from LinkedIn": the alumnus uploads LinkedIn's
 * Save-to-PDF export (or pastes their profile), Claude suggests the fields,
 * and the form below is pre-filled for them to review and save.
 */
export function AlumniProfileEditor({ initial, isNew }: { initial: AlumniInitial; isNew: boolean }) {
  const [values, setValues] = useState(initial);
  const [version, setVersion] = useState(0); // remounts the form with new values
  const [showPaste, setShowPaste] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ count: number; iitgFound: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function autofill() {
    setErr("");
    setResult(null);
    const file = fileRef.current?.files?.[0];
    if (!file && text.trim().length < 80)
      return setErr(showPaste ? "Paste your About, Experience and Education sections." : "Choose your LinkedIn PDF first.");
    if (file && file.size > 4 * 1024 * 1024) return setErr("That PDF is over 4 MB. LinkedIn's Save to PDF export is usually far smaller.");
    const body = new FormData();
    if (file) body.set("pdf", file);
    if (text.trim()) body.set("text", text.trim());
    setBusy(true);
    try {
      const res = await fetch("/api/profile-autofill", { method: "POST", body });
      const data = await res.json().catch(() => ({ error: "Couldn't read that profile. Try again." }));
      if (!res.ok) return setErr(data.error ?? "Couldn't read that profile. Try again.");
      const f = data as Filled;
      // Keep anything the person already typed where the profile had nothing.
      const next: AlumniInitial = {
        ...values,
        fullName: f.fullName || values.fullName,
        gradYear: f.gradYear ?? values.gradYear,
        degree: f.degree || values.degree,
        branch: f.branch || values.branch,
        jobTitle: f.jobTitle || values.jobTitle,
        organization: f.organization || values.organization,
        city: f.city || values.city,
        skills: f.skills.length ? f.skills : values.skills,
        adviceAreas: f.adviceAreas.length ? f.adviceAreas : values.adviceAreas,
        bio: f.bio || values.bio,
      };
      const count = [f.fullName, f.gradYear, f.branch, f.jobTitle, f.organization, f.city, f.bio].filter(Boolean).length +
        (f.skills.length ? 1 : 0) + (f.adviceAreas.length ? 1 : 0);
      setValues(next);
      setVersion((n) => n + 1);
      setResult({ count, iitgFound: f.iitgFound });
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel border-river/40" aria-labelledby="autofill-h">
        <div className="grid gap-1">
          <h2 id="autofill-h" className="text-lg font-bold">Fill from LinkedIn</h2>
          <p className="text-[0.9rem] text-muted">
            On your LinkedIn profile, click <b className="text-ink">Resources</b> (or <b className="text-ink">More</b>) →{" "}
            <b className="text-ink">Save to PDF</b>, then upload that file here. We'll fill in your role, skills, IITG
            batch and a short bio for you to check.
          </p>
        </div>

        <div className="grid max-w-md gap-3.5">
          <div className="field">
            <label htmlFor="li-pdf" className="field-label">LinkedIn PDF</label>
            <input id="li-pdf" ref={fileRef} type="file" accept="application/pdf,.pdf"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              className="input file:mr-3 file:rounded-md file:border-0 file:bg-river-soft file:px-3 file:py-1 file:text-[0.84rem] file:font-semibold file:text-river" />
            {fileName && <span className="hint">{fileName}</span>}
          </div>
        </div>

        {showPaste ? (
          <div className="field">
            <label htmlFor="li-text" className="field-label">Or paste your profile</label>
            <textarea id="li-text" className="input min-h-[140px]" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Copy your About, Experience and Education sections from LinkedIn and paste them here." />
          </div>
        ) : (
          <button type="button" className="linkbtn justify-self-start text-[0.86rem]" onClick={() => setShowPaste(true)}>
            Can't get the PDF? Paste your profile text instead
          </button>
        )}

        {err && <FormError message={err} />}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" type="button" disabled={busy} onClick={autofill}>
            {busy ? "Reading your profile…" : "Fill my profile"}
          </button>
          {busy && <span className="text-[0.84rem] text-muted">This takes about 10–20 seconds.</span>}
        </div>

        {result && (
          <div role="status" className={`rounded-lg px-4 py-3 text-[0.92rem] ${result.iitgFound ? "bg-ok-soft" : "bg-amber-soft"}`}>
            {result.count > 0
              ? `Filled ${result.count} sections below. Check them, add your LinkedIn URL and meeting link, and save.`
              : "We couldn't find much in that profile. Fill in the form below directly."}
            {!result.iitgFound && result.count > 0 && (
              <> We didn't see IIT Guwahati in your education, so please check your graduating year, degree and branch.</>
            )}
          </div>
        )}
      </section>

      <AlumniProfileForm key={version} isNew={isNew} initial={values} />
    </>
  );
}
