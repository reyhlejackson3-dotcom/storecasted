import { NextResponse } from "next/server";
import { TRIAL_DAYS, billingEnabled } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { recoverSubscription, saveCustomerId } from "@/lib/subscription-sync";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/**
 * Sends the owner to Stripe's hosted checkout.
 *
 * The card is collected here, up front — Stripe's checkout requires one by
 * default for a subscription, trial or not. The trial itself runs inside
 * Stripe (subscription_data.trial_period_days): Stripe charges the card
 * automatically the moment the trial ends, with no further action from us.
 * The result comes back on the webhook, which is the only place
 * subscription_status is ever set.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, origin), { status: 303 });
  if (!supabaseConfigured() || !billingEnabled()) return to("/app");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return to("/login");
  const { data: store } = await supabase.from("stores").select("*").eq("owner_user_id", user.id).single();
  if (!store) return to("/app");

  const s = stripe();

  // Already subscribed in Stripe (e.g. the webhook hasn't landed yet)? Sync it
  // and go straight in — never start a second trial for the same store.
  if (await recoverSubscription(store, user.email ?? undefined)) return to("/app?billing=success");

  // One Stripe customer per store, created the first time they check out.
  // Reuse one we made for this store before, even if saving its ID failed.
  let customer = store.stripe_customer_id as string | null;
  if (!customer && user.email) {
    const existing = await s.customers.list({ email: user.email, limit: 20 });
    customer = existing.data.find((c) => c.metadata?.["store_id"] === store.id)?.id ?? null;
  }
  if (!customer) {
    const c = await s.customers.create({ email: user.email ?? undefined, metadata: { store_id: store.id } });
    customer = c.id;
  }
  // Billing columns can only be written with the service role (see schema.sql),
  // so this uses the admin client. The old version used the owner's session,
  // which the database silently refused — so every checkout made a new customer.
  if (customer !== store.stripe_customer_id) await saveCustomerId(store.id, customer);

  // The trial is a one-time thing: only offered if this store has never had
  // one. A store resubscribing after cancelling is charged immediately.
  const firstTrial = !store.stripe_subscription_id && !store.trial_ends_at;

  let priceText = "the price shown at checkout";
  try {
    const pr = await s.prices.retrieve(process.env["STRIPE_PRICE_ID"]!);
    const amt = (pr.unit_amount ?? 0) / 100;
    priceText = `$${amt % 1 === 0 ? amt : amt.toFixed(2)} per ${pr.recurring?.interval ?? "month"}`;
  } catch { /* fall back to the generic wording */ }

  const disclosure = firstTrial
    ? `Your card will be charged ${priceText} when your ${TRIAL_DAYS}-day free trial ends, unless you cancel first. ` +
      `It then renews automatically until you cancel. Cancel any time from the Billing page in Storecasted. ` +
      `By continuing you agree to the Storecasted Terms of Service at ${origin}/terms.`
    : `Your card will be charged ${priceText} today, and it renews automatically until you cancel. ` +
      `Cancel any time from the Billing page in Storecasted. ` +
      `By continuing you agree to the Storecasted Terms of Service at ${origin}/terms.`;

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: store.id,
    line_items: [{ price: process.env["STRIPE_PRICE_ID"]!, quantity: 1 }],
    subscription_data: {
      metadata: { store_id: store.id },
      ...(firstTrial ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    // Card required either way — this is what makes the trial "enter a card
    // now, charged automatically later" rather than "add a card eventually."
    payment_method_collection: "always",
    allow_promotion_codes: true,
    custom_text: { submit: { message: disclosure } },
    success_url: `${origin}/app?billing=success`,
    cancel_url: `${origin}/checkout`,
  });
  return NextResponse.redirect(session.url!, { status: 303 });
}
