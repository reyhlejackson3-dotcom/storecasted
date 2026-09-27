/**
 * THE STRIPE GATE — the only place access is decided.
 *
 * Statuses, and what they mean here:
 *   free      — comped by you. Early users, friends, your own test account.
 *   trialing  — in the free trial. Allowed until trial_ends_at.
 *   active    — paying.
 *   past_due  — a payment failed; Stripe is retrying. Still allowed, with a
 *               warning — cutting someone off the moment a card bounces is
 *               how you lose customers who would have paid.
 *   anything else (canceled, unpaid, incomplete, expired) — not allowed.
 *
 * Until Stripe is configured, billing is off and everyone is let in, so a
 * missing key can never lock a shop out of its own data.
 */

export interface BillingState {
  subscription_status: string | null;
  trial_ends_at: string | null;
}

export type Access =
  | { allowed: true; plan: "free" | "trial" | "paid" | "unbilled"; trialDaysLeft?: number; warning?: "payment_failed" }
  | { allowed: false; reason: "trial_ended" | "payment_failed" | "cancelled" };

export const TRIAL_DAYS = 7;

export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["STRIPE_SECRET_KEY"] && env["STRIPE_PRICE_ID"]);
}

export function checkAccess(store: BillingState, now: Date = new Date(), enabled = billingEnabled()): Access {
  if (!enabled) return { allowed: true, plan: "unbilled" };

  const status = store.subscription_status ?? "trialing";
  if (status === "free") return { allowed: true, plan: "free" };
  if (status === "active") return { allowed: true, plan: "paid" };
  if (status === "past_due") return { allowed: true, plan: "paid", warning: "payment_failed" };

  if (status === "trialing") {
    const ends = store.trial_ends_at ? Date.parse(store.trial_ends_at) : NaN;
    // No end date recorded: give them a full trial rather than lock them out.
    if (Number.isNaN(ends)) return { allowed: true, plan: "trial", trialDaysLeft: TRIAL_DAYS };
    const left = Math.ceil((ends - now.getTime()) / 86_400_000);
    return left > 0 ? { allowed: true, plan: "trial", trialDaysLeft: left } : { allowed: false, reason: "trial_ended" };
  }

  if (status === "unpaid" || status === "incomplete_expired") return { allowed: false, reason: "payment_failed" };
  return { allowed: false, reason: "cancelled" };
}

/** Stripe's subscription status → ours. They mostly match; this keeps it explicit. */
export function fromStripeStatus(s: string): string {
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
      return s;
    case "incomplete":
    case "paused":
      return "unpaid";
    default:
      return "canceled";
  }
}
