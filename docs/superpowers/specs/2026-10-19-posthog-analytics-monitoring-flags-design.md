# PostHog analytics, monitoring and feature flags: design

- **Date:** 2026-10-19
- **Status:** approved by the owner to go ahead. Written while the owner was away, revised after a builder check, then revised again once PostHog was set up (section 2). Every choice made for the owner is in section 15, with why and what to do if it's wrong.
- **The owner's request:** "we need to implement a system for tracking and monitoring plus feature flags. I'd like to use PostHog as much as possible for that." Later: flag control over features already shipped, and web analytics from PostHog and Cloudflare.
- **Builds on:** main with store drafts (`docs/superpowers/specs/2026-10-19-store-drafts-design.md`) and billing (`docs/superpowers/specs/2026-10-19-billing-subscriptions-design.md`) merged.
  - Billing ships first, behind its own `BILLING` and `BILLING_USER_IDS` switches. Its plans are `basic`, `pro`, `premium` and `enterprise`, with no tiers.
  - This change adds billing's events (section 4) and puts its switches under the `billing` flag (section 9).
  - Billing's code points are named here by their role. Billing's merged code decides the names.

## 1. Purpose and success

**The gap today.** Estori can't see how sellers use it. It doesn't hear about errors, and it has no way to roll a feature out to some sellers or pause one for everyone. Sentry was wired in by upstream but never turned on. Nothing alerts on errors, outages or AI cost.

**What this adds, mostly in PostHog:**
- **Product analytics:** pageviews and clicks on estori.app, plus authoritative business events sent by the Worker.
- **Web analytics:** PostHog's web analytics for estori.app, and Cloudflare Web Analytics, already on, for page view counts on every estori.app host.
- **Session replay:** a sample of production sessions, plus every session with an error. Replays show layouts and clicks, never what's written on the page, what's typed, or images.
- **Error tracking:** browser and Worker errors, with source maps for the browser bundle once an optional key is added.
- **Monitoring:** dashboards, alerts and an uptime heartbeat.
- **Feature flags:** a typed registry in code, evaluated on the server, sent to the browser with the session. Every flag is off unless PostHog turns it on. Ten pause flags can stop a shipped feature without a deploy.

**Success means the owner can:**
1. open one dashboard and see the activation funnel: signup, first build, first publish, payments ready, first sale;
2. get an email when errors spike, when a day has no signups, when AI cost passes a budget, or when the heartbeat stops;
3. open an error in PostHog and read its stack, in the original source once the optional key for source maps is added;
4. roll billing out to 10% of sellers, or pause AI builds, sign-ups, publishing or the catalog for everyone, and see it take effect within a minute;
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
| Cloudflare Web Analytics | the estori.app zone, automatic since 2026-10-05 | on for every host on the zone: estori.app, preview.estori.app and staging.estori.app. Cookieless page view counts. The app's CSP in `index.html` already allows `static.cloudflareinsights.com`, so no code is needed |
| Flags | env strings (`LIVE_STORE_PAYMENTS`, `CATALOG_SUPPLIER_LIVE`, `ENABLE_*`, ...), billing's `BILLING` and `BILLING_USER_IDS`, `PLATFORM_CAPABILITIES`, KV `platform_configs` and `user_config:{userId}` | no percentage rollout, no targeting, no admin view |
| CSP | the app's meta tag in `index.html`; `worker/config/security.ts` for `/api`; the checkout page's own CSP | the app's `script-src` allows `'self' 'unsafe-inline' blob:`, four CDNs and Cloudflare's beacon; `connect-src` allows any `https:` and `wss:` |
| Privacy policy | `src/content/legal/privacy.md` | section 4 says "We don't use advertising or analytics cookies"; section 3 lists no analytics vendor |

### PostHog, set up on 2026-10-19

The coordinator set PostHog up in the owner's account, on US Cloud, in the organization "Estori".
- **One project.** The free plan allows one: "Estori production", id `675096`.
- **Its token** is `phc_A96M8y8nVJTwpJoFJAwcis2JVsjWYTBVKghz38WCFHiC`. A project token is public and can only write events, so it isn't a secret.
- **Project settings:**
  - app URL and recording domain `https://estori.app`;
  - exception autocapture, web vitals, heatmaps and dead clicks on;
  - session replay on, with "Total privacy" masking: all text masked (`*`), all inputs masked, images blocked;
  - console logs in replay off; network timings on, without headers or bodies;
  - data retention 30 days.
- **Replay triggers,** two groups:
  - "Production sample": URL matches `^https://estori\.app/.*$`, 20% of sessions;
  - "Sessions with an error": event `$exception` and that URL, 100%.
- **The test-account filter** leaves out hosts `localhost`, `127.0.0.1` and `staging.estori.app`, and is on by default in new insights.
- **Flags:** all 11 in section 9 exist, active at 0%. A check through `/flags?v=2` confirmed it.
- **Not there:** a personal API key. None was created, and section 16 makes it optional.

## 3. Overview

```
Browser on estori.app ── posthog-js ──> estori.app/ingest/* ── Worker proxy ──> us.i.posthog.com, us-assets.i.posthog.com
Worker (requests, crons, Durable Objects) ── batch capture, $exception ──> us.i.posthog.com/batch/
Worker ── /flags?v=2 (60 s cache) ──> us.i.posthog.com ── flags in the session ──> browser
PostHog: dashboards, alerts (email), session replay, error tracking, web analytics, Stripe data warehouse source
Cloudflare: Web Analytics on every estori.app host (no code)
```

- **New Worker code** lives in `worker/services/posthog/`.
- **The registries** live in shared code: `shared/types/analytics-events.ts` (events) and `shared/types/feature-flags.ts` (flags).
- **The browser side** is `posthog-js`, set up in one component, `src/components/analytics/PostHogSync.tsx`.
- **Production is the only PostHog environment.**
  - The server reads the token from `POSTHOG_PROJECT_KEY`, a plain var in `wrangler.estori.jsonc` only.
  - The browser maps its hostname to a token in a committed file, `src/lib/analytics/posthog-projects.ts`: `estori.app` gets the production token, and every other host gets none.
- **Everywhere else, PostHog is inert.** Staging, local development and tests have no token. Nothing is captured, the proxy answers 404, the heartbeat doesn't run, and flags are their defaults (every one off) plus `FEATURE_FLAG_OVERRIDES`.
- **A developer can opt in locally** with the production token (section 11). PostHog's test-account filter and the replay URL triggers keep that out of production numbers.

