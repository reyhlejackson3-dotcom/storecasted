import type { BriefingItem, Signal } from "../types";

/**
 * Fixed sentences with real numbers dropped into them.
 *
 * Nothing here generates text, so nothing here can generate a wrong number.
 * This path produces a complete, usable briefing on its own — the model in
 * ../briefing/narrate.ts is an enhancement layered on top, never a dependency.
 *
 * House style, from the brand voice: plain words, no jargon, and actions are
 * always phrased as suggestions. "Consider reordering X", never "Reorder X".
 */

const f = (s: Signal, k: string): string => String(s.facts[k] ?? "");
const n = (s: Signal, k: string): number => Number(s.facts[k] ?? 0);

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

const prettyDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

export function renderTemplate(s: Signal): BriefingItem {
  const base = { kind: s.kind, severity: s.severity, facts: s.facts, generatedBy: "template" as const };

  switch (s.kind) {
    case "stockout_imminent": {
      const days = n(s, "days_to_stockout");
      const cycle = s.facts["typical_restock_lasts_days"];
      const received = s.facts["last_received"];
      const action =
        cycle !== undefined && received !== undefined
          ? `Consider reordering now. You received these on ${prettyDate(String(received))}, so at this pace a restock lasts you about ${cycle} days.`
          : `Consider reordering now, while there's still stock on the shelf to sell.`;
      return {
        ...base,
        headline: `${f(s, "item")} runs out in about ${days} ${plural(days, "day", "days")}.`,
        action,
      };
    }

    case "out_of_stock": {
      const count = n(s, "item_count");
      return {
        ...base,
        headline:
          count === 1
            ? `${f(s, "item_names")} has been out of stock and it's costing you sales.`
            : `${count} items are out of stock and it's costing you sales.`,
        action: `Consider restocking ${f(s, "item_names")} first — ${plural(count, "it was", "they were")} bringing in about ${f(s, "lost_revenue")} over a comparable stretch.`,
      };
    }

    case "revenue_swing": {
      const up = f(s, "direction") === "up";
      const pct = Math.abs(n(s, "change_pct"));
      return {
        ...base,
        headline: `Sales are ${up ? "up" : "down"} ${pct}% on the last ${n(s, "window_days")} days.`,
        action: up
          ? `Worth knowing what's driving it, so you can keep it going. The Products tab sorts by revenue.`
          : `Worth a look at which products moved. The Products tab sorts by revenue.`,
      };
    }

    case "revenue_traffic_divergence": {
      const rev = n(s, "revenue_change_pct");
      const ord = n(s, "order_change_pct");
      const fewerPeople = ord < 0;
      return {
        ...base,
        headline: fewerPeople
          ? `Fewer people are coming in, but they're spending more each.`
          : `More people are coming in, but they're spending less each.`,
        action: `Sales are ${rev > 0 ? "up" : "down"} ${Math.abs(rev)}% while the number of transactions is ${ord > 0 ? "up" : "down"} ${Math.abs(ord)}%. Your average sale moved from ${f(s, "average_order_prior")} to ${f(s, "average_order")}.`,
      };
    }

    case "accelerating_item": {
      const days = s.facts["days_to_stockout"];
      return {
        ...base,
        headline: `${f(s, "item")} is selling ${f(s, "multiple")} times faster than it was.`,
        action: `Consider giving it a better spot while that lasts. You have ${f(s, "stock")} left${days !== "n/a" ? `, about ${days} days at this rate` : ""}.`,
      };
    }

    case "high_return_rate":
      return {
        ...base,
        headline: `${f(s, "item")} is coming back more than anything else you sell.`,
        action: `${f(s, "returns")} of the ${f(s, "units_sold")} you sold were refunded — ${f(s, "return_rate_pct")}%. Consider whether it's a sizing, quality or description problem.`,
      };

    case "dead_stock":
      return {
        ...base,
        headline: `${f(s, "item")} hasn't moved since you got it in.`,
        action: `${f(s, "stock")} sitting on the shelf ${f(s, "days_since_received")} days after it arrived. Consider discounting it or moving it somewhere people actually look.`,
      };
  }
}

export function renderAll(signals: Signal[]): BriefingItem[] {
  return signals.map(renderTemplate);
}

/** What the app says when there is genuinely nothing worth saying. */
export const QUIET_DAY = {
  headline: "Nothing needs you this morning.",
  action:
    "Stock levels are healthy and sales are steady. Storecasted will speak up when that changes.",
};
