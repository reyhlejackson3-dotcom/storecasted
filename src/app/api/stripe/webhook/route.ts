import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { applySubscription } from "@/lib/subscription-sync";

/**
 * Stripe tells us when a subscription starts, renews, fails or ends. This is
 * the main place subscription_status changes. (The app can also recover a
 * missed update by asking Stripe directly — see src/lib/subscription-sync.ts.)
 * Never trust the browser's word that someone paid.
 *
 * Events to subscribe to in the Stripe dashboard, at
 * https://<your-domain>/api/stripe/webhook :
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 */
export async function POST(req: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) {
    console.error("[stripe webhook] missing", !secret ? "STRIPE_WEBHOOK_SECRET" : "stripe-signature header");
    return NextResponse.json({ error: "not configured" }, { status: 400 });
  }

  // Signature is checked against the raw body, so read it untouched.
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch (err) {
    console.error("[stripe webhook] bad signature — STRIPE_WEBHOOK_SECRET doesn't match this endpoint:", err);
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await applySubscription(await stripe().subscriptions.retrieve(id), session.client_reference_id ?? undefined);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(event.data.object);
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] failed to apply", event.type, err);
    // A 500 makes Stripe retry later, which is what we want if the database blipped.
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
