# Seller Risk and Payment Safeguards

**Status:** design, approved in conversation on 2026-10-16; written spec awaiting owner review.
**Builds on:** `2026-10-15-catalog-order-payments-design.md`, `2026-10-15-shopper-checkout-design.md`,
`2026-10-15-cjdropshipping-adapter-design.md` (branch `feat/catalog-purchase-flow`, draft PR alastrat/vibesdk#12).

## 1. Purpose

Store sales are Stripe destination charges on Estori's platform account. Refunds and disputes on them debit Estori first,
and Estori recovers what it can from the seller. This spec makes sure Estori pays nothing for a seller's refunds and
disputes, and limits how much a new or dishonest seller can cost Estori before anyone notices.

### Owner decisions (2026-10-16)

1. Estori is never the merchant of record for a store sale. Checkout requires the seller's `card_payments` capability.
2. When a seller refunds a shopper, the seller pays the whole refund (option B).
3. Estori covers no fee or charge arising from a seller's refunds or disputes.
4. New sellers get lower limits: a largest order, a weekly sales cap and a longer payout delay. Sellers move up
   automatically with a good record, and admins can override any seller.
5. CJ is polled every 30 minutes. CJ webhooks wait.
6. Alert emails ship before the live supplier switch is set. They go to alastrat@pluriza.com for now, through their own
   list, so a later admin email change doesn't move them.
7. Payments setup is a step after registration, not part of sign-up. A store takes payments only once that setup is
   complete, including a verified bank account.
8. Sellers explicitly accept the selling terms when they set up payments, and the legal pages are updated.

## 2. Stripe facts this design relies on

All of these were checked against Stripe's docs on 2026-10-16.

- **Transfers.** With `application_fee_amount`, the full charge is transferred to the seller, and then the fee is taken
  back. The transfer's `amount` is the whole charge. This was verified on the local test orders: `tr_3URAC9...` is
  6599, the full $65.99. So a transfer reversal can take back up to the whole sale.
  [Destination charges](https://docs.stripe.com/connect/destination-charges)
- **Who Stripe debits.** For destination charges, with or without `on_behalf_of`, Stripe debits the platform for
  refunds, dispute amounts and dispute fees. The platform recovers them with transfer reversals.
- **Negative balances.** If a seller's balance goes negative, Stripe first tries to debit their bank account, when
  `debit_negative_balances` is on. For indirect charges the platform is responsible for what Stripe can't recover, and
  Stripe may hold a reserve on the platform account for it.
  [Risk management](https://docs.stripe.com/connect/risk-management)
- **Account debits.** These cost 1.5% of the debited amount and need the seller's consent. This design doesn't use
  them: transfer reversals are free and cover every case here. [Account debits](https://docs.stripe.com/connect/account-debits)
- **Payout delay.** On accounts where the platform owns liability, the platform can set
  `settings.payouts.schedule.delay_days` up to 31. US accounts count the delay in business days.
  [Payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)
- **Reserves.** Stripe's Reserves API is in preview (`2025-08-27.preview`). This design doesn't use it.
- **Radar.** Radar scores every charge on the platform account. `latest_charge.outcome.risk_level` is `normal`,
  `elevated` or `highest`, and Radar blocks `highest` by default.

## 3. Payments setup required before a store takes payments

### The setup step

- **When.** Payments setup is an onboarding step after registration. Sign-up stays as it is.
- **Where it's offered.** The seller is offered the step:
  - on the first visit after sign-up;
  - when they first ask the agent for a store with checkout;
  - and from the Payouts card.
- **Skipping it.** They can skip it until they want to sell.
- **The step itself:**
  1. Read the selling terms (section 9) and tick to accept them. Estori records `seller_terms_version` and
     `seller_terms_accepted_at` on the user.
  2. Continue to Stripe's hosted onboarding. Stripe collects identity, the business details and the bank account for
     payouts. Stripe also asks for its own Connected Account Agreement there.
  3. Come back to Estori, which shows what Stripe still needs, if anything.

### What "complete" means

A store takes payments only when all of these hold. Checkout reads the account live from Stripe, so a stale row can't let
a payment through.

- the seller accepted the current selling terms;
- `details_submitted` is true;
- the `card_payments` capability is `active`, so Estori is never the merchant of record;
- `payouts_enabled` is true, which needs a verified bank account. Stripe recovers a negative balance by debiting that
  account. Without one, the recovery in sections 5 and 6 has nothing to fall back on.

When any of these fails, the rest of the section applies.
- **Shopper:** `startStoreCheckout` refuses with `payments_unavailable`, and the shopper sees "This store can't take
  payments right now."
- **Session:** a checkout that passes always sets `on_behalf_of`. The `sellerIsMerchant` fallback, and the E2E ruling
  that added it, are removed.
- **Stored flags:** `stripe_connect_accounts` gains `card_payments_active`, set by `accountFlags` and `account.updated`
  like `transfers_active`.
- **Seller:** the Payouts card and the agent's store-checkout skill name the first missing item:
  - "Accept the selling terms";
  - "Finish your Stripe setup";
  - "Add and verify a bank account".
- **Template sales** are unaffected. They still settle on Estori, as the Terms say.

### Card fees above the domestic rate

The processing part of Estori's fee is 2.9% + 30¢, Stripe's US domestic card rate. Stripe charges 1.5% more for
international cards, and 1% more when currency is converted. So Estori would pay that difference on such sales.

- **The fix:** after a store order is recorded, Estori reads the charge's actual Stripe fee from its balance transaction.
- **When the fee is higher:** if it is more than the processing Estori collected, the difference is reversed from that
  sale's transfer at once, keyed `fee-difference-<orderId>`.
- **Who pays:** the seller pays the real card cost, and shoppers abroad can still buy.

## 4. Seller levels and limits

### Levels

| | New | Established |
|---|---|---|
| Who | Fewer than 30 days since the first paid order, or fewer than 10 completed orders | 30+ days since the first paid order, 10+ completed orders, no lost dispute and a dispute rate under 1% in the last 90 days |
| Largest order (total the shopper pays) | $150 | $500 |
| Sales per rolling 7 days | $500 | $5,000 |
| Payout delay | 10 business days (about 2 weeks) | 5 business days (about 1 week) |

- **Completed order.** A paid store order at least 14 days old, with no refund, no dispute, and every catalog item
  delivered.
- **Dispute rate.** Disputes opened in the last 90 days, divided by paid orders in the last 90 days.
- **Going back.** A lost dispute, or a dispute rate of 1% or more, returns an established seller to New and sends an
  alert.
- **Mode.** Levels and limits count orders in the checkout's own mode. Test-mode previews count test orders, so the
  rules can be checked locally. Live counts only live orders.
- **Defaults and overrides.**
  - Defaults live in the global config, as a new `sellerLimits` block in `GlobalConfigurableSettings`.
  - A per-seller override goes in the existing `user_config:<userId>` KV entry. It is merged as today, and can pin a
    level or set any of the four numbers.
  - Admins set overrides through a new admin endpoint, so nobody edits KV by hand.

### Enforcement at checkout

`startStoreCheckout` checks two things after pricing and before creating the Stripe session:

1. **Largest order.**
   - The rule: when the cart total is over the seller's largest order, checkout refuses with `order_over_limit`.
   - Shopper message: "This store can't take an order this large yet."
2. **Weekly sales.**
   - The rule: when this cart's weighted amount plus the seller's last 7 days would pass the weekly cap, checkout refuses
     with `store_paused`.
   - The last 7 days count paid store orders plus checkouts still `creating` or `open`.
   - Shopper message: "This store isn't taking new orders right now. Try again later."

How the weekly sales are weighted:
- Catalog lines and shipping count once.
- The seller's own product lines count double. A catalog line carries a tracking number Estori records for the order,
  and an own-product line carries none until the seller adds one.
- Open checkouts count because two shoppers paying at once would otherwise both pass the cap.

When `store_paused` first happens in a 24-hour window, the seller gets an email naming their cap and how to raise it, and
the alert list gets `seller-limit-reached`.

### Payout delay

- **When it's applied:** on account creation, and whenever a seller's level changes.
- **What's set:** Estori updates the account with `settings[payouts][schedule][delay_days]` (10 or 5) and
  `settings[payouts][debit_negative_balances]=true`.
- **When levels are checked:**
  - when a store order is recorded;
  - by the daily cron (`35 6 * * *`) for sellers with orders in the last 120 days.
- **What's stored:** `stripe_connect_accounts` gains `seller_level` and `payout_delay_days`, so the account is updated
  only on a change.
- **On failure:** a failed Stripe update keeps the old values and alerts `seller-level-sync-failed`. The next check
  retries.

### Payout frequency, chosen by the seller

- **The choice.** The seller picks daily, weekly (on a day they choose) or monthly payouts in the Payouts card. Estori
  sets `settings[payouts][schedule][interval]` and the matching day. Manual payouts aren't offered.
- **Default:** weekly, on Monday.
- **The delay still applies.** The level's payout delay applies whatever the frequency.
- **Cost shown up front.** The card shows each option's estimated monthly cost at the seller's last 30 days of sales,
  from the pass-through below. At $1,000 a month in sales, for example: "Daily: about $10.00 a month. Weekly: about $5.50. Monthly: about $4.75."

### Stripe's seller-account costs, paid by the seller

Stripe charges Estori for each seller account, apart from card processing:
- $2 for each month in which the seller receives a payout;
- 0.25% + 25¢ for each payout. [Connect pricing](https://stripe.com/connect/pricing)

Sellers pay both through `seller_charges` (section 6):
- **How it's recorded.** The Connect webhook gains `payout.paid` for connected accounts. Each payout adds a
  `payout-fee` charge of 0.25% of the payout plus 25¢. The seller's first payout in a calendar month also adds an
  `active-account-fee` charge of $2.
- **How it's collected.** Both are taken from the seller's next sales, the same way as dispute fees.
- **Terms.** The selling terms (section 9) list these charges.
- **If Stripe changes its prices,** the two amounts are config values in `sellerLimits`, so the rates change without a
  code change.

### What the seller sees

A new `GET /api/stores/limits` (owner of the stores) returns:

```ts
interface SellerLimitsData {
	level: 'new' | 'established';
	largestOrderCents: number;
	weeklySalesCents: number;
	weeklySalesUsedCents: number;
	payoutDelayDays: number;
	nextLevel: { completedOrders: number; completedOrdersNeeded: number; daysSinceFirstSale: number; daysNeeded: number } | null;
}
```

The Payouts card shows the level, the two limits with this week's use, and what's left to reach Established.

## 5. Seller refunds paid by the seller

### The rule

A seller refund of an item gives the shopper the item's full price. Estori takes all of it back from the seller's
transfer. The only exception is a catalog item the supplier refunded Estori for: then Estori returns the catalog price,
as `itemRefundSplit` already does. Estori keeps its whole application fee, so Stripe's processing fee on the refunded
sale is the seller's cost. Estori neither gains nor loses.

The worked example from the conversation:
- The shopper paid $40.99 for the feeder. The seller netted $19.22, and Estori kept $21.77 and paid CJ $16.90.
- On a full seller refund, the shopper gets $40.99 back and the seller's balance gives $40.99 back.
- The seller is out $21.77.

### Balance check before any money moves

- **Before refunding:** `refundCatalogItems` and the new own-product refund read the seller's Stripe balance
  (`GET /v1/balance` with `Stripe-Account`). They add up `available` and `pending` in USD.
- **When the balance is short:** if that sum is less than the amount to take back, nothing is refunded and the call
  returns `{ ok: false, reason: 'seller_balance_short', shortCents }`. The seller reads "Your Stripe balance is $X short
  for this refund. It can go through once more sales come in."
- **Estori-started refunds are exempt.** Supplier rejections, cancellations and risk declines (section 7) aren't checked.
  Estori owes those to the shopper. The seller's share comes from the same transfer, and Stripe's bank debit covers a
  negative balance.
- **Code cleanup.** `RefundExceedsTransferError` is removed. It can't happen, because the transfer is the whole charge.
  The wrong comment beside it goes too.

### The endpoint

`POST /api/stores/:appId/orders/:orderId/refunds` takes `{ itemLineNos: number[], requestId: string }` and is
owner-only.
- **Catalog lines:** `refundCatalogItems` with reason `seller-refund`.
- **Own-product lines:**
  - one refund per line, for the line total;
  - `reverse_transfer: true` and `refund_application_fee: false`;
  - idempotency key `store-refund-<requestId>-<lineNo>`.
- **Recording:** every refund is recorded in a new `store_refunds` table, with the Stripe refund id, order, line,
  amount, request id and `initiated_by` (`seller` or `estori`).
- **Order status:** `store_orders.refunded_cents` and `payment_status` (`partially_refunded`, `refunded`) are
  recomputed. This fixes the gap from the E2E run, where a catalog refund didn't change the order. Catalog refunds made
  by the runner are recorded the same way.
- **Shipping** isn't refundable through this endpoint in this spec.

### Express Dashboard refunds stay off

A refund made in the seller's Express Dashboard skips the balance check and the catalog split.

- **How Stripe controls it.** Stripe allows these refunds only when the platform enables "Issue refunds" and "Manage
  disputes" for the Express Dashboard, so they are off unless switched on.
  [Express Dashboard payments](https://docs.stripe.com/connect/express-dashboard/payments)
- **Decision.** Checkout owner decision 7 planned to switch them on. This spec keeps them off: refunds go through Estori
  only.
- **Owner action.** Section 11 asks the owner to confirm both options are unticked.

## 6. Disputes

There are no dispute handlers today. The webhook gains `charge.dispute.created` and `charge.dispute.closed`, for charges
whose PaymentIntent belongs to a store order.

**On `created`:**
1. Record a `store_disputes` row: the dispute id, order, amount, reason, status, the reversal made and the fee owed.
2. Reverse the disputed amount from the sale's transfer, up to what's left of it, with idempotency key
   `dispute-reversal-<disputeId>`. Store the reversal id.
3. Add the dispute fee, read from the dispute's balance transactions, to the seller's `seller_charges`.
4. If the order's catalog items haven't been placed yet, the runner stops before placing them and marks them `rejected`
   with reason `disputed`. No refund is made, since the dispute already returned the money.
5. Alert `dispute-opened`, with the order, the amount, the reason and the catalog tracking for evidence.

**On `closed`:**
- **Won:** transfer the reversed amount back to the seller, with idempotency key `dispute-return-<disputeId>`. Remove the
  fee from `seller_charges` if Stripe returned it, again read from the balance transactions. Alert `dispute-closed`.
- **Lost:** record the outcome, and re-check the seller's level (section 4). Alert `dispute-closed`.

**Evidence** is submitted by an admin in the Stripe Dashboard. Automated evidence is not in this spec.

### Seller charges

`seller_charges` holds what a seller owes Estori outside a single sale: dispute fees, and any dispute reversal Stripe
refused.

- **How it's collected.** After each paid store order is recorded, Estori reverses the seller's oldest charges from that
  sale's transfer. It takes no more than what is left of the seller's share of that sale: the total, minus Estori's fee,
  minus anything already reversed. It is keyed `seller-charge-<chargeId>-<orderId>`, and each collection is recorded.
- **Why this way.** It costs nothing in Stripe fees and needs no stored payment method. A charge left unpaid for 60 days
  alerts `seller-charge-unpaid`.

## 7. Holding risky payments before paying the supplier

Before the runner places a catalog order, it reads the PaymentIntent's `latest_charge.outcome.risk_level`.

- **`normal`:** place as today.
- **`elevated`:**
  - Hold the order in a new `risk-hold` status, and alert `risk-hold`.
  - An admin can release it through `POST /api/admin/catalog/orders/:id/release`, and the runner places it.
  - **Unreviewed after 24 hours:** the runner refunds the catalog items with reason `risk-declined`. That works like a
    supplier rejection: Estori returns the catalog price, the seller returns their share, and the seller is told.
- **`highest`:** Radar has already blocked the payment, so it never reaches the runner.

## 8. Alert emails

These are built as the CJ spec's "Alerts" section describes (`worker/services/catalog/alerts.ts`, `createEmailSender`,
the 24-hour KV throttle), with three changes:

- **Recipients:** a new `PLATFORM_ALERT_EMAILS` list, initially `['alastrat@pluriza.com']`, kept apart from
  `PLATFORM_ADMIN_EMAILS`.
- **New kinds:**
  - `dispute-opened`, `dispute-closed`;
  - `risk-hold`;
  - `seller-limit-reached`, `seller-level-changed`, `seller-level-sync-failed`;
  - `seller-charge-unpaid`.
- **Scope:** every kind from the CJ spec is implemented, except the ones that need deferred CJ work (`webhook-closed`,
  `supplier-refund-after-seller-refund`). Seller emails cover the limit reached and rejected or risk-declined items.

Local dev uses the dev log sender, as today.

## 9. Seller terms and legal pages

### How the terms are accepted

There are two acceptances:
- **The general Terms.** These are already accepted explicitly at sign-up (`acceptedTermsVersion`). When
  `TERMS_VERSION` moves, the existing re-acceptance prompt asks again at the next sign-in.
- **The selling terms.** These are a separate, explicit acceptance in the payments setup step (section 3), stored as
  `seller_terms_version` and `seller_terms_accepted_at`. Moving `SELLER_TERMS_VERSION` makes sellers accept again before
  their store takes another payment. The seller sees a prompt, and the shopper sees `payments_unavailable`.

### What the legal pages say

- **New section.** `src/content/legal/terms.md` gains a "Selling in your own store" section. It says:
  - the seller is the merchant of record for their store's sales, and needs Stripe card payments to sell;
  - the seller pays refunds they make in full, including the product cost and card fees;
  - the seller pays Stripe's account and payout charges for their account, and picks how often they're paid;
  - for disputes, the seller pays the amount and Stripe's dispute fee;
  - Estori recovers these from the sale, from the seller's Stripe balance, and from later sales;
  - Stripe may debit the seller's bank account to cover a negative balance;
  - payouts are delayed by the seller's level, and stores have order and weekly limits that grow with a good record;
  - Estori may hold an order its payment checks flag, and refund it if it isn't cleared.
- **Section 8.** It keeps saying Globalink is the merchant of record for paid sites (templates) only.
- **Privacy policy.** `privacy.md` adds shoppers as people whose data Estori handles. Store checkouts collect the name,
  email and shipping address, and share them with Stripe and with fulfillment partners to deliver orders. Suppliers are
  never named, following the public-site copy rule.
- **Refund policy.** `refunds.md` says it covers purchases from Estori only. Purchases from a store follow that store's
  own refund policy.
- **Legal review.** The section is written plainly and marked for review. There is no lawyer yet, and the owner should
  have it reviewed before live payments.

## 10. Data changes (migration 0020)

- `stripe_connect_accounts`: `card_payments_active` (boolean, default false), `seller_level` (text, default `new`),
  `payout_delay_days` (integer, nullable), `payout_interval` (text, default `weekly`), `payout_anchor` (text,
  default `monday`).
- `users`: `seller_terms_version` (text, nullable), `seller_terms_accepted_at` (timestamp, nullable).
- `store_fee_adjustments`: `order_id` (primary key), `collected_cents`, `actual_fee_cents`, `reversal_id`, `created_at`.
- `store_refunds`: `id` (Stripe refund id), `order_id`, `line_no`, `amount_cents`, `request_id`, `initiated_by`,
  `created_at`. Unique on (`request_id`, `line_no`).
- `store_disputes`: `id` (Stripe dispute id), `order_id`, `amount_cents`, `reason`, `status`,
  `reversal_id`, `reversed_cents`, `fee_cents`, `returned_cents`, `created_at`, `updated_at`.
- `seller_charges`: `id`, `seller_user_id`, `kind` (`dispute-fee`, `dispute-shortfall`, `payout-fee`,
  `active-account-fee`), `source_id`,
  `amount_cents`, `collected_cents`, `created_at`, `updated_at`.
- `seller_charge_collections`: `charge_id`, `order_id`, `reversal_id`, `amount_cents`, `created_at`.
- `catalog_orders.status` gains `risk-hold`. `catalog_order_items` rejection reasons gain `disputed`. Refund reasons gain
  `risk-declined`.

## 11. Owner actions

- **In the Stripe Dashboard (Connect settings, Express Dashboard):** confirm "Issue refunds" and "Manage disputes" are
  unticked, in test and live. They are off unless someone turned them on.
- **To test checkout locally:** finish card payments on the local test seller in Stripe test mode, using Stripe's test
  identity values, or onboard a fresh test seller. Claude doesn't enter identity numbers.
- **Webhook endpoints (Stripe Dashboard, Developers, Webhooks), in test and live:** the platform endpoint at
  `/api/stripe/webhook` adds `charge.dispute.created`, `charge.dispute.funds_withdrawn` and `charge.dispute.closed` to
  its checkout events. A second endpoint, at the same URL but listening to events on connected accounts, subscribes to
  `payout.paid` and `account.updated`; its signing secret goes in `STRIPE_CONNECT_WEBHOOK_SECRET`, set with the deploy
  that ships this (setting a secret deploys the Worker). Without it, sellers' payout fees and account changes go
  unseen. Locally, `stripe listen` needs `--forward-connect-to` beside `--forward-to` for the same URL.
- **Before live payments:** have the new Terms section reviewed.

## 12. Testing

**Unit tests:**
- level evaluation: the boundaries at 30 days, 10 orders and 1%, and demotion;
- the weekly weighting, with own lines counting double and open checkouts counting;
- the largest-order and weekly refusals, and that the messages never show internal reasons;
- the balance check: short, exact, and enough;
- dispute created, won and lost, with idempotent reversals and the fee read from balance transactions;
- seller charge collection, capped at the seller's share, oldest first;
- risk-hold placement, release, and the 24-hour decline;
- the webhook routing for the dispute events;
- the payout-delay sync, called only on a change;
- the payout frequency update, and the monthly and per-payout charges recorded from `payout.paid`, once per payout;
- the alert throttle and recipients;
- the setup checks: terms not accepted, details missing, card payments inactive, payouts not enabled; each one refuses
  checkout and names the right next step;
- the selling-terms version bump blocking checkout until acceptance;
- the fee difference: reversed only when Stripe's fee exceeds what was collected, and only once.

**Local E2E (Stripe test mode):**
1. Checkout is refused for the transfers-only seller, and works once setup is complete. Completing setup means the selling
   terms, card payments and a verified bank account.
2. A sale paid with an international test card (`4000000760000002`, Brazil) reverses the fee difference from the
   seller's transfer.
3. A $151 order is refused for a New seller.
4. The weekly cap pauses the store.
5. A seller refund is refused when the balance is short, and goes through when it isn't.
6. Card `4000000000000259` (disputed) reverses the sale, records the fee, and the next sale collects it.
7. Card `4000000000009235` (elevated risk) holds the catalog order, and a release places it in the CJ sandbox.

## 13. Not in this spec

- Stripe Reserves (preview API).
- Partial supplier refunds. Nothing reports a supplier refund amount yet.
- Automated dispute evidence.
- The seller Orders page UI (the refund endpoint is ready for it).
- Live stores.
- CJ webhooks and reconciliation.
- Charging a Premium seller's saved subscription card for unpaid seller charges. Premium billing doesn't exist yet. When
  it does, the card can be a last fallback after sales and the Stripe balance, if the terms authorize it.
- Supplier adapters, Estori's own delivery records and tracking verification. These belong to a separate spec.
- Markets in other countries and currencies. These belong to a separate brief.
