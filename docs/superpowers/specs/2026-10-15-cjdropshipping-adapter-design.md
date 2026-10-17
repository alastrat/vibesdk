# Supplier connection: the CJdropshipping adapter — design

Status: written on 2026-10-15 for the owner's review; not approved. Decisions only the owner can make are in the last
section, each with a recommendation. Everything else is decided here.

## Context

The approved catalog spec (`2026-10-15-catalog-order-payments-design.md`) and its plan
(`docs/superpowers/plans/2026-10-15-catalog-order-payments.md`, commit 960349a) define the money side of catalog orders.
That plan leaves two pieces to this spec:

- the scheduler that runs supplier placement after Stripe's webhook answers;
- receiving or polling supplier updates.

The shopper checkout spec (`2026-10-15-shopper-checkout-design.md`) defines the paid cart (`lockedCatalogPriceCents`
per catalog line, `shipToCountry` per cart) and asks "the catalog service" for locked prices.

What exists in the plan, and is consumed here unchanged:

| Piece | Where | Used here for |
| --- | --- | --- |
| `SupplierAdapter`, `PlaceOrderResult`, `ShippingAddress`, `SupplierUpdate` | `worker/services/catalog/supplier.ts` | The contract this adapter implements |
| `catalogPriceCents({ supplierCostCents, shippingCents })` | `shared/types/catalog.ts` | Catalog prices per variant and destination |
| `placeCatalogOrder(deps, orderId)`, `nextRetryDelayMs`, `MAX_PLACEMENT_ATTEMPTS = 6` | `worker/services/catalog/placement.ts` | One placement attempt per alarm |
| `applySupplierUpdate(items, update)` | `worker/services/catalog/updates.ts` | Supplier reports as item patches |
| `refundCatalogItems(deps, { orderId, itemIds, reason })` | `worker/services/catalog/refund-items.ts` | Refunding rejected items |
| `CatalogOrderService implements CatalogOrderStore` | `worker/database/services/CatalogOrderService.ts` | D1 reads and writes of catalog orders |
| `catalog_orders` (with the shipping address as JSON), `catalog_order_items` | migration `0016_catalog_orders.sql` | Orders and items |

Owner facts this spec builds on:

- Estori's own CJdropshipping (CJ) account places every catalog order. Sellers connect nothing.
- Estori takes the locked catalog price as part of the application fee, then pays CJ from its CJ balance.
- CJ ships to the shopper. Estori runs no warehouse.

### Scope

This spec covers:

- the CJ API client, its token and its limits;
- the adapter that implements `SupplierAdapter`;
- catalog data: import, refresh, pricing per destination, and what happens when CJ changes a price or stock;
- the runner that places, refunds and tracks each catalog order;
- webhooks, polling, alerts and the operations they support;
- the deployment config change, which the owner commits.

Not in scope:

- browsing the catalog and adding products to a store (the "add to store" piece, a separate spec);
- the seller's saved card for extra costs (deferred by the catalog plan);
- bring-your-own supplier accounts (premium, later).

### Too big for one plan

The work splits into two implementation plans, in this order:

1. **CJ client and catalog data:** the client and its token cache, the catalog tables, the curated list, the refresh
   job, product images, and `lockCatalogPrices` for checkout. Nothing in it places an order.
2. **Supplier orders:** the adapter, the runner Durable Object, the webhook, polling, alerts, the admin page and the
   deployment config. It needs plan 1 and the catalog order payments plan.

Both plans ship before any real catalog order, so the single owner config change (section 6) lands with plan 2. Plan 1
adds the `scheduled` handler and its refresh job, which tests and local runs call directly; the cron that runs it in
production arrives with that config change.

## Goals

- A paid catalog order becomes exactly one paid CJ order, or a refund for the items CJ can't fill.
- Catalog prices are current per variant and destination, and checkout never sells an item Estori can't price.
- Tracking and delivery reach the order within minutes through webhooks, and within a day if a webhook is lost.
- The owner hears about every problem that needs a person: low CJ balance, an order that can't be placed, a refund that
  failed, a broken webhook.
- No credential is stored in D1, and shoppers never see CJ's name.

## 1. CJ API facts

Read on 2026-10-15 from CJ's API 2.0 documentation at `https://developers.cjdropshipping.com`. Paths below are relative
to `https://developers.cjdropshipping.com/api2.0/v1/`.

### What Estori relies on

