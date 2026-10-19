# Estori staging environment: design

- **Date:** 2026-10-18
- **Status:** The owner approved the direction in conversation. They then asked for staging to be built and running overnight without check-ins, so the decisions in section 12 were made on their behalf and are open to change.

## 1. Purpose

- **The problem:** production is the only real environment. Today it doubles as a test bed: it's behind Cloudflare Access, Stripe is in test mode, and order emails reach only store owners. That ends at launch. Once Stripe is live, a test on production charges real cards, places real supplier orders and emails real shoppers.
- **What staging is for:** testing every change on a real Cloudflare deployment before production. That includes migrations, Wrangler and dashboard configuration, webhooks, email and supplier sandbox orders.
- **Success means:**
  - staging runs the same code as production, with its own data;
  - nobody outside the team can see or use it;
  - nothing in staging can charge a real card, place a real supplier order or email a real shopper;
  - a merge to `main` reaches staging without anyone doing anything;
  - production still deploys only when the owner approves it.

## 2. Shape

| | Production | Staging |
| --- | --- | --- |
| Worker | `estori-production` | `estori-staging` (same Cloudflare account) |
| App host | `estori.app` | `staging.estori.app` |
| Preview host | `preview.estori.app` | `preview-staging.estori.app` |
| D1 | `estori-db` | `estori-db-staging` |
| KV | `VibecoderStore` (2e0b0d24…) | a new namespace, `estori-staging` |
| R2 (templates, screenshots, catalog images, publishing assets) | `estori-assets` | `estori-assets-staging` |
| Artifacts namespace | `estori-production` | `estori-staging` |
| Durable Objects | per Worker | per Worker (separate automatically) |
| Rate limiter namespaces | 2101, 2102 | 2201, 2202 |
| AI Gateway | `estori-gateway` | shared, `estori-gateway` |
| Email Service binding | `EMAIL` | `EMAIL`, with the recipient guard (section 6) |
| Crons | 15-minute, hourly, daily | the same |
| `ENVIRONMENT` | `prod` | `staging` |

- **Preview host:** it's one host with path-based previews (`/space/{name}/preview/{branch}/`), as in production. It's a Workers custom domain, so Cloudflare creates its DNS record and certificate. The name must not end in `preview.estori.app`, or production's `*preview.estori.app/*` route would also match it.
- **Production-only behavior:** `isProd` covers only `prod` and `production`, so with `ENVIRONMENT=staging`, live supplier orders can't be placed (`CatalogOrderRunner` places sandbox orders).
- **What's left off:**
  - live store subdomains: `STORES_DOMAIN` is unset, as in production today;
  - sellers' own domains, since `CF_SAAS_*` is unset.

## 3. Keeping staging private

**Goal:** staging is meant to sit behind Cloudflare Access like production.
- **The blocker:** the deploy token can't read or edit the zone's Access applications. Creating Access protection is also a security setting change that the owner makes.

**The fix: until the owner adds Access, the Worker locks itself.** When `STAGING_GATE_KEY` is set:
- **Every request is locked**, except three kinds:
  - the preview host, which isn't behind Access in production either;
  - `POST /api/stripe/webhook`, whose Stripe signature is checked;
  - the unlock page.
- **Unlocking:**
  - **The page:** `/__staging` shows a small form. Posting the right key sets an `HttpOnly`, `Secure`, `SameSite=Lax` cookie for 30 days. The cookie holds a SHA-256 digest of the key, not the key.
  - **Automated checks** send the key in an `x-estori-staging-key` header instead.
  - **The check:** comparisons are constant-time.
- **Locked responses:** API paths get a 401 JSON error, and pages get a short HTML page that links to `/__staging`. Everything the gate returns carries `X-Robots-Tag: noindex, nofollow`. Pages behind the gate get nothing extra, since crawlers never get past it.
- **No key on staging:** with `ENVIRONMENT=staging` and no key set, the Worker returns 503 to everything, webhook included. A deploy that lands before the key is set is never open.
- **Production is unchanged:** the key isn't set there, so the gate does nothing.
- **Once Access protects `staging.estori.app`,** the key can stay as a second lock or be removed.

## 4. Payments, supplier and sign-in

- **Stripe:**
  - **Mode:** staging uses Stripe test mode with the existing test keys. Production moves to live mode at launch, which separates the two then.
  - **Webhooks:** two test-mode endpoints point at `https://staging.estori.app/api/stripe/webhook`:
    - **Platform:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.updated`, `charge.dispute.created`, `charge.dispute.funds_withdrawn` and `charge.dispute.closed`.
    - **Connect:** `payout.paid` and `account.updated`.
  - **Signing secrets:** each endpoint's secret becomes that staging Worker secret.
  - **Overlap until launch:** both environments get every test-mode event. Each records only checkouts and accounts it knows and ignores the rest. This already happens with local development.
- **Supplier (CJ):** same API key. Orders are always sandbox orders on staging (section 2). CJ returns the same token to repeated requests within a day, so a second environment doesn't push production off its session, as local development already shows.
- **Sign-in:** email sign-in is on (`ENABLE_EMAIL_AUTH=true`), so the team can sign in without Google changes. Google sign-in needs `https://staging.estori.app/api/auth/callback/google` added to the OAuth client, which is an owner step. Admin access follows the existing rule: alastrat@pluriza.com with a verified email.

## 5. AI

Staging uses production's AI Gateway and provider keys. Building apps on staging costs the same per call as on production. Normal team use is small.

## 6. Email recipient guard

**Setting:** `EMAIL_RECIPIENT_ALLOWLIST` holds comma-separated entries: whole addresses (`ana@example.com`) or domains (`@pluriza.com`). When it's set, the sender sends only to recipients on the list.

