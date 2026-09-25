# Storecasted

An AI store manager for independent retailers on Square. It reads the shop's
own Square data once a day and says what needs attention, in plain English,
before the owner has to go looking.

**Core promise:** You run your store. Storecasted watches it.

---

## What's here

The part that is hard to get right, and is fully tested. `npm test` runs 28
tests covering the maths, the rules and the config.

| File | What it does | Tested |
|---|---|---|
| `src/lib/metrics.ts` | All arithmetic: velocity, days-to-stockout, revenue windows, profit coverage | yes |
| `src/lib/rules.ts` | Decides what is worth saying. Deterministic, no AI | yes |
| `src/lib/briefing/templates.ts` | Fixed sentences with real numbers dropped in | yes |
| `src/lib/briefing/narrate.ts` | The one model call, plus the guard that rejects invented numbers | yes |
| `src/lib/env.ts` | Eight required variables, validated. Everything else derived | yes |
| `src/lib/crypto.ts` | AES-256-GCM for Square tokens at rest | |
| `src/lib/square/client.ts` | OAuth, token refresh, scope-error detection | |
| `src/app/api/cron/daily/route.ts` | The daily job, wired end to end | |
| `supabase/schema.sql` | Five tables, indexes, row-level security | |

### Still to write

`src/lib/store-repo.ts` (`storesDueNow`, `loadSnapshot`, `saveBriefing`) and
`src/lib/square/sync.ts`, which turn Square API responses into a
`StoreSnapshot`. Both are I/O against real credentials, so build them against
the Square sandbox rather than from a spec. The `StoreSnapshot` type in
`src/lib/types.ts` is the contract they have to satisfy — everything
downstream of it already works and is tested.

---

## The rule that holds this together

Numbers come from TypeScript. Language comes from templates. The model only
joins two facts into one sentence, and only when the rules engine says those
facts are one story.

The model **never** sees raw sales data, **never** decides what matters, and
**never** produces a number. `assertOnlyKnownNumbers` checks every figure in
its output against the facts it was given and throws the whole generation away
if one doesn't match — falling back to the template, which cannot be wrong.

This is a correctness decision, not a cost one. At Haiku 4.5 rates the model
costs roughly five cents per store per month; you could afford to run
everything through it. You just can't afford for it to be wrong once.

---

## Setup, in the order you're doing it

### 1. GitHub

```bash
git init && git add -A && git commit -m "Storecasted: core logic + tests"
gh repo create storecasted --private --source=. --push
```

`.gitignore` already excludes `.env`, `node_modules` and `.next`.

### 2. Keys — eight of them

Five are copy-paste from two dashboards. Two you generate. One you have.

| Variable | Where |
|---|---|
| `SQUARE_APPLICATION_ID` | developer.squareup.com/apps, your app, Credentials, **Sandbox** |
| `SQUARE_APPLICATION_SECRET` | same page |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project, Settings, API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, the *other* one |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SQUARE_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |

```bash
cp .env.example .env    # fill it in
npm install
npm run check-env       # tells you exactly what's missing or wrong
```

`check-env` also prints the Square redirect URL to register, and confirms
whether you're pointed at sandbox or production.

**Set `SQUARE_TOKEN_ENCRYPTION_KEY` once and never change it.** Every stored
merchant token is encrypted with it. Rotate it and every connected shop
silently breaks with no way back — they all have to reconnect.

### 3. Supabase

New project, SQL editor, paste `supabase/schema.sql`, run. That's the whole
database. Then paste the three Supabase values into `.env` and run
`npm run check-env` again.

### 4. Vercel, when you're ready

Import the repo, paste the same eight variables, deploy. `vercel.json` already
registers the daily cron, and Vercel sends `CRON_SECRET` as a bearer token that
the route checks.

### What's derived instead of configured

| Used to be a variable | Now |
|---|---|
| `SQUARE_ENVIRONMENT` | Read from the `sandbox-` prefix on the application ID |
| `ANTHROPIC_MODEL` | Pinned in `src/lib/env.ts`. Changing models is a deploy |
| `APP_BASE_URL` | Vercel's deploy host, localhost in dev. Optional override |
| `STRIPE_*` (three of them) | Not in v1, see below |

### Billing is manual until it hurts

The trial is 14 days with no card, so Stripe does nothing for the first two
weeks of every customer's life, and there are no customers yet. For the first
ten, email a Stripe payment link at trial end and flip
`stores.subscription_status` to `active` by hand. Ten minutes of your time in
total, and it removes three variables, a webhook endpoint, and a deploy-order
problem. Add real subscriptions when doing it by hand becomes annoying.

### Build order

Get the "Connect Square" button working end to end before writing a line of
analytics. Then the template briefing. Then, only once the templates produce
something genuinely useful, add the model call.

---

## Square scopes

Four, all read:

```
ORDERS_READ  ITEMS_READ  INVENTORY_READ  MERCHANT_PROFILE_READ
```

Do not add a `_WRITE` scope. The merchant sees every scope on the consent
screen, and "this app can adjust your inventory" is the sentence that loses the
signup at the final click.

## Two Square behaviours to handle on day one

- **Only the business owner can authorize.** An employee login gets an error.
  Say so on the connect screen or you will lose managers at the last step.
- **Scopes can vanish from a working connection.** Square returns
  `INSUFFICIENT_SCOPES`; set `stores.square_needs_reconnect` and prompt. A
  briefing that silently stops appearing is worse than one that never did.

## What Square does not give you

No supplier lead times, no foot traffic, no reason a thing stopped selling.
The reorder alert therefore uses `restockCycleDays` — how long the *last*
restock lasted, from the receipt date to the projected stockout. Real data, no
guessing, no extra onboarding question.

Unit cost is readable for any seller but only settable on Square for Retail
Plus/Premium or Restaurants Plus/Premium, and plenty of sellers leave it blank.
Profit therefore covers only the items that have one, and
`StoreMetrics.profitCoverage` is the share of revenue that represents. Show it.
Never estimate a missing cost.
