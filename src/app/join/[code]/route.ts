import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { INVITE_COOKIE } from "@/lib/invite";

// Invite links shared with alumni groups: /join/<code>. A valid code is kept in
// a cookie and used when the mentor saves their profile, which approves them.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toLowerCase().trim();
  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { data: ok } = /^[a-z0-9]{8,32}$/.test(code)
    ? await supabase.rpc("invite_link_ok", { p_code: code })
    : { data: false };
  if (!ok) return NextResponse.redirect(new URL("/login?as=alumni&invite=expired", origin));

  const { data: { user } } = await supabase.auth.getUser();
  const res = NextResponse.redirect(new URL(user ? "/onboarding?as=alumni" : "/login?as=alumni&invite=ok", origin));
  res.cookies.set(INVITE_COOKIE, code, {
    httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/", maxAge: 30 * 24 * 3600,
  });
  return res;
}
