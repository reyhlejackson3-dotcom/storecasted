import { computeStoreMetrics } from "../metrics";
import { DEFAULT_RULES, evaluate } from "../rules";
import { renderTemplate } from "./templates";
import type { BriefingItem, Signal, StoreSnapshot } from "../types";

export type ShownItem = BriefingItem & { itemId: string | null };

/** Snapshot in, briefing out. The same path for the demo store and a real one. */
export function buildBriefing(snapshot: StoreSnapshot): { briefing: ShownItem[]; alsoNoticed: ShownItem[] } {
  const metrics = computeStoreMetrics(snapshot, 30);
  const toItem = (s: Signal): ShownItem => ({ ...renderTemplate(s), itemId: s.squareItemId ?? null });
  const briefing = evaluate(metrics).map(toItem);
  const shown = new Set(briefing.map((b) => b.kind));
  const alsoNoticed = evaluate(metrics, { ...DEFAULT_RULES, maxItems: 10 })
    .filter((s) => !shown.has(s.kind))
    .map(toItem);
  return { briefing, alsoNoticed };
}
