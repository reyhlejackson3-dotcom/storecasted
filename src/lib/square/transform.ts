/**
 * Square's API shapes in, the engine's shapes out. No network, no database —
 * so every rule about how we read a store's data is unit-tested here.
 *
 * Field names follow Square's REST docs. Anything marked VERIFY is a field
 * worth confirming against a real sandbox response the first time through.
 */

interface Money { amount?: number | null; currency?: string }

export interface SqCatalogObject {
  type: string;
  id: string;
  is_deleted?: boolean;
  category_data?: { name?: string };
  item_data?: {
    name?: string;
    category_id?: string;                 // older catalogs
    categories?: Array<{ id: string }>;   // newer catalogs
    variations?: SqCatalogObject[];
  };
  item_variation_data?: {
    item_id?: string;
    name?: string;
    price_money?: Money | null;
    track_inventory?: boolean;
    default_unit_cost?: Money | null;     // VERIFY: unit cost, where the seller entered one
    item_variation_vendor_infos?: Array<{
      item_variation_vendor_info_data?: { price_money?: Money | null };
    }>;
  };
}

export interface SqOrder {
  id: string;
  state?: string;
  closed_at?: string;
  total_money?: Money;
  line_items?: Array<{ catalog_object_id?: string; quantity?: string }>;
  returns?: Array<{ return_line_items?: Array<{ catalog_object_id?: string; quantity?: string }> }>;
}

export interface SqCount { catalog_object_id: string; state?: string; quantity?: string }

export interface SqChange {
  type?: string;
  adjustment?: {
    catalog_object_id?: string;
    from_state?: string;
    to_state?: string;
    occurred_at?: string;
  };
}

export interface CatalogProduct {
  squareItemId: string;          // the VARIATION id — what orders and inventory point at
  name: string;
  category: string | null;
  priceCents: number;
  unitCostCents: number | null;
  tracksInventory: boolean;
}

/**
 * One product per variation, because that's the level orders and inventory
 * are recorded at. A single-variation item keeps its plain name; a multi-
 * variation item gets "Candle — Large".
 *
 * Variations with no fixed price (priced at the till) are skipped: without a
 * price there's no way to turn units into revenue honestly.
 */
export function catalogToProducts(objects: SqCatalogObject[]): CatalogProduct[] {
  const categories = new Map<string, string>();
  for (const o of objects) {
    if (o.type === "CATEGORY" && !o.is_deleted && o.category_data?.name) {
      categories.set(o.id, o.category_data.name);
    }
  }

  const out: CatalogProduct[] = [];
  for (const o of objects) {
    if (o.type !== "ITEM" || o.is_deleted || !o.item_data) continue;
    const item = o.item_data;
    const catId = item.categories?.[0]?.id ?? item.category_id;
    const category = catId ? categories.get(catId) ?? null : null;
    const variations = (item.variations ?? []).filter((v) => !v.is_deleted && v.item_variation_data);
    const many = variations.length > 1;

    for (const v of variations) {
      const vd = v.item_variation_data!;
      const price = vd.price_money?.amount;
      if (price == null || price <= 0) continue;

      const cost =
        vd.default_unit_cost?.amount ??
        vd.item_variation_vendor_infos?.[0]?.item_variation_vendor_info_data?.price_money?.amount ??
        null;

      const varName = vd.name?.trim();
      const name =
        many && varName && varName.toLowerCase() !== "regular"
          ? `${item.name ?? "Item"} — ${varName}`
          : item.name ?? varName ?? "Item";

      out.push({
        squareItemId: v.id,
        name,
        category,
        priceCents: price,
        unitCostCents: cost != null && cost > 0 ? cost : null,
        tracksInventory: vd.track_inventory === true,
      });
    }
  }
  return out;
}

/** The calendar date an instant falls on, in the shop's own timezone. */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export interface DailyRollup {
  /** item id → day → units */
  units: Map<string, Map<string, number>>;
  /** day → completed sales */
  orders: Map<string, number>;
  /** day → money actually taken, in cents */
  revenue: Map<string, number>;
  /** item id → units refunded */
  returns: Map<string, number>;
}

/**
 * Buckets completed orders into the shop's local days. A refund-only order is
 * counted as a return, never as a sale — otherwise every refund would inflate
 * the transaction count.
 */
export function ordersToDaily(orders: SqOrder[], timeZone: string): DailyRollup {
  const r: DailyRollup = { units: new Map(), orders: new Map(), revenue: new Map(), returns: new Map() };
  const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const o of orders) {
    if (o.state && o.state !== "COMPLETED") continue;
    if (!o.closed_at) continue;
    const day = localDay(o.closed_at, timeZone);

    for (const ret of o.returns ?? []) {
      for (const li of ret.return_line_items ?? []) {
        const q = Number.parseFloat(li.quantity ?? "0");
        if (li.catalog_object_id && q > 0) add(r.returns, li.catalog_object_id, q);
      }
    }

    const lines = o.line_items ?? [];
    if (lines.length === 0) continue;
    add(r.orders, day, 1);
    add(r.revenue, day, o.total_money?.amount ?? 0);
    for (const li of lines) {
      const q = Number.parseFloat(li.quantity ?? "0");
      if (!li.catalog_object_id || !(q > 0)) continue;
      let byDay = r.units.get(li.catalog_object_id);
      if (!byDay) r.units.set(li.catalog_object_id, (byDay = new Map()));
      add(byDay, day, q);
    }
  }
  return r;
}

/**
 * On-hand stock per variation, summed across locations. An item that doesn't
 * track inventory gets null — "unknown", never zero, so it can't set off a
 * false out-of-stock alarm.
 */
export function stockFor(
  products: CatalogProduct[],
  counts: SqCount[],
): Map<string, number | null> {
  const summed = new Map<string, number>();
  for (const c of counts) {
    if (c.state && c.state !== "IN_STOCK") continue;
    const q = Number.parseFloat(c.quantity ?? "0");
    summed.set(c.catalog_object_id, (summed.get(c.catalog_object_id) ?? 0) + (Number.isFinite(q) ? q : 0));
  }
  const out = new Map<string, number | null>();
  for (const p of products) {
    if (!p.tracksInventory) { out.set(p.squareItemId, null); continue; }
    const q = summed.get(p.squareItemId);
    out.set(p.squareItemId, q === undefined ? null : Math.max(0, Math.round(q)));
  }
  return out;
}

/**
 * When stock last arrived, per variation: the most recent adjustment that
 * moved units from nowhere onto the shelf (NONE → IN_STOCK), which is what
 * Square records when a seller receives stock.
 */
export function lastReceived(changes: SqChange[], timeZone: string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const c of changes) {
    const a = c.adjustment;
    if (!a?.catalog_object_id || !a.occurred_at) continue;
    if (a.from_state !== "NONE" || a.to_state !== "IN_STOCK") continue;
    const prev = latest.get(a.catalog_object_id);
    if (!prev || a.occurred_at > prev) latest.set(a.catalog_object_id, a.occurred_at);
  }
  const out = new Map<string, string>();
  for (const [id, at] of latest) out.set(id, localDay(at, timeZone));
  return out;
}
