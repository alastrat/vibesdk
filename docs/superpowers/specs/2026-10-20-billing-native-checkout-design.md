# Native billing checkout: Stripe Elements inside Estori

Date: 2026-10-20. Requested by the owner. The direction and the checkout layout are the owner's. The rest is marked "Coordinator's call" in section 9.

## 1. Intent

Paying Estori for a plan or for extra AI credits should feel like part of Estori. Today a seller who clicks "Get Pro", buys extra credits or opens "Manage billing" leaves for a Stripe-hosted page and comes back. The owner wants a native experience: the seller stays on estori.app, in Estori's own pages and look, from the click to the confirmation. This follows the owner's earlier decision that seller and shopper communications come from Estori, not Stripe.

**Success.** A seller can do all of these without ever seeing a Stripe-hosted page:
- subscribe to Pro or Premium;
- buy extra credits;
- change their card;
- pay a failed renewal;
- download past invoices.

Everything the hosted flows guaranteed must still hold: payments recorded exactly once, renewal consent, 3-D Secure, the pause switch, analytics events.

## 2. Goals, non-goals, anti-goals

**Goals:**
- Estori's own checkout page for a new subscription (Pro or Premium) and for extra credits.
- An in-Estori "Change card" flow and a billing history with invoice downloads, replacing the Stripe Billing Portal.
- No change to how payments are recorded: the existing webhook and records stay the source of truth.

**Non-goals:**
- Apple Pay and Google Pay. Card only for now; wallets need their own domain setup later.
- Changing plans between paid tiers. Pro to Premium and back keeps today's confirm dialog, which charges the card on file with no card form.
- Tax collection, tax IDs, invoice addresses beyond what the card form asks for (Stripe Tax is off, US only).
- The store checkout that shoppers use. It already runs on Estori's own page.

**Anti-goals (a failure even if it works):**
- A seller sees a Stripe-branded page or URL anywhere in billing.
- A payment is charged but not recorded, or recorded twice.
- A seller is subscribed without an explicit agreement to automatic renewal.
- A card number ever touches Estori's servers. The card form stays Stripe's, in Stripe's iframe.

## 3. What exists today (branch `feat/posthog`, PR alastrat/vibesdk#30, stacked on billing PR #28)

**Server actions** live in `worker/services/billing/actions.ts` and use the hand-written Stripe client `worker/services/payments/stripe-client.ts`, which has no SDK and pins `STRIPE_API_VERSION = '2026-03-25.dahlia'`:
- `startCheckout` creates a hosted subscription Checkout Session:
  - `consent_collection.terms_of_service: 'required'` and a renewal disclosure in `custom_text`;
  - promotion codes allowed, card only;
  - `expires_at` about 35 to 45 minutes out;
  - metadata `estori_user_id` and `plan`, plus `subscription_data.metadata.estori_user_id`;
  - success and cancel URLs back to `/settings/billing`.
- `buyCredits` creates a hosted payment Session with metadata `{kind: 'credits', estori_user_id, credits}`.
- `openPortal` opens the Stripe Billing Portal.
- `changePlan`, `cancel` and `resume` already run inside Estori.

**Recording** is `worker/services/billing/events.ts`. `checkout.session.completed`, `customer.subscription.*`, `invoice.*`, `subscription_schedule.*` and `charge.refunded` are each re-fetched from Stripe and rebuilt into D1, idempotently.

**Browser:**
- `src/routes/settings/billing.tsx` and `src/hooks/use-billing.ts` redirect with `window.location.href` to the Stripe URL.
- On return, the page polls `/api/billing` every 2 s for up to 30 s until the payment shows (`billing-view.ts`).

**Precedent:** the store checkout page (`worker/services/store-payments/pay-page.ts`) already uses Stripe Elements on a Checkout Session:
- `ui_mode: 'elements'` with a `return_url`;
- Stripe.js from `https://js.stripe.com/dahlia/stripe.js`, with `initCheckoutElementsSdk`, `createPaymentElement` and `actions.confirm()`;
- the publishable key from `env.STRIPE_PUBLISHABLE_KEY`.

