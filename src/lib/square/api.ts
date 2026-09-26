import { isSandbox } from "../env";
import type { SqCatalogObject, SqChange, SqCount, SqOrder } from "./transform";

/**
 * Thin, read-only calls to Square's REST API. Plain fetch rather than the SDK,
 * so the exact request shape is visible and matches Square's docs one-to-one.
 */

const SQUARE_VERSION = "2025-01-23";
const base = () => (isSandbox() ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com");

export class SquareError extends Error {
  constructor(public status: number, public codes: string[], message: string) {
    super(message);
  }
  get needsReconnect() {
    return this.status === 401 || this.codes.includes("INSUFFICIENT_SCOPES") || this.codes.includes("UNAUTHORIZED");
  }
}

async function sq<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}/v2${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: Array<{ code?: string; detail?: string }> } & T;
  if (!res.ok) {
    const codes = (json.errors ?? []).map((e) => e.code ?? "").filter(Boolean);
    const detail = (json.errors ?? []).map((e) => e.detail).filter(Boolean).join("; ");
    throw new SquareError(res.status, codes, `Square ${path} failed (${res.status}): ${detail || codes.join(", ")}`);
  }
  return json;
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export interface SqLocation { id: string; name?: string; status?: string; timezone?: string }

export async function listLocations(token: string): Promise<SqLocation[]> {
  const r = await sq<{ locations?: SqLocation[] }>(token, "/locations");
  return (r.locations ?? []).filter((l) => l.status !== "INACTIVE");
}

export async function listCatalog(token: string): Promise<SqCatalogObject[]> {
  const out: SqCatalogObject[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY", ...(cursor ? { cursor } : {}) });
    const r = await sq<{ objects?: SqCatalogObject[]; cursor?: string }>(token, `/catalog/list?${q}`);
    out.push(...(r.objects ?? []));
    cursor = r.cursor;
  } while (cursor);
  return out;
}

/** Completed orders closed in [startIso, endIso). Square allows 10 locations per search. */
export async function searchOrders(token: string, locationIds: string[], startIso: string, endIso: string): Promise<SqOrder[]> {
  const out: SqOrder[] = [];
  for (const locs of chunk(locationIds, 10)) {
    let cursor: string | undefined;
    do {
      const r = await sq<{ orders?: SqOrder[]; cursor?: string }>(token, "/orders/search", {
        location_ids: locs,
        limit: 500,
        cursor,
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: { closed_at: { start_at: startIso, end_at: endIso } },
          },
          // Square requires the sort field to match the date filter field.
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
      });
      out.push(...(r.orders ?? []));
      cursor = r.cursor;
    } while (cursor);
  }
  return out;
}

export async function inventoryCounts(token: string, variationIds: string[], locationIds: string[]): Promise<SqCount[]> {
  const out: SqCount[] = [];
  for (const ids of chunk(variationIds, 1000)) {
    let cursor: string | undefined;
    do {
      const r = await sq<{ counts?: SqCount[]; cursor?: string }>(token, "/inventory/counts/batch-retrieve", {
        catalog_object_ids: ids, location_ids: locationIds, states: ["IN_STOCK"], cursor,
      });
      out.push(...(r.counts ?? []));
      cursor = r.cursor;
    } while (cursor);
  }
  return out;
}

export async function stockReceipts(token: string, variationIds: string[], sinceIso: string): Promise<SqChange[]> {
  const out: SqChange[] = [];
  for (const ids of chunk(variationIds, 1000)) {
    let cursor: string | undefined;
    do {
      const r = await sq<{ changes?: SqChange[]; cursor?: string }>(token, "/inventory/changes/batch-retrieve", {
        catalog_object_ids: ids, types: ["ADJUSTMENT"], updated_after: sinceIso, cursor,
      });
      out.push(...(r.changes ?? []));
      cursor = r.cursor;
    } while (cursor);
  }
  return out;
}
