# Shopper checkout in generated stores — design

Status: written on 2026-10-15 for the owner's review; not approved. Decisions only the owner can make are in the last
section, each with a recommendation. Everything else is decided here.

## Context

Shoppers will pay a seller's store through Estori's Stripe Connect. The approved catalog spec
(`2026-10-15-catalog-order-payments-design.md`) depends on this one: it takes its application fee from the payment
designed here.

What the code does today:

- **Stores invent their own commerce.** The agent has no commerce skill (`worker/agents/think/skills/` holds file-layout
  and design skills only). Each generated store writes its own catalog, cart, fake checkout and orders table into its
  App Facet's SQLite. No money moves, and the public FAQ says so (`src/components/public-site/PublicFaq.tsx`).
- **Stores run only as SpaceDO previews.**
  - `servePreview` (`space/src/space/durable-object.ts`) loads the committed bundle with Worker Loader, wraps the
    seller's `App` class in platform code (`space/src/space/inspector-wrapper.ts`), and hosts it as Facet
    `app:<branch>` with its own SQLite.
  - Production has no dispatch namespace (`wrangler.estori.jsonc`), so the Workers for Platforms path in
    `worker/services/deployer/think-user-deploy.ts` is unused on estori.app.
- **Previews share one origin.** Every preview is served from `preview.estori.app/space/<appId>/preview/<branch>/`
  behind 30-minute signed tokens (`worker/utils/spacePreviewToken.ts`, `worker/api/handlers/space-preview.ts`).
  - Discover shows public previews under the `public-preview` subject.
  - No store has a stable public address yet.
- **Any branch can be deployed.** The agent's `deploy_space` tool (`worker/agents/think/deploy-tool.ts`) deploys any
  branch name, and the deploy engine checks that branch out (`readBranchFiles` in `space/src/space/deploy-engine.ts`).
- **Stripe Connect already pays template sellers.**
  - The client is `worker/services/payments/stripe-client.ts`: Express accounts, destination charges with
    `application_fee_amount` and `transfer_data.destination`, and 35-minute sessions. It sends no `Stripe-Version`
    header today.
  - Onboarding is `worker/api/controllers/payments/connectController.ts`, and the webhook is
    `worker/api/controllers/payments/webhook.ts`.
  - Each purchase is recorded once through a unique session id (`template_purchases` in `worker/database/schema.ts`).

## Scope

This is too big for one spec, so the work is split into three pieces:

1. **Store payments (this spec):**
   - the trust boundary and the price authority;
   - the checkout API and the shopper flow;
   - order recording;
   - refunds and disputes for the seller's own products;
   - agent changes and the migration of existing stores.
2. **Live stores (prerequisite, separate spec).** A stable public address per store on its own origin, going live and
   offline, plan limits and suspension. Section 8 lists exactly what this spec needs from it.
3. **Catalog order payments (approved).** It builds on this spec. Catalog lines are designed in here but refused until
   the catalog ships.

Not at launch:

- discounts and coupons;
- subscriptions;
- stock tracking;
- tax calculation (owner decision 11);
- currencies other than US dollars;
- shopper accounts;
- payments in stores deployed to a seller's own Cloudflare account.

## Goals

- A shopper pays a live store by card. The seller receives the payment through their Express account, and Estori never
  holds their money.
- Generated code cannot change what a shopper pays, Estori's fee, who receives the money, or any line-item price.
- Each paid order is recorded once in Estori's records and once in the store's own database.
- Refunds and disputes each have one defined outcome.
- Store payments never touch AI credits. Checkout endpoints do no credit metering, and shopper traffic costs the seller
  no credits.

## 1. The trust boundary

### Who is trusted for money

| Component | Trusted | Why |
|---|---|---|
| Estori's worker (`worker/`) | Yes | Platform code; holds the Stripe key and D1 |
| SpaceDO and the App wrapper (`space/`) | Yes | Platform code. Generated code runs only inside the wrapped Facet |
| Stripe (signed webhooks, API responses) | Yes | Signatures are verified, and sessions are re-read through Estori's own API calls |
| `estori-store.json` at a published commit, as Estori reads and validates it | Yes, for the seller's own prices | The seller is entitled to set their prices. Estori reads the file from git itself, never from a request |
| Generated store code (browser and App Facet) | No | AI-written and seller-editable |
| The shopper's browser | No | |
| Other stores | No | |

### The rule

A checkout request names only:

- variant ids and quantities;
- a ship-to country;
- return paths;
- an optional note.

Estori derives everything else:

- the amounts, from the price authority;
- the fee, from `applicationFeeCents(cart)`;
- the destination account, from the app's owner;
- the store, from the address the request arrived on.

A request that carries any other field (for example `amount`, `price`, `fee` or `account`) is rejected with 400, so a
mistaken store fails loudly instead of appearing to work.

### The price authority

- **One file.** The seller's prices live in `estori-store.json` at the repository root (schema in section 7).
- **Live stores.** The authority is the snapshot Estori takes when the store goes live:
  - Estori reads the file from the commit being published, through a SpaceDO RPC, validates it, and stores it in D1
    `store_versions`.
  - Checkout prices from that row only.
  - Editing the file or the store's code changes nothing for shoppers until the seller publishes again.
- **Previews.** The authority is the file in the deployed preview commit, which SpaceDO records at deploy time.
  Previews never take money (section 2).
- **Catalog prices never come from the file.** The file names a catalog variant id, and the locked catalog price comes
  from the catalog service when checkout starts.
- **One source for shown and charged prices.** The store displays prices from the same file, either imported in server
  code or read in the browser with `Estori.store()`.

Why a file in git rather than a product table edited through Estori:

- the agent already writes files;
- restore points and rollback cover prices together with the code that shows them;
- a published version is immutable;
- launching needs no new product editor.

The cost is that price changes on a live store need a publish (owner decision 6).

### How a store reaches the platform

- **Platform-owned paths.** The platform owns every path under `/__estori/` on a store's address.
  - The worker handles these paths before the request reaches SpaceDO, static assets or the App Facet.
  - Matching uses the decoded, lower-cased path. Every `/__estori` path is answered by the platform (404 when unknown)
    and is never forwarded.
  - A store file or route under that path is unreachable, and the deploy tool warns about it (section 5).
