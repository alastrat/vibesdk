# PostHog analytics, monitoring and feature flags: design

- **Date:** 2026-10-19
- **Status:** written while the owner was away, then revised after a builder check. Every choice made for them is in section 15, with why and what to do if it's wrong.
- **The owner's request:** "we need to implement a system for tracking and monitoring plus feature flags. I'd like to use PostHog as much as possible for that."
- **Builds on:** main with store drafts (`docs/superpowers/specs/2026-10-19-store-drafts-design.md`) and billing (`docs/superpowers/specs/2026-10-19-billing-subscriptions-design.md`) merged.
  - Billing ships first, behind its own `BILLING` and `BILLING_USER_IDS` switches.
  - This change adds billing's events (section 4) and puts its switches under the `billing` flag (section 9).

## 1. Purpose and success

**The gap today.** Estori can't see how sellers use it. It doesn't hear about errors, and it has no way to roll a feature out to some sellers or pause one for everyone. Sentry was wired in by upstream but never turned on. Nothing alerts on errors, outages or AI cost.

**What this adds, all in PostHog:**
- **Product analytics:** pageviews and clicks on estori.app, plus authoritative business events sent by the Worker.
- **Session replay:** a sample of sessions, plus every session with an error. Replays show layouts and clicks, never what's written on the page or typed.
- **Error tracking:** browser and Worker errors, with source maps for the browser bundle.
- **Monitoring:** dashboards, alerts and an uptime heartbeat.
- **Feature flags:** a typed registry in code, evaluated on the server, sent to the browser with the session. Every flag is off unless PostHog turns it on.

**Success means the owner can:**
1. open one dashboard and see the activation funnel: signup, first build, first publish, payments ready, first sale;
2. get an email when errors spike, when a day has no signups, when AI credits pass a budget, or when the heartbeat stops;
3. open an error in PostHog and read the browser stack trace in the original source;
4. roll billing out to 10% of sellers, or pause the catalog for everyone, and see it take effect within a minute;
5. know that no email address, name, page text or token ever reaches PostHog, and that sellers can turn analytics off.

## 2. What exists today

| Piece | Where | Today |
| --- | --- | --- |
| Sentry (Worker) | `worker/index.ts`, `worker/app.ts`, `worker/observability/sentry.ts` | init commented out, so it sends nothing |
| Sentry (browser) | `src/utils/sentry.ts`, called from `src/main.tsx`; `src/hooks/useSentryUser.ts`; `src/components/ErrorBoundary.tsx` | needs `VITE_SENTRY_DSN`, which no Estori deploy sets; `useSentryUser` would send the email and name |
| Sentry leftovers | `POST /api/sentry/tunnel`; `logger.error` calls `Sentry.captureException` (`worker/logger/core.ts`); the D1 wrapper in `worker/database/database.ts`; `Sentry.setUser` in `worker/middleware/auth/routeAuth.ts`; `captureSecurityEvent` in the CSRF and rate-limit services; the AI feedback tool (`worker/agents/tools/toolkit/feedback.ts`) | all dead or no-ops |
| Logging | `createLogger`, JSON to the console | Workers Logs and traces on; no metrics; credential scrubbing is a pass-through |
| Health | `GET /api/health`; `scripts/estori-smoke.ts` after each deploy | no uptime monitoring; production is behind Cloudflare Access |
| Business alerts | `worker/services/alerts/platform-alerts.ts` | emails one hardcoded address, throttled in KV; nothing on error rates, cron failures or AI cost |
| Analytics | `analyticsRoutes` (AI Gateway usage via GraphQL); D1 stats for profiles | Think builds send no `cf-aig-metadata`, so their AI cost isn't attributed to anyone. Every Think build runs on Estori's gateway (`worker/agents/core/behaviors/think.ts`, `configureThinkAgent`), so all of it is Estori's cost |
| Flags | env strings (`LIVE_STORE_PAYMENTS`, `CATALOG_SUPPLIER_LIVE`, `ENABLE_*`, ...), billing's `BILLING` and `BILLING_USER_IDS`, `PLATFORM_CAPABILITIES`, KV `platform_configs` and `user_config:{userId}` | no percentage rollout, no targeting, no admin view |
| CSP | the app's meta tag in `index.html`; `worker/config/security.ts` for `/api`; the checkout page's own CSP | the app's `script-src` allows `'self' 'unsafe-inline' blob:` and four CDNs; `connect-src` allows any `https:` and `wss:` |
| Privacy policy | `src/content/legal/privacy.md` | section 4 says "We don't use advertising or analytics cookies"; section 3 lists no analytics vendor |

## 3. Overview

```
Browser on estori.app ── posthog-js ──> estori.app/ingest/* ── Worker proxy ──> us.i.posthog.com, us-assets.i.posthog.com
Worker (requests, crons, Durable Objects) ── batch capture, $exception ──> us.i.posthog.com/batch/
Worker ── /flags?v=2 (60 s cache) ──> us.i.posthog.com ── flags in the session ──> browser
PostHog: dashboards, alerts (email), session replay, error tracking, Stripe data warehouse source
```

