import type Stripe from "stripe";
import { fromStripeStatus } from "@/lib/billing";
import { periodEnd, stripe, trialEnd } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Keeps a store's billing columns in step with Stripe.
 *
 * The webhook is still the main path, but it is no longer the ONLY path. If a
 * webhook is late, misconfigured, or fails, a shop that just paid would be
 * bounced straight back to the paywall. So the app can also ask Stripe
 * directly ("does this store have a live subscription?") and write the answer
 * itself. Either way the data comes from Stripe on the server — never from
 * anything the browser says.
 */

type StoreRow = {
  id: string;
  stripe_customer_id?: string | null;
  [key: string]: unknown;
};

const LIVE = new Set(["trialing", "active", "past_due"]);

/** Stripe subscription → the columns we store. Pure, so it's testable. */
export function subscriptionUpdate(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return {
    subscription_status: fromStripeStatus(sub.status),
    stripe_subscription_id: sub.id,
    stripe_customer_id: customer,
    current_period_end: periodEnd(sub),
    // set when they cancel: the plan keeps working until this date
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    ...(trialEnd(sub) ? { trial_ends_at: trialEnd(sub) } : {}),
  };
}

/** Write a subscription onto its store (by store_id metadata, else by customer). */
export async function applySubscription(sub: Stripe.Subscription, fallbackStoreId?: string) {
  const update = subscriptionUpdate(sub);
  const storeId = sub.metadata?.["store_id"] || fallbackStoreId;
  const q = supabaseAdmin().from("stores").update(update);
  const { data, error } = storeId
    ? await q.eq("id", storeId).select("*").maybeSingle()
    : await q.eq("stripe_customer_id", update.stripe_customer_id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Save the Stripe customer on the store. Needs the service role — owners can't write billing columns. */
export async function saveCustomerId(storeId: string, customerId: string) {
  const { error } = await supabaseAdmin().from("stores").update({ stripe_customer_id: customerId }).eq("id", storeId);
  if (error) throw new Error(error.message);
}

/** Every Stripe customer that could belong to this store: the saved one, plus any with the owner's email. */
async function candidateCustomers(store: StoreRow, email: string | undefined): Promise<string[]> {
  const ids = new Set<string>();
  if (store.stripe_customer_id) ids.add(store.stripe_customer_id);
  if (email) {
    const list = await stripe().customers.list({ email, limit: 20 });
    for (const c of list.data) ids.add(c.id);
  }
  return [...ids];
}

/**
 * Find this store's live subscription in Stripe, if one exists.
 * Only subscriptions this app created FOR THIS STORE count (metadata.store_id
 * is set server-side at checkout), so sharing an email can't unlock anything.
 */
export async function findLiveSubscription(store: StoreRow, email: string | undefined): Promise<Stripe.Subscription | null> {
  const s = stripe();
  let best: Stripe.Subscription | null = null;
  for (const customer of await candidateCustomers(store, email)) {
    const subs = await s.subscriptions.list({ customer, status: "all", limit: 20 });
    for (const sub of subs.data) {
      if (!LIVE.has(sub.status)) continue;
      if (sub.metadata?.["store_id"] !== store.id) continue;
      // Prefer the newest one if there are duplicates.
      if (!best || sub.created > best.created) best = sub;
    }
  }
  return best;
}

/**
 * The fallback: if Stripe says this store is subscribed but our database
 * doesn't know yet, fix the database. Returns the updated store row, or null
 * if there's nothing to recover. Never throws — a Stripe or database hiccup
 * just means the normal gate decides.
 */
export async function recoverSubscription(store: StoreRow, email: string | undefined) {
  try {
    const sub = await findLiveSubscription(store, email);
    if (!sub) return null;
    return await applySubscription(sub, store.id);
  } catch (err) {
    console.error("[billing] could not recover subscription from Stripe:", err);
    return null;
  }
}
