import { describe, expect, it } from "vitest";
import {
  catalogToProducts,
  lastReceived,
  localDay,
  ordersToDaily,
  stockFor,
  type SqCatalogObject,
} from "@/lib/square/transform";

const TZ = "America/Denver";

const variation = (id: string, over: Record<string, unknown> = {}): SqCatalogObject => ({
  type: "ITEM_VARIATION",
  id,
  item_variation_data: { name: "Regular", price_money: { amount: 3200 }, track_inventory: true, ...over },
});

const catalog: SqCatalogObject[] = [
  { type: "CATEGORY", id: "cat-candles", category_data: { name: "Candles" } },
  {
    type: "ITEM", id: "item-1",
    item_data: { name: "Cedar & Smoke candle", categories: [{ id: "cat-candles" }], variations: [
      variation("var-1", { default_unit_cost: { amount: 1400 } }),
    ] },
  },
  {
    type: "ITEM", id: "item-2",
    item_data: { name: "Mug", category_id: "cat-missing", variations: [
      variation("var-2a", { name: "Small", price_money: { amount: 2000 } }),
      variation("var-2b", { name: "Large", price_money: { amount: 2600 }, track_inventory: false,
        item_variation_vendor_infos: [{ item_variation_vendor_info_data: { price_money: { amount: 900 } } }] }),
    ] },
  },
  { type: "ITEM", id: "item-3", item_data: { name: "Custom engraving", variations: [
    variation("var-3", { price_money: null }),
  ] } },
  { type: "ITEM", id: "item-4", is_deleted: true, item_data: { name: "Old thing", variations: [variation("var-4")] } },
];

describe("reading the Square catalog", () => {
  const products = catalogToProducts(catalog);

  it("makes one product per sellable variation", () => {
    expect(products.map((p) => p.squareItemId)).toEqual(["var-1", "var-2a", "var-2b"]);
  });
  it("keeps a plain name for single-variation items and labels the rest", () => {
    expect(products.map((p) => p.name)).toEqual(["Cedar & Smoke candle", "Mug — Small", "Mug — Large"]);
  });
  it("reads unit cost from the default cost, then the vendor info", () => {
    expect(products.map((p) => p.unitCostCents)).toEqual([1400, null, 900]);
  });
  it("resolves categories from both the old and new fields, and tolerates missing ones", () => {
    expect(products.map((p) => p.category)).toEqual(["Candles", null, null]);
  });
  it("skips deleted items and items priced at the till", () => {
    expect(products.find((p) => p.name.includes("engraving"))).toBeUndefined();
    expect(products.find((p) => p.name.includes("Old"))).toBeUndefined();
  });
});

describe("bucketing orders into the shop's own days", () => {
  it("uses the shop's timezone, not UTC", () => {
    // 3am UTC on the 24th is still the evening of the 23rd in Colorado
    expect(localDay("2026-09-24T03:00:00Z", TZ)).toBe("2026-09-23");
  });

  const rollup = ordersToDaily([
    { id: "o1", state: "COMPLETED", closed_at: "2026-09-22T18:00:00Z", total_money: { amount: 6400 },
      line_items: [{ catalog_object_id: "var-1", quantity: "2" }] },
    { id: "o2", state: "COMPLETED", closed_at: "2026-09-22T20:00:00Z", total_money: { amount: 3200 },
      line_items: [{ catalog_object_id: "var-1", quantity: "1" }, { quantity: "1" }] },
    { id: "o3", state: "COMPLETED", closed_at: "2026-09-22T21:00:00Z",
      returns: [{ return_line_items: [{ catalog_object_id: "var-1", quantity: "1" }] }] },
    { id: "o4", state: "CANCELED", closed_at: "2026-09-22T22:00:00Z",
      line_items: [{ catalog_object_id: "var-1", quantity: "9" }] },
  ], TZ);

  it("adds up units per item per day", () => {
    expect(rollup.units.get("var-1")?.get("2026-09-22")).toBe(3);
  });
  it("counts sales and money taken", () => {
    expect(rollup.orders.get("2026-09-22")).toBe(2);
    expect(rollup.revenue.get("2026-09-22")).toBe(9600);
  });
  it("counts a refund as a return, never as a sale", () => {
    expect(rollup.returns.get("var-1")).toBe(1);
    expect(rollup.orders.get("2026-09-22")).toBe(2); // o3 not counted
  });
  it("ignores cancelled orders and custom-amount lines", () => {
    expect(rollup.units.get("var-1")?.get("2026-09-22")).not.toBe(12);
  });
});

describe("stock levels", () => {
  const products = catalogToProducts(catalog);
  const stock = stockFor(products, [
    { catalog_object_id: "var-1", state: "IN_STOCK", quantity: "12" },
    { catalog_object_id: "var-1", state: "IN_STOCK", quantity: "5" },   // second location
    { catalog_object_id: "var-1", state: "SOLD", quantity: "400" },
  ]);

  it("sums on-hand stock across locations", () => {
    expect(stock.get("var-1")).toBe(17);
  });
  it("marks an untracked item as unknown, not zero", () => {
    expect(stock.get("var-2b")).toBeNull();
  });
  it("marks a tracked item with no count yet as unknown, not zero", () => {
    expect(stock.get("var-2a")).toBeNull();
  });
});

describe("when stock last arrived", () => {
  it("takes the latest receipt and ignores sales and counts", () => {
    const got = lastReceived([
      { type: "ADJUSTMENT", adjustment: { catalog_object_id: "var-1", from_state: "NONE", to_state: "IN_STOCK", occurred_at: "2026-08-01T16:00:00Z" } },
      { type: "ADJUSTMENT", adjustment: { catalog_object_id: "var-1", from_state: "NONE", to_state: "IN_STOCK", occurred_at: "2026-09-11T16:00:00Z" } },
      { type: "ADJUSTMENT", adjustment: { catalog_object_id: "var-1", from_state: "IN_STOCK", to_state: "SOLD", occurred_at: "2026-09-20T16:00:00Z" } },
    ], TZ);
    expect(got.get("var-1")).toBe("2026-09-11");
  });
});