| Topic | Fact | Source (under `/en/api/`) |
| --- | --- | --- |
| Envelope | Every response has `code`, `result`, `message`, `data` and `requestId`. A call succeeded only when HTTP is 200 and `code` is 200; `message` must not be used to judge success | `start/development.html`, `api2/standard/ps-code.html` |
| Authentication | `POST authentication/getAccessToken` with `{ apiKey }` returns `openId`, `accessToken`, `accessTokenExpiryDate`, `refreshToken` and `refreshTokenExpiryDate`. Both tokens last 180 days by default. Calls send the token in the `CJ-Access-Token` header | `api2/api/auth.html` |
| Token reuse | Repeated `getAccessToken` calls within 24 hours return the same tokens. The endpoint allows 1 call a second. CJ asks that tokens stay on the backend and be cached | `api2/api/auth.html`, `start/token.html` |
| Rate limits | 10 requests a second per IP, and each IP may serve at most 3 CJ users. Per account: 1 request a second for Free users (sales level 0 or 1), 2 for Plus, 4 for Prime, 6 for Advanced. Over the limit: code 1600200 | `start/limit.html`, `api2/standard/ps-code.html` |
| Points | 50,000 points a day plus a bonus based on recent order value, reset at 00:00 UTC and refilled each minute. Product list calls cost 50, product detail, variant and stock calls 10, freight calls 10. Calls missing from CJ's price list cost nothing, including order, payment, tracking and dispute queries. Every response carries `pointsInfo` (`usedToday`, `remaining`, `total`). Exhausted points answer HTTP 429 | `api2/standard/points.html` |
| Products | `GET product/query?pid=` returns the product with `variants[]`: `vid`, `variantSku`, `variantKey`, `variantNameEn`, `variantImage`, `variantWeight` (g), `variantSellPrice` (USD, Estori's cost). `status` 3 means on sale. `GET product/variant/queryByVid` and `GET product/stock/getInventoryByPid` give stock per warehouse country (`totalInventory`, `cjInventory`, `factoryInventory`) | `api2/api/product.html` |
| Freight | `POST logistic/freightCalculate` with `startCountryCode`, `endCountryCode`, `zip` and `products: [{ vid, quantity }]` returns options with `logisticName`, `logisticPrice` (USD), `logisticAging` and `totalPostageFee` (USD, including taxes and clearance) | `api2/api/logistic.html` |
| Order creation | `POST shopping/order/createOrderV2`. Required: `orderNumber` (max 50), `shippingCountryCode`, `shippingCountry`, `shippingProvince`, `shippingCity`, `shippingAddress`, `shippingCustomerName` (max 50), `logisticName`, `fromCountryCode`, `products`. `payType` 3 creates the order without paying. `isSandbox` 1 makes a sandbox order. The response has `orderId`, `shipmentOrderId`, `orderStatus`, the amounts and `interceptOrderReasons` | `api2/api/shopping.html` |
| Idempotency | Creating an order whose `orderNumber` already exists fails with 1603003. `GET shopping/order/getOrderDetail?orderId=` accepts either CJ's id or Estori's order number | `api2/standard/ps-code.html`, `api2/api/shopping.html` |
| Payment | `POST shopping/pay/payBalanceV2` with `shipmentOrderId` pays from the CJ balance; `POST shopping/pay/payBalance` with `orderId` pays a single order. `GET shopping/pay/getBalance` returns `amount` and `freezeAmount` in USD. Insufficient balance is 1604000 | `api2/api/shopping.html`, `api2/standard/ps-code.html` |
| Order status | `CREATED`, `IN_CART`, `UNPAID`, `UNSHIPPED` (sub-status `PENDING` or `PROCESSING`), `SHIPPED`, `DELIVERED`, `CANCELLED`. `POST shopping/order/getOrderDetailBatch` reads up to 100 orders a call. Only `CREATED` or `IN_CART` orders can be deleted | `api2/api/shopping.html` |
| Tracking | `GET logistic/trackInfo?trackNumber=` (repeatable) returns `trackingNumber`, `trackingStatus`, `deliveryTime`, `lastMileCarrier` and `lastTrackNumber` | `api2/api/logistic.html` |
| Webhooks | `POST webhook/set` takes `product`, `stock`, `order` and `logistics` (each `ENABLE` or `CANCEL` with one HTTPS callback URL), plus optional `dispute` and `makeup`. CJ tests the URL on registration. Callbacks need HTTP 200 within 3 seconds, are retried up to 3 times, and carry a `messageId`. A topic whose success rate stays under 80% for two full hours closes until re-enabled. Localhost URLs are refused (1607001) | `api2/api/webhook.html`, `start/webhook.html` |
| Webhook signature | Header `sign` = Base64 of HMAC-SHA256 over the raw body, keyed with the account's `openId` | `start/webhook.html`, `api2/api/webhook.html` |
| Webhook payloads | `ORDER` (`orderNumber`, `cjOrderId`, `orderStatus`, `trackNumber`), `LOGISTIC` (`orderId`, `trackingNumber`, `trackingProvider`, `trackingStatus`, where 12 is delivered), `DISPUTE_INFO` (`orderId`, `disputeId`, `status`: 4 refund agreed, 5 reissue agreed), `MAKEUP` (an extra charge CJ asks for on an order, with `amount` and `reason`) | `start/webhook.html` |
| Disputes | `GET disputes/getDisputeList` and `GET disputes/getDisputeDetail` (with `refundAmount` and `productList`). `POST disputes/create` takes `expectType` 1 (refund) or 2 (reissue) and `refundType` 1 (to the CJ balance); it works only for orders created through the API | `api2/api/dispute.html` |
| Sandbox | Orders created with `isSandbox=1` use a simulated payment that takes no real balance and never ship. `shopping/sandbox/simulatePay`, `shopping/sandbox/updateStatus` and `shopping/sandbox/updateTrackNumber` move them through payment, status and tracking | `start/sandbox.html` |

### Where the docs are unclear, and the safe assumption

Each assumption is checked in the sandbox run before launch (launch prerequisite 4).

| # | Unclear | Safe assumption in this design |
| --- | --- | --- |
| A1 | Whether a deleted or cancelled order's `orderNumber` can be reused | Never reuse one. The order number includes a digest of the lines (section 3), so a changed order gets a new number |
| A2 | Whether `payType` 3 needs the cart steps (`addCart`, `addCartConfirm`) before paying | The payment section says to call Pay Balance V2 after `payType` 3. The adapter pays with `payBalanceV2(shipmentOrderId)`, falling back to `payBalance(orderId)` when `shipmentOrderId` is empty, and confirms the status afterwards |
| A3 | Whether `shippingProvince` takes a US state code or name | Send what Stripe collects (the two-letter code). If the sandbox refuses it, the adapter maps US codes to names from a constant table |
| A4 | Whether `trackInfo`'s `trackingStatus` is numeric like the webhook's | Treat numeric 12 or a status text containing "delivered" as delivered |
| A5 | Whether the signature scheme covers every topic | The docs state it for two topics and say the rest work the same. A failed signature answers 401, and polling (section 5) covers any loss |
| A6 | When CJ includes an invoice, prices or its own marketing in parcels | Unknown from the API docs. The owner sets a standing neutral-packaging instruction with CJ (section 7) |
| A7 | Whether CJ emails the shopper when an email is given | The adapter never sends the shopper's email to CJ |
| A8 | What `interceptOrderReasons` codes mean | Any intercepted order is held for the owner: never paid, never refunded automatically |
| A9 | Whether `getAccessToken` invalidates older tokens | Any call that fails with an invalid token re-reads the cache and fetches a new token once |
| A10 | Time limit for opening a dispute | Not documented. The owner files disputes promptly; the seller claim window is owner decision 8 |

## 2. The CJ client

`worker/services/catalog/cj/client.ts`, a minimal REST client over `fetch` in the style of
`worker/services/payments/stripe-client.ts`: one `request<T>()` helper, a typed method per endpoint used, and
`createCjClient(deps, fetchImpl = fetch)` so tests fake `fetch`.

### Requests and errors

- JSON bodies, the `CJ-Access-Token` header, and a 15-second timeout per call (`AbortSignal.timeout`).
- Success is HTTP 200 with `code` 200. Anything else throws `CjApiError { status, code, message, requestId }`. The
  `requestId` is logged with every failure, as CJ asks.
- **Classification** (`classifyCjError(error)` in `cj/errors.ts`, pure):

| CJ signal | Class |
| --- | --- |
| 1600001, 1600002 (invalid or empty token) | `auth-token`: the client fetches a new token and repeats the call once |
| 1600003 to 1600008 (account, key or authorization) | `account`: owner alert |
| 1600200, HTTP 429, 16900500 or code 429 (points), the "one ip limit" message | `throttled` |
| 1600000, 1600301, 1608002, 1610001, HTTP 5xx, network errors, timeouts | `temporary` |
| 1600100, 1600101 (interface offline or missing) | `temporary`, plus an owner alert |
| 1600300, 16900202 to 16900205, 16900403 (parameter errors) | `bad-request`: Estori built a request CJ refuses; owner alert |
| 1602000 to 1602003, 10063, 1603102 | `item-unavailable` |
| 1605000, 1605001, 1605002 | `undeliverable` |
| 1603003 | `duplicate-order` |
| 1604000 | `insufficient-balance` |
| 1604001, 1603101 | `payment-blocked`: owner alert |
| anything else | `temporary` |

- **Throttle.** One account allows 1 request a second at Free level. The client spaces its own calls at least
  1,100 ms apart, and on `throttled` waits 1,200 ms and repeats once. Calls from different isolates aren't coordinated;
  the rare collision is retried by its caller. Estori's account level sets `CJ_MIN_CALL_INTERVAL_MS`.
- **Points.** The client keeps the last `pointsInfo` it saw. The refresh job (section 4) stops when fewer than
  `CJ_POINTS_RESERVE = 5,000` points remain, so placements always have points for their freight quote.

### The token, and why it lives in KV

`cj/session.ts` owns the access token.

- **Where:** Workers KV (`VibecoderStore`), key `catalog:cj:session:v1`.
- **Why KV:**
  - The token is read by many places: every runner Durable Object, the cron jobs and the webhook handler. KV reads are
    local and cheap.
  - The value changes about twice a year.
  - KV's eventual consistency is harmless here. CJ returns the same token to repeated requests within 24 hours, so two
    isolates refreshing at once get the same token. An isolate holding a stale token gets 1600001 and recovers through
    the classification rule above.
  - D1 is wrong for it: the token is a credential, and CLAUDE.md keeps credentials out of D1. With read replicas
    enabled, D1 would be no more consistent than KV.
  - A Durable Object would give strong consistency, but at the cost of a new class and a round trip to one location on
    every CJ call, for a value that almost never changes.
- **Encrypted at rest.** The token can spend Estori's CJ balance, so the KV value is AES-GCM ciphertext with a key
  derived by HKDF-SHA256 from `CJ_API_KEY` (salt `estori-cj-session`). Someone who can read KV but not Worker secrets
  can't use it. Rotating the API key makes the old value undecryptable, which simply forces a new token. HKDF keeps
  every read cheap, unlike the 100,000-round PBKDF2 in `worker/utils/tokenEncryption.ts`.
- **What is stored:** `{ accessToken, accessTokenExpiresAt, openId }`. The refresh token isn't used: the API key can
  always get a new token, and one path is simpler than two.
- **Expiry:** the KV entry expires 7 days before the token does, so the next call fetches a fresh token without a
  scheduled job. Each isolate also keeps the decrypted value in memory for up to an hour.
- **`openId`** is also the webhook signing key (section 5), so the webhook reads it from the same record.

### Secrets and modes

- `CJ_API_KEY` is a Worker secret, set by the owner with `wrangler secret put CJ_API_KEY --config wrangler.estori.jsonc`
  and in `.dev.vars` locally. It is declared in `worker/types/env.d.ts` as optional. Without it, catalog prices read as
  unavailable, the refresh job skips, and a placement attempt is `retryable` with an owner alert.
- **Live only in production.** Orders are created with `isSandbox=1` unless `isProd(env)` (`worker/utils/envs.ts`).
  Local dev and any non-production deployment can never place a real order.

## 3. The adapter

`worker/services/catalog/cj/adapter.ts`:

```ts
export class CJDropshippingAdapter implements SupplierAdapter {
	readonly supplier = 'cjdropshipping';
	constructor(private readonly deps: CjAdapterDeps) {}
	placeOrder(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }): Promise<PlaceOrderResult>;
}

export interface CjAdapterDeps {
	client: CjClient;
	/** Each served destination's country name and origin warehouse country: CATALOG_DESTINATIONS, injected for tests. */
	destinations: Readonly<Record<string, { name: string; origin: string }>>;
	mode: 'live' | 'sandbox';
	/** Records CJ's order id, number, amounts and carrier once paid (writes catalog_supplier_orders). */
	onOrderPaid(record: SupplierOrderRecord): Promise<void>;
	/** Owner alerts that can't wait for the retries to run out: low balance, account problems, held orders. */
	onAlert(alert: SupplierAlert): Promise<void>;
}
```

### The order number, and why it makes placement idempotent

- CJ's `orderNumber` is `<orderReference>-<digest>`, where `digest` is the first 8 hex characters of the SHA-256 of the
  lines, sorted and written as `vid:quantity` joined by commas (`sha256Hash` in `worker/utils/cryptoUtils.ts`).
  Catalog order ids are UUIDs (`generateId`), so the number is 45 characters, under CJ's 50.
- The same reference with the same lines always gives the same number, and CJ refuses a second order with it (1603003).
- When `placeCatalogOrder` retries the remaining lines after a partial rejection, the lines differ, so the number
  differs. That avoids reusing a number whose earlier order CJ may still hold (A1).
- The adapter only returns `ok` for a paid order, and only pays an order whose lines match the request. So at most one
  paid CJ order exists per reference, which is the contract's rule.

### `placeOrder`, step by step

1. **Destination.** `address.countryCode` must be in `destinations`; otherwise `rejected` (all lines, "destination not
   served"). Checkout prevents this, so it is a guard.
2. **Existing order.** `getOrderDetail(orderNumber)`.
   - Found, and paid (`UNSHIPPED`, `SHIPPED` or `DELIVERED`): `ok` with its `orderId`. This is the timeout-after-success
     case.
   - Found and unpaid (`CREATED`, `IN_CART`, `UNPAID`): go to step 5.
   - Found and `CANCELLED`: `rejected`, all lines, "cancelled by the supplier".
   - Not found: continue.
3. **Freight.** `freightCalculate` from the destination's origin to the address's country and postal code, with all
   lines. Choose by the catalog's rule (section 4): options within `CATALOG_MAX_DELIVERY_DAYS`, lowest
   `totalPostageFee`, then shortest delivery. No option: `rejected`, all lines, "undeliverable".
4. **Create** with `createOrderV2`, `payType` 3, `shopLogisticsType` 2 (CJ arranges shipping), `isSandbox` by mode,
   and the address mapping below.
   - 1603003: go back to step 2 once.
   - `interceptOrderReasons` not empty: `retryable` ("held by the supplier: ..."), with an immediate owner alert (A8).
     The unpaid order stays, so a later attempt finds it in step 2 and pays it if CJ released it.
5. **Pay.** Check that the order's lines match the request; if they don't, return `retryable` with an owner alert, and
   never pay it. Then `payBalanceV2(shipmentOrderId)`, or `payBalance(orderId)` when `shipmentOrderId` is empty (A2).
6. **Confirm.** `getOrderDetail` again. `UNSHIPPED` or later: call `onOrderPaid` with CJ's amounts, then return
   `{ ok: true, supplierOrderId: orderId }`. Still unpaid: `retryable`.

### Identifying rejected variants

When CJ answers `item-unavailable` without naming variants, the adapter checks each line with `variant/queryByVid`
(stock at the origin below the quantity, or the variant gone) and returns those `vid`s. If none can be identified, it
returns an empty list, and `placeCatalogOrder` rejects every line sent, as the plan's review focus requires.

### CJ errors to `PlaceOrderResult`

| Class (section 2) | Result |
| --- | --- |
| `item-unavailable` | `rejected`, the variants found above |
| `undeliverable` | `rejected`, all lines |
| `duplicate-order` | Look the order up (step 2) |
| `insufficient-balance` | `retryable`, plus an immediate low-balance alert |
| `throttled`, `temporary`, `auth-token` after its one repeat | `retryable` |
| `account`, `payment-blocked`, `bad-request` | `retryable`, plus an owner alert. Retries won't fix these, so the order ends `needs-attention` and the owner acts |

A held, blocked or unfunded order ends in `needs-attention` after `MAX_PLACEMENT_ATTEMPTS`: the sixth attempt runs
about 4 hours 20 minutes after the first, with the plan's delays. The owner then retries or refunds it from the admin
page (section 7).

### Address mapping

| `ShippingAddress` | CJ field | Rule |
| --- | --- | --- |
| `name` | `shippingCustomerName` | Trimmed, cut to 50 characters |
| `line1`, `line2` | `shippingAddress`, `shippingAddress2` | `line2` left out when null |
| `city` | `shippingCity` | Cut to 50 |
| `region` | `shippingProvince` | Required by CJ: `region`, else `city` (A3) |
| `postalCode` | `shippingZip` | Cut to 20 |
| `countryCode` | `shippingCountryCode`, `shippingCountry` | The name comes from `CATALOG_DESTINATIONS` |
| `phone` | `shippingPhone` | Digits and a leading `+`; left out when longer than 20 or empty |
| `email` | none | Never sent (A7) |

Other fields: `fromCountryCode` is the destination's origin, `products` is `[{ vid, quantity }]`, and `remark`,
`storeName` and `platform` are left out.

### Costs that differ from the locked price

CJ charges its current price at placement, which can differ from the price locked at checkout minutes or hours earlier.
The adapter places the order anyway: the shopper has paid and the seller expects fulfillment. `onOrderPaid` stores CJ's
charge, and the runner alerts the owner when it exceeds the order's locked catalog total, which means Estori lost money.

## 4. Catalog data

### What is in the catalog

- **A curated list in code:** `worker/services/catalog/curated.ts` holds entries
  `{ supplierProductId, category, title?, paused? }`. The refresh job imports anything new, refreshes everything listed,
  and retires products that leave the list.
- **Why code, not an admin import page:** curation is rare and owner-driven, every change is reviewed in a PR, and no
  editor has to be built. The trade-off is a deploy per change (owner decision 2).
- **Products only from the destination's origin warehouse.** `CATALOG_DESTINATIONS` in `shared/types/catalog.ts` maps
  each destination to one origin: at launch `{ US: { name: 'United States', origin: 'US' } }` (owner decision 4). All
  lines of an order then share one origin, which `createOrderV2`'s single `fromCountryCode` requires.

### D1 tables

Plan 1's migration adds the first three tables. Plan 2's adds `catalog_supplier_orders`, which references the catalog
plan's `catalog_orders`. Each takes the next free number after `0016_catalog_orders` and is generated by drizzle-kit.
`worker/database/schema.ts` uses four-space indentation, as the plan notes.

- **`catalog_products`:**
  - `id` (`generateId`), `supplier` (enum `CATALOG_SUPPLIERS`), `supplier_product_id`; unique on
    `(supplier, supplier_product_id)`;
  - `status`: `active`, `paused` or `retired`;
  - `category`, `title`, `description` (plain text);
  - `images`: JSON array of R2 keys; `attributes`: JSON object of CJ's English properties (material, for example);
  - `details_refreshed_at`, `shipping_quoted_at`, `refresh_claimed_until`, `last_refresh_error`;
  - `created_at`, `updated_at`.
- **`catalog_variants`:** one per CJ variant.
  - `id`: the `catalogVariantId` that store manifests and carts carry;
  - `product_id` (cascade), `supplier_variant_id` (CJ `vid`, unique), `sku`, `name`;
  - `options`: JSON, for example `{ "Color": "Blue", "Size": "M" }`, from CJ's `variantKey` and the product's property
    names;
  - `image_key` (R2, nullable), `weight_grams`;
  - `supplier_cost_cents`: CJ's `variantSellPrice` in cents;
  - `stock`: JSON `{ countryCode: quantity }` from CJ's inventory by warehouse country;
  - `status`: `active` or `retired`; `updated_at`.
- **`catalog_variant_offers`:** the price and availability of one variant for one destination. Primary key
  `(variant_id, destination_country)`.
  - `origin_country`, `logistic_name`, `delivery_days_min`, `delivery_days_max`;
  - `supplier_cost_cents`, `shipping_cents`, `catalog_price_cents`;
  - `available`, and `unavailable_reason`: `out-of-stock`, `no-shipping`, `paused` or `retired`;
  - `updated_at`.
- **`catalog_supplier_orders`:** CJ's side of each placed order, for reconciliation and polling.
  - `supplier_order_id` (CJ `orderId`, primary key), `catalog_order_id` (references `catalog_orders.id`, cascade),
    `supplier`, `supplier_order_number` (unique), `mode` (`live` or `sandbox`);
  - `origin_country`, `logistic_name`;
  - `charged_cents`, `product_cents`, `postage_cents`: what CJ took from the balance;
  - `supplier_status`, `synced_at`, `placed_at`.

### Prices per variant and destination

For each variant and destination:

1. `supplier_cost_cents` is `variantSellPrice` in cents. Decimal strings are parsed exactly (`usdToCents`), never
   through floating-point multiplication.
2. `shipping_cents` is the chosen freight option's `totalPostageFee` for one unit to the destination, from the origin.
   The rule: options with a maximum delivery time within `CATALOG_MAX_DELIVERY_DAYS` (10 for the US), the lowest total,
   then the shortest time. `totalPostageFee` includes taxes and clearance, which matters for any non-domestic route
   since the US suspended its duty-free de minimis exemption in 2025.
3. `catalog_price_cents = catalogPriceCents({ supplierCostCents, shippingCents })`.
4. The offer is `available` when the product is `active`, the variant is `active`, stock at the origin is at least
   `CATALOG_MIN_STOCK` (10, a buffer against selling the last units twice), and a freight option exists.

Variants of one product with the same weight share one freight quote, which saves points.

Pricing per unit charges the shipping of one unit for every unit, while CJ ships several units in one parcel. Estori
collects more than CJ charges on multi-unit orders, never less. A lower price for additional units is a later
improvement.

### Refresh cadence and the points budget

A cron job every 15 minutes (section 5) runs `refreshCatalogBatch`:

1. Recompute every offer's `catalog_price_cents` from its stored inputs, in D1 only. A deploy that changes
   `CATALOG_MARGIN_PERCENT` therefore reprices the catalog within 15 minutes, with no CJ call.
2. Claim up to `CATALOG_REFRESH_BATCH = 15` products whose details are older than 6 hours or whose freight is older
   than 24 hours, stalest first, with `UPDATE ... SET refresh_claimed_until = now + 10 min ... RETURNING id`, so
   overlapping runs never refresh the same product.
3. For each: `product/query` (price, status, variants), `product/stock/getInventoryByPid` (stock), and
   `freightCalculate` per weight group when the freight is due. New images are copied (below).
4. Write variants and offers in one D1 batch per product. A CJ error on one product is stored in
   `last_refresh_error` and the batch moves on.
5. Stop early when the points left fall under `CJ_POINTS_RESERVE`.

Budget for 150 products of about 4 variants, US only:

| Calls | Points per pass | Passes a day | Points a day |
| --- | --- | --- | --- |
| Product details | 1,500 | 4 | 6,000 |
| Stock | 1,500 | 4 | 6,000 |
| Freight (about 1.5 weight groups per product) | 2,250 | 1 | 2,250 |
| **Total** | | | **14,250 of 50,000** |

One run takes about a minute at one call a second; 96 runs a day refresh up to 1,440 products, four times the need.

### Images and text

- **Images** are copied to R2 (`TEMPLATES_BUCKET`, the `estori-assets` bucket) under
  `catalog/<productId>/<sha256 of the source URL, 16 hex>.<ext>`: up to 8 product images and each variant's image, at
  most 5 MB each, `image/*` only. A changed URL means a new key; unchanged images aren't copied again.
- They are served publicly at `GET /api/catalog/images/:productId/:file`, following
  `worker/api/routes/imagesRoutes.ts` and its screenshots controller, with a long cache. Shoppers and sellers never see
  a CJ address, and the add-to-store piece copies images into the store from there.
- **Text:** CJ's HTML description becomes plain text: tags stripped, whitespace collapsed, at most 5,000 characters,
  and lines naming a supplier from `SUPPLIER_NAMES` (`src/routes/copy-rules.ts`) removed. The curated `title` overrides
  CJ's when set. The seller's agent rewrites copy when adding a product anyway.

### What checkout reads

`worker/services/catalog/offers.ts`, backed by `CatalogProductService` in `worker/database/services/`:

```ts
export type CatalogLock =
	| { ok: true; catalogVariantId: string; supplier: CatalogSupplier; supplierVariantId: string; lockedCatalogPriceCents: number }
	| { ok: false; catalogVariantId: string; reason: 'unknown' | 'unavailable' | 'ships_to_unsupported' };

/** Locks the current catalog price of each variant for one destination. */
export function lockCatalogPrices(env: Env, input: { catalogVariantIds: readonly string[]; shipToCountry: string }): Promise<readonly CatalogLock[]>;

export interface CatalogOfferView {
	catalogVariantId: string;
	country: string;
	available: boolean;
	/** Null when the variant has no offer for this country. */
	catalogPriceCents: number | null;
}

/** Current offers of variants for several destinations, for the publish-time minimum price check. */
export function getCatalogOffers(env: Env, input: { catalogVariantIds: readonly string[]; countries: readonly string[] }): Promise<readonly CatalogOfferView[]>;
```

- An offer older than `CATALOG_OFFER_MAX_AGE_HOURS = 72` reads as `unavailable`: if the refresh pipeline stalls,
  Estori stops selling at prices it can no longer vouch for.
- The reasons map to the checkout spec's refusal codes: `unknown` to `unknown_item`, `unavailable` to
  `item_unavailable`, `ships_to_unsupported` to `ships_to_unsupported`.

### When CJ changes a price or stock after a seller added the product

| Change | Paid orders | New checkouts | The seller |
| --- | --- | --- | --- |
| Cost or shipping rises | Unaffected: their price is locked. Estori absorbs a rise between lock and placement | Lock the new price. If the seller's retail price is now below `minimumRetailPriceCents`, checkout refuses that item (`below_minimum_price`) | Daily digest: "raise the price of X to at least $Y and publish" |
| Cost or shipping falls | Unaffected. Estori keeps the difference | Lock the new, lower price | Nothing to do |
| Stock under the buffer | Unaffected; if CJ can't fill it, the placement rejection refunds it | `item_unavailable` until stock returns | Digest lists it as unavailable |
| CJ takes the product or variant off sale | Same as above | `item_unavailable`; the variant is `retired` | Digest: "remove X from your store" |
| Removed from the curated list | Same | `item_unavailable`, product `retired` | Same |

- No automatic repricing: sellers control their prices, and the checkout spec changes live prices only on publish.
- **The seller digest** (daily job, section 5) reads each live store's current version (`store_versions` from the
  checkout spec, with the Live stores record) and checks every catalog variant in its manifest against every ship-to
  country. It emails the seller one message listing what needs action, and only when that list changed since the last
  digest (a hash per store in KV, key `catalog:digest:<appId>`).
- **Requests to the other specs:**
  - `Estori.store()` should mark a catalog variant unavailable when no ship-to country can lock it, so stores show
    "sold out" instead of failing at checkout;
  - the publish check treats a ship-to country with no offer as an error naming the variant and the country.

## 5. Scheduling

### The runner: one Durable Object per catalog order

`worker/services/catalog/CatalogOrderRunner.ts` exports `CatalogOrderRunner extends DurableObject<Env>`, bound as
`CATALOG_ORDER_RUNNER` and addressed by `idFromName(catalogOrderId)`. It follows `UserSecretsStore`'s alarm pattern, and
its decisions live in a pure function, `runnerStep(state, deps, nowMs)` in `worker/services/catalog/runner.ts`, so they
are tested without a Durable Object.

**State** (Durable Object storage, one record):

| Field | Meaning |
| --- | --- |
| `orderId` | The catalog order |
| `placement` | `due`, `done` or `needs-attention` |
| `nextPlacementAt` | When the next attempt may run |
| `refundItemIds`, `refundFailures` | Rejected items still to refund, and failed refund attempts |
| `syncDue`, `syncDisputes`, `lastSyncAt` | A pending re-read of CJ, whether it includes disputes, and the last one |

**RPC methods** (each stores state and sets the alarm, then returns; no CJ call runs inside an RPC):

- `start(orderId)`: idempotent; a second call does nothing.
- `signal({ disputes })`: something changed at CJ; re-read it.
- `retry()`: admin only. Runs one more attempt of the failed phase now: placement, or refunds. If it fails again, the
  order stays `needs-attention`.
- `refundUnplaced()`: admin only. Takes the order's `pending` items, plus `placed` items whose CJ order last read as
  `CANCELLED` (`catalog_supplier_orders.supplier_status`). It marks them `rejected`, refunds them with
  `supplier-rejected`, and sets the order to `placement-done`.
- `snapshot()`: the state, for the admin page.

**One alarm runs these steps in order,** each in its own `try`, so a failure in one never blocks another and the
runtime's own alarm retries aren't triggered:

1. **Placement** (when `due` and its time has come): `placeCatalogOrder({ store, adapters }, orderId)`.
   - `retry`: set `nextPlacementAt = now + delayMs`.
   - `done`: when `rejectedItemIds` isn't empty, queue them for refund. Mark placement `done` and queue a sync.
   - `needs-attention`: mark it and alert the owner.
   - `not-found`: log an error and stop.
2. **Refunds** (when items are queued): `refundCatalogItems({ store, stripe: stripeFromEnv(env) }, { orderId, itemIds,
   reason: 'supplier-rejected' })`, then email the seller which items were refunded and why, as the catalog spec
   requires.
   - On failure, retry after `nextRetryDelayMs(refundFailures)`.
   - After `MAX_PLACEMENT_ATTEMPTS` failures: `store.updateOrder` sets `needs-attention`, keeps the attempt count, and
     stores the last error ("Refund of rejected items failed: ..."). The owner is alerted. The plan's refunds are
     idempotent, so the owner's retry is safe.
3. **Sync** (when due, at most once a minute): read `getOrderDetail`, `trackInfo` when the order has a tracking number,
   and, when asked, the order's disputes. A pure `cjOrderToUpdates(detail, track, disputes, nowMs)` in `cj/updates.ts`
   returns `SupplierUpdate`s:
   - a last-mile number exists: `shipped` with `lastTrackNumber` and `lastMileCarrier`;
   - only CJ's own number exists: wait for the last-mile number, re-syncing every 6 hours. After 48 hours, report
     `shipped` with CJ's number. CJ's numbers can be trackable only on CJ's site, and the plan keeps the first tracking
     number an item gets;
   - the carrier text is the last-mile carrier (USPS, UPS) or "Standard shipping", never CJ's channel name, which can
     contain "CJ";
   - order `DELIVERED` or tracking delivered (A4): `delivered`;
   - a dispute with a refund agreed (webhook status 4, or completed with `refundAmount` above 0): `refunded` for its
     products' `vid`s.

   Each update goes through `applySupplierUpdate(order.items, update)` and `store.patchItems(patches)`. The sync also
   writes `supplier_status` and `synced_at` to `catalog_supplier_orders`.
4. **Next alarm:** the earliest pending time. Nothing pending: no alarm.

**Cases the fixed contract can't express, handled by alert:**

- **CJ cancels a placed order** (it can't fill it after payment and refunds the balance): the shopper should get a
  refund, but `SupplierUpdate` has no such kind and `applySupplierUpdate` never moves `placed` to `rejected`. The runner
  marks the order `needs-attention` ("cancelled by the supplier") and alerts the owner, who uses "Refund unplaced items".
  The contract change that automates this is recommended below.
- **CJ reissues items** (dispute status 5): the seller is emailed the new tracking number. Item status doesn't change,
  since an item can't move back from `delivered`.
- **A supplier refund after the seller already refunded the shopper:** the item is `refunded` with Estori's share 0,
  then CJ returns the money to Estori. The runner alerts the owner to pay the catalog price to the seller (owner
  decision 7).
- **CJ asks for an extra payment** (a `MAKEUP` webhook): the owner is alerted with the amount and reason, and pays or
  disputes it in CJ's dashboard. Estori absorbs it until the catalog plan's saved-card charges exist.

### The handoff from checkout

`scheduleCatalogPlacement(env, orderId)` in `worker/services/catalog/scheduler.ts` calls the runner's `start`. The
checkout spec's `recordStoreOrder` calls it after `recordPaidCatalogOrder` returns `recorded`. A failure is logged, not
thrown, because the hourly sweep below starts any order whose handoff was lost. That also covers a crash between
recording and scheduling: Stripe's redelivery then returns `already-recorded` with no order id.

### Webhooks

`POST /api/catalog/webhooks/cjdropshipping`, public and exempt from CSRF like `/api/stripe/webhook` (`worker/app.ts`).

1. Read the raw body. A body without `messageId` is CJ's registration test: answer 200 and do nothing.
2. Verify `sign` against Base64 HMAC-SHA256 of the raw body keyed with `openId`, compared with `timingSafeEqual`
   (`worker/utils/cryptoUtils.ts`). The `openId` comes from the token record, which is fetched first if none is cached.
   Invalid: 401.
3. Find the CJ order id: `cjOrderId` or `orderId` in `params`, or `orderNumber` through
   `catalog_supplier_orders.supplier_order_number`. Then the catalog order through `catalog_supplier_orders`, falling
   back to `catalog_order_items.supplier_order_id`.
4. `ORDER`, `ORDERSPLIT`, `LOGISTIC` and `DISPUTE_INFO`: `runner.signal({ disputes: type === 'DISPUTE_INFO' })`.
   `MAKEUP`: owner alert. Unknown orders and other topics: logged and ignored.
5. Answer 200. The handler does one KV read, at most two D1 reads and one Durable Object call, well inside CJ's 3
   seconds.

The webhook only says "look again"; the runner re-reads CJ's query API. So duplicates, retries and payload fields
missing from the docs cause at most one extra read, and the query API is the single source of truth.

Registration: the admin page's "Register webhooks" calls `webhook/set` with `order`, `logistics`, `dispute` and
`makeup` enabled, and `product` and `stock` cancelled (prices and stock are polled, and price-only changes aren't pushed
anyway). The URL is `https://<CUSTOM_DOMAIN>/api/catalog/webhooks/cjdropshipping`. An answer of 1606000 (already set)
counts as success. Local dev can't register (CJ refuses localhost) and relies on polling.

### Cron jobs

`worker/index.ts` gains `scheduled(controller, env, ctx)`, which calls `runCatalogSchedule(controller.cron, env)` in
`worker/services/catalog/scheduler.ts` under `ctx.waitUntil`.

| Cron | Job | What it does |
| --- | --- | --- |
| `*/15 * * * *` | Catalog refresh | `refreshCatalogBatch` (section 4) |
| `5 * * * *` | Order reconciliation | Read every CJ order whose items are `placed` or `shipped` (one `getOrderDetailBatch` per 100 orders). Signal the runner of each one whose CJ status or tracking number differs from `catalog_supplier_orders`, or that wasn't synced for 24 hours. Start every `awaiting-placement` order older than 15 minutes with no attempts (the lost handoff sweep). Alert on orders `placed` for more than 5 days or `shipped` for more than 30 |
| `5 * * * *` | Balance | `getBalance`; alert when `amount - freezeAmount` is under `CATALOG_SUPPLIER_LOW_BALANCE_CENTS`. Store the balance and points in KV `catalog:health` for the admin page |
| `35 6 * * *` | Daily health | Read `setting/get`; when the order callback isn't enabled (a topic CJ closed), re-register and alert. Signal orders with disputes created in the last 30 days (`getDisputeList`). Alert when no refresh succeeded in 24 hours. Send seller digests |

Each run stays well inside a Cron Trigger's time limit: the 15-minute job takes about a minute, and the others make a
handful of calls.

### Alerts

`worker/services/catalog/alerts.ts` sends email through `createEmailSender(env)` (`worker/services/email/sender.ts`),
with templates in `worker/services/email/templates.ts`.

- **To the owner:** every address in `PLATFORM_ADMIN_EMAILS` (`worker/services/auth/admin-access.ts`). No new variable.
- **Throttle:** one email per kind and subject per 24 hours, with a KV marker `catalog:alert:<kind>:<subject>` that
  expires after 24 hours. Order alerts use the order id as subject, so each order alerts once.
- **Kinds:** `needs-attention`, `low-balance`, `supplier-account`, `held-order`, `refund-failed`, `supplier-cancelled`,
  `supplier-refund-after-seller-refund`, `extra-charge`, `cost-above-locked`, `webhook-closed`, `refresh-stalled`,
  `not-shipped`, `not-delivered`.
- Each email names the order or product, the reason, and links to `/admin/catalog`.
- **To sellers:** rejected-and-refunded items, the daily digest and reissue tracking, at the seller's account email.
  These never name the supplier.

## 6. Deployment config (owner action)

Agents never commit `wrangler.jsonc`, because the owner's copy carries local dev overrides. This change is the owner's.

### `wrangler.jsonc`: apply and commit on plan 2's branch

Add to `durable_objects.bindings`:

```jsonc
{
    "class_name": "CatalogOrderRunner",
    "name": "CATALOG_ORDER_RUNNER"
}
```

Add after the `v6` entry in `migrations`:

```jsonc
{
    "new_sqlite_classes": [
        "CatalogOrderRunner"
    ],
    "tag": "v7"
}
```

Add at the top level:

```jsonc
"triggers": {
    "crons": ["*/15 * * * *", "5 * * * *", "35 6 * * *"]
}
```

### What the implementing agent commits alongside

- **`wrangler.estori.jsonc`,** the production config, gets the same three additions. Agents have committed this file
  before (4b11f75), and `scripts/estori-config.test.ts` requires its Durable Objects and migrations to equal
  `wrangler.jsonc`'s. So CI fails until the owner's `wrangler.jsonc` commit is on the branch, and that commit is a merge
  prerequisite.
- **`scripts/estori-config.test.ts`** gains an assertion that the production crons equal the three above.
- **`worker-configuration.d.ts`:** the agent applies the hunk to its worktree's clean `wrangler.jsonc` only to run
  `npm run cf-typegen` and the tests, reverts it, and commits the regenerated types. Generating from the clean tracked
  file keeps the owner's local overrides out of the types.
- **`worker/types/env.d.ts`** declares `CJ_API_KEY?: string`, since `wrangler types` omits secrets.
- `wrangler.staging.jsonc` is upstream's staging config, unused by Estori, and stays unchanged.

### Tests: `wrangler.test.jsonc`

`wrangler.test.jsonc` is the Vitest pool's config (`vitest.config.ts`). It carries no local overrides: on 2026-10-15 it
is identical in the main checkout and in the worktrees, and only upstream commits have changed it. This spec proposes
that the implementing agent edit it (owner decision 9):

- add `{ "class_name": "CatalogOrderRunner", "name": "CATALOG_ORDER_RUNNER" }` to its bindings;
- add `{ "new_sqlite_classes": ["CatalogOrderRunner"], "tag": "v3" }` to its migrations;
- export the class from `test/worker-entry.ts`, and type the binding in a `cloudflare:test` `ProvidedEnv` declaration
  next to the runner, as `worker/services/secrets/test-env.d.ts` does.

If the owner declines, the Durable Object shell gets no integration test. `runnerStep` keeps full coverage, and a
wiring test checks the export and the binding name.

### Other owner steps

- `CJ_API_KEY` in production (`wrangler secret put CJ_API_KEY --config wrangler.estori.jsonc`) and in `.dev.vars`.
- A Cloudflare Access bypass for `/api/catalog/webhooks/cjdropshipping`, like the Stripe webhook's, while estori.app is
  behind Access.
- Apply the migration to production D1 before the Worker deploy, as for earlier releases.

## 7. Operations

### Funding Estori's CJ balance

- **The money path:** application fees reach Estori's Stripe balance and pay out to Estori's bank. The owner tops up the
  CJ wallet from there (Payoneer and wire transfer per CJ's payment page; PayPal through a CJ agent; confirm current
  methods in the CJ dashboard).
- **The float:** orders are placed at once, but Stripe pays out days later. The balance must cover a stretch of orders
  on its own (owner decision 3).
- **Low balance:** the hourly check alerts under `CATALOG_SUPPLIER_LOW_BALANCE_CENTS`, and a `1604000` from a placement
  alerts at once. Orders keep retrying on the plan's schedule, so a top-up within about four hours places them without
  any action. After that they are `needs-attention`, and "Retry" places them.

### Packaging and the seller's name

What the API offers, and what it doesn't:

- No order field sets a sender or brand per order. `storeName` must match a store connected to the CJ account, so it
  can't carry each seller's name.
- CJ's custom packaging is bought per product (SKU), and printed inserts have minimum quantities, as CJ's packaging
  service is described today. Neither can vary by seller in one shared account.
- The label's sender is CJ's warehouse or a consolidator.

So "ships under the seller's store name" is achievable in what the shopper reads from Estori, not on the parcel:

- the order confirmation and the store's receipt carry the store's name;
- tracking shows the last-mile carrier and number, never CJ's channel name;
- product images are served from Estori.

The parcel itself is neutral, provided the owner sets a standing instruction with Estori's CJ agent: no invoice or prices,
no CJ marketing inserts (A6). Owner decision 5 covers branded packaging.

### Supplier refunds and disputes

- **Who files:** at launch, the owner files disputes in CJ's dashboard when a seller reports a damaged, wrong or missing
  catalog item (to support@estori.app). The volume is low, and CJ's dispute API (create, reply, attach) can back an admin
  action later.
- **How results arrive:** a `DISPUTE_INFO` webhook or the daily dispute sweep signals the runner, whose sync turns an
  agreed refund into `refunded`, setting `supplierRefunded` on the items.
- **How it feeds the catalog rules:** when the seller later refunds the shopper, `refundCatalogItems` with
  `seller-refund` returns Estori's catalog price, because `supplierRefunded` is true (the plan's `itemRefundSplit`).
- **If the seller refunded before CJ did:** see owner decision 7. The claim window is owner decision 8.
- **Reissues:** CJ ships again under a new tracking number, which goes to the seller (section 5).

### The admin page

`/admin/catalog` (`src/routes/admin/catalog.tsx`), for admins only (`AuthConfig.admin`), following
`src/routes/admin/reviews.tsx`. Internal, so it may name CJ.

- **Health:**
  - mode (live or sandbox), token status, balance, points left;
  - webhook status, last successful refresh;
  - active and unavailable product counts.
- **Orders needing attention:**
  - each `needs-attention` catalog order with its last error, attempts and runner state;
  - "Retry" and "Refund unplaced items", each with a confirmation.
- **"Register webhooks."**

API, in `worker/api/routes/catalogRoutes.ts` with controllers in `worker/api/controllers/catalog/`, types in
`src/api-types.ts` and calls in `src/lib/api-client.ts`:

- `GET /api/admin/catalog/health`;
- `GET /api/admin/catalog/orders?status=needs-attention`;
- `POST /api/admin/catalog/orders/:id/retry`;
- `POST /api/admin/catalog/orders/:id/refund-unplaced`;
- `POST /api/admin/catalog/webhooks`.

## 8. Data, interfaces and testing

### Files

| File | Plan | Purpose |
| --- | --- | --- |
| `shared/types/catalog.ts` (modify) | 1 | `CATALOG_DESTINATIONS`, `CATALOG_PRODUCT_STATUSES`, `CATALOG_OFFER_UNAVAILABLE_REASONS` |
| `worker/services/catalog/config.ts` | 1 | Worker-only constants: intervals, batch sizes, stock buffer, delivery limit, offer age, points reserve, low-balance threshold |
| `worker/services/catalog/cj/client.ts`, `cj/errors.ts`, `cj/session.ts`, `cj/types.ts` | 1 | Client, error classes, token cache, CJ response types |
| `worker/services/catalog/curated.ts` | 1 | The curated list |
| `worker/services/catalog/refresh.ts`, `offers.ts`, `money.ts` | 1 | Refresh batch, offer selection and locks, `usdToCents` |
| `worker/database/schema.ts` (modify), one migration per plan | 1 and 2 | The catalog tables (plan 1) and `catalog_supplier_orders` (plan 2) |
| `worker/database/services/CatalogProductService.ts` | 1 | Products, variants, offers, claims |
| `worker/api/controllers/catalog/images.ts`, `worker/api/routes/catalogRoutes.ts` | 1 | Public image route |
| `worker/services/catalog/scheduler.ts`, `worker/index.ts` (modify) | 1 and 2 | `runCatalogSchedule` and `scheduled`: the refresh job in plan 1; reconciliation, balance, daily health and `scheduleCatalogPlacement` in plan 2 |
| `worker/types/env.d.ts` (modify) | 1 | `CJ_API_KEY` |
| `worker/services/catalog/cj/adapter.ts`, `cj/address.ts`, `cj/order-number.ts`, `cj/updates.ts`, `cj/webhook.ts` | 2 | Adapter, address mapping, order number, CJ order to updates, signature and parsing |
| `worker/services/catalog/runner.ts`, `CatalogOrderRunner.ts`, `alerts.ts`, `seller-digest.ts` | 2 | Runner logic and shell, alerts, digest |
| `worker/database/services/SupplierOrderService.ts` | 2 | `catalog_supplier_orders`, lookups by CJ id or number, open orders, needs-attention list |
| `worker/api/controllers/catalog/webhook.ts`, `admin.ts`, `catalogRoutes.ts` (modify) | 2 | Webhook and admin API |
| `worker/app.ts`, `worker/index.ts` (modify) | 2 | CSRF exemption; runner export |
| `src/routes/admin/catalog.tsx`, `src/api-types.ts`, `src/lib/api-client.ts` | 2 | Admin page |

No `any`; tabs in `shared/` and `worker/services/`, four spaces in `worker/database/`.

### Interfaces to the other pieces

- **From checkout:**
  - `lockCatalogPrices` when a checkout starts;
  - `getCatalogOffers` when a store is published;
  - `scheduleCatalogPlacement(env, orderId)` after `recordPaidCatalogOrder` returns `recorded`.
- **To the catalog plan:** the adapter, wired as `adapters: { cjdropshipping }`. The runner calls `placeCatalogOrder`,
  `refundCatalogItems` and `applySupplierUpdate` exactly as the plan defines them.
- **To store order pages and receipts (checkout spec):** catalog tracking stays in `catalog_order_items`, found through
  the shared Checkout session id (or `store_order_id` once the plan's later migration adds it). This spec doesn't write
  `store_orders`: a mixed cart has two shipments, and one tracking field can't hold both.
- **To the add-to-store piece:** `catalog_products`, `catalog_variants` and the image route, plus the rule that store
  manifests carry `catalogVariantId` (checkout spec).

### Testing

All with `rtk proxy npx vitest run <files>`, a few files at a time.

- **Client** (`fetch` faked as in `stripe-client.test.ts`; KV faked with a `Map` behind `Pick<KVNamespace, 'get' | 'put'
  | 'delete'>`):
  - the token is fetched once and reused from KV, and a second client instance reads it without calling CJ;
  - the stored value is ciphertext, and a different `CJ_API_KEY` can't decrypt it;
  - 1600001 refetches the token and repeats the call once, never twice;
  - HTTP 200 with a non-200 `code` is an error;
  - each row of the classification table;
  - calls are spaced by the minimum interval (with an injected clock).
- **Adapter:**
  - paid on the first attempt: create with `payType` 3 and the sandbox flag outside production, pay, confirm, `ok`,
    `onOrderPaid` called once;
  - timeout after CJ created and paid: the next call finds the order by number and returns `ok` without creating;
  - 1603003: lookup, then pay an unpaid order whose lines match;
  - an unpaid order whose lines don't match is never paid;
  - out of stock without named variants: the per-line check names them, and none named gives an empty list;
  - unknown variant, no freight option, cancelled order: `rejected`;
  - insufficient balance: `retryable` with one balance alert;
  - an intercepted order: `retryable` and an alert, never paid;
  - address mapping: cut lengths, `region` fallback, phone cleanup, no email;
  - order number: stable under line order, different for different lines, at most 50 characters.
- **Runner** (`runnerStep` with the plan's `memoryCatalogStore`, a scripted adapter and a fake Stripe):
  - `retry` sets the next time from `delayMs`;
  - `done` with rejections refunds exactly those items with `supplier-rejected` and emails the seller once;
  - a failed refund backs off, then becomes `needs-attention` after `MAX_PLACEMENT_ATTEMPTS`;
  - `start` twice runs one placement;
  - `retry()` resumes the failed phase only;
  - a sync applies `shipped` then `delivered`;
  - a CJ cancellation alerts and marks `needs-attention`.
- **`cjOrderToUpdates`:** last-mile tracking preferred, carrier text never containing a supplier name, delivered from
  either source, refunds only for agreed disputes.
- **Webhook:**
  - a valid signature (computed in the test with WebCrypto) signals the right runner;
  - a bad signature answers 401 and signals nothing;
  - the registration probe answers 200;
  - an unknown order answers 200;
  - a `MAKEUP` alerts.
- **Refresh and offers:**
  - the claim query skips claimed products;
  - offer selection by delivery limit, then price, then time;
  - stock under the buffer is unavailable;
  - an offer older than 72 hours locks as unavailable;
  - a margin change reprices from stored inputs;
  - the points reserve stops the batch;
  - `usdToCents("4.27")` is 427 and `usdToCents("0.1")` is 10.
- **Schema:** the tables, the unique indexes and the migration, as in `worker/database/catalog-schema.test.ts`.
- **Wiring guards,** like `worker/api/controllers/payments/payments-wiring.test.ts`:
  - the webhook route is public and CSRF-exempt;
  - admin routes require `AuthConfig.admin`;
  - `worker/index.ts` exports the runner and `scheduled`;
  - no seller-facing template or carrier text contains a name from `SUPPLIER_NAMES`.
- **Runner shell** (if owner decision 9 allows): `start` sets an alarm, and the alarm runs a placement against a faked
  adapter.

## Launch prerequisites

1. The catalog order payments plan, shopper checkout and Live stores are built.
2. The owner opens Estori's CJ account under the operating company, creates the API key, and sets `CJ_API_KEY`.
3. The curated list holds the first products (owner decision 1), and the refresh has priced them.
4. **A sandbox run** with the real key locally (sandbox mode outside production):
   - a catalog order is placed, paid by simulation, moved to shipped with a tracking number, then delivered with the
     sandbox endpoints;
   - the runner records each step;
   - a forced rejection refunds in Stripe test mode;
   - assumptions A1 to A5 and A9 are confirmed, or the adapter is adjusted as each row says.
5. The CJ wallet is funded (owner decision 3), and the neutral-packaging instruction is confirmed with CJ (A6).
6. The config change in section 6 is committed and the migration applied. The Access bypass is in place, and the
   webhooks are registered from the admin page.
7. The catalog spec's legal and tax review is done.

## Risks

- **CJ's per-IP limit.** Each IP may serve at most 3 CJ accounts, and Workers send requests from addresses shared with
  other Cloudflare customers, some of whom may call CJ. The client treats CJ's message as `throttled` and counts it in
  the `catalog:health` record, and the daily health job alerts when it exceeds 5% of the day's calls. The fallback, a
  fixed-IP egress proxy, is owner decision 10.
- **One account, one supplier.** A suspended or restricted CJ account stops every catalog order. Every account-level
  error alerts at once.
- **One request a second at Free level.** Fine at launch volumes. A higher CJ level raises it, and
  `CJ_MIN_CALL_INTERVAL_MS` follows.
- **Webhook topics close themselves** after two bad hours. The daily health check re-registers them, and the hourly
  reconciliation keeps tracking current meanwhile.
- **Split shipments.** CJ may ship one order in several parcels. Items then show the first tracking number, and the
  other numbers are visible only to the owner in CJ's dashboard. This is rare with one origin warehouse; the owner
  forwards the numbers when a seller asks.
- **The docs have gaps** (A1 to A10). The sandbox run settles the ones that matter before launch.

## Recommended changes to the contract

The contract is implemented exactly as fixed. Two changes would remove manual steps, and both are small.

1. **Add a `cancelled` update:**

   ```ts
   | { kind: 'cancelled'; supplierOrderId: string; supplierVariantIds: readonly string[]; reason: string }
   ```

   `applySupplierUpdate` would move matching `placed` items (not yet shipped) to `rejected`, and the runner would refund
   them with `supplier-rejected`, as for a rejection at placement.

   Why: CJ can cancel a paid order it can't fill and refund Estori's balance. Today the contract can't say so, and the
   runner hands it to the owner. `supplierVariantIds` matches `refunded`'s shape.

2. **Let a repeated `shipped` replace tracking.** `applySupplierUpdate` would patch the tracking number and carrier of
   an item already `shipped` when they differ, without changing its status. This changes the plan, not the types.

   Why: CJ often reports its own number first and the last-mile number later, and today's "never move backwards" rule
   keeps the first one. Without the change the runner holds a CJ-only number for up to 48 hours (section 5), so items
   show no tracking during that time. With it, the runner reports CJ's number at once and replaces it when the
   last-mile number arrives, or when CJ reships.

## Owner decisions

1. **Which products to curate first.**
   - **Recommendation:**
     - 50 to 100 products in 3 or 4 categories: home and kitchen, pet supplies, desk and phone accessories, fitness
       accessories;
     - all in CJ's US warehouses with at least 100 units;
     - under 1 kg, not fragile;
     - no batteries, liquids, cosmetics, supplements, children's products or brand-name goods.
   - **Trade-off:** a small, reliable catalog with fast delivery and few returns, against the breadth sellers may
     expect. CJ's US stock is a fraction of its catalog.
2. **Curation in code or in an admin page.**
   - **Recommendation:** the curated list in code, changed by PR.
   - **Trade-off:** a deploy per change (which the owner approves anyway), against building an import page now.
3. **CJ funding and the low-balance alert.**
   - **Recommendation:** fund $500 at launch and set `CATALOG_SUPPLIER_LOW_BALANCE_CENTS` to $150. Raise the balance to
     about two weeks of catalog spend once orders flow.
   - **Trade-off:** cash held at CJ, against orders waiting for a top-up. A wire takes days, so a thin balance means
     `needs-attention` orders and late shipments.
4. **Regions.**
   - **Recommendation:** catalog items ship to the US only, from US warehouses.
   - **Why:**
     - domestic delivery in days;
     - no import duties, now that the US de minimis exemption is suspended;
     - no EU import VAT registration (IOSS);
     - one origin per order.
   - **Trade-off:** stores that ship elsewhere can't sell catalog items to those countries. Each new region needs its own
     freight, duty and tax review.
5. **Packaging.**
   - **Recommendation:** neutral packaging for every order, by standing instruction with CJ, and the seller's name only
     in Estori's emails, receipts and store pages. Seller-branded packaging can come later as a premium option, bought
     per SKU by the seller.
   - **Trade-off:** the parcel doesn't show the seller's brand, against custom packaging that a shared account can't
     offer per seller.
6. **The contract changes above.**
   - **Recommendation:** adopt both, in the catalog plan before it is implemented.
   - **Trade-off:** a small change to a fixed interface, against manual refunds for every CJ cancellation and stale
     tracking numbers.
7. **A supplier refund that arrives after the seller already refunded the shopper.**
   - **Recommendation:** Estori pays the catalog price to the seller with a Stripe transfer, since Estori got its money
     back from CJ. At launch the runner alerts and the owner pays it by hand; automation follows if it happens often.
   - **Trade-off:** fairness to sellers who refund quickly, against one more money movement. Without it, Estori keeps
     money the seller paid out.
8. **The seller claim window for catalog problems** (damaged, wrong or missing items).
   - **Recommendation:** 14 days after delivery, stated in the seller terms. The owner files the CJ dispute within 2
     business days of a claim.
   - **Trade-off:** a window long enough for sellers to collect shopper reports, against CJ's undocumented dispute
     window (A10). A longer window risks claims CJ no longer accepts, which Estori would then absorb.
9. **Editing `wrangler.test.jsonc`.**
   - **Recommendation:** allow agents to edit it. It carries no local overrides, unlike `wrangler.jsonc`.
   - **Trade-off:** an integration test of the runner's Durable Object shell, against keeping every wrangler file
     owner-only.
10. **A fixed-IP egress proxy for CJ calls.**
    - **Recommendation:** don't build one now. Revisit only if the per-IP alert fires.
    - **Trade-off:** a server to run and pay for, against occasional throttled calls, which are retried anyway.
