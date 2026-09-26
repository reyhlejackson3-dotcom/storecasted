import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/**
 * Where the email link lands. Swaps the one-time code for a session, makes
 * sure this person has a store row, then drops them into the app.
 */
export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", new URL(req.url).origin), { status: 303 });
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Where to land afterwards. Only same-site paths, so the link can't be
  // turned into a redirect to somebody else's site.
  const nextParam = url.searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";
  if (!code) return NextResponse.redirect(new URL("/login?e=link", url.origin));

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?e=expired", url.origin));

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: existing } = await supabase.from("stores").select("id").eq("owner_user_id", user.id).maybeSingle();
    if (!existing) await supabase.from("stores").insert({ owner_user_id: user.id });
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