It is a Worker-rendered page, because stores live on other hosts.

**Terms:** today the hosted page collects consent, which needs a Terms URL set in Stripe's Dashboard. That is still an open owner step, and it currently blocks every subscription checkout.

## 4. The seller's experience

### 4.1 Subscribing: Estori's checkout page (the owner chose this layout)

"Get Pro" and "Get Premium" (on Billing, on Pricing, and from a `?plan=` link after sign-up) open a full Estori page at `/settings/billing/checkout?plan=pro`, inside the app with its header.

- **Left: the order.**
  - The plan name and monthly price, and what's included (credits, live stores, domains, catalog), from the shared plan table.
  - "Due today" with the amount, which reflects a promotion code when one applies.
  - A promotion code field.
- **Right: payment.**
  - Stripe's Payment Element, card only, styled with Estori's look (fonts, colors, radius) and following light and dark mode.
  - It collects the billing country and postal code as the card requires.
- **Consent:** a required checkbox: "I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel."
  - The plan and price are filled in.
  - "Terms" links to `/terms`.
  - The pay button stays disabled until the box is ticked.
- **Button:** "Subscribe: $49 a month".
- **Small print:** that they can cancel anytime from Billing, and the renewal disclosure the hosted page showed.
- **Promotion codes (owner's call: keep the field).** When a code applies, "Due today", the consent text and the button all show what the seller will actually pay. Every coupon kind Stripe offers is supported, percent-off or amount-off:

  | Coupon duration | Consent and button say |
  | --- | --- |
  | `once` | "$24.50 today, then $49 a month" |
  | `repeating`, N months | "$24.50 a month for 3 months, then $49 a month" |
  | `forever` | "$24.50 a month" |

  - The wording comes from one shared function of the plan price, the coupon's duration and months, and the discounted amount.
  - The page builds it from the session Stripe.js reports, and the server builds it from the session it re-fetches with its discounts.
  - Applying or removing a code unticks the box, so the seller agrees to the price they see.
  - The consent call (5.3) sends the wording shown. The server refuses it when its own wording differs, and stores the wording with the consent record.
- **Narrow screens:** the order stacks above payment.
- **"Back to billing"** returns without paying.

**After paying:**
- 3-D Secure, when the bank asks, appears in Stripe's own popup over the page.
- On success the seller lands on Billing, which shows "Confirming your payment..." and then the new plan, using today's polling.
- A declined card shows Stripe's message under the form, and they can try another card.

### 4.2 Extra credits

"Buy extra credits" on Billing opens the same page at `/settings/billing/checkout?credits=5000`:
- the order shows the credit amount and price at $1.50 per 1,000;
- there is no renewal consent;
- the button reads "Pay $7.50".

The amount the seller picked on Billing carries over, and they can change it on the page within the existing limits. On success they land on Billing, which confirms the new balance.

### 4.3 Managing billing (replaces the Stripe portal)

The Billing page gains two sections, and the "Manage billing" button goes away.

- **Payment method:** the card on file ("Visa ending 4242, expires 08/28") and a "Change card" button.
  - It opens `/settings/billing/card`, an Estori page with the Payment Element in setup mode and a "Save card" button.
  - The new card becomes the default for the subscription and future renewals.
- **Billing history:** past invoices with date, description, amount and status, newest first, each with "Download" for the PDF.
  - The PDF is served through Estori, so the link is an estori.app link.
  - The list shows the last 24 invoices.
- **Failed payment:** when a renewal fails (`past_due`), the existing banner offers two buttons.
  - **"Pay now with Visa ending 4242":** pays the open invoice with the card on file, and completes 3-D Secure on the page when the bank asks. Some renewals fail only because the bank wants the seller to confirm, and Stripe's own emails are off, so this is how those sellers recover.
  - **"Update card and pay":** opens the card page in "pay" mode. The new card is saved, then the open invoice is paid with it at once, and the result is shown before returning to Billing.
- **Emails:**
  - Estori's billing emails that pointed sellers at Stripe's hosted invoice page or at "Manage billing" now link to Estori's Billing page and use its new names.
  - The payment-failed email says "confirm the payment" when the bank asked for authentication, and "update your card" when the card was declined.

Cancel, keep-plan and plan changes stay as they are.

## 5. How it works

### 5.1 Server

1. **Sessions become Elements sessions.**
   - `createSubscriptionCheckoutSession` and `createCreditsCheckoutSession` switch to `ui_mode: 'elements'` with a `return_url` in place of the success and cancel URLs.
   - The return URL is `/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}`.
   - Metadata, `client_reference_id`, customer, price, quantity, `expires_at` and the idempotency keys stay as they are, so the webhook path is unchanged.
   - `consent_collection` is removed (see 5.3).
   - Promotion codes stay allowed for subscriptions.
2. **The start endpoints answer a client secret instead of a URL.**
   - `POST /api/billing/checkout` and `/api/billing/credits` answer `{ clientSecret, publishableKey, sessionId, order }`.
   - `order` is what the left column shows, computed on the server from the plan table, so the page and the charge never disagree.
   - Calling it again within the same 10-minute bucket returns the same session, as today.
   - The billing flag, `billing-checkout-paused`, the extra-credits limit and the existing refusals (already subscribed, pending move, past due) stay at the same points and answer the same messages. The page shows them in place of the form.
3. **The return** (`GET /api/billing/checkout/status?session_id=`) re-fetches the session from Stripe.
   - It checks it belongs to the signed-in seller.
   - It answers `paid`, `processing`, `open` or `expired`, so the page can route the seller.
   - Recording stays with the webhook. When the webhook is slow, the return may run the same idempotent `applySubscription` or `applyCreditPurchase` the webhook runs, so the seller sees the result at once.
4. **Changing the card.**
   - `POST /api/billing/card` creates a Checkout Session in `mode: 'setup'`, `ui_mode: 'elements'`, for the seller's customer, with metadata `{kind: 'card', estori_user_id}`.
   - On completion, whichever comes first of the webhook (`checkout.session.completed` with `mode: 'setup'`) or the return sets the new payment method as:
     - the customer's `invoice_settings.default_payment_method`;
     - the live subscription's `default_payment_method`.
   - Both are idempotent.
   - In "pay" mode, the same step then pays the latest open invoice with the new card (`POST /invoices/{id}/pay`). The result goes back to the page. When the invoice needs 3-D Secure, the page completes it with Stripe.js `handleNextAction` on the invoice's PaymentIntent client secret.
   - `POST /api/billing/invoices/pay` pays the latest open invoice with the card on file, for "Pay now". It answers the same `paid`, `requires_action` (with the client secret) or `declined` states.
   - `invoice.payment_action_required` is handled with the other invoice events, so the failed-payment email can tell "confirm" from "declined".
5. **Billing history and card on file.**
   - `GET /api/billing/history` lists the customer's invoices from Stripe (`/invoices?customer=...&limit=24`), mapped to `{id, date, description, amountCents, status}`.
   - The card on file comes from the customer's default payment method (brand, last four, expiry) and joins the existing `/api/billing` view.
   - `GET /api/billing/invoices/:id/pdf` checks the invoice's customer is the seller's, then streams Stripe's `invoice_pdf` with a download filename. Stripe's URL never reaches the browser.
6. **Credit purchases appear in the history:** credit sessions set `invoice_creation.enabled: true`, so each purchase gets an invoice. This costs Stripe's post-payment invoice fee; see 9.
7. **The portal endpoint and its client calls are removed.**

### 5.2 Browser

- **Routes:** a React route for the checkout page and one for the card page, both under `/settings/billing/`. That keeps them inside the app's layout, sign-in, and replay pause, since `/settings` is already a paused path.
- **Stripe.js:**
  - It loads from `https://js.stripe.com/dahlia/stripe.js`, the version that matches the pinned API, and only on these two pages.
  - The checkout page uses `initCheckoutElementsSdk({ clientSecret, elementsOptions: { appearance } })`, then a Payment Element and `actions.confirm()`, the same API as the store page.
  - The appearance is built from Estori's theme tokens and updates with light or dark mode.
- **Shared code:** the Stripe.js script URL and the list of Stripe origins become one module shared with the store pay page. Nothing is copied.
- **CSP:** the SPA's CSP in `index.html` already allows `https:` for network calls and frames, so only `script-src` needs `https://js.stripe.com` and `https://*.js.stripe.com`.
- **Billing page:**
  - The redirects in `use-billing.ts` become navigation to the new routes.
  - After the return, the existing confirm-and-poll logic runs unchanged, keyed by the status answer instead of `?checkout=success`.
  - The sessionStorage baseline for credits stays.
- **Types:** they go in `shared/types/billing.ts` and are re-exported through `src/api-types.ts`. The client methods go in `src/lib/api-client.ts`.

### 5.3 Consent

The checkbox in 4.1 replaces Stripe's Terms consent.

**When it's recorded:**
- The session is created when the page loads, without consent in its parameters, so the per-bucket idempotency key keeps returning the same session.
- When the seller presses the pay button with the box ticked, the page first calls `POST /api/billing/checkout/consent` with the session id, the current `TERMS_VERSION`, and the plan and price shown.
- The server checks that the session is the seller's, open, and of that plan and price. It stores a per-checkout consent record in D1 (session id, user, terms version, plan, price, time), and the page then calls `actions.confirm()`.
- The page never confirms a subscription without a stored consent.

**What the server does with it:**
- When it records the new subscription (webhook or return), it copies `terms_version` and `renewal_consent_at` onto the subscription's metadata.
- A subscription that arrives without a consent record is still recorded, since it has been paid. It logs a warning with the session id.

This also removes the open owner step of setting a Terms URL in Stripe's Dashboard before subscriptions work.

### 5.4 Configuration

`STRIPE_PUBLISHABLE_KEY` is already declared for the store page and must be set on each Worker (production, staging, local). This is still open from the store checkout work. When it's missing, the start endpoints answer 503 with "Payments aren't set up yet". The page shows that message, never a broken form.

## 6. What must not change

- Every payment is recorded by the existing idempotent paths in `events.ts`, from Stripe's own data. New session kinds add one branch: `mode: 'setup'`, kind `card`.
- PostHog's billing events (`subscription_started`, `credits_purchased` and the rest) still come only from the server, once per recorded change.
- `billing-checkout-paused` still refuses new subscriptions, credit purchases and paid plan changes, and still leaves open:
  - changing the card;
  - paying a failed invoice;
  - cancel and keep-plan;
  - the history.

  A seller must always be able to fix a failed payment.
- Billing emails stay Estori's own. Stripe receipts stay off.
- Session expiry, idempotency keys and the "one live subscription" rule stay as they are.

## 7. Testing

**Unit and route tests:**
- the session parameters (`ui_mode`, `return_url`, no `consent_collection`, metadata, `invoice_creation` on credits);
- the client-secret answer;
- the consent refusal;
- the status endpoint's ownership check and states;
- the setup-mode recording;
- default card updates;
- invoice ownership for the PDF route;
- the pause leaving card changes and invoice payment open;
- the portal's removal.

Existing billing tests keep passing with updated parameters.

**Guard tests:**
- the billing page has no `window.location.href` to a Stripe URL;
- the CSP has the Stripe origins;
- nothing in `src` links a `stripe.com` URL a seller would see.

**Local end to end, in Stripe test mode, with the local webhook listener:**
1. Subscribe to Pro with 4242, and with a 3-D Secure card (4000 0025 0000 3155).
2. A declined card (4000 0000 0000 0002) shows the error and allows a retry.
3. Buy 5,000 extra credits.
4. Change the card.
5. With a test clock, fail a renewal (4000 0000 0000 0341), then "Update card and pay" with 4242. The plan returns to active and the credits pool refills.
6. Download an invoice PDF.
7. With `billing-checkout-paused` on, checkout is refused while "Change card" still works.

Each payment must be recorded once, with its PostHog event.

**Scenarios script:** `scripts/stripe-billing-scenarios.ts` is updated for the new endpoints (client secret, not URL). Its hosted-page steps become Elements confirmations, using Stripe's test payment methods server-side where a browser isn't needed.

## 8. Rollout

- It ships behind the existing billing switches; nothing new to turn on.
- It lands as its own pull request stacked on #30, so the merge order is #25, #28, #30, then this.
- Before production:
  - set `STRIPE_PUBLISHABLE_KEY` (live and test);
  - turn on "Invoices" for one-time payments if Stripe asks (see 9).

## 9. Decisions

| Decision | Whose | Why | If wrong |
| --- | --- | --- | --- |
| Native billing: no Stripe-hosted page anywhere in billing | Owner | a native experience | — |
| A full Estori checkout page (order left, payment right), not a panel | Owner (option B) | chosen from mockups | — |
| Extra credits use the same checkout page | Coordinator, confirmed in playback | one payment page | a smaller panel for credits |
| The portal is replaced by Change card plus Billing history in Estori | Coordinator, confirmed in playback | the portal is a Stripe page | keep the portal as a fallback |
| Card only, no wallets | Coordinator, confirmed in playback | wallets need per-domain setup | add wallets later |
| Checkout Sessions with `ui_mode: 'elements'`, as the store page does, not PaymentIntents or Subscriptions created directly | Coordinator | keeps Stripe's session handling (promotion codes, expiry, 3DS, subscription creation) and the unchanged webhook path | build on the Subscriptions API with `payment_behavior: default_incomplete` |
| React routes in the app, not Worker-rendered pages | Coordinator | billing is part of the app, with its own header, sign-in and theme | a Worker-rendered page like the store's |
| Estori collects Terms and renewal consent with a required checkbox, recorded in metadata and D1; `consent_collection` removed | Coordinator | consent shown in Estori's page; removes the Stripe Terms URL owner step | use Stripe's consent collection in Elements mode, if supported |
| Consent is stored by its own call just before confirming, on the session created at page load | Coordinator | the card form shows at once, and the idempotency key stays stable; the page never confirms without a stored record | create the session only after the box is ticked |
| "Pay now with the card on file" for a failed renewal, alongside "Update card and pay" | Coordinator | renewals that need the bank's confirmation must be fixable without a new card | require a new card |
| Billing emails link to Estori's Billing page, never Stripe's hosted invoice page | Coordinator | no Stripe pages anywhere in billing | keep Stripe's invoice link in emails |
| A promotion code field on the subscription page, with the renewal wording following the code | Owner (keep codes); wording rules Coordinator | the hosted page allowed codes | drop the field |
| `invoice_creation` on credit purchases, so every payment is in Billing history with a PDF | Owner | one history with PDFs; Stripe's post-payment invoice fee (0.4%, capped at $2) is about 3 cents on $7.50 | list credit purchases from Estori's records without PDFs |
| Invoice PDFs streamed through Estori | Coordinator | no Stripe URLs shown | link to Stripe's PDF |
| "Update card and pay" pays the open invoice right away | Coordinator | fixes a failed renewal in one step | save the card and let Stripe's retry schedule pay |
| Built on a new branch `feat/billing-elements`, stacked on `feat/posthog` | Coordinator | both touch billing files | rebase onto billing alone |

## 10. Left to the builder

- Exact file split for the new routes, components and hooks, following existing patterns.
- How the Payment Element appearance maps Estori's theme tokens.
- Whether `@stripe/stripe-js` (loader only, exact version pin) or a small script loader shared with the store page loads Stripe.js. Prefer no new dependency if the shared loader is simple.
- The copy of messages not quoted above, following `src/routes/copy-rules.ts`: no supplier or AI-assistant names, plain language.
- Pagination of billing history beyond 24, which is not needed now.
