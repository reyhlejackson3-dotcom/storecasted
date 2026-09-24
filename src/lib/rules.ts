import { centsToUsd, restockCycleDays } from "./metrics";
import type { ProductMetrics, Signal, StoreMetrics } from "./types";

/**
 * Decides what is worth telling the owner. Deterministic, no AI.
 *
 * Deliberately returns 0..N signals. A quiet Tuesday at a healthy shop should
 * produce nothing, and the briefing should say so rather than padding to three.
 * Filler is what teaches people to stop opening the app.
 */

export interface RuleConfig {
  /** Flag an item once it's this close to running out. */
  stockoutWarningDays: number;
  /** Ignore revenue moves smaller than this, in percent. */
  revenueSwingPct: number;
  /** An item is "accelerating" at this multiple of its prior rate. */
  accelerationMultiple: number;
  /** Return rate that stops being noise, 0..1. */
  returnRateThreshold: number;
  /** Units sold in the window at or below this counts as dead stock. */
  deadStockMaxUnits: number;
  /** Dead stock must also have sat unsold at least this long. */
  deadStockMinDays: number;
  /** Most items to show. */
  maxItems: number;
}

export const DEFAULT_RULES: RuleConfig = {
  stockoutWarningDays: 7,
  revenueSwingPct: 8,
  accelerationMultiple: 1.75,
  returnRateThreshold: 0.05,
  deadStockMaxUnits: 1,
  deadStockMinDays: 90,
  maxItems: 3,
};

/**
 * "A, B and C" — or "A; B; and C" when any name has its own comma in it,
 * which real Square item names often do ("Stoneware mug, cream").
 */
export function listJoin(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  const sep = names.some((n) => n.includes(",")) ? "; " : ", ";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(sep) + `${sep.trim()} and ` + names[names.length - 1];
}

function outOfStockSignals(m: StoreMetrics): Signal[] {
  const out = m.products.filter((p) => p.stock === 0 && p.revenuePriorCents > 0);
  if (out.length === 0) return [];

  const lostCents = out.reduce(
    (t, p) => t + Math.max(0, p.revenuePriorCents - p.revenueCents),
    0,
  );
  // Sort so the facts name the biggest offenders first.
  const worst = [...out].sort(
    (a, b) => b.revenuePriorCents - a.revenuePriorCents,
  );

  return [
    {
      kind: "out_of_stock",
      severity: "attention",
      score: 90 + Math.min(9, lostCents / 100_000),
      facts: {
        item_count: out.length,
        item_names: listJoin(worst.map((p) => p.name)),
        lost_revenue: centsToUsd(lostCents),
        lost_revenue_cents: lostCents,
        last_received: worst[0]?.lastReceivedAt ?? "unknown",
      },
    },
  ];
}

function stockoutSignals(m: StoreMetrics, cfg: RuleConfig): Signal[] {
  return m.products
    .filter(
      (p) =>
        p.daysToStockout !== null &&
        p.daysToStockout <= cfg.stockoutWarningDays,
    )
    .map((p): Signal => {
      const days = Math.round(p.daysToStockout as number);
      const cycle = restockCycleDays(p);
      return {
        kind: "stockout_imminent",
        severity: "attention",
        // Faster sellers matter more — losing 4/day hurts more than losing 0.4.
        score: 80 + Math.min(15, p.velocity * 2) - days,
        squareItemId: p.squareItemId,
        facts: {
          item: p.name,
          stock: p.stock,
          velocity_per_day: Number(p.velocity.toFixed(1)),
          days_to_stockout: days,
          ...(p.lastReceivedAt ? { last_received: p.lastReceivedAt } : {}),
          ...(cycle !== null ? { typical_restock_lasts_days: cycle } : {}),
        },
      };
    });
}

function revenueSignals(m: StoreMetrics, cfg: RuleConfig): Signal[] {
  if (Math.abs(m.revenueChangePct) < cfg.revenueSwingPct) return [];
  const up = m.revenueChangePct > 0;
  return [
    {
      kind: "revenue_swing",
      severity: up ? "opportunity" : "attention",
      score: 70 + Math.min(20, Math.abs(m.revenueChangePct)),
      facts: {
        direction: up ? "up" : "down",
        change_pct: Number(m.revenueChangePct.toFixed(1)),
        revenue: centsToUsd(m.revenueCents),
        revenue_prior: centsToUsd(m.revenuePriorCents),
        window_days: m.windowDays,
      },
    },
  ];
}

/**
 * Revenue and transaction count moving in opposite directions. Fewer people
 * spending more, or more people spending less — a completely different story
 * from "sales are up", and invisible on a revenue chart alone.
 */
