import Anthropic from "@anthropic-ai/sdk";
import type { BriefingItem, Signal } from "../types";
import { renderTemplate } from "./templates";

/**
 * The only place a model is involved in this product.
 *
 * Its job is narrow on purpose: take two or more signals the rules engine
 * already selected, and join them into one sentence a person would say.
 * It never sees raw sales data, never decides what matters, and never
 * produces a number — every figure in its output is checked against the
 * facts it was given, and the whole call is discarded if one doesn't match.
 *
 * Model choice: Haiku 4.5. This is a formatting task on a handful of numbers,
 * not a reasoning task, and it runs once per store per day. Batch pricing
 * would halve an already trivial cost while adding polling — not worth it
 * until you're at thousands of stores.
 */

const MODEL = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";

const SYSTEM = `You write one sentence for a shop owner's morning briefing.

You are given facts that have already been calculated. Your only job is to
connect them into a single plain sentence, and a short suggested action.

Rules, without exception:
- Use ONLY numbers that appear in the facts given to you. Never calculate,
  estimate, round differently, or infer a number. If a number is not in the
  facts, it does not go in your answer.
- Write the way a good employee talks. No jargon: say "selling fast", not
  "high velocity"; "last month", not "trailing 30-day window".
- Phrase the action as a suggestion. "Consider reordering X", never "Reorder X".
- No greeting, no preamble, no sign-off, no emoji.

Reply with JSON only, no markdown fence:
{"headline": "...", "action": "..."}`;

/** Every number in a string, normalised so 1,234 and 1234 compare equal. */
function numbersIn(text: string): Set<string> {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return new Set(found.map((s) => s.replace(/,/g, "").replace(/\.0+$/, "")));
}

/**
 * Guard against the one failure that would sink trust in this product:
 * a number in the briefing that isn't real. Cheap, deterministic, and it
 * runs on every single generation.
 */
export function assertOnlyKnownNumbers(
  text: string,
  facts: Record<string, string | number>,
): { ok: true } | { ok: false; unknown: string[] } {
  const known = new Set<string>();
  for (const v of Object.values(facts)) {
    for (const num of numbersIn(String(v))) known.add(num);
  }
  const unknown = [...numbersIn(text)].filter((x) => !known.has(x));
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown };
}

export interface NarrateResult {
  item: BriefingItem;
  /** Set when the model was tried and rejected, for the logs. */
  fellBackBecause?: string;
}

/**
 * Combine several signals into one item. Falls back to the template rendering
 * of the strongest signal on any failure — a bad API day must never mean a
 * missing briefing.
 */
export async function narrateCombined(
  signals: Signal[],
  client?: Anthropic,
): Promise<NarrateResult> {
  const strongest = signals[0];
  if (!strongest) throw new Error("narrateCombined called with no signals");
  if (signals.length < 2) return { item: renderTemplate(strongest) };

  const merged: Record<string, string | number> = {};
  signals.forEach((s, i) => {
    for (const [k, v] of Object.entries(s.facts)) merged[`${i + 1}_${k}`] = v;
  });

  const fallback = (why: string): NarrateResult => ({
    item: renderTemplate(strongest),
    fellBackBecause: why,
  });

  try {
    const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `These facts are all related and were selected as today's most important.\n` +
            `Connect them into one sentence.\n\n` +
            JSON.stringify(merged, null, 2),
        },
      ],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()) as {
      headline?: unknown;
      action?: unknown;
    };
    if (typeof parsed.headline !== "string" || typeof parsed.action !== "string") {
      return fallback("model returned unusable shape");
    }

    const check = assertOnlyKnownNumbers(
      `${parsed.headline} ${parsed.action}`,
      merged,
    );
    if (!check.ok) {
      return fallback(`model invented numbers: ${check.unknown.join(", ")}`);
    }

    return {
      item: {
        kind: strongest.kind,
        severity: strongest.severity,
        headline: parsed.headline,
        action: parsed.action,
        facts: merged,
        generatedBy: "llm",
      },
    };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : "unknown error");
  }
}

/**
 * Signals worth combining: different kinds, pointing at the same story.
 * Everything else stays on the template path, which costs nothing and
 * cannot be wrong.
 */
export function shouldCombine(signals: Signal[]): boolean {
  if (signals.length < 2) return false;
  const kinds = new Set(signals.map((s) => s.kind));
  const pairs: Array<[string, string]> = [
    ["revenue_swing", "out_of_stock"],
    ["revenue_swing", "revenue_traffic_divergence"],
    ["out_of_stock", "stockout_imminent"],
  ];
  return pairs.some(([a, b]) => kinds.has(a as never) && kinds.has(b as never));
}
