import { NextResponse } from "next/server";
import { billingEnabled } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Sends the owner to Stripe's hosted checkout to subscribe. */
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

  // One Stripe customer per store, created the first time they subscribe.
  let customer = store.stripe_customer_id as string | null;
  if (!customer) {
    const c = await s.customers.create({ email: user.email ?? undefined, metadata: { store_id: store.id } });
    customer = c.id;
    // billing columns are server-only (see schema.sql)
    await supabaseAdmin().from("stores").update({ stripe_customer_id: customer }).eq("id", store.id);
  }

  // Subscribing mid-trial shouldn't cost them their remaining free days:
  // the first charge waits until the trial would have ended. (Stripe needs
  // that date to be at least two days out.)
  const trialEnds = store.trial_ends_at ? Date.parse(store.trial_ends_at) : 0;
  const keepTrial = store.subscription_status === "trialing" && trialEnds > Date.now() + 2.1 * 86_400_000;

  // Plain-English terms directly above the pay button, before any charge.
  let priceText = "the price shown above";
  try {
    const pr = await s.prices.retrieve(process.env["STRIPE_PRICE_ID"]!);
    const amt = (pr.unit_amount ?? 0) / 100;
    priceText = `$${amt % 1 === 0 ? amt : amt.toFixed(2)} per ${pr.recurring?.interval ?? "month"}`;
  } catch { /* fall back to the generic wording */ }
  const disclosure =
    (keepTrial ? "You won't be charged until your free trial ends. After that, " : "") +
    `${keepTrial ? "your" : "Your"} subscription is ${priceText} and renews automatically until you cancel. ` +
    `Cancel any time from the Billing page in Storecasted — you keep access until the end of the period you've paid for. ` +
    `By subscribing you agree to the Storecasted Terms of Service at ${origin}/terms.`;

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: store.id,
    line_items: [{ price: process.env["STRIPE_PRICE_ID"]!, quantity: 1 }],
    subscription_data: {
      metadata: { store_id: store.id },
      ...(keepTrial ? { trial_end: Math.floor(trialEnds / 1000) } : {}),
    },
    allow_promotion_codes: true,
    custom_text: { submit: { message: disclosure } },
    success_url: `${origin}/app?billing=success`,
    cancel_url: `${origin}/billing`,
  });
  return NextResponse.redirect(session.url!, { status: 303 });
}
