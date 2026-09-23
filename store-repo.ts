import type { BriefingItem, StoreSnapshot } from "./types";

/**
 * PLACEHOLDER — not wired to Square or Supabase yet.
 *
 * route.ts needs these three functions to exist so the app builds and
 * deploys. Replace each one when you build the real Square sync: the
 * StoreSnapshot shape in ./types.ts is the contract to satisfy, and
 * everything downstream of it (metrics, rules, templates, narrate) is
 * already built and tested against that exact shape.
 */

export interface StoreRecord {
  id: string;
  squareAccessToken: string; // encrypted, see ./crypto.ts
  timezone: string;
}

/** Which stores are due for their daily briefing right now. */
export async function storesDueNow(): Promise<StoreRecord[]> {
  // Real version: query Supabase for stores where local time is ~5am
  // and subscription_status is 'trialing' or 'active'.
  return [];
}

/** Pull one store's Square data into the shape metrics.ts expects. */
export async function loadSnapshot(store: StoreRecord): Promise<StoreSnapshot> {
  throw new Error(
    `loadSnapshot not implemented yet — wire this to Square for store ${store.id}`,
  );
}

/** Write the day's briefing so the app can display it. */
export async function saveBriefing(
  storeId: string,
  day: string,
  items: BriefingItem[],
  fallbackNote?: string,
): Promise<void> {
  // Real version: upsert into the `briefings` table (see supabase/schema.sql).
  console.log(`[stub] would save ${items.length} briefing item(s) for ${storeId} on ${day}`, {
    fallbackNote,
  });
}