**Blocked recipients:**
- **Logged:** a blocked send is logged ("Email not sent: not on the allowlist"), and the send fails with code `E_STAGING_BLOCKED`.
- **In the outbox:** `classifySendError` maps that code to `suppressed`, so a blocked shopper email shows as "Address blocked" and sends no alert.
- **Account emails:** a password reset or confirmation to a blocked address fails the way any failed send does.

**Values:**
- **Staging:** `@pluriza.com`.
- **Production:** unset, so production sends to anyone, as today.

## 7. Deploying

- **Workflows:**
  - **Shared steps:** `deploy-estori.yml`'s jobs move into a reusable workflow, `deploy-estori-reusable.yml`. It takes the environment, Wrangler config, app origin, preview probe URL and Worker name.
  - **Production:** `deploy-estori.yml` calls it for production on a push to `estori-live`. It still runs the gate (lint, typecheck, tests) and waits for the owner's approval.
  - **Staging:** the new `deploy-estori-staging.yml` calls it for staging on a push to `main`, with no approval. One deploy runs at a time, and a newer push waits its turn.
- **Migrations:** `scripts/deploy.ts` applies remote migrations before the Worker ships, so every migration runs on staging's D1 before production's.
- **Smoke checks:**
  - `scripts/estori-smoke.ts` reads the Worker name for its rollback hint;
  - it sends the staging key when `ESTORI_STAGING_GATE_KEY` is set;
  - the app origin and preview probe come from the workflow.
- **The `staging` GitHub environment:**
  - **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `GOOGLE_AI_STUDIO_API_KEY`, `JWT_SECRET` (its own, never production's) and `ESTORI_STAGING_GATE_KEY`.
  - **Variables:** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_GATEWAY_URL`.
- **Worker secrets, set once on `estori-staging`:**
  - Stripe: the test secret key, test publishable key, and the two webhook secrets;
  - Google: client ID and secret;
  - supplier: the CJ key;
  - staging only: `STAGING_GATE_KEY`.
- **Worker variables:** `ENABLE_EMAIL_AUTH`, `EMAIL_RECIPIENT_ALLOWLIST` and `SHOPPER_EMAIL_FROM`.
- **Upstream staging files:** `wrangler.staging.jsonc` and `deploy-staging.yml` came from upstream VibeSDK. They target upstream's account, use containers and deploy from a `staging` branch Estori doesn't use. They stay untouched, so upstream merges don't conflict. Staging uses the new `wrangler.estori-staging.jsonc`, which mirrors `wrangler.estori.jsonc`.

## 8. Promotion

Production releases keep their current path: push `main` to `estori-live`, and the owner approves the run. Only commits that deployed to staging and were checked there should be pushed. A workflow check enforcing that can come later.

## 9. Data

- **Starts empty:** staging starts with an empty database, and no production data is ever copied (privacy).
- **First use:**
  1. Unlock staging.
  2. Sign up with an @pluriza.com email and confirm it.
  3. Build or publish a store.
  4. Onboard Stripe in test mode.
  5. Buy with card 4242 4242 4242 4242.
  6. Check the order, its emails, Mark shipped and a refund.
- **Catalog:** products fill in from the supplier on the 15-minute refresh.

## 10. Testing the setup

- **Unit tests:**
  - **Gate:** locked, unlocked by cookie and by header, exempt webhook and preview host, a wrong key, and the noindex header.
  - **Allowlist:** addresses and domains, case-insensitive, and unset in production.
  - **Error codes:** the new code maps to `suppressed`.
  - **Smoke config.**
- **After deploying:**
  - the smoke checks pass;
  - `staging.estori.app` without the key gets the locked page;
  - with the key it loads;
  - a Stripe test event reaches the staging webhook;
  - an email to an @pluriza.com address goes out, and one to another address is blocked.

## 11. Cost

Staging runs on the Workers Paid plan the account already has:
- **Storage and requests:** D1, KV, R2 and Durable Objects at team usage, likely under a few dollars a month.
- **AI and email:** builds use the shared AI Gateway, and email to the team counts toward the Email Service quota.
- **No containers:** Estori runs no sandbox containers.

## 12. Decisions made on the owner's behalf

| Decision | Chosen | Why | If wrong |
| --- | --- | --- | --- |
| Privacy | a Worker-level key gate until the owner adds Access | the deploy token can't manage Access, and staging must not be public | the owner adds Access and keeps or removes the key |
| Stripe | test mode, with staging's own webhook endpoints | a separate sandbox needs the dashboard, and live mode separates the two at launch | create a Stripe sandbox later and swap the keys |
| AI Gateway | shared | the provider keys live in it, and team use is small | create a staging gateway with its own keys |
| Shopper email domain | `orders.estori.app`, with the recipient guard | no extra onboarding, and the guard keeps staging email to the team | onboard a staging subdomain and change `SHOPPER_EMAIL_FROM` |
| Deploy trigger | every push to `main` | the flow approved in conversation | switch to manual runs |
| Inherited staging files | left untouched, with new Estori files | upstream's files target another account | delete them in a separate change |

## 13. Owner steps

1. Add an Access application for `staging.estori.app`, with the same policy as production. After that, the key gate can stay or go.
2. To use Google sign-in on staging, add `https://staging.estori.app/api/auth/callback/google` to the Google OAuth client's redirect URIs.
3. Optionally, give the deploy token the Access permissions so future environments can be protected without a dashboard step.

## 14. Out of scope

- Live store subdomains and sellers' own domains on staging.
- Per-pull-request preview environments.
- Copying production data.
- A workflow check that blocks promoting a commit staging hasn't run.