- **The store's identity is its address.**
  - On a live store origin, routing resolves the host to an app id.
  - On a preview, the identity comes from the verified preview token's `spaceName` and `branch`.
  - It never comes from the request body.
- **One platform script.** The store loads `<script src="/__estori/store.js"></script>`. The preview HTML rewriter
  already prefixes root-relative `src` attributes, so the tag works in previews and live stores alike. The script finds
  its base path from its own URL and exposes:
  - `Estori.store()`: products, ship-to countries, the shipping rule, `mode` (`test` or `live`) and
    `paymentsAvailable`;
  - `Estori.checkout(request)`: starts a checkout and navigates to it, or resolves with `{ ok: false, reason, message }`.
    When the page is framed on a live store, it opens Checkout in a new tab, because Stripe Checkout can't be framed;
  - `Estori.order(orderId)`: the shopper's receipt for an order placed in this browser.
- **No binding into the Dynamic Worker.** The App Facet keeps its current empty `env`, so no capability is handed to
  generated code. Server-side store code never needs to start a checkout.
- **No writes from generated code.** The store origin exposes only reads (store data and the shopper's own receipts)
  plus "start a checkout".
  - Refunds, fulfillment and every other order change are Estori API calls on estori.app by the signed-in seller.

### The reserved `live` branch

- The `live` branch is reserved for the live store:
  - `deploy_space` refuses it;
  - `SpaceDO.deploy` refuses it;
  - the database inspector's wipe refuses it.
- Only `SpaceDO.publishLive(commit)` (Live stores spec) moves and deploys `live`, without changing the working tree's
  current branch.
- Why: deploying a branch checks it out today, so an agent deploy of `live` would make every later agent commit land on
  the live store. Money would still be safe, because pricing reads D1, but the live code would drift from the published
  version.

### Protections on `POST /__estori/checkout`

- **Request shape:** `Content-Type: application/json`, an `Origin` equal to the store's origin (the preview origin on
  previews), and a body of at most 16 KB.
- **Rate limits:** a new limiter in `worker/services/rate-limit/` allows 10 checkouts a minute per IP per store and 120
  a minute per store. Both values live in `worker/services/rate-limit/config.ts`.
- **Cart limits:**
  - at most 50 lines;
  - quantities from 1 to 99;
  - a total of at least 50¢, which is Stripe's minimum;
  - a total of at most $10,000 (`STORE_CART_MAX_CENTS`, a fraud cap).
- **Return paths.** `successPath` and `cancelPath`:
  - start with `/` and not `//`;
  - contain no backslash and no control characters;
  - are at most 200 characters;
  - are always joined to the store's origin, so they can't redirect elsewhere.

## 2. Store states and seller onboarding

### Which states take payments

