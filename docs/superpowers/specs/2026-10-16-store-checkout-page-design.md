# Store checkout page: Estori's own checkout, with Stripe Elements and an editable cart

Branch `feat/catalog-purchase-flow`, draft PR alastrat/vibesdk#12.

## 1. Purpose

Today a store's Checkout button sends the shopper to Stripe's hosted page, on `checkout.stripe.com`. The agent also writes
each store's own checkout page from scratch, and those pages differ, aren't tested, and can show invented money copy.

This spec replaces both:

- **Estori's own checkout page.** It lives on the store's own address, so the shopper never leaves the store. The page is
  the same for every store and carries each store's brand. Store code never runs on it.
- **The store's cart stays the store's.** Stores keep their own cart sidebar or page, written by the agent as today.
  They read and write one shared cart through `Estori.cart`, so edits made on the checkout page show up in the store.

### Owner decisions (2026-10-16)

- Stores keep their cart sidebar as generated (Fernwood's and Ember's drawers are the reference).
- The checkout page shows the cart, and the shopper can edit it there.
- The platform owns where the cart is stored (`Estori.cart`). Stores use it.
- Each store declares its brand in `estori-store.json`, and the checkout page and Stripe's fields use it.
- Payment fields are Stripe Elements, for full control of the layout, not Stripe's embedded Checkout form.
- The Elements run on a Checkout Session (`ui_mode: elements`), not on a bare PaymentIntent. Everything already built on
  the session stays: the seller as merchant of record, the fee, webhooks, order recording, expiry, disputes and refunds.
- The public site gets a Payments item in the Platform menu, with a page that explains the whole process. The pricing
  table gets the payment rules and the order limits.
- Overnight work, verified end to end, with example stores and a completed transaction of each type.

## 2. What the shopper sees

1. On the store, the shopper adds products. The store's own cart sidebar shows them, as today.
2. The store's Checkout button calls `Estori.checkout()`. The browser goes to `{store}/__estori/pay`, on the same
   address. No new tab is needed, even inside the editor preview.
3. The checkout page shows the store's logo and name at the top, and "Continue shopping" back to the store.
4. **Left column:** contact (email), shipping address, and payment, each a Stripe Element styled with the store's brand.
   A Pay button shows the total.
5. **Right column:** the order summary. Each line has its image, name, variant, a quantity stepper and Remove. Below
   them are the ship-to country, subtotal, shipping and total. On a phone, the summary comes first and collapses.
6. Editing the summary changes the shared cart. The page re-prices the order with Estori's pricing and starts a new
   Stripe session for it. The email and shipping address the shopper typed are kept.
7. After paying, Stripe sends the shopper to `/__estori/return`. That records the order and goes on to the store's
   confirmation page, as today. `Estori.order()` on that page clears the cart.

The page answers every refusal checkout already has with its message: a demo preview, payments not set up, an item sold
out, an order over the store's limit, a store paused at its weekly cap.

## 3. The store contract (`/__estori/store.js` and the skill)

`store.js` keeps `Estori.store()` and `Estori.order(orderId)`, and adds:

- `Estori.cart`:
  - `items()`: `[{ variantId, quantity }]`;
  - `add(variantId, quantity = 1)`, `setQuantity(variantId, quantity)` (0 removes), `remove(variantId)`, `clear()`;
  - `count()`: the number of units;
  - `shipTo()` and `setShipTo(country)`;
  - `onChange(listener)`: called when the cart changes, here or in another tab.
- The cart is stored in `localStorage` under a key that includes the store's base path. Stores share one origin on the
  preview domain, so each store must have its own cart.
- `Estori.checkout(request?)` goes to the checkout page. A request with `items` replaces the cart first, so stores
  written for the old contract keep working. `successPath` and `cancelPath` travel to the page.
- `Estori.order(orderId)` clears the cart once it reads the receipt.

The `store-checkout` skill changes to match:

- Build the cart UI any way that fits the store (sidebar, page or both), but keep its contents only through `Estori.cart`.
- Never build a checkout page, and never collect an address, email or card. The Checkout button only calls
  `Estori.checkout()`.
- Add the `brand` block to `estori-store.json`.
- Never write money copy that Estori doesn't do, such as "Taxes included" or a delivery promise, in the cart.

## 4. The checkout page (`GET {store}/__estori/pay`)

The page is HTML that the platform serves before the store's code runs, like the other `/__estori/*` paths. It is
authorized the same way: the preview's cookie or token.

- It loads `store.js` (for `Estori.cart`), Stripe.js and the store's info (`/__estori/store`, which now includes
  `brand`).
- It loads Stripe.js from `https://js.stripe.com/dahlia/stripe.js`, matching the account's API version, with the
  platform's publishable key (`STRIPE_PUBLISHABLE_KEY`).
- It sends a content security policy:
  - scripts only from itself and Stripe;
  - frames from Stripe;
  - connections to itself and Stripe;
  - fonts from Google Fonts;
  - images from itself and https;
  - `frame-ancestors 'self'`.
- **Starting checkout:** the page posts the cart to `POST /__estori/checkout`, as today. The answer now carries the
  session's `clientSecret`, the checkout id, and the priced summary (lines, subtotal, shipping, total).
- **Editing the cart:** after an edit, the page waits 400 ms for more edits, then posts again with `replaces` set to the
  current checkout id.
  - The server expires that checkout's Stripe session, if it's still open, and marks the checkout expired, so it no
    longer counts toward the weekly cap.
  - The page then starts Stripe's form again with the new client secret, and puts back the email and shipping address
    the shopper had typed.
- **Paying:** the page confirms through Stripe's checkout actions. Stripe redirects to `return_url`, which is
  `{store}/__estori/return?session_id={CHECKOUT_SESSION_ID}`, the same path as today.
