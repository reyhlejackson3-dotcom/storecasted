import { NextResponse } from "next/server";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", new URL(req.url).origin), { status: 303 });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
