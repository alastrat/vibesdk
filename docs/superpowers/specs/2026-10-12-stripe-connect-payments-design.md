# Paid sites with Stripe Connect

Status: requested by the owner on 2026-10-12, overnight, with the instruction to plan and build it without stopping. The owner has not reviewed this spec. Every decision the owner did not state is listed under "Decisions made overnight", so it can be changed in the morning.

It builds on `2026-10-12-unified-discover-design.md`:
- one Discover gallery;
- paid sites reviewed by an admin;
- purchases recorded in test mode with no charge.

This spec replaces the test-mode purchase with real Stripe payments: buyers pay by card, sellers get paid through Stripe Connect, and Estori keeps 7% + $0.60 of every sale.

## What the owner asked for

- Buyers pay for paid sites, and creators get paid when their sites sell, through Stripe Connect.
- Estori charges a fee on each sale: 7% of the price plus $0.60. It was 5% until 2026-10-13, which didn't cover Stripe's card fee on small sales.
- It must work end to end by the morning, with real Stripe test-mode transactions between separate test users, paid with Stripe test cards.
- Admin access for alastrat@pluriza.com must be guaranteed.

## Decisions made overnight

| Question | Decision | Cost if wrong |
|---|---|---|
| Seller account type | Stripe Connect Express accounts. Stripe hosts onboarding and the seller dashboard, and Estori never handles bank or identity details. | Moving to Standard or Custom accounts later means re-onboarding sellers. |
| Charge type | Destination charges through Stripe Checkout. Estori is the merchant of record, the buyer's card statement shows Estori, and the seller's share is transferred automatically. | Stripe's processing fee comes out of Estori's fee. At Stripe's standard US card rate (2.9% + $0.30), Estori keeps about $0.67 of a $9 sale and $1.49 of a $29 sale. Direct charges would make the seller pay that fee instead. |
| Fee | 7% of the price, rounded to the nearest cent, plus $0.60, sent as Stripe's `application_fee_amount`. A free site has none. | Two constants in `shared/types/templates.ts`. |
| Selling requirement | A creator can set a price only after their Stripe account can receive transfers. | A creator who skips onboarding cannot set a price, which is intended. |
| Fulfillment | The Stripe webhook (`checkout.session.completed`) records the purchase. On return from Checkout, the app also confirms the session itself, so a missed or slow webhook never leaves a paid buyer without access. Both paths are idempotent on the Checkout session id. | None; the same session id is never recorded twice. |
| Stripe library | No SDK dependency. A small fetch-based client calls Stripe's REST API, and webhook signatures are checked with WebCrypto. | More code to own than the SDK. In return there is no lockfile change; `bun.lock` and the local `bun.lockb` disagree in this repo, so a dependency would break CI. |
| Test purchases | The test-mode "Buy" with no charge is removed. Paid buying always goes through Stripe, in test or live mode according to the configured key. | Deployments without Stripe keys can't sell. They see "Payments aren't set up". |
| Refunds and disputes | Out of scope. They are handled in the Stripe dashboard. | A refunded buyer keeps access until an admin acts. |
| Test sellers overnight | The platform profile does not yet allow API-completed connected accounts (Stripe answered "review the responsibilities of collecting requirements"), and Claude does not fill Stripe-hosted forms. Overnight transactions therefore link the platform's existing verified Express test account to a local test seller. Real sellers onboard through Stripe-hosted Account Links. | The owner onboards their own test seller in the morning to exercise the hosted flow end to end. |
| Admin access | An account is an admin when its `role` is `admin`, or when it has a sign-in identity from Google, GitHub or Cloudflare whose provider-verified email is `alastrat@pluriza.com`. Email and password sign-up never grants admin, because the product doesn't verify those addresses. | Signing in with Google as alastrat@pluriza.com links to the existing account and makes it an admin, even if it was created after migration 0009 ran. |

## What people see

- **Creator.**
  - Profile, Paid listings tab:
    - A "Get paid with Stripe" card: "Connect Stripe" starts Stripe's hosted onboarding, and returning from Stripe shows the account status.
    - Once transfers are active, it reads "Payouts active" and links to "Open Stripe dashboard".
  - Publish dialog: choosing a price before payouts are active shows "Connect Stripe to sell this site" with a button that starts onboarding. Publishing a paid site is refused until payouts are active.
  - Paid listings: each paid site shows buyers, gross sales, Estori's fee and the creator's earnings.
- **Buyer.**
  - "Buy for $29" on the app page opens Stripe Checkout.
  - After paying, the buyer returns to the app page, which confirms the payment and shows "Use this site".
  - Cancelling returns to the app page with nothing recorded.
- **Admin.**
  - `/admin/reviews` adds a "Sales" section: the latest 50 sales with site, buyer, price and Estori fee, and the total fees.
  - The admin rule above guarantees access for alastrat@pluriza.com.

## Architecture

### Data (migration 0010)

- **`stripe_connect_accounts`:**
  - `user_id` (primary key, references users, cascade);
  - `stripe_account_id` (unique);
  - `details_submitted`, `charges_enabled`, `payouts_enabled` and `transfers_active` (booleans);
  - `created_at` and `updated_at`.
- **`template_purchases` gains:**
  - `stripe_checkout_session_id` (unique, nullable) and `stripe_payment_intent_id`;
  - `platform_fee_cents` and `seller_amount_cents` (nullable integers);
  - `currency` (default `usd`) and `seller_stripe_account_id`;
  - provider values `test` and `stripe`. Existing test purchases are kept.

### Stripe client (`worker/services/payments/`)

