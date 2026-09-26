import { describe, expect, it } from "vitest";
import {
  computeStoreMetrics,
  daysToStockout,
  pctChange,
  orderRound,
  restockCycleDays,
  suggestedReorder,
  velocity,
  windows,
} from "@/lib/metrics";
import { DEFAULT_RULES, evaluate, listJoin } from "@/lib/rules";
import { renderTemplate } from "@/lib/briefing/templates";
import { assertOnlyKnownNumbers, shouldCombine } from "@/lib/briefing/narrate";
import { baseUrl, isSandbox, validateEnv } from "@/lib/env";
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
    expect(renderTemplate(sig!).headline).toBe("You'll run out of Candle in about 4 days.");
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

  it("never invents a number the rules engine didn't compute", () => {
    const m = computeStoreMetrics(
      snapshot(
        [product({ squareItemId: "a", name: "Candle", stock: 9, lastReceivedAt: "2026-09-01" })],
        [flat("a", 3)],
      ),
      30,
    );
    for (const s of evaluate(m)) {
      const item = renderTemplate(s);
      expect(item.generatedBy).toBe("template");
      expect(assertOnlyKnownNumbers(item.headline + " " + item.action, s.facts).ok).toBe(true);
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

describe("environment", () => {
  const good = {
    SQUARE_APPLICATION_ID: "sandbox-sq0idb-abc",
    SQUARE_APPLICATION_SECRET: "sq0csp-xyz",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    ANTHROPIC_API_KEY: "sk-ant-x",
    SQUARE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "abc123",
  } as unknown as NodeJS.ProcessEnv;

  it("passes a complete environment", () => {
    expect(validateEnv(good)).toEqual([]);
  });

  it("names every missing variable rather than failing on the first", () => {
    const problems = validateEnv({} as unknown as NodeJS.ProcessEnv);
    expect(problems.length).toBeGreaterThanOrEqual(8);
  });

  it("catches an encryption key that isn't 32 bytes", () => {
    const bad = { ...good, SQUARE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") };
    expect(validateEnv(bad).join(" ")).toMatch(/32 bytes/);
  });

  it("catches the anon key pasted in as the service-role key", () => {
    const bad = { ...good, SUPABASE_SERVICE_ROLE_KEY: good["NEXT_PUBLIC_SUPABASE_ANON_KEY"] };
    expect(validateEnv(bad).join(" ")).toMatch(/pasted the wrong one/);
  });

  it("catches a secret exposed to the browser", () => {
    const bad = { ...good, NEXT_PUBLIC_ANTHROPIC_API_KEY: "oops" };
    expect(validateEnv(bad).join(" ")).toMatch(/exposed to the browser/);
  });

  it("detects sandbox from the application id prefix", () => {
    expect(isSandbox("sandbox-sq0idb-abc")).toBe(true);
    expect(isSandbox("sq0idp-abc")).toBe(false);
  });

  it("derives the base url from Vercel, and prefers an explicit override", () => {
    expect(baseUrl({} as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
    expect(baseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "storecasted.vercel.app" } as unknown as NodeJS.ProcessEnv))
      .toBe("https://storecasted.vercel.app");
    expect(baseUrl({ APP_BASE_URL: "https://storecasted.com/" } as unknown as NodeJS.ProcessEnv))
      .toBe("https://storecasted.com");
  });
});

describe("listing item names", () => {
  it("reads naturally for plain names", () => {
    expect(listJoin(["Mugs", "Bowls", "Vases"])).toBe("Mugs, Bowls, and Vases".replace(", and", ", and"));
  });
  it("switches to semicolons when a name has its own comma", () => {
    expect(listJoin(["Stoneware mug, cream", "Speckled bowl", "Bud vase"]))
      .toBe("Stoneware mug, cream; Speckled bowl; and Bud vase");
  });
  it("handles one and two names", () => {
    expect(listJoin(["Candle"])).toBe("Candle");
    expect(listJoin(["Candle", "Soap"])).toBe("Candle and Soap");
  });
});

describe("suggested order quantities", () => {
  it("rounds to numbers a person would actually order", () => {
    expect(orderRound(7.2)).toBe(8);
    expect(orderRound(72.3)).toBe(75);
    expect(orderRound(121)).toBe(130);
    expect(orderRound(0)).toBe(0);
  });

  it("covers as long as the last restock lasted, plus a 15% buffer", () => {
    // 3/day, 12 on the shelf (4 days left), received 14 days ago -> 18-day cycle
    const m = computeStoreMetrics(
      snapshot(
        [product({ squareItemId: "a", name: "Candle", stock: 12, unitCostCents: 1400, lastReceivedAt: "2026-09-06" })],
        [flat("a", 3)],
      ),
      30,
    );
    const r = suggestedReorder(m.products[0]!)!;
    expect(r.basis).toBe("restock_cycle");
    expect(r.coverDays).toBe(18);
    expect(r.units).toBe(orderRound(3 * 18 * 1.15)); // 62.1 -> 65
    expect(r.units).toBe(65);
    expect(r.costCents).toBe(65 * 1400);
  });

  it("falls back to a month when there is no restock history", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "A", stock: 8 })], [flat("a", 2)]),
      30,
    );
    const r = suggestedReorder(m.products[0]!)!;
    expect(r.basis).toBe("default");
    expect(r.coverDays).toBe(30);
    expect(r.units).toBe(70); // 2 * 30 * 1.15 = 69 -> 70
  });

  it("sizes an out-of-stock item from how fast it sold before running out", () => {
    // sold 4/day, then nothing for the last 30 days because it was out
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "Mug", stock: 0 })], [stepped("a", 4, 0)]),
      30,
    );
    const r = suggestedReorder(m.products[0]!)!;
    expect(r.units).toBe(140); // 4 * 30 * 1.15 = 138 -> 140
  });

  it("never prices an order for an item with no unit cost", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "A", stock: 8, unitCostCents: null })], [flat("a", 2)]),
      30,
    );
    expect(suggestedReorder(m.products[0]!)!.costCents).toBeNull();
  });

  it("returns nothing for an item that isn't selling", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "A", stock: 8 })], [flat("a", 0)]),
      30,
    );
    expect(suggestedReorder(m.products[0]!)).toBeNull();
  });

  it("puts the quantity and cost in the red briefing sentence", () => {
    const m = computeStoreMetrics(
      snapshot(
        [product({ squareItemId: "a", name: "Candle", stock: 12, unitCostCents: 1400, lastReceivedAt: "2026-09-06" })],
        [flat("a", 3)],
      ),
      30,
    );
    const item = renderTemplate(evaluate(m).find((s) => s.kind === "stockout_imminent")!);
    expect(item.action).toMatch(/^Order 65 now to restock before you run out\./);
    expect(item.action).toContain("$910");
    expect(item.action).toContain("last restock lasted");
  });

  it("gives each out-of-stock item its own quantity", () => {
    const products = [
      product({ squareItemId: "a", name: "Mug, cream", stock: 0 }),
      product({ squareItemId: "b", name: "Bowl", stock: 0 }),
    ];
    const m = computeStoreMetrics(snapshot(products, [stepped("a", 4, 0), stepped("b", 2, 0)]), 30);
    const item = renderTemplate(evaluate(m).find((s) => s.kind === "out_of_stock")!);
    expect(item.headline).toBe("You're out of 2 items.");
    expect(item.action).toContain("Order Mug, cream (140) and Bowl (70) to get back in stock");
    expect(item.action).toContain("$840");
  });
});

describe("owner's wording for stock alerts", () => {
  it("names a single out-of-stock item and says how many to order", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "Skittles", stock: 0 })], [stepped("a", 4, 0)]),
      30,
    );
    const item = renderTemplate(evaluate(m).find((s) => s.kind === "out_of_stock")!);
    expect(item.headline).toBe("You're out of Skittles.");
    expect(item.action).toMatch(/^Order 140 to get back in stock\./);
    expect(item.action).toContain("4 a day it sold before running out");
  });
});

describe("items that don't track inventory", () => {
  it("never calls an untracked item out of stock", () => {
    const m = computeStoreMetrics(
      snapshot([product({ squareItemId: "a", name: "Gift wrap", stock: null })], [stepped("a", 4, 0)]),
      30,
    );
    expect(evaluate(m).map((s) => s.kind)).not.toContain("out_of_stock");
    expect(m.products[0]!.daysToStockout).toBeNull();
  });
});
