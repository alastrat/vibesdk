# Launch readiness review

- **Date:** 2026-10-19, at the owner's request ("review what's missing in our app for a launch").
- **Sources:** a read-only review of the code on `main` plus the store-drafts branch (PR #25), and the open items from
  earlier launch work.
- **Not covered:** marketing, pricing levels and legal advice. It only flags where those block the product.

## Summary

- **Already built:** the store builder, live stores, store checkout, payouts, seller levels, order emails, catalog
  ordering and staging.
- **What still stands between Estori and a public launch:**
  1. a way to pay for Estori itself, with plan limits;
  2. seeing what happens in production: errors, uptime, usage and AI cost;
  3. switching risky features on and off without a deploy;
  4. a list of operator steps in Stripe, Cloudflare, email and legal.

Items 1 to 3 have specs and plans written today. Item 4 is the checklist in section 3.

## 1. Must build before launch

| # | Gap | Why it blocks | Where it's addressed |
| --- | --- | --- | --- |
| 1 | **No way to pay for Premium.** No subscriptions, Stripe customers or monthly credits; the Premium button opens the contact form | the pricing page sells something the product can't deliver | billing spec, `2026-10-19-billing-subscriptions-design.md` |
| 2 | **AI credits aren't limited in production at all.** The check before a turn only works when `ENABLE_CLOUDFLARE_LIMITS` and `CF_OAUTH_ENCRYPTION_KEY` are set, and neither is set on production or staging (checked 2026-10-19). The Think agent counts steps but never stops | once Access is off, anyone can run unlimited AI builds on Estori's bill | billing spec, sections 5 and 15 (decision 15) |
| 2b | **Plan limits aren't enforced.** Nothing reads a plan; "paid" rows such as the supplier catalog work for everyone; live stores and own domains are unlimited | free accounts get paid features | billing spec, sections 3 and 6 |
| 3 | **Error tracking is off.** Sentry is commented out on the Worker and inactive in the browser (no DSN at build or deploy, no source maps) | production errors are invisible | PostHog spec, `2026-10-19-posthog-analytics-monitoring-flags-design.md` |
| 4 | **No uptime monitoring or alerts.** Only post-deploy smoke checks; no alerts on errors, cron failures or AI cost; business alerts go to one hard-coded address | an outage or a runaway AI bill goes unnoticed | PostHog spec (heartbeat, alerts) |
| 5 | **No product analytics.** No events, funnels or retention; Think builds send no AI Gateway metadata, so AI cost per seller is unknown | no way to see activation, conversion to Premium or cost per seller | PostHog spec |
| 6 | **No feature flags.** Every toggle is an environment variable that needs a deploy; KV overrides stick for an isolate's life | a risky feature can't be turned off quickly at launch | PostHog spec (flags and kill switches) |
| 7 | **The privacy policy says "no analytics cookies"** and lists no analytics vendor | adding analytics without changing it breaks a public promise | PostHog spec (privacy section); the owner's lawyer review |
| 8 | **The AI forgets its own earlier tool calls.** It sometimes tells sellers their earlier changes "never happened" (the context trimmer drops past tool calls) | sellers lose trust in what the AI says | fix in review: PR alastrat/vibesdk#26 |
| 9 | **The stop button doesn't stop the AI mid-turn.** `cancelCurrentInference` uses an abort controller the Think host never creates | a seller can't stop a wrong build, and it keeps spending credits | needs a small fix (not yet specified) |
| 10 | **The pricing page tags store payments "Coming soon"** (`src/lib/capabilities.ts:74`) though checkout, payouts and order emails are built | the public site undersells, or contradicts, what's live | a copy change when payments go live |

## 2. Should build soon after launch

- **Store analytics for sellers:** visits and conversion for their own stores. Out of scope for both specs; a later
  spec.
- **Delivery checks on orders sellers ship:** marked Premium on the pricing page, not built.
- **Credential scrubbing in logs:** the logger's scrubbing is a pass-through today, so turn it on before logs go
  anywhere outside Cloudflare.
- **Store drafts follow-ups** (PR #25's deferred minors): the Code tab rebuild cost, and some refusal messages meant
  for the AI that reach sellers.
- **Email marketing:** the spec and plan are in PR #24 and not built.

## 3. Operator steps before turning off Access

**Stripe (live mode):**
- live secret and publishable keys;
- the platform and Connect webhook endpoints with their secrets;
- the Connect platform profile in live mode;
- Premium's live prices (billing spec, section 14);
- the customer portal configuration and Smart Retries;
- turning off Stripe's invoice and failed-payment emails;
- a sales tax decision for Premium.

**Live stores:**
- a separate stores domain on the Public Suffix List, with a wildcard DNS record and route;
- Cloudflare for SaaS: fallback origin, CNAME target and catch-all route;
- the variables `STORES_DOMAIN`, `STORES_CNAME_TARGET`, `CF_SAAS_ZONE_ID` and the secret `CF_SAAS_API_TOKEN`;
- `LIVE_STORE_PAYMENTS=on`;
- Apple Pay and Google Pay domain registration.

**Supplier:** set `CATALOG_SUPPLIER_LIVE` and the CJ key with `wrangler secret put` on launch day, once the owner says
go.

**Email:**
- Cloudflare Email Routing for support@, privacy@ and copyright@estori.app;
- set `SALES_INBOX`;
- confirm `orders.estori.app` is onboarded for shopper emails;
- set the alert recipients for platform alerts and PostHog alerts.

**Sign-in:** the Google OAuth redirect URIs for production and staging.

**Security hygiene:**
- move the live Stripe keys out of the local `.dev.vars` (it holds them next to the test keys);
- add Cloudflare Access to `staging.estori.app`.

**Data:** clean test data out of production D1, R2 and Artifacts.

**Legal:**
- register a DMCA agent;
- have a lawyer review the terms and privacy policy, including the analytics changes.

**Access:** turn off Cloudflare Access on estori.app last, after a final smoke check.

## 4. Decisions waiting on the owner

- **Billing:** the 15 decisions in the billing spec's section 15, most importantly the limits table and the notice to
  existing sellers.
- **Analytics, monitoring and flags:** the decisions in the PostHog spec, most importantly session replay, error
  tracking replacing Sentry, and no consent banner while Estori is US-only.
- **Store drafts:** the spec's section 16 defaults, and which draft public surfaces show.
- **Sign-up redesign:** 7 open questions (`2026-10-15-signup-proposal.md`).
- **Shopper order access:** 8 open questions (`2026-10-18-shopper-order-access-design.md`, untracked draft).
- **Sales tax and VAT.**
