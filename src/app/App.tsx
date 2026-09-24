"use client";

import { useMemo, useState } from "react";
import type { BriefingItem, StoreSnapshot } from "@/lib/types";

type Item = BriefingItem & { itemId: string | null };
type Tab = "today" | "dashboard" | "products";
type TF = "day" | "week" | "month" | "year";
type Metric = "rev" | "units" | "orders" | "prof";

interface Props {
  storeName: string;
  snapshot: StoreSnapshot;
  briefing: Item[];
  alsoNoticed: Item[];
}

/* ---------------- formatting ---------------- */
const usd = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const price = (cents: number) =>
  cents % 100 === 0 ? usd(cents) : "$" + (cents / 100).toFixed(2);
const at = (xs: readonly number[], i: number) => xs[i] ?? 0;
const fmtDate = (d: Date, o: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const isoToDate = (iso: string) => new Date(iso + "T00:00:00Z");

/* ---------------- facts → labelled figures ---------------- */
const FACT_LABELS: Record<string, [string, (v: string | number) => string]> = {
  stock: ["On the shelf", (v) => String(v)],
  velocity_per_day: ["Selling", (v) => `${v}/day`],
  days_to_stockout: ["Runs out in", (v) => (v === "n/a" ? "—" : `${v} days`)],
  last_received: ["Last received", (v) => fmtDate(isoToDate(String(v)), { month: "short", day: "numeric" })],
  typical_restock_lasts_days: ["A restock lasts", (v) => `${v} days`],
  item_count: ["Items out", (v) => String(v)],
  lost_revenue: ["Selling before", (v) => String(v)],
  revenue_change_pct: ["Sales", (v) => `${Number(v) > 0 ? "+" : ""}${v}%`],
  order_change_pct: ["Transactions", (v) => `${Number(v) > 0 ? "+" : ""}${v}%`],
  average_order_prior: ["Avg sale before", (v) => String(v)],
  average_order: ["Avg sale now", (v) => String(v)],
  change_pct: ["Change", (v) => `${Number(v) > 0 ? "+" : ""}${v}%`],
  revenue: ["Last 30 days", (v) => String(v)],
  revenue_prior: ["The 30 before", (v) => String(v)],
  multiple: ["Faster by", (v) => `${v}×`],
  velocity_prior_per_day: ["Was selling", (v) => `${v}/day`],
  returns: ["Returned", (v) => String(v)],
  units_sold: ["Sold", (v) => String(v)],
  return_rate_pct: ["Return rate", (v) => `${v}%`],
  days_since_received: ["Days on shelf", (v) => String(v)],
};
function figuresFor(facts: Record<string, string | number>) {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(facts)) {
    const spec = FACT_LABELS[k];
    if (spec && out.length < 4) out.push([spec[0], spec[1](v)]);
  }
  return out;
}
const SEVERITY_LABEL = { attention: "Needs attention", watch: "Worth watching", opportunity: "Opportunity" } as const;