## 4. Analytics

### Browser

- **Where:** posthog-js runs on estori.app only: the public site and the app. The hostname map gives no other host a token.
- **Where not:** staging, previews, generated stores, live stores, sellers' own domains and the checkout page. Store visitors are shoppers, not Estori's users, and those pages aren't served by the app.
- **What it captures:**
  - pageviews on every route change (`capture_pageview: 'history_change'`) and page leaves;
  - autocapture of clicks and form submits, with no element text and no element attributes (`mask_all_text`, `mask_all_element_attributes`). Input values are never captured;
  - from the project's settings: exceptions, web vitals, heatmaps and dead clicks.
- **Addresses without queries:** every captured address loses its query and fragment before it leaves the browser. This uses a `before_send` hook, and covers `$current_url`, `$referrer`, the initial and session-entry addresses, and the page addresses inside replay data. `$pathname` stays. Reset and confirmation tokens, and the chat's `?query=` prompts, never reach PostHog.
- **Profiles:** anonymous visitors don't get person profiles (`person_profiles: 'identified_only'`).
- **The library** is bundled with the app from npm.
  - It lazy-loads `recorder.js` and its exception script from `<api_host>/static`, which is `/ingest/static` through the proxy.
  - The project's settings reach it as its remote config. The privacy options are also set in code, so a change in PostHog's UI can't loosen them.
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
- **Without a token** the proxy answers 404.

### Web analytics

- **PostHog's web analytics** reads the pageviews above: visitors, paths, referrers, devices and web vitals for estori.app. It needs no extra code.
- **Cloudflare Web Analytics** stays as it is: automatic on the estori.app zone, cookieless, counting page views on estori.app, preview.estori.app and staging.estori.app, and on stores served on estori.app addresses. Its numbers live in Cloudflare's dashboard.
  - It identifies no one and sets no cookie, so it isn't tied to the analytics setting.
  - The privacy policy names it (section 10).

### Server events

The Worker sends business events itself, because they must be right even when a browser blocks analytics.

