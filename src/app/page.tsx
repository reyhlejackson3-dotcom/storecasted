import App from "./App";
import { demoSnapshot, DEMO_STORE_NAME } from "@/lib/demo";
import { computeStoreMetrics } from "@/lib/metrics";
import { DEFAULT_RULES, evaluate } from "@/lib/rules";
import { renderTemplate } from "@/lib/briefing/templates";

/**
 * The real engine, running on the demo store.
 *
 * Nothing on this page is hardcoded text: metrics.ts does the maths, rules.ts
 * decides what's worth saying, templates.ts writes it. Swap demoSnapshot()
 * for loadSnapshot(store) and this becomes a real shop's briefing.
 */
export const revalidate = 3600;

export default function Page() {
  const snapshot = demoSnapshot();
  const metrics = computeStoreMetrics(snapshot, 30);

  const toItem = (s: ReturnType<typeof evaluate>[number]) => ({
    ...renderTemplate(s),
    itemId: s.squareItemId ?? null,
  });

  const briefing = evaluate(metrics).map(toItem);
  const shown = new Set(briefing.map((b) => b.kind));
  const alsoNoticed = evaluate(metrics, { ...DEFAULT_RULES, maxItems: 10 })
    .filter((s) => !shown.has(s.kind))
    .map(toItem);

  return (
    <App
      storeName={DEMO_STORE_NAME}
      snapshot={snapshot}
      briefing={briefing}
      alsoNoticed={alsoNoticed}
    />
  );
}
