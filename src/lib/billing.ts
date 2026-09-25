/**
 * THE STRIPE GATE — the only place billing is decided.
 *
 * Right now every account is free and this always says yes. When Stripe is
 * wired up, this is the one function that changes: check the store's
 * subscription_status (and trial_ends_at) and return allowed: false with a
 * reason. Every page that needs a paid account already calls this, so
 * nothing else has to move.
 */

export interface BillingState {
  subscription_status: string | null;
  trial_ends_at: string | null;
}

export type Access =
  | { allowed: true; plan: "free" | "trial" | "paid" }
  | { allowed: false; reason: "trial_ended" | "payment_failed" | "cancelled" };

export function checkAccess(store: BillingState): Access {
  void store; // read once the gate is live
  return { allowed: true, plan: "free" };
}