- **New Worker code** lives in `worker/services/posthog/`.
- **The registries** live in shared code: `shared/types/analytics-events.ts` (events) and `shared/types/feature-flags.ts` (flags).
- **The browser side** is `posthog-js`, set up in one component, `src/components/analytics/PostHogSync.tsx`.
- **Without a PostHog key nothing is sent.** Local development, tests and a deploy before the owner adds keys all run as today, and every flag is off.

## 4. Analytics

### Browser

- **Where:** posthog-js runs on estori.app only: the public site and the app.
- **Where not:** generated stores, previews, live stores, sellers' own domains and the checkout page. Those visitors are shoppers, not Estori's users. Those pages aren't served by the app, so the browser library never loads there.
- **What it captures:**
  - pageviews on every route change (`capture_pageview: 'history_change'`) and page leaves;
  - autocapture of clicks and form submits, with no element text and no element attributes (`mask_all_text`, `mask_all_element_attributes`). Input values are never captured.
- **Addresses without queries:** every captured address loses its query and fragment before it leaves the browser. This uses a `before_send` hook, and covers `$current_url`, `$referrer`, the initial and session-entry addresses, and the page addresses inside replay data. `$pathname` stays. Reset and confirmation tokens, and the chat's `?query=` prompts, never reach PostHog.
- **Profiles:** anonymous visitors don't get person profiles (`person_profiles: 'identified_only'`).
- **The library** is bundled with the app from npm.
  - It lazy-loads `recorder.js` and its exception script from `<api_host>/static`, which is `/ingest/static` through the proxy.
- **Flags:** the browser asks PostHog for no flags (`advanced_disable_feature_flags`). Flags come from Estori's server (section 9).
- **Surveys:** off.
- **Through Estori's domain:** all browser traffic goes to `estori.app/ingest`. The Worker forwards it:
  - `/ingest/static/*` and `/ingest/array/*` go to `us-assets.i.posthog.com`;
  - everything else goes to `us.i.posthog.com`.
- **What the proxy forwards:**
  - only a short list of headers: content type and encoding, user agent, accept headers, origin and referer;
  - the client IP, as `X-Forwarded-For`, so PostHog can tell the country;
  - never cookies, `Authorization`, or the staging key.
- **What the proxy returns:** PostHog's answer without `Set-Cookie`. Static assets are cached for an hour; remote config is not cached.
- **Why a proxy:**
  - ad blockers don't drop requests to estori.app;
  - PostHog's hosts never have to be added to the app's CSP. The lazy-loaded scripts come from estori.app, which `script-src 'self'` already allows.
- **A target outside PostHog** is impossible: the target host is fixed, and the request path can't change it.
- **Without a key** the proxy answers 404.

### Server events

The Worker sends business events itself, because they must be right even when a browser blocks analytics.

- **How they're sent:** a small fetch client posts batches to `https://us.i.posthog.com/batch/`.
- **Batching:** events captured in the same tick go out in one request.
- **Timing:** sending runs after the response, through the request's `waitUntil`. In Durable Objects it runs on its own, since they stay alive for pending work.
- **Failures:** a failure, an error answer or a hang (3 s timeout) is logged as a warning and dropped. It never fails the request.
- **Every event carries:**
  - `environment` (`prod`, `staging` or `dev`);
  - `release` (the Worker version id);
  - `$lib: 'estori-worker'`.
- **Opted-out people:** before sending, the client checks who turned analytics off (section 10).
  - Their events stop, with one exception: an event's cost fields. Today that is `build_finished`'s `credits_used`.
  - The cost fields go out alone, under the fixed id `opted-out`, with no person profile, no user id and no other property. The AI budget then still counts every build.
  - If the setting can't be read, everyone in the batch counts as opted out. Privacy wins.

The event catalog is the single source of truth: `shared/types/analytics-events.ts` holds each event's name, description, property types and any cost fields. Names are `snake_case`. Properties never hold an email address or a name.

