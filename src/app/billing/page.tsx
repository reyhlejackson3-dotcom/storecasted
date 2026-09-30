import Link from "next/link";
import { redirect } from "next/navigation";
import { billingEnabled, checkAccess } from "@/lib/billing";
import { priceLabel, stripe } from "@/lib/stripe";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Billing({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: store } = await supabase.from("stores").select("*").eq("owner_user_id", user.id).maybeSingle();

  const on = billingEnabled();
  const access = checkAccess(store ?? { subscription_status: null, trial_ends_at: null });
  if (!access.allowed && access.reason === "requires_checkout") redirect("/checkout");
  const price = on ? await priceLabel() : "";
  const status = store?.subscription_status ?? "trialing";
  const hasCustomer = Boolean(store?.stripe_customer_id);
  const endsOn = store?.cancel_at
    ? new Date(store.cancel_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  const hasSubscription = Boolean(store?.stripe_subscription_id) && ["active", "trialing", "past_due"].includes(status);
  const renews = store?.current_period_end
    ? new Date(store.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : null;

  let headline = "Your plan";
  let body = "";
  if (!on) { headline = "Free for now."; body = "Billing isn't switched on yet, so everything's free. Nothing to do here."; }
  else if (access.allowed && access.plan === "free") { headline = "You're on us."; body = "This account is complimentary — no card needed."; }
  else if (access.allowed && access.plan === "trial") { headline = `${access.trialDaysLeft} ${access.trialDaysLeft === 1 ? "day" : "days"} left in your free trial.`; body = `Add a card any time and keep going after it ends${price ? ` — ${price}` : ""}. You won't be charged until the trial is over.`; }
  else if (access.allowed && access.warning === "payment_failed") { headline = "Your last payment didn't go through."; body = "Update your card to keep your briefing coming. Everything still works while it's sorted."; }
  else if (access.allowed && endsOn) { headline = `Your subscription ends ${endsOn}.`; body = "You've cancelled, so you won't be charged again. Everything keeps working until then — change your mind any time before it ends."; }
  else if (access.allowed) { headline = "You're subscribed."; body = `${price ? `${price}. ` : ""}${renews ? `Renews ${renews}.` : ""}`; }
  else if (!access.allowed && access.reason === "trial_ended") { headline = "Your free trial has ended."; body = `Subscribe to keep your morning briefing${price ? ` — ${price}` : ""}. Your data's all still here.`; }
  else { headline = "Your subscription has ended."; body = `Resubscribe to pick up where you left off${price ? ` — ${price}` : ""}. Your data's all still here.`; }

  const canSubscribe = on && !(access.allowed && (access.plan === "paid" || access.plan === "free")) && status !== "active";

  return (
    <div className="auth-wrap" style={{ maxWidth: 620 }}>
      {access.allowed && <Link href="/app" className="auth-back">← Back to your briefing</Link>}
      <p className="dateline">Billing</p>
      <h1 className="hero" style={{ maxWidth: "15ch", fontSize: "clamp(32px, 7vw, 48px)" }}>{headline}</h1>
      {body && <p className="sub" style={{ marginBottom: 28 }}>{body}</p>}
      <div className="survey-actions">
        {canSubscribe && (
          <form action="/api/billing/checkout" method="post">
            <button className="btn lp-btn-big">{status === "trialing" ? "Add a card" : "Subscribe"}</button>
          </form>
        )}
        {on && hasCustomer && (
          <form action="/api/billing/portal" method="post">
            <button className={canSubscribe ? "link-btn" : "btn lp-btn-big"}>{endsOn ? "Resume or manage" : "Manage billing"}</button>
          </form>
        )}
      </div>
      {on && hasSubscription && !endsOn && (
        <form action="/api/billing/portal?flow=cancel" method="post" style={{ marginTop: 22 }}>
          <button className="link-btn cancel-link">Cancel subscription</button>
        </form>
      )}
      {cancelled && <p className="banner" style={{ marginTop: 22 }}>Cancelled. It can take a few seconds to show here — refresh if it doesn&apos;t.</p>}
      {on && <p className="note" style={{ marginTop: 26 }}>Payments are handled by Stripe. Storecasted never sees your card details. Cancel any time — you keep access until the end of the period you&apos;ve paid for.</p>}
      <p className="note" style={{ marginTop: 10 }}><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a></p>
    </div>
  );
}
