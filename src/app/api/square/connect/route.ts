import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/square/client";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/** Sends a signed-in shop owner to Square's own consent screen. */
export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", new URL(req.url).origin), { status: 303 });
  const origin = new URL(req.url).origin;
  if (!process.env["SQUARE_APPLICATION_ID"] || !process.env["SQUARE_APPLICATION_SECRET"]) {
    return NextResponse.redirect(new URL("/app?square_error=not_configured", origin));
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));

  // A random value we check on the way back, so nobody can forge the return trip.
  const state = randomUUID();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("sq_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
