import { NextResponse } from "next/server";
import { computeStoreMetrics } from "@/lib/metrics";
import { evaluate } from "@/lib/rules";
import { renderAll, renderTemplate } from "@/lib/briefing/templates";
import { narrateCombined, shouldCombine } from "@/lib/briefing/narrate";
import { loadSnapshot, saveBriefing, storesDueNow } from "@/lib/store-repo";
import type { BriefingItem } from "@/lib/types";

export const maxDuration = 300;

/**
 * The whole product, once a day, per store.
 *
 * Order matters: pull, compute, decide, only then write. The model is the last
 * step and an optional one — if it fails, every store still gets a correct
 * briefing off the template path.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env["CRON_SECRET"]}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stores = await storesDueNow();
  const results: Array<{ storeId: string; items: number; error?: string }> = [];

  for (const store of stores) {
    try {
      const snapshot = await loadSnapshot(store);          // 1. observe
      const metrics = computeStoreMetrics(snapshot, 30);   // 2. understand
      const signals = evaluate(metrics);                   //    ...and decide

      let items: BriefingItem[];
      let note: string | undefined;

      if (signals.length === 0) {
        items = [];                                        // a quiet day stays quiet
      } else if (shouldCombine(signals)) {
        const { item, fellBackBecause } = await narrateCombined(signals);
        note = fellBackBecause;
        const rest = signals.slice(2).map(renderTemplate);
        items = [item, ...rest];
      } else {
        items = renderAll(signals);
      }

      await saveBriefing(store.id, snapshot.asOf, items, note);
      results.push({ storeId: store.id, items: items.length });
    } catch (err) {
      // One broken store must never stop the other 99.
      results.push({
        storeId: store.id,
        items: 0,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
