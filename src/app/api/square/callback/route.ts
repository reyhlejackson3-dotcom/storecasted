import { NextResponse, after, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/square/client";
import { decryptToken } from "@/lib/crypto";
import { isSandbox } from "@/lib/env";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncStore, type StoreRow } from "@/lib/square/sync";

/**
 * Square sends the owner back here after they approve. Register exactly this
 * path in the Square developer console as the OAuth redirect URL:
 *   {your site}/api/square/callback
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", new URL(req.url).origin), { status: 303 });
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/app?${q}`, url.origin));
    res.cookies.delete("sq_state");
    return res;
  };

  const error = url.searchParams.get("error");
  if (error) return back(`square_error=${error === "access_denied" ? "denied" : "failed"}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("sq_state")?.value) return back("square_error=state");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return back(`square_error=${/owner/i.test(msg) ? "owner_only" : "failed"}`);
  }

  // The shop's own name, for the header. Nice to have — never blocks connecting.
  let storeName: string | undefined;
  try {
    const base = isSandbox() ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
    const r = await fetch(`${base}/v2/merchants/me`, {
      headers: { Authorization: `Bearer ${decryptToken(tokens.accessToken)}`, "Square-Version": "2025-01-23" },
    });
    if (r.ok) storeName = ((await r.json()) as { merchant?: { business_name?: string } }).merchant?.business_name;
  } catch { /* keep going without a name */ }

  const { error: dbError } = await supabase
    .from("stores")
    .update({
      square_merchant_id: tokens.merchantId,
      square_access_token: tokens.accessToken,   // already encrypted
      square_refresh_token: tokens.refreshToken, // already encrypted
      square_token_expires_at: tokens.expiresAt,
      square_connected_at: new Date().toISOString(),
      square_needs_reconnect: false,
      ...(storeName ? { store_name: storeName } : {}),
    })
    .eq("owner_user_id", user.id);

  if (dbError) return back(`square_error=${dbError.code === "23505" ? "already_linked" : "failed"}`);

  // First sync runs after the redirect is sent, so the owner isn't left staring
  // at a spinner while a year of orders downloads. The app page shows progress.
  after(async () => {
    const { data } = await supabaseAdmin().from("stores").select("*").eq("owner_user_id", user.id).single();
    if (data) await syncStore(data as StoreRow).catch(() => { /* recorded in stores.sync_error */ });
  });
  return back("connected=1");
}
