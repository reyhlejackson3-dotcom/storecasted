import { describe, expect, it } from "vitest";
import {
  computeStoreMetrics,
  daysToStockout,
  pctChange,
  restockCycleDays,
  velocity,
  windows,
} from "@/lib/metrics";
import { DEFAULT_RULES, evaluate } from "@/lib/rules";
import { renderTemplate } from "@/lib/briefing/templates";
import { assertOnlyKnownNumbers, shouldCombine } from "@/lib/briefing/narrate";
import type { Product, SalesSeries, StoreSnapshot } from "@/lib/types";

const DAYS = 90;
const AS_OF = "2026-09-20";
const START = "2026-06-23";

function product(over: Partial<Product> & { squareItemId: string; name: string }): Product {
  return {
    category: "Test",
    priceCents: 1000,
    unitCostCents: 400,
    stock: 50,
    lastReceivedAt: null,
    ...over,
  };
}
function flat(id: string, perDay: number): SalesSeries {
  return { squareItemId: id, startDate: START, units: Array(DAYS).fill(perDay) };
}
/** Last 30 days at `now`, the 30 before at `before`. */
function stepped(id: string, before: number, now: number): SalesSeries {
  const u = Array(DAYS).fill(0);
  for (let i = 0; i < DAYS; i++) u[i] = i >= DAYS - 30 ? now : before;
  return { squareItemId: id, startDate: START, units: u };
}
function snapshot(products: Product[], series: SalesSeries[], orders = 40): StoreSnapshot {
  return {
    storeId: "s1",
    asOf: AS_OF,
    products,
    series,
    ordersPerDay: Array(DAYS).fill(orders),
    returnsByItem: {},
  };
}

describe("windows", () => {
  it("returns a prior window exactly as long as the current one", () => {
    const { current, prior } = windows([...Array(100).keys()], 30);
    expect(current).toHaveLength(30);
    expect(prior).toHaveLength(30);
    expect(current[0]).toBe(70);
    expect(prior[0]).toBe(40);
  });

  it("returns an empty prior rather than a short one when history is thin", () => {
    const { current, prior } = windows([...Array(45).keys()], 30);
    expect(current).toHaveLength(30);
    // 45 days cannot supply a full 30-day comparison. A 15-day prior would
    // make every store look like it doubled overnight.
    expect(prior).toHaveLength(0);
  });
});

describe("basic maths", () => {
  it("averages velocity across the window, so one spike can't fake a trend", () => {
    expect(velocity([10, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1);
  });
  it("returns null days-to-stockout when out of stock or not moving", () => {
    expect(daysToStockout(0, 5)).toBeNull();
    expect(daysToStockout(20, 0)).toBeNull();
    expect(daysToStockout(20, 4)).toBe(5);
  });
  it("treats a zero baseline as no change rather than infinity", () => {
    expect(pctChange(100, 0)).toBe(0);
    expect(pctChange(110, 100)).toBeCloseTo(10);
  });
});

describe("profit coverage", () => {
  it("excludes items with no unit cost instead of treating them as free", () => {
    const m = computeStoreMetrics(
      snapshot(
        [
          product({ squareItemId: "a", name: "Has cost", priceCents: 1000, unitCostCents: 400 }),
          product({ squareItemId: "b", name: "No cost", priceCents: 1000, unitCostCents: null }),
        ],
        [flat("a", 1), flat("b", 1)],
      ),
      30,
    );
    // Both sold 30 units at $10 → $600 revenue. Only "a" has a cost.
    expect(m.revenueCents).toBe(60_000);
    expect(m.profitCents).toBe(30 * 600); // a only
    expect(m.profitCoverage).toBeCloseTo(0.5);
    expect(m.products.find((p) => p.squareItemId === "b")?.profitCents).toBeNull();
  });

  it("reports zero coverage rather than a fake profit when no costs exist", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "A", unitCostCents: null })], [flat("a", 2)]),
      30,
    );
    expect(m.profitCents).toBe(0);
    expect(m.profitCoverage).toBe(0);
  });
});

