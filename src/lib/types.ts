/**
 * The whole product hangs off these types.
 *
 * The one rule that matters: a Fact is always a number this codebase computed.
 * The language layer may read Facts. It may never produce one.
 */

/** A single item as Square knows it. */
export interface Product {
  squareItemId: string;
  name: string;
  category: string | null;
  /** Sell price in cents. */
  priceCents: number;
  /**
   * Unit cost in cents, from the variation's vendor_information.
   * null means the seller never entered one — profit is then unknowable
   * for this item and must be excluded, never estimated.
   */
  unitCostCents: number | null;
  /** Current on-hand count. */
  stock: number;
  /** ISO date of the most recent stock-increasing inventory adjustment. */
  lastReceivedAt: string | null;
}

/** Units sold per day, oldest first, one entry per calendar day. */
export interface SalesSeries {
  squareItemId: string;
  /** ISO date of index 0. */
  startDate: string;
  units: number[];
}

/** Everything the daily job pulled, before any interpretation. */
export interface StoreSnapshot {
  storeId: string;
  /** ISO date of the last complete day of data. */
  asOf: string;
  products: Product[];
  series: SalesSeries[];
  /** Completed orders per day, aligned to the same start date as series. */
  ordersPerDay: number[];
  /** Units refunded per item over the trailing 90 days. */
  returnsByItem: Record<string, number>;
}

export interface ProductMetrics {
  squareItemId: string;
  name: string;
  category: string | null;
  stock: number;
  /** Units per day over the trailing window. */
  velocity: number;
  /** Velocity over the window before that, for comparison. */
  velocityPrior: number;
  /** stock / velocity. null when out of stock or not selling at all. */
  daysToStockout: number | null;
  revenueCents: number;
  revenuePriorCents: number;
  /** null when the item has no unit cost in Square. */
  profitCents: number | null;
  unitsSold: number;
  returns: number;
  lastReceivedAt: string | null;
  daysSinceReceived: number | null;
}

export interface StoreMetrics {
  asOf: string;
  windowDays: number;
  revenueCents: number;
  revenuePriorCents: number;
  revenueChangePct: number;
  /** Profit across items that have a unit cost. */
  profitCents: number;
  /** Share of revenue the profit figure actually covers, 0..1. */
  profitCoverage: number;
  unitsSold: number;
  unitsSoldPrior: number;
  orderCount: number;
  orderCountPrior: number;
  averageOrderCents: number;
  products: ProductMetrics[];
}

export type Severity = "attention" | "watch" | "opportunity";

export type SignalKind =
  | "stockout_imminent"
  | "out_of_stock"
  | "revenue_swing"
  | "accelerating_item"
  | "revenue_traffic_divergence"
  | "high_return_rate"
  | "dead_stock";

/**
 * A candidate for the briefing, produced by deterministic rules.
 * `facts` is the ONLY numeric material any downstream writer may use.
 */
export interface Signal {
  kind: SignalKind;
  severity: Severity;
  /** Higher wins when trimming to the day's shortlist. */
  score: number;
  squareItemId?: string;
  facts: Record<string, string | number>;
}

export interface BriefingItem {
  kind: SignalKind;
  severity: Severity;
  headline: string;
  action: string;
  facts: Record<string, string | number>;
  generatedBy: "template" | "llm";
}
