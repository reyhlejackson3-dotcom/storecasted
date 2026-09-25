import { NextResponse } from "next/server";
import { computeStoreMetrics } from "@/lib/metrics";
import { evaluate } from "@/lib/rules";
import { renderAll, renderTemplate } from "@/lib/briefing/templates";
import { narrateCombined, shouldCombine } from "@/lib/briefing/narrate";
import { loadSnapshot, saveBriefing, storesDueNow } from "@/lib/store-repo";
import { syncStore } from "@/lib/square/sync";
import type { BriefingItem } from "@/lib/types";

export const maxDuration = 300;

/**
 * Once a day, for every connected store: pull fresh data from Square, then
 * write that morning's briefing. One store failing never stops the rest.
 */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env["CRON_SECRET"]}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Array<{ storeId: string; items?: number; error?: string }> = [];
  for (const store of await storesDueNow()) {
    try {
      await syncStore(store);                              // 1. observe
      const snapshot = await loadSnapshot(store);
      const signals = evaluate(computeStoreMetrics(snapshot, 30));   // 2. understand + decide

      let items: BriefingItem[] = [];                      // 3. recommend
      let note: string | undefined;
      if (signals.length > 0 && shouldCombine(signals) && process.env["ANTHROPIC_API_KEY"]) {
        const { item, fellBackBecause } = await narrateCombined(signals);
        note = fellBackBecause;
        items = [item, ...signals.slice(2).map(renderTemplate)];
      } else {
        items = renderAll(signals);
      }
      await saveBriefing(store.id, snapshot.asOf, items, note);
      results.push({ storeId: store.id, items: items.length });
    } catch (err) {
      results.push({ storeId: store.id, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
