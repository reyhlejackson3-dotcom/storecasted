/**
 * The signup survey. Stored on stores.business_profile.
 *
 * Today it's used for two things: the AI narration reads it for wording
 * (never for numbers — the number guard still applies), and it tells you who
 * is signing up. `days` is kept structured on purpose: it's the one answer
 * the engine can use later, since a shop closed Mondays sells on 6 days, not 7.
 */

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const CHANNELS = ["My own shop", "Markets & pop-ups", "Online", "Wholesale"] as const;
export const KINDS = ["Gift shop / boutique", "Clothing", "Home goods", "Food & drink", "Market vendor", "Something else"] as const;

export interface BusinessProfile {
  kind: string | null;
  business: string;
  days: string[];
  channels: string[];
  customers: string;
  notes: string;
  skipped?: boolean;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const pick = (v: unknown, allowed: readonly string[]) =>
  Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : [];

/** Anything typed into a form is untrusted: trim it, cap it, keep only known choices. */
export function cleanProfile(input: unknown): BusinessProfile {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = clip(o["kind"], 60);
  return {
    kind: (KINDS as readonly string[]).includes(kind) ? kind : null,
    business: clip(o["business"], 200),
    days: pick(o["days"], DAYS),
    channels: pick(o["channels"], CHANNELS),
    customers: clip(o["customers"], 300),
    notes: clip(o["notes"], 1000),
    ...(o["skipped"] === true ? { skipped: true } : {}),
  };
}

/** A few plain lines for the AI's wording. Never a source of numbers. */
export function profileForPrompt(p: BusinessProfile | null | undefined): string {
  if (!p || p.skipped) return "";
  const lines = [
    p.kind && `Type of business: ${p.kind}`,
    p.business && `What they sell: ${p.business}`,
    p.days.length > 0 && `Open: ${p.days.join(", ")}`,
    p.channels.length > 0 && `Sells through: ${p.channels.join(", ")}`,
    p.customers && `Customers: ${p.customers}`,
    p.notes && `Owner's notes: ${p.notes}`,
  ].filter(Boolean);
  return lines.join("\n");
}
