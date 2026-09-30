import { listJoin } from "../rules";
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
      const units = s.facts["order_units"];
      const cover = s.facts["order_cover_days"];
      const cost = s.facts["order_cost"];
      const fromCycle = s.facts["order_basis"] === "restock_cycle";

      const action =
        units !== undefined && cover !== undefined
          ? `Order ${units} now to restock before you run out. ` +
            `That's about ${cover} days' worth at ${f(s, "velocity_per_day")} a day` +
            (fromCycle ? ` — as long as your last restock lasted —` : "") +
            ` plus a ${f(s, "order_buffer_pct")}% cushion.` +
            (cost !== undefined ? ` At your cost, ${cost}.` : "")
          : `Reorder now, while there's still stock on the shelf to sell.`;
      return {
        ...base,
        headline: `You'll run out of ${f(s, "item")} in about ${days} ${plural(days, "day", "days")}.`,
        action,
      };
    }

    case "out_of_stock": {
      const count = n(s, "item_count");
      const orderCount = n(s, "order_count");
      const cost = s.facts["order_cost"];
      const costLine = cost !== undefined ? ` At your cost, ${cost}.` : "";

      if (count === 1 && orderCount === 1) {
        return {
          ...base,
          headline: `You're out of ${f(s, "order_item_1")}.`,
          action:
            `Order ${f(s, "order_units_1")} to get back in stock. That's about a month's worth at the ` +
            `${f(s, "order_rate_1")} a day it sold before running out, plus a ${f(s, "order_buffer_pct")}% cushion.` + costLine,
        };
      }

      const lines: string[] = [];
      for (let i = 1; i <= orderCount; i++) {
        lines.push(`${f(s, `order_item_${i}`)} (${f(s, `order_units_${i}`)})`);
      }
      return {
        ...base,
        headline:
          count === 1 ? `You're out of ${f(s, "item_names")}.` : `You're out of ${count} items.`,
        action:
          lines.length > 0
            ? `Order ${listJoin(lines)} to get back in stock — about a month's worth each, at the rate they sold before running out.` +
              costLine +
              ` They were bringing in ${f(s, "lost_revenue")} over a comparable stretch.`
            : `Restock ${f(s, "item_names")} — ${plural(count, "it was", "they were")} bringing in ${f(s, "lost_revenue")} over a comparable stretch.`,
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
