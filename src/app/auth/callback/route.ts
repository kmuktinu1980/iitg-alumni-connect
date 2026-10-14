import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Sign-in links land here. Two formats are supported:
//   ?code=…                     the default Supabase link (must be opened in
//                               the same browser that requested it)
//   ?token_hash=…&type=email    the email-template format recommended in the
//                               README; works in any browser or email app
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const supabase = await createClient();

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", url.origin)); // "/" routes to the right home
    console.error("verifyOtp failed:", error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
    console.error("exchangeCodeForSession failed:", error.message);
    // Most common cause: the link was opened in a different browser or an
    // email app's built-in browser than the one that requested it.
    return NextResponse.redirect(new URL("/login?error=browser", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
