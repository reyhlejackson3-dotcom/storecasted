import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { fromStripeStatus } from "@/lib/billing";
import { periodEnd, stripe, trialEnd } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Stripe tells us when a subscription starts, renews, fails or ends. This is
 * the ONLY place subscription_status changes — never trust the browser's
 * word that someone paid.
 *
 * Events to subscribe to in the Stripe dashboard:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 */
export async function POST(req: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "not configured" }, { status: 400 });

  // Signature is checked against the raw body, so read it untouched.
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  async function apply(sub: Stripe.Subscription) {
    const db = supabaseAdmin();
    const storeId = sub.metadata?.["store_id"];
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const update = {
      subscription_status: fromStripeStatus(sub.status),
      stripe_subscription_id: sub.id,
      stripe_customer_id: customer,
      current_period_end: periodEnd(sub),
      // set when they cancel: the plan keeps working until this date
      cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
      ...(trialEnd(sub) ? { trial_ends_at: trialEnd(sub) } : {}),
    };
    const q = db.from("stores").update(update);
    const { error } = storeId ? await q.eq("id", storeId) : await q.eq("stripe_customer_id", customer);
    if (error) throw new Error(error.message);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await apply(await stripe().subscriptions.retrieve(id));
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await apply(event.data.object);
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry later, which is what we want if the database blipped.
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
