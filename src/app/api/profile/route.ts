import { NextResponse } from "next/server";
import { cleanProfile } from "@/lib/profile";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/** Saves the signup survey. Owners may write these columns themselves (see schema.sql). */
export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "not configured" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });

  const profile = cleanProfile(await req.json().catch(() => null));
  const { error } = await supabase
    .from("stores")
    .update({ business_profile: profile, onboarded_at: new Date().toISOString() })
    .eq("owner_user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
