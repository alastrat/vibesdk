# Seller orders: the Orders page and the new-order email

To be built on `feat/seller-orders`, cut from `main` 3e6fd39.

## 1. Purpose

Sellers can't see their orders in Estori, and nothing tells them when one comes in.
- `GET /api/stores/:id/orders` and the refund API exist, but no page uses them.
- Nothing writes `store_orders.fulfillment_status`, `tracking_number` or `carrier`, so every order stays `unfulfilled`.
- A seller who sells their own products has no way in Estori to learn what to ship, or where.
- The shopper order access spec (2026-10-18) needs a seller "Mark shipped" before shoppers can see shipping status for those products.

**Done means:**
1. A seller gets an email for each new order, with a button that opens it.
2. The order shows what to ship and where.
3. The seller marks it shipped, with tracking, or refunds lines.
4. Everything the shopper paid for is visible, and catalog items read as "Estori ships", with their progress.

## 2. Owner decisions (2026-10-18)

1. **One Orders page for all of a seller's stores**, in the app sidebar, with a store filter. A tab per store and a section in Profile were rejected.
2. **Test orders are hidden** behind a "Show test orders" switch.
3. **Test orders get the new-order email**, with "[Test]" in the subject.
4. **At most 100 new-order emails per seller per day.**

## 3. Where it lives

- A sidebar item, **Orders**, after Catalog, for every signed-in user. Builders who don't sell see the empty state.
- Routes: `/orders` (the list) and `/orders/:id` (one order), both inside `ProtectedRoute`. The email links to `/orders/:id`.
- Shared path constants `SELLER_ORDERS_PATH = '/orders'` and `sellerOrderPath(id)` keep the routes, the sidebar and the email link in step.

## 4. The list: `/orders`

**Views**
- **To ship** (default). An order is to ship when all of these hold:
  - its payment is `paid` or `partially_refunded`;
  - `fulfillment_status` is `unfulfilled`;
  - it has at least one `own` line with no `store_refunds` row.

  Catalog-only orders never show here.
- **All:** every order.

**Filters**
- **Store:** All, or one of the stores the seller has orders in.
- **Show test orders:** off by default, so the list shows live orders only. On, it shows live and test orders together, and test ones carry a Test badge.
- While test orders are hidden and some exist, the empty state says so and offers the switch.

**Order and paging:** newest first. Pages of 50 with Load more. Paging goes by (`created_at`, `id`), as on the admin catalog-orders page.

**Columns**
- Order: number and date, linking to the order.
- Store.
- Customer: name and email.
- Items: a count, such as "3 items, 2 to ship".
- Total.
- Payment: Paid, Partly refunded, Refunded, Disputed or Dispute lost.
- Shipping: "To ship" or "Shipped" for own products, and "Estori ships" for catalog items. An order with both shows both, such as "To ship · Estori ships 1".

**Phones:** under 640px, each row becomes a card with the same fields.

**Empty states**
- To ship: "Nothing to ship. Orders with items you ship yourself show up here."
- All: "No orders yet. Orders from your stores show up here once shoppers buy."

## 5. One order: `/orders/:id`

**Header:** "Order #1042", the store name, the date, the payment status and, for test orders, a Test badge.

**Banners**
- **Flagged at payment** (`needs_attention` is set): "Check this order before you ship: {reason}." The reason is the text Estori stored when the payment didn't match the order.
- **Disputed:** "The shopper's bank is reviewing this payment ({amount})."
- **Dispute lost:** "The shopper's bank sided with them. The amount and Stripe's dispute fee came out of your sales."

**Customer:** name, email (a `mailto:` link) and phone, when Stripe collected one.

**Ship to:** the full address, with a Copy button. The seller is the merchant and needs it to ship.

**Note:** the shopper's order note, when there is one.

**Items**, in two groups:
- **You ship:** own lines, with name, quantity, unit price and line total. A refunded line reads "Refunded".
- **Estori ships:** catalog lines, with name, quantity, price, catalog status and tracking.
  - The status comes from `CatalogOrderService.progressForSessions`, matched by catalog variant.
  - `pending` and `placed` read Preparing; `shipped`, Shipped; `delivered`, Delivered; `rejected` and `refunded`, Refunded; `withheld`, On hold.
  - The carrier text never names a supplier.

**Shipment:** only when the order has own lines.
- Not shipped: a **Mark shipped** form (section 6).
- Shipped: "Shipped on {date}", with the carrier and tracking number, plus Edit and "Mark as not shipped".