function divergenceSignals(m: StoreMetrics): Signal[] {
  if (m.revenuePriorCents === 0 || m.orderCountPrior === 0) return [];
  const rev = ((m.revenueCents - m.revenuePriorCents) / m.revenuePriorCents) * 100;
  const ord = ((m.orderCount - m.orderCountPrior) / m.orderCountPrior) * 100;
  if (Math.sign(rev) === Math.sign(ord)) return [];
  if (Math.abs(rev) < 4 && Math.abs(ord) < 4) return [];

  const priorAvg = Math.round(m.revenuePriorCents / m.orderCountPrior);
  return [
    {
      kind: "revenue_traffic_divergence",
      severity: "watch",
      score: 68 + Math.min(12, Math.abs(rev - ord) / 2),
      facts: {
        revenue_change_pct: Number(rev.toFixed(1)),
        order_change_pct: Number(ord.toFixed(1)),
        average_order: centsToUsd(m.averageOrderCents),
        average_order_prior: centsToUsd(priorAvg),
      },
    },
  ];
}

function accelerationSignals(m: StoreMetrics, cfg: RuleConfig): Signal[] {
  return m.products
    .filter(
      (p) =>
        p.velocityPrior > 0 &&
        p.velocity / p.velocityPrior >= cfg.accelerationMultiple &&
        p.unitsSold >= 5 &&
        p.stock > 0,
    )
    .map((p): Signal => ({
      kind: "accelerating_item",
      severity: "opportunity",
      score: 60 + Math.min(15, (p.velocity / p.velocityPrior) * 3),
      squareItemId: p.squareItemId,
      facts: {
        item: p.name,
        velocity_per_day: Number(p.velocity.toFixed(1)),
        velocity_prior_per_day: Number(p.velocityPrior.toFixed(1)),
        multiple: Number((p.velocity / p.velocityPrior).toFixed(1)),
        stock: p.stock,
        days_to_stockout:
          p.daysToStockout === null ? "n/a" : Math.round(p.daysToStockout),
      },
    }));
}

function returnSignals(m: StoreMetrics, cfg: RuleConfig): Signal[] {
  return m.products
    .filter((p) => p.unitsSold >= 10 && p.returns / p.unitsSold >= cfg.returnRateThreshold)
    .map((p): Signal => ({
      kind: "high_return_rate",
      severity: "watch",
      score: 55 + (p.returns / p.unitsSold) * 100,
      squareItemId: p.squareItemId,
      facts: {
        item: p.name,
        returns: p.returns,
        units_sold: p.unitsSold,
        return_rate_pct: Number(((p.returns / p.unitsSold) * 100).toFixed(1)),
      },
    }));
}

function deadStockSignals(m: StoreMetrics, cfg: RuleConfig): Signal[] {
  return m.products
    .filter(
      (p) =>
        p.stock > 0 &&
        p.unitsSold <= cfg.deadStockMaxUnits &&
        p.daysSinceReceived !== null &&
        p.daysSinceReceived >= cfg.deadStockMinDays,
    )
    .map((p): Signal => ({
      kind: "dead_stock",
      severity: "watch",
      score: 50 + Math.min(10, (p.daysSinceReceived ?? 0) / 30),
      squareItemId: p.squareItemId,
      facts: {
        item: p.name,
        stock: p.stock,
        units_sold: p.unitsSold,
        days_since_received: p.daysSinceReceived ?? 0,
        window_days: m.windowDays,
      },
    }));
}

/**
 * Run every rule, then take the highest-scoring few — at most one per item, so
 * a single runaway product can't fill the whole briefing.
 */
export function evaluate(
  m: StoreMetrics,
  cfg: RuleConfig = DEFAULT_RULES,
): Signal[] {
  const all = [
    ...outOfStockSignals(m),
    ...stockoutSignals(m, cfg),
    ...revenueSignals(m, cfg),
    ...divergenceSignals(m),
    ...accelerationSignals(m, cfg),
    ...returnSignals(m, cfg),
    ...deadStockSignals(m, cfg),
  ].sort((a, b) => b.score - a.score);

  const seenItems = new Set<string>();
  const seenKinds = new Set<string>();
  const chosen: Signal[] = [];

  for (const s of all) {
    if (chosen.length >= cfg.maxItems) break;
    if (s.squareItemId && seenItems.has(s.squareItemId)) continue;
    if (seenKinds.has(s.kind)) continue;
    chosen.push(s);
    seenKinds.add(s.kind);
    if (s.squareItemId) seenItems.add(s.squareItemId);
  }
  return chosen;
}
