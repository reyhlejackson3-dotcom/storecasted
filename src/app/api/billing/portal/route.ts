import { NextResponse } from "next/server";
import { billingEnabled } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

/** Stripe's own page for updating a card, seeing invoices, or cancelling. */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, origin), { status: 303 });
  if (!supabaseConfigured() || !billingEnabled()) return to("/app");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return to("/login");
  const { data: store } = await supabase
    .from("stores").select("stripe_customer_id, stripe_subscription_id").eq("owner_user_id", user.id).single();
  if (!store?.stripe_customer_id) return to("/billing");

  // "Cancel subscription" goes straight to Stripe's cancel screen — one click
  // from the billing page, as easy as signing up was.
  const cancel = new URL(req.url).searchParams.get("flow") === "cancel" && store.stripe_subscription_id;
  const session = await stripe().billingPortal.sessions.create({
    customer: store.stripe_customer_id,
    return_url: `${origin}/billing`,
    ...(cancel
      ? {
          flow_data: {
            type: "subscription_cancel" as const,
            subscription_cancel: { subscription: store.stripe_subscription_id! },
            after_completion: { type: "redirect" as const, redirect: { return_url: `${origin}/billing?cancelled=1` } },
          },
        }
      : {}),
  });
  return NextResponse.redirect(session.url, { status: 303 });
}
