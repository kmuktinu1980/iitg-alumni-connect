"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveStudentProfile } from "@/app/actions";
import { BRANCHES, YEARS } from "@/lib/constants";
import { Field, FormError } from "@/components/Field";

export type StudentInitial = {
  fullName: string;
  branch: string;
  year: string;
  projectTitle: string;
  projectSummary: string;
  seeking: string;
};

export function StudentProfileForm({ initial, isNew }: { initial: StudentInitial; isNew: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setErr("");
    setSaved(false);
    start(async () => {
      const r = await saveStudentProfile({
        fullName: get("fullName"),
        branch: get("branch") as never,
        year: get("year") as never,
        projectTitle: get("projectTitle"),
        projectSummary: get("projectSummary"),
        seeking: get("seeking"),
      });
      if (!r.ok) return setErr(r.error);
      if (isNew) router.push("/find");
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field id="fullName" label="Your name">
          <input className="input" id="fullName" name="fullName" autoComplete="name" defaultValue={initial.fullName} required />
        </Field>
        <Field id="branch" label="Branch">
          <select className="input" id="branch" name="branch" defaultValue={initial.branch}>
            <option value="">Choose…</option>
            {BRANCHES.map((b) => <option key={b}>{b}</option>)}
          </select>
        </Field>
        <Field id="year" label="Year">
          <select className="input" id="year" name="year" defaultValue={initial.year}>
            <option value="">Choose…</option>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
        </Field>
      </div>
      <Field id="projectTitle" label="Project title">
        <input className="input" id="projectTitle" name="projectTitle" defaultValue={initial.projectTitle}
          placeholder="e.g. Low-cost flood sensor for Brahmaputra tributaries" />
      </Field>
      <Field id="projectSummary" label="Project summary">
        <textarea className="input" id="projectSummary" name="projectSummary" defaultValue={initial.projectSummary}
          placeholder="What you're building, the stack or method, and where you are now." />
      </Field>
      <Field id="seeking" label="What advice are you looking for?" hint="Matching reads this, so be specific.">
        <textarea className="input" id="seeking" name="seeking" defaultValue={initial.seeking}
          placeholder="e.g. How to validate the sensor design, and whether to take this toward a startup or a paper." />
      </Field>
      {err && <FormError message={err} />}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : isNew ? "Create student profile" : "Save profile"}
        </button>
        {saved && <span role="status" className="text-[0.88rem] text-ok">Saved.</span>}
      </div>
    </form>
  );
}
