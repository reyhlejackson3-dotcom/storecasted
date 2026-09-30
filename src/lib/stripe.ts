import Stripe from "stripe";

/** Server-only Stripe client. Card details never touch our servers — Stripe hosts checkout. */
export function stripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

type SubLike = { trial_end?: number | null; items?: { data?: Array<{ current_period_end?: number }> } };

/** In current Stripe, the billing period lives on the subscription's items, not the subscription. */
export function periodEnd(sub: SubLike): string | null {
  const t = sub.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
}

export function trialEnd(sub: SubLike): string | null {
  return sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
}

/** "$50 a month" — read straight from the live Stripe price, never hardcoded. */
export async function priceLabel(): Promise<string> {
  try {
    const p = await stripe().prices.retrieve(process.env["STRIPE_PRICE_ID"]!);
    const amount = (p.unit_amount ?? 0) / 100;
    const per = p.recurring?.interval ?? "month";
    return `$${amount % 1 === 0 ? amount : amount.toFixed(2)} a ${per}`;
  } catch {
    return "";
  }
}
