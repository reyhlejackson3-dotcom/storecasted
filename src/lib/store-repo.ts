import type { BriefingItem, StoreSnapshot } from "./types";

/**
 * PLACEHOLDER — not wired to Square or Supabase yet.
 * route.ts needs these three functions to exist so the app builds.
 * StoreSnapshot in ./types.ts is the contract the real version must satisfy.
 */

export interface StoreRecord {
  id: string;
  squareAccessToken: string;
  timezone: string;
}

export async function storesDueNow(): Promise<StoreRecord[]> {
  return [];
}

export async function loadSnapshot(store: StoreRecord): Promise<StoreSnapshot> {
  throw new Error(`loadSnapshot not implemented yet for store ${store.id}`);
}

export async function saveBriefing(
  storeId: string,
  day: string,
  items: BriefingItem[],
  fallbackNote?: string,
): Promise<void> {
  console.log(`[stub] ${items.length} item(s) for ${storeId} on ${day}`, fallbackNote);
}
