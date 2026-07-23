# Taana Baana — Store Backend

A working cart → checkout → payment → order flow behind the animated India-map
site, built in the order we discussed: **catalog → cart/checkout → payments →
confirmation emails → admin view**. Shipping/logistics integration is deliberately
left for the next step (see bottom of this file).

## What's actually in here

- **Express** server (`server.js`) serving a JSON API + the static frontend
- **SQLite** database (`better-sqlite3`) — zero setup, single file, good enough
  until you have real concurrent traffic, at which point swap for Postgres
- **88 real products** — every craft from every state, migrated out of the old
  hardcoded `STATE_DATA` object into `products`/`states` tables, with a
  deterministic placeholder price and stock count per item (see `data/pricing.js`)
- **Cart** — session-cookie based, in-memory (see the note in `data/cart.js`
  about what changes if you ever run more than one server instance)
- **Checkout** — works in two modes, auto-selected by whether `STRIPE_SECRET_KEY`
  is set:
  - **Demo/mock mode** (no key): the "payment" succeeds instantly so you can
    test the whole flow — cart, order creation, stock decrement, confirmation
    email — without a Stripe account at all.
  - **Stripe test mode** (test key set): creates a real Stripe Checkout
    Session and redirects there. Use Stripe's test card `4242 4242 4242 4242`,
    any future expiry, any CVC.
- **Order confirmation emails** — logged to the console if no SMTP is
  configured, sent for real via `nodemailer` if it is
- **Admin dashboard** (`/admin.html`) — order list with status updates
  (pending → paid → packed → shipped → delivered), plus a stock view.
  Protected by HTTP Basic Auth (`ADMIN_USER`/`ADMIN_PASSWORD` in `.env`).

## Running it

```bash
cd store
npm install
cp .env.example .env      # defaults work as-is for demo mode
npm start
```

Then open **http://localhost:3000**. The database is created and seeded
automatically on first run (`data/store.db`).

To reset the catalog/orders, just delete `data/store.db*` and restart.

## Turning on real Stripe test-mode payments

1. Create a free Stripe account, grab your **test** secret key from
   https://dashboard.stripe.com/test/apikeys (starts with `sk_test_`)
2. Put it in `.env` as `STRIPE_SECRET_KEY`
3. Restart the server — the console will say `Payment mode: Stripe`
4. Checkout now redirects to a real (test-mode) Stripe Checkout page
5. To also handle the webhook properly (recommended — it's what confirms
   payment if the customer closes the tab before returning), install the
   Stripe CLI and run:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Copy the webhook signing secret it prints into `STRIPE_WEBHOOK_SECRET` in `.env`.

Without step 5, the success page still works — it falls back to verifying
the session directly with Stripe when the customer lands on it — but the
webhook is the reliable path in production.

## Turning on real order confirmation emails

Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` etc. in `.env`. Any standard SMTP
provider works (Postmark, SendGrid, Amazon SES, even Gmail with an app
password for testing). Until then, emails just print to the server console.

## Project structure

```
store/
  server.js              # wires everything together
  data/
    db.js                # schema + seed (runs automatically)
    geo/india-states.geojson  # India states/UTs boundaries (source: Bharatlas LGD 2024) — source of truth for region ids
    statedata.module.js   # generated from frontend-src/statedata.js — do not hand-edit, run `npm run build:frontend` to regenerate
    pricing.js            # deterministic placeholder pricing/stock/weight
    shipping.js            # Shiprocket rate quotes (mock estimate if no credentials set)
    cart.js               # in-memory session cart
    email.js               # confirmation email sender (or console log)
  frontend-src/
    index.template.html   # source template — the live MapLibre terrain map lives in the hero
    statedata.js           # craft/product content per region, keyed by id (source of truth)
    build.js               # builds public/index.html + copies data/geo/ into public/geo/
  routes/
    products.js, cart.js, checkout.js, stripeWebhook.js, admin.js, shipping.js
  public/
    index.html            # built from frontend-src/ — do not hand-edit, rebuild instead
    geo/india-states.geojson  # built copy, fetched client-side by the live map
    success.html, cart-cancelled.html
    admin.html             # order + stock dashboard
```

## Known limitations (by design, for this stage)

- **Cart is in-memory** — restarting the server clears everyone's cart. Fine
  for now; move to a `carts` DB table or Redis before real traffic.
- **Prices are placeholders**, generated from category + item name so they're
  stable across restarts — go through `data/pricing.js` / the products table
  and set real per-artisan pricing before going live.
- **No customer accounts** — checkout is guest-only. Add one if you want order
  history / repeat customers.
- **Admin auth is HTTP Basic Auth** with one shared password — fine for you
  personally, not for a team. Swap for real auth before adding staff.
- **No tax/duty calculation** — international export tax handling (GST
  zero-rating, destination country duties) isn't in here yet.

## Suggested next step: shipping & export logistics

This is the piece we deliberately deferred. When you're ready:
- Decide who calculates shipping cost — a courier API (DHL/FedEx/Aramex) or
  an aggregator like Shiprocket that has export support built in
- Add real package weights/dimensions to each product (needed for accurate
  rate quotes)
- Get an **IEC (Import Export Code)** from DGFT if you don't have one yet —
  it's mandatory to legally export from India
- Add correct **HS codes** per product category for customs paperwork

Happy to build the shipping-rate step next, the same way — real integration,
tested end-to-end — whenever you're ready for it.
