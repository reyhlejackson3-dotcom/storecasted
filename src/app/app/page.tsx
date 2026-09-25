import { redirect } from "next/navigation";
import App from "../App";
import { demoSnapshot } from "@/lib/demo";
import { buildBriefing } from "@/lib/briefing/build";
import { checkAccess } from "@/lib/billing";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { loadSnapshot, type StoreRecord } from "@/lib/store-repo";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  "1": "Square is connected. We're pulling in your sales and stock now — this page will switch to your shop in a minute or two.",
  synced: "Up to date — just pulled your latest Square data.",
  sync: "Square didn't finish syncing. Try Sync now again in a minute.",
  not_configured: "Square isn't set up on our side yet. Nothing was changed on your account.",
  denied: "You didn't approve the connection, so nothing was shared. You can try again any time.",
  state: "That connection link expired or was opened in a different browser. Please try again.",
  owner_only: "Only the business owner can connect a Square account. Ask them to sign in and connect it.",
  already_linked: "That Square account is already connected to a different Storecasted login.",
  failed: "Square didn't finish connecting. Please try again.",
};

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; synced?: string; square_error?: string }>;
}) {
  if (!supabaseConfigured()) redirect("/login");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: store } = await supabase.from("stores").select("*").eq("owner_user_id", user.id).maybeSingle();
  if (!store) {
    const created = await supabase.from("stores").insert({ owner_user_id: user.id }).select("*").single();
    store = created.data;
  }

  // The Stripe gate. Always open for now — see src/lib/billing.ts.
  const access = checkAccess(store ?? { subscription_status: null, trial_ends_at: null });
  if (!access.allowed) redirect("/billing");

  const params = await searchParams;
  const notice = params.connected ? NOTICES["1"]
    : params.synced ? NOTICES["synced"]
    : params.square_error ? NOTICES[params.square_error] ?? NOTICES["failed"]
    : undefined;

  const connected = Boolean(store?.square_connected_at);
  const synced = connected && Boolean(store?.last_synced_at);
  const syncState: "none" | "syncing" | "ready" | "error" =
    !connected ? "none" : synced ? "ready" : store?.sync_error ? "error" : "syncing";

  // Their own shop once the first sync lands; the demo store until then.
  const snapshot = synced ? await loadSnapshot(store as StoreRecord) : demoSnapshot();
  const { briefing, alsoNoticed } = buildBriefing(snapshot);

  return (
    <App
      mode="account"
      storeName={synced ? store?.store_name ?? "Your store" : "Ridgeline Mercantile"}
      snapshot={snapshot}
      briefing={briefing}
      alsoNoticed={alsoNoticed}
      account={{
        email: user.email ?? "",
        squareConnected: connected,
        needsReconnect: Boolean(store?.square_needs_reconnect),
        syncState,
        syncError: store?.sync_error ?? undefined,
        lastSynced: store?.last_synced_at ?? undefined,
        notice,
      }}
    />
  );
}
