import type { Product, SalesSeries, StoreSnapshot } from "./types";

/**
 * A made-up shop that satisfies the same StoreSnapshot contract the Square
 * sync will. The whole engine runs on it unchanged — metrics, rules,
 * templates — so what the demo says is genuinely what the engine decided.
 *
 * When Square is connected, loadSnapshot() returns a real store instead and
 * nothing downstream changes.
 *
 * Deterministic: the same seed always produces the same shop, so the page
 * doesn't reshuffle on every visit.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// name, category, price $, unit cost $ (null = never entered in Square),
// base units/day, seasonal swing, peak day-of-year, return rate
type Row = [string, string, number, number | null, number, number, number, number];
const CATALOG: Row[] = [
  ["Cedar & Smoke candle",   "Candles",  32, 14,   3.2, 0.45, 340, 0.005],
  ["Fig & Cedar candle",     "Candles",  32, 14,   2.1, 0.40, 340, 0.005],
  ["Beeswax taper, pair",    "Candles",  14, 5.5,  2.3, 0.35, 350, 0.004],
  ["Stoneware mug, cream",   "Ceramics", 24, 10,   3.0, 0.25, 350, 0.012],
  ["Speckled cereal bowl",   "Ceramics", 28, 12,   1.7, 0.20, 350, 0.014],
  ["Small bud vase",         "Ceramics", 22, null, 1.2, 0.30, 140, 0.010],
  ["Serving platter, ash",   "Ceramics", 54, 24,   0.6, 0.55, 330, 0.020],
  ["Wool throw, oatmeal",    "Textiles", 68, 31,   0.7, 0.95, 350, 0.045],
  ["Linen tea towel",        "Textiles", 16, 6.5,  3.8, 0.20, 330, 0.006],
  ["Cotton apron, natural",  "Textiles", 38, null, 0.9, 0.35, 340, 0.090],
  ["Olive oil soap, bar",    "Bath",      9, 3.5,  4.1, 0.15, 350, 0.002],
  ["Bath salts, eucalyptus", "Bath",     18, 7,    1.6, 0.40, 355, 0.004],
  ["Hand cream, unscented",  "Bath",     22, null, 1.3, 0.45, 355, 0.006],
  ["Cast iron trivet",       "Kitchen",  34, null, 0.02, 0.30, 340, 0.0],
  ["Brass bottle opener",    "Kitchen",  18, 7,    0.9, 0.35, 345, 0.006],
  ["Walnut cutting board",   "Kitchen",  78, null, 0.5, 0.60, 345, 0.030],
  ["Letterpress card set",   "Paper",    24, null, 1.5, 0.70, 345, 0.004],
  ["Pocket notebook",        "Paper",    12, 4.5,  2.4, 0.30, 240, 0.003],
];

// days of stock left, and days since last received
const STOCK: Record<string, [number, number]> = {
  "Cedar & Smoke candle": [6, 10],
  "Fig & Cedar candle": [19, 12],
  "Beeswax taper, pair": [41, 25],
  "Serving platter, ash": [26, 30],
  "Wool throw, oatmeal": [34, 20],
  "Linen tea towel": [13, 14],
  "Cotton apron, natural": [52, 40],
  "Olive oil soap, bar": [11, 9],
  "Bath salts, eucalyptus": [29, 22],
  "Hand cream, unscented": [64, 35],
  "Brass bottle opener": [120, 60],
  "Walnut cutting board": [48, 33],
  "Letterpress card set": [22, 18],
  "Pocket notebook": [95, 45],
};
const OUT_OF_STOCK: Record<string, [number, number]> = {
  // days since it hit zero, days since last received
  "Stoneware mug, cream": [19, 70],
  "Speckled cereal bowl": [19, 70],
  "Small bud vase": [17, 84],
};
const DEAD_STOCK: Record<string, [number, number]> = {
  "Cast iron trivet": [63, 212],
};

const WEEKDAY = [1.01, 0.78, 0.74, 0.85, 0.94, 1.2, 1.48]; // Sun..Sat
export const DEMO_DAYS = 1100;
export const DEMO_STORE_NAME = "Ridgeline Mercantile";
export const DEMO_TIMEZONE = "America/Denver";

/** Today's calendar date in the store's own timezone, not the server's. */
function storeToday(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // YYYY-MM-DD
  return new Date(parts + "T00:00:00Z");
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function demoSnapshot(today: Date = new Date()): StoreSnapshot {
  const rand = mulberry32(20260921);
  const gauss = () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  // data runs through yesterday in the store's timezone, like the real 5am job
  const local = storeToday(today, DEMO_TIMEZONE);
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (DEMO_DAYS - 1));
  const dayAt = (i: number) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  };

  const products: Product[] = [];
  const series: SalesSeries[] = [];
  const returnsByItem: Record<string, number> = {};
  const unitsByDay = new Array<number>(DEMO_DAYS).fill(0);

  CATALOG.forEach(([name, cat, price, cost, base, amp, peak, rr], idx) => {
    const id = `demo-${idx + 1}`;
    const outFor = OUT_OF_STOCK[name]?.[0];
    const units: number[] = [];
    for (let i = 0; i < DEMO_DAYS; i++) {
      const daysAgo = DEMO_DAYS - 1 - i;
      if (outFor !== undefined && daysAgo < outFor) {
        units.push(0);
        continue;
      }
      const d = dayAt(i);
      const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
      const season = 1 + amp * Math.cos((2 * Math.PI * (doy - peak)) / 365);
      const rate = base * season * (1 + 0.06 * (i / DEMO_DAYS)) * WEEKDAY[d.getUTCDay()]!;
      const u = Math.max(0, Math.round(rate + gauss() * rate * 0.45));
      units.push(u);
      unitsByDay[i]! += u;
    }

    const last30 = units.slice(-30).reduce((a, b) => a + b, 0);
    const vel = last30 / 30;

    let stock = 0;
    let receivedAgo = 30;
    if (OUT_OF_STOCK[name]) {
      receivedAgo = OUT_OF_STOCK[name]![1];
    } else if (DEAD_STOCK[name]) {
      [stock, receivedAgo] = DEAD_STOCK[name]!;
    } else {
      const [daysLeft, recv] = STOCK[name]!;
      stock = Math.max(1, Math.round(vel * daysLeft));
      receivedAgo = recv;
    }
    const received = new Date(end);
    received.setUTCDate(received.getUTCDate() - receivedAgo);

    products.push({
      squareItemId: id,
      name,
      category: cat,
      priceCents: Math.round(price * 100),
      unitCostCents: cost === null ? null : Math.round(cost * 100),
      stock,
      lastReceivedAt: iso(received),
    });
    series.push({ squareItemId: id, startDate: iso(start), units });
    returnsByItem[id] = Math.round(last30 * rr);
  });

  // Baskets have been getting bigger lately: fewer people, spending more each.
  const ordersPerDay = unitsByDay.map((u, i) => {
    const daysAgo = DEMO_DAYS - 1 - i;
    const basket = daysAgo < 30 ? 2.05 : 1.72;
    return Math.max(1, Math.round((u / basket) * (0.94 + rand() * 0.12)));
  });

  return {
    storeId: "demo",
    asOf: iso(end),
    products,
    series,
    ordersPerDay,
    returnsByItem,
  };
}
