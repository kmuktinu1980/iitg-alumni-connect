import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Slot = { id: string; starts_at: string; duration_min: number };

export type Mentor = {
  id: string;
  name: string;
  grad_year: number;
  degree: string;
  branch: string;
  job_title: string;
  organization: string;
  city: string;
  linkedin_url: string;
  skills: string[];
  advice_areas: string[];
  bio: string;
  slots: Slot[];
};

type AlumniRow = {
  user_id: string;
  grad_year: number;
  degree: string;
  branch: string;
  job_title: string;
  organization: string;
  city: string;
  linkedin_url: string;
  skills: string[];
  advice_areas: string[];
  bio: string;
  profiles: { full_name: string; status: string } | { full_name: string; status: string }[] | null;
};

/** Approved, visible alumni with their open slots, as the signed-in user may see them. */
export async function loadDirectory(supabase: SupabaseClient): Promise<Mentor[]> {
  const { data: rows, error } = await supabase
    .from("alumni_profiles")
    .select(
      "user_id, grad_year, degree, branch, job_title, organization, city, linkedin_url, skills, advice_areas, bio, profiles!inner(full_name, status)",
    )
    .eq("visible", true)
    .eq("profiles.status", "approved");
  if (error) throw error;

  const alumni = (rows ?? []) as AlumniRow[];
  if (!alumni.length) return [];

  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: slotRows, error: sErr } = await supabase
    .from("slots")
    .select("id, alumni_id, starts_at, duration_min")
    .eq("is_booked", false)
    .gt("starts_at", soon)
    .in(
      "alumni_id",
      alumni.map((a) => a.user_id),
    )
    .order("starts_at");
  if (sErr) throw sErr;

  const byAlumni = new Map<string, Slot[]>();
  for (const s of (slotRows ?? []) as (Slot & { alumni_id: string })[]) {
    const list = byAlumni.get(s.alumni_id) ?? [];
    list.push({ id: s.id, starts_at: s.starts_at, duration_min: s.duration_min });
    byAlumni.set(s.alumni_id, list);
  }

  return alumni
    .map((a) => {
      const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
      return {
        id: a.user_id,
        name: p?.full_name || "IITG alumnus",
        grad_year: a.grad_year,
        degree: a.degree,
        branch: a.branch,
        job_title: a.job_title,
        organization: a.organization,
        city: a.city,
        linkedin_url: a.linkedin_url,
        skills: a.skills ?? [],
        advice_areas: a.advice_areas ?? [],
        bio: a.bio ?? "",
        slots: byAlumni.get(a.user_id) ?? [],
      };
    })
    .sort((x, y) => Number(!x.slots.length) - Number(!y.slots.length) || x.name.localeCompare(y.name));
}
