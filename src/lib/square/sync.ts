import { decryptToken } from "../crypto";
import { supabaseAdmin } from "../supabase/admin";
import { refreshAccessToken } from "./client";
import { SquareError, inventoryCounts, listCatalog, listLocations, searchOrders, stockReceipts } from "./api";
import { catalogToProducts, lastReceived, localDay, ordersToDaily, stockFor } from "./transform";

/**
 * Pulls one store's data from Square and writes it to the database.
 *
 * First sync reaches back FIRST_SYNC_DAYS. Every sync after that re-reads the
 * last RESYNC_DAYS, which catches late edits and refunds and keeps the 90-day
 * returns figure exact. Windows are replaced wholesale, never merged, so a
 * refunded sale can't leave a stale number behind.
 *
 * Simplification to know about: revenue in the engine is units × current
 * price. The real money taken per day is stored too (store_daily.revenue_cents)
 * for when discounts need to be reflected.
 */

const FIRST_SYNC_DAYS = 400;
const RESYNC_DAYS = 90;
const RECEIPT_LOOKBACK_DAYS = 365;

export interface StoreRow {
  id: string;
  square_access_token: string | null;
  square_refresh_token: string | null;
  square_token_expires_at: string | null;
  last_synced_at: string | null;
  timezone: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

export async function syncStore(store: StoreRow): Promise<{ products: number; orders: number }> {
  const db = supabaseAdmin();

  try {
    if (!store.square_access_token) throw new Error("Store has no Square connection");

    // Refresh the token if it expires within three days.
    let encrypted = store.square_access_token;
    const expires = store.square_token_expires_at ? Date.parse(store.square_token_expires_at) : 0;
    if (store.square_refresh_token && expires - Date.now() < 3 * 86_400_000) {
      const t = await refreshAccessToken(store.square_refresh_token);
      encrypted = t.accessToken;
      await db.from("stores").update({
        square_access_token: t.accessToken,
        square_refresh_token: t.refreshToken,
        square_token_expires_at: t.expiresAt,
      }).eq("id", store.id);
    }
    const token = decryptToken(encrypted);

    const locations = await listLocations(token);
    if (locations.length === 0) throw new Error("This Square account has no active locations");
    const tz = locations[0]?.timezone ?? store.timezone;
    const locationIds = locations.map((l) => l.id);

    const today = localDay(new Date().toISOString(), tz);
    const lastFullDay = addDays(today, -1);
    const windowDays = store.last_synced_at ? RESYNC_DAYS : FIRST_SYNC_DAYS;
    const windowStart = addDays(today, -windowDays);

    const products = catalogToProducts(await listCatalog(token));
    const ids = products.map((p) => p.squareItemId);

    // Pad the window by a day each side: the local-day bucketing below decides
    // exactly which day each order belongs to.
    const orders = await searchOrders(
      token, locationIds,
      new Date(Date.parse(windowStart + "T00:00:00Z") - 86_400_000).toISOString(),
      new Date(Date.parse(today + "T00:00:00Z") + 86_400_000).toISOString(),
    );
    const rollup = ordersToDaily(orders, tz);

    const stock = stockFor(products, ids.length ? await inventoryCounts(token, ids, locationIds) : []);
    const receivedSince = new Date(Date.now() - RECEIPT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const received = lastReceived(ids.length ? await stockReceipts(token, ids, receivedSince) : [], tz);

    // Returns are only exact once a full 90 days has been read.
    const returns90 = new Map<string, number>();
    for (const [id, q] of rollup.returns) returns90.set(id, Math.round(q));

    const now = new Date().toISOString();
    if (products.length) {
      const { error } = await db.from("products").upsert(
        products.map((p) => ({
          store_id: store.id,
          square_item_id: p.squareItemId,
          name: p.name,
          category: p.category,
          price_cents: p.priceCents,
          unit_cost_cents: p.unitCostCents,
          stock: stock.get(p.squareItemId) ?? null,
          last_received_at: received.get(p.squareItemId) ?? null,
          returns_90d: returns90.get(p.squareItemId) ?? 0,
          updated_at: now,
        })),
        { onConflict: "store_id,square_item_id" },
      );
      if (error) throw new Error(`Saving products failed: ${error.message}`);
    }

    // Replace the whole window, so edits and refunds can't leave stale rows.
    await db.from("product_daily").delete().eq("store_id", store.id).gte("day", windowStart);
    await db.from("store_daily").delete().eq("store_id", store.id).gte("day", windowStart);

    const productRows: Array<{ store_id: string; square_item_id: string; day: string; units_sold: number }> = [];
    for (const [itemId, byDay] of rollup.units) {
      for (const [day, units] of byDay) {
        if (day >= windowStart && day <= lastFullDay) {
          productRows.push({ store_id: store.id, square_item_id: itemId, day, units_sold: Math.round(units) });
        }
      }
    }
    for (let i = 0; i < productRows.length; i += 1000) {
      const { error } = await db.from("product_daily").insert(productRows.slice(i, i + 1000));
      if (error) throw new Error(`Saving daily sales failed: ${error.message}`);
    }

    const storeRows = [...rollup.orders.keys()]
      .filter((day) => day >= windowStart && day <= lastFullDay)
      .map((day) => ({
        store_id: store.id, day,
        order_count: rollup.orders.get(day) ?? 0,
        revenue_cents: rollup.revenue.get(day) ?? 0,
      }));
    for (let i = 0; i < storeRows.length; i += 1000) {
      const { error } = await db.from("store_daily").insert(storeRows.slice(i, i + 1000));
      if (error) throw new Error(`Saving daily totals failed: ${error.message}`);
    }

    await db.from("stores").update({
      last_synced_at: now, sync_error: null, timezone: tz, square_needs_reconnect: false,
    }).eq("id", store.id);

    return { products: products.length, orders: orders.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    await db.from("stores").update({
      sync_error: message.slice(0, 500),
      ...(err instanceof SquareError && err.needsReconnect ? { square_needs_reconnect: true } : {}),
    }).eq("id", store.id);
    throw err;
  }
}
