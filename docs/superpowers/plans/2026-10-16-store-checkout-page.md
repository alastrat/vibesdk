# Store Checkout Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Replace the redirect to Stripe's hosted page with Estori's own checkout page on the store's address. It uses
Stripe Elements on a Checkout Session, shows an editable cart shared with the store through `Estori.cart`, and carries
the store's brand. The public site explains payments, and the pricing table lists the limits.

**Spec:** `docs/superpowers/specs/2026-10-16-store-checkout-page-design.md`

**Execution note:** this plan is lean on purpose. Its author executes it in the same session, overnight, with the
owner's go-ahead to proceed without approvals. Each task still runs test-first: write the test, watch it fail, then
implement. Every deviation is ledgered as a ruling.

## Global Constraints

- **Code:** no `any`, no emojis. Commits are lowercase after the type prefix, with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:** `.dev.vars`, `bun.lockb`, `.superpowers/`, `src/routes/landing/LandingPage.tsx`, or the local
  overrides in `wrangler.jsonc`.
- **Public copy:** no supplier or AI-assistant names. The fee label comes from `PLATFORM_FEE_LABEL`. Stores aren't live,
  so the Payments capability is "coming soon".
- **Stripe:** test mode only. Pin API version `2026-03-25.dahlia`, and load Stripe.js from
  `https://js.stripe.com/dahlia/stripe.js`.
- **Tests:** run in batches with the scratchpad `batch.sh` and `fullsuite.sh`.

## Tasks

### Task 1: The Stripe client for Elements sessions
- Files: `worker/services/payments/stripe-client.ts`, `stripe-client.test.ts`.
- Pin `Stripe-Version` on every request.
- `createStoreCheckoutSession` creates `ui_mode: elements` with `return_url`, and returns `client_secret`.
- Add `expireCheckoutSession(sessionId)`.
- Tests:
  - the header is pinned;
  - the body has `ui_mode=elements` and `return_url`, and no `success_url` or `cancel_url`;
  - expire posts to `/checkout/sessions/{id}/expire`;
  - an expire refused as already expired or complete resolves.

### Task 2: The brand block
- Files: `shared/types/store-payments.ts` (`StoreBrand`, `StoreManifest.brand?`, `StoreInfo.brand`), `manifest.ts`,
  `manifest.test.ts`, `checkout.ts` (`storeInfoOf`).
- Tests:
  - a valid brand parses, with `surface` and `accentText` defaulted;
  - a bad color, font, corners value or unknown field fails with its JSON path;
  - a missing brand is fine;
  - store info carries the brand.

### Task 3: Checkout answers with a client secret, a summary and replacements
- Files: `shared/types/store-payments.ts` (`StoreCheckoutResponse`, `StoreCheckoutRequest.replaces`, `StoreOrderSummaryView`),
  `request.ts`, `checkout.ts`, `checkout.test.ts`, `store-platform.ts` (deps: `replaceCheckout`), `StoreCheckoutService`
  (`expireIfOpen`).
- Tests:
  - success returns the client secret, checkout id and summary;
  - `replaces` expires the old checkout (and its session) before the cap check;
  - an unknown or foreign `replaces` is refused;
  - a missing client secret fails the checkout.

### Task 4: `store.js` cart helpers and navigation
- Files: `store-script.ts`, `store-script.test.ts` (run the script against fake `window`, `localStorage` and `location`).
- Tests:
  - the cart key includes the base path;
  - add, setQuantity, remove, clear and count work, and onChange fires;
  - `checkout({ items })` replaces the cart and goes to `{base}/pay`, with the paths in the query;
  - `order()` clears the cart after a receipt.

### Task 5: The checkout page
- Files: `worker/services/store-payments/pay-page.ts` (HTML), `pay-page.test.ts`, `store-platform.ts` (route
  `GET /__estori/pay`), `worker/types/env.d.ts` (`STRIPE_PUBLISHABLE_KEY?`), `src/routes/chat/components/preview-iframe.tsx`
  (`allow="payment"`).
- Tests:
  - the page has the CSP, the publishable key, `store.js` and Stripe.js;
  - JSON in the page is escaped;
  - without a publishable key, the page says payments are unavailable;
  - the route answers HTML for `/pay`.

### Task 6: The agent's skill
- Files: `worker/agents/think/skills/store-checkout/SKILL.md`, and the skill's tests, if any.
- The skill gains:
  - `Estori.cart`;
  - "never build a checkout page";
  - the brand block;
  - "no invented money copy".

### Task 7: The public site
- Files:
  - `src/lib/capabilities.ts` (`payments`);
  - `src/components/layout/NavMenu.tsx` (icon);
  - `src/content/solution-pages.ts` (`PAYMENTS_COPY`);
  - `src/content/public-pages.ts` (`PAYMENTS_PAGE`, `PUBLIC_PAGES`);
  - `src/routes/platform/payments.tsx`;
  - `src/routes.tsx`;
  - `src/lib/plans.ts` (the Payments section);
  - the FAQ copy in `PublicFaq.tsx` and `positioning.ts`;
  - their guard tests.
- Tests: the existing guards (copy rules, solution-page shape, page heads, platform links resolve), plus a pricing row
  test for the limits.

### Task 8: End to end
- Build two stores with the local agent from the updated skill, and update "Paw and Bowl" to `Estori.cart`.
- Run every transaction type through the new page, as listed in the spec, section 8.
- Screenshots and Stripe ids go into the morning report.

## Finish
- Full suite and both `tsc` configs, then a fresh final review, one fix pass, push, the PR description, and the report.
