import { NextResponse } from "next/server";
import { syncStore } from "@/lib/square/sync";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import type { StoreRow } from "@/lib/square/sync";

export const maxDuration = 300;

/** "Sync now" — lets a signed-in owner pull their latest Square data on demand. */
export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", new URL(req.url).origin), { status: 303 });
  const origin = new URL(req.url).origin;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin), { status: 303 });

  const { data: store } = await supabase.from("stores").select("*").eq("owner_user_id", user.id).maybeSingle();
  if (!store?.square_connected_at) return NextResponse.redirect(new URL("/app", origin), { status: 303 });

  try {
    await syncStore(store as StoreRow);
    return NextResponse.redirect(new URL("/app?synced=1", origin), { status: 303 });
  } catch {
    return NextResponse.redirect(new URL("/app?square_error=sync", origin), { status: 303 });
  }
}
