import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic links and Google/LinkedIn sign-in both land here with ?code=…
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin)); // "/" routes to the right home
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