- **Empty cart:** the page shows "Your cart is empty" and a link back to the store. It starts no session.
- **Framed preview:** Elements run inside the editor's preview frame. That frame gains `allow="payment"`, so wallets
  can work there.

## 5. Server changes

- **The Stripe client** sends `Stripe-Version: 2026-03-25.dahlia` on every request. That is the account's default
  today, so nothing changes, but it now can't shift under the code.
- **`createStoreCheckoutSession`** creates `ui_mode: elements` sessions:
  - `return_url` replaces `success_url` and `cancel_url`;
  - the card-only, no-Adaptive-Pricing and no-Link settings stay;
  - the answer's `client_secret` is required.
- **`expireCheckoutSession(sessionId)`** is new. An already-expired or completed session counts as done.
- **`startStoreCheckout`** answers `{ ok: true, checkoutId, clientSecret, summary }`.
  - A request may name the checkout it `replaces`.
  - A replaced checkout must belong to the same store and still be `creating` or `open`. Then it is expired, before the
    new checkout's weekly-cap check, so the replaced checkout doesn't count twice. A request naming any other checkout
    is refused as `invalid_request`.
- **The template checkout** is unchanged: hosted Stripe Checkout inside Estori's own app.

## 6. The brand block in `estori-store.json`

```json
"brand": {
  "name": "Ember Roasters",
  "logo": "/images/logo.svg",
  "colors": { "background": "#1a1210", "surface": "#241a17", "text": "#f5ede6", "accent": "#f59a46", "accentText": "#1a1210" },
  "font": "Fraunces",
  "corners": "rounded"
}
```

- `name` is required, up to 80 characters.
- `logo` is optional, under the same rules as product images.
- Colors are `#rrggbb`. `background`, `text` and `accent` are required. `surface` defaults to `background`, and
  `accentText` defaults to white or black, whichever reads better on `accent`.
- `font` is an optional Google Fonts family name: letters, digits and spaces, up to 40 characters. The page loads it
  from Google Fonts and gives Stripe's fields the same font. A name Google doesn't serve falls back to the system font.
- `corners` is `square`, `rounded` (the default) or `pill`. It sets the border radius of the page's boxes and Stripe's
  fields.
- Unknown fields are refused, as elsewhere in the file.
- A store without `brand` gets a neutral look. It is optional, so existing stores keep working.

## 7. Public site

- **Platform menu:** a new **Payments** item, at `/platform/payments`, marked coming soon. Store payments run in test
  mode on previews today, and live stores aren't open yet.
- **The Payments page** uses the same layout as the other platform pages (hero, two card sections, how it works, FAQ,
  closing). It explains:
  - **Checkout:** on the store's own address, cards and wallets, US dollars, the seller as merchant of record.
  - **Getting paid:** Stripe Connect; the seller accepts the selling terms, adds a verified bank account and turns on
    card payments; payout frequency and Stripe's account costs ($2 a month, and 0.25% + 25¢ a payout).
  - **Estori's fees:**
    - own products carry only the card processing cost;
    - catalog products carry the catalog price;
    - paid sites carry 7% + $0.60;
    - Estori pays no seller's fees.
  - **Refunds and disputes:** the seller pays them from their Stripe balance, then from later sales. A lost dispute adds
    Stripe's fee.
  - **Limits that grow:**
    - New sellers: largest order $150, $500 a week, payouts after 10 business days.
    - Established sellers: $500, $5,000 a week, 5 business days.
    - Established needs 30 days, 10 completed orders and a clean dispute record.
  - **Protection:** risky payments are held before Estori buys from a supplier. Items Estori can't ship are refunded.
  - **What's in each plan** (below).
- **Pricing table:** a "Payments" section:
  - checkout on your store;
  - Estori's fee on own products, catalog products and paid sites;
  - payout frequency;
  - largest order and weekly sales, by level;
  - payout delay, by level;
  - refunds and disputes;
  - delivery verification for own products (Premium, coming soon).

  The thresholds are the same on every plan, because levels set them, not plans. The table says so.
- **The FAQ fix:** "Does Estori take a cut of sales?" now says Estori adds nothing to the seller's own products beyond
  the card processing cost, and that catalog products include the catalog price. That matches the terms.
- **Copy rules:** the supplier-name and AI-assistant rules apply, and the fee label comes from `PLATFORM_FEE_LABEL`.

## 8. Testing and verification

- **Unit tests:**
  - the manifest's `brand` parsing;
  - the `Estori.cart` script, run under a fake `localStorage`;
  - the pay page's HTML (CSP, publishable key, no store script on it);
  - `startStoreCheckout` with `replaces`;
  - the Stripe client's elements session and expire calls;
  - the pricing rows;
  - the Payments page copy against the copy rules.
- **End to end** (localhost, Stripe test mode, supplier sandbox): two new stores built by the local agent from the
  updated skill, and one existing store, each paid through the new page, covering every transaction type:
  - own product only;
  - catalog product only (the supplier sandbox order placed);
  - mixed cart;
  - a cart edited on the checkout page;
  - a Brazilian card (the fee difference reversed);
  - an elevated-risk card (held, then released);
  - a seller refund;
  - a dispute lost (the fee collected from the next sale) and a dispute won (money returned);
  - a supplier rejection refunded;
  - a refusal for the order limit and one for the weekly cap.

## 9. Owner actions

- Set `STRIPE_PUBLISHABLE_KEY` (test, then live) in the Worker's settings. It's public, so it can be a plain variable.
- When live stores get their own domains, register each domain with Stripe for Apple Pay and Google Pay.

## 10. Not in this spec

- The template checkout's move to Elements.
- Coupons, tax and multiple shipping options.
- A cart saved across devices.