**Money**
- Paid by the shopper: `total_cents`.
- Estori's fee: `application_fee_cents`. It covers processing and the catalog cost of catalog items.
- Refunded: `refunded_cents`.
- Your share: total minus fee minus refunded, the same sum `salesVolumeSince` uses.
- A line under it says payouts follow the seller's payout schedule.

**Refund items:** a button that opens a dialog (section 7).

## 6. Mark shipped

- **Request:** `POST /api/orders/:id/shipment`.
  - `{ shipped: true, carrier, carrierName?, trackingNumber? }` marks the order shipped.
  - `{ shipped: false }` marks it not shipped again.
- **Fields**
  - `carrier` is one of `usps`, `ups`, `fedex`, `dhl` or `other`, or null.
  - `carrierName` is required with `other`, up to 40 characters.
  - `trackingNumber` is up to 64 letters, digits, spaces and hyphens, or null.
  - The stored carrier is its display name (USPS, UPS, FedEx, DHL, or the typed name).
- **Shipped:** sets `fulfillment_status = 'fulfilled'`, `carrier`, `tracking_number` and `shipped_at`. Sending it again edits the carrier and tracking and keeps the first `shipped_at`.
- **Not shipped:** sets `unfulfilled` and clears the carrier, tracking and `shipped_at`.
- **Refused (409)**, each with a message:
  - an order with no own lines: "Estori ships everything in this order";
  - an order whose own lines are all refunded;
  - a fully refunded order.
- **Response:** the updated order (section 9).
- **Scope:** one shipment per order covers all of its own items. Split shipments aren't in this spec.

## 7. Refunds

- The dialog lists the lines with no refund yet, own and catalog, each with a checkbox and amount, and the selected total.
- Confirming calls the existing `POST /api/stores/:appId/orders/:orderId/refunds` with the line numbers and a `requestId` made once per attempt (`crypto.randomUUID()`).
- The existing endpoint's answers show as they are:
  - **409 balance short:** "Your Stripe balance is $X short…";
  - **400 already refunded:** a message saying so.
- On success the order reloads.
- No new backend behavior: refunds keep their current rules (the seller pays; catalog lines go through the catalog refund).

## 8. The new-order email

**Trigger**
- `RecordStoreOrderDeps` gains `notifyNewOrder(orderId: string): Promise<void>`.
- `recordStoreOrder` calls it right after `recordOrder` answers `recorded`. The webhook and the return page both call `recordStoreOrder`, and only the first records the order, so the email goes once.
- A redelivered webhook answers `already-recorded` and sends nothing.
- `notifyNewOrder` never throws. A failure is logged, and the order, its catalog hand-off and its settlement go on.

**Recipient:** the seller's account email (`users.email`). A seller with no email gets nothing.

**Subject:** `New order #1042 at {store}: $45.99`, or `[Test] New order #1042 at {store}: $45.99` for test orders. `{store}` is the app's title, up to 60 characters.

