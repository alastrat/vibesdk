# Catalog order payments — design

Status: approved in conversation on 2026-10-15; awaiting review of this written spec.

## Context

Estori's catalog ("Catalog & fulfillment" on the public site, `product-catalog` in `src/lib/capabilities.ts`) lets sellers
add products from large dropshipping suppliers to their stores. The owner decided:

- Estori's own supplier account places catalog orders by API (CJdropshipping first). Sellers do not connect supplier
  accounts by default; connecting their own ("bring your own", BYO) is a premium option.
- Estori runs no warehouse. Suppliers ship catalog orders; sellers ship their own products.
- Estori never holds sellers' money. Instead of a prepaid wallet, Estori takes each catalog order's cost from the
  shopper's payment as a Stripe Connect application fee. AI credits stay a separate plan allowance and are untouched.
- Estori's margin is built into the catalog price. Everything is in US dollars at launch.

This spec covers only the money flow of catalog orders. It depends on two pieces with their own specs:

1. **Shopper checkout in generated stores** (prerequisite): shoppers pay a seller's store through Estori's Stripe
   Connect. It produces the payment this spec takes the fee from.
2. **Supplier connection** (CJdropshipping adapter): catalog data, placing supplier orders, tracking and supplier refunds.

Out of scope: those two pieces, browsing and adding catalog products, store order pages, and pricing page copy.

## Goals

- A shopper's payment for catalog items pays the supplier, Estori's margin and Stripe's processing, with no prepaid
  balance and no money held for sellers.
- Every catalog order is recorded once, with its fee, supplier order and tracking.
- Failures (supplier rejection, refunds, chargebacks, extra costs) have one defined outcome each.

## Money flow

The same Connect setup as template sales (`worker/services/payments/stripe-client.ts`): Express connected accounts and
destination charges with `application_fee_amount` and `transfer_data.destination`.

1. The shopper pays the store's total in a Checkout session created on Estori's platform account, with the seller's
   Express account as the destination.
2. Stripe transfers the payment to the seller, minus the application fee, which goes to Estori. On destination charges
   Estori pays Stripe's processing fee, so the application fee includes it.
3. Estori places the supplier order from its own supplier account, funded by the fees it collected.

## Pricing

- Each catalog variant has a **catalog price** in US cents for a destination country:
  `supplier cost + supplier shipping to that country + Estori margin`. The margin is a percentage of supplier cost plus
  shipping, set by the owner in one constant (`CATALOG_MARGIN_PERCENT`) in a new `shared/types/catalog.ts`, which holds
  every catalog fee constant, as `shared/types/templates.ts` does for template fees.
- The catalog price is **locked when checkout starts** and stored on the order, so later supplier price changes never
  alter an order in progress. A Checkout session lives 35 minutes, as template sales' sessions do.
- **Minimum retail price:** a seller's price for a catalog variant must be at least
  `catalog price + processing fee on that price`, so the application fee is always below the payment, as Stripe
  requires. The store builder enforces it when a price is set; checkout checks it again and refuses a cart that breaks it.

## The application fee

For a cart with total `T` (cents), catalog line items `i` with locked catalog price `c_i` and quantity `q_i`:

```
catalogTotal   = Σ c_i × q_i
processingFee  = round(T × CATALOG_PROCESSING_PERCENT / 100) + CATALOG_PROCESSING_FIXED_CENTS
applicationFee = catalogTotal + processingFee
```

- `CATALOG_PROCESSING_PERCENT` and `CATALOG_PROCESSING_FIXED_CENTS` are Stripe's standard US card rate (2.9% and 30¢).
  Estori absorbs the difference when Stripe charges more (international cards, currency conversion).
- A cart of only the seller's own products has `catalogTotal = 0`; the fee is the processing fee alone.
- BYO (premium) catalog items count `c_i` as Estori's per-order fee only, since the seller's supplier account pays the
  supplier. The per-order fee is one constant, `BYO_ORDER_FEE_CENTS`.
- `applicationFeeCents(cart)` is a pure function in `shared/`, used by checkout and covered by tests.

## Order lifecycle

Stripe's webhook (`worker/api/controllers/payments/webhook.ts`) already verifies signatures and records each Checkout
session once. Catalog orders follow the same pattern:

| Event | Action |
| --- | --- |
| `checkout.session.completed` / `async_payment_succeeded` with catalog items | Record a `catalog_order` (status `paid`) with its items and locked prices, once per session; then place one supplier order per supplier |
| Supplier accepts the order | Status `placed`; store the supplier order id |
| Supplier sends tracking | Status `shipped`; store tracking number and carrier on the order and the seller's store order |
| Supplier reports delivery | Status `delivered` |
| Supplier rejects the order, or an item is out of stock | Status `rejected` for those items; refund them (see below) |

Placing supplier orders runs after the webhook answers, in a Durable Object per catalog order that retries with
alarms (the pattern `worker/services/secrets/UserSecretsStore.ts` uses), so a slow supplier never makes Stripe retry the
webhook. An order that still fails after retries is `needs_attention` and alerts
the owner.

## When things go wrong

- **Supplier rejects or can't fill items:** Estori refunds the shopper for those items with `reverse_transfer` and
  `refund_application_fee`, so the seller's share and Estori's fee both come back. The seller is notified.
- **Seller refunds a shopper:** the seller's share is reversed. Estori returns its fee for an item only when the supplier
  refunds Estori (damaged, wrong or missing items); otherwise the seller bears the cost, as in any shop.
- **Chargebacks:** on destination charges Estori's platform balance is debited first. Estori recovers the amount by
  reversing the seller's transfer, and files a claim with the supplier for items that never arrived.
- **Extra costs** (a reshipment, a shipping surcharge from the supplier): one off-session payment on the card the seller
  saves when they enable the catalog (a Stripe SetupIntent at that moment). Sellers without a saved card can't enable
  the catalog.

## Data

D1 tables, with services in `worker/database/services/` following existing patterns:

- `catalog_orders`: id, seller user id, store app id, checkout session id (unique), payment intent id, status,
  catalog total cents, application fee cents, created and updated times.
- `catalog_order_items`: order id, supplier, supplier product and variant ids, quantity, locked catalog price cents,
  supplier order id, status, tracking number, carrier.
- `catalog_billing`: seller user id, Stripe customer id and saved payment method for extra costs, enabled time.

AI credits, `template_purchases` and `stripe_connect_accounts` don't change.

## Interfaces to the other pieces

- **From shopper checkout:** a cart of line items, each marked catalog (with variant id and destination country) or own
  product, and the seller's connected account. This spec supplies `applicationFeeCents(cart)` and the minimum retail
  price rule; checkout puts the fee on the Checkout session.
- **To the supplier connection:** `placeOrder(items, shippingAddress)`, `getTracking(orderId)` and supplier refund events.
  Estori's supplier credentials live in Worker secrets, never in D1.

## Testing

- Pure-function tests for `applicationFeeCents`, the minimum retail price rule and each refund rule (supplier refund or
  not, BYO or not).
- Webhook tests in the style of `worker/api/controllers/payments/webhook.test.ts`: a paid session records one catalog
  order, a duplicate delivery records nothing, and a supplier rejection refunds the right items with both reversals.
- Supplier placement retries and the `needs_attention` outcome, with the supplier adapter faked at its interface.

## Launch prerequisites

- Shopper checkout in generated stores is live.
- The CJdropshipping adapter is live with Estori's account funded.
- Legal and tax review of Estori reselling goods to sellers: sales tax or VAT, import duties, refund terms.
- The owner sets `CATALOG_MARGIN_PERCENT` and `BYO_ORDER_FEE_CENTS`.
