import { supabaseAdmin } from "./supabase/admin";
import { localDay } from "./square/transform";
import type { BriefingItem, Product, SalesSeries, StoreSnapshot } from "./types";
import type { StoreRow } from "./square/sync";

/**
 * Reading and writing a real store's data. loadSnapshot() returns exactly the
 * same StoreSnapshot shape as demoSnapshot(), which is why the engine and the
 * screens work identically on both.
 */

export const SNAPSHOT_DAYS = 400;

export interface StoreRecord extends StoreRow {
  store_name: string;
  owner_user_id: string;
  square_connected_at: string | null;
  square_needs_reconnect: boolean;
  sync_error: string | null;
}

/** Every connected store that isn't waiting on a reconnect. */
export async function storesDueNow(): Promise<StoreRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from("stores")
    .select("*")
    .not("square_connected_at", "is", null)
    .eq("square_needs_reconnect", false);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoreRecord[];
}

async function allRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadSnapshot(store: StoreRecord): Promise<StoreSnapshot> {
  const db = supabaseAdmin();
  const asOf = (() => {
    const d = new Date(localDay(new Date().toISOString(), store.timezone) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const start = new Date(asOf + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - (SNAPSHOT_DAYS - 1));
  const startDate = start.toISOString().slice(0, 10);
  const indexOf = (day: string) => Math.round((Date.parse(day + "T00:00:00Z") - start.getTime()) / 86_400_000);

  type ProductRow = {
    square_item_id: string; name: string; category: string | null; price_cents: number;
    unit_cost_cents: number | null; stock: number | null; last_received_at: string | null; returns_90d: number;
  };
  const productRows = await allRows<ProductRow>((a, b) =>
    db.from("products").select("*").eq("store_id", store.id).order("name").range(a, b));

  const dailyRows = await allRows<{ square_item_id: string; day: string; units_sold: number }>((a, b) =>
    db.from("product_daily").select("square_item_id, day, units_sold")
      .eq("store_id", store.id).gte("day", startDate).lte("day", asOf).range(a, b));

  const storeDaily = await allRows<{ day: string; order_count: number }>((a, b) =>
    db.from("store_daily").select("day, order_count")
      .eq("store_id", store.id).gte("day", startDate).lte("day", asOf).range(a, b));

  const units = new Map<string, number[]>();
  for (const p of productRows) units.set(p.square_item_id, new Array<number>(SNAPSHOT_DAYS).fill(0));
  for (const r of dailyRows) {
    const arr = units.get(r.square_item_id);
    const i = indexOf(r.day);
    if (arr && i >= 0 && i < SNAPSHOT_DAYS) arr[i] = r.units_sold;
  }
  const ordersPerDay = new Array<number>(SNAPSHOT_DAYS).fill(0);
  for (const r of storeDaily) {
    const i = indexOf(r.day);
    if (i >= 0 && i < SNAPSHOT_DAYS) ordersPerDay[i] = r.order_count;
  }

  const products: Product[] = productRows.map((p) => ({
    squareItemId: p.square_item_id,
    name: p.name,
    category: p.category,
    priceCents: p.price_cents,
    unitCostCents: p.unit_cost_cents,
    stock: p.stock,
    lastReceivedAt: p.last_received_at,
  }));
  const series: SalesSeries[] = productRows.map((p) => ({
    squareItemId: p.square_item_id, startDate, units: units.get(p.square_item_id) ?? [],
  }));
  const returnsByItem: Record<string, number> = {};
  for (const p of productRows) returnsByItem[p.square_item_id] = p.returns_90d;

  return { storeId: store.id, asOf, products, series, ordersPerDay, returnsByItem };
}

export async function saveBriefing(storeId: string, day: string, items: BriefingItem[], fallbackNote?: string): Promise<void> {
  const { error } = await supabaseAdmin().from("briefings").upsert({
    store_id: storeId,
    day,
    items,
    template_count: items.filter((i) => i.generatedBy === "template").length,
    llm_count: items.filter((i) => i.generatedBy === "llm").length,
    llm_fallback_note: fallbackNote ?? null,
    generated_at: new Date().toISOString(),
  }, { onConflict: "store_id,day" });
  if (error) throw new Error(error.message);
}
