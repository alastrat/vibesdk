# Yearly subscriptions implementation plan

**Goal:** Offer monthly/yearly Pro and Premium subscriptions, yearly at 20% off twelve monthly payments.
**Execution:** Native implementation in the existing preview worktree. Preserve earlier uncommitted work; do not deploy or modify live Stripe resources.
**Design:** BillingInterval is month/year, default month for existing clients and subscriptions. Pro annual price is 47,040 cents; Premium 191,040. Annual credits refresh monthly on the subscription anniversary. Subscription renewal and cancellation use the paid billing period, independently of the credit period. Same-interval Pro→Premium upgrades remain immediate/prorated; downgrades and interval changes are scheduled at renewal. Annual price IDs are optional deployment configuration so existing monthly billing keeps working; annual requests fail clearly if not configured.

## Tasks
- [x] Shared pricing and terms: add interval-aware price/consent helpers and annual promotion handling; test exact prices and annual wording.
- [x] Stripe and persistence: add annual setup prices, interval metadata/idempotency, subscription/schedule interval fields and D1 migration; test annual mapping, scheduled changes and backward compatibility.
- [x] Credit periods: derive monthly periods within a paid year, including short months/leap years, retain monthly limits and cancellation date; test monthly reset, exhausted credits, annual renewal, failed payment and retries.
- [x] API and account UI: preserve interval across signup, checkout, consent, recovery and existing subscriber changes; test invalid intervals, no monthly fallback, annual cancellation and upgrade copy.
- [x] Public pricing: accessible Monthly/Yearly control above cards, 20% savings, monthly equivalents/full annual totals, consistent comparison and checkout links. Verify browser interaction and mobile layout.
- [x] Run relevant focused tests sequentially, typecheck/lint/build, inspect diff and document production setup steps.

## Review focus
Wrong yearly charge/consent; annual users receiving a yearly rather than monthly credit pool; billing and credits renewal dates conflated; old monthly sessions/idempotency/configuration broken; billing interval lost through signup or retries; yearly upgrades/downgrades reverting to monthly; missing annual Stripe IDs silently charging monthly.

## Deployment
Apply migration `0035_yearly_subscriptions.sql` before deploying this Worker. Run the existing idempotent `scripts/stripe-billing-setup.ts --mode test` (or `--mode live` for production) with the matching Stripe secret, then set the returned `STRIPE_PRICE_IDS` JSON. It now includes `proYearly` and `premiumYearly` alongside `pro`, `premium`, `credits`. Never commit credentials. Annual checkout fails closed if its IDs or actual Stripe price/recurrence do not match. Existing monthly-only configuration remains valid. No live Stripe resources were modified during implementation.

Annual charges: Pro $470.40; Premium $1,910.40 USD. Price cards show equivalents $39.20/month and $159.20/month plus the full billed-yearly amount. Annual savings use separate recurring yearly Stripe prices, so additional valid promotion codes follow Stripe’s normal discount rules. Repeating discounts are worded in annual invoice counts (rounding the coupon’s month duration up to full annual invoices), consistent with https://docs.stripe.com/billing/subscriptions/coupons#coupon-duration.

## Verification and review
- Focused annual tests passed alongside existing monthly checkout/action, Stripe-client/setup, real-D1 controller/account/jobs, subscription webhook, pricing SSR, checkout recovery, account copy, catalogs and legal-document tests.
- Root `bun run typecheck`, `bun run lint`, `bun run build`, and `git diff --check` passed. Lint retains six existing Fast Refresh warnings. The full root test suite was not rerun because earlier runs in this worktree hit local Workers-pool TCP exhaustion; affected tests were run in small sequential batches.
- Independent review found interval loss in legacy upgrade links and already-subscribed checkout redirects, plus annual credit recovery from Stripe unpaid status. Regression tests reproduced these and now pass. Annual plan changes also validate the actual Stripe annual price before mutation.
- Reviewed recovery restores only a zero-pool held first month; it does not retroactively inflate an earlier paid month after an upgrade. Existing annual billing retains monthly credits, including while cancelled to end at year renewal.
- Local preview uses migration0035. Browser verification switched both directions, confirmed matching comparison prices and tested a300px CSS viewport without horizontal overflow. Screenshot: /tmp/estori-yearly-pricing.png.
- Production Stripe, remote D1, deployments, purchases, and outgoing communications were not modified.


Update: yearly prices now round the discounted monthly rate down to whole US dollars before multiplying by twelve. Base Pro is $39/month billed $468/year; Premium is $159/month billed $1,908/year. Pro 30k is $51/month billed $612/year; Premium 200k is $279/month billed $3,348/year. This supersedes the exact-cent examples above. Monthly prices and monthly credit resets are unchanged. Apply the same Stripe setup workflow to create/reuse the new annual prices and refresh annual price IDs before deploying; no live Stripe prices were changed here.