| Event | When | Person | Properties |
| --- | --- | --- | --- |
| `account_created` | a password sign-up, or a provider sign-in that creates the account | the new user | `method`; sets the person properties (section 5) |
| `email_confirmed` | a confirmation link works | the user | none |
| `signed_in` | a sign-in to an existing account | the user | `method`; refreshes the person properties |
| `build_started` | the AI starts a turn on a store | the owner | `app_id`, `model`, `first_build` |
| `build_finished` | the turn ends | the owner | `app_id`, `model`, `first_build`, `outcome` (`completed` or `failed`), `steps`, `credits_used`, `duration_ms`. `credits_used` is its cost field |
| `store_published` | a publish succeeds | the owner | `app_id`, `first_publish`, `draft` (`main` or `other`); sets `has_live_store` |
| `store_unpublished` | the store is taken offline | the owner | `app_id`; sets `has_live_store` |
| `payments_ready` | the seller's Stripe account becomes able to take store payments | the seller | none |
| `sale_completed` | a store order is recorded, once per order | the seller | `app_id`, `mode`, `total_band`, `application_fee_cents`, `has_catalog_items`, `first_sale` |
| `catalog_order_placed` | a paid order's catalog lines are handed to the supplier flow | the seller | `app_id`, `item_count` |
| `template_sold` | a paid site's sale is recorded | the seller | `listing_id`, `price_cents`, `platform_fee_cents` |
| `subscription_started` | a completed Premium checkout (the checkout-completed webhook) | the user | `tier`; sets `plan` and `tier` |
| `subscription_changed` | the update that first stores a new tier (normally the subscription-updated webhook) | the user | `from_tier`, `to_tier`, `direction` (`up` or `down`); sets `plan` and `tier` |
| `subscription_cancelled` | Premium ends | the user | `tier`, `reason` (`seller`, `payment_failed` or `admin`); sets `plan` and `tier` |
| `subscription_payment_failed` | a renewal fails (the invoice-failed webhook) | the user | `tier`, `attempt` (Stripe's attempt count) |
| `credits_limit_reached` | a monthly credit pool reaches 80% or 100%, alongside billing's notice | the user | `plan`, `tier`, `threshold` (`80` or `100`) |
| `heartbeat` | every 15 minutes (section 8) | none (system) | `healthy`, `app_ok`, `database_ok`, `stores_ok`, `failed`, `duration_ms` |

**Amounts.**
- **A sale's total** goes as a band: `under_25`, `25_to_100`, `100_to_250`, `250_to_1000`, `1000_plus`. A seller's sales are their business data, and the funnel and behavior questions only need the shape.
- **Estori's own fee** (`application_fee_cents`) goes exact, since it is Estori's revenue.
- **Template prices** go exact, since listings show them publicly.
- **Exact revenue for finance** comes from PostHog's Stripe data warehouse source (section 8).

**First sale** is a property, not a separate event: `sale_completed` with `first_sale: true` is the seller's first order in that mode. The funnel filters on it.

**Billing's events.** Billing ships first and sends no analytics. This change adds its five events at billing's own code points:
- `subscription_started`, `subscription_changed`, `subscription_cancelled` and `subscription_payment_failed` come from billing's subscription handling (`applySubscription`).
  - They go out right after billing records the Stripe event in `billing_events` for the first time. A retried or repaired event never counts twice.
  - The daily repair job runs the same code, so a cancellation it finds is counted once too.
- **Why Premium ended:**
  - `payment_failed` when the subscription was past due or unpaid;
  - `seller` when the seller had cancelled at the period's end;
  - otherwise `admin`. Sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard.
- `credits_limit_reached` goes with billing's 80% and 100% credit notices, only when the notice is sent. Billing's claim on the notice keeps it to once per period and threshold.

## 5. Identity

- **The id:** `distinct_id` is the Estori user id.
- **The browser** calls `identify(user.id)` on sign-in and sign-up, and `reset()` on sign-out. A shared computer then never merges two people.
- **Person properties**, set by the server:
  - `plan` and `tier`: the account's plan as billing resolves it, from the subscription and any admin override. That is `basic`, `premium` with its tier, or `enterprise`.
  - `seller_level`: `none`, `new` or `established`.
  - `has_live_store`.
  - `signup_date` (set once).
- **When they're set:** on sign-up, sign-in, publish, take-offline and every billing event. After a billing event, the plan is read from the row billing just wrote.
- **No email, name, username or avatar** goes to PostHog. Admins look people up in Estori's own admin pages by user id.
- **Worker errors and the heartbeat** use the system id `estori-system`. Opted-out cost fields use `opted-out`. Neither has a person profile.

## 6. Session replay

- **On** for the public site and the app.
- **Sampling** (set in PostHog's project settings as two trigger groups):
  - 20% of sessions;
  - every session where `$exception` fires.
  - **Why 20%:** early traffic is small. 20% gives enough sessions to watch and stays inside PostHog's free replay allowance up to about 25,000 sessions a month. Error sessions are the ones worth watching, so they're always kept.
- **What a replay shows: layouts and clicks, not what's written on the page.**
  - All page text is masked (`maskTextSelector: '*'`), and every input (`maskAllInputs`).
  - Every iframe is blocked (`blockSelector: 'iframe'`). The editor's preview carries a signed preview token in its address, and the other iframes show stores and email previews.
  - Page addresses inside replay data lose their query (section 4).
- **Paused paths:** `/orders`, `/emails`, `/profile` (with the payments setup at `/profile?tab=paid`), `/settings` (with billing at `/settings/billing`) and `/admin`.
  - On route change the app stops recording when it enters one of them, and starts again when it leaves.
  - Restarting respects the sampling.
- **A pause flag:** `session-replay-paused` at 100% turns replay off without a deploy.
  - Signed-in users get it with their session.
  - Anonymous visitors get it from the config endpoint, evaluated for a shared anonymous subject.

## 7. Error tracking

- **Browser:** posthog-js exception autocapture (`capture_exceptions: true`). The React error boundary reports what it catches.
- **Worker:**
  - **Where errors come from:** `logger.error` sends a `$exception` event alongside the log line. So does an unhandled API error, through a new Hono `onError`, and an unhandled request error.
  - **What it holds:** the error type, the message, raw stack frames and the logger's component.
  - **Privacy:** email addresses in messages become `[email]`. The logger's structured data is not sent, because it can hold anything.
  - **Limits:** the same error (same component, type and message with numbers removed) goes once a minute. At most 30 go per minute per isolate.
  - **No loops:** the PostHog client logs its own failures as warnings, never as errors, so a failing PostHog can't feed itself.
  - **The Worker bundle isn't minified**, so its stacks read without source maps.
- **Source maps:**
  - The browser build makes hidden source maps.
  - At deploy, a pinned `@posthog/cli` injects chunk ids and uploads the maps. Then they're deleted, so they're never served.
  - **Credentials:** the GitHub environment holds a personal API key and the project id. The deploy step maps them onto the variable names the pinned CLI reads (versions known today read `POSTHOG_CLI_TOKEN` and `POSTHOG_CLI_ENV_ID`).
  - Without credentials the maps are just deleted. A failed upload never blocks a deploy.
- **SpaceDO** logs with `console`, not the Worker logger. Its errors stay in Workers Logs only.
- **Sentry goes away** once PostHog error tracking is verified on staging, in a second pull request: the browser SDK, the tunnel route, `useSentryUser`, the logger call, the D1 wrapper (it exists only for Sentry), `Sentry.setUser`, the vite plugin comments and both packages.
  - **Security events:** `captureSecurityEvent` becomes a structured warning log.
  - **The AI feedback tool** only worked with a Sentry DSN, which no Estori deploy has, and Think doesn't use it. It's removed.

## 8. Monitoring, alerts and uptime

### Dashboards (built in PostHog by hand; exact definitions here)

1. **Activation:** a funnel with a 30-day window:
   1. `account_created`;
   2. `build_started` where `first_build = true`;
   3. `store_published` where `first_publish = true`;
   4. `payments_ready`;
   5. `sale_completed` where `first_sale = true`.
2. **Retention:** weekly. The start event is `account_created`; the return event is `build_started`.
3. **AI credits per day:** the sum of `credits_used` on `build_finished`, by day, broken down by `model`.
   - No filter: every Think build runs on Estori's gateway, so every credit is Estori's cost.
   - Opted-out builds show under the model "none", since they carry only their credits.
4. **Errors:** `$exception` count by day, broken down by `component` (Worker) and by exception type. It links to PostHog's error tracking.
5. **Revenue:** from the Stripe data warehouse source in the production project:
   - gross store sales by day;
   - Estori's application fees by day;
   - template sales;
   - Premium subscriptions.
6. **Billing:** `subscription_started`, `subscription_changed` by `direction`, `subscription_cancelled` by `reason`, and `credits_limit_reached` by `threshold`, weekly.
7. **Health:** `heartbeat` count per hour, and the count where `healthy = false`.

### Alerts (PostHog insight alerts, emailed to the owner)

| Alert | Insight | Condition | Checked |
| --- | --- | --- | --- |
| Heartbeat missing | `heartbeat` count, hourly | less than 2 | hourly |
| Health check failing | `heartbeat` where `healthy = false`, hourly | more than 0 | hourly |
| Error spike | `$exception` count, hourly | more than 25 | hourly |
| No signups | `account_created` count, daily | less than 1 | daily, turned on at public launch |
| AI credits over budget | sum of `credits_used` on `build_finished`, daily, every build including opted-out ones | more than the owner's budget (proposed 150,000 until two weeks of data exist) | daily |

### Uptime: the heartbeat

- **When:** the scheduled handler runs on `*/15 * * * *` today, and the heartbeat runs on that cron.
- **What it checks, from inside:**
  - **app:** a `GET /api/health` request through the Worker's own fetch handler, in-process. It must answer 200 with `status: ok`. On staging the request carries the staging key, so the gate lets it through.
  - **database:** `SELECT 1` on D1.
  - **stores:** when `STORES_DOMAIN` is set and a store is live, a `GET` of the newest live store's home page through the same in-process handler. It must answer below 500. Otherwise the check is `null`.
- **Each check has a 10 s timeout.**
- **The event:** a `heartbeat` event with the results, sent even when checks fail.
- **Two alerts:**
  - **"Heartbeat missing"** fires when the Worker, its cron or PostHog stops.
  - **"Health check failing"** fires when the Worker runs but something inside is down.
- **Why from inside:** production is behind Access until launch, so an outside checker would need a service token. In-process checks also skip DNS and TLS, which Cloudflare runs. An outside uptime check is a follow-up after launch.

### AI cost

- **The choice:** Estori captures credits per build on the server. It doesn't send `cf-aig-metadata` to AI Gateway.
- **How:**
  - ThinkAgent counts the steps of each turn and prices them with the turn's model `creditCost`. That is the same unit billing charges.
  - The host reads it when the turn ends and sends it on `build_finished`.
- **Why:**
  - Credits are the unit plans and billing use.
  - The data lands in PostHog, where the dashboard and the budget alert live.
  - Gateway metadata would only show in Cloudflare's dashboard, and would need a second pipeline to alert on.
- **Everyone counts:** opted-out builds still send their credits, without a person (section 4).
- **Not counted:** AI calls outside Think turns, such as product page copy drafts. They are a small share.

## 9. Feature flags

### The registry

`shared/types/feature-flags.ts` lists every flag. Each has:
- **`description`**;
- **`kind`:** `rollout` (turns something on) or `pause` (pauses something);
- **`clientVisible`:** whether it's sent to the browser. Server-only flags never leave the Worker.

The rules:
- **Every flag defaults off. Flags only ever turn something on or pause something.**
  - PostHog leaves a disabled flag out of its `/flags` answer. A flag that defaulted on would stay on when someone disabled it, so no flag does.
  - A missing, disabled or errored flag, or a PostHog outage, rolls nothing out and pauses nothing.
  - **Pausing** means the pause flag active at 100%. Unpausing means lowering it to 0% or disabling it.
- **Pause flags end in `-paused`.**
- **Secrets and infrastructure toggles stay env vars:** keys, domains, `CATALOG_SUPPLIER_LIVE`, `LIVE_STORE_PAYMENTS`, `ENABLE_*` and `STAGING_GATE_KEY`.

| Flag | Kind | Browser | What it does when on |
| --- | --- | --- | --- |
| `billing` | rollout | yes | turns on plans, subscriptions and the billing page at `/settings/billing`. Also on with `BILLING=on`, or for a user in `BILLING_USER_IDS` (see below) |
| `store-drafts-paused` | pause | yes | pauses starting new drafts: the "New draft" button, `POST /api/stores/:id/drafts` and the AI's `create_draft`. Drafts that exist keep working, so nobody is stranded on a draft. With only Main, the switcher is hidden |
| `live-store-payments-paused` | pause | no | pauses real payments on live stores. Real payments need `LIVE_STORE_PAYMENTS=on` and this flag off |
| `catalog-paused` | pause | yes | pauses selling catalog products. Catalog items read as sold out at checkout, the AI's catalog tools answer that the catalog is paused, and the catalog page and its sidebar link are hidden. Paid catalog orders still go to the supplier |
| `session-replay-paused` | pause | yes | pauses session replay in the browser |

**Billing's switches stay.** Billing shipped first with `BILLING=on` (everyone) and `BILLING_USER_IDS` (named accounts).
- The `billing` flag is on when either switch says so, or when PostHog says so.
- PostHog can add accounts to billing, but merging PostHog, or PostHog failing, never switches billing off for a paying seller.
- Billing's own checks read the `billing` flag from now on: `loadAccount`, the prompt check, the billing controller and the public plan answer.
- The switches are removed only in a later change, once PostHog's `billing` flag is at 100%.

### Server evaluation

- **The request:** `POST https://us.i.posthog.com/flags?v=2` with the user id as `distinct_id` and `person_properties: { plan }`. Targeting by user and by plan works at once, without waiting for person data.
- **The plan** is read only when PostHog is asked, straight from billing's tables. It doesn't go through `loadAccount`, which itself reads the `billing` flag.
- **The answer:** each registry flag's `enabled`.
  - A flag missing from the answer (not created, disabled or deleted in PostHog) is off.
  - An answer with `errorsWhileComputingFlags: true` counts as a failure, since its values can't be trusted: every flag is off.
- **The cache:** answers are cached in the isolate for 60 s per user. A failure, a timeout (1.5 s), a quota-limited answer or an answer computed with errors means every flag is off, cached for 10 s.
- **Anonymous visitors** are evaluated as `anonymous-visitor`, plan `none`.
- **Local and staging overrides:** outside production, `FEATURE_FLAG_OVERRIDES` (for example `billing=on,catalog-paused=on`) overrides any flag. Production ignores it.
- **The API:**
  - `flagsFor(env, userId)` answers every value, where it came from, and which flags PostHog knows;
  - `isFlagOn(env, key, userId)` answers one.
  - Neither ever throws.

### In the browser

- **Bootstrapped with the session:** the signed-in session payload carries the client-visible flags. That is the answer of `GET /api/auth/profile`, `POST /api/auth/login` and `POST /api/auth/register`. The UI that depends on a flag renders once, with the right value.
- **Signed out:** every flag off.
- **`useFlag(key)`** reads them, for example `useFlag('catalog-paused')`.
- **Freshness:** a flag change reaches a signed-in browser on its next profile fetch. That is a reload, a return to the tab after five minutes, or the hourly check. The server enforces every flag anyway.

### Seeing and managing flags

- **Edits happen in PostHog.**
- **`/admin/flags`** (admins only) lists every registry flag:
  - its description, kind, and whether the browser sees it;
  - its live value for the admin or for any user id typed in, as "On"/"Off" for a rollout and "Paused"/"Not paused" for a pause flag;
  - whether PostHog answered for it ("in PostHog") or it's off because PostHog didn't.
- **`scripts/posthog-sync-flags.ts`** creates the registry's flags that a PostHog project lacks:
  - every one active at 0%, so nothing is rolled out and nothing is paused until someone raises it;
  - it never changes an existing flag.

### Experiments

A/B experiments are out of scope. Every flag is a boolean, and nothing records exposure.

## 10. Privacy

- **The privacy policy** (`src/content/legal/privacy.md`):
  - **Section 1:** adds "Usage information":
    - pages viewed, without the part of the address after a question mark;
    - clicks, device and browser, and approximate location from the IP address;
    - errors and session recordings: "We record layouts and clicks, not what's written on the page or what you type."
    - Recordings skip orders, shopper emails, profile and payments setup, settings and billing, and admin pages, and never show the store's preview.
  - **Section 3:** adds **PostHog** as a service provider for product analytics, session recordings, error reports and feature flags. It names US hosting. It says no email or name is sent.
  - **Section 4:** replaces "We don't use advertising or analytics cookies". The new text says:
    - Estori uses PostHog's first-party analytics cookie and storage on estori.app;
    - there are no advertising cookies;
    - how to turn analytics off;
    - stores don't load Estori's analytics.
  - **Section 6:** adds the Analytics setting and Global Privacy Control. It also says that with analytics off, Estori still counts the AI credits a person's builds use, without anything that identifies them.
  - **The `updated` date** changes. The version stays `2026-10-16`, so nobody is asked to agree again.
- **The analytics setting:** a card in Settings, "Analytics", with a switch "Share usage analytics with Estori".
  - **Turning it off:**
    - stores `analyticsOptOut: true` in the user's `preferences` JSON (no migration);
    - calls `posthog.opt_out_capturing()`;
    - makes the server drop that user's events, except anonymous build credits (section 4).
  - **The API:** `GET` and `PUT /api/user/analytics`.
- **Global Privacy Control:**
  - **The browser:** with `navigator.globalPrivacyControl` on, posthog-js starts opted out.
  - **The server:** a request carrying `Sec-GPC: 1` to the profile, login, register, email confirmation or provider callback stores the opt-out on the account, with source `gpc`. It does so before any event of that request is sent.
  - **The switch:** while the browser sends GPC, the switch can't turn analytics back on. The card says why.
- **No consent banner.** Estori serves the US only. EU expansion would need a consent banner before posthog-js loads, and EU processing terms.
- **Shoppers** on stores are never tracked by Estori (section 4).

## 11. Environments and configuration

| | Production | Staging | Local |
| --- | --- | --- | --- |
| PostHog project | Estori production | Estori staging | none, unless a developer sets a key |
| `POSTHOG_PROJECT_KEY` (Worker secret) | set by the owner | set by the owner | optional in `.dev.vars` |
| `FEATURE_FLAG_OVERRIDES` (var) | ignored | allowed | allowed |
| `BILLING`, `BILLING_USER_IDS` (billing's vars) | kept, added to the `billing` flag | kept | kept |
| `environment` on events | `prod` | `staging` | `dev` |
| Source map upload | yes | yes | no |

- **Hosts are constants in code:**
  - ingest `us.i.posthog.com`;
  - assets `us-assets.i.posthog.com`;
  - the UI `https://us.posthog.com`.
- **`GET /api/telemetry/config`** (public) gives the browser:
  - the project key, which is public by design;
  - `apiHost: '/ingest'`, the UI host and the environment;
  - whether replay is paused for anonymous visitors (`replayPaused`).
- **GitHub environments** (staging and production) get:
  - secret `POSTHOG_CLI_API_KEY`: a personal API key with error tracking write and organization read;
  - variable `POSTHOG_CLI_PROJECT_ID`.
  - The deploy step maps both onto the names the pinned `@posthog/cli` reads.
- **The flag sync script** reads `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` from the shell running it.

## 12. Testing

**Unit and wiring tests** (vitest, Workers pool):
- **The event client:**
  - batching;
  - no key, no request;
  - opted-out people's events dropped, except cost fields, sent under `opted-out` with nothing else;
  - everyone treated as opted out when the setting can't be read;
  - failures, error answers and hangs never throw;
  - no request scope (Durable Objects, tests passing `{}`).
- **The flag evaluator:**
  - the request it sends;
  - the 60 s cache per user, with the plan read only on a miss;
  - every flag off on failure, quota, `errorsWhileComputingFlags`, timeout, or a flag PostHog leaves out, retried after 10 s;
  - overrides outside production only;
  - `billing` on with `BILLING=on` or a listed user, whatever PostHog says, and with PostHog alone;
  - billing's checks read the flag, not `isBillingOn`.
- **The account's plan:** billing's resolution, and Basic when its tables can't be read.
- **The proxy:**
  - only the two PostHog hosts;
  - `//attacker.example` stays a path;
  - no cookies, `Authorization` or staging key forwarded;
  - no `Set-Cookie` back;
  - 404 without a key.
- **The browser options:**
  - all page text and inputs masked, iframes blocked, autocapture without text or attributes;
  - every address stripped of its query, replay data included;
  - the paused paths.
- **Error reporting:**
  - stack parsing;
  - email scrubbing;
  - once a minute per error, 30 a minute;
  - never throws;
  - the logger and Hono's `onError` report.
- **Billing's events:**
  - each one's rule;
  - sent once after billing records the event;
  - nothing on a duplicate delivery or a failed record;
  - credit events only when the notice is sent.
- **The heartbeat checks**, healthy and failing.
- **Session telemetry:**
  - GPC stored before events;
  - an unreadable setting counts as opted out.
- **Each business event's properties**, and the wiring that sends it.
- **Guard tests:**
  - the browser identifies with the user id only and resets on sign-out;
  - replay pauses on the paused paths and under its pause flag;
  - the settings card;
  - the privacy policy text.

**Staging verification** (after the owner's setup):
1. **Events arrive.**
   - Pageviews and a click arrive in the staging project.
   - `account_created`, `build_started`, `build_finished` (with credits) and `store_published` arrive with the right person, `plan` and `tier`.
   - No `$current_url` has a query.
2. **Billing,** with billing on for the test account: a test-mode Premium checkout sends one `subscription_started`. Resending the Stripe event sends no second one.
3. **Replay:** a replay shows layouts and clicks with no page or typed text, the preview as a blocked box, and nothing from `/orders` or `/settings`.
4. **Errors:** a thrown browser error arrives with its stack in the original source file. A Worker error arrives with its component.
5. **A pause flag:**
   - Raising `catalog-paused` to 100% hides the catalog page within a minute after a reload, and the AI's catalog search answers paused.
   - Disabling the flag brings the catalog back.
6. **An alert:** with the heartbeat alert's threshold raised to 100, the alert fires at its next check. The threshold then goes back to 2.
7. **The setting:** turning analytics off in Settings stops events from that user, browser and server. The one exception is `build_finished`'s credits under `opted-out`.

## 13. Rollout

1. **Pull request 1:** everything except Sentry's removal.
   - It's safe to merge before PostHog exists. Without keys nothing is sent and every flag is off: nothing rolled out, nothing paused.
   - Billing keeps working on `BILLING` and `BILLING_USER_IDS`.
2. **The owner's setup** (section 16), staging first.
3. **Staging verification** (section 12).
4. **Pull request 2:** remove Sentry.
5. **Production:** the owner sets the production key, syncs flags and deploys as usual.

## 14. Out of scope

- Analytics for sellers about their own stores (store visits, conversion). The live stores spec already leaves this out.
- Tracking shoppers on generated or live stores.
- An EU consent banner, and EU processing terms.
- A/B experiments and multivariate flags.
- An outside uptime check (after launch, with an Access service token).
- Sending AI Gateway metadata (`cf-aig-metadata`) from Think builds.
- Business alerts (`platform-alerts.ts`) moving to PostHog. They stay as they are.
- SpaceDO errors in PostHog.
- Dashboards and alerts as code. They are built by hand from section 8.
- Removing billing's `BILLING` and `BILLING_USER_IDS`. That waits until PostHog's `billing` flag is at 100%.

## 15. Decisions made on the owner's behalf

| Decision | Why | If wrong |
| --- | --- | --- |
| PostHog Cloud, US region, one project per environment (production, staging); local sends nothing without a key | US only for now; separate projects keep test data out of production numbers | create an EU project later and change the three host constants |
| Browser traffic through `estori.app/ingest`, proxied by the Worker | ad blockers don't drop it; PostHog's hosts never join the app's CSP, since the lazy-loaded scripts come through the proxy; PostHog documents this pattern | point `apiHost` at PostHog directly, add its hosts to the CSP, and drop the route |
| posthog-js only on estori.app; never on stores, previews, sellers' domains or checkout | shoppers aren't Estori's users | add a separate, consented store analytics product |
| Business events sent by the Worker, typed in one shared catalog | they must be right even when the browser blocks analytics | move an event to the browser with `posthog.capture` |
| Sale totals as bands; Estori's fee and template prices exact | a seller's sales are their data; exact revenue comes from the Stripe source | send `total_cents` instead of `total_band` |
| `first_sale` as a property of `sale_completed`, not its own event | one event per order; the funnel filters on it | add a `first_sale` event next to it |
| Identity is the user id; no email, name, username or avatar | privacy-minimal; admins look people up in Estori | add `$set: { email }` in `personUpdateOf` |
| `plan` and `tier` come from billing's plan resolution, read from its tables | billing ships first, so the real plan exists; reading the tables avoids a loop through `loadAccount` and the `billing` flag | target flags by user id only and drop `plan` |
| Billing's five events are added by this change at billing's own points, after `billing_events` records the Stripe event the first time | billing ships first without analytics; recording first means retries and repairs never double count | move the calls into billing and keep the catalog here |
| A Premium cancel with no prior period-end cancel and no failed payment counts as `admin` | sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard | read Stripe's `cancellation_details` instead |
| `credits_limit_reached` only when billing's notice is actually sent | the notice's claim keeps it to once per period and threshold | send it when the claim is won, even if the email fails |
| Replay: 20% of sessions plus every session with an error | enough to watch, inside the free allowance at early traffic | change the trigger groups in PostHog; no deploy |
| Replays record layouts and clicks only: all page text and inputs masked, every iframe blocked | page text holds prompts, store content and customer details; the preview iframe carries a signed preview token | mask selected elements instead of `*` |
| Autocapture sends no element text or attributes | a clicked element's text can be anything on the page | turn `mask_all_text` off |
| Every captured address loses its query and fragment, in events and replay data; `$pathname` stays | reset and confirmation tokens and chat prompts travel in queries | strip only named parameters |
| Replay paused on orders, shopper emails, profile and payments setup, settings and billing, and admin pages | those pages hold customer, payout and account data | remove a path from `REPLAY_PAUSED_PATHS` |
| Worker errors: component, type, message (emails scrubbed) and stack only; logger data not sent; once a minute per error, 30 a minute | logger data can hold anything; a loop must not flood PostHog | send selected data fields, or raise the limits in `server-errors.ts` |
| Sentry removed after staging verification, in a second PR | it never ran in Estori; two error tools confuse | keep Sentry and drop the second PR |
| AI cost as credits per build, captured by the server; no `cf-aig-metadata` | credits are what plans use, and the alert lives in PostHog | add the metadata header in `configureThinkAgent` |
| The cost dashboard and the budget alert count every Think build, with no gateway filter | Think always runs on Estori's gateway, so every build is Estori's cost | add a filter if Think ever runs on a seller's own gateway |
| For people who opted out, only `build_finished`'s `credits_used` is sent, under `opted-out`, with no person or other property | the AI budget must count every build; a credit count alone identifies no one | drop opted-out builds and accept a budget that undercounts |
| Uptime from an in-process heartbeat every 15 minutes, alert below 2 an hour | production is behind Access; no new service needed | add an outside checker with an Access service token |
| Every flag defaults off: `billing` is a rollout; drafts, live payments, the catalog and replay have pause flags | PostHog omits disabled flags, so a default-on kill switch stayed on when disabled; with pause flags an outage or a missing flag pauses nothing | none safe: a default-on flag can't be switched off through PostHog |
| An answer with `errorsWhileComputingFlags: true` counts as a failure: every flag off, retried in 10 s | its values can't be trusted, and off pauses nothing | trust the flags it did return |
| `store-drafts-paused` pauses only starting new drafts | sellers already on a draft are never stranded | pause the switcher too |
| `catalog-paused` makes catalog items read as sold out at checkout; paid orders still placed | shoppers see a known message; paid orders are never dropped | refuse the checkout with a new message instead |
| `billing` is on with `BILLING=on`, a user in `BILLING_USER_IDS`, or PostHog; billing's checks read the flag | billing ships first; merging or misconfiguring PostHog must never switch billing off for a paying seller | remove the switches once PostHog's flag is at 100% |
| Flags sent with the session (profile, login, register), not by their own request | the UI renders once with the right value | add `GET /api/flags` and a loading state |
| Flag cache 60 s per user, timeout 1.5 s, failures cached 10 s | changes land within a minute; sign-in never waits long | change the constants in `flags.ts` |
| Flags created by a sync script at 0%; never edited by it | keys can't be mistyped; nothing turns on or pauses by accident; PostHog stays where edits happen | create flags by hand |
| `/admin/flags` is read-only | edits and history belong in PostHog | add edit buttons that call PostHog's API |
| Opt-out stored in `users.preferences` JSON, no migration | the column exists and is unused; no clash over migration numbers | move it to its own column later |
| A GPC signal is stored as the account's opt-out | the signal is a standing request; server events need it too | honor GPC per request only |
| No consent banner | US only, and analytics is first-party | add one before any EU launch |
| Privacy policy version unchanged, so no one is asked to agree again | adding an analytics processor needs notice, not consent, in the US; production isn't public yet | bump `TERMS_VERSION`, which shows the agreement again |
| The client IP is forwarded so PostHog can tell the country | country is useful for a US-only launch | turn on "Discard client IP data" in both projects |
| posthog-js bundled with the app from npm | no third-party script origin; its lazy-loaded scripts come through the proxy | load the snippet from PostHog's CDN and add its hosts to the CSP |
| `@posthog/cli` pinned to an exact version; the deploy maps GitHub's secret names onto the variables that version reads | CLI versions have read different variable names (`POSTHOG_CLI_TOKEN`/`POSTHOG_CLI_ENV_ID` against the docs' `POSTHOG_CLI_API_KEY`/`POSTHOG_CLI_PROJECT_ID`) | change the two constants in `scripts/posthog-sourcemaps.ts` and the workflow mapping |
| Dashboards and alerts built by hand from section 8 | small, one-time work; PostHog's UI is the reference | script them with PostHog's API later |
| Alerts go to the owner's email | the only on-call today | add recipients in PostHog |
| Security events (CSRF, rate limit) become warning logs; the Sentry-only AI feedback tool is removed | both only ever went to Sentry | send security events to PostHog as events |
| The source map files are deleted after upload | they are never served publicly | keep them and block `*.map` in the Worker |

## 16. Owner steps

1. **Create the PostHog organization** on US Cloud, with two projects: "Estori production" and "Estori staging". Generate and sign PostHog's DPA at posthog.com/dpa.
2. **Collect from each project:**
   - the project API key (`phc_...`);
   - the project id;
   - a personal API key with feature flag read and write, error tracking write, and organization read.
3. **Set the Worker secret** for each environment, for example `npx wrangler secret put POSTHOG_PROJECT_KEY --config wrangler.estori-staging.jsonc`, and the same for `wrangler.estori.jsonc`.
4. **Set in GitHub** for the `staging` and `production` environments. The deploy maps these onto the CLI's own variable names.
   - secret `POSTHOG_CLI_API_KEY`;
   - variable `POSTHOG_CLI_PROJECT_ID`.
5. **Create the flags** in each project: `POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... bun scripts/posthog-sync-flags.ts`. Every flag starts active at 0%: nothing rolled out, nothing paused.
   - **`billing`:** raise it as the billing plan says. `BILLING` and `BILLING_USER_IDS` keep working alongside it.
   - **To pause something** (drafts, live payments, the catalog, replay): raise its `-paused` flag to 100%. Lower it to 0% to unpause.
6. **In each project's settings:**
   - turn on session replay, with two trigger groups: no conditions at 20%, and event `$exception` at 100%;
   - turn on exception autocapture;
   - add `estori.app` and `staging.estori.app` as authorized URLs for the toolbar.
7. **Build the dashboards and alerts** in section 8. Use your email as the alert recipient. Pick the daily AI credit budget.
8. **Connect the Stripe data warehouse source** in the production project, with a restricted read-only Stripe key.
9. **Have the privacy policy changes reviewed** before public launch.
10. **Run the staging verification** with the implementer. Then approve pull request 2.
