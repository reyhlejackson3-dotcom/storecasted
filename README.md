# Storecasted

An AI store manager for independent retailers on Square. It reads the shop's
own Square data once a day and says what needs attention, in plain English,
before the owner has to go looking.

**Core promise:** You run your store. Storecasted watches it.

---

## What's here

The part that is hard to get right, and is fully tested:

| File | What it does | Tested |
|---|---|---|
| `src/lib/metrics.ts` | All arithmetic: velocity, days-to-stockout, revenue windows, profit coverage | ✅ |
| `src/lib/rules.ts` | Decides what is worth saying. Deterministic, no AI | ✅ |
| `src/lib/briefing/templates.ts` | Fixed sentences with real numbers dropped in | ✅ |
| `src/lib/briefing/narrate.ts` | The only model call, plus the guard that rejects invented numbers | ✅ |
| `src/lib/crypto.ts` | AES-256-GCM for Square tokens at rest | |
| `src/lib/square/client.ts` | OAuth, token refresh, scope-error detection | |
| `src/app/api/cron/daily/route.ts` | The daily job, wired end to end | |
| `supabase/schema.sql` | Tables, indexes, row-level security | |

`npm test` runs 21 tests covering the maths and the rules.

### Still to write

`src/lib/store-repo.ts` (`storesDueNow`, `loadSnapshot`, `saveBriefing`) and
`src/lib/square/sync.ts`, which turn Square API responses into a `StoreSnapshot`.
Both are I/O against real credentials, so build them against the Square sandbox
rather than from a spec. The `StoreSnapshot` type in `src/lib/types.ts` is the
contract they have to satisfy — everything downstream of it already works.

---

## The rule that holds this together

Numbers come from TypeScript. Language comes from templates. The model only
ever joins two facts into one sentence, and only when the rules engine says
those facts are one story.

The model **never** sees raw sales data, **never** decides what matters, and
**never** produces a number. `assertOnlyKnownNumbers` checks every figure in
its output against the facts it was given and throws the whole generation away
if one doesn't match — falling back to the template, which cannot be wrong.

This is a correctness decision, not a cost one. At Haiku 4.5 rates the model
costs roughly five cents per store per month; you could afford to run
everything through it. You just can't afford for it to be wrong once.

---

## Setup order

Do these in order. Each step is testable before the next one matters.

1. **Supabase.** New project → SQL editor → paste `supabase/schema.sql`.
   Copy the project URL, anon key, and service-role key.
2. **Square.** [Developer console](https://developer.squareup.com/apps) → new
   application. Copy the Application ID and Application Secret. Add
   `{APP_BASE_URL}/api/square/callback` as a redirect URL. Stay in **sandbox**
   until the whole loop works.
3. **Encryption key.** `openssl rand -base64 32` → `SQUARE_TOKEN_ENCRYPTION_KEY`.
4. **Anthropic.** API key → `ANTHROPIC_API_KEY`. Leave `ANTHROPIC_MODEL` as
   `claude-haiku-4-5`.
5. **Stripe.** Create a $50/month recurring price, copy its ID. Copy the secret
   key. The webhook secret comes later, after you deploy.
6. **Vercel.** Import the repo, paste every variable from `.env.example`,
   deploy. `vercel.json` already registers the daily cron; Vercel sends
   `CRON_SECRET` as a bearer token, and the route rejects anything else.

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
screen, and "this app can adjust your inventory" is the sentence that loses
the signup at the final click.

## Two Square behaviours to handle on day one

- **Only the business owner can authorize.** An employee login gets an error.
  Say so on the connect screen or you will lose managers at the last step.
- **Scopes can vanish from a working connection.** Square returns
  `INSUFFICIENT_SCOPES`; set `stores.square_needs_reconnect` and prompt. A
  briefing that silently stops appearing is worse than one that never did.

## What Square does not give you

No supplier lead times, no foot traffic, no reason a thing stopped selling.
The reorder alert therefore uses `restockCycleDays` — how long the *last*
restock lasted, from the receipt date to the projected stockout. Real data,
no guessing, no extra onboarding question.

Unit cost is readable for any seller but only settable on Square for Retail
Plus/Premium or Restaurants Plus/Premium, and plenty of sellers leave it blank.
Profit therefore covers only the items that have one, and
`StoreMetrics.profitCoverage` is the share of revenue that represents. Show it.
Never estimate a missing cost.