| State | Checkout | Orders |
|---|---|---|
| Preview with a token minted for the owner (its subject is the owner's user id) | Test checkout on an Estori page, with no Stripe call | Test orders (`mode = test`) in D1 and the preview Facet |
| Preview opened by anyone else (Discover, shared links: the `public-preview` subject) | Refused: "This is a demo. Checkout works on the live store." | None |
| Live, payments ready | Real Stripe Checkout | Live orders |
| Live, payments paused | Refused (`payments_unavailable`) | Existing orders unaffected |
| Live store suspended or offline (Live stores spec) | Refused | Existing orders unaffected |
| Deployed to the seller's own Cloudflare account | No `/__estori/` paths, so no payments | None |

Payments are ready when all of these hold:

1. **Stripe is configured:** `STRIPE_SECRET_KEY` is set (`stripeFromEnv` in `worker/services/payments/config.ts`).
2. **The store is live and has products:** the live store's status is `live`, and its current version has a valid
   manifest with at least one product.
3. **The seller's account can take charges:** their Connect account has `charges_enabled` and an active `transfers`
   capability.
   - This is stricter than template sales, which need transfers only. Store charges use `on_behalf_of` (section 3),
     which needs the `card_payments` capability.
   - `createExpressAccount` already requests that capability.
4. **The seller's email is confirmed** (owner decision 9).

Freshness of the seller flags:

- **Checkout:**
  - uses the stored flags when `stripe_connect_accounts.updated_at` is under 10 minutes old;
  - otherwise refreshes them from Stripe, as `readySellerAccount(..., 'always')` does for template sales.
- **Why:** a busy store doesn't call Stripe on every click, and a lost capability is noticed within 10 minutes even if
  no `account.updated` event arrives.
- **Stripe's own refusal:** Stripe refuses an `on_behalf_of` session for an account without the capability. That error
  maps to `payments_unavailable`.
- **`Estori.store()`:** it reads stored flags only and never calls Stripe on a page view.

### Onboarding reuse

Sellers use the existing endpoints and one Express account per user, which pays out both template sales and store
sales. The changes:

- `GET /api/stripe/connect/status` adds `chargesEnabled` to `StripeConnectStatusData`
  (`worker/api/controllers/payments/types.ts`).
- The store's Payments card in the editor shows one of three states. The last two link to the existing onboarding
  endpoint, whose Account Link also collects new requirements:
  - "Taking payments";
  - "Finish Stripe setup";
  - "Stripe needs more information".
- `GET /api/stores/:appId/payments` tells the seller which readiness condition fails.
- Express accounts are created with country US, so only US sellers can take store payments at launch. This follows
  from the US-dollars-only decision.

### When an account loses `charges_enabled` or transfers

- **New checkouts:**
  - are refused with `payments_unavailable`;
  - `Estori.store()` reports `paymentsAvailable: false`, so the store can hide its button;
  - shoppers see "This store can't take payments right now", never the reason.
- **Open sessions:** sessions already created may fail at payment. Stripe shows the error to the shopper, and nothing
  is recorded.
- **Paid orders:** refunds and disputes on existing orders continue as normal.
- **Seller notice:**
  - The seller gets one email and an editor banner per change from ready to paused.
  - `StripeConnectService.updateFlags` compares the old and new flags and sets the new
    `stripe_connect_accounts.payments_paused_notified_at`.
  - It clears that column when payments are ready again.
- **A deleted account:** when Stripe no longer has the account, `forgetIfMissing` removes it as it does today, and the
  seller reads as not connected.

## 3. The shopper flow

1. **Cart.** The store keeps a list of `{ variantId, quantity }`, which can live in local storage, plus a ship-to
   country chosen from the store's `shipsTo` list. The prices it shows come from the manifest.
2. **Start.** `Estori.checkout({ items, shipTo, successPath, cancelPath, note })` sends `POST /__estori/checkout`.
3. **Estori prices and creates the session:**
   1. rate limit;
   2. parse;
   3. readiness;
   4. load the live version;
   5. `priceCart` (section 7);
   6. lock catalog prices (catalog spec; refused at launch);
   7. compute `applicationFeeCents(cart)`, and refuse a cart whose fee isn't below its total;
   8. insert `store_checkouts` with status `creating`;
   9. create the Checkout session with idempotency key `store-checkout-<checkoutId>`;
   10. store the session id and set status `open`;
   11. answer `{ ok: true, checkoutUrl }`; the script then navigates.
4. **Payment.** The shopper pays in Stripe Checkout on Estori's platform account. The seller is the settlement
   merchant, so the page and the card statement show the seller's business.
5. **Return.** After payment, Stripe redirects to `https://<store>/__estori/return?session_id={CHECKOUT_SESSION_ID}`.
   Estori then:
   1. retrieves the session;
   2. checks that `metadata.storeAppId` is this store;
   3. records the order with the same function as the webhook (section 4);
   4. adds the order id to the receipt cookie;
   5. answers 303 to `<successPath>?order=<orderId>`.

   A session that isn't paid yet redirects with `&status=processing`.
6. **Confirmation.** The store's confirmation page calls `Estori.order(orderId)`, which reads
   `GET /__estori/orders/<orderId>`.
7. **Cancel.** Stripe redirects to `<store><cancelPath>`. The checkout row stays `open` until
   `checkout.session.expired` marks it `expired`.
8. **Emails.** The shopper's confirmation and the seller's "new order" email are sent once, by whichever path recorded
   the order (owner decision 10).

### Checkout session parameters

| Parameter | Value |
|---|---|
| `mode` | `payment` |
| `line_items` | One per priced line: `price_data` with currency `usd`, `unit_amount` and `product_data.name` ("Product, Variant"), plus `images` from the manifest as absolute URLs on the store's origin |
| `shipping_address_collection.allowed_countries` | Exactly `[shipTo]`, so the country the catalog price was locked for can't change in Checkout |
| `shipping_options[0].shipping_rate_data` | `fixed_amount` with the priced shipping, labelled "Shipping", or "Free shipping" at 0 |
| `payment_method_types` | `['card']`, which includes Apple Pay and Google Pay. The fee covers card pricing only (owner decision 13) |
| `payment_intent_data.application_fee_amount` | `applicationFeeCents(cart)` |
| `payment_intent_data.on_behalf_of` | The seller's account (owner decision 1) |
| `payment_intent_data.transfer_data.destination` | The seller's account |
| `metadata` and `payment_intent_data.metadata` | `kind: 'store_order'`, `checkoutId`, `storeAppId`, `storeVersionId` |
| `client_reference_id` | `checkoutId` |
| `success_url` / `cancel_url` | As in steps 5 and 7 |
| `expires_at` | 35 minutes, as for template sales |

No promotion codes and no automatic tax at launch.

### Worked example (own products)

A cart of $40.00 with $6.00 shipping has `T = 4600` cents.

- The fee is `round(4600 × 2.9 / 100) + 30 = 133 + 30 = 163` cents.
- The seller receives 4437 cents.
- Stripe charges Estori its standard US card fee, about 163 cents, so Estori keeps nothing. This keeps the promise that
  only Stripe charges for card processing.

### Test checkout in previews (owner only)

- **Pricing.** The request and pricing are the same as live, against the preview commit's manifest, with no Stripe
  call.
- **Checkout row.** Estori stores the priced cart in `store_checkouts` with `mode = test`.
- **The test page.** Estori answers with `<preview base>/__estori/test-checkout/<checkoutId>`, an Estori page that:
  - lists the items, the shipping and the total;
  - shows the processing fee and what the seller would receive;
  - reads "Test order. No payment is taken.";
  - has "Place test order" and "Cancel".
- **Placing the order.** "Place test order" records a test order through the same recording function, with the
  customer "Test shopper" and no address. It then redirects as in step 5.
- **Isolation.** Test orders never reach Stripe and never count as sales. They show under a "Test orders" filter, and
  Estori keeps the latest 200 per app.

### Receipt cookie

- **Format.** `__estori_orders` is a JWT signed by Estori (`JWTUtils`, purpose `store_receipts`). It holds the app id
  and the shopper's 20 most recent order ids for that store.
- **Attributes:** `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, 90 days, with `Path` set to the store's
  `/__estori/` path.
- **Reading a receipt.** `GET /__estori/orders/<id>` answers only for an id in a valid cookie for this store. An order
  id leaked in a URL or Referer is useless without the cookie.
- **What a receipt shows:**
  - the order number and date;
  - the items;
  - the subtotal, shipping and total;
  - the status;
  - the ship-to city and country;
  - the shopper's email.

## 4. Order recording

### Estori's records (authoritative)

`recordStoreOrder(deps, session)` lives in `worker/services/store-payments/fulfill.ts`. It is a pure function with
injected dependencies, like `fulfillCheckoutSession`. It runs these steps:

1. **Is it ours?** It requires `metadata.kind === 'store_order'`, then loads `store_checkouts` by `metadata.checkoutId`.
   Anything else is `not-ours`.
2. **Is it paid?** `payment_status` must be `paid`, or the result is `not-paid`.
3. **Integrity:**
   - `amount_total` must equal the stored total;
   - the currency must be `usd`;
   - the app id must match.

   A mismatch can't happen with sessions Estori created. If one appears, the order is still recorded, because money was
   taken and refusing would hide it. Its `needs_attention` is set and admins are alerted.
4. **One D1 batch:**
   - insert `store_orders`. Its id derives from the checkout id, so retries reuse it. Its number is computed inside the
     insert as the store's highest number plus one, with a unique index on `(app_id, mode, order_number)` as the
     backstop;
   - insert the items;
   - mark the checkout `completed`.

   Every insert is `ON CONFLICT DO NOTHING` on the unique `checkout_id` and `stripe_checkout_session_id`. The result is
   `recorded` or `already-recorded`.
5. **Shopper details.** The name and email come from the session's `customer_details`, and the address from
   `collected_information.shipping_details`. The shipping country must equal the checkout's ship-to country, or the
   order gets `needs_attention`.
6. **After recording:**
   - Both outcomes enqueue the store's copy (below).
   - Only `recorded` sends the emails and hands catalog lines to the catalog spec's placement.

The webhook and the return handler both call `recordStoreOrder`.

- **The webhook uses the event only as a trigger.** It retrieves the session through the API, so the payload shape
  never depends on the endpoint's configured API version.
- **The client pins a version.** It gains a `Stripe-Version: 2025-08-27.basil` header on every call, as the 2026-10-12
  payments spec intended. Before release, a template sale is bought again in test mode under the pinned version.
- **Routing.** `dispatchStripeEvent` sends `checkout.session.completed` and `checkout.session.async_payment_succeeded`
  with `metadata.kind === 'store_order'` to `recordStoreOrder`. Other sessions keep the template path unchanged.
- **Retries.** A thrown error answers 500 so Stripe retries, and the unique indexes make retries safe.
- **Emails after the response.** `handleStripeWebhook` gains the execution context, so emails are sent after the
  response.

### The store's own records

The store keeps a copy for its own pages.

- **Tables.** Two platform-owned tables live in the App Facet's SQLite, `estori_orders` and `estori_order_items`.
  - `estori_orders`:
    - `id`, `number`, `mode`;
    - `payment_status`, `fulfillment_status`;
    - `currency`, `subtotal_cents`, `shipping_cents`, `total_cents`, `refunded_cents`;
    - `customer_name`, `customer_email`;
    - `ship_city`, `ship_region`, `ship_country`;
    - `note`, `tracking_number`, `carrier`;
    - `revision`, `created_at`, `updated_at`.
  - `estori_order_items`:
    - `order_id`, `line_no`;
    - `product_id`, `variant_id`, `name`;
    - `quantity`, `unit_price_cents`.
- **The only writer.** A new wrapper method, `__estoriUpsertOrder(order)` in `space/src/space/inspector-wrapper.ts`,
  writes them.
  - It creates the tables when they're missing.
  - It applies the order inside `transactionSync`, and only when `revision` is newer than the stored one.
  - The revision rises with every change: payment, refund, dispute or fulfillment. So late or repeated deliveries never
    roll an order back.
  - The wrapper is platform code that subclasses the seller's `App`, the same way the database inspector's methods are
    added today.
- **Delivery through a SpaceDO outbox.**
  - `SpaceDO.enqueueAppOrder(branch, order)` stores the record in a new `app_outbox` table, keyed by order id and
    keeping the highest revision, then returns.
  - Delivery runs right away. On failure it retries on a SpaceDO alarm after 1 minute, 5 minutes, 30 minutes, 2 hours
    and 6 hours, then every 12 hours for up to 3 days.
  - After that the entry is `failed`. It shows on the seller's Orders page ("Not yet in your store's database") and in
    the admin view.
  - Why an outbox and not Stripe's retries: a store whose code fails to load would make the webhook fail for days, and
    Stripe would eventually disable Estori's endpoint for every store.
- **Branches.** Live orders go to the `live` branch (Facet `app:live`). Test orders go to the preview branch they came
  from. The live and preview databases are separate.
- **No street address or phone** in the copy (owner decision 8). Sellers ship from Estori's Orders page.
- **Generated code reads, never writes.** If it does write, only its own copy changes. Money, refunds and the seller's
  Orders page all use D1.

### What the store's code must do

1. Load `/__estori/store.js` on every page that shows products, the cart or the confirmation.
2. Keep products and prices only in `estori-store.json`. Render them from that file (server import) or from
   `Estori.store()`, and never copy a price into code.
3. Keep the cart as variant ids and quantities, plus a ship-to country chosen from `shipsTo`.
4. Start checkout with `Estori.checkout(...)`. When it resolves with `ok: false`, show its `message`.
5. Show the confirmation at `successPath`: read `order` from the query string, call `Estori.order(order)`, show the
   receipt and clear the cart.
6. Read order history and in-store admin data from `estori_orders` and `estori_order_items`. Never write them, and never
   create tables named `estori_*`.
7. Never collect card details, never build a payment form, never call Stripe, and never compute an amount to charge.
8. Never define files or routes under `/__estori/`.
9. When `paymentsAvailable` is false, show "Checkout is unavailable right now" instead of the checkout button.

## 5. Agent and templates

### Agent changes

- **New skill.** `worker/agents/think/skills/store-checkout/SKILL.md` is registered in
  `worker/agents/think/skills.ts`. Its description triggers on stores, products, carts and checkout. It contains:
  - the manifest schema with an example;
  - the store code contract above;
  - test versus live behavior;
  - a working cart, checkout and confirmation example in plain JS.
- **`app-file-structure` skill:** one added paragraph says that `/__estori/`, `estori_*` tables and the `live` branch
  are reserved, and points to `store-checkout`.
- **`deploy_space` tool:**
  - refuses `live`;
  - after a deploy, reads `getStoreManifest(branch)`, runs `parseStoreManifest`, and returns errors and warnings in its
    result, so the model fixes them in the same turn. The warnings are:
    - a manifest exists but the script isn't referenced;
    - the files mention a cart or checkout but have no manifest;
    - there are files under `__estori/`.
- **`siteStartInstruction`** (`worker/agents/think/site-start.ts`) gains "Rewrite every product and price in
  `estori-store.json`" for copies of a store.
- **Catalog products.** The agent never writes catalog prices. It writes a `catalogVariantId` chosen through the
  catalog feature (catalog spec).

### Existing stores

- **Previews keep working.** Existing stores keep their own fake checkout in preview, and no money moves.
- **"Connect real checkout".** The editor offers it when the deployed files have no manifest and mention a cart or
  checkout.
  - It starts an agent turn with a hidden instruction, `storeCheckoutConversionInstruction()` in the new
    `worker/agents/think/store-checkout.ts`, built like `siteStartInstruction`.
  - The instruction tells the agent to:
    - move products and prices into `estori-store.json`;
    - include the script;
    - replace the fake checkout with `Estori.checkout`;
    - add the confirmation page;
    - read orders from `estori_orders`;
    - deploy.
  - The turn uses AI credits like any other change.
- **Old orders tables stay as they are.** They hold preview test data, and nothing migrates them.
- **Discover copies.**
  - A copy of a store that has a manifest keeps Estori checkout. Its personalization turn rewrites the products and
    prices.
  - A copy without one gets the editor's offer.
- **Going live doesn't scan code.** It doesn't block unconverted stores on heuristics, so a live store could still
  carry a fake checkout that takes no money. The mitigation is the editor offer, the deploy warnings, and the go-live
  warning from section 8.

## 6. Refunds and disputes (own products)

Catalog lines follow the catalog spec's rules. At launch every order is own products only.

### Refunds

- **The rule:**
  - The seller's share is reversed.
  - Estori keeps its application fee, which equals the card fee Stripe keeps on a refund.
  - So the seller bears card processing on a refunded sale, as any Stripe merchant does, and Estori neither gains nor
    loses.
- **From Estori.** The seller refunds the full amount or part of it, up to what remains, from the Orders page.
  - This calls `POST /api/stores/:appId/orders/:orderId/refunds` with `{ amountCents, requestId }`. Only the app's owner
    or an admin can call it.
  - Estori creates the refund with:
    - `payment_intent`;
    - `amount`;
    - `reverse_transfer: true`;
    - `refund_application_fee: false`;
    - metadata `estoriRefundRequestId`;
    - idempotency key `store-refund-<requestId>`.
  - The refund is recorded from the response.
- **From the Express Dashboard.**
  - This needs `on_behalf_of`: for destination charges without it, Stripe shows the seller a transfer with no refund
    action.
  - It also needs the dashboard features enabled (owner decision 7).
  - Estori learns of these refunds from `charge.refunded`.
- **Recording any refund:**
  1. On `charge.refunded`, Estori lists the charge's refunds through the API and upserts each into `store_refunds` by
     refund id.
  2. Each row's `initiated_by` is `estori` when the metadata carries an Estori request id, otherwise
     `express_dashboard`.
  3. Estori recomputes `refunded_cents` and the status (`partially_refunded` or `refunded`), raises the revision and
     enqueues the store's copy.
  4. The transfer reversal and the application fee refund are stored as Stripe reports them, so a dashboard refund
     that handles them differently is visible.
  5. A refund that fails (`charge.refund.updated` with status `failed`) is recorded. The order's totals are recomputed,
     and the seller is told.
- **The seller's balance.** A reversal can take the seller's Stripe balance negative. Stripe then debits their bank
  account, and with Express accounts Estori is liable for what can't be recovered.

### Disputes

On destination charges, with or without `on_behalf_of`, Stripe debits the disputed amount and the dispute fee from
Estori's platform balance.

| Event | Action |
|---|---|
| `charge.dispute.created` | Estori:<br>1. retrieves the charge;<br>2. reverses the seller's transfer by the disputed amount, at most what's still reversible (`refund_application_fee: false`, idempotency key `dispute-reversal-<disputeId>`);<br>3. records `store_disputes` and sets the order to `disputed`;<br>4. emails the seller the evidence deadline (`evidence_details.due_by`) and asks them to respond in the Express Dashboard |
| `charge.dispute.closed` with status `won` | Stripe returns the disputed amount to Estori. Estori transfers the reversed amount back to the seller (idempotency key `dispute-return-<disputeId>`), and the order goes back to its previous status |
| `charge.dispute.closed` with status `lost` | Nothing more moves. The status is `dispute_lost` |
| The reversal or the return transfer fails | The order gets `needs_attention` and admins are alerted. An admin retries it from the admin view |

- **The dispute fee** is owner decision 5.
- **Disputes on template sales** are untouched: no store order matches them, so they stay in the Stripe Dashboard as
  today.
- **Risk controls:**
  - admins can suspend a store's payments through the Live stores spec's suspension;
  - Radar rules run on the platform account;
  - the checkout rate limits and the cart cap slow card testing.

## 7. Data, interfaces and testing

### The store manifest (`estori-store.json`)

```json
{
  "version": 1,
  "currency": "usd",
  "shipping": { "countries": ["US", "CA"], "flatRateCents": 600, "freeOverCents": 7500 },
  "products": [
    {
      "id": "trail-mug",
      "name": "Trail Mug",
      "description": "Enamel camping mug.",
      "image": "/images/trail-mug.jpg",
      "variants": [
        { "id": "trail-mug-blue", "name": "Blue", "priceCents": 2400 },
        { "id": "trail-mug-red", "name": "Red", "priceCents": 2400, "available": false }
      ]
    }
  ]
}
```

Validation (`parseStoreManifest`):

- **Fields.** Unknown fields are rejected. Every error names its JSON path.
- **Ids.** Ids match `^[a-z0-9][a-z0-9-]{0,63}$`, and variant ids are unique across the file.
- **Prices.** `priceCents` is an integer from 50 to 1,000,000.
- **Shipping:**
  - `shipping.countries` holds 1 to 50 ISO 3166-1 alpha-2 codes that Stripe accepts for shipping;
  - `flatRateCents` is per order and may be 0;
  - when `freeOverCents` is set, shipping is free for subtotals at or above it.
- **Size.** At most 200 products, 1,000 variants and 256 KB.
- **Images.** `image` is a path on the store's origin.
- **Catalog variants.** A catalog variant carries `catalogVariantId`, and its `priceCents` is the seller's retail
  price. These variants are refused with "Catalog products aren't available yet" until the catalog ships.
  - After that, publishing checks each retail price against the catalog spec's minimum retail price for every
    ship-to country.
- **Stores without a manifest** can go live but can't take payments.

### Shared types (`shared/types/store-payments.ts`)

```ts
export interface StoreCheckoutRequest {
	items: { variantId: string; quantity: number }[];
	shipTo: string;
	successPath?: string;
	cancelPath?: string;
	note?: string;
}

export type StoreCheckoutRefusal =
	| 'payments_unavailable'
	| 'demo_only'
	| 'invalid_request'
	| 'unknown_item'
	| 'item_unavailable'
	| 'ships_to_unsupported'
	| 'below_minimum_price'
	| 'cart_limits'
	| 'rate_limited'
	| 'stripe_failed';

export type StoreCheckoutResponse =
	| { ok: true; checkoutUrl: string }
	| { ok: false; reason: StoreCheckoutRefusal; message: string };

interface PricedLineBase {
	productId: string;
	variantId: string;
	name: string;
	quantity: number;
	unitPriceCents: number;
}

/** The cart shape the catalog spec's applicationFeeCents(cart) reads. */
export type PricedLine =
	| (PricedLineBase & { kind: 'own' })
	| (PricedLineBase & {
			kind: 'catalog';
			catalogVariantId: string;
			destinationCountry: string;
			lockedCatalogPriceCents: number;
	  });

export interface PricedCart {
	mode: 'test' | 'live';
	storeAppId: string;
	/** The live store version; null for test checkouts, which price from the preview commit. */
	storeVersionId: string | null;
	commitHash: string;
	/** The seller's connected account; null for test checkouts. */
	sellerStripeAccountId: string | null;
	currency: 'usd';
	shipToCountry: string;
	lines: PricedLine[];
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
}
```

The file also holds:

- the manifest types;
- the limits (`STORE_CART_MAX_CENTS`, `STORE_CART_MAX_LINES`, `STORE_LINE_MAX_QUANTITY`);
- the shopper-facing message for each refusal code.

**The fee function.** `applicationFeeCents(cart)` and the processing constants live where the catalog spec puts them,
in `shared/types/catalog.ts`.

- Checkout ships first, so its first release creates that file:
  - with `CATALOG_PROCESSING_PERCENT` (2.9) and `CATALOG_PROCESSING_FIXED_CENTS` (30);
  - with `applicationFeeCents` covering carts with no catalog lines.
- The catalog work then adds the catalog terms.

### Pure modules (`worker/services/store-payments/`)

| Module | Function |
|---|---|
| `manifest.ts` | `parseStoreManifest(text)`: a typed manifest, or errors with paths |
| `pricing.ts` | `priceCart(manifest, request, catalogLocks)`. It merges duplicate variants and applies these rules:<br>- `unknown_item`, `item_unavailable` and `ships_to_unsupported`;<br>- the flat shipping rate with the free-over threshold;<br>- the cart limits;<br>- the catalog minimum retail price |
| `readiness.ts` | `storePaymentsReadiness(input)`: every gate in section 2. It's used by checkout, by `Estori.store()` and by the seller's Payments card |
| `paths.ts` | `safeReturnPath(value, fallback)` |
| `fulfill.ts` | `recordStoreOrder(deps, session)` |
| `refunds.ts` | `refundableCents(order, refunds)` and `paymentStatusAfter(order, refunds, disputes)` |
| `disputes.ts` | `reversalCents(disputeAmount, transfer)`, plus the dispute status transitions |
| `receipts.ts` | Adding an order to the receipt cookie's claims, and checking a receipt request |
| `store-copy.ts` | `toStoreOrderRecord(order, items)`: the Facet copy, without the street address or phone |

### Stripe client additions (`worker/services/payments/stripe-client.ts`)

- the pinned `Stripe-Version` header;
- `createStoreCheckoutSession(input)`;
- `retrieveCheckoutSession`, extended with typed `customer_details` and `collected_information.shipping_details`;
- `createRefund`;
- `listRefunds(chargeId)`;
- `retrieveCharge(chargeId)`, which reads `transfer`;
- `createTransferReversal(transferId, ...)`;
- `createTransfer(...)`.

Every create takes an explicit idempotency key.

### D1 tables (one migration, the next free number)

All of these are financial records, so they have no foreign key to `apps` and outlive a deleted app, as
`template_purchases.source_app_id` does. Deleting an app deletes its test checkouts and test orders.

- **`store_versions`:**
  - `id`, `app_id`, `commit_hash`;
  - `manifest`, the validated JSON;
  - `manifest_sha256`, `created_by_user_id`, `created_at`;
  - unique on `(app_id, commit_hash)`.
- **`store_checkouts`:**
  - `id` (`chk_` plus 128 random bits), `mode`, `app_id`, `store_version_id`, `commit_hash`;
  - `seller_user_id`, `seller_stripe_account_id`;
  - `ship_to_country`;
  - `priced_cart`, the JSON `PricedCart`;
  - `subtotal_cents`, `shipping_cents`, `total_cents`, `application_fee_cents`;
  - `stripe_checkout_session_id`, unique and nullable;
  - `status`: `creating`, `open`, `completed`, `expired` or `failed`;
  - `success_path`, `cancel_path`, `note`;
  - `created_at`, `expires_at`.
- **`store_orders`:**
  - `id` (`ord_` plus the checkout id's random part), `mode`, `app_id`, `order_number`;
  - `checkout_id`, unique;
  - `seller_user_id`, `seller_stripe_account_id`, `store_version_id`;
  - `stripe_checkout_session_id`, unique and nullable for test orders;
  - `stripe_payment_intent_id`, indexed;
  - `payment_status`: `paid`, `partially_refunded`, `refunded`, `disputed` or `dispute_lost`;
  - `fulfillment_status`: `unfulfilled` or `fulfilled`;
  - `tracking_number`, `carrier`;
  - `subtotal_cents`, `shipping_cents`, `total_cents`, `application_fee_cents`, `refunded_cents`, `currency`;
  - `customer_email`, `customer_name`, `shipping_address` (JSON), `note`;
  - `needs_attention`, a nullable reason;
  - `revision`, `created_at`, `updated_at`;
  - unique on `(app_id, mode, order_number)`.
- **`store_order_items`:**
  - `order_id` and `line_no`, the primary key;
  - `kind`, `product_id`, `variant_id`, `name`;
  - `quantity`, `unit_price_cents`;
  - `catalog_variant_id`, `locked_catalog_price_cents`.
- **`store_refunds`:**
  - `id`, `order_id`;
  - `stripe_refund_id`, unique;
  - `amount_cents`;
  - `status`: `pending`, `succeeded`, `failed` or `canceled`;
  - `initiated_by`, `requested_by_user_id`;
  - `transfer_reversal_cents`, `application_fee_refunded_cents`;
  - `created_at`, `updated_at`.
- **`store_disputes`:**
  - `id`, `order_id`;
  - `stripe_dispute_id`, unique;
  - `amount_cents`, `reason`, `status`, `evidence_due_at`;
  - `transfer_reversal_id`, `reversed_cents`;
  - `return_transfer_id`, `returned_cents`;
  - `outcome`;
  - `created_at`, `updated_at`.
- **`stripe_connect_accounts`** gains `payments_paused_notified_at`, which is nullable.

The catalog spec's `catalog_orders` should reference `store_orders.id`. Its checkout session id is the same as the
store order's.

### Services and API (repo patterns)

- **Database services.** `worker/database/services/` gains `StoreVersionService`, `StoreCheckoutService` and
  `StoreOrderService`, exported from `worker/database/index.ts`.
- **Store-origin handler.** The new `worker/api/handlers/store-platform.ts` serves the platform paths. It is called:
  - from the live-store route;
  - from `handleSpacePreview`, after its token checks and before `forwardToSpacePreview`.
- **Store-origin paths:**
  - `GET /__estori/store.js` and `GET /__estori/store`;
  - `POST /__estori/checkout`;
  - `GET /__estori/return` (live only);
  - `GET|POST /__estori/test-checkout/:checkoutId` (previews, owner token only);
  - `GET /__estori/orders/:orderId`.
- **Seller API.** The new `worker/api/routes/storeRoutes.ts` is registered in `worker/api/routes/index.ts`. Its
  controllers live in `worker/api/controllers/stores/`, and every route needs a signed-in app owner or an admin:
  - `GET /api/stores/:appId/payments`;
  - `GET /api/stores/:appId/orders` (`mode`, `cursor`);
  - `GET /api/stores/:appId/orders/:orderId`;
  - `POST /api/stores/:appId/orders/:orderId/refunds`;
  - `POST /api/stores/:appId/orders/:orderId/fulfillment` with `{ status, trackingNumber?, carrier? }`;
  - `GET /api/admin/store-payments`: orders that need attention, open disputes and failed store copies.
- **Frontend.** Types go in `src/api-types.ts` and calls in `src/lib/api-client.ts`.
- **Webhook events:**
  - `checkout.session.completed`;
  - `checkout.session.async_payment_succeeded`;
  - `checkout.session.async_payment_failed`;
  - `checkout.session.expired`;
  - `charge.refunded`;
  - `charge.refund.updated`;
  - `charge.dispute.created`;
  - `charge.dispute.closed`;
  - `account.updated`, which is existing.

  An event with no store order is ignored, as today.
- **SpaceDO (`space/`):**
  - the `deployments` row gains `store_manifest`, the raw `estori-store.json` from the deployed tree;
  - new RPCs `getStoreManifest(branch)` and `enqueueAppOrder(branch, order)`;
  - new RPC `appOrderSyncStatus()`, which lists undelivered and failed entries;
  - an `app_outbox` table with `alarm()`;
  - `deploy` and `wipeAppDatabase` refuse `live`;
  - the wrapper gains `__estoriUpsertOrder`.

  The new RPC types go in `worker/agents/think/space-workspace-ops.ts` and in the app database stub type.

### Testing

- **Pure functions:**
  - **`parseStoreManifest`:**
    - a valid file;
    - unknown fields;
    - duplicate and malformed ids;
    - price bounds;
    - size limits;
    - catalog variants before the catalog ships.
  - **`priceCart`:**
    - unknown and unavailable variants;
    - an unsupported country;
    - merged duplicate lines;
    - flat and free shipping;
    - the 50¢ minimum;
    - the cart cap;
    - a fee that isn't below the total.
  - **`applicationFeeCents`** for own-product carts, including rounding at half cents.
  - **`storePaymentsReadiness`**, one case per gate.
  - **`safeReturnPath`:**
    - `//evil.example`;
    - `https:` URLs;
    - backslashes and control characters;
    - over-long paths.
  - **`recordStoreOrder`:**
    - paid;
    - unpaid;
    - not ours;
    - an amount mismatch;
    - a country mismatch;
    - a duplicate.
  - **Refunds:**
    - the refundable amount and the status after full and partial refunds;
    - a failed refund.
  - **Disputes:** reversal amounts and won and lost transitions.
  - **Receipts:** cookie claims and checks.
  - **`toStoreOrderRecord`** drops the street address and phone.
- **Webhook tests,** in the style of `worker/api/controllers/payments/webhook.test.ts`:
  - The signature is checked before any read, as today.
  - A paid store session records one order and enqueues one store copy.
  - A duplicate delivery records nothing new and enqueues again idempotently.
  - A template session still takes the template path.
  - `charge.dispute.created` reverses the transfer once, even when delivered twice.
  - A won dispute returns the funds once.
  - A dashboard refund is recorded with `initiated_by = express_dashboard`.
- **Wiring guards,** in the style of `payments-wiring.test.ts`:
  - `/__estori/*` requests never reach SpaceDO or the Facet, whatever their case or encoding.
  - The checkout handler rejects bodies with `amount`, `price`, `fee` or `account`.
  - `deploy_space` refuses `live`.
  - The webhook route stays public and exempt from CSRF.
  - Public previews get `demo_only`.
- **SpaceDO tests,** run from the repo root (`npx vitest run space/test`):
  - `__estoriUpsertOrder` ignores older revisions and repeats;
  - the outbox retries on the alarm and ends as `failed`;
  - `wipeAppDatabase('live')` and `deploy('live')` are refused.
- **A live run in Stripe test mode,** like the template payments spec's:
  1. Pay a live test store with card 4242 4242 4242 4242.
  2. Check the order in D1 and in `estori_orders`, the application fee, the transfer and the seller as settlement
     merchant.
  3. Check that a declined card (4000 0000 0000 0002) records nothing.
  4. Refund once from Estori and once from the Express Dashboard, then compare the recorded reversal and fee amounts.
  5. Check that a disputed payment (4000 0000 0000 0259) reverses the transfer.
  6. Check that a store with `charges_enabled` turned off refuses checkout.

## 8. What this spec needs from live stores

The Live stores spec must provide:

1. **A per-store origin.** Each live store has a stable public origin of its own, not shared with other stores or with
   estori.app (owner decision 2). Routing resolves that origin to exactly one app id in platform code, before any
   generated code runs.
2. **A pinned live version.** A live store serves one pinned commit from SpaceDO branch `live`, with Facet `app:live`.
   `SpaceDO.publishLive(commit)` deploys it without moving the working tree's branch.
3. **A live store record.** It holds `appId`, `origin`, `status` (`live`, `suspended` or `offline`) and
   `currentVersionId`, which points at this spec's `store_versions`.
4. **A go-live hook.** Going live calls this spec's `publishStoreVersion(appId, commit)`, which validates the manifest
   and stores the snapshot. A version with an invalid manifest can't go live.
5. **Store-origin interception.** On the live origin, `/__estori/*` is handled by `store-platform.ts`.
6. **A go-live warning.** When the version has no manifest, the go-live step warns "This store's checkout isn't
   connected to payments".

## Launch prerequisites

- **Live stores** are built.
- **Owner setup in Stripe:**
  - add the webhook events above;
  - make sure `account.updated` is received for connected accounts, as a Connect event;
  - enable the Express Dashboard features (owner decision 7);
  - review the Radar rules.
- **Legal:**
  - **Terms:** the seller is responsible for products, shipping, refunds and taxes, and Estori recovers disputed
    amounts.
  - **Privacy policy:** Estori processes shopper data for sellers.
  - **Tax:** a decision (owner decision 11).
- **Site copy:** the FAQ answer "Can my store take payments?" changes only when live stores take payments.
- **A test-mode run:** the live run above passes.

## Owner decisions

1. **The seller as settlement merchant (`on_behalf_of`).**
   - **Recommendation:** yes, for store sales. The shopper's statement and the Checkout page show the seller, and the
     seller is the business of record, which is the right footing for consumer law and tax. It's also what lets sellers
     refund and answer disputes in the Express Dashboard.
   - **Trade-off:** payments need `charges_enabled`, not just transfers. Template sales keep Estori as the merchant.
2. **The live store domain** (it belongs to Live stores but blocks this spec).
   - **Recommendation:** a separate registrable domain for stores, for example `<store>.estori.shop`, registered on the
     Public Suffix List, so stores can't read or set each other's cookies or estori.app's.
   - **Trade-off:** buying the domain and waiting for the Public Suffix List to accept it, against
     `<store>.estori.app`, which shares estori.app's site.
3. **Live stores before paid plans exist.**
   - **Recommendation:** allow one live store on the free plan until Premium can be bought. Paid plans can't be bought
     yet, so the alternative is no store payments at all.
   - **Trade-off:** this departs from the positioning spec's "Free: build and preview only".
4. **Connect costs the processing fee doesn't cover.** Stripe charges a platform that handles pricing $2 per monthly
   active account, 0.25% + 25¢ per payout, and a fee per 1099 form.
   - **Recommendation:** Estori absorbs these, to keep "Estori takes no cut".
   - **Trade-off:** about $2 to $3 per active seller per month. Passing them on would break the promise on the site.
5. **The dispute fee on own-product disputes** (Stripe's US fee).
   - **Recommendation:** Estori absorbs it at launch. Sellers still lose the disputed amount, and admins suspend
     payments for stores with high dispute rates.
   - **Trade-off:** Estori's cost per dispute, against recovering it by account debit, which costs 1.5% and can push a
     seller's balance negative.
6. **Live prices change only on publish.**
   - **Recommendation:** yes.
   - **Trade-off:** a price fix needs a publish, against the safety of an immutable, reviewed price list per live
     version.
7. **Express Dashboard features.**
   - **Recommendation:**
     - enable "View payments", "Issue refunds" and "Manage disputes";
     - keep "Close account" off.
   - **Trade-off:** refunds can happen outside Estori. They're recorded through the webhook.
8. **Shopper address in the store's own database.**
   - **Recommendation:** leave out the street address and phone. Sellers ship from Estori's Orders page.
   - **Trade-off:** in-store admin pages can't show full addresses, but an AI-written store that exposes its orders
     table can't leak them either.
9. **Confirmed email before taking payments.**
   - **Recommendation:** yes, matching the signup proposal's "confirm before publishing and payouts".
   - **Trade-off:** one more step before the first sale.
10. **Order emails.**
    - **Recommendation:** Estori sends:
      - the shopper's confirmation, from `no-reply@estori.app` (`EMAIL_FROM`) with the store's name, reply-to the
        seller's account email (disclosed on the Payments card);
      - the seller's "new order" email.
    - **Trade-off:** shoppers see the seller's account email, against a receipt with no way to reply.
11. **Sales tax.**
    - **Recommendation:**
      - get a legal opinion on marketplace facilitator status before store payments go live;
      - launch with no tax calculation, and Terms that make sellers responsible;
      - plan Stripe Tax, with liability on the seller's account, as the follow-up.
    - **Trade-off:** sellers with tax obligations can't collect tax through Estori at launch, and if Estori counts as a
      facilitator in some states, Estori must collect and remit there itself.
12. **No stock tracking at launch.**
    - **Recommendation:** yes. Sellers mark variants unavailable and publish.
    - **Trade-off:** oversold items need refunds.
13. **Cards and wallets only.**
    - **Recommendation:** yes. Methods whose Stripe fees exceed 2.9% + 30¢ (buy now pay later, some bank methods) would
      cost Estori on every sale under the processing-fee rule.
    - **Trade-off:** fewer ways for shoppers to pay.