describe("rules engine", () => {
  it("says nothing on a quiet day at a healthy shop", () => {
    const m = computeStoreMetrics(
      snapshot(
        [product({ squareItemId: "a", name: "Steady", stock: 500 })],
        [flat("a", 2)],
      ),
      30,
    );
    expect(evaluate(m)).toHaveLength(0);
  });

  it("flags an imminent stockout and carries the restock cycle", () => {
    const m = computeStoreMetrics(
      snapshot(
        [
          product({
            squareItemId: "a",
            name: "Candle",
            stock: 12,
            lastReceivedAt: "2026-09-06",
          }),
        ],
        [flat("a", 3)],
      ),
      30,
    );
    const [sig] = evaluate(m);
    expect(sig?.kind).toBe("stockout_imminent");
    expect(sig?.facts["days_to_stockout"]).toBe(4);
    // received 14 days ago + 4 days left = a ~18 day restock cycle
    expect(sig?.facts["typical_restock_lasts_days"]).toBe(18);
    expect(renderTemplate(sig!).headline).toBe("Candle runs out in about 4 days.");
  });

  it("catches revenue and footfall moving opposite ways", () => {
    const snap = snapshot(
      [product({ squareItemId: "a", name: "A", stock: 900 })],
      [stepped("a", 10, 12)],
    );
    // transactions fall while revenue rises
    for (let i = 0; i < DAYS; i++) snap.ordersPerDay[i] = i >= DAYS - 30 ? 30 : 40;

    const m = computeStoreMetrics(snap, 30);
    const kinds = evaluate(m).map((s) => s.kind);
    expect(kinds).toContain("revenue_traffic_divergence");

    const sig = evaluate(m).find((s) => s.kind === "revenue_traffic_divergence")!;
    expect(renderTemplate(sig).headline).toBe(
      "Fewer people are coming in, but they're spending more each.",
    );
  });

  it("never fills the briefing with one runaway product", () => {
    const products = [
      product({ squareItemId: "a", name: "A", stock: 3 }),
      product({ squareItemId: "b", name: "B", stock: 3 }),
      product({ squareItemId: "c", name: "C", stock: 3 }),
    ];
    const m = computeStoreMetrics(
      snapshot(products, products.map((p) => flat(p.squareItemId, 3))),
      30,
    );
    const signals = evaluate(m);
    expect(signals.length).toBeLessThanOrEqual(DEFAULT_RULES.maxItems);
    // one signal per item, and one per kind
    expect(new Set(signals.map((s) => s.kind)).size).toBe(signals.length);
  });

  it("spots dead stock that arrived long ago and never moved", () => {
    const m = computeStoreMetrics(
      snapshot(
        [
          product({
            squareItemId: "a",
            name: "Trivet",
            stock: 60,
            lastReceivedAt: "2026-04-01",
          }),
        ],
        [flat("a", 0)],
      ),
      30,
    );
    expect(evaluate(m).map((s) => s.kind)).toContain("dead_stock");
  });

  it("phrases every action as a suggestion, never a command", () => {
    const m = computeStoreMetrics(
      snapshot(
        [product({ squareItemId: "a", name: "Candle", stock: 9, lastReceivedAt: "2026-09-01" })],
        [flat("a", 3)],
      ),
      30,
    );
    for (const s of evaluate(m)) {
      const item = renderTemplate(s);
      expect(item.action).not.toMatch(/^(Reorder|Restock|Move|Discount)\b/);
      expect(item.generatedBy).toBe("template");
    }
  });
});

describe("restock cycle", () => {
  it("is null when we don't know when stock arrived", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "A", stock: 10 })], [flat("a", 2)]),
      30,
    );
    expect(restockCycleDays(m.products[0]!)).toBeNull();
  });
});

describe("hallucinated-number guard", () => {
  const facts = { revenue: "$11,838", days_to_stockout: 6, item: "Cedar & Smoke candle" };

  it("accepts a sentence built only from the given facts", () => {
    const r = assertOnlyKnownNumbers(
      "Cedar & Smoke candle runs out in 6 days and you've made $11,838.",
      facts,
    );
    expect(r.ok).toBe(true);
  });

  it("ignores comma formatting differences", () => {
    expect(assertOnlyKnownNumbers("You made $11838.", facts).ok).toBe(true);
  });

  it("rejects a number that was never computed", () => {
    const r = assertOnlyKnownNumbers("Sales are up 14% to $11,838.", facts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unknown).toContain("14");
  });

  it("rejects arithmetic the model did itself", () => {
    // 6 days at 4.2/day is 25 units — true, but not ours to state.
    const r = assertOnlyKnownNumbers("That's 25 units before you're empty.", facts);
    expect(r.ok).toBe(false);
  });
});

describe("when to involve the model at all", () => {
  const sig = (kind: string) => ({ kind, severity: "watch", score: 1, facts: {} }) as never;

  it("stays on templates for a single signal", () => {
    expect(shouldCombine([sig("stockout_imminent")])).toBe(false);
  });
  it("stays on templates for unrelated signals", () => {
    expect(shouldCombine([sig("dead_stock"), sig("high_return_rate")])).toBe(false);
  });
  it("combines a revenue swing with a stockout, which is one story", () => {
    expect(shouldCombine([sig("revenue_swing"), sig("out_of_stock")])).toBe(true);
  });
});
