import { redirect } from "next/navigation";
import { TRIAL_DAYS, billingEnabled, checkAccess } from "@/lib/billing";
import { priceLabel } from "@/lib/stripe";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { recoverSubscription } from "@/lib/subscription-sync";

export const dynamic = "force-dynamic";

/**
 * The one mandatory stop before a new account can use Storecasted: enter a
 * card, start the trial. No skip button — if billing is on, this is required.
 */
export default async function Checkout() {
  if (!supabaseConfigured() || !billingEnabled()) redirect("/app");

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: store } = await supabase.from("stores").select("*").eq("owner_user_id", user.id).maybeSingle();
  if (!store) redirect("/app");
  if (!store.onboarded_at) redirect("/welcome");

  // Already has a working subscription — nothing to do here.
  if (checkAccess(store).allowed) redirect("/app");
  // Stripe may already have their trial even if our database hasn't heard yet.
  const recovered = await recoverSubscription(store, user.email ?? undefined);
  if (recovered && checkAccess(recovered).allowed) redirect("/app");

  const resubscribing = Boolean(store.trial_ends_at);
  const price = await priceLabel();

  return (
    <div className="auth-wrap" style={{ maxWidth: 560 }}>
      <p className="dateline">{resubscribing ? "Resubscribe" : `${TRIAL_DAYS}-day free trial`}</p>
      <h1 className="hero" style={{ maxWidth: "13ch" }}>
        {resubscribing ? "Add a payment method to continue." : "Add a card to start your trial."}
      </h1>
      <p className="sub" style={{ marginBottom: 28 }}>
        {resubscribing
          ? `You'll be charged ${price || "the plan price"} today, then it renews automatically until you cancel.`
          : `We need a card on file to start the trial. You won't be charged until it ends in ${TRIAL_DAYS} days${price ? ` — then it's ${price}` : ""}. Cancel any time before then and you pay nothing.`}
      </p>
      <form action="/api/billing/checkout" method="post">
        <button className="btn lp-btn-big">{resubscribing ? "Continue to payment" : "Start free trial"}</button>
      </form>
      <p className="note" style={{ marginTop: 22 }}>
        Payments are handled by Stripe. Storecasted never sees your card details.{" "}
        <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
      </p>
      <form action="/auth/signout" method="post" style={{ marginTop: 18 }}>
        <button className="link-btn">Sign out</button>
      </form>
    </div>
  );
}