- **`stripe-client.ts`:** a fetch wrapper with form encoding of nested parameters, `Stripe-Version` pinned to `2025-08-27.basil` (or the account's default when that version is rejected), errors mapped to a typed `StripeApiError`, and idempotency keys on creates. Calls:
  - accounts: create, retrieve;
  - account links: create;
  - login links: create;
  - Checkout sessions: create, retrieve;
  - application fees: list, for verification.
- **`webhook.ts`:** verifies `Stripe-Signature` (`t=` and `v1=`, HMAC-SHA256 over `{t}.{body}`, constant-time compare, 5-minute tolerance), then parses the event.
- **Fee:** `platformFeeCents(priceCents)` in `shared/types/templates.ts` returns `Math.round(priceCents * 7 / 100) + 60`, and 0 for a free site.
- **`config`:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` worker secrets. Payments are enabled when the secret key is set.

### Seller onboarding

- `POST /api/stripe/connect/onboarding` (signed in):
  - creates the Express account on the first call, with country US, email and capabilities `transfers` and `card_payments`;
  - stores it, and returns an Account Link URL whose return and refresh URLs point to `/profile?tab=paid&stripe=return` and `...&stripe=refresh`.
- `GET /api/stripe/connect/status` (signed in): retrieves the account from Stripe, stores the flags, and returns them.
- `POST /api/stripe/connect/dashboard` (signed in): returns an Express dashboard login link.
- The webhook's `account.updated` event refreshes the stored flags.

### Buying

- `POST /api/apps/:id/purchases` (signed in) now creates a Checkout session:
  - mode `payment`, one line item with the site title and the approved price in USD;
  - `payment_intent_data` with `application_fee_amount = platformFeeCents(price)` and `transfer_data.destination` set to the seller's account;
  - `client_reference_id` set to the buyer's user id, and metadata `listingId`, `appId`, `buyerUserId` and `versionId`;
  - `success_url = /app/:id?purchase=success&session_id={CHECKOUT_SESSION_ID}` and `cancel_url = /app/:id`.
  - It returns `{ checkoutUrl }`.
- **Checks before creating a session:**
  - the site is public, paid and approved;
  - the buyer is not the creator and hasn't bought it;
  - the seller's transfers are active. Otherwise it returns 409 "This seller can't receive payments right now".
- `POST /api/apps/:id/purchases/confirm` with `{ sessionId }` (signed in):
  - retrieves the session and checks it belongs to this buyer and site and that `payment_status` is `paid`;
  - records the purchase and returns `{ purchased: true }`.
- `POST /api/stripe/webhook` (public, no CSRF, signature verified):
  - `checkout.session.completed` and `checkout.session.async_payment_succeeded` record the purchase when `payment_status` is `paid`;
  - `account.updated` refreshes the seller flags;
  - other events return 200 and are ignored.
- **Recording a purchase** is one insert keyed on the session id, with `onConflictDoNothing`. It stores the price, fee, seller amount, payment intent, currency and seller account.

### Publishing gate

`publishSite` (Discover Task 3) gains a `sellerReady(): Promise<boolean>` dependency, checked before a paid submission. It refuses with 400 "Connect Stripe to get paid before setting a price" when the seller's transfers aren't active. When `STRIPE_SECRET_KEY` is not set, paid publishing returns 400 "Payments aren't set up on this deployment".

### Admin access

`UserService.isPlatformAdmin(userId)` returns true when the role is `admin`, or when a `user_oauth_identities` row for the user has `email_verified = 1` and a lowercased email in `PLATFORM_ADMIN_EMAILS = ['alastrat@pluriza.com']`. `checkAdminRole` and the app details `canModerate` both use it.

## Error handling

| Case | Behavior |
|---|---|
| Stripe keys missing | Paid publishing and buying return 400 "Payments aren't set up on this deployment" |
| Seller not onboarded when publishing paid | 400 "Connect Stripe to get paid before setting a price" |
| Seller's transfers inactive when buying | 409 "This seller can't receive payments right now" |
| Buyer is the creator, or already owns the site | 400 with the existing purchase-decision messages |
| Stripe API error | 502 "Stripe couldn't complete the request; try again", logged with the Stripe error code |
| Webhook signature invalid or too old | 400; nothing recorded |
| Confirm called for another user's session, or an unpaid one | 403 or 409; nothing recorded |
| Webhook and confirm both arrive | One purchase row (unique session id) |

## Testing

- **Unit:**
  - form encoding of nested parameters and arrays;
  - webhook signature verification: valid, a wrong secret, a tampered body, an old timestamp, several `v1` values;
  - the fee for each price option;
  - the purchase-session decision (creator, already owned, seller not ready, not approved);
  - confirm ownership checks;
  - the `isPlatformAdmin` decision (role, verified identity, unverified identity, other email).
- **Wiring guards:** the webhook route is public and exempt from CSRF; the purchase button redirects to `checkoutUrl`; the success return calls confirm.
- **Live, local, in Stripe test mode:**
  1. Create test sellers and buyers.
  2. Give a seller a test connected account. Express onboarding is hosted by Stripe and API-completed accounts are not enabled on the platform profile, so the local seller is linked to the platform's existing verified Express test account. The onboarding endpoint is tested up to the hosted Account Link it returns.
  3. Publish a paid site and have the admin approve it.
  4. The buyer pays with test card 4242 4242 4242 4242 in Stripe Checkout.
  5. Confirm in the database and in Stripe:
     - the purchase row;
     - the application fee of 7% + $0.60;
     - the transfer to the seller;
     - the webhook delivery.
  6. A second buyer pays with a different test card; a declined card (4000 0000 0000 0002) records nothing.

## Out of scope

- Refunds, disputes, tax, multiple currencies and payout schedules. These are handled in the Stripe dashboard.
- Subscriptions and coupons.
- Production key setup. The owner sets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as worker secrets, and registers the webhook endpoint in the Stripe dashboard.
