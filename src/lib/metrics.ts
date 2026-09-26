import type {
  Product,
  ProductMetrics,
  SalesSeries,
  StoreMetrics,
  StoreSnapshot,
} from "./types";

/**
 * Every number the product shows is produced here, by plain arithmetic.
 * Nothing in this file talks to a network, a database, or a model.
 *
 * Two invariants worth defending in review:
 *  1. A comparison window is always exactly as long as the window it compares
 *     against. Unequal windows produce flattering nonsense.
 *  2. Profit only ever counts items that have a real unit cost. An item with
 *     no cost is excluded from profit, never treated as zero-cost.
 */

export function sum(xs: readonly number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

/** Slice the last `days` entries, then the `days` before those. */
export function windows<T>(
  xs: readonly T[],
  days: number,
): { current: T[]; prior: T[] } {
  const end = xs.length;
  const current = xs.slice(Math.max(0, end - days), end);
  const priorStart = end - days * 2;
  const prior = priorStart >= 0 ? xs.slice(priorStart, end - days) : [];
  return { current, prior };
}

export function pctChange(now: number, before: number): number {
  if (before === 0) return 0;
  return ((now - before) / before) * 100;
}

/** Units per day across the window. Averaged, so a spike can't fake a trend. */
export function velocity(units: readonly number[]): number {
  if (units.length === 0) return 0;
  return sum(units) / units.length;
}

/**
 * How many days of stock are left at the current rate.
 * null when there is nothing on the shelf, or when the item isn't moving
 * at all — "infinite days" is not a useful thing to tell someone.
 */
export function daysToStockout(stock: number | null, velocityPerDay: number): number | null {
  if (stock === null || stock <= 0) return null;
  if (velocityPerDay <= 0) return null;
  return stock / velocityPerDay;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function computeProductMetrics(
  product: Product,
  series: SalesSeries | undefined,
  windowDays: number,
  asOf: string,
  returns: number,
): ProductMetrics {
  const units = series?.units ?? [];
  const { current, prior } = windows(units, windowDays);

  const v = velocity(current);
  const vPrior = velocity(prior);
  const unitsSold = sum(current);
  const revenueCents = unitsSold * product.priceCents;
  const revenuePriorCents = sum(prior) * product.priceCents;

  const profitCents =
    product.unitCostCents === null
      ? null
      : unitsSold * (product.priceCents - product.unitCostCents);

  return {
    squareItemId: product.squareItemId,
    name: product.name,
    category: product.category,
    stock: product.stock,
    velocity: v,
    velocityPrior: vPrior,
    daysToStockout: daysToStockout(product.stock, v),
    revenueCents,
    revenuePriorCents,
    profitCents,
    unitCostCents: product.unitCostCents,
    unitsSold,
    returns,
    lastReceivedAt: product.lastReceivedAt,
    daysSinceReceived: product.lastReceivedAt
      ? daysBetween(product.lastReceivedAt, asOf)
      : null,
  };
}

export function computeStoreMetrics(
  snapshot: StoreSnapshot,
  windowDays = 30,
): StoreMetrics {
  const seriesById = new Map(snapshot.series.map((s) => [s.squareItemId, s]));

  const products = snapshot.products.map((p) =>
    computeProductMetrics(
      p,
      seriesById.get(p.squareItemId),
      windowDays,
      snapshot.asOf,
      snapshot.returnsByItem[p.squareItemId] ?? 0,
    ),
  );

  const revenueCents = sum(products.map((p) => p.revenueCents));
  const revenuePriorCents = sum(products.map((p) => p.revenuePriorCents));

  // Profit, and the share of revenue it actually covers. If half the catalogue
  // has no unit cost, the owner needs to be told that before they trust it.
  const covered = products.filter((p) => p.profitCents !== null);
  const profitCents = sum(covered.map((p) => p.profitCents ?? 0));
  const coveredRevenue = sum(covered.map((p) => p.revenueCents));
  const profitCoverage = revenueCents === 0 ? 0 : coveredRevenue / revenueCents;

  const orders = windows(snapshot.ordersPerDay, windowDays);
  const orderCount = sum(orders.current);
  const orderCountPrior = sum(orders.prior);

  const unitsSold = sum(products.map((p) => p.unitsSold));
  const unitsSoldPrior = sum(
    snapshot.products.map((p) => {
      const s = seriesById.get(p.squareItemId);
      return sum(windows(s?.units ?? [], windowDays).prior);
    }),
  );

  return {
    asOf: snapshot.asOf,
    windowDays,
    revenueCents,
    revenuePriorCents,
    revenueChangePct: pctChange(revenueCents, revenuePriorCents),
    profitCents,
    profitCoverage,
    unitsSold,
    unitsSoldPrior,
    orderCount,
    orderCountPrior,
    averageOrderCents: orderCount === 0 ? 0 : Math.round(revenueCents / orderCount),
    products,
  };
}

/**
 * How long the last restock lasted, in days: the gap from the receipt date to
 * the projected stockout. This is the honest stand-in for supplier lead time,
 * which Square does not record anywhere.
 */
export function restockCycleDays(p: ProductMetrics): number | null {
  if (p.daysSinceReceived === null || p.daysToStockout === null) return null;
  return Math.round(p.daysSinceReceived + p.daysToStockout);
}

export const centsToUsd = (cents: number): string =>
  "$" + Math.round(cents / 100).toLocaleString("en-US");

export interface ReorderOptions {
  /** Used when we can't see a past restock cycle. */
  defaultCoverDays: number;
  minCoverDays: number;
  maxCoverDays: number;
  /** Extra on top, in case demand keeps picking up. 0.15 = 15%. */
  buffer: number;
}

export const DEFAULT_REORDER: ReorderOptions = {
  defaultCoverDays: 30,
  minCoverDays: 14,
  maxCoverDays: 60,
  buffer: 0.15,
};

export interface ReorderSuggestion {
  units: number;
  coverDays: number;
  /** Where coverDays came from, so the sentence can say so honestly. */
  basis: "restock_cycle" | "default";
  /** null when the item has no unit cost in Square. */
  costCents: number | null;
}

/** Round up to numbers a person would actually order: 7, 35, 120. */
export function orderRound(raw: number): number {
  if (raw <= 0) return 0;
  if (raw < 20) return Math.ceil(raw);
  if (raw < 100) return Math.ceil(raw / 5) * 5;
  return Math.ceil(raw / 10) * 10;
}

/**
 * How many to order. Square has no supplier lead times, so this uses the
 * store's own rhythm: enough to last as long as the last restock did, plus a
 * buffer. An item that is already out uses the rate it sold at BEFORE running
 * out — its current rate is zero for the wrong reason.
 *
 * Deliberately not "minus current stock": whatever is on the shelf will
 * usually be gone before a new order lands, so the order has to cover the
 * next cycle by itself.
 */
export function suggestedReorder(
  p: ProductMetrics,
  opts: ReorderOptions = DEFAULT_REORDER,
): ReorderSuggestion | null {
  const rate = p.stock === 0 ? p.velocityPrior : p.velocity;
  if (rate <= 0) return null;

  const cycle = restockCycleDays(p);
  const basis = cycle !== null ? "restock_cycle" : "default";
  const coverDays = Math.min(
    opts.maxCoverDays,
    Math.max(opts.minCoverDays, cycle ?? opts.defaultCoverDays),
  );
  const units = orderRound(rate * coverDays * (1 + opts.buffer));
  return {
    units,
    coverDays,
    basis,
    costCents: p.unitCostCents === null ? null : units * p.unitCostCents,
  };
}