/* ---------------- bars ---------------- */
function Bars({
  values, color = "var(--amber)", height = 190, className = "chart", split = 0, refValue, active, onPick,
}: {
  values: number[]; color?: string; height?: number; className?: string; split?: number;
  refValue?: number; active?: number | null; onPick?: (i: number | null) => void;
}) {
  const W = 340, PAD = 4, n = values.length;
  const gap = n > 60 ? 1 : n > 24 ? 1.6 : 2.6;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...values);
  const plotH = height - PAD * 2;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    onPick(Math.max(0, Math.min(n - 1, Math.floor(x / (bw + gap)))));
  };
  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => onPick?.(null)}
      role="img"
      aria-label="Bar chart"
    >
      {values.map((v, i) => {
        const h = v <= 0 ? 1.2 : Math.max(2, (v / max) * plotH);
        const old = i < split;
        const dim = active != null ? (i === active ? 1 : 0.3) : old ? 0.35 : 1;
        return (
          <rect key={i} x={i * (bw + gap)} y={PAD + plotH - h} width={bw} height={h} rx={1}
            fill={old ? "var(--ink-2)" : color} opacity={dim} />
        );
      })}
      <line x1={0} x2={W} y1={PAD + plotH} y2={PAD + plotH} stroke="var(--rule)" vectorEffect="non-scaling-stroke" />
      {refValue != null && (
        <line x1={0} x2={W} y1={PAD + plotH - (refValue / max) * plotH} y2={PAD + plotH - (refValue / max) * plotH}
          stroke="var(--ink-2)" strokeWidth={1.2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

/* ======================================================================== */

export default function App({ storeName, snapshot, briefing, alsoNoticed }: Props) {
  const [tab, setTab] = useState<Tab>("today");
  const N = snapshot.ordersPerDay.length;
  const start = isoToDate(snapshot.series[0]?.startDate ?? snapshot.asOf);
  const dateAt = (i: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
  const today = new Date(isoToDate(snapshot.asOf).getTime() + 86_400_000);

  const products = useMemo(() => {
    const byId = new Map(snapshot.series.map((s) => [s.squareItemId, s.units]));
    return snapshot.products.map((p) => {
      const units = byId.get(p.squareItemId) ?? [];
      const last30 = units.slice(-30).reduce((a, b) => a + b, 0);
      const vel = last30 / 30;
      return {
        ...p, units, vel,
        dts: p.stock === 0 ? null : vel > 0 ? p.stock / vel : null,
        returns: snapshot.returnsByItem[p.squareItemId] ?? 0,
      };
    });
  }, [snapshot]);
  type P = (typeof products)[number];

  const agg = (items: P[], a: number, b: number) => {
    let units = 0, rev = 0, prof = 0, revCovered = 0;
    for (const it of items) {
      let s = 0;
      for (let i = Math.max(0, a); i < Math.min(N, b); i++) s += at(it.units, i);
      units += s; rev += s * it.priceCents;
      if (it.unitCostCents != null) { prof += s * (it.priceCents - it.unitCostCents); revCovered += s * it.priceCents; }
    }
    return { units, rev, prof, revCovered };
  };
  const orders = (a: number, b: number) => {
    let o = 0;
    for (let i = Math.max(0, a); i < Math.min(N, b); i++) o += at(snapshot.ordersPerDay, i);
    return o;
  };
  const metricAt = (a: number, b: number, m: Metric) =>
    m === "orders" ? orders(a, b) : agg(products, a, b)[m];

  /* buckets — comparison windows always match the headline window exactly */
  const buckets = (tf: TF) => {
    const show = tf === "day" ? 30 : tf === "week" ? 12 : tf === "month" ? 12 : 24;
    const head = tf === "year" ? 12 : show;
    const total = show + head;
    const all: Array<{ a: number; b: number; label: string; short: string }> = [];
    if (tf === "day") {
      for (let i = N - total; i < N; i++) if (i >= 0) {
        const d = dateAt(i);
        all.push({ a: i, b: i + 1, label: fmtDate(d, { weekday: "short", month: "long", day: "numeric" }), short: fmtDate(d, { month: "short", day: "numeric" }) });
      }
    } else if (tf === "week") {
      for (let w = total; w > 0; w--) {
        const a = N - w * 7;
        if (a >= 0) all.push({ a, b: a + 7, label: "Week of " + fmtDate(dateAt(a), { month: "long", day: "numeric" }), short: fmtDate(dateAt(a), { month: "short", day: "numeric" }) });
      }
    } else {
      const end = dateAt(N - 1);
      for (let m = total - 1; m >= 0; m--) {
        const ms = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1 - m, 1));
        const me = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - m, 1));
        const a = Math.round((ms.getTime() - start.getTime()) / 86_400_000);
        const b = Math.round((me.getTime() - start.getTime()) / 86_400_000);
        if (a >= 0) all.push({ a, b, label: fmtDate(ms, { month: "long", year: "numeric" }), short: fmtDate(ms, { month: "short" }) + (ms.getUTCMonth() === 0 ? ` '${String(ms.getUTCFullYear()).slice(2)}` : "") });
      }
    }
    const bars = all.slice(-show);
    const headB = all.slice(-head);
    const prior = all.length >= head * 2 ? all.slice(-head * 2, -head) : [];
    return { bars, head: headB, prior, split: bars.length - headB.length };
  };

  const attention = briefing.filter((b) => b.severity === "attention").length;
  const COUNT = ["Nothing urgent", "One thing needs", "Two things need", "Three things need"];
  const hero = attention === 0 ? "Nothing urgent this morning." : `${COUNT[attention] ?? "A few things need"} you today.`;

  return (
    <>
      <header className="top">
        <div className="top-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wordmark" src="/logo-white.png" alt="Storecasted" />
          <span className="demo-tag">Demo store</span>
          <p className="store">{storeName}<span>Sample data · real engine</span></p>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        <div className="tabs-in" role="tablist">
          {(["today", "dashboard", "products"] as Tab[]).map((t) => (
            <button key={t} className="tab" role="tab" aria-selected={tab === t}
              onClick={() => { setTab(t); window.scrollTo({ top: 0 }); }}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </nav>

      <main>
        {tab === "today" && (
          <Today
            today={today} hero={hero} briefing={briefing} alsoNoticed={alsoNoticed}
            products={products} N={N} agg={agg}
          />
        )}
        {tab === "dashboard" && (
          <Dashboard products={products} N={N} buckets={buckets} agg={agg} orders={orders}
            metricAt={metricAt} dateAt={dateAt} snapshot={snapshot} />
        )}
        {tab === "products" && <Products products={products} buckets={buckets} agg={agg} snapshot={snapshot} />}
      </main>
    </>
  );
}

/* ---------------- Today ---------------- */
function Today({ today, hero, briefing, alsoNoticed, products, N, agg }: {
  today: Date; hero: string; briefing: Item[]; alsoNoticed: Item[];
  products: Array<{ squareItemId: string; units: number[]; priceCents: number; unitCostCents: number | null; stock: number }>;
  N: number; agg: (items: never[], a: number, b: number) => { rev: number };
}) {
  const storeRevenue30 = useMemo(() => {
    const out: number[] = [];
    for (let i = N - 30; i < N; i++) {
      let r = 0;
      for (const p of products) r += at(p.units, i) * p.priceCents;
      out.push(r);
    }
    return out;
  }, [products, N]);
  void agg;
  const outUnits45 = useMemo(() => {
    const out: number[] = [];
    const gone = products.filter((p) => (p as { stock?: number }).stock === 0);
    for (let i = N - 45; i < N; i++) out.push(gone.reduce((t, p) => t + at(p.units, i), 0));
    return out;
  }, [products, N]);

  return (
    <section>
      <p className="dateline">{fmtDate(today, { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="hero">{hero}</h1>
      <p className="sub">
        Read at 5:00 AM from this store&apos;s sales, stock counts and restock history. Every sentence below
        was chosen by the rules engine and written from a template — no AI, so no number can be wrong.
      </p>

      <ul className="brief">
        {briefing.length === 0 && (
          <li className="item">
            <h2 className="headline">Nothing needs you this morning.</h2>
            <p className="action">Stock levels are healthy and sales are steady.</p>
          </li>
        )}
        {briefing.map((b, i) => {
          const p = b.itemId ? products.find((x) => x.squareItemId === b.itemId) : undefined;
          const isOut = b.kind === "out_of_stock";
          const bars = p ? p.units.slice(-30) : isOut ? outUnits45 : storeRevenue30;
          const color = b.severity === "attention" ? "var(--red)" : b.severity === "watch" ? "var(--amber)" : "var(--green)";
          return (
            <li className="item" key={i}>
              <p className={`pill ${b.severity}`}>{SEVERITY_LABEL[b.severity]}</p>
              <h2 className="headline">{b.headline}</h2>
              <p className="action">{b.action}</p>
              <div className={`evidence ${b.severity}`}>
                <dl className="figs">
                  {figuresFor(b.facts).map(([l, v]) => (
                    <div className="fig" key={l}><dt>{l}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
                <Bars values={bars} color={color} height={60} className="mini" />
                <p className="note">
                  {p ? "Units sold per day, last 30 days."
                    : isOut ? "Combined units sold per day for the out-of-stock items, last 45 days. The flat stretch is lost sales."
                    : "Store sales per day, last 30 days."}
                </p>
                <p className="method"><b>Written from a template.</b> The numbers were computed first, then dropped into a fixed sentence.</p>
              </div>
            </li>
          );
        })}
      </ul>

      {alsoNoticed.length > 0 && (
        <div className="also">
          <h2 className="h3" style={{ marginTop: 0 }}>Also noticed</h2>
          <p className="lede">Real, but lower priority today. The briefing only leads with the few things that matter most.</p>
          {alsoNoticed.map((b, i) => (
            <div className="also-row" key={i}>
              <span className={`sq ${b.severity}`} />
              <div><p className="also-h">{b.headline}</p><p className="also-a">{b.action}</p></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Dashboard ---------------- */
type Bk = { a: number; b: number; label: string; short: string };
type BucketsFn = (tf: TF) => { bars: Bk[]; head: Bk[]; prior: Bk[]; split: number };

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function deltaOf(a: number, b: number) {
  if (!b) return { cls: "flat", text: "no earlier data" };
  const p = ((a - b) / b) * 100;
  if (Math.abs(p) < 1) return { cls: "flat", text: "about level" };
  return { cls: p > 0 ? "up" : "down", text: `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%` };
}

function Dashboard({ products, N, buckets, agg, orders, metricAt, dateAt, snapshot }: {
  products: any[]; N: number; buckets: BucketsFn;
  agg: (items: any[], a: number, b: number) => { units: number; rev: number; prof: number; revCovered: number };
  orders: (a: number, b: number) => number;
  metricAt: (a: number, b: number, m: Metric) => number;
  dateAt: (i: number) => Date; snapshot: StoreSnapshot;
}) {
  const [tf, setTf] = useState<TF>("day");
  const [m, setM] = useState<Metric>("rev");
  const [active, setActive] = useState<number | null>(null);

  const B = buckets(tf);
  const vals = B.bars.map((b) => metricAt(b.a, b.b, m));
  const hs = [B.head[0]!.a, B.head[B.head.length - 1]!.b] as const;
  const ps = B.prior.length ? ([B.prior[0]!.a, B.prior[B.prior.length - 1]!.b] as const) : null;
  const now = agg(products, hs[0], hs[1]);
  const prev = ps ? agg(products, ps[0], ps[1]) : { units: 0, rev: 0, prof: 0, revCovered: 0 };
  const cur = metricAt(hs[0], hs[1], m);
  const pre = ps ? metricAt(ps[0], ps[1], m) : 0;
  const fmt = m === "units" || m === "orders" ? num : usd;
  const d = deltaOf(cur, pre);
  const o = orders(hs[0], hs[1]), po = ps ? orders(ps[0], ps[1]) : 0;

  const SPAN = { day: "Last 30 days, one bar per day.", week: "Last 12 weeks, one bar per week.", month: "Last 12 months, one bar per month.", year: "Last 2 years, one bar per month." }[tf];
  const readout = active != null && B.bars[active]
    ? `${B.bars[active]!.label} — ${fmt(vals[active] ?? 0)} · ${num(orders(B.bars[active]!.a, B.bars[active]!.b))} sales`
    : `${SPAN} ${fmtDate(dateAt(hs[0]), { month: "long", day: "numeric", year: "numeric" })} to ${fmtDate(dateAt(hs[1] - 1), { month: "long", day: "numeric", year: "numeric" })}. Tap a bar.`;

  // busiest days, last 90
  const dow = [0, 0, 0, 0, 0, 0, 0];
  for (let i = N - 90; i < N; i++) dow[(dateAt(i).getUTCDay() + 6) % 7]! += agg(products, i, i + 1).rev;
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxDow = Math.max(...dow);

  // inventory
  let onHand = 0, atRetail = 0, out = 0, low = 0;
  let oldest: any = null;
  for (const p of products) {
    onHand += p.stock; atRetail += p.stock * p.priceCents;
    if (p.stock === 0) out++; else if (p.dts !== null && p.dts <= 14) low++;
    if (p.stock > 0 && p.lastReceivedAt && (!oldest || p.lastReceivedAt < oldest.lastReceivedAt)) oldest = p;
  }
  const daysAgo = (iso: string) => Math.round((isoToDate(snapshot.asOf).getTime() - isoToDate(iso).getTime()) / 86_400_000);

  // categories
  const cats = new Map<string, { rev: number; prev: number; units: number; n: number }>();
  for (const p of products) {
    const k = p.category ?? "Uncategorised";
    const a = agg([p], hs[0], hs[1]), b = ps ? agg([p], ps[0], ps[1]) : { rev: 0 };
    const c = cats.get(k) ?? { rev: 0, prev: 0, units: 0, n: 0 };
    c.rev += a.rev; c.prev += b.rev; c.units += a.units; c.n++;
    cats.set(k, c);
  }
  const catList = [...cats.entries()].sort((x, y) => y[1].rev - x[1].rev);
  const topCat = catList[0]?.[1].rev || 1;

  const Cell = ({ t, v, dl }: { t: string; v: string; dl?: { cls: string; text: string } }) => (
    <div className="cell"><dt>{t}</dt><dd>{v}{dl && <span className={`delta ${dl.cls}`}>{dl.text}</span>}</dd></div>
  );

  return (
    <section>
      <h2 className="h2">Dashboard</h2>
      <p className="lede">The whole shop, however you want to slice it. Nothing here is interpreted — it&apos;s the store&apos;s data, added up.</p>
      <div className="controls">
        <Seg label="Time period" value={tf} onChange={(v) => { setTf(v); setActive(null); }}
          options={[["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]]} />
        <Seg label="Measure" value={m} onChange={(v) => { setM(v); setActive(null); }}
          options={[["rev", "Revenue"], ["units", "Units"], ["orders", "Sales"], ["prof", "Profit"]]} />
      </div>

      {m === "prof" && (
        <p className="banner">
          Some items have no unit cost in Square, so profit covers {Math.round((now.revCovered / Math.max(1, now.rev)) * 100)}% of revenue
          for this period. The rest are left out — never estimated.
        </p>
      )}

      <div className="big">
        <strong>{fmt(cur)}</strong>
        <span className={`chg ${d.cls}`}>{d.cls === "flat" ? d.text : `${d.text} from ${fmt(pre)}`}</span>
      </div>
      <p className="readout">{readout}</p>
      <Bars values={vals} split={B.split} refValue={!B.split && ps ? pre / B.prior.length : undefined}
        active={active} onPick={setActive} />
      <p className="axis"><span>{B.bars[0]?.short}</span><span>{B.bars[B.bars.length - 1]?.short}</span></p>

      <dl className="strip">
        <Cell t="Revenue" v={usd(now.rev)} dl={deltaOf(now.rev, prev.rev)} />
        <Cell t="Sales" v={num(o)} dl={deltaOf(o, po)} />
        <Cell t="Average sale" v={usd(o ? now.rev / o : 0)} dl={deltaOf(o ? now.rev / o : 0, po ? prev.rev / po : 0)} />
        <Cell t="Items per sale" v={(o ? now.units / o : 0).toFixed(2)} dl={deltaOf(o ? now.units / o : 0, po ? prev.units / po : 0)} />
        <Cell t="Units sold" v={num(now.units)} dl={deltaOf(now.units, prev.units)} />
        <Cell t="Profit" v={usd(now.prof)} dl={{ cls: "flat", text: `on ${Math.round((now.revCovered / Math.max(1, now.rev)) * 100)}% of revenue` }} />
      </dl>

      <h3 className="h3">Busiest days</h3>
      <p className="lede">Revenue by day of the week, last 90 days.</p>
      <div>
        {dow.map((v, i) => (
          <div className="barrow" key={i}>
            <span className="n">{DOW[i]}</span><span className="v">{usd(v)}</span>
            <span className="b"><span style={{ width: `${(v / maxDow) * 100}%` }} /></span>
          </div>
        ))}
      </div>

      <h3 className="h3">Inventory right now</h3>
      <p className="lede">Stock counts as of this morning, with the date each item was last received.</p>
      <dl className="strip" style={{ marginTop: 0 }}>
        <Cell t="Units on hand" v={num(onHand)} dl={{ cls: "flat", text: `across ${products.length} items` }} />
        <Cell t="Worth at retail" v={usd(atRetail)} dl={{ cls: "flat", text: "if it all sells" }} />
        <Cell t="Out of stock" v={String(out)} dl={{ cls: "down", text: "losing sales now" }} />
        <Cell t="Under 2 weeks" v={String(low)} dl={{ cls: "down", text: "reorder window" }} />
        {oldest && <Cell t="Longest on shelf" v={`${daysAgo(oldest.lastReceivedAt)} days`} dl={{ cls: "flat", text: oldest.name }} />}
      </dl>

      <h3 className="h3">By category</h3>
      <p className="lede">Revenue by category over the same period, biggest first.</p>
      <div>
        {catList.map(([k, c]) => {
          const dl = deltaOf(c.rev, c.prev);
          return (
            <div className="barrow" key={k}>
              <span className="n">{k}</span><span className="v">{usd(c.rev)}</span>
              <span className="b"><span style={{ width: `${(c.rev / topCat) * 100}%` }} /></span>
              <span className="s">
                {Math.round((c.rev / Math.max(1, now.rev)) * 100)}% of revenue · {num(c.units)} units · {c.n} items ·{" "}
                <span className={`delta ${dl.cls}`} style={{ display: "inline" }}>{dl.text}</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="src"><b>Where this comes from.</b> Sales, timestamps and refunds: Square orders. Stock counts and receipt dates: Square inventory. Names, categories, prices and unit costs: the Square item library. Storecasted computes everything else.</p>
    </section>
  );
}

/* ---------------- Products ---------------- */
type SortKey = "name" | "stock" | "vel" | "dts" | "recv" | "units" | "rev" | "ret" | "prof" | "margin";

function Products({ products, buckets, agg, snapshot }: {
  products: any[]; buckets: BucketsFn;
  agg: (items: any[], a: number, b: number) => { units: number; rev: number; prof: number };
  snapshot: StoreSnapshot;
}) {
  const [tf, setTf] = useState<TF>("day");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "dts", dir: 1 });
  const [open, setOpen] = useState<string | null>(null);

  const bars = buckets(tf).bars;
  const a = bars[0]!.a, b = bars[bars.length - 1]!.b;
  const daysAgo = (iso: string | null) => iso ? Math.round((isoToDate(snapshot.asOf).getTime() - isoToDate(iso).getTime()) / 86_400_000) : 9999;

  const rows = products.map((p) => {
    const g = agg([p], a, b);
    return {
      p, name: p.name as string, stock: p.stock as number, vel: p.vel as number,
      dts: p.stock === 0 ? -1 : p.dts ?? 9999, recv: daysAgo(p.lastReceivedAt), ret: p.returns as number,
      units: g.units, rev: g.rev,
      prof: p.unitCostCents != null ? g.prof : null,
      margin: p.unitCostCents != null && g.rev ? (g.prof / g.rev) * 100 : null,
      series: bars.map((k) => agg([p], k.a, k.b).units),
    };
  }).sort((x, y) => {
    const vx = x[sort.k], vy = y[sort.k];
    if (typeof vx === "string" && typeof vy === "string") return sort.dir * vx.localeCompare(vy);
    if (vx == null) return 1;
    if (vy == null) return -1;
    return sort.dir * ((vx as number) - (vy as number));
  });

  const stateOf = (p: any) => {
    if (p.stock === 0) return "var(--red)";
    const d = p.dts ?? 999;
    return d <= 7 ? "var(--red)" : d <= 21 ? "var(--amber)" : p.vel < 0.4 ? "var(--ink-2)" : "var(--green)";
  };
  const th = (k: SortKey, label: string, cls = "num") => (
    <th className={cls} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : undefined}
      onClick={() => setSort((s) => (s.k === k ? { k, dir: (s.dir * -1) as 1 | -1 } : { k, dir: k === "name" ? 1 : -1 }))}>
      {label}
    </th>
  );

  return (
    <section>
      <h2 className="h2">Products</h2>
      <p className="lede">Every item. Tap a row for its history, tap a heading to sort.</p>
      <div className="controls">
        <Seg label="Time period" value={tf} onChange={setTf}
          options={[["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]]} />
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {th("name", "Item", "")}{th("stock", "On shelf")}{th("vel", "Selling")}{th("dts", "Runs out")}
              {th("recv", "Received")}<th className="num">History</th>{th("units", "Units")}{th("rev", "Revenue")}
              {th("ret", "Returned")}{th("prof", "Profit")}{th("margin", "Margin")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const color = stateOf(r.p);
              const runs = r.stock === 0 ? "Out of stock" : r.dts > 120 ? "Months away" : `${Math.round(r.dts)} days`;
              const soon = r.stock === 0 || r.dts <= 7;
              const isOpen = open === r.name;
              return [
                <tr className="row" key={r.name} onClick={() => setOpen(isOpen ? null : r.name)}>
                  <td className="name">
                    <span className="nm">
                      <span className="sq" style={{ background: color, marginTop: 0 }} />
                      <span>{r.name}
                        <span className="sub-l">
                          {r.p.category} · {price(r.p.priceCents)} ·{" "}
                          {r.p.unitCostCents != null ? `costs ${price(r.p.unitCostCents)}` : <span className="muted">no cost set</span>}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{r.stock}</td>
                  <td className="num">{r.vel.toFixed(1)}/day</td>
                  <td className={`num${soon ? " red" : ""}`} style={{ fontWeight: 700 }}>{runs}</td>
                  <td className="num">{r.p.lastReceivedAt ? fmtDate(isoToDate(r.p.lastReceivedAt), { month: "short", day: "numeric" }) : "—"}</td>
                  <td className="num"><Bars values={r.series} color={color} height={23} className="spark" /></td>
                  <td className="num">{num(r.units)}</td>
                  <td className="num">{usd(r.rev)}</td>
                  <td className="num">{r.ret || "—"}</td>
                  <td className="num">{r.prof != null ? usd(r.prof) : <span className="muted">—</span>}</td>
                  <td className="num">{r.margin != null ? `${r.margin.toFixed(0)}%` : <span className="muted">—</span>}</td>
                </tr>,
                isOpen && (
                  <tr className="drawer" key={r.name + "-d"}>
                    <td colSpan={11}>
                      <dl className="figs">
                        <div className="fig"><dt>On the shelf</dt><dd>{r.stock}</dd></div>
                        <div className="fig"><dt>Selling</dt><dd>{r.vel.toFixed(1)}/day</dd></div>
                        <div className="fig"><dt>Runs out in</dt><dd className={soon ? "red" : ""}>{runs}</dd></div>
                        <div className="fig"><dt>Revenue</dt><dd>{usd(r.rev)}</dd></div>
                        <div className="fig"><dt>Profit</dt><dd className={r.prof != null ? "green" : "muted"}>{r.prof != null ? usd(r.prof) : "—"}</dd></div>
                      </dl>
                      <Bars values={r.series} color={color} height={110} className="mini" />
                      <p className="note">
                        Units sold per period. Sells for {price(r.p.priceCents)}
                        {r.p.unitCostCents != null
                          ? `, costs ${price(r.p.unitCostCents)}, so each one earns ${price(r.p.priceCents - r.p.unitCostCents)}.`
                          : ". No unit cost in Square, so profit can't be worked out for this one."}
                      </p>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