- **How they're sent:** a small fetch client posts batches to `https://us.i.posthog.com/batch/`.
- **Batching:** events captured in the same tick go out in one request.
- **Timing:** sending runs after the response, through the request's `waitUntil`. In Durable Objects it runs on its own, since they stay alive for pending work.
- **Failures:** a failure, an error answer or a hang (3 s timeout) is logged as a warning and dropped. It never fails the request.
- **Every event carries:**
  - `environment` (`prod` in production, `dev` for a local opt-in);
  - `release` (the Worker version id);
  - `$host`, from `CUSTOM_DOMAIN` (`estori.app` in production, `localhost` locally), so the test-account filter treats local server events like local browser ones;
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
| `build_finished` | the turn ends | the owner | `app_id`, `model`, `first_build`, `outcome` (`completed` or `failed`), `steps`, `credits_used`, `duration_ms`. `credits_used` is the credits billing charged for the turn's steps, and its cost field |
| `store_published` | a publish succeeds | the owner | `app_id`, `first_publish`, `draft` (`main` or `other`); sets `has_live_store` |
| `store_unpublished` | the store is taken offline | the owner | `app_id`; sets `has_live_store` |
| `payments_ready` | the seller's Stripe account becomes able to take store payments | the seller | none |
| `sale_completed` | a store order is recorded, once per order | the seller | `app_id`, `mode`, `total_band`, `application_fee_cents`, `has_catalog_items`, `first_sale` |
| `catalog_order_placed` | a paid order's catalog lines are handed to the supplier flow | the seller | `app_id`, `item_count` |
| `template_sold` | a paid site's sale is recorded | the seller | `listing_id`, `price_cents`, `platform_fee_cents` |
| `subscription_started` | the first recorded Stripe event that stores the subscription as live, normally checkout completed | the user | `plan`; sets `plan` |
| `subscription_changed` | the first recorded event that stores another plan on the live subscription. A downgrade counts when it takes effect at renewal | the user | `from_plan`, `to_plan`, `direction` (`up` or `down`); sets `plan` |
| `subscription_cancelled` | the first recorded event that stores the subscription as cancelled | the user | `plan`, `reason` (`seller`, `payment_failed` or `admin`); sets `plan` |
| `subscription_payment_failed` | a renewal fails (invoice payment failed) | the user | `plan`, `attempt` (Stripe's attempt count) |
| `credits_purchased` | an extra-credits purchase is recorded, once | the user | `credits`, `amount_cents` |
| `credits_low` | billing claims its 20% or 5% credit notice, once per period and threshold | the user | `plan`, `threshold` (`20` or `5`) |
| `credits_limit_reached` | a turn is refused because no credits are left | the user | `plan` |
| `heartbeat` | every 15 minutes (section 8) | none (system) | `healthy`, `app_ok`, `database_ok`, `stores_ok`, `failed`, `duration_ms` |

**Amounts.**
- **A sale's total** goes as a band: `under_25`, `25_to_100`, `100_to_250`, `250_to_1000`, `1000_plus`. A seller's sales are their business data, and the funnel and behavior questions only need the shape.
- **Estori's own revenue goes exact:** the application fee (`application_fee_cents`), template prices (listings show them publicly), and extra credits bought (`amount_cents`).
- **Exact revenue for finance** comes from PostHog's Stripe data warehouse source (section 8).

**First sale** is a property, not a separate event: `sale_completed` with `first_sale: true` is the seller's first order in that mode. The funnel filters on it.

**Billing's events.** Billing ships first and sends no analytics. This change adds its seven events at billing's own code points, by role:
- **The subscription event handler** (the webhook step that rebuilds the subscription row from Stripe and records the event in `billing_events`) sends the four `subscription_*` events.
  - They go out right after billing records the Stripe event for the first time, built from the row billing had and the row it just stored. A retried or repaired event never counts twice.
  - Whichever event first stores a change sends it, so Stripe's delivery order doesn't matter.
- **The credit top-up handler** sends `credits_purchased` after it records the purchase the first time.
- **The credit notices** send `credits_low` when billing's claim on the `credits_20` or `credits_5` notice is new, whether or not the email went out. The claim keeps it to once per period and threshold.
- **The prompt gate** sends `credits_limit_reached` each time it refuses a turn because no credits are left.
- **Why a plan ended:**
  - `payment_failed` when the subscription was past due or unpaid;
  - `seller` when the seller had cancelled at the period's end;
  - otherwise `admin`. Sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard.

## 5. Identity

- **The id:** `distinct_id` is the Estori user id.
- **The browser** calls `identify(user.id)` on sign-in and sign-up, and `reset()` on sign-out. A shared computer then never merges two people.
- **Person properties**, set by the server:
  - `plan`: `basic`, `pro`, `premium` or `enterprise`, as billing's plan resolution gives it from the subscription row, the grace period and any admin override. There are no tiers;
  - `seller_level`: `none`, `new` or `established`;
  - `has_live_store`;
  - `signup_date` (set once).
- **When they're set:** on sign-up, sign-in, publish, take-offline and every billing event. After a billing event, the plan is read from the rows billing just wrote.
- **No email, name, username or avatar** goes to PostHog. Admins look people up in Estori's own admin pages by user id.
- **Worker errors and the heartbeat** use the system id `estori-system`. Opted-out cost fields use `opted-out`. Neither has a person profile.

## 6. Session replay

- **On for production only.** Both trigger groups match `https://estori.app/`, so a local opt-in records nothing.
- **Sampling** (the project's two trigger groups):
  - 20% of sessions;
  - every session where `$exception` fires.
  - **Why 20%:** early traffic is small. 20% gives enough sessions to watch and stays inside PostHog's free replay allowance up to about 25,000 sessions a month. Error sessions are the ones worth watching, so they're always kept.
- **What a replay shows: layouts and clicks, nothing written, typed or pictured.**
  - All page text is masked (`maskTextSelector: '*'`), and every input (`maskAllInputs`).
  - Images and iframes are blocked (`blockSelector: 'img, iframe'`). The editor's preview carries a signed preview token in its address, and the other iframes show stores and email previews.
  - No console logs. Network timings are kept, without headers or bodies.
  - Page addresses inside replay data lose their query (section 4).
  - The project's "Total privacy" setting says the same; the code repeats it, so the UI can't loosen it.
- **Paused paths:** `/orders`, `/emails`, `/profile` (with the payments setup at `/profile?tab=paid`), `/settings` (with billing at `/settings/billing`) and `/admin`.
  - On route change the app stops recording when it enters one of them, and starts again when it leaves.
  - Restarting respects the sampling.
- **A pause flag:** `session-replay-paused` at 100% turns replay off without a deploy.
  - Signed-in users get it with their session.
  - Anonymous visitors get it from the config endpoint, evaluated for a shared anonymous subject.

## 7. Error tracking

- **Browser:** posthog-js exception autocapture (`capture_exceptions: true`, also on in the project). The React error boundary reports what it catches.
- **Worker:**
  - **Where errors come from:** `logger.error` sends a `$exception` event alongside the log line. So does an unhandled API error, through a new Hono `onError`, and an unhandled request error.
  - **What it holds:** the error type, the message, raw stack frames and the logger's component.
  - **Privacy:** email addresses in messages become `[email]`. The logger's structured data is not sent, because it can hold anything.
  - **Limits:** the same error (same component, type and message with numbers removed) goes once a minute. At most 30 go per minute per isolate.
  - **No loops:** the PostHog client logs its own failures as warnings, never as errors, so a failing PostHog can't feed itself.
  - **The Worker bundle isn't minified**, so its stacks read without source maps.
- **Source maps:**
  - The browser build makes hidden source maps.
  - In a production deploy, a pinned `@posthog/cli` injects chunk ids and uploads the maps to project 675096. Then they're deleted, so they're never served.
  - **Credentials:** the upload needs a personal API key, the GitHub secret `POSTHOG_CLI_API_KEY` in the production environment. It's an optional owner step (section 16). The project id is public, so the workflow writes it, for production only. The deploy step maps both onto the variable names the pinned CLI reads (versions known today read `POSTHOG_CLI_TOKEN` and `POSTHOG_CLI_ENV_ID`).
  - Without the secret, and on staging and locally, the maps are only deleted, and browser stacks show minified names. A failed upload never blocks a deploy.
- **SpaceDO** logs with `console`, not the Worker logger. Its errors stay in Workers Logs only.
- **Sentry goes away** once the localhost and production checks pass, in a second pull request: the browser SDK, the tunnel route, `useSentryUser`, the logger call, the D1 wrapper (it exists only for Sentry), `Sentry.setUser`, the vite plugin comments and both packages.
  - **Security events:** `captureSecurityEvent` becomes a structured warning log.
  - **The AI feedback tool** only worked with a Sentry DSN, which no Estori deploy has, and Think doesn't use it. It's removed.

## 8. Monitoring, alerts and uptime

**Who builds them:** the coordinator, by hand in PostHog's UI, once events flow in production. The definitions below are exact. The plan copies them into a build sheet, `docs/estori/posthog-dashboards.md`, so the sheet and this section match. Every insight has "Filter out internal and test users" on.

### Dashboards

1. **Activation:** a funnel with a 30-day window:
   1. `account_created`;
   2. `build_started` where `first_build = true`;
   3. `store_published` where `first_publish = true`;
   4. `payments_ready`;
   5. `sale_completed` where `first_sale = true`.
2. **Retention:** weekly. The start event is `account_created`; the return event is `build_started`.
3. **AI cost per day:**
   - the sum of `credits_used` on `build_finished`, by day, broken down by `model`;
   - Estori's cost in dollars, as a formula on that sum: credits ÷ 1.5 × $0.001;
   - no gateway filter: every Think build runs on Estori's gateway, so every credit is Estori's cost;
   - opted-out builds show under the model "none", since they carry only their credits.
4. **Errors:** `$exception` count by day, broken down by `component` (Worker) and by exception type. It links to PostHog's error tracking.
5. **Revenue:** from the Stripe data warehouse source:
   - gross store sales by day;
   - Estori's application fees by day;
   - template sales;
   - subscriptions by plan, and extra credits bought.
6. **Billing,** weekly:
   - `subscription_started` by `plan`;
   - `subscription_changed` by `direction`;
   - `subscription_cancelled` by `reason`;
   - `subscription_payment_failed`;
   - `credits_purchased`, count and sum of `amount_cents`;
   - `credits_low` by `threshold`;
   - `credits_limit_reached` by `plan`.
7. **Health:** `heartbeat` count per hour, and the count where `healthy = false`.
8. **Web:** PostHog's built-in web analytics for estori.app, with web vitals. Cloudflare Web Analytics stays in Cloudflare's dashboard.

### Alerts (PostHog insight alerts, emailed to the owner)

| Alert | Insight | Condition | Checked |
| --- | --- | --- | --- |
| Heartbeat missing | `heartbeat` count, hourly | less than 2 | hourly |
| Health check failing | `heartbeat` where `healthy = false`, hourly | more than 0 | hourly |
| Error spike | `$exception` count, hourly | more than 25 | hourly |
| No signups | `account_created` count, daily | less than 1 | daily, turned on at public launch |
| AI cost over budget | sum of `credits_used` on `build_finished`, daily, every build including opted-out ones | more than 150,000 credits, about $100 of Estori's cost, until two weeks of data exist | daily |

### Uptime: the heartbeat

- **When:** the scheduled handler runs on `*/15 * * * *` today, and the heartbeat runs on that cron. It runs only where there's a project token, so today only in production.
- **What it checks, from inside:**
  - **app:** a `GET /api/health` request through the Worker's own fetch handler, in-process. It must answer 200 with `status: ok`. On staging, once staging has a project, the request carries the staging key, so the gate lets it through.
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
  - Billing charges every step from its real token cost: list-price cost × 1.5, in credits of $0.001.
  - ThinkAgent counts each turn's steps and reads billing's total of the credits it charged for them. The host sends both on `build_finished`.
  - Estori's own cost is then credits ÷ 1.5 × $0.001.
- **Why:**
  - Credits are the unit plans and billing use, and they now follow real cost.
  - The data lands in PostHog, where the dashboard and the budget alert live.
  - Gateway metadata would only show in Cloudflare's dashboard, and would need a second pipeline to alert on.
- **Everyone counts:** opted-out builds still send their credits, without a person (section 4). If billing's merged code charges only accounts inside the `billing` flag, ThinkAgent adds billing's step price for every step itself, so every build counts.
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
- **Pause flags end in `-paused`, and the server enforces them.** The browser hides a button only where that's cheap. A pause refuses new work with a plain message (HTTP 503, or a popup in the editor), before any write or outside call. Work already running finishes, and what exists keeps working.
- **Secrets and infrastructure toggles stay env vars:** keys, domains, `CATALOG_SUPPLIER_LIVE`, `LIVE_STORE_PAYMENTS`, `ENABLE_*` and `STAGING_GATE_KEY`.

| Flag | Kind | Browser | What it does when on |
| --- | --- | --- | --- |
| `billing` | rollout | yes | turns on plans, subscriptions and the billing page at `/settings/billing`. Also on with `BILLING=on`, or for a user in `BILLING_USER_IDS` (see below) |
| `store-drafts-paused` | pause | yes | pauses starting new drafts: the "New draft" button, `POST /api/stores/:id/drafts` and the AI's `create_draft`. Drafts that exist keep working, so nobody is stranded on a draft. With only Main, the switcher is hidden |
| `live-store-payments-paused` | pause | no | pauses real payments on live stores. Real payments need `LIVE_STORE_PAYMENTS=on` and this flag off |
| `catalog-paused` | pause | yes | pauses selling catalog products. Catalog items read as sold out at checkout, the AI's catalog tools answer that the catalog is paused, and the catalog page and its sidebar link are hidden. Paid catalog orders still go to the supplier |
| `session-replay-paused` | pause | yes | pauses session replay in the browser |
| `ai-builds-paused` | pause | no | refuses new AI turns everywhere they start: a new message in the editor, resuming after a model switch, the editor's generate and resume requests, and starting a new store. Running turns finish |
| `signups-paused` | pause | no | refuses new accounts: email sign-up, and a provider sign-in that would create an account. Existing accounts sign in, including a provider sign-in that finds or claims one |
| `store-publishing-paused` | pause | yes | refuses Go live and republishing. Live stores keep serving and can be taken offline. The Go live panel disables its publish button |
| `custom-domains-paused` | pause | yes | refuses connecting a new own domain. Connected domains keep working, and can be checked and removed. The Go live panel hides the domain form |
| `template-sales-paused` | pause | no | refuses buying a paid template. Free templates still start stores, and a purchase paid before the pause is still recorded |
| `billing-checkout-paused` | pause | no | refuses a plan checkout, a plan change and buying extra credits. Subscriptions keep renewing; the billing portal, cancelling and undoing a cancel stay open; webhooks still record payments |

**The refusals,** word for word:

| Flag | Message |
| --- | --- |
| `store-drafts-paused` | "Starting new drafts is paused right now." |
| `catalog-paused` | "Estori's catalog is paused right now, so catalog products can't be added to stores." |
| `ai-builds-paused` | "Building is paused for a few minutes. Your stores keep working." |
| `signups-paused` | "Sign-ups are paused for a moment. Please try again soon." A provider sign-in comes back to `/?error=signups_paused`, which shows the same message |
| `store-publishing-paused` | "Publishing is paused for a few minutes. Your live store keeps working." |
| `custom-domains-paused` | "Connecting a new domain is paused right now. Domains already connected keep working." |
| `template-sales-paused` | "Buying paid templates is paused right now. Free templates still work." |
| `billing-checkout-paused` | "Plan changes and credit purchases are paused for a few minutes. Your current plan keeps working." |

**Billing's switches stay.** Billing shipped first with `BILLING=on` (everyone) and `BILLING_USER_IDS` (named accounts).
- The `billing` flag is on when either switch says so, or when PostHog says so.
- PostHog can add accounts to billing, but merging PostHog, or PostHog failing, never switches billing off for a paying seller.
- Billing's own checks read the `billing` flag from now on: the account loader, the prompt gate, the billing controller, the public plan answer, and anywhere else billing's merged code reads its switches.
- The switches are removed only in a later change, once PostHog's `billing` flag is at 100%.

### Server evaluation

- **The request:** `POST https://us.i.posthog.com/flags?v=2` with the user id as `distinct_id` and `person_properties: { plan }`. Targeting by user and by plan works at once, without waiting for person data.
- **The plan** is read only when PostHog is asked, straight from billing's tables through billing's plan resolution. It doesn't go through the account loader, which itself reads the `billing` flag.
- **The answer:** each registry flag's `enabled`.
  - A flag missing from the answer (not created, disabled or deleted in PostHog) is off.
  - An answer with `errorsWhileComputingFlags: true` counts as a failure, since its values can't be trusted: every flag is off.
- **The cache:** answers are cached in the isolate for 60 s per user. A failure, a timeout (1.5 s), a quota-limited answer or an answer computed with errors means every flag is off, cached for 10 s.
- **Anonymous visitors,** and sign-ups, which have no account yet, are evaluated as `anonymous-visitor`, plan `none`.
- **Overrides:** outside production, `FEATURE_FLAG_OVERRIDES` (for example `billing=on,catalog-paused=on`) overrides any flag, with or without a token. That is how staging and local development pause something. Production ignores it.
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

- **Edits happen in PostHog,** at `https://us.posthog.com/project/675096/feature_flags`.
- **`/admin/flags`** (admins only) needs no personal key. It lists every registry flag with:
  - its description, kind, and whether the browser sees it;
  - its value for the signed-in admin, from the same public `/flags` call, as "On"/"Off" for a rollout and "Paused"/"Not paused" for a pause flag;
  - whether PostHog answered for it ("in PostHog") or it's off because PostHog didn't;
  - a link to the project's flags in PostHog.
- **With the optional `POSTHOG_PERSONAL_API_KEY`** Worker secret, the page also shows each flag's rollout: the largest share any of its conditions reaches, and 0% when the flag is disabled. Without it, the column says "Not shown".
- **`scripts/posthog-sync-flags.ts`** creates the registry's flags that a PostHog project lacks:
  - every one active at 0%, so nothing is rolled out and nothing is paused until someone raises it;
  - it never changes an existing flag;
  - the owner runs it with their own personal API key, for a new project such as staging, or when the registry gains a flag. Production's 11 flags were created by hand.

### Experiments

A/B experiments are out of scope. Every flag is a boolean, and nothing records exposure.

## 10. Privacy

- **The privacy policy** (`src/content/legal/privacy.md`):
  - **Section 1:** adds "Usage information":
    - pages viewed on estori.app, without the part of the address after a question mark;
    - clicks, device and browser, and approximate location from the IP address;
    - errors and session recordings: "We record layouts and clicks, not what's written on the page or what you type", and recordings show no images;
    - recordings skip orders, shopper emails, profile and payments setup, settings and billing, and admin pages, and never show the store's preview.
  - **Section 1** also adds "Page view counts": Cloudflare Web Analytics counts page views on Estori's pages, previews and stores served on estori.app addresses, with no cookies and nothing that identifies visitors.
  - **Section 3:**
    - adds **PostHog** as a service provider for product analytics, session recordings and error reports, and for the switches that turn parts of the Service on or pause them. It names US hosting, and says no email or name is sent;
    - adds Cloudflare Web Analytics to the Cloudflare bullet.
  - **Section 4:** replaces "We don't use advertising or analytics cookies". The new text says:
    - Estori uses PostHog's first-party analytics cookie and storage on estori.app;
    - Cloudflare Web Analytics uses no cookies;
    - there are no advertising cookies;
    - how to turn analytics off;
    - stores don't load PostHog.
  - **Section 6:** adds the Analytics setting and Global Privacy Control. It also says that with analytics off, Estori still counts the AI credits a person's builds use, without anything that identifies them.
  - **The `updated` date** changes. The version stays as billing leaves it, so nobody is asked to agree again for this change.
- **The analytics setting:** a card in Settings, "Analytics", with a switch "Share usage analytics with Estori".
  - **Turning it off:**
    - stores `analyticsOptOut: true` in the user's `preferences` JSON (no migration);
    - calls `posthog.opt_out_capturing()`;
    - makes the server drop that user's events, except anonymous build credits (section 4).
  - **The API:** `GET` and `PUT /api/user/analytics`.
  - Cloudflare Web Analytics isn't affected: it counts pages, not people.
- **Global Privacy Control:**
  - **The browser:** with `navigator.globalPrivacyControl` on, posthog-js starts opted out.
  - **The server:** a request carrying `Sec-GPC: 1` to the profile, login, register, email confirmation or provider callback stores the opt-out on the account, with source `gpc`. It does so before any event of that request is sent.
  - **The switch:** while the browser sends GPC, the switch can't turn analytics back on. The card says why.
- **No consent banner.** Estori serves the US only. EU expansion would need a consent banner before posthog-js loads, and EU processing terms.
- **Shoppers** on stores are never tracked by PostHog (section 4). Cloudflare Web Analytics counts their page views on estori.app addresses without identifying them.

## 11. Environments and configuration

| | Production | Staging | Local |
| --- | --- | --- | --- |
| PostHog project | "Estori production" (675096) | none until the owner adds one (section 16) | none, unless a developer opts in with the production token |
| `POSTHOG_PROJECT_KEY`, `POSTHOG_PROJECT_ID` (plain vars) | in `wrangler.estori.jsonc` | not set | optional in `.dev.vars` (the token only) |
| Browser token | from the committed hostname map, for `estori.app` | none | from the config endpoint, only with the opt-in |
| `POSTHOG_PERSONAL_API_KEY` (Worker secret) | optional, for rollouts on `/admin/flags` | not set | not set |
| `FEATURE_FLAG_OVERRIDES` (var) | ignored | allowed | allowed |
| `BILLING`, `BILLING_USER_IDS` (billing's vars) | kept, added to the `billing` flag | kept | kept |
| `environment` and `$host` on events | `prod`, `estori.app` | nothing is sent | `dev`, `localhost` |
| Source map upload | with the optional `POSTHOG_CLI_API_KEY` secret | no | no |
| Cloudflare Web Analytics | on (zone-wide) | on (zone-wide) | no |

- **Hosts are constants in code:**
  - ingest `us.i.posthog.com`;
  - assets `us-assets.i.posthog.com`;
  - the UI `https://us.posthog.com`.
- **No secrets for capture or flags.** The project token is public and write-only, so it's a plain var for the server and a committed map for the browser. No GitHub variable or Worker secret is needed for either.
- **`GET /api/telemetry/config`** (public) gives the browser:
  - whether replay is paused for anonymous visitors (`replayPaused`);
  - `localProjectKey`: in local development only, the token a developer set in `.dev.vars`; null everywhere else.
- **Opting in locally:** a developer adds `POSTHOG_PROJECT_KEY` with the production token to `.dev.vars` and restarts. Events then carry `environment: dev` and a localhost `$host`, so the test-account filter hides them from every insight, and the replay triggers record nothing.
- **The flag sync script** reads `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` from the shell running it.

## 12. Testing

**Unit and wiring tests** (vitest, Workers pool):
- **Config:**
  - no token, nothing sent and every flag off;
  - the production token and id are plain vars in `wrangler.estori.jsonc`, and staging's config has none;
  - the browser map gives a token to `estori.app` only, and the opt-in token to localhost;
  - the config endpoint gives `localProjectKey` in local development only.
- **The event client:**
  - batching, with `environment`, `release` and `$host` on every event;
  - opted-out people's events dropped, except cost fields, sent under `opted-out` with nothing else;
  - everyone treated as opted out when the setting can't be read;
  - failures, error answers and hangs never throw;
  - no request scope (Durable Objects, tests passing `{}`).
- **The flag evaluator:**
  - the request it sends;
  - the 60 s cache per user, with the plan read only on a miss;
  - every flag off on failure, quota, `errorsWhileComputingFlags`, timeout, or a flag PostHog leaves out, retried after 10 s;
  - overrides outside production only, with or without a token;
  - `billing` on with `BILLING=on` or a listed user, whatever PostHog says, and with PostHog alone;
  - no Worker file but the switch's own and the flag module reads billing's switches.
- **The account's plan:** billing's resolution, and Basic when its tables can't be read.
- **Each pause:** refused with its message and 503 (or the editor's popup) before any write or outside call, and what exists keeps working:
  - AI builds: a new message, a resume, generate and resume requests, a new store;
  - sign-ups: an email sign-up, and a provider sign-in that would create an account; an existing account still signs in;
  - publishing and new domains: nothing published, no domain stored, and taking offline still works;
  - template sales and billing checkout: refused before Stripe is asked; the portal and cancelling stay open.
- **The proxy:**
  - only the two PostHog hosts;
  - `//attacker.example` stays a path;
  - no cookies, `Authorization` or staging key forwarded;
  - no `Set-Cookie` back;
  - 404 without a token.
- **The browser options:**
  - all page text and inputs masked, images and iframes blocked, no console logs, no request headers or bodies, autocapture without text or attributes;
  - every address stripped of its query, replay data included;
  - the paused paths.
- **Error reporting:**
  - stack parsing;
  - email scrubbing;
  - once a minute per error, 30 a minute;
  - never throws;
  - the logger and Hono's `onError` report.
- **Billing's events:**
  - each one's rule, by plan;
  - sent once after billing records the event;
  - nothing on a duplicate delivery or a failed record;
  - `credits_low` only for a new claim.
- **The heartbeat checks**, healthy and failing, and no run without a token.
- **Session telemetry:**
  - GPC stored before events;
  - an unreadable setting counts as opted out.
- **The flags admin view:** values for the admin, the PostHog link, and rollouts only with the personal key.
- **Each business event's properties**, and the wiring that sends it.
- **Guard tests:**
  - the browser loads posthog-js only with a token, identifies with the user id only and resets on sign-out;
  - replay pauses on the paused paths and under its pause flag;
  - the Go live panel under its two pause flags;
  - the settings card;
  - the privacy policy text.

**Localhost verification** (before pull request 1 merges), with the production token opted in:
1. **Events arrive as test traffic.**
   - Pageviews, a sign-up, a build and a publish arrive in project 675096 with `environment: dev` and a localhost `$host`, with the right person and `plan`, and no email or name.
   - With the test-account filter on, they disappear from insights. If browser events with a port in `$host` stay, the filter needs a regex (section 15).
   - No `$current_url` has a query.
   - No replay is recorded.
2. **Billing,** when billing runs locally with Stripe test mode: a Pro checkout sends one `subscription_started`. Resending the Stripe event sends no second one.
3. **Flags toggled in PostHog, seen locally:**
   - raising `catalog-paused` to 100% hides the catalog within a minute after a reload;
   - disabling it brings the catalog back;
   - raising `ai-builds-paused` to 100% refuses a new message with the popup;
   - every flag goes back to active at 0%.
   - This happens before production runs this code, so production ignores the change.
4. **The setting:** turning analytics off stops events from that user, browser and server. The one exception is `build_finished`'s credits under `opted-out`.

**Production smoke check** (after the owner deploys):
1. `/ingest/static/array.js` answers 200, and a pageview arrives with `environment: prod`, with the test-account filter on.
2. A sign-in sends `signed_in`, and the person has `plan`.
3. A web vitals event arrives.
4. Within 15 minutes a `heartbeat` arrives with `healthy: true`.
5. `/admin/flags` shows 11 flags from PostHog, every one off, and the PostHog link.
6. No source map is served.
7. Any recorded replay shows layouts and clicks only, with no text or images and the preview as a blocked box.

## 13. Rollout

1. **Pull request 1:** everything except Sentry's removal.
   - It's safe to merge: once deployed, production sends to project 675096, but every flag is at 0%, so nothing is rolled out and nothing is paused.
   - Staging and local development send nothing.
   - Billing keeps working on `BILLING` and `BILLING_USER_IDS`.
2. **Localhost verification** (section 12), before the owner merges.
3. **The owner merges and deploys production.** Then the production smoke check.
4. **Dashboards and alerts:** the coordinator builds them from `docs/estori/posthog-dashboards.md` once events flow.
5. **Pull request 2:** remove Sentry.
6. **Any time:** the optional owner steps in section 16.

## 14. Out of scope

- Analytics for sellers about their own stores (store visits, conversion). The live stores spec already leaves this out.
- Tracking shoppers on generated or live stores with PostHog.
- An EU consent banner, and EU processing terms.
- A/B experiments and multivariate flags.
- An outside uptime check (after launch, with an Access service token).
- Sending AI Gateway metadata (`cf-aig-metadata`) from Think builds.
- Business alerts (`platform-alerts.ts`) moving to PostHog. They stay as they are.
- SpaceDO errors in PostHog.
- Dashboards and alerts as code. They are built by hand from section 8.
- Removing billing's `BILLING` and `BILLING_USER_IDS`. That waits until PostHog's `billing` flag is at 100%.
- Changing Cloudflare Web Analytics. It stays automatic and zone-wide.

## 15. Decisions made on the owner's behalf

| Decision | Why | If wrong |
| --- | --- | --- |
| One PostHog project, "Estori production" (675096), on US Cloud; production is the only PostHog environment | the free plan allows one project; production numbers are the ones that matter | add a staging project (section 16, step 2) |
| Staging, local development and tests are inert: nothing captured, the proxy answers 404, the heartbeat doesn't run, flags are their defaults plus `FEATURE_FLAG_OVERRIDES` | no second project exists, and test data must not reach production | give staging a project and its token |
| The project token is a plain var in `wrangler.estori.jsonc`, and the browser takes it from a committed hostname map | the token is public and write-only, so no secret, GitHub variable or owner step is needed | move it to a Worker secret and a config endpoint |
| The browser map gives a token to `estori.app` only | staging, previews and stores must never load posthog-js | add a host to `POSTHOG_PROJECTS` |
| A developer can opt in locally with the production token, passed to the browser by the config endpoint in local development only | the token lives in `.dev.vars`, not a Vite variable; checking analytics locally needs no second project | use a staging project for local checks |
| Server events carry `$host` from `CUSTOM_DOMAIN`, so the test-account filter hides local opt-in events | the filter works on `$host`, which server events don't otherwise have | filter on `environment` instead |
| The filter is set to exact hosts; Task 19 checks that browser hosts with a port (`localhost:8100`) are hidden too | the coordinator set it to `localhost`, `127.0.0.1` and `staging.estori.app` | change the filter to the regex `^(localhost\|127\.0\.0\.1)(:\d+)?$` on `$host` |
| Replay records production only: both trigger groups match `https://estori.app/` | a local opt-in or a stray host must never record | widen the URL condition |
| Replay: 20% of sessions plus every session with an error | enough to watch, inside the free allowance at early traffic | change the trigger groups in PostHog; no deploy |
| Replays record layouts and clicks only: all page text and inputs masked, images and iframes blocked, no console logs, network timing without headers or bodies; the code repeats the project's "Total privacy" | page text holds prompts, store content and customer details; images can show anything; the preview iframe carries a signed preview token; settings in the UI can be changed by mistake | mask selected elements instead of `*` |
| Exception autocapture, web vitals, heatmaps and dead clicks come from the project's settings | they need no code and can be turned off in PostHog | set them in `posthogInitOptions` |
| Cloudflare Web Analytics stays as it is, zone-wide on every estori.app host, with no code; the privacy policy names it | it was already on, is cookieless and identifies no one | turn it off in Cloudflare, or limit it to some hosts |
| Browser traffic through `estori.app/ingest`, proxied by the Worker | ad blockers don't drop it; PostHog's hosts never join the app's CSP, since the lazy-loaded scripts come through the proxy | point `api_host` at PostHog directly, add its hosts to the CSP, and drop the route |
| posthog-js only on estori.app; never on stores, previews, sellers' domains or checkout | shoppers aren't Estori's users | add a separate, consented store analytics product |
| Business events sent by the Worker, typed in one shared catalog | they must be right even when the browser blocks analytics | move an event to the browser with `posthog.capture` |
| Sale totals as bands; Estori's fee, template prices and extra credits bought exact | a seller's sales are their data; Estori's revenue is its own; exact store revenue comes from the Stripe source | send `total_cents` instead of `total_band` |
| `first_sale` as a property of `sale_completed`, not its own event | one event per order; the funnel filters on it | add a `first_sale` event next to it |
| Identity is the user id; no email, name, username or avatar | privacy-minimal; admins look people up in Estori | add `$set: { email }` in `personUpdateOf` |
| The `plan` person property is `basic`, `pro`, `premium` or `enterprise`, from billing's plan resolution read from its tables; there's no `tier` | billing has no tiers; reading the tables avoids a loop through the account loader and the `billing` flag | target flags by user id only and drop `plan` |
| Billing's seven events are added by this change at billing's code points, named by role; billing's merged code decides the names | billing ships first without analytics, and its plan is being revised in parallel | move the calls into billing and keep the catalog here |
| A subscription event is sent by whichever recorded Stripe event first stores the change, from the row before and after | Stripe's delivery order varies; the rows are rebuilt from Stripe, so the first store is the truth | send `subscription_started` only on checkout completed, as billing's spec first said |
| `subscription_changed` counts a downgrade when it takes effect at renewal, not when it's scheduled | the plan only changes then | add a `subscription_change_scheduled` event |
| A cancel with no prior period-end cancel and no failed payment counts as `admin` | sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard | read Stripe's `cancellation_details` instead |
| `credits_low` is sent when billing's claim on the 20% or 5% notice is new, even if the email fails | the claim is the once-per-period record; an email failure isn't a usage fact | send it only when the email went out |
| `credits_limit_reached` is sent on every turn refused for credits | each refusal is a seller hitting the wall; insights can count unique people | send it once per period |
| `credits_used` is the credits billing charged for the turn's steps (real token cost × 1.5 at $0.001); Estori's cost is credits ÷ 1.5 × $0.001 | credits now follow real cost, so the number is both the seller's charge and Estori's cost | send a separate `cost_usd` |
| The AI budget alert is 150,000 credits a day, about $100 of Estori's cost, until two weeks of data exist | a round first number the owner can change in PostHog | change the alert's threshold |
| Worker errors: component, type, message (emails scrubbed) and stack only; logger data not sent; once a minute per error, 30 a minute | logger data can hold anything; a loop must not flood PostHog | send selected data fields, or raise the limits in `server-errors.ts` |
| Source maps upload in production deploys only, and only once the owner adds the optional `POSTHOG_CLI_API_KEY` secret; the project id is written in the workflow | no personal key exists; the id is public; staging has no project | add the secret, or upload from staging once it has a project |
| `@posthog/cli` pinned to an exact version; the deploy maps the secret onto the variable that version reads | CLI versions have read different variable names (`POSTHOG_CLI_TOKEN`/`POSTHOG_CLI_ENV_ID` against the docs' `POSTHOG_CLI_API_KEY`/`POSTHOG_CLI_PROJECT_ID`) | change the two constants in `scripts/posthog-sourcemaps.ts` and the workflow mapping |
| The source map files are deleted after upload, or without one | they are never served publicly | keep them and block `*.map` in the Worker |
| Sentry removed after the localhost and production checks, in a second pull request | it never ran in Estori; two error tools confuse | keep Sentry and drop the second pull request |
| AI cost as credits per build, captured by the server; no `cf-aig-metadata` | credits are what plans use, and the alert lives in PostHog | add the metadata header in `configureThinkAgent` |
| The cost dashboard and the budget alert count every Think build, with no gateway filter | Think always runs on Estori's gateway, so every build is Estori's cost | add a filter if Think ever runs on a seller's own gateway |
| For people who opted out, only `build_finished`'s `credits_used` is sent, under `opted-out`, with no person or other property | the AI budget must count every build; a credit count alone identifies no one | drop opted-out builds and accept a budget that undercounts |
| Uptime from an in-process heartbeat every 15 minutes, alert below 2 an hour; it runs only where there's a token | production is behind Access; no new service needed; without a project nothing would be sent | add an outside checker with an Access service token |
| Every flag defaults off: `billing` is a rollout, and ten pause flags cover drafts, live payments, the catalog, replay, AI builds, sign-ups, publishing, new domains, template sales and billing checkout | PostHog omits disabled flags, so a default-on kill switch stayed on when disabled; with pause flags an outage or a missing flag pauses nothing | none safe: a default-on flag can't be switched off through PostHog |
| Pause flags are enforced on the server; the browser hides things only where it's cheap: the "New draft" button, the catalog links and page, and the Go live panel's publish button and domain form | a hidden button is a convenience; the server is the guarantee | hide more buttons with `useFlag`, which needs the flag client-visible |
| Every pause answers 503 with a plain message, before any write or outside call; drafts move from 403 to 503 | a pause is temporary, and one status for all pauses keeps them alike | answer 403 |
| `ai-builds-paused` refuses at every place a turn starts, including the editor's generate and resume requests; running turns finish | a half-stopped turn could leave a store mid-change | stop running turns too, through the abort controller |
| `signups-paused` refuses only account creation; sign-ups ask PostHog as the anonymous subject | existing sellers must keep working; there's no account to target yet | target sign-ups by another property, such as country |
| `store-publishing-paused` leaves taking a store offline open, and `custom-domains-paused` leaves checking and removing a domain open | those make things safer, never riskier | pause them too |
| `template-sales-paused` refuses the purchase only; confirming a purchase paid before the pause still records it | a paid buyer must get what they paid for | refuse confirmations too, and refund |
| `billing-checkout-paused` refuses checkout, plan changes and extra credits; the portal, cancelling, undoing a cancel and webhooks stay open | sellers must always be able to manage or leave a plan, and payments made must be recorded | pause the portal too |
| An answer with `errorsWhileComputingFlags: true` counts as a failure: every flag off, retried in 10 s | its values can't be trusted, and off pauses nothing | trust the flags it did return |
| `store-drafts-paused` pauses only starting new drafts | sellers already on a draft are never stranded | pause the switcher too |
| `catalog-paused` makes catalog items read as sold out at checkout; paid orders still placed | shoppers see a known message; paid orders are never dropped | refuse the checkout with a new message instead |
| `billing` is on with `BILLING=on`, a user in `BILLING_USER_IDS`, or PostHog; billing's checks read the flag | billing ships first; merging or misconfiguring PostHog must never switch billing off for a paying seller | remove the switches once PostHog's flag is at 100% |
| Flags sent with the session (profile, login, register), not by their own request | the UI renders once with the right value | add `GET /api/flags` and a loading state |
| Flag cache 60 s per user, timeout 1.5 s, failures cached 10 s | changes land within a minute; sign-in never waits long | change the constants in `flags.ts` |
| Production's flags were created by hand; the sync script stays for new projects and new flags, run by the owner with their own key | no personal key exists for CI; the script keeps a new project's keys exact and at 0% | create flags by hand every time |
| `/admin/flags` works without a personal key: the admin's own values and a link to PostHog; rollouts only with `POSTHOG_PERSONAL_API_KEY`; no lookup of another user | no personal key exists; per-user targeting is checked in PostHog, where it's set | add a user id field; the evaluation already takes any id |
| A flag's rollout on the page is the largest share any of its conditions reaches, and 0% when disabled | one number per flag; conditions are read in PostHog | show each condition |
| `/admin/flags` is read-only | edits and history belong in PostHog | add edit buttons that call PostHog's API |
| Dashboards and alerts are built by the coordinator in PostHog's UI once events flow, from a build sheet the plan writes | an insight can't be checked without data; the sheet keeps the definitions with the code | script them with PostHog's API later |
| Alerts go to the owner's email | the only on-call today | add recipients in PostHog (section 16) |
| Opt-out stored in `users.preferences` JSON, no migration | the column exists and is unused; no clash over migration numbers | move it to its own column later |
| A GPC signal is stored as the account's opt-out | the signal is a standing request; server events need it too | honor GPC per request only |
| No consent banner | US only, and analytics is first-party | add one before any EU launch |
| Privacy policy version unchanged by this change, so no one is asked to agree again for it | adding an analytics processor needs notice, not consent, in the US; production isn't public yet | bump `TERMS_VERSION`, which shows the agreement again |
| The client IP is forwarded so PostHog can tell the country | country is useful for a US-only launch | turn on "Discard client IP data" in the project |
| posthog-js bundled with the app from npm | no third-party script origin; its lazy-loaded scripts come through the proxy | load the snippet from PostHog's CDN and add its hosts to the CSP |
| Security events (CSRF, rate limit) become warning logs; the Sentry-only AI feedback tool is removed | both only ever went to Sentry | send security events to PostHog as events |

## 16. Owner steps

The coordinator already created the project, applied its settings and replay triggers, and created the 11 flags (section 2). What's left:

1. **Sign PostHog's DPA** for the "Estori" organization at posthog.com/dpa.
2. **Optional: a staging project.**
   1. Add a card to the PostHog organization and set a $0 billing limit, so a second project costs nothing.
   2. Create "Estori staging" with the same settings, with its replay triggers matching `https://staging.estori.app/`.
   3. Create its flags: `POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... bun scripts/posthog-sync-flags.ts`.
   4. Hand over its token and id. They go into `wrangler.estori-staging.jsonc` as plain vars and into the browser map for `staging.estori.app`: a small code change.
3. **Optional: a personal API key.** Two keys keep each one's access small:
   - one with feature flag read, set as the Worker secret `POSTHOG_PERSONAL_API_KEY` (`npx wrangler secret put POSTHOG_PERSONAL_API_KEY --config wrangler.estori.jsonc`). `/admin/flags` then shows rollouts;
   - one with error tracking write, set as the secret `POSTHOG_CLI_API_KEY` in the `production` GitHub environment. Deploys then upload source maps.
4. **Connect the Stripe data warehouse source** in the project, with a restricted read-only Stripe key.
5. **Alert recipients:** say if alerts should go anywhere besides the owner's email.
6. **Have the privacy policy changes reviewed** before public launch.
