import Link from "next/link";
import { OrderCallout } from "./App";
import { demoSnapshot } from "@/lib/demo";
import { buildBriefing } from "@/lib/briefing/build";

/**
 * The front page. The briefing preview below isn't a screenshot — it's the
 * real engine running on the demo store, so this page and /demo can never
 * disagree with each other.
 */
export const revalidate = 3600;

const SEV = { attention: "Needs attention", watch: "Worth watching", opportunity: "Opportunity" } as const;

export default function Home() {
  const { briefing, alsoNoticed } = buildBriefing(demoSnapshot());
  // Lead with the cards that show a specific order quantity — that's the
  // thing no dashboard gives you. Still 100% real engine output.
  const hasOrder = (f: Record<string, string | number>) => f["order_units"] !== undefined || Number(f["order_count"] ?? 0) > 0;
  const all = [...briefing, ...alsoNoticed];
  const ordered = [...all.filter((b) => hasOrder(b.facts)), ...all.filter((b) => !hasOrder(b.facts))];
  const hero = ordered.find((b) => b.kind === "stockout_imminent") ?? ordered[0];
  const rest = ordered.filter((b) => b !== hero).slice(0, 2);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-in lp-nav-in">
          <Link href="/"><img className="wordmark" src="/logo-white.png" alt="Storecasted" /></Link>
          <nav className="lp-links">
            <Link href="/demo" className="lp-link lp-hide-sm">Demo</Link>
            <Link href="/login" className="lp-link">Sign in</Link>
            <Link href="/login?mode=signup" className="btn btn-top">Sign up free</Link>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-in lp-hero-grid">
          <div>
          <p className="dateline">For independent shops on Square</p>
          <h1 className="lp-h1">You run your store. Storecasted watches it.</h1>
          <p className="lp-lede">
            Every morning, a short briefing on what needs you: what&apos;s about to run out, exactly how many
            to order, and what&apos;s suddenly selling. No reports to dig through. No questions to ask.
          </p>
          <div className="lp-ctas">
            <Link href="/demo" className="btn lp-btn-big">View the demo</Link>
            <Link href="/login?mode=signup" className="lp-ghost">Sign up free →</Link>
          </div>
          </div>
          {hero && (
            <div className="lp-hero-card">
              <p className="lp-eyebrow" style={{ marginBottom: 12 }}>Live from our demo shop</p>
              <article className="lp-card lp-card-hero">
                <p className={`pill ${hero.severity}`}>{SEV[hero.severity]}</p>
                <h2 className="headline">{hero.headline}</h2>
                <OrderCallout facts={hero.facts} />
              </article>
            </div>
          )}
        </div>
      </section>

      <section className="lp-preview">
        <div className="lp-in">
          <p className="lp-eyebrow">More from this morning&apos;s briefing — generated live, not a screenshot</p>
          {rest.map((b, i) => (
            <article className="lp-card" key={i}>
              <p className={`pill ${b.severity}`}>{SEV[b.severity]}</p>
              <h2 className="headline">{b.headline}</h2>
              <p className="action">{b.action}</p>
              <div style={{ marginTop: 18 }}><OrderCallout facts={b.facts} /></div>
            </article>
          ))}
          <Link href="/demo" className="lp-more">See the full demo — dashboard, products and all →</Link>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-in">
          <h2 className="lp-h2">How it works</h2>
          <ol className="lp-steps">
            <li><span className="lp-num">1</span><div><h3>Connect Square</h3><p>One click, on Square&apos;s own sign-in page. Storecasted can only read — it can&apos;t change anything in your account.</p></div></li>
            <li><span className="lp-num">2</span><div><h3>We read your shop every night</h3><p>Sales, stock counts, restock history and returns. Every number comes straight from your Square data.</p></div></li>
            <li><span className="lp-num">3</span><div><h3>Your briefing is ready by morning</h3><p>The few things that actually need you, in plain English — with the numbers to back each one up.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="lp-section lp-alt">
        <div className="lp-in">
          <h2 className="lp-h2">What it catches</h2>
          <div className="lp-grid">
            <div className="lp-feat"><h3>Exactly what to order</h3><p>Not &ldquo;you&apos;re running low&rdquo; — &ldquo;order 70 now,&rdquo; with what it&apos;ll cost you and how long it&apos;ll last.</p></div>
            <div className="lp-feat"><h3>Lost sales from empty shelves</h3><p>What&apos;s out of stock and how much it was bringing in before it ran out.</p></div>
            <div className="lp-feat"><h3>What&apos;s suddenly selling</h3><p>Items picking up speed, so you can put them where people will see them.</p></div>
            <div className="lp-feat"><h3>What you&apos;d never notice</h3><p>Fewer customers spending more each. An item that keeps coming back as returns. Stock that hasn&apos;t moved in months.</p></div>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-in lp-two">
          <div>
            <h2 className="lp-h2">Numbers you can trust</h2>
            <p className="lp-p">Every figure is worked out from your own Square data before a single word is written. The sentences are built around those numbers, never the other way round — so nothing gets guessed, rounded wrong, or made up.</p>
          </div>
          <div>
            <h2 className="lp-h2">Read-only, always</h2>
            <p className="lp-p">Storecasted never changes a price, adjusts your stock or places an order. It watches and tells you. You decide.</p>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-in">
          <p className="dateline" style={{ color: "var(--amber)" }}>Free during early access</p>
          <h2 className="lp-h1" style={{ color: "#fffbf5", maxWidth: "14ch" }}>See what your shop has been trying to tell you.</h2>
          <div className="lp-ctas">
            <Link href="/login?mode=signup" className="btn lp-btn-big">Sign up free</Link>
            <Link href="/demo" className="lp-ghost lp-ghost-dark">View the demo →</Link>
          </div>
          <p className="lp-fine">No card needed. Works with Square.</p>
        </div>
      </section>

      <footer className="lp-foot"><div className="lp-in">© {new Date().getFullYear()} Storecasted · Shiftable LLC</div></footer>
    </div>
  );
}