**Body** (`renderEmail`)
- Heading: "You have a new order".
- Details:
  - Items: one line per order line, such as "2 × Oolong, 100 g".
  - Total, and your share (total minus Estori's fee).
  - Ship to: name, city, region and country. The street isn't included.
  - Note, when there is one.
- **What to do**
  - Own lines: "Ship these items: {names}. Mark the order shipped in Estori when they're on their way."
  - Catalog lines: "Estori ships {names}. You don't need to do anything for these."
  - Test orders: "This was a test order. No money was charged and nothing ships."
- Button: "Open the order", linking to `{configuredBaseUrl}/orders/{id}`. Without a base URL, there's no button.
- Footer: "You get this email for every order in your stores."

**Daily cap**
- A KV counter `seller-order-emails:{sellerUserId}:{YYYY-MM-DD}` (UTC), kept 2 days.
- The cap counts test and live orders together.
- At 100 that day, the email isn't sent and that's logged; the order still shows on the page.
- KV isn't atomic, so a burst may send a few over. That's acceptable.

**Code**
- `worker/services/store-payments/order-emails.ts` holds `notifySellerOfNewOrder(deps, orderId)`. Its dependencies are the order view, the store title, the seller's email, the sender, KV and the base URL, all passed in for tests.
- The template is `sellerNewOrderEmail` in `templates.ts`.
- It's transactional, so it has no unsubscribe link. Turning it off is not in this spec.

## 9. API

All three routes are `AuthConfig.authenticated`. Every query is scoped to `seller_user_id = <signed-in user>`, so another seller's order answers 404.

| Method and path | Does |
| --- | --- |
| `GET /api/orders?view=to-ship\|all&store=<appId>&mode=live\|all&cursor=` | `SellerOrdersData` |
| `GET /api/orders/:id` | `SellerOrderDetail` |
| `POST /api/orders/:id/shipment` | Marks the order shipped or not; answers `SellerOrderDetail` |

- **Validation:** an unknown view, mode or cursor gets 400. A store filter for an app the seller has no orders in returns an empty list.
- **Types** (`shared/types/store-payments.ts`)
  - `SELLER_ORDER_VIEWS`, `SELLER_CARRIERS`, `SellerOrderRow`, `SellerOrdersData` and `SellerOrderDetail`;
  - `SellerOrdersData` is `{ orders, nextCursor, stores, hasTestOrders }`, where `stores` holds the `{ appId, title }` pairs for the filter;
  - `SellerShipmentRequest`;
  - `SellerOrderDetail` extends `StoreOrderSummary` with `appId`, `storeTitle`, `carrier`, `trackingNumber`, `shippedAt`, `dispute` (`{ amountCents, status } | null`) and per-line `refunded`.
- **Unchanged:** `GET /api/stores/:id/orders` and the refund endpoint.
- **Code**
  - Services: `SellerOrderService` (list, detail, shipment) in `worker/database/services/`.
  - Controller: `worker/api/controllers/sellerOrders/`.
  - Routes: `worker/api/routes/sellerOrderRoutes.ts`.
  - Client: `getSellerOrders`, `getSellerOrder`, `setSellerOrderShipment` and the existing `refundStoreOrder`, in `src/lib/api-client.ts`.

## 10. Data model

The migration takes the next free number (0027 when written; the shopper order access spec also expects 0027, and whichever is built second takes 0028).
- `store_orders.shipped_at`: integer, nullable.
- A new index on `store_orders (seller_user_id, created_at)`. It replaces `store_orders_seller_idx`, which it covers.
- No backfill.

## 11. Security and privacy

- **Ownership:** each route checks the order's `seller_user_id`. The refund endpoint keeps its own owner check, by app.
- **Who sees the address:** the full address and phone show only to the order's seller, who is the merchant. The email leaves the street out.
- **Input:** the carrier and tracking number are validated on the server. React escapes the page, and `renderEmail` escapes the email.
- **Copy:** no supplier or AI-assistant names in seller copy. The existing copy-rule guard covers the new pages.

## 12. Accessibility

- A real table with column headers on wider screens, and cards with labelled fields on phones.
- Form fields have labels.
- The refund dialog uses the shared `AlertDialog` and confirm patterns.
- Statuses are text, never color alone.
- Banners use `role="status"`, and dispute banners use `role="alert"`.

## 13. Testing

- **Real SQL** (`real-d1.ts`):
  - the to-ship rule: own lines; refunded own lines left out; catalog-only and fulfilled orders left out; disputed and refunded payments left out;
  - the store and mode filters, `hasTestOrders` and paging;
  - another seller's orders left out;
  - the detail, with its dispute and per-line refunds;
  - setting a shipment, editing it (which keeps `shipped_at`) and undoing it;
  - the migration.
- **Endpoints:**
  - 404 for another seller's order;
  - 400 for bad views, cursors and shipment fields;
  - 409 for each shipment refusal.
- **Email:**
  - the template for own, catalog and mixed orders, with a note, for test orders, and with escaping;
  - the daily cap;
  - no email on `already-recorded`;
  - a failed send swallowed;
  - `recordStoreOrder` calls `notifyNewOrder` only on `recorded`.
- **UI:**
  - format helpers: shipping status text, the money split and the payment labels;
  - source guards: the sidebar item, both routes, the test switch defaulting off, the Mark shipped form, the refund confirmation and the copy rules.
- **By eye on localhost:** a local test order with own and catalog items. Check the email in the dev log, the list's views and filters, the order page, mark shipped and undo, and a refund.

## 14. Rollout

- No feature flag: the page shows only the signed-in seller's own data.
- It ships with the next production deploy. Production Stripe is in test mode, so every order and email there is a test one until live keys arrive.
- There are no owner actions; account emails already use the EMAIL binding.

## 15. Connection to the shopper order access spec

- That spec reads `fulfillment_status`, `carrier` and `tracking_number` for own products. This spec's Mark shipped is what sets them.
- Its "shipped" email to shoppers hooks into the shipment endpoint here, when it's built.

## 16. Not in this spec

- Printing labels, editing addresses, cancelling orders (refund instead) and CSV export.
- A setting to turn the email off.
- Split shipments.
- Seller emails for refunds or disputes (catalog refunds already send one), and a link to Stripe's dashboard.
