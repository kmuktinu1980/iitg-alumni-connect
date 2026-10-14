import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "student" | "alumni";
export type Status = "onboarding" | "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  full_name: string;
  role: Role | null;
  status: Status;
  is_admin: boolean;
};

export async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, status, is_admin")
    .eq("id", user.id)
    .single();
  const profile: Profile = (data as Profile | null) ?? {
    id: user.id,
    full_name: "",
    role: null,
    status: "onboarding",
    is_admin: false,
  };
  return { user, profile, supabase };
}

export function homeFor(p: Profile) {
  if (!p.role || p.status === "onboarding") return p.is_admin ? "/admin" : "/onboarding";
  if (p.status !== "approved") return "/pending";
  return p.role === "student" ? "/find" : "/availability";
}

/** Server-page guard. Redirects anyone who shouldn't be here. */
export async function requireViewer(opts: { role?: Role; admin?: boolean } = {}) {
  const v = await getViewer();
  if (!v) redirect("/login");
  const p = v.profile;
  if (opts.admin) {
    if (!p.is_admin) redirect(homeFor(p));
    return v;
  }
  if (!p.role || p.status === "onboarding") redirect("/onboarding");
  if (p.status !== "approved") redirect("/pending");
  if (opts.role && p.role !== opts.role) redirect(homeFor(p));
  return v;
}
