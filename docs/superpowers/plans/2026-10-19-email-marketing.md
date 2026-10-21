# Email Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers grow a subscriber list from their store and its checkout, and send campaigns and automatic emails (welcome, abandoned cart, thank-you, win-back) through Amazon SES. Emails are built from branded templates or drafted from a description, governed by sending rules, and measured by clicks and attributed sales.

**Architecture:**
- **Storage:** D1 holds contacts with consent records, settings, templates, campaigns, automations and a send log that is also the outbox.
- **Sign-up:** forms on generated stores call `Estori.subscribe()` (Turnstile, double opt-in). Estori's checkout page adds a consent checkbox.
- **Scheduling:** a minute cron claims due campaigns and automation steps, and a Cloudflare Queue consumer materializes audiences and sends each email through SES v2 (`aws4fetch`, SigV4), paced to the account's rate.
- **Events:** SES events come back through an EventBridge API destination. Unsubscribe, confirm, click and open links live on `news.estori.app/e/...`.

**Tech Stack:** Cloudflare Workers, D1 (Drizzle), KV, Queues, Cron Triggers, Turnstile, Amazon SES v2 with `aws4fetch` 1.0.20, Hono, React 19, TanStack Query 5, Vitest (workers pool).

**Spec:** `docs/superpowers/specs/2026-10-19-email-marketing-design.md`. Read it whole before any task; section numbers below refer to it.

## Global Constraints

- **Two separate pipes:**
  - Marketing email goes only through SES (`createMarketingSender`).
  - Order emails stay on Cloudflare Email Service (`createEmailSender`).
  - Never send one kind through the other.
- **From and links:**
  - From is `storeSenderAddress(slug, 'news@' + env.MARKETING_FROM_DOMAIN)` with the store's sender name, 60 characters at most.
  - Reply-To falls back from the marketing setting, to the shopper-emails reply-to, to the seller's account email.
  - Shopper links are `https://{MARKETING_LINK_HOST}/e/...`.
- **Who gets marketing:**
  - Only contacts with `consent = 'subscribed' AND suppressed IS NULL`, and not on `marketing_global_suppressions`.
  - Confirmation emails go only to `pending` contacts that aren't suppressed.
  - Every automation, abandoned cart included, goes to subscribers only.
- **Opt-in:** double opt-in is always on for forms. The checkout checkbox is unticked by default and is single opt-in.
- **Every marketing email:**
  - carries `List-Unsubscribe: <https://{host}/e/u/{token}>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, `List-Id` and `X-Estori-Store`;
  - ends with the locked footer: the store's name and postal address, why the shopper got it, Unsubscribe, and "Sent with Estori".
- **Seller content:**
  - Sellers never enter HTML. Rich text is the Markdown subset of spec section 10.1.
  - URLs: `https:`, store paths, and `mailto:` in text only. `http:` only for local hosts.
  - Colors are `#rrggbb`. Subjects and preheaders are one line.
- **Rule evaluation order** (`decideSend`): platform, store and paused, consent, suppression, exclusions, lateness, frequency cap, daily and monthly limits, send window. Section 14.3 has the exact outcomes.
- **Defaults:** send window 8 to 20 in the store's time zone (default `America/New_York`); frequency cap 4 per 7 days; unengaged exclusion 180 days; attribution 5 days after a click, last click wins, clicks only.
- **Limits:**
  - sign-ups: 5 per client per store per 10 minutes, and 3 confirmation emails per address per day;
  - test sends: 10 an hour per seller;
  - drafts: 20 an hour per user;
  - imports: 5,000 rows, 1 MB, 2 a day;
  - plan limits come from `MARKETING_PLAN_LIMITS` (spec section 20).
- **SES calls:**
  - `aws4fetch` signs only (`AwsClient.sign`), with `retries: 0`.
  - Errors map through `classifySesError` to `throttled`, `daily_quota`, `paused`, `config`, `rejected` or `uncertain`.
  - An `uncertain` send waits 10 minutes for an event before it is retried, and fails after 3 attempts.
- **Tokens:**
  - The form is `{parts joined by '.'}.{mac}`.
  - The MAC is the first 16 bytes of HMAC-SHA-256, in base64url.
  - Each kind has its own key, derived from `JWT_SECRET` with HKDF-SHA-256 (salt `estori-marketing`, info = the kind).
- **Code rules:**
  - No `any`, no emojis, and concise comments.
  - Shared types live in `shared/types/marketing*.ts` and are re-exported from `src/api-types.ts`.
  - Seller and shopper copy never contains a name from `SUPPLIER_NAMES` or `AI_ASSISTANT_NAMES` (`src/routes/copy-rules.ts`).
- **Migrations:** `0029_marketing_contacts`, `0030_marketing_templates`, `0031_marketing_campaigns`, `0032_marketing_automations`, `0033_marketing_stats` and `0034_marketing_domains`. Each takes the next free number when its phase starts; renumber if `main` moved.
- **Commits:**
  - Lowercase conventional subjects, for example `feat(marketing): ...`.
  - Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:** `.dev.vars`, `bun.lockb`, anything under `.superpowers/` or `.playwright-mcp/`, local edits to `wrangler.jsonc`, or `src/routes/landing/LandingPage.tsx`.

## Review Focus

- **A shopper who unsubscribes while a campaign email waits in the queue must not get it.**
  - `sendOne` re-reads the contact and runs `decideSend` right before calling SES.
  - Pinned in Task 3.5: "an unsubscribe between materializing and sending skips the email".
- **`Ana@Example.test` and `ana@example.test` are one contact.**
  - Sign-up, checkout consent, orders and imports all go through `normalizeEmail`.
  - Pinned in Task 1.5 (normalization) and Task 1.1 (the unique index on real SQL).
- **EventBridge may deliver an event twice, or out of order.**
  - A Delivery after a permanent Bounce must not clear the bounce, and a repeated Complaint counts once.
  - Pinned in Task 1.9: "applies a complaint once and keeps a bounce after a late delivery".
- **Send windows across a DST change, and "now" after today's window has closed.**
  - The next window opens at 08:00 local the next day, also on the day `America/Chicago` changes offset.
  - Pinned in Task 3.2.
- **Mailbox providers send RFC 8058 one-click as `multipart/form-data`, with no cookies.**
  - The POST must unsubscribe and answer 200 without a redirect.
  - Pinned in Task 1.8: "one-click POST with a multipart body unsubscribes and answers 200".

## Context for the executing agent

**Read first:**
- `CLAUDE.md` at the repo root;
- the spec;
- shopper emails as the closest pattern:
  - `worker/services/shopper-emails/outbox.ts`, `template.ts`, `wiring.ts` and `sender-address.ts`;
  - `worker/database/services/ShopperEmailService.ts`;
  - `worker/api/controllers/shopperEmails/controller.ts`;
  - `worker/api/routes/shopperEmailRoutes.ts`;
  - `src/routes/emails/emails.tsx` and `template-editor.tsx`;
  - `src/hooks/use-shopper-emails.ts`.

**Key files this plan touches:**
- **Email core:**
  - `worker/services/email/sender.ts`, `types.ts` and `recipient-allowlist.ts`: the transactional sender and the staging guards that the marketing sender shares.
- **The store's platform paths (`/__estori/*`):**
  - `worker/api/handlers/store-platform.ts` answers them;
  - `worker/api/handlers/live-store.ts` dispatches live stores to it.
- **Store payments:**
  - `worker/services/store-payments/store-script.ts`: the `Estori` runtime;
  - `pay-page.ts`: Estori's checkout page;
  - `fulfill.ts`: `recordStoreOrder`;
  - `wiring.ts`: production deps;
  - `manifest.ts`: products and brand;
  - `checkout.ts`: `storeInfoOf`.
- **Worker entry:** `worker/index.ts`: `fetch` routing, `scheduled`, and a new `queue` export.
- **Database:** `worker/database/schema.ts`, `worker/database/index.ts` (service exports), and `worker/database/test-support/real-d1.ts` (`migratedD1`, `envWith`, `insertUser`, `insertApp`, `insertCheckout`).
- **Config and limits:**
  - `worker/config/index.ts`: `GlobalConfigurableSettings`, with per-user overrides in KV `user_config:{userId}`;
  - `worker/services/rate-limit/config.ts` and `rateLimits.ts`: the `RateLimitType` enum, defaults and `enforce*` helpers;
  - `worker/services/alerts/platform-alerts.ts`: `PLATFORM_ALERT_KINDS` and labels.
- **AI drafting:**
  - `worker/agents/inferutils/infer.ts`: `executeInference`;
  - `worker/api/controllers/sitePage/draftController.ts` and `worker/services/site-pages/draft.ts`: the drafting pattern to copy.
- **Build agent skills:** `worker/agents/think/skills.ts` and `skills/store-checkout/SKILL.md`, with their guard test.
- **Frontend:**
  - `src/routes.tsx`, `src/components/layout/app-sidebar.tsx`;
  - `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/api-types.ts`;
  - `src/lib/capabilities.ts`, `src/lib/plans.ts`, `src/content/solution-pages.ts`.
- **Legal:** `src/content/legal/privacy.md`, `terms.md` and `shared/types/legal.ts` (`TERMS_VERSION`).
- **Env types:** `worker/types/env.d.ts`. Add every new variable, secret and binding here, optional, because local `wrangler.jsonc` edits are never committed.
- **Wrangler:** `wrangler.estori.jsonc` (production) and `wrangler.estori-staging.jsonc` (staging) get the new variables, the route, the queue and the cron.

**Conventions:**
- **Services** extend `BaseService` (`this.database` is Drizzle), take `env` in the constructor, and are exported from `worker/database/index.ts`.
- **Controllers** extend `BaseController` and answer with `createSuccessResponse` and `createErrorResponse`.
- **Routes** use `setAuthLevel(AuthConfig.ownerOnly | authenticated | admin | public)` and `adaptController`.
- **Pure logic and wiring are separate.** Pure logic sits next to a `wiring.ts` that builds production deps, as `shopper-emails/` does. Functions that run beside a shopper's request never throw to it.
- **IDs** come from `generateNanoId()` (`worker/utils/idGenerator.ts`) with the spec's prefixes (`mc_`, `mx_`, `ms_`, `mt_`, `md_`, `mg_`, `mcp_`, `ma_`, `me_`). The alphabet is `A-Za-z0-9_-`, which SES tags allow.

**Tests:**
- **Single files:** `bun run test -- <paths>` runs once without sharding. The shell's RTK hook mangles Vitest output, so prefer `rtk proxy npx vitest run <paths>`.
- **Batches:** run tests in small batches.
  - Many files at once exhaust local ports (`EADDRNOTAVAIL`, workerd "internal error"). Keep to one directory per run, for example `worker/services/marketing`, then `worker/database/services`, then `worker/api/controllers/marketing`, then `src/routes/emails`.
  - Write paths without trailing slashes. Path filters also match copies under `.claude/worktrees/`, so pass full relative paths from the worktree root.
- **Ports:** between batches, wait until `netstat -an | grep -c TIME_WAIT` is under about 1500.
- **Orphans:** if a run dies, kill orphaned `workerd serve` processes. List them with `rtk proxy ps -axwwo pid=,ppid=,command=`; the orphans have PPID 1 and a command line mentioning `vitest-pool-workers`.
- **Real SQL tests** use `migratedD1()` and `envWith(db)`. Source-guard tests read files with `import.meta.glob(path, { query: '?raw', import: 'default', eager: true })`.

**Migrations:**
- Edit `worker/database/schema.ts`, then run `bun run db:generate -- --name marketing_contacts`. Drizzle writes `migrations/0029_marketing_contacts.sql` and its snapshot in `migrations/meta/`. Commit both.
- Apply locally with `CI=true npx wrangler d1 migrations apply vibesdk-db --local`.
- Production migrations run through `scripts/deploy.ts` on deploy. Never apply them remotely yourself.

**Dependencies:**
- Add `aws4fetch` at exactly `1.0.20` in `package.json` dependencies, then run `bun install --lockfile-only`. Only `bun.lock` may change; never commit `bun.lockb`.
- No other new runtime dependency is needed.

**CI before every PR:** `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check`, then `bun run test` (sharded; about 10 minutes locally). Treat ESLint errors as blocking.

**Secrets:**
- Never print one, never pass one as a command-line argument, and never write one in a commit or chat.
- **Locally:** put them in `.dev.vars` (git-ignored) with an editor, and restart the dev server.
- **Deployed Workers:** the owner runs `npx wrangler secret put NAME --config wrangler.estori.jsonc` (or `wrangler.estori-staging.jsonc`), which prompts for the value without echoing it. Agents don't set production secrets.
- **Local Turnstile:** use Cloudflare's test keys (spec section 21). They aren't secrets.

**What needs the owner:**
- the AWS account, IAM users and keys;
- SES production access;
- DNS records;
- EventBridge setup;
- the Turnstile widget;
- queue creation;
- Worker secrets;
- the Access check for `news.estori.app`;
- legal review;
- approving every deploy.

Spec section 26 lists the steps. Tasks marked **(owner-assisted)** stop and ask before doing anything outside the repo.

**Branches:**
- Phase 1: `feat/marketing-foundation`, from `origin/main`.
- Each later phase branches from the previous phase's branch until that merges, then rebases onto `main`.
- Open each PR into `main` with `gh pr create --repo alastrat/vibesdk`. Never merge or deploy.

---
## Phase 1: SES foundation, contacts, sign-up forms, consent and unsubscribe

Branch `feat/marketing-foundation` from `origin/main`. Migration `0029_marketing_contacts`. The PR delivers everything below, with marketing off for every store until its seller turns it on.

### Task 1.0 (owner-assisted): The spike

Settles spec section 32 before code depends on it. Nothing from this task is committed except the findings, which go into the spec.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-email-marketing-design.md` (section 32, and sections 5.2, 8.2 and 17.1 where findings change them)
- Create (owner-assisted, local only, not committed): `.superpowers/spike/ses-spike.ts`

- [ ] **Step 1:** Ask the owner for staging SES credentials in us-east-2, with the identity `news-staging.estori.app` verified, the configuration set `estori-marketing-staging`, and one verified recipient such as their `@pluriza.com` address. They go in `.dev.vars` as `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `SES_REGION=us-east-2`. Never print them.
- [ ] **Step 2:** Write `.superpowers/spike/ses-spike.ts` (run with `bun`, reading `.dev.vars` through `--env-file`). Using `aws4fetch` with `retries: 0`, it:
  1. creates tenants `spike-a` and `spike-b` (`POST /v2/email/tenants`);
  2. associates the identity ARN and the configuration set ARN with both (`CreateTenantResourceAssociation`; take the exact path from https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateTenantResourceAssociation.html);
  3. sends one email per tenant to the verified recipient with `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id` and the tags `estori_send` and `estori_store`;
  4. sends one to `bounce@simulator.amazonses.com` and one to `complaint@simulator.amazonses.com`.
- [ ] **Step 3:** Ask the owner to open the received email's original headers and paste the `DKIM-Signature` `h=` list. Record whether it contains `List-Unsubscribe` and `List-Unsubscribe-Post`.
- [ ] **Step 4:** Ask the owner to point a temporary EventBridge rule (source `aws.ses`) at a request bin they control, or at the staging Worker after Task 1.9 ships.
  - Save one real Bounce, one Complaint and one Delivery event, plus any tenant status event (disable `spike-b` with `UpdateReputationEntityPolicy` or the console).
  - The files go under `worker/services/marketing/__fixtures__/` as `ses-bounce.json`, `ses-complaint.json`, `ses-delivery.json` and `ses-tenant-status.json`, with recipient addresses replaced by `@example.test` ones. These are committed in Task 1.9.
- [ ] **Step 5:** Turnstile in a cross-site iframe. With the owner's real widget sitekey, serve a tiny page from `{slug}.stores.localhost:8100` and embed it in an iframe on `localhost:8100`. Record whether the challenge renders and `siteverify` answers `success` with the iframe's hostname.
- [ ] **Step 6:** Update spec section 32 with each answer, and adjust:
  - section 5.2, if tenants can't share identities: set `SES_USE_TENANTS` to unset and say so;
  - section 8.2, if the iframe fails: custom domains skip Turnstile, with the tighter limits;
  - section 17.1: the tenant event's detail-type, or "poll `GetTenant` hourly" if none was seen.
- [ ] **Step 7:** Delete the spike tenants. Commit the spec edit: `docs(specs): email marketing spike findings: tenants, dkim headers, turnstile frames and event shapes`.

### Task 1.1: Shared types, schema, migration 0029 and the three marketing services

**Files:**
- Create: `shared/types/marketing.ts`
- Modify: `worker/database/schema.ts` (tables `marketing_settings`, `marketing_contacts`, `marketing_consents`, `marketing_sends`, `marketing_global_suppressions`; columns on `store_checkouts`), generating `migrations/0029_marketing_contacts.sql` and its snapshot
- Create: `worker/database/services/MarketingContactService.ts`, `MarketingSettingsService.ts`, `MarketingSendService.ts`; export all three from `worker/database/index.ts`
- Modify: `src/api-types.ts` (re-export the shared marketing types)
- Test: `worker/database/services/marketing-contacts.sql.test.ts`

**Interfaces:**
- **Produces, in `shared/types/marketing.ts`:**
  - `MARKETING_CONSENTS` / `MarketingConsent` (`'pending' | 'subscribed' | 'unsubscribed' | 'none'`)
  - `MARKETING_SUPPRESSIONS` / `MarketingSuppression` (`'bounce' | 'complaint' | 'seller'`)
  - `MARKETING_CONTACT_SOURCES` / `MarketingContactSource` (`'form' | 'checkout' | 'order' | 'import' | 'seller'`)
  - `MARKETING_CONSENT_ACTIONS` (`requested`, `confirmed`, `subscribed`, `unsubscribed`, `resubscribed`, `imported`, `added`, `suppressed`, `unsuppressed`)
  - `MARKETING_CONSENT_CHANNELS` (`form`, `checkout`, `import`, `seller`, `unsubscribe_page`, `one_click`, `complaint`, `bounce`, `estori`)
  - `MARKETING_SEND_KINDS` (`confirmation`, `campaign`, `automation`, `test`)
  - `MARKETING_SEND_STATUSES` (`queued`, `held`, `sending`, `sent`, `skipped`, `failed`)
  - `MARKETING_STATUSES` (`off`, `on`) and `MARKETING_PAUSERS` (`seller`, `reputation`, `estori`)
  - `MarketingSendWindow { startHour: number; endHour: number }` and `MarketingFrequencyCap { max: number; days: number }`
  - `MarketingSettingsFields { senderName; replyTo: string | null; postalAddress; timezone; sendWindow; frequencyCap: MarketingFrequencyCap | null; checkoutConsent: boolean; consentText }`
  - `DEFAULT_MARKETING_SETTINGS`
  - `MARKETING_FIELD_LIMITS = { senderName: 60, postalAddress: 200, consentText: 200, firstName: 60, lastName: 60, tags: 20, tag: 40, form: 40 }`
  - `MarketingPlanId` and `MarketingPlanLimits { contacts; emailsPerMonth; emailsPerDay: Record<SellerLevel, number>; imports: boolean; ownDomain: boolean }`
  - `MARKETING_PLAN_LIMITS` (spec section 20's table)
  - `MarketingContactCounts = Record<'subscribed' | 'pending' | 'unsubscribed' | 'none' | 'suppressed', number>`
  - `MarketingContactView`, `MarketingConsentView`, `MarketingContactDetail` and `MarketingContactsPage`
  - `MarketingSettingsView`, `MarketingStoreOption { appId; title }`
  - `STORE_SUBSCRIBE_REFUSALS` / `StoreSubscribeRefusal`, `StoreSubscribeResult` and `STORE_SUBSCRIBE_MESSAGES`
  - `MARKETING_PATHS = { subscribers: '/emails/subscribers', campaigns: '/emails/campaigns', automations: '/emails/automations', settings: '/emails/settings' }`
- **Produces, `MarketingContactService`:**
  - `create(input: NewMarketingContact): Promise<MarketingContactRow>` returns the existing row when (`appId`, `email`) exists.
  - `byEmail(appId, email)`, `byId(appId, id)`, `setConsent(id, consent, now)`, `suppress(id, reason, now)`, `unsuppress(id, now)`, `markConfirmationSent(id, now)`
  - `recordConsent(input: NewMarketingConsent)`, `consents(contactId, limit)`
  - `counts(appId)`, `listedCount(appId)`
  - `list(appId, { consent, search, cursor, limit }): Promise<{ rows; nextCursor }>`
  - `update(appId, id, patch, now)`, `delete(appId, id): Promise<boolean>`
  - `recordOrder(input): Promise<MarketingContactRow>`
  - `isGloballySuppressed(email)`, `suppressGlobally(email, detail, now)`
- **Produces, `MarketingSettingsService`:**
  - `get(appId): Promise<MarketingSettingsRow | null>`, `save(appId, fields, now)`
  - `setStatus(appId, status, extra: { tenant?: string | null; termsAcceptedAt?: Date }, now)`
  - `pause(appId, by, reason, now)`, `unpause(appId, allowed: readonly MarketingPauser[], now): Promise<boolean>`
  - `storesOf(userId): Promise<MarketingStoreOption[]>`
  - `storeFacts(appId): Promise<MarketingStoreFacts | null>`, where `MarketingStoreFacts = { appId; title; slug: string | null; live: boolean; sellerUserId; sellerEmail: string | null; sellerEmailConfirmed: boolean }`
- **Produces, `MarketingSendService`:**
  - `create(input: NewMarketingSend): Promise<boolean>`, which is false when `dedupe_key` exists
  - `byId(id)`, `byMessageId(messageId)`, `finish(id, update)`
  - `markDelivered(id, at)`, `markBounced(id, type, at)`, `markComplained(id, at)` and `markUnsubscribed(id, at)`, each `Promise<boolean>` and true only the first time
  - `transientBouncesSince(contactId, since)`, `prune(before)`

- [ ] **Step 1: Write the failing real-SQL test**

```ts
// worker/database/services/marketing-contacts.sql.test.ts
/** Marketing contacts, consent records, settings and the send log on real SQL. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { MarketingContactService } from './MarketingContactService';
import { MarketingSendService } from './MarketingSendService';
import { MarketingSettingsService } from './MarketingSettingsService';
import { DEFAULT_MARKETING_SETTINGS } from '../../../shared/types/marketing';

const NOW = new Date(1_800_000_000_000);
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_1', title: 'Lumen Home' });
	await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_tea', 'northwind-tea', 'live', 'c1', 0, 0, 0)`).run();
});

const contacts = () => new MarketingContactService(envWith(db));
const settings = () => new MarketingSettingsService(envWith(db));
const sends = () => new MarketingSendService(envWith(db));
const contact = (id: string, appId: string, email: string, consent: 'pending' | 'subscribed' | 'none' = 'pending', at = NOW) =>
	contacts().create({ id, appId, email, firstName: null, lastName: null, consent, source: 'form', timezone: null, now: at });

describe('marketing contacts on real SQL', () => {
	it('keeps one contact per store and email, answering the first on a repeat, and allows the same email at another store', async () => {
		const first = await contact('mc_ana', 'app_tea', 'ana@example.test');
		const again = await contact('mc_ana2', 'app_tea', 'ana@example.test');
		expect(again.id).toBe(first.id);
		expect((await contact('mc_ana_home', 'app_home', 'ana@example.test', 'none')).id).toBe('mc_ana_home');
	});

	it('moves consent and stamps when it happened', async () => {
		await contacts().setConsent('mc_ana', 'subscribed', later(10));
		expect(await contacts().byEmail('app_tea', 'ana@example.test')).toMatchObject({ consent: 'subscribed', subscribedAt: later(10) });
		await contacts().setConsent('mc_ana', 'unsubscribed', later(20));
		expect(await contacts().byId('app_tea', 'mc_ana')).toMatchObject({ consent: 'unsubscribed', unsubscribedAt: later(20) });
		await contacts().setConsent('mc_ana', 'subscribed', later(30));
	});

	it('keeps consent records newest first', async () => {
		await contacts().recordConsent({ id: 'mx_1', appId: 'app_tea', contactId: 'mc_ana', action: 'requested', channel: 'form', text: 'Email me news', form: 'footer', pageUrl: 'https://northwind-tea.estori.shop/', ip: '203.0.113.9', userAgent: 'Mozilla/5.0', sendId: null, now: NOW });
		await contacts().recordConsent({ id: 'mx_2', appId: 'app_tea', contactId: 'mc_ana', action: 'confirmed', channel: 'form', text: null, form: null, pageUrl: null, ip: null, userAgent: null, sendId: null, now: later(5) });
		expect((await contacts().consents('mc_ana', 10)).map((record) => record.action)).toEqual(['confirmed', 'requested']);
	});

	it('counts each state with suppressed contacts apart, and counts listed contacts for the plan limit', async () => {
		await contact('mc_ben', 'app_tea', 'ben@example.test', 'pending');
		await contact('mc_cy', 'app_tea', 'cy@example.test', 'subscribed');
		await contacts().suppress('mc_cy', 'complaint', NOW);
		await contact('mc_dee', 'app_tea', 'dee@example.test', 'none');
		expect(await contacts().counts('app_tea')).toEqual({ subscribed: 1, pending: 1, unsubscribed: 0, none: 1, suppressed: 1 });
		expect(await contacts().listedCount('app_tea')).toBe(2);
	});

	it('lists newest first with a cursor, filters by state, and searches email and names', async () => {
		await contact('mc_old', 'app_home', 'old@example.test', 'subscribed', later(-100));
		await contact('mc_new', 'app_home', 'new@example.test', 'subscribed', later(100));
		const firstPage = await contacts().list('app_home', { consent: 'subscribed', search: null, cursor: null, limit: 1 });
		expect(firstPage.rows.map((row) => row.id)).toEqual(['mc_new']);
		const secondPage = await contacts().list('app_home', { consent: 'subscribed', search: null, cursor: firstPage.nextCursor, limit: 1 });
		expect(secondPage.rows.map((row) => row.id)).toEqual(['mc_old']);
		expect((await contacts().list('app_home', { consent: null, search: 'OLD@', cursor: null, limit: 10 })).rows.map((row) => row.id)).toEqual(['mc_old']);
	});

	it('records orders: a new customer has consent none, and every order adds to the totals and products', async () => {
		const created = await contacts().recordOrder({ id: 'mc_eve', appId: 'app_tea', email: 'eve@example.test', firstName: 'Eve', lastName: 'Lin', totalCents: 4599, productIds: ['tea', 'pot'], orderedAt: NOW });
		expect(created).toMatchObject({ consent: 'none', source: 'order', ordersCount: 1, totalSpentCents: 4599, firstOrderAt: NOW, lastOrderAt: NOW, productsBought: ['tea', 'pot'] });
		const again = await contacts().recordOrder({ id: 'mc_unused', appId: 'app_tea', email: 'eve@example.test', firstName: null, lastName: null, totalCents: 1000, productIds: ['tea', 'cup'], orderedAt: later(60) });
		expect(again).toMatchObject({ id: 'mc_eve', consent: 'none', ordersCount: 2, totalSpentCents: 5599, firstOrderAt: NOW, lastOrderAt: later(60), productsBought: ['tea', 'pot', 'cup'], firstName: 'Eve' });
	});

	it('updates names and tags, and deletes a contact with its consent records', async () => {
		expect(await contacts().update('app_tea', 'mc_ben', { firstName: 'Ben', tags: ['vip', 'tea'] }, NOW)).toMatchObject({ firstName: 'Ben', tags: ['vip', 'tea'] });
		expect(await contacts().update('app_home', 'mc_ben', { firstName: 'Nope' }, NOW)).toBeNull();
		expect(await contacts().delete('app_tea', 'mc_ana')).toBe(true);
		expect(await contacts().consents('mc_ana', 10)).toEqual([]);
		expect(await contacts().delete('app_tea', 'mc_ana')).toBe(false);
	});

	it('keeps a global list of hard bounces', async () => {
		expect(await contacts().isGloballySuppressed('gone@example.test')).toBe(false);
		await contacts().suppressGlobally('gone@example.test', 'smtp; 550 5.1.1 user unknown', NOW);
		await contacts().suppressGlobally('gone@example.test', 'again', NOW);
		expect(await contacts().isGloballySuppressed('gone@example.test')).toBe(true);
	});
});

describe('marketing settings on real SQL', () => {
	it('has no row until saved, then reads back the fields with status off', async () => {
		expect(await settings().get('app_tea')).toBeNull();
		await settings().save('app_tea', { ...DEFAULT_MARKETING_SETTINGS, senderName: 'Northwind Tea', postalAddress: '1 Main St, Austin, TX 78701' }, NOW);
		expect(await settings().get('app_tea')).toMatchObject({ status: 'off', pausedBy: null, senderName: 'Northwind Tea', sendWindow: { startHour: 8, endHour: 20 }, frequencyCap: { max: 4, days: 7 } });
	});

	it('turns on with a tenant, and a seller can lift only their own pause', async () => {
		await settings().setStatus('app_tea', 'on', { tenant: 'store-app_tea', termsAcceptedAt: NOW }, NOW);
		await settings().pause('app_tea', 'reputation', 'Complaints above 0.2%', NOW);
		expect(await settings().unpause('app_tea', ['seller'], NOW)).toBe(false);
		expect(await settings().get('app_tea')).toMatchObject({ status: 'on', pausedBy: 'reputation', sesTenant: 'store-app_tea' });
		expect(await settings().unpause('app_tea', ['seller', 'reputation', 'estori'], NOW)).toBe(true);
		expect((await settings().get('app_tea'))?.pausedBy).toBeNull();
	});

	it("lists the seller's live stores, and knows a store's slug and seller", async () => {
		expect(await settings().storesOf('seller_1')).toEqual([{ appId: 'app_tea', title: 'Northwind Tea' }]);
		expect(await settings().storeFacts('app_tea')).toMatchObject({ appId: 'app_tea', title: 'Northwind Tea', slug: 'northwind-tea', live: true, sellerUserId: 'seller_1', sellerEmail: 'seller_1@example.test' });
	});
});

describe('the marketing send log on real SQL', () => {
	const send = (id: string, dedupeKey: string) =>
		sends().create({ id, appId: 'app_tea', contactId: 'mc_ben', kind: 'confirmation', dedupeKey, recipient: 'ben@example.test', status: 'sending', now: NOW });

	it('writes one row per dedupe key', async () => {
		expect(await send('ms_1', 'confirm:mc_ben:1')).toBe(true);
		expect(await send('ms_2', 'confirm:mc_ben:1')).toBe(false);
	});

	it('finishes a send with its message id, and finds it by that id', async () => {
		await sends().finish('ms_1', { status: 'sent', sesMessageId: '0100-abc', sentAt: NOW });
		expect(await sends().byMessageId('0100-abc')).toMatchObject({ id: 'ms_1', status: 'sent' });
	});

	it('records each event once, and a permanent bounce survives a later transient one', async () => {
		expect(await sends().markDelivered('ms_1', later(1))).toBe(true);
		expect(await sends().markDelivered('ms_1', later(2))).toBe(false);
		expect(await sends().markBounced('ms_1', 'Permanent', later(3))).toBe(true);
		expect(await sends().markBounced('ms_1', 'Transient', later(4))).toBe(false);
		expect(await sends().byId('ms_1')).toMatchObject({ bounceType: 'Permanent', bouncedAt: later(3), deliveredAt: later(1) });
		expect(await sends().markComplained('ms_1', later(5))).toBe(true);
		expect(await sends().markComplained('ms_1', later(6))).toBe(false);
	});

	it('counts transient bounces for a contact since a time, and prunes old rows', async () => {
		await send('ms_3', 'confirm:mc_ben:2');
		await sends().markBounced('ms_3', 'Transient', later(10));
		expect(await sends().transientBouncesSince('mc_ben', NOW)).toBe(1);
		await sends().prune(later(1));
		expect(await sends().byId('ms_1')).toBeNull();
	});
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/database/services/marketing-contacts.sql.test.ts`. Expected: FAIL, because the modules and tables don't exist.
- [ ] **Step 3: Implement.**
  - **Shared types,** with the values above. `MARKETING_PLAN_LIMITS`:

    ```ts
    export const MARKETING_PLAN_LIMITS: Readonly<Record<MarketingPlanId, MarketingPlanLimits>> = {
    	basic: { contacts: 250, emailsPerMonth: 1_000, emailsPerDay: { new: 500, established: 1_000 }, imports: false, ownDomain: false },
    	premium: { contacts: 10_000, emailsPerMonth: 50_000, emailsPerDay: { new: 2_000, established: 20_000 }, imports: true, ownDomain: true },
    	enterprise: { contacts: 100_000, emailsPerMonth: 500_000, emailsPerDay: { new: 20_000, established: 100_000 }, imports: true, ownDomain: true },
    };
    ```

    Enterprise's numbers are a default that admins override per user.
  - **The subscribe messages:**

    ```ts
    STORE_SUBSCRIBE_MESSAGES = {
    	invalid_email: 'Enter a valid email address.',
    	unavailable: "Sign-ups aren't available right now.",
    	challenge_failed: "We couldn't check that you're not a bot. Try again.",
    	too_many: 'Too many sign-ups. Try again in a few minutes.',
    	preview: 'Sign-ups work on your live store.',
    }
    ```
  - **Schema** per spec section 6 (phase 1).
    - Enums come from the shared arrays. JSON columns (`tags`, `products_bought`, `send_window`, `frequency_cap`) are `text` with defaults `'[]'`, `'{"startHour":8,"endHour":20}'` and `'{"max":4,"days":7}'`.
    - `marketing_contacts`: unique index `marketing_contacts_app_email_unique_idx` on (`app_id`, `email`).
    - `marketing_sends`: unique `marketing_sends_dedupe_unique_idx` on `dedupe_key`, and unique `marketing_sends_message_unique_idx` on `ses_message_id`. SQLite allows many nulls in a unique index.
    - Run `bun run db:generate -- --name marketing_contacts`.
  - **The services:**
    - `create`: `insert ... onConflictDoNothing()`, then select by (`appId`, `email`).
    - `setConsent`: sets `subscribed_at` when moving to `subscribed`, and `unsubscribed_at` when moving to `unsubscribed`.
    - `list`: orders by `created_at desc, id desc`. The cursor is `"{createdAtSeconds}:{id}"`. Search is `email like ? or lower(first_name) like ? or lower(last_name) like ?`, with the term lowercased, `%`, `_` and `\` escaped, and `escape '\'`.
    - `recordOrder`: reads by (`appId`, `email`), creates with `consent: 'none', source: 'order'` when missing, then updates the totals. It keeps existing names when the new ones are null, and merges `productsBought` in order without duplicates, capped at 200.
    - The `mark*` methods: `update ... set x_at = ? where id = ? and x_at is null returning id`. `markDelivered` also sets `status = 'sent'` where `status = 'sending'`. `markBounced` writes `bounce_type` only when it's null, or when it's not `Permanent` and the new type is.
    - `storesOf`: apps of the user joined to a `live_stores` row with status `live`, ordered by title.
    - `storeFacts`: joins `apps`, `live_stores` (left) and `users` (email, `email_verified`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add shared/types/marketing.ts worker/database/schema.ts migrations/0029_marketing_contacts.sql migrations/meta worker/database/services/MarketingContactService.ts worker/database/services/MarketingSettingsService.ts worker/database/services/MarketingSendService.ts worker/database/index.ts src/api-types.ts worker/database/services/marketing-contacts.sql.test.ts
git commit -m "feat(marketing): contacts with consent records, store settings and a send log in d1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: The SES client and its error classes

**Files:**
- Modify: `package.json` (dependency `"aws4fetch": "1.0.20"`), `bun.lock` (`bun install --lockfile-only`)
- Create: `worker/services/marketing/types.ts`, `worker/services/marketing/ses/client.ts`, `worker/services/marketing/ses/errors.ts`
- Test: `worker/services/marketing/ses/client.test.ts`

**Interfaces:**
- **Produces, `types.ts`:**
  - `MarketingEmail { to; from: { email; name }; replyTo: string | null; subject; html; text; headers: Array<{ name; value }>; tags: Record<string, string>; tenant: string | null }`
  - `MarketingSender { send(email: MarketingEmail): Promise<{ messageId: string | null }> }`
- **Produces, `client.ts`:**
  - `SesConfig { accessKeyId; secretAccessKey; region; configurationSet }`
  - `SesAccount { max24HourSend; maxSendRate; sentLast24Hours; sendingEnabled; productionAccessEnabled; enforcementStatus }`
  - `class SesApiError extends Error { status: number; code: string }`
  - `formatFromAddress(from): string`
  - `SesClient`, with `sendEmail(email): Promise<{ messageId }>`, `getAccount()`, `createTenant(name)` and `associateTenantResource(name, resourceArn)`
  - `createSesClient(config, fetchImpl = fetch): SesClient`
- **Produces, `errors.ts`:** `SesErrorOutcome = 'throttled' | 'daily_quota' | 'paused' | 'config' | 'rejected' | 'uncertain'` and `classifySesError(error: unknown): SesErrorOutcome`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/ses/client.test.ts
import { describe, expect, it } from 'vitest';
import { createSesClient, formatFromAddress, SesApiError } from './client';
import { classifySesError } from './errors';
import type { MarketingEmail } from '../types';

const CONFIG = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY', region: 'us-east-1', configurationSet: 'estori-marketing' };
const EMAIL: MarketingEmail = {
	to: 'ana@example.test',
	from: { email: 'northwind-tea@news.estori.app', name: 'Northwind Tea' },
	replyTo: 'hello@northwind.test',
	subject: 'New teas are in',
	html: '<p>Hi</p>',
	text: 'Hi',
	headers: [
		{ name: 'List-Unsubscribe', value: '<https://news.estori.app/e/u/ms_1.abc>' },
		{ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
	],
	tags: { estori_send: 'ms_1', estori_store: 'app_tea', estori_kind: 'campaign' },
	tenant: 'store-app_tea',
};

function recorder(response: Response) {
	const requests: Request[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(input instanceof Request ? input : new Request(input, init));
		return response.clone();
	}) as typeof fetch;
	return { requests, fetchImpl };
}

describe('the SES client', () => {
	it('signs a v2 SendEmail with SigV4 and sends one recipient, our headers, the tags and the tenant', async () => {
		const { requests, fetchImpl } = recorder(Response.json({ MessageId: '0100018f-abc' }));
		expect(await createSesClient(CONFIG, fetchImpl).sendEmail(EMAIL)).toEqual({ messageId: '0100018f-abc' });
		const [request] = requests;
		expect(request.method).toBe('POST');
		expect(request.url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
		expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/ses\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
		expect(await request.json()).toEqual({
			FromEmailAddress: '"Northwind Tea" <northwind-tea@news.estori.app>',
			Destination: { ToAddresses: ['ana@example.test'] },
			ReplyToAddresses: ['hello@northwind.test'],
			Content: {
				Simple: {
					Subject: { Data: 'New teas are in', Charset: 'UTF-8' },
					Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' }, Text: { Data: 'Hi', Charset: 'UTF-8' } },
					Headers: [
						{ Name: 'List-Unsubscribe', Value: '<https://news.estori.app/e/u/ms_1.abc>' },
						{ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
					],
				},
			},
			ConfigurationSetName: 'estori-marketing',
			EmailTags: [
				{ Name: 'estori_send', Value: 'ms_1' },
				{ Name: 'estori_store', Value: 'app_tea' },
				{ Name: 'estori_kind', Value: 'campaign' },
			],
			TenantName: 'store-app_tea',
		});
	});

	it('leaves out Reply-To, headers and the tenant when there are none', async () => {
		const { requests, fetchImpl } = recorder(Response.json({ MessageId: 'm' }));
		await createSesClient(CONFIG, fetchImpl).sendEmail({ ...EMAIL, replyTo: null, headers: [], tenant: null });
		const body = (await requests[0].json()) as Record<string, unknown> & { Content: { Simple: Record<string, unknown> } };
		expect(body).not.toHaveProperty('ReplyToAddresses');
		expect(body).not.toHaveProperty('TenantName');
		expect(body.Content.Simple).not.toHaveProperty('Headers');
	});

	it("turns an error answer into an SesApiError with the error type's code and the message", async () => {
		const { fetchImpl } = recorder(
			new Response(JSON.stringify({ message: 'Maximum sending rate exceeded.' }), { status: 400, headers: { 'x-amzn-ErrorType': 'ThrottlingException:http://internal.amazon.com/coral/' } }),
		);
		const error = await createSesClient(CONFIG, fetchImpl).sendEmail(EMAIL).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SesApiError);
		expect(error).toMatchObject({ status: 400, code: 'ThrottlingException', message: 'Maximum sending rate exceeded.' });
	});

	it("reads the account's quota and health", async () => {
		const { requests, fetchImpl } = recorder(
			Response.json({ SendQuota: { Max24HourSend: 50000, MaxSendRate: 14, SentLast24Hours: 120 }, SendingEnabled: true, ProductionAccessEnabled: true, EnforcementStatus: 'HEALTHY' }),
		);
		expect(await createSesClient(CONFIG, fetchImpl).getAccount()).toEqual({ max24HourSend: 50000, maxSendRate: 14, sentLast24Hours: 120, sendingEnabled: true, productionAccessEnabled: true, enforcementStatus: 'HEALTHY' });
		expect(requests[0].method).toBe('GET');
		expect(requests[0].url).toBe('https://email.us-east-1.amazonaws.com/v2/email/account');
	});
});

describe('the From address', () => {
	it('quotes an ASCII name with its quotes escaped, and encodes any other name as UTF-8', () => {
		expect(formatFromAddress({ email: 'a@news.estori.app', name: 'Tea "&" Co' })).toBe('"Tea \\"&\\" Co" <a@news.estori.app>');
		const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('Café Luz')));
		expect(formatFromAddress({ email: 'a@news.estori.app', name: 'Café Luz' })).toBe(`=?UTF-8?B?${encoded}?= <a@news.estori.app>`);
		expect(formatFromAddress({ email: 'a@news.estori.app', name: ' \n ' })).toBe('a@news.estori.app');
	});
});

describe('SES error classes', () => {
	const ses = (status: number, code: string, message = '') => new SesApiError(status, code, message);
	it.each([
		['429', ses(429, 'TooManyRequestsException'), 'throttled'],
		['rate', ses(400, 'ThrottlingException', 'Maximum sending rate exceeded.'), 'throttled'],
		['daily', ses(400, 'ThrottlingException', 'Daily message quota exceeded.'), 'daily_quota'],
		['daily limit', ses(400, 'LimitExceededException', 'Daily message quota exceeded'), 'daily_quota'],
		['paused', ses(400, 'SendingPausedException'), 'paused'],
		['suspended', ses(400, 'AccountSuspendedException'), 'paused'],
		['mail from', ses(400, 'MailFromDomainNotVerifiedException'), 'config'],
		['missing', ses(404, 'NotFoundException'), 'config'],
		['rejected', ses(400, 'MessageRejected', 'Email address is not verified.'), 'rejected'],
		['bad request', ses(400, 'BadRequestException'), 'rejected'],
		['5xx', ses(503, 'ServiceUnavailable'), 'uncertain'],
		['network', new TypeError('fetch failed'), 'uncertain'],
	] as const)('%s is %s', (_name, error, outcome) => {
		expect(classifySesError(error)).toBe(outcome);
	});
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/ses/client.test.ts`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement**

```ts
// worker/services/marketing/ses/client.ts (core; the tenant calls follow the same `call` helper)
import { AwsClient } from 'aws4fetch';
import type { MarketingEmail } from '../types';

export class SesApiError extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
		this.name = 'SesApiError';
	}
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** `"Name" <email>`, or an RFC 2047 encoded name when it isn't plain ASCII. */
export function formatFromAddress(from: { email: string; name: string }): string {
	const name = from.name.replace(/[\r\n]+/g, ' ').trim();
	if (!name) return from.email;
	if (PRINTABLE_ASCII.test(name)) return `"${name.replace(/[\\"]/g, (character) => `\\${character}`)}" <${from.email}>`;
	return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(name)))}?= <${from.email}>`;
}

function errorCode(response: Response, body: Record<string, unknown>): string {
	const header = (response.headers.get('x-amzn-ErrorType') ?? '').split(':')[0];
	const fromBody = typeof body.__type === 'string' ? body.__type.split('#').pop() : typeof body.code === 'string' ? body.code : '';
	return header || fromBody || `HTTP${response.status}`;
}

export function createSesClient(config: SesConfig, fetchImpl: typeof fetch = fetch): SesClient {
	// Signing only: aws4fetch's own retries would resend after a 5xx that SES may already have accepted.
	const aws = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region, service: 'ses', retries: 0 });
	const base = `https://email.${config.region}.amazonaws.com/v2/email`;
	async function call<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
		const signed = await aws.sign(`${base}${path}`, {
			method,
			headers: payload === undefined ? {} : { 'content-type': 'application/json' },
			body: payload === undefined ? undefined : JSON.stringify(payload),
		});
		const response = await fetchImpl(signed);
		const text = await response.text();
		const parsed: Record<string, unknown> = text ? (JSON.parse(text) as Record<string, unknown>) : {};
		if (!response.ok) throw new SesApiError(response.status, errorCode(response, parsed), typeof parsed.message === 'string' ? parsed.message : typeof parsed.Message === 'string' ? parsed.Message : response.statusText);
		return parsed as T;
	}
	// sendEmail builds the body the test shows; getAccount maps SendQuota, SendingEnabled, ProductionAccessEnabled and EnforcementStatus.
	// createTenant: POST /tenants { TenantName }. associateTenantResource: the path recorded in Task 1.0, body { TenantName, ResourceArn }.
}
```

```ts
// worker/services/marketing/ses/errors.ts
import { SesApiError } from './client';

export type SesErrorOutcome = 'throttled' | 'daily_quota' | 'paused' | 'config' | 'rejected' | 'uncertain';

/** What a failed SES call means for the email and for sending as a whole. Pure. */
export function classifySesError(error: unknown): SesErrorOutcome {
	if (!(error instanceof SesApiError)) return 'uncertain';
	const message = error.message.toLowerCase();
	if (message.includes('daily message quota')) return 'daily_quota';
	if (error.status === 429 || message.includes('maximum sending rate')) return 'throttled';
	if (error.code === 'SendingPausedException' || error.code === 'AccountSuspendedException') return 'paused';
	if (error.code === 'MailFromDomainNotVerifiedException' || error.code === 'NotFoundException') return 'config';
	if (error.status >= 500) return 'uncertain';
	return 'rejected';
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): an ses v2 client signed with sigv4 through aws4fetch, and ses errors sorted into what sending should do`, with the trailer.

### Task 1.3: The marketing sender, sharing staging's guards with order emails

**Files:**
- Create: `worker/services/email/deployment-guards.ts` and `deployment-guards.test.ts`
- Modify: `worker/services/email/sender.ts` (use the guards; `sender.test.ts` must still pass unchanged)
- Create: `worker/services/marketing/sender.ts` and `sender.test.ts`
- Modify: `worker/types/env.d.ts`: add optional `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_ACCOUNT_ID`, `SES_CONFIGURATION_SET`, `SES_USE_TENANTS`, `SES_EVENTS_KEY`, `MARKETING_FROM_DOMAIN`, `MARKETING_LINK_HOST`, `MARKETING_SENDING`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, each with a one-line comment

**Interfaces:**
- **Produces, deployment guards:**
  - `deploymentGuards(env: { ENVIRONMENT?: string; EMAIL_RECIPIENT_ALLOWLIST?: string }): { staging: boolean; allows: ((recipient: string) => boolean) | null }`. In staging without an allowlist, `allows` is `() => false`.
  - `guardSend<T extends { to: string; subject: string }, R>(send: (email: T) => Promise<R>, guards, onBlocked: (email: T) => void): (email: T) => Promise<R>`. It throws `blockedRecipientError()` for blocked recipients and prefixes `[Staging] ` on staging.
- **Produces, the marketing sender:**
  - `marketingSenderOf(input: { ses: Pick<SesClient, 'sendEmail'> | null; dev: boolean; guards }): MarketingSender | null`
  - `createMarketingSender(env: Env): MarketingSender | null`
  - `sesClientFromEnv(env: Env): SesClient | null`, which is null unless both keys and `SES_REGION` and `SES_CONFIGURATION_SET` are set.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/sender.test.ts
import { describe, expect, it } from 'vitest';
import { marketingSenderOf } from './sender';
import { deploymentGuards } from '../email/deployment-guards';
import type { MarketingEmail } from './types';

const EMAIL: MarketingEmail = { to: 'ana@pluriza.com', from: { email: 'tea@news.estori.app', name: 'Tea' }, replyTo: null, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', headers: [], tags: { estori_send: 'ms_1' }, tenant: null };

function fakeSes() {
	const sent: MarketingEmail[] = [];
	return { sent, ses: { sendEmail: async (email: MarketingEmail) => (sent.push(email), { messageId: `m${sent.length}` }) } };
}

describe('the marketing sender', () => {
	it('is null with no SES client outside development', () => {
		expect(marketingSenderOf({ ses: null, dev: false, guards: deploymentGuards({}) })).toBeNull();
	});

	it("logs instead of sending in development, and answers no message id", async () => {
		const sender = marketingSenderOf({ ses: null, dev: true, guards: deploymentGuards({}) });
		expect(await sender?.send(EMAIL)).toEqual({ messageId: null });
	});

	it('sends through SES in production, unchanged', async () => {
		const { sent, ses } = fakeSes();
		expect(await marketingSenderOf({ ses, dev: false, guards: deploymentGuards({ ENVIRONMENT: 'prod' }) })?.send(EMAIL)).toEqual({ messageId: 'm1' });
		expect(sent[0].subject).toBe('Hello');
	});

	it('on staging, prefixes the subject and refuses anyone off the allowlist, or everyone without one', async () => {
		const { sent, ses } = fakeSes();
		const staging = marketingSenderOf({ ses, dev: false, guards: deploymentGuards({ ENVIRONMENT: 'staging', EMAIL_RECIPIENT_ALLOWLIST: '@pluriza.com' }) });
		await staging?.send(EMAIL);
		expect(sent[0].subject).toBe('[Staging] Hello');
		await expect(staging?.send({ ...EMAIL, to: 'stranger@example.test' })).rejects.toMatchObject({ code: 'E_STAGING_BLOCKED' });
		const locked = marketingSenderOf({ ses, dev: false, guards: deploymentGuards({ ENVIRONMENT: 'staging' }) });
		await expect(locked?.send(EMAIL)).rejects.toMatchObject({ code: 'E_STAGING_BLOCKED' });
		expect(sent).toHaveLength(1);
	});
});
```

`deployment-guards.test.ts` covers the same rules for a plain `{ to, subject }` send function: allowlist, prefix, and staging with no allowlist.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/sender.test.ts worker/services/email/deployment-guards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move `allowlisted` and `stagingSubjects` out of `email/sender.ts` into `deployment-guards.ts` as the generic `guardSend`, and make `createEmailSender` use it.
  - The dev log for marketing logs `to` (masked with `maskEmail` from `shopper-emails/template.ts`), the subject and the text. The text holds the confirm and unsubscribe links a developer follows.
- [ ] **Step 4:** Run the two new tests and `worker/services/email/sender.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): a marketing sender on ses that shares staging's allowlist and subject prefix with order emails`, with the trailer.

### Task 1.4: Signed link tokens and the link base

**Files:**
- Create: `worker/services/marketing/tokens.ts` and `tokens.test.ts`

**Interfaces:**
- **Produces:**
  - `MarketingTokenKind = 'unsubscribe' | 'confirm' | 'click' | 'open' | 'restore'`
  - `signMarketingToken(secret: string, kind: MarketingTokenKind, parts: readonly string[]): Promise<string>`
  - `readMarketingToken(secret: string, kind: MarketingTokenKind, token: string): Promise<string[] | null>`
  - `marketingLinkBase(env: Pick<Env, 'MARKETING_LINK_HOST' | 'CUSTOM_DOMAIN'>): string | null`
  - `MARKETING_LINK_PATHS = { unsubscribe: '/e/u/', confirm: '/e/confirm/', click: '/e/c/', open: '/e/o/' } as const`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { marketingLinkBase, readMarketingToken, signMarketingToken } from './tokens';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';

describe('marketing link tokens', () => {
	it('round-trips the parts of a token of the same kind, with a 22-character MAC', async () => {
		const token = await signMarketingToken(SECRET, 'unsubscribe', ['ms_abc-1']);
		expect(token).toMatch(/^ms_abc-1\.[A-Za-z0-9_-]{22}$/);
		expect(await readMarketingToken(SECRET, 'unsubscribe', token)).toEqual(['ms_abc-1']);
		const confirm = await signMarketingToken(SECRET, 'confirm', ['mc_1', '1800000000']);
		expect(await readMarketingToken(SECRET, 'confirm', confirm)).toEqual(['mc_1', '1800000000']);
	});

	it('refuses a token of another kind, under another secret, or with a changed part', async () => {
		const token = await signMarketingToken(SECRET, 'unsubscribe', ['ms_1']);
		expect(await readMarketingToken(SECRET, 'click', token)).toBeNull();
		expect(await readMarketingToken(`${SECRET}x`, 'unsubscribe', token)).toBeNull();
		expect(await readMarketingToken(SECRET, 'unsubscribe', token.replace('ms_1', 'ms_2'))).toBeNull();
	});

	it('refuses parts with a dot, and malformed tokens', async () => {
		await expect(signMarketingToken(SECRET, 'open', ['a.b'])).rejects.toThrow();
		for (const bad of ['', 'onlyone', '..', 'ms_1.', 'ms_1.!!!!']) expect(await readMarketingToken(SECRET, 'open', bad)).toBeNull();
	});

	it('puts links on the marketing host, else on the main domain, and http only on this machine', () => {
		expect(marketingLinkBase({ MARKETING_LINK_HOST: 'news.estori.app', CUSTOM_DOMAIN: 'estori.app' })).toBe('https://news.estori.app');
		expect(marketingLinkBase({ MARKETING_LINK_HOST: undefined, CUSTOM_DOMAIN: 'localhost:8100' })).toBe('http://localhost:8100');
		expect(marketingLinkBase({ MARKETING_LINK_HOST: undefined, CUSTOM_DOMAIN: undefined })).toBeNull();
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement**

```ts
// worker/services/marketing/tokens.ts
import { configuredBaseUrl } from '../email/links';

export type MarketingTokenKind = 'unsubscribe' | 'confirm' | 'click' | 'open' | 'restore';
const MAC_BYTES = 16;
const PART = /^[A-Za-z0-9_-]+$/;
const keys = new Map<string, Promise<CryptoKey>>();

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** One HMAC key per kind, derived from the secret, so a click token never works as an unsubscribe token. */
function keyFor(secret: string, kind: MarketingTokenKind): Promise<CryptoKey> {
	const cacheKey = `${kind}:${secret}`;
	let key = keys.get(cacheKey);
	if (!key) {
		key = (async () => {
			const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
			return crypto.subtle.deriveKey(
				{ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('estori-marketing'), info: new TextEncoder().encode(kind) },
				material,
				{ name: 'HMAC', hash: 'SHA-256', length: 256 },
				false,
				['sign'],
			);
		})();
		keys.set(cacheKey, key);
	}
	return key;
}

async function macOf(secret: string, kind: MarketingTokenKind, body: string): Promise<string> {
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret, kind), new TextEncoder().encode(body)));
	return base64url(signature.slice(0, MAC_BYTES));
}

export async function signMarketingToken(secret: string, kind: MarketingTokenKind, parts: readonly string[]): Promise<string> {
	if (parts.length === 0 || parts.some((part) => !PART.test(part))) throw new Error('Token parts must be non-empty ids without dots');
	const body = parts.join('.');
	return `${body}.${await macOf(secret, kind, body)}`;
}

/** The token's parts when its MAC matches this kind; null otherwise. Compared in constant time. */
export async function readMarketingToken(secret: string, kind: MarketingTokenKind, token: string): Promise<string[] | null> {
	const pieces = token.split('.');
	if (pieces.length < 2 || pieces.some((piece) => !PART.test(piece))) return null;
	const mac = pieces.pop() as string;
	const expected = await macOf(secret, kind, pieces.join('.'));
	if (mac.length !== expected.length) return null;
	let difference = 0;
	for (let index = 0; index < mac.length; index++) difference |= mac.charCodeAt(index) ^ expected.charCodeAt(index);
	return difference === 0 ? pieces : null;
}

export function marketingLinkBase(env: { MARKETING_LINK_HOST?: string; CUSTOM_DOMAIN?: string }): string | null {
	const host = env.MARKETING_LINK_HOST?.trim();
	return host ? `https://${host}` : configuredBaseUrl(env as Env);
}

export const MARKETING_LINK_PATHS = { unsubscribe: '/e/u/', confirm: '/e/confirm/', click: '/e/c/', open: '/e/o/' } as const;
```

- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): signed link tokens with a key per kind, derived from the deployment's secret`, with the trailer.

### Task 1.5: Email normalization and consent transitions

**Files:**
- Create: `worker/services/marketing/consent.ts` and `consent.test.ts`

**Interfaces:**
- **Produces:**
  - `normalizeEmail(raw: unknown): string | null`: trimmed, lowercased, `validateEmail` passes, at most 254 characters, not a role address.
  - `isRoleAddress(email: string): boolean`
  - `ConsentEvent = 'form_signup' | 'confirm' | 'checkout_optin' | 'import' | 'seller_add' | 'unsubscribe' | 'complaint' | 'resubscribe'`
  - `nextConsent(current: MarketingConsent | null, event: ConsentEvent): MarketingConsent | null`, where null means no change.
  - `fillStoreName(text: string, storeName: string): string`, which replaces `{store}`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/consent.test.ts
import { describe, expect, it } from 'vitest';
import { fillStoreName, isRoleAddress, nextConsent, normalizeEmail } from './consent';

describe('email normalization', () => {
	it('trims and lowercases, so different spellings are one contact', () => {
		expect(normalizeEmail('  Ana@Example.TEST ')).toBe('ana@example.test');
	});
	it('refuses non-strings, bad syntax, very long addresses and role mailboxes', () => {
		for (const bad of [42, null, 'ana', 'ana@', 'a b@example.test', `${'a'.repeat(250)}@example.test`, 'postmaster@example.test', 'No-Reply@example.test']) {
			expect(normalizeEmail(bad)).toBeNull();
		}
		expect(isRoleAddress('abuse@shop.test')).toBe(true);
		expect(isRoleAddress('ana@shop.test')).toBe(false);
	});
});

describe('consent transitions', () => {
	it.each([
		[null, 'form_signup', 'pending'],
		['none', 'form_signup', 'pending'],
		['unsubscribed', 'form_signup', 'pending'],
		['pending', 'form_signup', 'pending'],
		['subscribed', 'form_signup', null],
		['pending', 'confirm', 'subscribed'],
		['subscribed', 'confirm', null],
		['unsubscribed', 'confirm', null],
		[null, 'checkout_optin', 'subscribed'],
		['unsubscribed', 'checkout_optin', 'subscribed'],
		['subscribed', 'checkout_optin', null],
		[null, 'import', 'subscribed'],
		['none', 'seller_add', 'subscribed'],
		['unsubscribed', 'import', null],
		['unsubscribed', 'seller_add', null],
		['subscribed', 'unsubscribe', 'unsubscribed'],
		['pending', 'complaint', 'unsubscribed'],
		['unsubscribed', 'unsubscribe', null],
		['unsubscribed', 'resubscribe', 'subscribed'],
		['none', 'resubscribe', null],
	] as const)('%s + %s is %s', (current, event, expected) => {
		expect(nextConsent(current, event)).toBe(expected);
	});
});

describe('consent wording', () => {
	it('names the store', () => {
		expect(fillStoreName('Email me news and offers from {store}', 'Northwind Tea')).toBe('Email me news and offers from Northwind Tea');
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Role local parts: `abuse`, `postmaster`, `noreply`, `no-reply`, `mailer-daemon`, `hostmaster`, `webmaster`.
  - `validateEmail` comes from `worker/utils/validationUtils.ts`.
  - The transition table is exactly the test's.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): one normalized address per contact, and the consent changes each event may make`, with the trailer.

### Task 1.6: Settings, plan limits, the SES tenant and the settings API

**Files:**
- Create: `worker/services/marketing/settings.ts` and `settings.test.ts` (validation and plan resolution)
- Create: `worker/services/marketing/tenants.ts` and `tenants.test.ts`
- Modify: `worker/config/index.ts`: `GlobalConfigurableSettings` gains `marketing: MarketingSettingsConfig` (`{ plan: MarketingPlanId; limits: Partial<MarketingPlanLimits> }`, defaults `basic` and `{}`); add `getMarketingConfig(env, userId)`, read fresh like `getSellerLimitsSettings`
- Create: `worker/api/controllers/marketing/settingsController.ts`, `worker/api/controllers/marketing/settings.sql.test.ts`
- Create: `worker/api/routes/marketingRoutes.ts`; modify `worker/api/routes/index.ts` (call `setupMarketingRoutes(app)` after `setupShopperEmailRoutes`)
- Test: `worker/api/routes/marketing-routes-wiring.test.ts` (a source guard, as `shopperEmails/routes-wiring.test.ts` does)

**Interfaces:**
- **Consumes:** `MarketingSettingsService` (Task 1.1), `createSesClient` (Task 1.2).
- **Produces:**
  - `settingsProblem(fields: MarketingSettingsFields): string | null`
  - `turnOnProblem(fields: MarketingSettingsFields, acceptRules: boolean): string | null`
  - `planLimitsFor(config: MarketingSettingsConfig): MarketingPlanLimits`
  - `dailyLimitFor(limits: MarketingPlanLimits, level: SellerLevel): number`
  - `tenantNameFor(appId: string): string`, which is `store-${appId}` with characters outside `[A-Za-z0-9_-]` replaced by `-` and at most 64 characters
  - `ensureTenant(deps: { ses: Pick<SesClient, 'createTenant' | 'associateTenantResource'>; identityArn: string; configurationSetArn: string }, appId: string): Promise<string>`, which treats an `AlreadyExistsException` (409) on create or associate as done
  - the routes `GET /api/marketing/stores` (authenticated), `GET` and `PUT /api/stores/:id/marketing/settings`, `POST /api/stores/:id/marketing/status` and `POST /api/stores/:id/marketing/pause` (owner-only)

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/settings.test.ts
import { describe, expect, it } from 'vitest';
import { dailyLimitFor, planLimitsFor, settingsProblem, turnOnProblem } from './settings';
import { DEFAULT_MARKETING_SETTINGS, MARKETING_PLAN_LIMITS } from '../../../shared/types/marketing';

const READY = { ...DEFAULT_MARKETING_SETTINGS, senderName: 'Northwind Tea', postalAddress: '1 Main St, Austin, TX 78701' };

describe('marketing settings', () => {
	it('accepts the defaults with a name and address', () => {
		expect(settingsProblem(READY)).toBeNull();
	});
	it('names what is wrong', () => {
		expect(settingsProblem({ ...READY, senderName: 'x'.repeat(61) })).toBe('The sender name is longer than 60 characters.');
		expect(settingsProblem({ ...READY, replyTo: 'not-an-email' })).toBe('Enter a valid email for replies.');
		expect(settingsProblem({ ...READY, timezone: 'Mars/Olympus' })).toBe('Pick a time zone from the list.');
		expect(settingsProblem({ ...READY, sendWindow: { startHour: 20, endHour: 8 } })).toBe('The send window must start before it ends, between 0 and 24.');
		expect(settingsProblem({ ...READY, frequencyCap: { max: 0, days: 7 } })).toBe('The frequency cap must allow 1 to 50 emails over 1 to 30 days.');
		expect(settingsProblem({ ...READY, postalAddress: 'Line one\nLine two' })).toBe('Write the postal address on one line.');
	});
	it('turns on only with a sender name, a postal address and the rules accepted', () => {
		expect(turnOnProblem({ ...READY, postalAddress: '' }, true)).toBe('Add the postal address your emails will show. A P.O. box works.');
		expect(turnOnProblem({ ...READY, senderName: '' }, true)).toBe('Add the name your emails come from.');
		expect(turnOnProblem(READY, false)).toBe('Accept the email marketing rules to turn it on.');
		expect(turnOnProblem(READY, true)).toBeNull();
	});
	it("applies an admin's limit overrides over the plan's, and picks the day limit by seller level", () => {
		expect(planLimitsFor({ plan: 'basic', limits: {} })).toEqual(MARKETING_PLAN_LIMITS.basic);
		expect(planLimitsFor({ plan: 'premium', limits: { contacts: 25_000 } }).contacts).toBe(25_000);
		expect(dailyLimitFor(MARKETING_PLAN_LIMITS.basic, 'new')).toBe(500);
	});
});
```

```ts
// worker/services/marketing/tenants.test.ts
import { describe, expect, it } from 'vitest';
import { ensureTenant, tenantNameFor } from './tenants';
import { SesApiError } from './ses/client';

describe('SES tenants', () => {
	it('names a tenant after the store, within SES limits', () => {
		expect(tenantNameFor('9f1c2a7e-0b4d-4e7f-9a1b-2c3d4e5f6a7b')).toBe('store-9f1c2a7e-0b4d-4e7f-9a1b-2c3d4e5f6a7b');
		expect(tenantNameFor('a.b c')).toBe('store-a-b-c');
	});
	it('creates the tenant and associates the identity and configuration set, treating existing ones as done', async () => {
		const calls: string[] = [];
		const ses = {
			createTenant: async (name: string) => {
				calls.push(`create ${name}`);
				throw new SesApiError(409, 'AlreadyExistsException', 'exists');
			},
			associateTenantResource: async (name: string, arn: string) => {
				calls.push(`associate ${name} ${arn}`);
			},
		};
		expect(await ensureTenant({ ses, identityArn: 'arn:id', configurationSetArn: 'arn:cs' }, 'app_tea')).toBe('store-app_tea');
		expect(calls).toEqual(['create store-app_tea', 'associate store-app_tea arn:id', 'associate store-app_tea arn:cs']);
	});
});
```

`settings.sql.test.ts` uses real SQL with a fake `ensureTenant`. It checks:
- `GET` answers the defaults with `status: 'off'`, the store's sender address `northwind-tea@news.estori.app`, the plan and limits, and usage.
- `PUT` saves fields and answers 400 with `settingsProblem`'s message.
- `POST /status { status: 'on', acceptRules: true }` turns on, calls the tenant once, and records `terms_accepted_at`. Without `acceptRules` it answers 400.
- `POST /pause { paused: true }` sets `pausedBy: 'seller'`, and `{ paused: false }` lifts it. A reputation pause can't be lifted this way (409, "Estori paused this store's emails: {reason}. Contact support.").

The routes test asserts that every `/api/stores/:id/marketing/` route in `marketingRoutes.ts` uses `AuthConfig.ownerOnly`, and that `/api/marketing/stores` uses `AuthConfig.authenticated`.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/settings.test.ts worker/services/marketing/tenants.test.ts worker/api/controllers/marketing/settings.sql.test.ts worker/api/routes/marketing-routes-wiring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Validation:** time zones are checked with `Intl.supportedValuesOf('timeZone')`. The US zones list for the UI is `shared/types/marketing.ts` `MARKETING_TIME_ZONES` (New York, Chicago, Denver, Phoenix, Los Angeles, Anchorage, Honolulu).
  - **The controller** builds `MarketingSettingsView`:
    - `senderEmail` from `storeSenderAddress(facts.slug, 'news@' + env.MARKETING_FROM_DOMAIN)`, falling back to `news.estori.app` when the variable is unset;
    - the plan and limits from `getMarketingConfig`;
    - `usage.contacts` from `listedCount`;
    - `usage.emailsThisMonth` from a `MarketingSendService.sentSince(sellerUserId, startOfUtcMonth)`. Add that method and its real-SQL case here: it counts `campaign` and `automation` sends with status `sent` across the seller's stores.
  - **Tenants:** the tenant is created only when `env.SES_USE_TENANTS === 'true'` and an SES client exists. The ARNs are `arn:aws:ses:{SES_REGION}:{SES_ACCOUNT_ID}:identity/{MARKETING_FROM_DOMAIN}` and `arn:aws:ses:{SES_REGION}:{SES_ACCOUNT_ID}:configuration-set/{SES_CONFIGURATION_SET}`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): store email settings with validation, plan limits an admin can override, and an ses tenant when a store turns marketing on`, with the trailer.

### Task 1.7: Sign-up from the store: `Estori.subscribe`, Turnstile and the confirmation email

**Files:**
- Create: `worker/services/marketing/turnstile.ts` and `turnstile.test.ts`
- Create: `worker/services/marketing/signup.ts` and `signup.test.ts`
- Create: `worker/services/marketing/confirmation.ts` and `confirmation.test.ts` (the confirmation email)
- Create: `worker/services/marketing/wiring.ts` (production deps for sign-up, confirmation and links)
- Modify: `worker/services/store-payments/store-script.ts` and `store-script.test.ts`
- Modify: `worker/api/handlers/store-platform.ts`: `POST /__estori/subscribe` and `GET /__estori/challenge`; `serveStoreInfo` adds `marketing`
- Modify: `shared/types/store-payments.ts` (`StoreInfo.marketing: { signup: boolean; checkoutConsent: boolean; consentText: string } | null`) and `worker/services/store-payments/checkout.ts` (`storeInfoOf` takes it)
- Modify: `worker/services/rate-limit/config.ts` and `rateLimits.ts`
  - `STORE_SIGNUP`: Durable Object store, limit 5, period 600, keyed `store:{appId}:{client}`.
  - `SIGNUP_RECIPIENT`: limit 3, period 86,400, keyed by the hashed address, through the `recipientIdentifier` used by `CONTACT_RECIPIENT`.
  - `enforceStoreSignupRateLimit(env, config, request, appId)` and `enforceSignupRecipientRateLimit(env, config, email)`.

**Interfaces:**
- **Consumes:** `normalizeEmail`, `nextConsent`, `fillStoreName` (1.5); `MarketingContactService` (1.1); `signMarketingToken`, `marketingLinkBase` (1.4); `createMarketingSender` (1.3).
- **Produces:**
  - `verifyTurnstile(input: { secret: string; token: string; remoteIp: string | null; hostnames: readonly string[]; idempotencyKey: string }, fetchImpl = fetch): Promise<'ok' | 'failed' | 'unavailable'>`
  - `parseSignupBody(body: unknown): SignupRequest | null`, where `SignupRequest = { email: string; firstName: string | null; form: string | null; consentText: string | null; challengeToken: string | null }`
  - `SignupDeps`:
    - `store(appId)` resolving to `{ status: 'on' | 'off'; paused: boolean; consentText: string; storeName: string; room: boolean } | null`;
    - `contacts: Pick<MarketingContactService, 'byEmail' | 'create' | 'setConsent' | 'recordConsent'>`;
    - `challenge(token: string | null): Promise<'ok' | 'failed' | 'unavailable'>`;
    - `limited(email: string): Promise<boolean>`;
    - `sendConfirmation(contact: MarketingContactRow): Promise<void>`;
    - `now()` and `newId()`.
  - `SignupContext { appId; viewer: 'live' | 'preview'; ip: string | null; userAgent: string | null; pageUrl: string | null; timezone: string | null }`
  - `subscribeFromStore(deps, context, body): Promise<StoreSubscribeResult>`
  - `CONFIRM_TTL_DAYS = 7`
  - `confirmationEmail(input: { to; storeName; postalAddress; confirmUrl; from; replyTo }): MarketingEmail`
  - `sendConfirmation(deps, contact)`, which writes a `confirmation` send with the dedupe key `confirm:{contactId}:{UTC yyyymmddhh}` and never throws

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/signup.test.ts
import { describe, expect, it } from 'vitest';
import { subscribeFromStore, type SignupDeps } from './signup';
import type { MarketingContactRow } from '../../database/services/MarketingContactService';
import type { MarketingConsent } from '../../../shared/types/marketing';

const NOW = new Date('2026-10-19T15:00:00Z');
const CONTEXT = { appId: 'app_tea', viewer: 'live' as const, ip: '203.0.113.9', userAgent: 'Mozilla/5.0', pageUrl: 'https://northwind-tea.estori.shop/', timezone: 'America/Chicago' };
const BODY = { email: ' Ana@Example.test ', firstName: 'Ana', form: 'footer', consentText: 'Get tea news', challengeToken: 'tok' };

function world(input: { existing?: MarketingConsent; suppressed?: boolean; confirmSentAt?: Date; store?: Partial<{ status: 'on' | 'off'; paused: boolean; room: boolean }> | null; challenge?: 'ok' | 'failed' | 'unavailable'; limited?: boolean } = {}) {
	const rows = new Map<string, MarketingContactRow>();
	const consents: Array<{ action: string; text: string | null; form: string | null; pageUrl: string | null }> = [];
	const confirmations: string[] = [];
	if (input.existing) {
		rows.set('ana@example.test', { id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', consent: input.existing, suppressed: input.suppressed ? 'complaint' : null, confirmSentAt: input.confirmSentAt ?? null } as MarketingContactRow);
	}
	const deps: SignupDeps = {
		store: async () => (input.store === null ? null : { status: 'on', paused: false, room: true, consentText: 'Email me news and offers from {store}', storeName: 'Northwind Tea', ...input.store }),
		contacts: {
			byEmail: async (_appId, email) => rows.get(email) ?? null,
			create: async (row) => {
				const created = { ...row, suppressed: null, confirmSentAt: null } as unknown as MarketingContactRow;
				rows.set(row.email, created);
				return created;
			},
			setConsent: async (id, consent) => {
				for (const row of rows.values()) if (row.id === id) row.consent = consent;
			},
			recordConsent: async (record) => {
				consents.push({ action: record.action, text: record.text, form: record.form, pageUrl: record.pageUrl });
			},
		},
		challenge: async () => input.challenge ?? 'ok',
		limited: async () => input.limited ?? false,
		sendConfirmation: async (contact) => {
			confirmations.push(contact.email);
		},
		now: () => NOW,
		newId: () => `id_${consents.length}_${confirmations.length}`,
	};
	return { deps, rows, consents, confirmations };
}

describe('sign-up from a store', () => {
	it('stores a new pending contact with its consent record, sends the confirmation, and answers check your inbox', async () => {
		const { deps, rows, consents, confirmations } = world();
		expect(await subscribeFromStore(deps, CONTEXT, BODY)).toEqual({ ok: true, confirm: true });
		expect(rows.get('ana@example.test')).toMatchObject({ consent: 'pending', firstName: 'Ana', source: 'form', timezone: 'America/Chicago' });
		expect(consents).toEqual([{ action: 'requested', text: 'Get tea news', form: 'footer', pageUrl: 'https://northwind-tea.estori.shop/' }]);
		expect(confirmations).toEqual(['ana@example.test']);
	});

	it("records the store's own wording when the form sends none", async () => {
		const { deps, consents } = world();
		await subscribeFromStore(deps, CONTEXT, { ...BODY, consentText: undefined });
		expect(consents[0].text).toBe('Email me news and offers from Northwind Tea');
	});

	it('answers the same for an address already subscribed, and sends nothing', async () => {
		const { deps, confirmations, consents } = world({ existing: 'subscribed' });
		expect(await subscribeFromStore(deps, CONTEXT, BODY)).toEqual({ ok: true, confirm: true });
		expect(confirmations).toEqual([]);
		expect(consents).toEqual([]);
	});

	it('sends nothing to a suppressed address, but answers the same', async () => {
		const { deps, confirmations } = world({ existing: 'unsubscribed', suppressed: true });
		expect(await subscribeFromStore(deps, CONTEXT, BODY)).toEqual({ ok: true, confirm: true });
		expect(confirmations).toEqual([]);
	});

	it('does not send a second confirmation within 10 minutes', async () => {
		const { deps, confirmations } = world({ existing: 'pending', confirmSentAt: new Date(NOW.getTime() - 5 * 60 * 1000) });
		await subscribeFromStore(deps, CONTEXT, BODY);
		expect(confirmations).toEqual([]);
	});

	it.each([
		['a preview', { context: { ...CONTEXT, viewer: 'preview' as const } }, 'preview'],
		['marketing off', { store: { status: 'off' as const } }, 'unavailable'],
		['a paused store', { store: { paused: true } }, 'unavailable'],
		['no room on the plan', { store: { room: false } }, 'unavailable'],
		['no settings', { store: null }, 'unavailable'],
		['a failed challenge', { challenge: 'failed' as const }, 'challenge_failed'],
		['Turnstile unreachable', { challenge: 'unavailable' as const }, 'unavailable'],
		['the rate limit', { limited: true }, 'too_many'],
	] as const)('refuses %s', async (_name, setup, reason) => {
		const { deps, rows } = world('store' in setup ? { store: setup.store } : 'challenge' in setup ? { challenge: setup.challenge } : 'limited' in setup ? { limited: setup.limited } : {});
		const result = await subscribeFromStore(deps, 'context' in setup ? setup.context : CONTEXT, BODY);
		expect(result).toMatchObject({ ok: false, reason });
		expect(rows.size).toBe(0);
	});

	it('refuses a bad email or body before any check that costs a call', async () => {
		const { deps } = world({ challenge: 'failed' });
		expect(await subscribeFromStore(deps, CONTEXT, { ...BODY, email: 'postmaster@example.test' })).toMatchObject({ ok: false, reason: 'invalid_email' });
		expect(await subscribeFromStore(deps, CONTEXT, 'nope')).toMatchObject({ ok: false, reason: 'invalid_email' });
	});
});
```

```ts
// worker/services/marketing/turnstile.test.ts
import { describe, expect, it } from 'vitest';
import { verifyTurnstile } from './turnstile';

const INPUT = { secret: 's3cret', token: 'tok', remoteIp: '203.0.113.9', hostnames: ['northwind-tea.estori.shop'], idempotencyKey: 'k1' };
const answering = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Turnstile', () => {
	it('passes a success for one of the expected hostnames, posting the secret, token, IP and idempotency key', async () => {
		let sent: FormData | null = null;
		const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			sent = init?.body as FormData;
			return Response.json({ success: true, hostname: 'northwind-tea.estori.shop' });
		}) as typeof fetch;
		expect(await verifyTurnstile(INPUT, fetchImpl)).toBe('ok');
		expect(sent && [...(sent as FormData).entries()]).toEqual([['secret', 's3cret'], ['response', 'tok'], ['remoteip', '203.0.113.9'], ['idempotency_key', 'k1']]);
	});
	it('fails a success for another hostname, a failure, or a missing token', async () => {
		expect(await verifyTurnstile(INPUT, answering({ success: true, hostname: 'evil.test' }))).toBe('failed');
		expect(await verifyTurnstile(INPUT, answering({ success: false, 'error-codes': ['timeout-or-duplicate'] }))).toBe('failed');
		expect(await verifyTurnstile({ ...INPUT, token: '' }, answering({ success: true }))).toBe('failed');
	});
	it('is unavailable when Turnstile answers an error or the network fails', async () => {
		expect(await verifyTurnstile(INPUT, answering({}, 500))).toBe('unavailable');
		expect(await verifyTurnstile(INPUT, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toBe('unavailable');
	});
});
```

`confirmation.test.ts` checks the confirmation email:
- subject `Confirm your subscription to Northwind Tea`;
- one link: the confirm URL, escaped;
- the postal address;
- the text version holds the same link;
- the From and Reply-To are as given;
- no `List-Unsubscribe` header;
- the tag `estori_kind: 'confirmation'`.

It also checks `sendConfirmation`:
- it writes the send, sends, and records the message id;
- a send that throws is recorded `failed` and doesn't throw.

`store-script.test.ts` gains these checks:
- `STORE_SCRIPT` defines `subscribe:`;
- it POSTs to `base + '/subscribe'` with `credentials: 'same-origin'`;
- it loads Turnstile only from `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`;
- on a host that isn't the store's subdomain it uses the `/__estori/challenge` iframe and checks `event.origin`;
- every path resolves with `reason: 'unavailable'` on a network error;
- the script still parses with `new Function(STORE_SCRIPT)`.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/signup.test.ts worker/services/marketing/turnstile.test.ts worker/services/marketing/confirmation.test.ts worker/services/store-payments/store-script.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - **`subscribeFromStore` order** (spec section 8.3):
    1. parse the body and normalize the email (→ `invalid_email`);
    2. `viewer === 'preview'` → `preview`;
    3. store settings → `unavailable`;
    4. `limited` → `too_many`;
    5. `challenge` → `challenge_failed` or `unavailable`;
    6. upsert with `nextConsent(current, 'form_signup')`;
    7. record `requested` with the text given (cut to 200 characters), or the filled store wording;
    8. send the confirmation unless `confirmSentAt` is within 10 minutes;
    9. answer `{ ok: true, confirm: true }`.
  - **The store script** gains `subscribe(request)`:
    1. Validate locally (it has an `@` and is at most 254 characters).
    2. Get a Turnstile token:
       - When `location.hostname` ends with `.` + the stores domain, or is a local `.localhost` host, render explicitly in a container with `appearance: 'interaction-only'`. The stores domain comes from `Estori.store()`'s new `marketing.challengeHost`, the store's own subdomain host.
       - Otherwise, open an iframe to `https://{challengeHost}/__estori/challenge` and await a `postMessage` from that origin.
    3. POST `{ email, firstName, form, consentText, challengeToken }` as JSON.
    4. Map any non-JSON or network failure to `{ ok: false, reason: 'unavailable', message }`.
  - **`StoreInfo.marketing`** also carries `challengeHost: string | null` and `siteKey: string | null`.
  - **`GET /__estori/challenge`** returns a page with:
    - CSP `default-src 'none'; script-src https://challenges.cloudflare.com 'nonce-{n}'; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; frame-ancestors *`;
    - the widget;
    - a script that posts `{ type: 'estori:turnstile', token }` to `parent` with `targetOrigin` set to the `origin` query parameter, which is checked against the store's live domain (from `LiveStoreService.domainOfApp`).
  - **The handler** wires the deps from env:
    - `challenge` via `verifyTurnstile` with hostnames `[url.hostname, '{slug}.{STORES_DOMAIN}']`;
    - `limited` via the two new rate limits;
    - `ip` from `CF-Connecting-IP`, `timezone` from `request.cf?.timezone` and `pageUrl` from the `Referer` origin and path.
  - **Development:** when `TURNSTILE_SECRET_KEY` is unset and `isDev(env)`, use the always-pass test secret `1x0000000000000000000000000000000AA`. Otherwise an unset secret answers `unavailable`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): stores sign shoppers up through estori.subscribe with turnstile and a double opt-in email, without revealing who is on the list`, with the trailer.

### Task 1.8: Confirm and unsubscribe links on the marketing host

**Files:**
- Create: `worker/services/marketing/link-actions.ts` and `link-actions.test.ts`
- Create: `worker/services/marketing/pages.ts` (HTML for the link pages)
- Create: `worker/api/handlers/marketing-links.ts` and `marketing-links.test.ts`
- Modify: `worker/index.ts`. Before the live-store lookup, add: `if (isMarketingLinkRequest(env, url)) return handleMarketingLinks(request, env, ctx);`. It matches `/e/` paths on `MARKETING_LINK_HOST`, and on the main domain.
- Modify: `wrangler.estori.jsonc` and `wrangler.estori-staging.jsonc`:
  - routes: `{ "pattern": "news.estori.app", "custom_domain": true }` (staging: `news-staging.estori.app`);
  - variables: `MARKETING_FROM_DOMAIN` and `MARKETING_LINK_HOST`.

**Interfaces:**
- **Consumes:** tokens (1.4), the services (1.1), `nextConsent` (1.5).
- **Produces:**
  - `LinkStore { appId; name; url: string | null; accent: string; postalAddress: string }`
  - `LinkPage`, one of:
    - `{ kind: 'unsubscribe_ask' | 'unsubscribed' | 'already_unsubscribed'; store; token }`
    - `{ kind: 'resubscribed' | 'confirmed' | 'test'; store }`
    - `{ kind: 'confirm_ask'; store; token }`
    - `{ kind: 'expired'; store: LinkStore | null }`
    - `{ kind: 'not_found' }`
  - `LinkActionDeps`:
    - `secret`;
    - `sends: Pick<MarketingSendService, 'byId' | 'markUnsubscribed'>`;
    - `contacts: Pick<MarketingContactService, 'byId' | 'setConsent' | 'recordConsent'>`;
    - `store(appId): Promise<LinkStore | null>`;
    - `onConfirmed(contact): Promise<void>` (the welcome trigger, a no-op until phase 4);
    - `onUnsubscribed(send): Promise<void>` (campaign counters, a no-op until phase 3);
    - `now()` and `newId()`.
  - `unsubscribeLink(deps, token, request: { method: 'GET' | 'POST'; oneClick: boolean }): Promise<LinkPage>`
  - `resubscribeLink(deps, token): Promise<LinkPage>`
  - `confirmLink(deps, token, method): Promise<LinkPage>`
  - `respondToMarketingLink(deps, request: Request): Promise<Response>`
  - `isMarketingLinkRequest(env, url): boolean`
  - `handleMarketingLinks(request, env, ctx): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/api/handlers/marketing-links.test.ts
import { describe, expect, it } from 'vitest';
import { respondToMarketingLink } from './marketing-links';
import { signMarketingToken } from '../../services/marketing/tokens';
import type { LinkActionDeps } from '../../services/marketing/link-actions';
import type { MarketingContactRow } from '../../database/services/MarketingContactService';
import type { MarketingSendRow } from '../../database/services/MarketingSendService';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';
const NOW = new Date('2026-10-19T15:00:00Z');

function world(input: { consent?: 'subscribed' | 'unsubscribed' | 'pending'; kind?: 'campaign' | 'test' } = {}) {
	const contact = { id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', consent: input.consent ?? 'subscribed', suppressed: null } as MarketingContactRow;
	const send = { id: 'ms_1', appId: 'app_tea', contactId: 'mc_1', kind: input.kind ?? 'campaign', unsubscribedAt: null } as unknown as MarketingSendRow;
	const records: Array<{ action: string; channel: string; sendId: string | null }> = [];
	let confirmed = 0;
	const deps: LinkActionDeps = {
		secret: SECRET,
		sends: { byId: async (id) => (id === 'ms_1' ? send : null), markUnsubscribed: async () => true },
		contacts: {
			byId: async (_appId, id) => (id === 'mc_1' ? contact : null),
			setConsent: async (_id, consent) => {
				contact.consent = consent;
			},
			recordConsent: async (record) => {
				records.push({ action: record.action, channel: record.channel, sendId: record.sendId });
			},
		},
		store: async () => ({ appId: 'app_tea', name: 'Northwind Tea', url: 'https://northwind-tea.estori.shop', accent: '#2f6b4f', postalAddress: '1 Main St, Austin, TX 78701' }),
		onConfirmed: async () => {
			confirmed += 1;
		},
		onUnsubscribed: async () => undefined,
		now: () => NOW,
		newId: () => `mx_${records.length}`,
	};
	return { deps, contact, records, confirmedCount: () => confirmed };
}

const unsubscribeUrl = async () => `https://news.estori.app/e/u/${await signMarketingToken(SECRET, 'unsubscribe', ['ms_1'])}`;

describe('unsubscribe links', () => {
	it('asks first on GET, so a link scanner unsubscribes no one', async () => {
		const { deps, contact } = world();
		const response = await respondToMarketingLink(deps, new Request(await unsubscribeUrl()));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<form method="post"');
		expect(contact.consent).toBe('subscribed');
	});

	it('one-click POST with a multipart body unsubscribes and answers 200, with no redirect or cookie', async () => {
		const { deps, contact, records } = world();
		const body = new FormData();
		body.set('List-Unsubscribe', 'One-Click');
		const response = await respondToMarketingLink(deps, new Request(await unsubscribeUrl(), { method: 'POST', body }));
		expect(response.status).toBe(200);
		expect(response.headers.get('Location')).toBeNull();
		expect(response.headers.get('Set-Cookie')).toBeNull();
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
		expect(contact.consent).toBe('unsubscribed');
		expect(records).toEqual([{ action: 'unsubscribed', channel: 'one_click', sendId: 'ms_1' }]);
	});

	it("records the page's own button as the unsubscribe page, and offers to subscribe again", async () => {
		const { deps, records } = world();
		const body = new URLSearchParams({ action: 'unsubscribe' });
		const response = await respondToMarketingLink(deps, new Request(await unsubscribeUrl(), { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
		expect(await response.text()).toContain('/resubscribe');
		expect(records[0].channel).toBe('unsubscribe_page');
	});

	it('subscribes again from the page, as the shopper\'s own choice', async () => {
		const { deps, contact, records } = world({ consent: 'unsubscribed' });
		await respondToMarketingLink(deps, new Request(`${await unsubscribeUrl()}/resubscribe`, { method: 'POST' }));
		expect(contact.consent).toBe('subscribed');
		expect(records).toEqual([{ action: 'resubscribed', channel: 'unsubscribe_page', sendId: 'ms_1' }]);
	});

	it('changes nothing for a test email, and answers 404 for a forged token', async () => {
		const test = world({ kind: 'test' });
		const body = new FormData();
		body.set('List-Unsubscribe', 'One-Click');
		await respondToMarketingLink(test.deps, new Request(await unsubscribeUrl(), { method: 'POST', body }));
		expect(test.contact.consent).toBe('subscribed');
		const forged = await respondToMarketingLink(world().deps, new Request('https://news.estori.app/e/u/ms_1.AAAAAAAAAAAAAAAAAAAAAA', { method: 'POST' }));
		expect(forged.status).toBe(404);
	});
});

describe('confirm links', () => {
	const confirmUrl = async (expiresAt: Date) => `https://news.estori.app/e/confirm/${await signMarketingToken(SECRET, 'confirm', ['mc_1', String(Math.floor(expiresAt.getTime() / 1000))])}`;

	it('asks on GET and confirms on POST, once, starting the welcome trigger', async () => {
		const { deps, contact, records, confirmedCount } = world({ consent: 'pending' });
		const url = await confirmUrl(new Date(NOW.getTime() + 60_000));
		expect(await (await respondToMarketingLink(deps, new Request(url))).text()).toContain('Confirm');
		expect(contact.consent).toBe('pending');
		await respondToMarketingLink(deps, new Request(url, { method: 'POST' }));
		await respondToMarketingLink(deps, new Request(url, { method: 'POST' }));
		expect(contact.consent).toBe('subscribed');
		expect(records.map((record) => record.action)).toEqual(['confirmed']);
		expect(confirmedCount()).toBe(1);
	});

	it('shows an expired link with a way back to the store', async () => {
		const { deps, contact } = world({ consent: 'pending' });
		const response = await respondToMarketingLink(deps, new Request(await confirmUrl(new Date(NOW.getTime() - 1000)), { method: 'POST' }));
		expect(await response.text()).toContain('This link has expired');
		expect(contact.consent).toBe('pending');
	});
});
```

`link-actions.test.ts` covers the same rules at the action level:
- a suppressed contact can't resubscribe;
- `onUnsubscribed` runs once;
- a send whose contact was deleted shows `not_found`.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/api/handlers/marketing-links.test.ts worker/services/marketing/link-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Parsing:** one-click is detected by `(await request.formData()).get('List-Unsubscribe') === 'One-Click'`. Wrap it in `try` for empty or other bodies.
  - **Pages:**
    - Like `plainPage`, but with the store's name and accent color, a form whose `action` is the same path, and `noindex`.
    - Text comes from a `LINK_PAGE_COPY` record, for example "You're unsubscribed from Northwind Tea's emails." and "Changed your mind? Subscribe again".
    - The CSP and cache headers are per spec section 16.
  - **`isMarketingLinkRequest`** is true when `url.pathname.startsWith('/e/')` and the hostname is `env.MARKETING_LINK_HOST`, or the main domain (`CUSTOM_DOMAIN`'s host, or `localhost`).
  - **On the main domain,** `/e/` must be checked before `servePublicSite`, and the SPA has no `/e` route.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): confirm and unsubscribe pages on news.estori.app, with rfc 8058 one-click that never redirects`, with the trailer.

### Task 1.9: SES events through EventBridge: deliveries, bounces, complaints and tenant pauses

**Files:**
- Create: `worker/services/marketing/ses-events.ts` and `ses-events.test.ts`
- Create: `worker/services/marketing/__fixtures__/ses-bounce.json`, `ses-complaint.json`, `ses-delivery.json`, and `ses-tenant-status.json` if the spike saw one (Task 1.0; recipients anonymized). If Task 1.0 couldn't record them, write the first three from the documented examples at https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html, wrapped in the EventBridge envelope the test's `envelope()` builds, with `mail.tags` values as arrays.
- Modify: `worker/api/handlers/marketing-links.ts`: `POST /e/ses-events`
- Modify: `worker/services/alerts/platform-alerts.ts`: kinds `marketing-send-rejected`, `marketing-store-paused` and `marketing-platform-hold`, with labels

**Interfaces:**
- **Consumes:** `MarketingSendService` and `MarketingContactService` (1.1).
- **Produces:**
  - `SesEvent`, one of:
    - `{ type: 'delivery'; sendId: string | null; messageId: string; at: Date }`
    - `{ type: 'bounce'; bounceType: 'Permanent' | 'Transient' | 'Undetermined'; subType: string; recipients: string[]; sendId; messageId; at }`
    - `{ type: 'complaint'; recipients: string[]; sendId; messageId; at }`
    - `{ type: 'failure'; reason: string; sendId; messageId; at }`
    - `{ type: 'tenant'; tenant: string; status: 'ENABLED' | 'REINSTATED' | 'DISABLED'; reason: string | null }`
  - `parseSesEvent(body: unknown): SesEvent | null`
  - `eventsKeyMatches(expected: string | undefined, given: string | null): boolean`
  - `SesEventDeps`:
    - `sends: Pick<MarketingSendService, 'byId' | 'byMessageId' | 'markDelivered' | 'markBounced' | 'markComplained' | 'finish' | 'transientBouncesSince'>`;
    - `contacts: Pick<MarketingContactService, 'byId' | 'suppress' | 'setConsent' | 'recordConsent' | 'suppressGlobally'>`;
    - `pauseTenant(tenant, reason): Promise<void>`;
    - `afterBounceOrComplaint(appId): Promise<void>` (thresholds, phase 3);
    - `countEvent(send, field: 'delivered' | 'bounced' | 'complained'): Promise<void>` (a no-op until phase 3);
    - `alert(alert): Promise<void>`;
    - `now()` and `newId()`.
  - `applySesEvent(deps, event): Promise<'applied' | 'ignored'>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/ses-events.test.ts
import { describe, expect, it } from 'vitest';
import { applySesEvent, eventsKeyMatches, parseSesEvent, type SesEventDeps } from './ses-events';
import type { MarketingSendRow } from '../../database/services/MarketingSendService';

// The worker tsconfig has no JSON modules, so fixtures are read as text.
const fixtures = import.meta.glob<string>('./__fixtures__/ses-*.json', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string): unknown => JSON.parse(fixtures[`./__fixtures__/${name}.json`] ?? 'null');
const BOUNCE = fixture('ses-bounce');
const COMPLAINT = fixture('ses-complaint');
const DELIVERY = fixture('ses-delivery');
import type { MarketingContactRow } from '../../database/services/MarketingContactService';

/** EventBridge wraps the SES event in `detail`; `mail.tags` values are arrays. */
function envelope(detail: Record<string, unknown>) {
	return { version: '0', id: 'ev-1', 'detail-type': 'Email Bounced', source: 'aws.ses', account: '123456789012', time: '2026-10-19T12:00:00Z', region: 'us-east-1', resources: [], detail };
}

describe('parsing SES events', () => {
	it('reads a permanent bounce with its send tag, recipients and time', () => {
		const event = parseSesEvent(envelope({ eventType: 'Bounce', mail: { messageId: '0100-abc', tags: { estori_send: ['ms_1'] } }, bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'Ana@Example.test' }], timestamp: '2026-10-19T12:00:01.000Z' } }));
		expect(event).toEqual({ type: 'bounce', bounceType: 'Permanent', subType: 'General', recipients: ['ana@example.test'], sendId: 'ms_1', messageId: '0100-abc', at: new Date('2026-10-19T12:00:01.000Z') });
	});

	it('reads the recorded fixtures', () => {
		expect(parseSesEvent(BOUNCE)?.type).toBe('bounce');
		expect(parseSesEvent(COMPLAINT)?.type).toBe('complaint');
		expect(parseSesEvent(DELIVERY)?.type).toBe('delivery');
	});

	it('ignores other sources and event types it does not handle', () => {
		expect(parseSesEvent({ ...envelope({ eventType: 'Open' }), source: 'aws.ses' })).toBeNull();
		expect(parseSesEvent({ ...envelope({ eventType: 'Bounce' }), source: 'aws.s3' })).toBeNull();
		expect(parseSesEvent('nope')).toBeNull();
	});
});

describe('the events key', () => {
	it('must match exactly, and an unset key matches nothing', () => {
		expect(eventsKeyMatches('k-123', 'k-123')).toBe(true);
		expect(eventsKeyMatches('k-123', 'k-124')).toBe(false);
		expect(eventsKeyMatches('k-123', null)).toBe(false);
		expect(eventsKeyMatches(undefined, '')).toBe(false);
	});
});

function world() {
	const send = { id: 'ms_1', appId: 'app_tea', contactId: 'mc_1', kind: 'campaign', status: 'sent', recipient: 'ana@example.test', deliveredAt: null, bouncedAt: null, bounceType: null, complainedAt: null } as unknown as MarketingSendRow;
	const contact = { id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', consent: 'subscribed', suppressed: null } as MarketingContactRow;
	const log: string[] = [];
	const deps: SesEventDeps = {
		sends: {
			byId: async (id) => (id === 'ms_1' ? send : null),
			byMessageId: async () => null,
			markDelivered: async (_id, at) => {
				if (send.deliveredAt) return false;
				send.deliveredAt = at;
				return true;
			},
			markBounced: async (_id, type, at) => {
				if (send.bounceType === 'Permanent') return false;
				send.bounceType = type;
				send.bouncedAt = at;
				return true;
			},
			markComplained: async (_id, at) => {
				if (send.complainedAt) return false;
				send.complainedAt = at;
				return true;
			},
			finish: async (_id, update) => {
				log.push(`finish ${update.status}`);
			},
			transientBouncesSince: async () => 0,
		},
		contacts: {
			byId: async () => contact,
			suppress: async (_id, reason) => {
				contact.suppressed = reason;
			},
			setConsent: async (_id, consent) => {
				contact.consent = consent;
			},
			recordConsent: async (record) => {
				log.push(`consent ${record.action} ${record.channel}`);
			},
			suppressGlobally: async (email) => {
				log.push(`global ${email}`);
			},
		},
		pauseTenant: async (tenant, reason) => {
			log.push(`pause ${tenant} ${reason}`);
		},
		afterBounceOrComplaint: async (appId) => {
			log.push(`thresholds ${appId}`);
		},
		countEvent: async (_send, field) => {
			log.push(`count ${field}`);
		},
		alert: async (alert) => {
			log.push(`alert ${alert.kind}`);
		},
		now: () => new Date('2026-10-19T12:00:00Z'),
		newId: () => 'mx_1',
	};
	return { deps, send, contact, log };
}

const at = new Date('2026-10-19T12:00:05Z');

describe('applying SES events', () => {
	it('suppresses a permanently bounced contact for the store and everywhere, and keeps the bounce after a late delivery', async () => {
		const { deps, send, contact, log } = world();
		await applySesEvent(deps, { type: 'bounce', bounceType: 'Permanent', subType: 'General', recipients: ['ana@example.test'], sendId: 'ms_1', messageId: 'm', at });
		await applySesEvent(deps, { type: 'delivery', sendId: 'ms_1', messageId: 'm', at: new Date(at.getTime() + 1000) });
		expect(contact.suppressed).toBe('bounce');
		expect(send.bounceType).toBe('Permanent');
		expect(log).toEqual(['consent suppressed bounce', 'global ana@example.test', 'count bounced', 'thresholds app_tea', 'count delivered']);
	});

	it('applies a complaint once: unsubscribed and suppressed, counted and checked once', async () => {
		const { deps, contact, log } = world();
		const complaint = { type: 'complaint' as const, recipients: ['ana@example.test'], sendId: 'ms_1', messageId: 'm', at };
		expect(await applySesEvent(deps, complaint)).toBe('applied');
		expect(await applySesEvent(deps, complaint)).toBe('ignored');
		expect(contact).toMatchObject({ consent: 'unsubscribed', suppressed: 'complaint' });
		expect(log.filter((entry) => entry.startsWith('count'))).toEqual(['count complained']);
	});

	it('suppresses after the third transient bounce in 30 days', async () => {
		const { deps, contact } = world();
		deps.sends.transientBouncesSince = async () => 3;
		await applySesEvent(deps, { type: 'bounce', bounceType: 'Transient', subType: 'MailboxFull', recipients: ['ana@example.test'], sendId: 'ms_1', messageId: 'm', at });
		expect(contact.suppressed).toBe('bounce');
	});

	it("doesn't count a bounce from SES's own suppression list toward the store's rate", async () => {
		const { deps, log } = world();
		await applySesEvent(deps, { type: 'bounce', bounceType: 'Permanent', subType: 'OnAccountSuppressionList', recipients: ['ana@example.test'], sendId: 'ms_1', messageId: 'm', at });
		expect(log).not.toContain('thresholds app_tea');
	});

	it('fails a rejected send with an alert, and pauses the store of a disabled tenant', async () => {
		const { deps, log } = world();
		await applySesEvent(deps, { type: 'failure', reason: 'Rendering failure', sendId: 'ms_1', messageId: 'm', at });
		await applySesEvent(deps, { type: 'tenant', tenant: 'store-app_tea', status: 'DISABLED', reason: 'bounce rate exceeded 15.0%' });
		expect(log).toEqual(['finish failed', 'alert marketing-send-rejected', 'pause store-app_tea bounce rate exceeded 15.0%']);
	});

	it('ignores an event for a send it does not know', async () => {
		const { deps } = world();
		expect(await applySesEvent(deps, { type: 'delivery', sendId: 'ms_unknown', messageId: 'zzz', at })).toBe('ignored');
	});
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/ses-events.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Parsing:**
    - Read `detail.eventType` (`Delivery`, `Bounce`, `Complaint`, `Reject`, `Rendering Failure`), `detail.mail.messageId` and `detail.mail.tags.estori_send?.[0]`.
    - Recipients are lowercased.
    - Tenant events are parsed from the shape in `ses-tenant-status.json`. If the spike recorded none, `parseSesEvent` doesn't produce `tenant`. Instead, the hourly cron calls `GetTenant` for each store with `ses_tenant` set (at most 1 a second) and treats `SendingStatus: DISABLED` the same way. Add `getTenant(name)` to the client then.
  - **The endpoint** (`POST /e/ses-events`):
    1. `eventsKeyMatches(env.SES_EVENTS_KEY, request.headers.get('x-estori-events-key'))`, else 401.
    2. Reject a body over 256 KB, and an `account` that isn't `env.SES_ACCOUNT_ID` (answer 200, ignored).
    3. Parse and apply.
    4. Answer 200, or 500 when D1 throws, so EventBridge retries.
  - **Applying:** consent records use channel `bounce` or `complaint` with action `suppressed` (and `unsubscribed` for complaints). `pauseTenant` finds the store by `ses_tenant`, pauses it with `paused_by = 'estori'`, sends the `marketing-store-paused` alert, and emails the seller through the transactional sender (`sellerMarketingPausedEmail` in `worker/services/email/templates.ts`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): ses events from eventbridge suppress bounced and complaining contacts, fail rejected sends and pause stores ses disables`, with the trailer.

### Task 1.10: Consent at checkout, and every order makes a customer contact

**Files:**
- Modify: `worker/database/services/StoreCheckoutService.ts`: `saveContact(checkoutId, appId, input: { email: string; marketing: boolean; now: Date }): Promise<boolean>`, and `contactOf(checkoutId)`
- Create: `worker/services/marketing/orders.ts` and `orders.test.ts`
- Modify: `worker/services/store-payments/fulfill.ts` and `fulfill.test.ts`: a new dep `recordMarketingOrder(input: { orderId: string; checkoutId: string }): Promise<void>`, called after `queueShopperEmail` on every delivery
- Modify: `worker/services/store-payments/wiring.ts`: `recordStoreOrderDeps` wires it; `returnPageRecordDeps` makes it a no-op, as with the shopper email
- Modify: `worker/services/store-payments/pay-page.ts` and `pay-page-script.test.ts`: the checkbox, and the POST to `/__estori/checkout/contact`
- Modify: `worker/api/handlers/store-platform.ts`: `POST /__estori/checkout/contact`
- Test: `worker/database/services/store-checkout-contact.sql.test.ts`

**Interfaces:**
- **Consumes:** `normalizeEmail`, `fillStoreName` (1.5); `MarketingContactService.recordOrder`, `setConsent` and `recordConsent` (1.1).
- **Produces:**
  - `parseCheckoutContact(body: unknown): { checkoutId: string; email: string; marketing: boolean } | null`
  - `MarketingOrderDeps`:
    - `order(orderId): Promise<StoreOrderView | null>`;
    - `checkoutContact(checkoutId): Promise<{ email: string | null; marketing: boolean } | null>`;
    - `settings(appId): Promise<{ status: 'on' | 'off'; consentText: string; storeName: string } | null>`;
    - `contacts: Pick<MarketingContactService, 'recordOrder' | 'setConsent' | 'recordConsent'>`;
    - `afterOrder(contact: MarketingContactRow, order: StoreOrderView): Promise<void>` (phase 4 triggers, phase 5 attribution);
    - `now()` and `newId()`.
  - `recordMarketingOrder(deps, input: { orderId; checkoutId }): Promise<void>`, which never throws.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/orders.test.ts
import { describe, expect, it } from 'vitest';
import { parseCheckoutContact, recordMarketingOrder, type MarketingOrderDeps } from './orders';
import type { StoreOrderView } from '../store-payments/store';
import type { MarketingContactRow } from '../../database/services/MarketingContactService';

const ORDER = {
	id: 'ord_1', appId: 'app_tea', mode: 'live', totalCents: 4599, customerEmail: 'Ana@Example.test', customerName: 'Ana Ruiz', createdAt: new Date('2026-10-19T12:00:00Z'),
	items: [{ lineNo: 1, productId: 'tea', name: 'Oolong', quantity: 2 }, { lineNo: 2, productId: 'pot', name: 'Teapot', quantity: 1 }],
} as unknown as StoreOrderView;

function world(input: { order?: Partial<StoreOrderView>; contact?: { email: string | null; marketing: boolean } | null; status?: 'on' | 'off'; consent?: 'none' | 'subscribed' | 'unsubscribed'; failRecord?: boolean } = {}) {
	const calls: string[] = [];
	const contact = { id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', consent: input.consent ?? 'none' } as MarketingContactRow;
	const deps: MarketingOrderDeps = {
		order: async () => ({ ...ORDER, ...input.order }),
		checkoutContact: async () => (input.contact === undefined ? { email: 'ana@example.test', marketing: true } : input.contact),
		settings: async () => ({ status: input.status ?? 'on', consentText: 'Email me news and offers from {store}', storeName: 'Northwind Tea' }),
		contacts: {
			recordOrder: async (row) => {
				if (input.failRecord) throw new Error('D1_ERROR');
				calls.push(`order ${row.email} ${row.totalCents} ${row.productIds.join(',')} ${row.firstName} ${row.lastName}`);
				return contact;
			},
			setConsent: async (_id, consent) => {
				calls.push(`consent ${consent}`);
			},
			recordConsent: async (record) => {
				calls.push(`record ${record.action} ${record.channel} ${record.text} ${record.form}`);
			},
		},
		afterOrder: async () => {
			calls.push('after');
		},
		now: () => new Date('2026-10-19T12:00:01Z'),
		newId: () => 'mx_1',
	};
	return { deps, calls };
}

describe('marketing on a recorded order', () => {
	it('records the customer and subscribes them when they ticked the box with the same address', async () => {
		const { deps, calls } = world();
		await recordMarketingOrder(deps, { orderId: 'ord_1', checkoutId: 'chk_1' });
		expect(calls).toEqual([
			'order ana@example.test 4599 tea,pot Ana Ruiz',
			'consent subscribed',
			'record subscribed checkout Email me news and offers from Northwind Tea chk_1',
			'after',
		]);
	});

	it('records the customer without consent when the box was not ticked, or the addresses differ', async () => {
		for (const contact of [{ email: 'ana@example.test', marketing: false }, { email: 'other@example.test', marketing: true }, null]) {
			const { deps, calls } = world({ contact });
			await recordMarketingOrder(deps, { orderId: 'ord_1', checkoutId: 'chk_1' });
			expect(calls).toEqual(['order ana@example.test 4599 tea,pot Ana Ruiz', 'after']);
		}
	});

	it('does not subscribe someone already subscribed again, but still runs the order hooks', async () => {
		const { deps, calls } = world({ consent: 'subscribed' });
		await recordMarketingOrder(deps, { orderId: 'ord_1', checkoutId: 'chk_1' });
		expect(calls).toEqual(['order ana@example.test 4599 tea,pot Ana Ruiz', 'after']);
	});

	it('records customers even with marketing off, but never subscribes them then', async () => {
		const { deps, calls } = world({ status: 'off' });
		await recordMarketingOrder(deps, { orderId: 'ord_1', checkoutId: 'chk_1' });
		expect(calls).toEqual(['order ana@example.test 4599 tea,pot Ana Ruiz', 'after']);
	});

	it('ignores test orders and orders with no email, and never throws', async () => {
		for (const order of [{ mode: 'test' as const }, { customerEmail: null }]) {
			const { deps, calls } = world({ order });
			await recordMarketingOrder(deps, { orderId: 'ord_1', checkoutId: 'chk_1' });
			expect(calls).toEqual([]);
		}
		await expect(recordMarketingOrder(world({ failRecord: true }).deps, { orderId: 'ord_1', checkoutId: 'chk_1' })).resolves.toBeUndefined();
	});
});

describe('the checkout contact request', () => {
	it('takes a checkout id, an email and the checkbox', () => {
		expect(parseCheckoutContact({ checkoutId: 'chk_abc', email: 'ana@example.test', marketing: true })).toEqual({ checkoutId: 'chk_abc', email: 'ana@example.test', marketing: true });
		expect(parseCheckoutContact({ checkoutId: 'chk_abc', email: 'ana@example.test' })).toEqual({ checkoutId: 'chk_abc', email: 'ana@example.test', marketing: false });
		for (const bad of [null, {}, { checkoutId: 'nope', email: 'ana@example.test' }, { checkoutId: 'chk_abc', email: 'x' }]) expect(parseCheckoutContact(bad)).toBeNull();
	});
});
```

`store-checkout-contact.sql.test.ts` (seeded with `insertCheckout`) checks that `saveContact`:
- writes the normalized email, the consent and the time for an `open` checkout of the same app;
- refuses another app's checkout and a `completed` one (false);
- refuses the 21st update.

`fulfill.test.ts` gains: `recordMarketingOrder` is called with `{ orderId, checkoutId }` after the shopper email on `recorded` and on `already-recorded`, and not on `not-paid`.

`pay-page-script.test.ts` gains:
- With `info.marketing.checkoutConsent` true, the page has `<input type="checkbox" id="marketing"` without `checked`, labelled with the store's text.
- The script POSTs `{ checkoutId, email, marketing }` to `basePath + '/__estori/checkout/contact'` on the email field's change and before `confirm()`.
- Without marketing, there is no checkbox.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/orders.test.ts worker/services/store-payments/fulfill.test.ts worker/services/store-payments/pay-page-script.test.ts worker/database/services/store-checkout-contact.sql.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`recordMarketingOrder`:**
    - Names split the order's `customerName` on its first space.
    - The consent applies only when `settings.status === 'on'`, `checkoutContact.marketing` is true, `normalizeEmail(checkoutContact.email) === normalizeEmail(order.customerEmail)`, and `nextConsent(contact.consent, 'checkout_optin')` is not null.
    - The whole body sits in `try`/`catch` with `logger.error`.
  - **The pay page:** the checkbox's label is escaped. The POST failure is ignored (`.catch(function () {})`), and checkout never waits on it.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): an unticked consent box on the checkout page, and every live order adds its shopper to the store's customer list`, with the trailer.

### Task 1.11: The contacts API

**Files:**
- Create: `worker/api/controllers/marketing/contactsController.ts`, `contact-request.ts`, `contacts.sql.test.ts`
- Modify: `worker/api/routes/marketingRoutes.ts`

**Interfaces:**
- **Consumes:** Task 1.1's services, `normalizeEmail` and `nextConsent` (1.5), `getMarketingConfig` (1.6).
- **Produces:** the routes in spec section 24 marked phase 1 for contacts. They answer `MarketingContactsPage`, `MarketingContactDetail` and `text/csv`.

- [ ] **Step 1: Write the failing real-SQL controller tests** (`contacts.sql.test.ts`), seeded as in Task 1.1:
  - **Listing:** `GET` lists 50 contacts with `nextCursor` and counts. `consent=suppressed` lists only suppressed contacts. Emails are shown whole, because the store's owner may see their customers.
  - **Adding:** `POST { email, firstName, attest: true }` adds a `subscribed` contact with source `seller` and an `added` record carrying the attestation text. It answers 400 without `attest`, and 409 for an address that unsubscribed ("They unsubscribed. Only they can subscribe again."). It answers 402 past the plan's contact limit ("Your plan holds 250 subscribers. ...").
  - **Updating:** `PATCH { tags: ['VIP', 'vip', ''] }` stores `['vip']`, trimmed, lowercased, deduplicated, 20 at most, 40 characters each. `PATCH { consent: 'unsubscribed' }` unsubscribes with channel `seller`. `PATCH { blocked: true }` suppresses with `seller`.
  - **Deleting:** `DELETE` removes the contact.
  - **Detail:** `GET /contacts/:id` includes the consent history, newest first.
  - **Export:** `GET /contacts.csv` answers `email,first_name,last_name,consent,suppressed,source,tags,orders,total_spent,subscribed_at`, with values starting `=`, `+`, `-` or `@` prefixed with `'`, against CSV injection.
  - **Access:** another user's store answers 404, through the owner check.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement with the services, following `ShopperEmailsController`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): sellers list, add with attestation, tag, unsubscribe, block, delete and export their store's contacts`, with the trailer.

### Task 1.12: The Emails page gains Subscribers and Settings tabs

**Files:**
- Modify: `src/api-types.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts` (`account.marketing.*`), `src/routes.tsx` (routes `emails/subscribers` and `emails/settings`, both inside the protected layout)
- Create: `src/hooks/use-marketing.ts`
- Create: `src/routes/emails/email-tabs.tsx`, `src/routes/emails/subscribers.tsx`, `src/routes/emails/contact-drawer.tsx`, `src/routes/emails/marketing-settings.tsx`, `src/routes/emails/marketing-format.ts` and `marketing-format.test.ts`, and `src/routes/emails/marketing-guard.test.ts`
- Modify: `src/routes/emails/emails.tsx`: tabs; the note per spec section 25

**Interfaces:**
- **Consumes:** the API from Tasks 1.6 and 1.11.
- **Produces, from `use-marketing.ts`:** `useMarketingStores`, `useMarketingSettings(appId)`, `useSaveMarketingSettings`, `useMarketingStatus`, `useMarketingPause`, `useMarketingContacts(appId, query)`, `useMarketingContact`, `useAddContact`, `useUpdateContact` and `useDeleteContact`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/routes/emails/marketing-guard.test.ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const files = import.meta.glob<string>(['/src/routes/emails/*.tsx', '/src/routes.tsx'], { query: '?raw', import: 'default', eager: true });
const source = (path: string) => files[path] ?? '';

describe('the Emails page with marketing', () => {
	it('has tabs for order emails, subscribers and settings, linking with MARKETING_PATHS', () => {
		const tabs = source('/src/routes/emails/email-tabs.tsx');
		for (const label of ['Order emails', 'Subscribers', 'Settings']) expect(tabs).toContain(label);
		expect(tabs).toContain('MARKETING_PATHS.subscribers');
		expect(tabs).toContain('SHOPPER_EMAILS_PATH');
	});

	it('routes the new tabs inside the signed-in layout', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'emails\/subscribers'/);
		expect(source('/src/routes.tsx')).toMatch(/path: 'emails\/settings'/);
	});

	it('no longer says marketing email is impossible, and explains who gets which email', () => {
		expect(source('/src/routes/emails/emails.tsx')).not.toContain("doesn't allow marketing email");
		expect(source('/src/routes/emails/emails.tsx')).toContain('Marketing emails go only to your subscribers.');
	});

	it('asks for the attestation before adding a contact, and the rules before turning marketing on', () => {
		expect(source('/src/routes/emails/subscribers.tsx')).toContain('asked to get emails from');
		expect(source('/src/routes/emails/marketing-settings.tsx')).toContain('Email only people who asked for your emails');
		expect(source('/src/routes/emails/marketing-settings.tsx')).toContain('Postal address');
	});

	it('names no supplier or AI assistant', () => {
		for (const [path, text] of Object.entries(files)) {
			if (!path.includes('/emails/')) continue;
			const lower = text.toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(lower, `${path} names ${name}`).not.toContain(name);
		}
	});
});
```

`marketing-format.test.ts` covers:
- consent labels ("Subscribed", "Waiting to confirm", "Unsubscribed", "Customer, not subscribed");
- suppression labels ("Bounced", "Marked as spam", "Blocked by you");
- source labels;
- the usage line "120 of 250 subscribers";
- the pause banner text for each pauser.

- [ ] **Step 2:** Run `rtk proxy npx vitest run src/routes/emails`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 25.
  - Reuse the existing store picker by lifting it from `emails.tsx` into `email-tabs.tsx`.
  - Use Kumo components, as `emails.tsx` does.
  - The time zone select lists `MARKETING_TIME_ZONES`.
  - The send window uses two hour selects. The frequency cap uses "at most [n] emails every [d] days" or "No cap".
- [ ] **Step 4:** Run `rtk proxy npx vitest run src/routes/emails`, then `bun run typecheck`. Expected: PASS, and 0 errors.
- [ ] **Step 5: Commit** `feat(marketing): subscribers and settings tabs on the emails page`, with the trailer.

### Task 1.13: The build agent learns sign-up forms

**Files:**
- Create: `worker/agents/think/skills/store-email-signup/SKILL.md`
- Modify: `worker/agents/think/skills.ts` (register `store-email-signup`)
- Create: `worker/agents/think/store-email-signup-skill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// worker/agents/think/store-email-signup-skill.test.ts
import { describe, expect, it } from 'vitest';
import SKILL from './skills/store-email-signup/SKILL.md?raw';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../../../src/routes/copy-rules';

const skills = import.meta.glob<string>('/worker/agents/think/skills.ts', { query: '?raw', import: 'default', eager: true });

describe('the store email sign-up skill', () => {
	it('is registered with the agent and has frontmatter', () => {
		expect(Object.values(skills)[0]).toContain("'store-email-signup': STORE_EMAIL_SIGNUP");
		expect(SKILL).toMatch(/^---\nname: store-email-signup\ndescription: .+\n---/);
	});
	it('teaches Estori.subscribe, every refusal, the inbox message and hiding the form when sign-ups are off', () => {
		expect(SKILL).toContain('Estori.subscribe(');
		for (const reason of ['invalid_email', 'unavailable', 'challenge_failed', 'too_many', 'preview']) expect(SKILL).toContain(reason);
		expect(SKILL).toContain('Check your inbox to confirm');
		expect(SKILL).toContain('Estori.store()');
		expect(SKILL).toContain('marketing.signup');
	});
	it('requires visible consent wording and a privacy link, never a pre-ticked box, and polite pop-ups', () => {
		expect(SKILL).toContain('consentText');
		expect(SKILL).toMatch(/privacy/i);
		expect(SKILL).toMatch(/never pre-tick/i);
		expect(SKILL).toContain('14 days');
	});
	it('teaches code that parses as a classic script, and names no supplier or assistant', () => {
		const example = SKILL.match(/```js\n([\s\S]+?)\n```/)?.[1] ?? '';
		expect(() => new Function(example)).not.toThrow();
		const lower = SKILL.toLowerCase();
		for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(lower).not.toContain(name);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the skill per spec section 8.5, with one complete `js` example: a footer form with the consent text, the privacy link, a success message and an error message.
- [ ] **Step 4:** Run it, and `worker/agents/think/store-checkout-skill.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): the store builder learns sign-up forms and pop-ups that use estori.subscribe`, with the trailer.

### Task 1.14: Legal text, configuration, an end-to-end check and the PR

**Files:**
- Modify: `src/content/legal/privacy.md` and `terms.md` per spec section 23; `shared/types/legal.ts` (`TERMS_VERSION` becomes the commit date); `src/content/legal/legal-documents.test.ts` (new checks)
- Modify: `wrangler.estori.jsonc` and `wrangler.estori-staging.jsonc`:
  - variables `SES_REGION` (`us-east-1` / `us-east-2`), `SES_CONFIGURATION_SET`, `SES_USE_TENANTS` (per Task 1.0) and `TURNSTILE_SITE_KEY`;
  - `SES_ACCOUNT_ID` only after the owner gives it. It isn't secret; until then, the events endpoint ignores every account.

- [ ] **Step 1: Write the failing legal test additions:**
  - the privacy policy names "Amazon Web Services" among the service providers, and mentions "unsubscribe", "Turnstile" and "180 days";
  - the terms have an "Email to your customers" subsection that names CAN-SPAM and forbids bought lists;
  - `TERMS_VERSION` isn't `2026-10-16`.
- [ ] **Step 2:** Run `rtk proxy npx vitest run src/content/legal`. Expected: FAIL.
- [ ] **Step 3:** Write the text, flagged in the PR as needing the owner's legal review.
- [ ] **Step 4:** Run the legal tests. Expected: PASS.
- [ ] **Step 5: End to end on localhost**, by eye, with the dev-log sender:
  1. Apply 0029 (`CI=true npx wrangler d1 migrations apply vibesdk-db --local`).
  2. As the local creator, turn marketing on for a live store at `*.stores.localhost:8100`.
  3. Add a footer form by asking the build agent.
  4. Sign up as a shopper.
  5. Find "confirm" in the dev log and open it; Confirm.
  6. See the subscriber in the Subscribers tab with its consent history.
  7. Pay a test order with the box ticked. Test orders don't subscribe anyone (Task 1.10), so check that the contact is not created. Then repeat with `mode = 'live'` forced in a local `store_checkouts` row, and see the contact become subscribed with channel `checkout`.
  
  Phase 1 sends no marketing email yet, so the unsubscribe page is covered by the handler tests (Task 1.8). It is checked by eye in Task 2.8, with a test send.
- [ ] **Step 6:** Run the CI steps: `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check` and `bun run test`.
- [ ] **Step 7: Commit, push and open the PR.**
  - **Commit:** `docs(legal): privacy and terms cover marketing email, subscribers and amazon web services`, with the trailer.
  - **Push** `feat/marketing-foundation`.
  - **The PR:** `gh pr create --repo alastrat/vibesdk --base main --title "feat(marketing): ses foundation, subscribers, sign-up forms, consent and unsubscribe"`.
    - The body lists what ships, the owner setup steps from spec section 26 that phase 1 needs (1–7, 9, 10 and 12), and the legal review.
    - It ends with: Generated with [Claude Code](https://claude.com/claude-code)

---
## Phase 2: Templates and the editor

Branch `feat/marketing-templates` from `feat/marketing-foundation`. Migration `0030_marketing_templates`. The PR delivers documents, the renderer, starter and saved templates, the editor with preview and test sends, and writing by asking, all in a Templates tab.

### Task 2.1: The email document and its checks

**Files:**
- Create: `shared/types/marketing-documents.ts`
- Create: `worker/services/email/placeholders.ts` and `placeholders.test.ts`. They extract the placeholder pattern from `worker/services/shopper-emails/template.ts`, which then imports it (DRY), and `template.test.ts` must still pass.
- Create: `worker/services/marketing/render/document.ts` and `document.test.ts`

**Interfaces:**
- **Produces, shared:**
  - `EMAIL_BLOCK_TYPES` / `EmailBlockType`
  - `EmailAlign = 'left' | 'center'`
  - `SOCIAL_NETWORKS` / `SocialNetwork`
  - `EmailBlock`, the union in spec section 10.1
  - `EmailDocument { version: 1; subject; preheader; blocks }`
  - `EMAIL_DOCUMENT_LIMITS = { subject: 150, preheader: 150, blocks: 40, heading: 120, heroText: 600, markdown: 5000, label: 40, alt: 200, url: 2048, products: 6, social: 6 }`
  - `EMAIL_PLACEHOLDERS = ['first_name', 'store_name']`
  - `EmailDocumentKind = 'campaign' | 'welcome' | 'abandoned_cart' | 'thank_you' | 'win_back' | 'back_in_stock'`
  - `BLOCKS_FOR_KIND: Readonly<Record<EmailDocumentKind, readonly EmailBlockType[]>>`, where `cart` appears only for `abandoned_cart` and `order` only for `thank_you`
  - `EMAIL_BLOCK_LABELS`
- **Produces, `placeholders.ts`:**
  - `PLACEHOLDER_PATTERN`
  - `placeholderNames(text): string[]`
  - `hasUnclosedPlaceholder(text): boolean`
  - `fillPlaceholders(text, values)`, moved here from the shopper template
- **Produces, `document.ts`:**
  - `parseEmailDocument(value: unknown): EmailDocument | null` (structure and types only)
  - `isAllowedUrl(url: string, options: { mailto: boolean; localHttp: boolean }): boolean`
  - `isStorePath(url: string): boolean`
  - `documentProblem(document: EmailDocument, context: { kind: EmailDocumentKind; productIds: ReadonlySet<string>; localHttp: boolean }): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/render/document.test.ts
import { describe, expect, it } from 'vitest';
import { documentProblem, isAllowedUrl, parseEmailDocument } from './document';
import type { EmailDocument } from '../../../../shared/types/marketing-documents';

const DOC: EmailDocument = {
	version: 1,
	subject: 'New teas for {{first_name}}',
	preheader: 'Three new blends from {{store_name}}',
	blocks: [
		{ type: 'header', showLogo: true, align: 'center' },
		{ type: 'text', markdown: 'Hi {{ first_name }},\n\nOur **autumn** teas are in. [See them](/collections/autumn).', align: 'left' },
		{ type: 'products', productIds: ['oolong', 'sencha'], columns: 2, showPrice: true, buttonLabel: 'Shop' },
		{ type: 'button', label: 'Visit the store', url: 'https://northwind-tea.estori.shop/', align: 'center' },
	],
};
const CONTEXT = { kind: 'campaign' as const, productIds: new Set(['oolong', 'sencha']), localHttp: false };

describe('URLs in emails', () => {
	it('allows https, store paths, and mailto only where asked', () => {
		expect(isAllowedUrl('https://example.test/a?b=c', { mailto: false, localHttp: false })).toBe(true);
		expect(isAllowedUrl('/collections/tea', { mailto: false, localHttp: false })).toBe(true);
		expect(isAllowedUrl('mailto:hello@northwind.test', { mailto: true, localHttp: false })).toBe(true);
		expect(isAllowedUrl('mailto:hello@northwind.test', { mailto: false, localHttp: false })).toBe(false);
	});
	it('refuses scripts, data, protocol-relative, spaces, http outside this machine, and long links', () => {
		for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.test/x', 'https://a b.test', 'http://example.test', `https://example.test/${'a'.repeat(2048)}`, 'https://example.test/\u0000']) {
			expect(isAllowedUrl(url, { mailto: true, localHttp: false }), url).toBe(false);
		}
		expect(isAllowedUrl('http://northwind-tea.stores.localhost:8100/', { mailto: false, localHttp: true })).toBe(true);
	});
});

describe('email documents', () => {
	it('accepts a sound document', () => {
		expect(parseEmailDocument(DOC)).toEqual(DOC);
		expect(documentProblem(DOC, CONTEXT)).toBeNull();
	});

	it('refuses unknown blocks and fields of the wrong type while parsing', () => {
		expect(parseEmailDocument({ ...DOC, blocks: [{ type: 'html', html: '<script>' }] })).toBeNull();
		expect(parseEmailDocument({ ...DOC, blocks: [{ type: 'divider', extra: 1 }] })).toBeNull();
		expect(parseEmailDocument({ ...DOC, version: 2 })).toBeNull();
	});

	it('names the block and the problem', () => {
		const withBlock = (block: EmailDocument['blocks'][number]) => ({ ...DOC, blocks: [...DOC.blocks, block] });
		expect(documentProblem({ ...DOC, subject: '' }, CONTEXT)).toBe('Add a subject.');
		expect(documentProblem({ ...DOC, subject: 'Hello\nBcc: x@y.test' }, CONTEXT)).toBe('The subject must be one line.');
		expect(documentProblem({ ...DOC, subject: 'Hi {{last_name}}' }, CONTEXT)).toBe("{{last_name}} isn't a placeholder you can use. Use {{first_name}} or {{store_name}}.");
		expect(documentProblem(withBlock({ type: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' }), CONTEXT)).toBe('Block 5 (Button): the link must start with https://, or be a path on your store like /collections/tea.');
		expect(documentProblem(withBlock({ type: 'products', productIds: ['gone'], columns: 1, showPrice: true, buttonLabel: 'Shop' }), CONTEXT)).toBe("Block 5 (Products): \"gone\" isn't a product in your live store.");
		expect(documentProblem(withBlock({ type: 'cart', buttonLabel: 'Back to your cart' }), CONTEXT)).toBe("Block 5 (Cart): this block only works in the abandoned cart email.");
		expect(documentProblem(withBlock({ type: 'text', markdown: 'An **unclosed bold', align: 'left' }), CONTEXT)).toBe('Block 5 (Text): close the ** you opened.');
		expect(documentProblem({ ...DOC, blocks: [] }, CONTEXT)).toBe('Add at least one block.');
	});
});
```

`placeholders.test.ts` covers:
- names with spaces inside the braces;
- an unclosed `{{`;
- `fillPlaceholders` leaving unknown names as they are.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/render/document.test.ts worker/services/email/placeholders.test.ts worker/services/shopper-emails/template.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`isAllowedUrl`:**
    1. trim;
    2. refuse any character with code below 33 (no control-character regex, which ESLint's `no-control-regex` forbids; loop over the characters as `hasControl` does in `template.ts`);
    3. refuse a length over 2048;
    4. allow a path (`/` but not `//`);
    5. otherwise `new URL(url)` must succeed, with protocol `https:`, `mailto:` (when allowed) or `http:` with a host that is `localhost` or ends in `.localhost` (when `localHttp`).
  - **`documentProblem` checks in this order:**
    1. the subject;
    2. the preheader;
    3. placeholders in the subject and preheader;
    4. block count;
    5. each block in order: limits, text placeholders, rich-text problems (Task 2.2's `richTextProblem`), URLs, products in `productIds`, and the block allowed for the kind.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): email documents of blocks, with url, placeholder and product checks that name the block`, with the trailer.

### Task 2.2: Rich text without HTML

**Files:**
- Create: `worker/services/marketing/render/rich-text.ts` and `rich-text.test.ts`

**Interfaces:**
- **Produces:**
  - `RichInline = { text: string; bold: boolean; italic: boolean; url: string | null }`
  - `RichBlock = { kind: 'paragraph'; lines: RichInline[][] } | { kind: 'list'; items: RichInline[][] }`
  - `parseRichText(markdown: string): RichBlock[]`
  - `richTextProblem(markdown: string): string | null`
  - `richTextHtml(blocks: RichBlock[], options: { color: string; linkColor: string; link: (url: string) => string; resolve: (url: string) => string }): string`
  - `richTextPlain(blocks: RichBlock[], resolve: (url: string) => string): string`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/render/rich-text.test.ts
import { describe, expect, it } from 'vitest';
import { parseRichText, richTextHtml, richTextPlain, richTextProblem } from './rich-text';

const OPTIONS = { color: '#1f2a24', linkColor: '#2f6b4f', link: (url: string) => url, resolve: (url: string) => (url.startsWith('/') ? `https://tea.test${url}` : url) };

describe('rich text', () => {
	it('splits paragraphs on blank lines, keeps line breaks, and reads bold, italic and links', () => {
		expect(parseRichText('Hello **bold** and _it_\nnext line\n\n[Shop](/tea)')).toEqual([
			{ kind: 'paragraph', lines: [[{ text: 'Hello ', bold: false, italic: false, url: null }, { text: 'bold', bold: true, italic: false, url: null }, { text: ' and ', bold: false, italic: false, url: null }, { text: 'it', bold: false, italic: true, url: null }], [{ text: 'next line', bold: false, italic: false, url: null }]] },
			{ kind: 'paragraph', lines: [[{ text: 'Shop', bold: false, italic: false, url: '/tea' }]] },
		]);
	});

	it('makes a list from a paragraph whose lines all start with "- "', () => {
		expect(parseRichText('- one\n- **two**')).toEqual([{ kind: 'list', items: [[{ text: 'one', bold: false, italic: false, url: null }], [{ text: 'two', bold: true, italic: false, url: null }]] }]);
	});

	it('escapes everything a seller typed, so HTML is shown, never run', () => {
		const html = richTextHtml(parseRichText('<script>alert(1)</script> & "quotes"'), OPTIONS);
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
		expect(html).not.toContain('<script>');
	});

	it('renders links through the link function, resolved, with inline styles, and a plain version with the URL written out', () => {
		const blocks = parseRichText('See [our teas](/tea).');
		expect(richTextHtml(blocks, { ...OPTIONS, link: (url) => `${url}#tracked` })).toContain('<a href="https://tea.test/tea#tracked" style="color:#2f6b4f;');
		expect(richTextPlain(blocks, OPTIONS.resolve)).toBe('See our teas (https://tea.test/tea).');
	});

	it('names the first problem: an unclosed mark or a link with a bad address', () => {
		expect(richTextProblem('**bold')).toBe('close the ** you opened.');
		expect(richTextProblem('_it')).toBe('close the _ you opened.');
		expect(richTextProblem('[x](javascript:alert(1))')).toBe('the link "x" must start with https://, or be a path on your store.');
		expect(richTextProblem('fine **text** [ok](https://a.test) and mailto [mail](mailto:a@b.test)')).toBeNull();
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** a small tokenizer: scan for `**`, `_` (only at word boundaries, so `snake_case` stays text) and `[label](url)`; anything else is text. Escape with `escapeHtml` from `worker/utils/html.ts`. Links use `isAllowedUrl(url, { mailto: true, localHttp })` from Task 2.1. A link that fails at render time is shown as its label only (a defense in depth; saving already refused it).
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): rich text from a small markdown subset, escaped, with links passed through tracking`, with the trailer.

### Task 2.3: The block renderer, the theme and the locked footer

**Files:**
- Create: `worker/services/marketing/render/theme.ts`, `render.ts` and `render.test.ts`

**Interfaces:**
- **Consumes:** Tasks 2.1 and 2.2; `StoreBrand` from `shared/types/store-payments.ts`.
- **Produces:**
  - `EmailTheme { background; surface; text; accent; accentText; font: string | null; corners: 'square' | 'rounded' | 'pill' }`
  - `NEUTRAL_THEME`
  - `themeFrom(brand: StoreBrand | null, overrides: Partial<EmailTheme> | null): EmailTheme`
  - `RenderProduct { id; name; imageUrl: string | null; priceCents: number | null; url: string }`
  - `CartLine { name; quantity; unitPriceCents; imageUrl: string | null }`
  - `RenderContext`:
    - `store: { name; url; logoUrl: string | null; postalAddress }`;
    - `theme`;
    - `products: ReadonlyMap<string, RenderProduct>`;
    - `recipient: { firstName: string | null }`;
    - `reason: string`;
    - `unsubscribeUrl: string`;
    - `link(url: string, index: number): string`;
    - `openPixelUrl: string | null`;
    - `cart: { lines: CartLine[]; url: string } | null`;
    - `order: { lines: CartLine[]; totalCents: number } | null`;
    - `localHttp: boolean`.
  - `RenderedEmail { subject; preheader; html; text; links: string[] }`
  - `renderEmailDocument(document: EmailDocument, context: RenderContext): RenderedEmail`
  - `footerReason(source: MarketingContactSource, storeName: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/render/render.test.ts
import { describe, expect, it } from 'vitest';
import { footerReason, renderEmailDocument, type RenderContext } from './render';
import { NEUTRAL_THEME, themeFrom } from './theme';
import type { EmailDocument } from '../../../../shared/types/marketing-documents';

const CONTEXT: RenderContext = {
	store: { name: 'Northwind <Tea>', url: 'https://northwind-tea.estori.shop', logoUrl: 'https://northwind-tea.estori.shop/logo.png', postalAddress: '1 Main St, Austin, TX 78701' },
	theme: themeFrom({ name: 'Northwind Tea', colors: { background: '#f6f1e7', surface: '#ffffff', text: '#1f2a24', accent: '#2f6b4f', accentText: '#ffffff' }, font: 'Fraunces', corners: 'rounded' }, null),
	products: new Map([
		['oolong', { id: 'oolong', name: 'Oolong', imageUrl: 'https://northwind-tea.estori.shop/img/oolong.jpg', priceCents: 2400, url: 'https://northwind-tea.estori.shop/products/oolong' }],
		['sencha', { id: 'sencha', name: 'Sencha', imageUrl: null, priceCents: 1800, url: 'https://northwind-tea.estori.shop/products/sencha' }],
	]),
	recipient: { firstName: 'Ana' },
	reason: footerReason('form', 'Northwind <Tea>'),
	unsubscribeUrl: 'https://news.estori.app/e/u/ms_1.mac',
	link: (url, index) => `${url}#${index}`,
	openPixelUrl: null,
	cart: null,
	order: null,
	localHttp: false,
};

const DOC: EmailDocument = {
	version: 1,
	subject: 'Hi {{first_name}}, new teas',
	preheader: 'From {{store_name}}',
	blocks: [
		{ type: 'header', showLogo: true, align: 'center' },
		{ type: 'hero', imageUrl: 'https://northwind-tea.estori.shop/img/hero.jpg', alt: 'Autumn', heading: 'Autumn is <here>', text: 'Fresh **leaves**.', button: { label: 'Shop now', url: '/collections/autumn' } },
		{ type: 'products', productIds: ['oolong', 'missing', 'sencha'], columns: 2, showPrice: true, buttonLabel: 'Buy' },
		{ type: 'social', links: [{ network: 'instagram', url: 'https://instagram.com/northwind' }] },
	],
};

describe('rendering an email document', () => {
	const email = renderEmailDocument(DOC, CONTEXT);

	it('fills placeholders in the subject and preheader, and hides the preheader in the body', () => {
		expect(email.subject).toBe('Hi Ana, new teas');
		expect(email.preheader).toBe('From Northwind <Tea>');
		expect(email.html).toMatch(/<div style="display:none;[^"]*">From Northwind &lt;Tea&gt;/);
	});

	it('is a 600px table layout with inline styles and no seller markup', () => {
		expect(email.html).toContain('<table role="presentation"');
		expect(email.html).toContain('max-width:600px');
		expect(email.html).toContain('Autumn is &lt;here&gt;');
		expect(email.html).not.toMatch(/<script|onerror=|javascript:/i);
	});

	it('draws a bulletproof button in the accent color, linking the resolved address through tracking', () => {
		expect(email.html).toContain('href="https://northwind-tea.estori.shop/collections/autumn#1"');
		expect(email.html).toMatch(/background:#2f6b4f;[^"]*color:#ffffff/);
	});

	it("shows only products the store still has, with today's prices", () => {
		expect(email.html).toContain('Oolong');
		expect(email.html).toContain('$24.00');
		expect(email.html).toContain('Sencha');
		expect(email.html).not.toContain('missing');
	});

	it('lists every tracked link in order, without the unsubscribe link', () => {
		expect(email.links).toEqual([
			'https://northwind-tea.estori.shop/',
			'https://northwind-tea.estori.shop/collections/autumn',
			'https://northwind-tea.estori.shop/products/oolong',
			'https://northwind-tea.estori.shop/products/sencha',
			'https://instagram.com/northwind',
		]);
		expect(email.links).not.toContain(CONTEXT.unsubscribeUrl);
	});

	it('ends with the locked footer: the store, its postal address, why, Unsubscribe, and Sent with Estori', () => {
		const footer = email.html.slice(email.html.lastIndexOf('1 Main St') - 400);
		expect(footer).toContain('Northwind &lt;Tea&gt;');
		expect(footer).toContain('1 Main St, Austin, TX 78701');
		expect(footer).toContain("You're getting this email because you subscribed to Northwind &lt;Tea&gt;.");
		expect(footer).toContain(`<a href="${CONTEXT.unsubscribeUrl}"`);
		expect(footer).toContain('Sent with Estori.');
		expect(renderEmailDocument({ ...DOC, blocks: [{ type: 'divider' }] }, CONTEXT).html).toContain('1 Main St, Austin, TX 78701');
	});

	it('writes a text version with the same words and links', () => {
		expect(email.text).toContain('Autumn is <here>');
		expect(email.text).toContain('Shop now: https://northwind-tea.estori.shop/collections/autumn');
		expect(email.text).toContain('Oolong, $24.00: https://northwind-tea.estori.shop/products/oolong');
		expect(email.text).toContain(`Unsubscribe: ${CONTEXT.unsubscribeUrl}`);
		expect(email.text).toContain('1 Main St, Austin, TX 78701');
	});

	it('greets "there" without a first name, and adds the open pixel only when given', () => {
		expect(renderEmailDocument(DOC, { ...CONTEXT, recipient: { firstName: null } }).subject).toBe('Hi there, new teas');
		expect(email.html).not.toContain('<img src="https://news.estori.app/e/o/');
		expect(renderEmailDocument(DOC, { ...CONTEXT, openPixelUrl: 'https://news.estori.app/e/o/ms_1.mac' }).html).toContain('<img src="https://news.estori.app/e/o/ms_1.mac" width="1" height="1" alt=""');
	});
});

describe('themes and footers', () => {
	it("falls back to Estori's neutral theme, and applies the seller's overrides", () => {
		expect(themeFrom(null, null)).toEqual(NEUTRAL_THEME);
		expect(themeFrom(null, { accent: '#aa0000' }).accent).toBe('#aa0000');
	});
	it('says why a checkout subscriber gets the email', () => {
		expect(footerReason('checkout', 'Tea')).toBe("You're getting this email because you asked for news when you ordered from Tea.");
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 10.2.
  - **Layout:**
    - An outer table with background `theme.background`; an inner table at `width="600"` and `style="max-width:600px;width:100%;background:{surface}"`.
    - One `<style>` in the head: `@media (max-width:480px){ .estori-col{display:block!important;width:100%!important} }`. Product cells get `class="estori-col"`.
    - Fonts: when `theme.font` is set, `<link href="https://fonts.googleapis.com/css2?family={encoded}&display=swap" rel="stylesheet">`, plus `font-family:'{font}',Helvetica,Arial,sans-serif` inline.
    - Buttons: a table cell with the accent background and `border-radius` from `corners` (0, 6px or 999px), holding an `<a>` with the same colors.
  - **Links:** store paths resolve against `store.url`. The header logo links to `store.url + '/'`. Each link is collected into `links` in order, then rendered through `context.link(url, index)`. A product card's image, name and button share one link and one index, so `links` holds each product once.
  - **Text version:** heading lines, paragraphs, `Label: url` for buttons, `Name, $price: url` for products, then the footer and `Unsubscribe: {url}`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): email-safe html and text from documents, in the store's brand, ending in a footer sellers can't remove`, with the trailer.

### Task 2.4: The live store's products and brand for emails

**Files:**
- Create: `worker/services/marketing/store-context.ts` and `store-context.test.ts`

**Interfaces:**
- **Consumes:** `parseStoreManifest` (`worker/services/store-payments/manifest.ts`), `storeUrl` and `devPortOf` (`worker/services/live-stores/view.ts`), `storeHostConfig` (`live-stores/hosts.ts`), the `getStoreManifest` stub method (as `store-platform.ts` uses it) with `LIVE_BRANCH`.
- **Produces:**
  - `MarketingStoreContext { appId; name; url; slug; products: RenderProduct[]; brand: StoreBrand | null; logoUrl: string | null }`
  - `renderProductsOf(manifest: StoreManifest, storeUrl: string, productPath: string): RenderProduct[]`
  - `productUrl(storeUrl: string, productPath: string, productId: string): string`
  - `absoluteImage(storeUrl: string, image: string | undefined): string | null`
  - `loadMarketingStoreContext(env: Env, appId: string): Promise<MarketingStoreContext | null>`, which is null when the store isn't live or its manifest isn't valid

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/store-context.test.ts
import { describe, expect, it } from 'vitest';
import { absoluteImage, productUrl, renderProductsOf } from './store-context';
import type { StoreManifest } from '../../../shared/types/store-payments';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 600 },
	products: [
		{ id: 'oolong', name: 'Oolong', image: '/img/oolong.jpg', variants: [{ id: 'o-100', name: '100 g', priceCents: 2400 }, { id: 'o-50', name: '50 g', priceCents: 1400 }] },
		{ id: 'mug', name: 'Mug', image: 'https://cdn.test/mug.jpg', variants: [{ id: 'm-1', name: 'Blue', priceCents: 1800, available: false }] },
	],
};

describe('store products for emails', () => {
	it('uses the lowest available price, absolute images, and the product path', () => {
		expect(renderProductsOf(MANIFEST, 'https://tea.estori.shop', '/products/{id}')).toEqual([
			{ id: 'oolong', name: 'Oolong', imageUrl: 'https://tea.estori.shop/img/oolong.jpg', priceCents: 1400, url: 'https://tea.estori.shop/products/oolong' },
			{ id: 'mug', name: 'Mug', imageUrl: 'https://cdn.test/mug.jpg', priceCents: null, url: 'https://tea.estori.shop/products/mug' },
		]);
	});
	it('links to the store home when the path has no {id}, and encodes ids', () => {
		expect(productUrl('https://tea.estori.shop', '/', 'oolong')).toBe('https://tea.estori.shop/');
		expect(productUrl('https://tea.estori.shop', '/p/{id}', 'a b')).toBe('https://tea.estori.shop/p/a%20b');
		expect(absoluteImage('https://tea.estori.shop', undefined)).toBeNull();
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** `loadMarketingStoreContext`:
  1. reads the live store (`LiveStoreService.getByApp`, status `live`);
  2. builds its URL with `storeUrl(`${slug}.${storesDomain}`, devPort)`;
  3. loads the manifest from `SPACE_DO` with `getStoreManifest(LIVE_BRANCH)`;
  4. reads `marketing_settings.product_path` (default `/`).
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): emails show the live store's own products, prices and images`, with the trailer.

### Task 2.5: Starters, saved templates and the template API, with preview and test sends

**Files:**
- Modify: `worker/database/schema.ts`
  - Table `marketing_templates`.
  - `marketing_settings` gains `brand` (text JSON, nullable), `social` (text JSON, default `'[]'`) and `product_path` (default `'/'`).
  - Generate `migrations/0030_marketing_templates.sql`.
- Create: `worker/database/services/MarketingTemplateService.ts` (exported), `worker/database/services/marketing-templates.sql.test.ts`
- Create: `worker/services/marketing/render/starters.ts` and `starters.test.ts`
- Create: `worker/services/marketing/compose.ts` and `compose.test.ts`. They build a `RenderContext` for a contact and send. Phases 3 and 4 use them.
- Create: `worker/api/controllers/marketing/templatesController.ts` and `templates.sql.test.ts`
- Modify: `worker/api/routes/marketingRoutes.ts`; `shared/types/marketing.ts` (`MARKETING_PATHS.templates = '/emails/templates'`, `MarketingTemplateView`, `MarketingPreview`)
- Modify: `worker/services/marketing/settings.ts` (validate `brand` colors, the social URLs and `product_path`, which must start with `/`)

**Interfaces:**
- **Consumes:** Tasks 2.1 to 2.4, the tokens (1.4) and the marketing sender (1.3).
- **Produces:**
  - `marketingStarter(kind: EmailDocumentKind | 'newsletter' | 'product_launch' | 'sale', store: { name: string; productIds: string[] }): EmailDocument`
  - `STARTER_KINDS`
  - `MarketingTemplateService`: `list(appId)`, `get(appId, id)`, `create(input)`, `update(appId, id, input, now)` and `delete(appId, id)`
  - `composeEmail(input: { document; kind; store: MarketingStoreContext; settings: Pick<MarketingSettingsRow, 'senderName' | 'postalAddress' | 'productPath' | 'brand'>; contact: { firstName: string | null; source: MarketingContactSource }; sendId: string; secret: string; linkBase: string; tracking: boolean }): Promise<RenderedEmail>`. Phase 4 adds `cart` and `order`; phase 5 adds the open pixel when `tracking` is on.
  - `marketingHeaders(input: { unsubscribeUrl; storeName; slug; appId; fromDomain }): Array<{ name; value }>`, which returns `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id` and `X-Estori-Store`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/render/starters.test.ts
import { describe, expect, it } from 'vitest';
import { marketingStarter, STARTER_KINDS } from './starters';
import { documentProblem } from './document';

const STORE = { name: 'Northwind Tea', productIds: ['oolong', 'sencha', 'mug', 'pot'] };

describe('starter templates', () => {
	it.each(STARTER_KINDS)('%s is a complete, valid draft for its kind', (kind) => {
		const document = marketingStarter(kind, STORE);
		const documentKind = kind === 'newsletter' || kind === 'product_launch' || kind === 'sale' ? 'campaign' : kind;
		expect(documentProblem(document, { kind: documentKind, productIds: new Set(STORE.productIds), localHttp: false })).toBeNull();
	});
	it('never invents a discount, a deadline or a price', () => {
		for (const kind of STARTER_KINDS) {
			const text = JSON.stringify(marketingStarter(kind, STORE));
			expect(text).not.toMatch(/\d+\s?%|\$\d|today only|ends (tonight|tomorrow|soon)|last chance/i);
		}
	});
	it('uses at most the products a store has', () => {
		const document = marketingStarter('newsletter', { name: 'Tiny', productIds: ['only'] });
		expect(JSON.stringify(document)).toContain('"productIds":["only"]');
		expect(documentProblem(marketingStarter('newsletter', { name: 'Empty', productIds: [] }), { kind: 'campaign', productIds: new Set(), localHttp: false })).toBeNull();
	});
});
```

```ts
// worker/services/marketing/compose.test.ts
import { describe, expect, it } from 'vitest';
import { composeEmail, marketingHeaders } from './compose';
import { readMarketingToken } from './tokens';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';

describe('composing a marketing email', () => {
	it('signs the unsubscribe link for this send and puts it in the footer', async () => {
		const email = await composeEmail({
			document: { version: 1, subject: 'Hi {{first_name}}', preheader: '', blocks: [{ type: 'divider' }] },
			kind: 'campaign',
			store: { appId: 'app_tea', name: 'Northwind Tea', url: 'https://northwind-tea.estori.shop', slug: 'northwind-tea', products: [], brand: null, logoUrl: null },
			settings: { senderName: 'Northwind Tea', postalAddress: '1 Main St', productPath: '/', brand: null },
			contact: { firstName: 'Ana', source: 'form' },
			sendId: 'ms_1',
			secret: SECRET,
			linkBase: 'https://news.estori.app',
			tracking: false,
		});
		const token = email.html.match(/https:\/\/news\.estori\.app\/e\/u\/([A-Za-z0-9_.-]+)/)?.[1] ?? '';
		expect(await readMarketingToken(SECRET, 'unsubscribe', token)).toEqual(['ms_1']);
		expect(email.subject).toBe('Hi Ana');
	});
});

describe('marketing headers', () => {
	it('carry one-click unsubscribe, the list id and the store', () => {
		expect(marketingHeaders({ unsubscribeUrl: 'https://news.estori.app/e/u/t', storeName: 'Northwind "Tea"', slug: 'northwind-tea', appId: 'app_tea', fromDomain: 'news.estori.app' })).toEqual([
			{ name: 'List-Unsubscribe', value: '<https://news.estori.app/e/u/t>' },
			{ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
			{ name: 'List-Id', value: '"Northwind Tea" <northwind-tea.list.news.estori.app>' },
			{ name: 'X-Estori-Store', value: 'app_tea' },
		]);
	});
});
```

The real-SQL tests (`marketing-templates.sql.test.ts`) check that templates are created, listed newest first, updated and deleted, and are scoped to the app.

The controller tests (`templates.sql.test.ts`) check:
- **`GET /starters`** answers each starter filled with the store's name and its first products. The test's env (`envWith(db, { SPACE_DO, STORES_DOMAIN: 'stores.test' })`) carries a fake `SPACE_DO` namespace, whose stub's `getStoreManifest` returns a valid manifest, plus a `live_stores` row.
- **`POST /templates`** refuses an invalid document with `documentProblem`'s message (400).
- **`POST /preview`** answers `{ subject, html, text }` for an unsaved document. The sample contact is first name "Ana". The unsubscribe link is the inert `#unsubscribe`, so the preview never signs a real token.
- **`POST /test`:**
  - it sends to the seller's confirmed account email with the subject prefixed `[Test] `;
  - it writes a `test` send;
  - it answers 409 when the seller's email isn't confirmed;
  - the 11th in an hour answers 429, through KV, as `ShopperEmailsController.test` does.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/render/starters.test.ts worker/services/marketing/compose.test.ts worker/database/services/marketing-templates.sql.test.ts worker/api/controllers/marketing/templates.sql.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec sections 10.3 and 24.
  - **Starters:**
    - The sale starter's text is "Write what's on sale and until when. Only promise what's true." It's flagged in the editor as text to replace: the editor highlights any block whose text equals a starter's placeholder sentence, and refuses to schedule it in phase 3.
    - The product launch starter uses `productIds[0]`.
  - **`composeEmail`:**
    - the unsubscribe URL is `${linkBase}/e/u/${await signMarketingToken(secret, 'unsubscribe', [sendId])}`;
    - `reason` comes from `footerReason(contact.source, ...)`;
    - `link` is the identity function until phase 5 sets `tracking`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): starter and saved templates, previews and test sends, each email signed for its own unsubscribe`, with the trailer.

### Task 2.6: Writing by asking

**Files:**
- Create: `worker/services/marketing/draft.ts` and `draft.test.ts`
- Create: `worker/api/controllers/marketing/draftController.ts`; modify `marketingRoutes.ts` (`POST /api/stores/:id/marketing/draft`, owner-only)
- Modify: `worker/services/rate-limit/config.ts` and `rateLimits.ts`: `EMAIL_DRAFT` (20 an hour per user, the Durable Object store) and `enforceEmailDraftRateLimit`, copied from `PAGE_COPY_DRAFT`
- Modify: `shared/types/marketing-documents.ts`: `EMAIL_DRAFT_FAILED_MESSAGE = "We couldn't draft that email. Try describing it differently."`

**Interfaces:**
- **Consumes:** `parseEmailDocument` and `documentProblem` (2.1); `SUPPLIER_NAMES` and `AI_ASSISTANT_NAMES`; `executeInference` with `AIModels.GEMINI_3_6_FLASH`, as in `draftController.ts` for site pages.
- **Produces:**
  - `EmailDraftSchema` (zod)
  - `EmailDraftRequest { prompt: string; kind: EmailDocumentKind; store: { name: string; products: Array<{ id: string; name: string; description: string | null; priceCents: number | null }> }; productIds: string[] }`
  - `EmailDraftCompleter = (messages: Message[]) => Promise<unknown>`
  - `class EmailDraftError extends Error`
  - `buildEmailDraftMessages(request): Message[]`
  - `draftCopyProblem(document): string | null`
  - `draftEmail(complete, request): Promise<EmailDocument>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/draft.test.ts
import { describe, expect, it } from 'vitest';
import { buildEmailDraftMessages, draftCopyProblem, draftEmail, EmailDraftError } from './draft';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { RateLimitType } from '../rate-limit/config';
import type { EmailDocument } from '../../../shared/types/marketing-documents';
import type { Message } from '../../agents/inferutils/common';

const REQUEST = {
	prompt: 'A cozy autumn newsletter about our new oolong',
	kind: 'campaign' as const,
	store: { name: 'Northwind Tea', products: [{ id: 'oolong', name: 'Oolong', description: 'Roasted', priceCents: 2400 }, { id: 'sencha', name: 'Sencha', description: null, priceCents: 1800 }] },
	productIds: [],
};
const GOOD: EmailDocument = { version: 1, subject: 'Autumn oolong is here', preheader: 'A roasted cup for cool days', blocks: [{ type: 'header', showLogo: true, align: 'center' }, { type: 'text', markdown: 'Hi {{first_name}}, our roasted oolong is back.', align: 'left' }, { type: 'products', productIds: ['oolong'], columns: 1, showPrice: true, buttonLabel: 'Shop' }] };

const flatten = (messages: Message[]) => messages.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join('\n');

describe('writing an email by asking', () => {
	it("gives the model the store, its products, the request and the honesty rules", () => {
		const text = flatten(buildEmailDraftMessages(REQUEST));
		for (const fact of ['Northwind Tea', 'oolong', 'Oolong', 'sencha', 'A cozy autumn newsletter']) expect(text).toContain(fact);
		expect(text).toMatch(/never invent (a )?(discount|deadline)/i);
		expect(text).toMatch(/do not (write|state) prices/i);
	});

	it('returns a valid draft', async () => {
		expect(await draftEmail(async () => ({ ...GOOD, version: undefined }), REQUEST)).toEqual(GOOD);
	});

	it('asks again once, naming the broken rule, then gives up', async () => {
		const seen: Message[][] = [];
		const bad = { ...GOOD, blocks: [{ type: 'products', productIds: ['nope'], columns: 1, showPrice: true, buttonLabel: 'Shop' }] };
		expect(await draftEmail(async (messages) => (seen.push(messages), seen.length === 1 ? bad : GOOD), REQUEST)).toEqual(GOOD);
		expect(flatten(seen[1])).toContain("\"nope\" isn't a product");
		await expect(draftEmail(async () => bad, REQUEST)).rejects.toBeInstanceOf(EmailDraftError);
	});

	it('refuses drafts that state prices or name suppliers or assistants', () => {
		expect(draftCopyProblem({ ...GOOD, blocks: [{ type: 'text', markdown: 'Only $24 today', align: 'left' }] })).toBe("Don't write prices in the text; product blocks show them.");
		expect(draftCopyProblem({ ...GOOD, subject: 'Fresh from AliExpress' })).toMatch(/supplier/);
		expect(draftCopyProblem({ ...GOOD, blocks: [{ type: 'text', markdown: 'Written with ChatGPT', align: 'left' }] })).toMatch(/assistant/);
		expect(draftCopyProblem(GOOD)).toBeNull();
	});

	it('lets running out of AI credits through for the controller to answer 429', async () => {
		await expect(draftEmail(async () => { throw new RateLimitExceededError('limit', RateLimitType.LLM_CALLS, 1, 1); }, REQUEST)).rejects.toBeInstanceOf(RateLimitExceededError);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 11, copying `worker/services/site-pages/draft.ts`'s structure.
  - The model returns `{ subject, preheader, blocks }`, and `version: 1` is added before validation.
  - The controller:
    - loads `loadMarketingStoreContext`;
    - answers 400 when the store isn't live ("Publish your store to draft emails from its products.");
    - answers 502 with `EMAIL_DRAFT_FAILED_MESSAGE` on `EmailDraftError`;
    - answers 429 on rate limits.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): sellers describe an email and get a draft in their brand with their products, checked like their own edits`, with the trailer.

### Task 2.7: The editor and the Templates tab

**Files:**
- Create: `src/routes/emails/editor/document-editor.tsx`, `block-list.tsx`, `block-form.tsx`, `markdown-field.tsx`, `product-picker.tsx`, `preview-pane.tsx`, `draft-dialog.tsx`, `document-ops.ts` and `document-ops.test.ts`
- Create: `src/routes/emails/templates.tsx` (list and starters), `src/routes/emails/template-page.tsx` (`/emails/templates/:id`)
- Modify: `src/routes.tsx`, `src/routes/emails/email-tabs.tsx` (a Templates tab), `src/hooks/use-marketing.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/api-types.ts`
- Test: `src/routes/emails/editor-guard.test.ts`

**Interfaces:**
- **Produces, `document-ops.ts`** (pure, also used in phases 3 and 4):
  - `defaultBlock(type: EmailBlockType, productIds: string[]): EmailBlock`
  - `addBlock(document, type, at, productIds): EmailDocument`
  - `moveBlock(document, from, to): EmailDocument`
  - `duplicateBlock(document, index): EmailDocument`
  - `removeBlock(document, index): EmailDocument`
  - `wrapSelection(text: string, start: number, end: number, mark: '**' | '_'): { text: string; cursor: number }`
  - `linkSelection(text, start, end, url): { text; cursor }`
- **Produces, components:** `DocumentEditor({ appId, kind, document, onChange, products })`, used again by campaigns and automations.

- [ ] **Step 1: Write the failing tests**

```ts
// src/routes/emails/editor/document-ops.test.ts
import { describe, expect, it } from 'vitest';
import { addBlock, defaultBlock, duplicateBlock, linkSelection, moveBlock, removeBlock, wrapSelection } from './document-ops';
import type { EmailDocument } from '@/api-types';

const DOC: EmailDocument = { version: 1, subject: 'S', preheader: '', blocks: [{ type: 'divider' }, { type: 'spacer', height: 16 }] };

describe('editing a document', () => {
	it('adds a default block at a position, using the first products for a product grid', () => {
		expect(addBlock(DOC, 'products', 1, ['a', 'b', 'c', 'd']).blocks[1]).toEqual({ type: 'products', productIds: ['a', 'b', 'c'], columns: 3, showPrice: true, buttonLabel: 'Shop now' });
		expect(defaultBlock('button', []).type).toBe('button');
	});
	it('moves, duplicates and removes without touching the original', () => {
		expect(moveBlock(DOC, 0, 1).blocks.map((block) => block.type)).toEqual(['spacer', 'divider']);
		expect(duplicateBlock(DOC, 1).blocks).toHaveLength(3);
		expect(removeBlock(DOC, 0).blocks.map((block) => block.type)).toEqual(['spacer']);
		expect(DOC.blocks).toHaveLength(2);
	});
	it('wraps the selection in bold or italic marks, and makes a link', () => {
		expect(wrapSelection('make this bold', 5, 9, '**')).toEqual({ text: 'make **this** bold', cursor: 13 });
		expect(linkSelection('see our teas', 4, 12, '/tea')).toEqual({ text: 'see [our teas](/tea)', cursor: 20 });
	});
});
```

```ts
// src/routes/emails/editor-guard.test.ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const files = import.meta.glob<string>('/src/routes/emails/**/*.tsx', { query: '?raw', import: 'default', eager: true });
const text = (path: string) => files[path] ?? '';

describe('the email editor', () => {
	it('previews in a sandboxed iframe through srcDoc, with desktop and phone widths', () => {
		const preview = text('/src/routes/emails/editor/preview-pane.tsx');
		expect(preview).toContain('sandbox=""');
		expect(preview).toContain('srcDoc=');
		expect(preview).toContain('375');
		expect(preview).toContain('600');
	});
	it('shows the footer as locked, and explains why', () => {
		expect(text('/src/routes/emails/editor/block-list.tsx')).toContain('Required by law: your address and an unsubscribe link');
	});
	it('offers drafting in plain words, with a test send and save as template', () => {
		expect(text('/src/routes/emails/editor/draft-dialog.tsx')).toContain('Describe the email you want');
		expect(text('/src/routes/emails/editor/draft-dialog.tsx')).toContain('Draft it');
		expect(text('/src/routes/emails/editor/document-editor.tsx')).toContain('Send me a test');
		expect(text('/src/routes/emails/template-page.tsx')).toContain('Save as template');
	});
	it('reminds sellers to keep subjects honest', () => {
		expect(text('/src/routes/emails/editor/document-editor.tsx')).toContain("Only promise what's true");
	});
	it('never renders seller text as HTML in the app', () => {
		for (const [path, source] of Object.entries(files)) expect(source, path).not.toContain('dangerouslySetInnerHTML');
	});
	it('names no supplier or AI assistant', () => {
		for (const [path, source] of Object.entries(files)) {
			const lower = source.toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(lower, `${path}: ${name}`).not.toContain(name);
		}
	});
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run src/routes/emails`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 10.4.
  - The preview calls `POST /preview` debounced at 500 ms, keyed by a hash of the document, as `template-editor.tsx` does.
  - The product picker lists the live store's products from `GET /starters`' store context. Add `products` to that answer.
- [ ] **Step 4:** Run `rtk proxy npx vitest run src/routes/emails`, then `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): a block editor with a sandboxed preview, test sends, saved templates and drafting from a description`, with the trailer.

### Task 2.8: End to end, CI and the PR

- [ ] **Step 1:** Apply 0030 locally.
- [ ] **Step 2: By eye.**
  - Open Templates and pick each starter.
  - Edit blocks; the preview follows on desktop and phone widths.
  - Draft an email from a description (with `GOOGLE_AI_STUDIO_API_KEY` set locally).
  - Send me a test. The dev log shows the email, with an unsubscribe link on `http://localhost:8100/e/u/...`.
  - Open that link: it asks first.
  - Press Unsubscribe: it's a test email, so nothing changes, and the page says so.
- [ ] **Step 3:** Run the CI steps.
- [ ] **Step 4: Push and open the PR.**
  - Push `feat/marketing-templates`.
  - `gh pr create --repo alastrat/vibesdk --base main --title "feat(marketing): email templates, a block editor, previews, test sends and drafting by asking"`.
  - The body says the PR is stacked on phase 1 until it merges, and ends with the Claude Code line.

---
## Phase 3: Campaigns, sending rules and the send pipeline

Branch `feat/marketing-campaigns` from `feat/marketing-templates`. Migration `0031_marketing_campaigns`. The PR delivers segments, campaigns, the rules engine, the minute cron, the queue producer and consumer, imports and reputation pauses.

### Task 3.1: Segments and their SQL

**Files:**
- Create: `shared/types/marketing-campaigns.ts`
- Modify: `worker/database/schema.ts`
  - Tables `marketing_segments`, `marketing_campaigns`, `marketing_documents` and `marketing_imports` (spec section 6, phase 3).
  - `marketing_sends` gains `enqueued_at` (nullable timestamp) and the index (`status`, `next_attempt_at`, `enqueued_at`).
  - Generate `migrations/0031_marketing_campaigns.sql`.
- Create: `worker/services/marketing/segments.ts` and `segments.test.ts`
- Create: `worker/database/services/MarketingCampaignService.ts` (segments, campaigns, documents and imports in one service) and its export

**Interfaces:**
- **Produces, shared:**
  - `SegmentCondition`, one of:
    - `{ field: 'tag'; op: 'has' | 'not_has'; value: string }`
    - `{ field: 'source'; op: 'is' | 'is_not'; value: MarketingContactSource }`
    - `{ field: 'subscribed_at' | 'last_order_at'; op: 'within_days' | 'before_days'; days: number }`, where `before_days` needs the date to exist
    - `{ field: 'last_order_at'; op: 'never' }`
    - `{ field: 'last_click_at'; op: 'within_days' | 'not_within_days'; days: number }`, where `not_within_days` includes contacts who never clicked
    - `{ field: 'orders_count' | 'total_spent_cents'; op: 'gte' | 'lte'; value: number }`
    - `{ field: 'purchased_product'; op: 'has' | 'not_has'; value: string }`
  - `SegmentFilter { match: 'all' | 'any'; conditions: SegmentCondition[] }`
  - `CampaignAudience { segmentId: string | null; filter: SegmentFilter | null }`
  - `CampaignRules { excludeRecentBuyersDays: number | null; excludeUnengagedDays: number | null; respectFrequencyCap: boolean }` and `DEFAULT_CAMPAIGN_RULES` (`null`, `180`, `true`)
  - `MARKETING_CAMPAIGN_STATUSES` / `MarketingCampaignStatus`
  - `CampaignCounters`, `MarketingCampaignView`, `MarketingSegmentView`
- **Produces, `segments.ts`:**
  - `segmentProblem(filter: SegmentFilter): string | null`
  - `compileSegment(filter: SegmentFilter, nowMs: number): { sql: string; params: Array<string | number> }`
  - `compileExclusions(rules: CampaignRules, nowMs: number): { sql: string; params: Array<string | number> }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/segments.test.ts
import { describe, expect, it } from 'vitest';
import { compileExclusions, compileSegment, segmentProblem } from './segments';

const NOW = Date.UTC(2026, 9, 19, 12);
const DAY = 86_400;
const seconds = (ms: number) => Math.floor(ms / 1000);

describe('segment SQL', () => {
	it('joins every condition with AND for "all", with values bound, never written into the SQL', () => {
		const compiled = compileSegment({ match: 'all', conditions: [
			{ field: 'tag', op: 'has', value: "vip'); DROP TABLE x; --" },
			{ field: 'orders_count', op: 'gte', value: 2 },
			{ field: 'last_order_at', op: 'within_days', days: 30 },
		] }, NOW);
		expect(compiled.sql).toBe('(EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ?) AND c.orders_count >= ? AND c.last_order_at >= ?)');
		expect(compiled.params).toEqual(["vip'); DROP TABLE x; --", 2, seconds(NOW) - 30 * DAY]);
	});

	it('joins with OR for "any", and handles never, not_has and products', () => {
		const compiled = compileSegment({ match: 'any', conditions: [
			{ field: 'last_order_at', op: 'never' },
			{ field: 'purchased_product', op: 'not_has', value: 'oolong' },
			{ field: 'last_click_at', op: 'not_within_days', days: 90 },
		] }, NOW);
		expect(compiled.sql).toBe('(c.last_order_at IS NULL OR NOT EXISTS (SELECT 1 FROM json_each(c.products_bought) WHERE value = ?) OR (c.last_click_at IS NULL OR c.last_click_at < ?))');
		expect(compiled.params).toEqual(['oolong', seconds(NOW) - 90 * DAY]);
	});

	it('compiles campaign exclusions: recent buyers and the unengaged', () => {
		expect(compileExclusions({ excludeRecentBuyersDays: 14, excludeUnengagedDays: 180, respectFrequencyCap: true }, NOW)).toEqual({
			sql: '(c.last_order_at IS NULL OR c.last_order_at < ?) AND NOT (c.subscribed_at < ? AND (c.last_click_at IS NULL OR c.last_click_at < ?) AND (c.last_order_at IS NULL OR c.last_order_at < ?))',
			params: [seconds(NOW) - 14 * DAY, seconds(NOW) - 180 * DAY, seconds(NOW) - 180 * DAY, seconds(NOW) - 180 * DAY],
		});
		expect(compileExclusions({ excludeRecentBuyersDays: null, excludeUnengagedDays: null, respectFrequencyCap: true }, NOW)).toEqual({ sql: '1 = 1', params: [] });
	});
});

describe('segment checks', () => {
	it('names what is wrong', () => {
		expect(segmentProblem({ match: 'all', conditions: [] })).toBe('Add at least one condition.');
		expect(segmentProblem({ match: 'all', conditions: Array.from({ length: 11 }, () => ({ field: 'tag' as const, op: 'has' as const, value: 'a' })) })).toBe('Use at most 10 conditions.');
		expect(segmentProblem({ match: 'all', conditions: [{ field: 'last_order_at', op: 'within_days', days: 0 }] })).toBe('Days must be a whole number from 1 to 3650.');
		expect(segmentProblem({ match: 'all', conditions: [{ field: 'tag', op: 'has', value: '' }] })).toBe('A tag must be 1 to 40 characters.');
		expect(segmentProblem({ match: 'all', conditions: [{ field: 'orders_count', op: 'gte', value: -1 }] })).toBe('Use a whole number of 0 or more.');
		expect(segmentProblem({ match: 'all', conditions: [{ field: 'tag', op: 'has', value: 'vip' }] })).toBeNull();
	});
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/segments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The compiler** is a `switch` over `field` and `op` with a fixed SQL fragment each. Values only ever go into `params`.
  - **Tags** are compared lowercased; the value is lowercased in `compileSegment`.
  - **Time conditions** convert days to `seconds(now) - days * 86400`, because Drizzle `timestamp` mode stores seconds.
  - **Schema:**
    - `marketing_campaigns`' counters are integers with default 0.
    - `marketing_documents` is append-only.
    - Then generate the migration.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): segments compiled to bound sql, and the campaign, document and import tables`, with the trailer.

### Task 3.2: The sending rules and send windows

**Files:**
- Create: `worker/services/marketing/rules.ts` and `rules.test.ts`

**Interfaces:**
- **Produces:**
  - `SkipReason = 'not_subscribed' | 'suppressed' | 'recent_buyer' | 'unengaged' | 'ordered' | 'condition' | 'too_late' | 'frequency_cap' | 'canceled'`
  - `DeferReason = 'platform' | 'frequency_cap' | 'daily_limit' | 'send_window'`
  - `HoldReason = 'platform' | 'store_paused' | 'paused' | 'allowance'`
  - `SendDecision = { action: 'send' } | { action: 'skip'; reason: SkipReason } | { action: 'defer'; until: Date; reason: DeferReason } | { action: 'hold'; reason: HoldReason }`
  - `SendRuleInput`:
    - `kind: 'confirmation' | 'campaign' | 'automation'`;
    - `now: Date`;
    - `platform: { killed: boolean; holdUntil: Date | null }`;
    - `store: { status: 'on' | 'off'; pausedBy: MarketingPauser | null; timezone: string; sendWindow: MarketingSendWindow; frequencyCap: MarketingFrequencyCap | null }`;
    - `sourcePaused: boolean`;
    - `contact: { consent: MarketingConsent; suppressed: MarketingSuppression | null; globallySuppressed: boolean; lastOrderAt: Date | null; lastClickAt: Date | null; subscribedAt: Date | null }`;
    - `exclusions: { recentBuyersDays: number | null; unengagedDays: number | null; orderedSinceTrigger: boolean; conditionHolds: boolean }`;
    - `automation: { dueAt: Date; maxLateMinutes: number; respectSendWindow: boolean } | null`;
    - `respectFrequencyCap: boolean`;
    - `recentSends: Date[]` (`sent_at` of counted sends in the cap window);
    - `dailyRemaining: number` and `monthlyRemaining: number`.
  - `decideSend(input: SendRuleInput): SendDecision`
  - `insideWindow(now: Date, timezone: string, window: MarketingSendWindow): boolean`
  - `nextWindowStart(now: Date, timezone: string, window: MarketingSendWindow): Date`
  - `startOfNextUtcDay(now: Date): Date`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/rules.test.ts
import { describe, expect, it } from 'vitest';
import { decideSend, insideWindow, nextWindowStart, type SendRuleInput } from './rules';

const NOW = new Date('2026-10-19T15:00:00Z'); // 10:00 in Chicago (CDT)
const DAY = 86_400_000;
const BASE: SendRuleInput = {
	kind: 'campaign',
	now: NOW,
	platform: { killed: false, holdUntil: null },
	store: { status: 'on', pausedBy: null, timezone: 'America/Chicago', sendWindow: { startHour: 8, endHour: 20 }, frequencyCap: { max: 2, days: 7 } },
	sourcePaused: false,
	contact: { consent: 'subscribed', suppressed: null, globallySuppressed: false, lastOrderAt: null, lastClickAt: new Date(NOW.getTime() - 10 * DAY), subscribedAt: new Date(NOW.getTime() - 400 * DAY) },
	exclusions: { recentBuyersDays: null, unengagedDays: 180, orderedSinceTrigger: false, conditionHolds: true },
	automation: null,
	respectFrequencyCap: true,
	recentSends: [],
	dailyRemaining: 100,
	monthlyRemaining: 1000,
};
const with_ = (patch: Partial<SendRuleInput>): SendRuleInput => ({ ...BASE, ...patch });

describe('the sending rules, in order', () => {
	it('sends when every rule passes', () => {
		expect(decideSend(BASE)).toEqual({ action: 'send' });
	});

	it('1: holds everything behind the kill switch, and defers until an SES hold ends', () => {
		expect(decideSend(with_({ platform: { killed: true, holdUntil: null } }))).toEqual({ action: 'hold', reason: 'platform' });
		const until = new Date(NOW.getTime() + 3_600_000);
		expect(decideSend(with_({ platform: { killed: false, holdUntil: until } }))).toEqual({ action: 'defer', until, reason: 'platform' });
	});

	it('2: holds while the store is off or paused, or the campaign is paused', () => {
		expect(decideSend(with_({ store: { ...BASE.store, status: 'off' } }))).toEqual({ action: 'hold', reason: 'store_paused' });
		expect(decideSend(with_({ store: { ...BASE.store, pausedBy: 'reputation' } }))).toEqual({ action: 'hold', reason: 'store_paused' });
		expect(decideSend(with_({ sourcePaused: true }))).toEqual({ action: 'hold', reason: 'paused' });
	});

	it('3 and 4: never mails anyone who is not subscribed or is suppressed, even when other rules would only delay', () => {
		const outsideWindow = new Date('2026-10-19T03:00:00Z');
		expect(decideSend(with_({ now: outsideWindow, contact: { ...BASE.contact, consent: 'unsubscribed' } }))).toEqual({ action: 'skip', reason: 'not_subscribed' });
		expect(decideSend(with_({ contact: { ...BASE.contact, suppressed: 'bounce' } }))).toEqual({ action: 'skip', reason: 'suppressed' });
		expect(decideSend(with_({ contact: { ...BASE.contact, globallySuppressed: true } }))).toEqual({ action: 'skip', reason: 'suppressed' });
	});

	it('3: sends confirmations only to pending contacts, ignoring the later rules', () => {
		const confirmation = with_({ kind: 'confirmation', contact: { ...BASE.contact, consent: 'pending' }, now: new Date('2026-10-19T03:00:00Z'), dailyRemaining: 0, recentSends: [NOW, NOW, NOW] });
		expect(decideSend(confirmation)).toEqual({ action: 'send' });
		expect(decideSend({ ...confirmation, contact: { ...BASE.contact, consent: 'subscribed' } })).toEqual({ action: 'skip', reason: 'not_subscribed' });
	});

	it('5: skips recent buyers, the unengaged, and automation contacts who ordered or fail the condition', () => {
		expect(decideSend(with_({ exclusions: { ...BASE.exclusions, recentBuyersDays: 14 }, contact: { ...BASE.contact, lastOrderAt: new Date(NOW.getTime() - 3 * DAY) } }))).toEqual({ action: 'skip', reason: 'recent_buyer' });
		expect(decideSend(with_({ contact: { ...BASE.contact, lastClickAt: null } }))).toEqual({ action: 'skip', reason: 'unengaged' });
		expect(decideSend(with_({ contact: { ...BASE.contact, lastClickAt: null, subscribedAt: new Date(NOW.getTime() - 20 * DAY) } }))).toEqual({ action: 'send' });
		expect(decideSend(with_({ kind: 'automation', exclusions: { ...BASE.exclusions, orderedSinceTrigger: true } }))).toEqual({ action: 'skip', reason: 'ordered' });
		expect(decideSend(with_({ kind: 'automation', exclusions: { ...BASE.exclusions, conditionHolds: false } }))).toEqual({ action: 'skip', reason: 'condition' });
	});

	it('6: skips an automation step that is too late', () => {
		const automation = { dueAt: new Date(NOW.getTime() - 2 * DAY), maxLateMinutes: 1440, respectSendWindow: false };
		expect(decideSend(with_({ kind: 'automation', automation }))).toEqual({ action: 'skip', reason: 'too_late' });
	});

	it('7: a full frequency cap skips a campaign and defers an automation until the oldest send leaves the window', () => {
		const oldest = new Date(NOW.getTime() - 6 * DAY);
		const full = { recentSends: [oldest, new Date(NOW.getTime() - DAY)] };
		expect(decideSend(with_(full))).toEqual({ action: 'skip', reason: 'frequency_cap' });
		expect(decideSend(with_({ ...full, kind: 'automation', automation: { dueAt: NOW, maxLateMinutes: 1440, respectSendWindow: true } }))).toEqual({ action: 'defer', until: new Date(oldest.getTime() + 7 * DAY), reason: 'frequency_cap' });
		expect(decideSend(with_({ ...full, respectFrequencyCap: false }))).toEqual({ action: 'send' });
		expect(decideSend(with_({ ...full, store: { ...BASE.store, frequencyCap: null } }))).toEqual({ action: 'send' });
	});

	it('8: defers to the next UTC day past the daily limit, and holds past the monthly allowance', () => {
		expect(decideSend(with_({ dailyRemaining: 0 }))).toEqual({ action: 'defer', until: new Date('2026-10-20T00:00:00Z'), reason: 'daily_limit' });
		expect(decideSend(with_({ monthlyRemaining: 0 }))).toEqual({ action: 'hold', reason: 'allowance' });
	});

	it('9: defers to the next window opening in the store time zone', () => {
		expect(decideSend(with_({ now: new Date('2026-10-19T03:00:00Z') }))).toEqual({ action: 'defer', until: new Date('2026-10-19T13:00:00Z'), reason: 'send_window' });
		const welcome = with_({ kind: 'automation', now: new Date('2026-10-19T03:00:00Z'), automation: { dueAt: new Date('2026-10-19T03:00:00Z'), maxLateMinutes: 1440, respectSendWindow: false } });
		expect(decideSend(welcome)).toEqual({ action: 'send' });
	});
});

describe('send windows', () => {
	const window = { startHour: 8, endHour: 20 };
	it('knows when local time is inside the window', () => {
		expect(insideWindow(NOW, 'America/Chicago', window)).toBe(true);
		expect(insideWindow(new Date('2026-10-20T01:30:00Z'), 'America/Chicago', window)).toBe(false); // 20:30 CDT
		expect(insideWindow(new Date('2026-10-20T01:30:00Z'), 'America/Chicago', { startHour: 0, endHour: 24 })).toBe(true);
	});
	it('opens next at 08:00 local, today or tomorrow', () => {
		expect(nextWindowStart(new Date('2026-10-19T03:00:00Z'), 'America/Chicago', window)).toEqual(new Date('2026-10-19T13:00:00Z'));
		expect(nextWindowStart(new Date('2026-10-20T01:30:00Z'), 'America/Chicago', window)).toEqual(new Date('2026-10-20T13:00:00Z'));
	});
	it('handles the days Chicago changes its offset', () => {
		// 21:00 CDT on Oct 31; clocks fall back at 02:00 on Nov 1, so 08:00 is CST (UTC-6).
		expect(nextWindowStart(new Date('2026-11-01T02:00:00Z'), 'America/Chicago', window)).toEqual(new Date('2026-11-01T14:00:00Z'));
		// 21:00 CST on Mar 7; clocks spring forward at 02:00 on Mar 8, so 08:00 is CDT (UTC-5).
		expect(nextWindowStart(new Date('2026-03-08T03:00:00Z'), 'America/Chicago', window)).toEqual(new Date('2026-03-08T13:00:00Z'));
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Local hour:** `localParts(date, timezone)` reads `{ year, month, day, hour }` with `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' }).formatToParts(date)`.
  - **Local wall time to an instant:** `zonedTime(year, month, day, hour, timezone)` guesses `Date.UTC(...)`, subtracts the offset measured at that guess, then measures again and corrects once. That handles both DST transitions.
  - **`decideSend`** follows the order in the test, exactly spec section 14.3, with campaigns and confirmations skipping the automation-only checks.
  - **Unengaged** means: subscribed before the cutoff, and neither a click nor an order since it.
  - **The frequency cap** counts only `recentSends` within `days`. When `count >= max`, the defer point is the oldest counted send plus `days`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): the sending rules in their spec order, with send windows that follow daylight saving`, with the trailer.

### Task 3.3: Materializing audiences and the send log's queue operations

**Files:**
- Modify: `worker/database/services/MarketingSendService.ts`:
  - `materializeCampaignPage`, `queuedIdsBetween`, `claim`, `release`, `holdQueued`, `resumeHeld`, `cancelRemaining`, `dueForQueue`, `markEnqueued`, `recentSendTimes`, `failStuck`, `remaining`, `sentTodayForStore`, `sentThisMonthForSeller` and `storeRates`
- Modify: `worker/database/services/MarketingCampaignService.ts`: campaign CRUD, `claimDueCampaigns`, `setCursor`, `setStatus`, `addCounters`, `snapshotDocument` and `audienceCount`
- Test: `worker/database/services/marketing-sends.sql.test.ts`

**Interfaces:**
- **Consumes:** `compileSegment` and `compileExclusions` (3.1).
- **Produces:**
  - `materializeCampaignPage(input: { campaign: { id; appId; documentId }; where: { sql; params }; afterContactId: string | null; limit: number; now: Date }): Promise<{ inserted: number; lastContactId: string | null }>`
  - `queuedIdsBetween(campaignId, afterContactId: string | null, upToContactId: string): Promise<string[]>`
  - `claim(id, now, leaseUntil): Promise<MarketingSendRow | null>`
  - `release(id, nextAttemptAt, error: string | null)`
  - `holdQueued(source: { campaignId?: string; appId?: string }): Promise<number>` and `resumeHeld(source): Promise<string[]>`
  - `cancelRemaining(campaignId, now): Promise<number>`
  - `dueForQueue(now, limit): Promise<string[]>`, which returns rows `queued` with `next_attempt_at <= now` and `(enqueued_at IS NULL OR enqueued_at < next_attempt_at OR enqueued_at < now - 1 hour)`
  - `markEnqueued(ids, now)`
  - `recentSendTimes(contactId, since): Promise<Date[]>` (campaign and automation sends with status `sent`)
  - `failStuck(leaseEndedBefore: Date): Promise<number>`
  - `remaining(campaignId): Promise<number>`
  - `sentTodayForStore(appId, dayStart)`, `sentThisMonthForSeller(userId, monthStart)`
  - `storeRates(appId, since): Promise<{ delivered; permanentBounces; complaints; complaintsLast24h }>`

- [ ] **Step 1: Write the failing real-SQL test**

```ts
// worker/database/services/marketing-sends.sql.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { MarketingContactService } from './MarketingContactService';
import { MarketingSendService } from './MarketingSendService';
import { compileExclusions, compileSegment } from '../../services/marketing/segments';

const NOW = new Date(1_800_000_000_000);
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
let db: D1Database;
const contacts = () => new MarketingContactService(envWith(db));
const sends = () => new MarketingSendService(envWith(db));

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	const add = async (id: string, consent: 'subscribed' | 'pending' | 'unsubscribed', tags: string[] = []) => {
		await contacts().create({ id, appId: 'app_tea', email: `${id}@example.test`, firstName: null, lastName: null, consent, source: 'form', timezone: null, now: at(-1000) });
		if (consent === 'subscribed') await contacts().setConsent(id, 'subscribed', at(-1000));
		if (tags.length) await contacts().update('app_tea', id, { tags }, NOW);
	};
	await add('mc_a', 'subscribed', ['vip']);
	await add('mc_b', 'subscribed', ['vip']);
	await add('mc_c', 'subscribed', ['vip']);
	await add('mc_d', 'subscribed');
	await add('mc_e', 'pending', ['vip']);
	await add('mc_f', 'unsubscribed', ['vip']);
	await add('mc_g', 'subscribed', ['vip']);
	await contacts().suppress('mc_g', 'complaint', NOW);
	await add('mc_h', 'subscribed', ['vip']);
	await contacts().suppressGlobally('mc_h@example.test', 'bounce', NOW);
});

describe('materializing a campaign audience on real SQL', () => {
	const where = () => {
		const segment = compileSegment({ match: 'all', conditions: [{ field: 'tag', op: 'has', value: 'vip' }] }, NOW.getTime());
		const exclusions = compileExclusions({ excludeRecentBuyersDays: null, excludeUnengagedDays: null, respectFrequencyCap: true }, NOW.getTime());
		return { sql: `${segment.sql} AND ${exclusions.sql}`, params: [...segment.params, ...exclusions.params] };
	};
	const campaign = { id: 'mcp_1', appId: 'app_tea', documentId: 'md_1' };

	it('writes sends page by page for subscribed, unsuppressed contacts in the segment only', async () => {
		const first = await sends().materializeCampaignPage({ campaign, where: where(), afterContactId: null, limit: 2, now: NOW });
		expect(first).toEqual({ inserted: 2, lastContactId: 'mc_b' });
		const second = await sends().materializeCampaignPage({ campaign, where: where(), afterContactId: 'mc_b', limit: 2, now: NOW });
		expect(second).toEqual({ inserted: 1, lastContactId: 'mc_c' });
		const done = await sends().materializeCampaignPage({ campaign, where: where(), afterContactId: 'mc_c', limit: 2, now: NOW });
		expect(done).toEqual({ inserted: 0, lastContactId: null });
		expect((await sends().queuedIdsBetween('mcp_1', null, 'mc_c')).length).toBe(3);
	});

	it('writes nothing new when a page runs again', async () => {
		expect(await sends().materializeCampaignPage({ campaign, where: where(), afterContactId: null, limit: 10, now: NOW })).toEqual({ inserted: 0, lastContactId: 'mc_c' });
	});

	it('claims a send once and releases it for later', async () => {
		const [id] = await sends().queuedIdsBetween('mcp_1', null, 'mc_a');
		const lease = at(600);
		expect(await sends().claim(id, NOW, lease)).toMatchObject({ id, status: 'sending', attempts: 1 });
		expect(await sends().claim(id, NOW, lease)).toBeNull();
		await sends().release(id, at(30), 'throttled');
		expect(await sends().claim(id, NOW, lease)).toBeNull();
		expect(await sends().claim(id, at(31), lease)).toMatchObject({ attempts: 2 });
		await sends().finish(id, { status: 'sent', sentAt: at(31), sesMessageId: 'm-a' });
	});

	it('holds queued sends and resumes them, and cancels what remains', async () => {
		expect(await sends().holdQueued({ campaignId: 'mcp_1' })).toBe(2);
		expect((await sends().resumeHeld({ campaignId: 'mcp_1' })).length).toBe(2);
		expect(await sends().cancelRemaining('mcp_1', NOW)).toBe(2);
		expect(await sends().remaining('mcp_1')).toBe(0);
	});

	it('finds queued sends that are due and not already in the queue', async () => {
		await sends().create({ id: 'ms_due', appId: 'app_tea', contactId: 'mc_d', kind: 'campaign', dedupeKey: 'c:mcp_2:mc_d', recipient: 'mc_d@example.test', status: 'queued', now: NOW });
		expect(await sends().dueForQueue(NOW, 10)).toContain('ms_due');
		await sends().markEnqueued(['ms_due'], NOW);
		expect(await sends().dueForQueue(at(60), 10)).not.toContain('ms_due');
		expect(await sends().dueForQueue(at(3700), 10)).toContain('ms_due');
	});

	it('lists recent sent times for the frequency cap, and fails sends stuck past their lease', async () => {
		await sends().finish('ms_due', { status: 'sent', sentAt: NOW, sesMessageId: 'm-due' });
		expect(await sends().recentSendTimes('mc_d', at(-60))).toEqual([NOW]);
		await sends().create({ id: 'ms_stuck', appId: 'app_tea', contactId: 'mc_d', kind: 'campaign', dedupeKey: 'c:mcp_3:mc_d', recipient: 'mc_d@example.test', status: 'queued', now: NOW });
		await sends().claim('ms_stuck', NOW, at(600));
		expect(await sends().failStuck(at(500))).toBe(0);
		expect(await sends().failStuck(at(700))).toBe(1);
		expect(await sends().byId('ms_stuck')).toMatchObject({ status: 'failed', error: 'The outcome of this send is unknown, so it was not retried' });
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** with raw SQL through `this.env.DB.prepare` where Drizzle can't express it. D1 allows 100 bound parameters per query, so never build `IN (...)` lists over 25 items.
  - **`materializeCampaignPage`** works in two statements, which keeps parameters well under D1's limit of 100:
    1. Read the upper bound of the page:

       ```sql
       SELECT max(id) AS upTo FROM (
         SELECT c.id FROM marketing_contacts c
         WHERE c.app_id = ? AND c.consent = 'subscribed' AND c.suppressed IS NULL
           AND NOT EXISTS (SELECT 1 FROM marketing_global_suppressions g WHERE g.email = c.email)
           AND (? IS NULL OR c.id > ?) AND ${where.sql}
         ORDER BY c.id LIMIT ?)
       ```

    2. Insert that range:

       ```sql
       INSERT OR IGNORE INTO marketing_sends (id, app_id, contact_id, kind, campaign_id, document_id, dedupe_key, recipient, status, attempts, next_attempt_at, created_at)
       SELECT 'ms_' || lower(hex(randomblob(12))), c.app_id, c.id, 'campaign', ?, ?, 'c:' || ? || ':' || c.id, c.email, 'queued', 0, ?, ?
       FROM marketing_contacts c WHERE <the same conditions> AND c.id > coalesce(?, '') AND c.id <= ?
       ```

       It answers `meta.changes` as `inserted` and `upTo` as `lastContactId`.
  - **`claim`:** as `ShopperEmailService.claim`, plus `status = 'sending'`.
  - **`release`:** sets `status = 'queued'` and `next_attempt_at`.
  - **`failStuck`:** fails rows `sending` whose lease (`next_attempt_at`) ended before the given time.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): campaign audiences written to the send log in pages, with claims, holds, cancels and stuck-send cleanup`, with the trailer.

### Task 3.4: The queue, its producer and pacing

**Files:**
- Create: `worker/services/marketing/queue.ts` and `queue.test.ts`
- Modify: `worker/types/env.d.ts` (`MARKETING_QUEUE?: Queue<MarketingQueueMessage>`)
- Modify: `wrangler.estori.jsonc` and `wrangler.estori-staging.jsonc`:

  ```jsonc
  "queues": {
    "producers": [{ "binding": "MARKETING_QUEUE", "queue": "estori-marketing" }],
    "consumers": [{ "queue": "estori-marketing", "max_batch_size": 4, "max_batch_timeout": 5, "max_retries": 10, "max_concurrency": 4, "dead_letter_queue": "estori-marketing-dlq" }]
  }
  ```

  Staging uses `estori-marketing-staging` and `estori-marketing-staging-dlq`.
- Modify: `worker/index.ts`: export `queue(batch, env, ctx)` calling `handleMarketingQueue(batch, env, ctx)` (Task 3.5)

**Interfaces:**
- **Produces:**
  - `MarketingQueueMessage = { type: 'materialize'; campaignId: string } | { type: 'send'; sendIds: string[] }`
  - `SEND_IDS_PER_MESSAGE = 25`
  - `chunkSendMessages(ids: string[]): MarketingQueueMessage[]`
  - `MarketingQueueProducer { send(messages: MarketingQueueMessage[]): Promise<void> }`
  - `marketingQueueFromEnv(env, inline: (message) => Promise<void>, defer?: (work: Promise<unknown>) => void): MarketingQueueProducer`, which uses `env.MARKETING_QUEUE.sendBatch` in batches of 100, or runs messages inline (through `defer` when given) when the binding is missing
  - `perConsumerRate(maxSendRate: number, concurrency: number): number`, which is `max(1, floor(maxSendRate * 0.8 / concurrency))`
  - `Pacer { wait(): Promise<void> }` and `createPacer(ratePerSecond, clock: { now(): number; sleep(ms): Promise<void> }): Pacer`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/queue.test.ts
import { describe, expect, it } from 'vitest';
import { chunkSendMessages, createPacer, marketingQueueFromEnv, perConsumerRate, type MarketingQueueMessage } from './queue';

describe('the marketing queue', () => {
	it('sends ids in messages of 25', () => {
		const ids = Array.from({ length: 60 }, (_, index) => `ms_${index}`);
		const messages = chunkSendMessages(ids);
		expect(messages.map((message) => (message.type === 'send' ? message.sendIds.length : 0))).toEqual([25, 25, 10]);
	});

	it('uses the queue binding in batches of 100, or runs messages inline without it', async () => {
		const batches: number[] = [];
		const env = { MARKETING_QUEUE: { sendBatch: async (items: Array<{ body: MarketingQueueMessage }>) => { batches.push(items.length); } } } as unknown as Env;
		const messages = chunkSendMessages(Array.from({ length: 2600 }, (_, index) => `ms_${index}`));
		await marketingQueueFromEnv(env, async () => undefined).send(messages);
		expect(batches).toEqual([100, 4]);
		const ran: MarketingQueueMessage[] = [];
		await marketingQueueFromEnv({} as Env, async (message) => { ran.push(message); }).send([{ type: 'materialize', campaignId: 'mcp_1' }]);
		expect(ran).toEqual([{ type: 'materialize', campaignId: 'mcp_1' }]);
	});

	it("splits 80% of the account's rate among consumers, at least 1 a second", () => {
		expect(perConsumerRate(14, 4)).toBe(2);
		expect(perConsumerRate(100, 4)).toBe(20);
		expect(perConsumerRate(1, 4)).toBe(1);
	});

	it('paces sends to the rate', async () => {
		let now = 0;
		const sleeps: number[] = [];
		const pacer = createPacer(2, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
		for (let index = 0; index < 4; index++) await pacer.wait();
		expect(sleeps).toEqual([500, 500, 500]);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** In production the pacer's `sleep` is `(ms) => scheduler.wait(ms)`, a Workers API; in tests it's the fake above.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): a cloudflare queue for marketing sends, inline without the binding, paced to ses's rate`, with the trailer.

### Task 3.5: Sending one email, and the queue consumer

**Files:**
- Create: `worker/services/marketing/send.ts` and `send.test.ts`
- Create: `worker/services/marketing/consumer.ts` and `consumer.test.ts`
- Modify: `worker/services/marketing/wiring.ts`: `sendDepsFromEnv(env)` and `handleMarketingQueue(batch, env, ctx)`

**Interfaces:**
- **Consumes:** `decideSend` (3.2), `composeEmail` and `marketingHeaders` (2.5), `classifySesError` (1.2), the send log operations (3.3), `storeSenderAddress`, the pacer (3.4).
- **Produces:**
  - `SendContext`:
    - `platform: { killed: boolean; holdUntil: Date | null }`;
    - `settings: MarketingSettingsRow`;
    - `store: MarketingStoreContext`;
    - `fromEmail: string` and `replyTo: string | null`;
    - `dailyRemaining: number` and `monthlyRemaining: number`;
    - `source: CampaignSource | AutomationSource`, where
      - `CampaignSource = { kind: 'campaign'; id: string; paused: boolean; rules: CampaignRules; document: EmailDocument }`;
      - `AutomationSource` is added in Task 4.2.
  - `SendOneDeps`:
    - `sends: Pick<MarketingSendService, 'claim' | 'finish' | 'release' | 'recentSendTimes'>`;
    - `contacts: Pick<MarketingContactService, 'byId' | 'isGloballySuppressed'>`;
    - `context(send: MarketingSendRow): Promise<SendContext | null>`;
    - `sender: MarketingSender | null`;
    - `compose(input: { send: MarketingSendRow; contact: MarketingContactRow; context: SendContext }): Promise<RenderedEmail>`;
    - `report(event: SendReport): Promise<void>`;
    - `now(): Date`.
  - `SendReport`, one of:
    - `{ kind: 'sent' | 'skipped' | 'failed'; send; reason?: string }`
    - `{ kind: 'platform_hold'; until: Date; reason: string }`
    - `{ kind: 'store_config'; appId: string; reason: string }`
  - `SendOutcome = 'sent' | 'skipped' | 'deferred' | 'held' | 'failed' | 'retry_later' | 'not_claimed'`
  - `sendOne(deps, sendId): Promise<SendOutcome>`
  - `UNCERTAIN_WAIT_MS = 600_000`, `MAX_SEND_ATTEMPTS = 3`, `THROTTLE_DELAY_SECONDS = 30`
  - `consumeSendIds(deps: SendOneDeps & { pacer: Pacer }, ids: string[]): Promise<{ done: boolean }>`, where `done: false` means throttled, so the message is retried

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/send.test.ts
import { describe, expect, it } from 'vitest';
import { sendOne, UNCERTAIN_WAIT_MS, type SendContext, type SendOneDeps, type SendReport } from './send';
import { SesApiError } from './ses/client';
import type { MarketingEmail } from './types';
import type { MarketingSendRow } from '../../database/services/MarketingSendService';
import type { MarketingContactRow } from '../../database/services/MarketingContactService';
import { DEFAULT_CAMPAIGN_RULES } from '../../../shared/types/marketing-campaigns';

const NOW = new Date('2026-10-19T15:00:00Z');
const SEND = { id: 'ms_1', appId: 'app_tea', contactId: 'mc_1', kind: 'campaign', campaignId: 'mcp_1', status: 'sending', attempts: 1, recipient: 'ana@example.test' } as MarketingSendRow;
const CONTACT = { id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', firstName: 'Ana', consent: 'subscribed', suppressed: null, source: 'form', lastOrderAt: null, lastClickAt: NOW, subscribedAt: new Date('2026-01-01T00:00:00Z') } as MarketingContactRow;
const CONTEXT: SendContext = {
	platform: { killed: false, holdUntil: null },
	settings: { appId: 'app_tea', status: 'on', pausedBy: null, senderName: 'Northwind Tea', replyTo: null, postalAddress: '1 Main St', timezone: 'America/Chicago', sendWindow: { startHour: 8, endHour: 20 }, frequencyCap: { max: 4, days: 7 }, sesTenant: 'store-app_tea' } as SendContext['settings'],
	store: { appId: 'app_tea', name: 'Northwind Tea', url: 'https://northwind-tea.estori.shop', slug: 'northwind-tea', products: [], brand: null, logoUrl: null },
	fromEmail: 'northwind-tea@news.estori.app',
	replyTo: 'hello@northwind.test',
	dailyRemaining: 100,
	monthlyRemaining: 100,
	source: { kind: 'campaign', id: 'mcp_1', paused: false, rules: DEFAULT_CAMPAIGN_RULES, document: { version: 1, subject: 'Hi', preheader: '', blocks: [{ type: 'divider' }] } },
};

function world(input: { contact?: Partial<MarketingContactRow>; context?: Partial<SendContext>; error?: unknown; attempts?: number; claimed?: boolean; noSender?: boolean } = {}) {
	const sent: MarketingEmail[] = [];
	const writes: string[] = [];
	const reports: SendReport[] = [];
	const deps: SendOneDeps = {
		sends: {
			claim: async () => (input.claimed === false ? null : { ...SEND, attempts: input.attempts ?? 1 }),
			finish: async (_id, update) => { writes.push(`finish ${update.status}${update.skipReason ? ` ${update.skipReason}` : ''}${update.sesMessageId ? ` ${update.sesMessageId}` : ''}`); },
			release: async (_id, next, error) => { writes.push(`release ${next.toISOString()} ${error ?? ''}`.trim()); },
			recentSendTimes: async () => [],
		},
		contacts: { byId: async () => ({ ...CONTACT, ...input.contact }), isGloballySuppressed: async () => false },
		context: async () => ({ ...CONTEXT, ...input.context }),
		sender: input.noSender ? null : { send: async (email) => { if (input.error) throw input.error; sent.push(email); return { messageId: '0100-abc' }; } },
		compose: async () => ({ subject: 'Hi', preheader: '', html: '<p>Hi</p><a href="https://news.estori.app/e/u/ms_1.mac">Unsubscribe</a>', text: 'Hi', links: [] }),
		report: async (event) => { reports.push(event); },
		now: () => NOW,
	};
	return { deps, sent, writes, reports };
}

describe('sending one marketing email', () => {
	it("sends from the store's address with Reply-To, one-click headers, tags and the tenant, then records it", async () => {
		const { deps, sent, writes, reports } = world();
		expect(await sendOne(deps, 'ms_1')).toBe('sent');
		expect(sent[0]).toMatchObject({ to: 'ana@example.test', from: { email: 'northwind-tea@news.estori.app', name: 'Northwind Tea' }, replyTo: 'hello@northwind.test', tenant: 'store-app_tea', tags: { estori_send: 'ms_1', estori_store: 'app_tea', estori_kind: 'campaign' } });
		expect(sent[0].headers.map((header) => header.name)).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post', 'List-Id', 'X-Estori-Store']);
		expect(writes).toEqual(['finish sent 0100-abc']);
		expect(reports.map((report) => report.kind)).toEqual(['sent']);
	});

	it('skips a contact who unsubscribed between materializing and sending, without calling SES', async () => {
		const { deps, sent, writes } = world({ contact: { consent: 'unsubscribed' } });
		expect(await sendOne(deps, 'ms_1')).toBe('skipped');
		expect(sent).toEqual([]);
		expect(writes).toEqual(['finish skipped not_subscribed']);
	});

	it('holds while the store is paused, and defers outside the send window', async () => {
		const paused = world({ context: { settings: { ...CONTEXT.settings, pausedBy: 'seller' } } });
		expect(await sendOne(paused.deps, 'ms_1')).toBe('held');
		expect(paused.writes).toEqual(['finish held']);
		const night = world();
		night.deps.now = () => new Date('2026-10-19T03:00:00Z');
		expect(await sendOne(night.deps, 'ms_1')).toBe('deferred');
		expect(night.writes).toEqual(['release 2026-10-19T13:00:00.000Z send_window']);
	});

	it('gives a throttled send back for the message to retry', async () => {
		const { deps, writes } = world({ error: new SesApiError(429, 'TooManyRequestsException', 'slow down') });
		expect(await sendOne(deps, 'ms_1')).toBe('retry_later');
		expect(writes).toEqual(['release 2026-10-19T15:00:30.000Z throttled']);
	});

	it('holds all marketing until midnight UTC when the daily quota is reached', async () => {
		const { deps, reports } = world({ error: new SesApiError(400, 'ThrottlingException', 'Daily message quota exceeded.') });
		expect(await sendOne(deps, 'ms_1')).toBe('retry_later');
		expect(reports).toEqual([{ kind: 'platform_hold', until: new Date('2026-10-20T00:00:00Z'), reason: 'Daily message quota exceeded.' }]);
	});

	it('waits 10 minutes before retrying an uncertain send, and fails it after 3 attempts', async () => {
		const first = world({ error: new SesApiError(503, 'ServiceUnavailable', 'down') });
		expect(await sendOne(first.deps, 'ms_1')).toBe('deferred');
		expect(first.writes).toEqual([`release ${new Date(NOW.getTime() + UNCERTAIN_WAIT_MS).toISOString()} down`]);
		const last = world({ error: new TypeError('fetch failed'), attempts: 3 });
		expect(await sendOne(last.deps, 'ms_1')).toBe('failed');
		expect(last.writes).toEqual(['finish failed']);
	});

	it("fails the send and reports the store's setup when SES says the sender isn't set up", async () => {
		const { deps, reports } = world({ error: new SesApiError(400, 'MailFromDomainNotVerifiedException', 'MAIL FROM not verified') });
		expect(await sendOne(deps, 'ms_1')).toBe('failed');
		expect(reports).toContainEqual({ kind: 'store_config', appId: 'app_tea', reason: 'MAIL FROM not verified' });
	});

	it('does nothing for a send another run holds, and fails when sending is not set up', async () => {
		expect(await sendOne(world({ claimed: false }).deps, 'ms_1')).toBe('not_claimed');
		const unset = world({ noSender: true });
		expect(await sendOne(unset.deps, 'ms_1')).toBe('failed');
	});
});
```

`consumer.test.ts` checks:
- `consumeSendIds` waits on the pacer before each send;
- it stops at the first `retry_later` and answers `{ done: false }`, leaving later ids untouched;
- otherwise it answers `{ done: true }`.

`handleMarketingQueue` acks done messages, and calls `message.retry({ delaySeconds: 30 })` for `done: false`. A `materialize` message calls Task 3.6's `materializeCampaign`.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/send.test.ts worker/services/marketing/consumer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 15.4.
  - **Decisions:**
    - `held` writes `finish` with `status: 'held'`.
    - `defer` writes `release(id, until, reason)`.
    - `skip` writes `finish` with `skipped` and `skipReason`.
  - **Errors:**
    - `throttled`: release at now + 30 s.
    - `daily_quota` or `paused`: release at now + 30 s, and report `platform_hold`. `until` is midnight UTC for `daily_quota`, or now + 1 hour for `paused`.
  - **The report handler** (wiring):
    - Writes the KV hold `marketing:hold`.
    - Raises the alerts `marketing-platform-hold` and `marketing-send-rejected`.
    - Pauses the store (`paused_by = 'estori'`) on `store_config`.
    - Adds 1 to the campaign's `sent`, `skipped` or `failed` counters through `MarketingCampaignService.addCounters`.
    - Sets the contact's `last_sent_at`.
  - **Context loading** (`sendDepsFromEnv`):
    - caches the store context and settings per app for the life of the batch, so 100 sends make one manifest read;
    - reads the platform state from `MARKETING_SENDING` and KV `marketing:hold`;
    - reads `dailyRemaining` from `dailyLimitFor(...)` minus `sentTodayForStore`, and `monthlyRemaining` from the plan's `emailsPerMonth` minus `sentThisMonthForSeller`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): each queued email is sent once, after the rules run again, with ses errors handled as the spec says`, with the trailer.

### Task 3.6: Campaigns: scheduling, the minute cron and the API

**Files:**
- Create: `worker/services/marketing/campaigns.ts` and `campaigns.test.ts`
- Modify: `worker/services/marketing/wiring.ts`: `runMarketingSchedule(cron, env)`, which handles `* * * * *`, `*/15 * * * *` and `35 6 * * *`
- Modify: `worker/index.ts` (`scheduled` gains `ctx.waitUntil(runMarketingSchedule(controller.cron, env))`), `wrangler.estori.jsonc` and `wrangler.estori-staging.jsonc` (add `"* * * * *"` to `triggers.crons`)
- Create: `worker/api/controllers/marketing/campaignsController.ts`, `campaigns.sql.test.ts`; modify `marketingRoutes.ts` (campaigns, segments, audience count)

**Interfaces:**
- **Consumes:** Tasks 3.1 to 3.5, `documentProblem` (2.1).
- **Produces:**
  - `MARKETING_MINUTE_CRON = '* * * * *'`
  - `scheduleProblem(input: { now: Date; at: Date; timezone: string; window: MarketingSendWindow; audienceCount: number; dailyRemaining: number; monthlyRemaining: number }): string | null`
  - `CampaignDeps`:
    - `campaigns: Pick<MarketingCampaignService, 'claimDueCampaigns' | 'get' | 'setCursor' | 'setStatus' | 'snapshotDocument' | 'audienceCount'>`;
    - `sends: Pick<MarketingSendService, 'materializeCampaignPage' | 'queuedIdsBetween' | 'markEnqueued' | 'remaining' | 'dueForQueue' | 'failStuck'>`;
    - `queue: MarketingQueueProducer`;
    - `storeContext(appId): Promise<MarketingStoreContext | null>`;
    - `now()` and `newId()`.
  - `startDueCampaigns(deps, limit): Promise<number>`
  - `materializeCampaign(deps, campaignId, pageSize = 500): Promise<'more' | 'done' | 'skipped'>`
  - `requeueDue(deps, limit = 500): Promise<number>`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/campaigns.test.ts
import { describe, expect, it } from 'vitest';
import { scheduleProblem } from './campaigns';

const NOW = new Date('2026-10-19T15:00:00Z');
const OK = { now: NOW, at: new Date('2026-10-20T14:00:00Z'), timezone: 'America/Chicago', window: { startHour: 8, endHour: 20 }, audienceCount: 300, dailyRemaining: 500, monthlyRemaining: 1000 };

describe('scheduling a campaign', () => {
	it('accepts a time inside the window, 5 minutes to 90 days ahead, that fits the limits', () => {
		expect(scheduleProblem(OK)).toBeNull();
	});
	it('names what is wrong, and suggests the next allowed time', () => {
		expect(scheduleProblem({ ...OK, at: new Date(NOW.getTime() + 60_000) })).toBe('Pick a time at least 5 minutes from now.');
		expect(scheduleProblem({ ...OK, at: new Date(NOW.getTime() + 91 * 86_400_000) })).toBe('Pick a time within the next 90 days.');
		expect(scheduleProblem({ ...OK, at: new Date('2026-10-20T03:00:00Z') })).toBe('That time is outside your send window (8:00 to 20:00). The next allowed time is Oct 20, 8:00 AM.');
		expect(scheduleProblem({ ...OK, audienceCount: 800 })).toBe('This audience has 800 people, but your store can send 500 more emails today. Narrow the audience, or raise your daily limit.');
		expect(scheduleProblem({ ...OK, audienceCount: 1200, dailyRemaining: 5000 })).toBe('This audience has 1,200 people, but your plan has 1,000 emails left this month.');
		expect(scheduleProblem({ ...OK, audienceCount: 0 })).toBe('No one is in this audience yet.');
	});
});
```

`campaigns.sql.test.ts` uses real SQL with an inline queue (no binding) and a fake store context. It checks:
- **Lifecycle:**
  - create a draft, then `PUT` the document;
  - `POST /schedule` refuses with `scheduleProblem`'s message, and with `documentProblem`'s, including a starter placeholder sentence left in;
  - schedule for 10 minutes ahead;
  - `startDueCampaigns` at that time moves it to `sending` once (a second run finds nothing), snapshots the document, and materializes every page;
  - the sends reach the fake sender;
  - the campaign ends `sent` with counters.
- **Pause and cancel:** pause holds the remaining sends, resume re-queues them, and cancel skips the rest.
- **Ownership:** another user's store answers 404.
- **`POST /audience-count`:** answers the same number materialization would write, for a segment and exclusions.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/services/marketing/campaigns.test.ts worker/api/controllers/marketing/campaigns.sql.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 12. Format times with `Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`. `runMarketingSchedule`:
  - **every minute:** start due campaigns (20 a run), then `requeueDue` (500);
  - **every 15 minutes:** `failStuck(now - 30 minutes)`;
  - **daily:** prune sends older than 180 days.

  The kill switch `MARKETING_SENDING === 'off'` returns before anything runs.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): campaigns are drafted, scheduled inside the send window, started by a minute cron, paused, resumed and canceled`, with the trailer.

### Task 3.7: Reputation pauses, the platform hold and the admin view

**Files:**
- Create: `worker/services/marketing/reputation.ts` and `reputation.test.ts`
- Modify: `worker/services/marketing/wiring.ts`:
  - `afterBounceOrComplaint` (used by Task 1.9) computes the store's rates and pauses it;
  - hourly (`5 * * * *`) `checkSesHealth` calls `GetAccount`.
- Create: `worker/api/controllers/marketing/adminController.ts`; routes `GET /api/admin/marketing/stores` and `POST /api/admin/marketing/stores/:id/unpause`, both `AuthConfig.admin`
- Modify: `worker/services/email/templates.ts`: `sellerMarketingPausedEmail(to, storeName, reason)`

**Interfaces:**
- **Produces:**
  - `ReputationStats { delivered: number; permanentBounces: number; complaints: number; complaintsLast24h: number }`
  - `reputationVerdict(stats): { pause: false } | { pause: true; reason: string }`
  - `sesHealthVerdict(account: SesAccount): { hold: false; warn: string | null } | { hold: true; reason: string }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/reputation.test.ts
import { describe, expect, it } from 'vitest';
import { reputationVerdict, sesHealthVerdict } from './reputation';

describe("a store's reputation", () => {
	it('pauses above 4% permanent bounces once there are 200 sends, and not before', () => {
		expect(reputationVerdict({ delivered: 199, permanentBounces: 50, complaints: 0, complaintsLast24h: 0 })).toEqual({ pause: false });
		expect(reputationVerdict({ delivered: 200, permanentBounces: 9, complaints: 0, complaintsLast24h: 0 })).toEqual({ pause: true, reason: 'Bounces reached 4.5% of 200 emails (the limit is 4%).' });
	});
	it('pauses above 0.2% complaints once there are 500 sends, or at 5 complaints in a day', () => {
		expect(reputationVerdict({ delivered: 500, permanentBounces: 0, complaints: 2, complaintsLast24h: 0 })).toEqual({ pause: true, reason: 'Spam complaints reached 0.4% of 500 emails (the limit is 0.2%).' });
		expect(reputationVerdict({ delivered: 40, permanentBounces: 0, complaints: 5, complaintsLast24h: 5 })).toEqual({ pause: true, reason: '5 spam complaints in the last 24 hours.' });
		expect(reputationVerdict({ delivered: 500, permanentBounces: 0, complaints: 1, complaintsLast24h: 1 })).toEqual({ pause: false });
	});
});

describe("the SES account's health", () => {
	const healthy = { max24HourSend: 50_000, maxSendRate: 14, sentLast24Hours: 100, sendingEnabled: true, productionAccessEnabled: true, enforcementStatus: 'HEALTHY' };
	it('holds marketing when SES pauses or reviews the account', () => {
		expect(sesHealthVerdict({ ...healthy, sendingEnabled: false })).toEqual({ hold: true, reason: 'SES has paused sending for the account.' });
		expect(sesHealthVerdict({ ...healthy, enforcementStatus: 'PROBATION' })).toEqual({ hold: true, reason: 'SES has the account under review (PROBATION).' });
	});
	it('warns past 80% of the daily quota', () => {
		expect(sesHealthVerdict({ ...healthy, sentLast24Hours: 40_001 })).toEqual({ hold: false, warn: '80% of the SES daily quota is used (40,001 of 50,000).' });
		expect(sesHealthVerdict(healthy)).toEqual({ hold: false, warn: null });
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The store pause** emails the seller and alerts the team, and only an admin lifts it (Task 1.1's `unpause(appId, ['reputation', 'estori', 'seller'])`).
  - **The hourly check** writes the KV hold `marketing:hold` with no end time while SES isn't healthy. It also caches `MaxSendRate` in KV `marketing:ses-rate` for an hour, which the consumer's pacer reads.
  - **The admin list** shows, for each store with marketing on: the store, the seller, sends in the last 30 days, bounce and complaint rates, the pause, and imports in the last 30 days.
- [ ] **Step 4:** Run it, and the admin controller's real-SQL test (a non-admin gets 403; unpause works).
- [ ] **Step 5: Commit** `feat(marketing): stores pause themselves on bad bounce or complaint rates, sending holds when ses is unhappy, and admins see and lift pauses`, with the trailer.

### Task 3.8: Imports

**Files:**
- Create: `worker/services/marketing/imports.ts` and `imports.test.ts`
- Create: `worker/api/controllers/marketing/importsController.ts`, `imports.sql.test.ts`; route `POST /api/stores/:id/marketing/imports` (multipart: `file`, `attest`)

**Interfaces:**
- **Produces:**
  - `ImportRow { email: string; firstName: string | null; lastName: string | null; tags: string[] }`
  - `ImportSkipReason = 'invalid' | 'role' | 'duplicate' | 'unsubscribed' | 'suppressed' | 'bounced' | 'over_limit'`
  - `parseContactsCsv(text: string): { rows: Array<Record<string, string>>; problem: string | null }`
  - `planImport(input: { rows: Array<Record<string, string>>; existing: ReadonlyMap<string, { consent: MarketingConsent; suppressed: MarketingSuppression | null }>; bounced: ReadonlySet<string>; room: number }): { toImport: ImportRow[]; skipped: Record<ImportSkipReason, number> }`
  - `IMPORT_LIMITS = { rows: 5000, bytes: 1_048_576, perDay: 2 }`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/imports.test.ts
import { describe, expect, it } from 'vitest';
import { parseContactsCsv, planImport } from './imports';

describe('reading a contacts CSV', () => {
	it('reads a header row, quoted fields, commas and doubled quotes inside quotes, and CRLF lines', () => {
		const parsed = parseContactsCsv('Email,First_Name,last_name,tags\r\nana@example.test,Ana,"Ruiz, Jr.","vip;tea"\r\n"ben@example.test","Ben ""B""",,\r\n');
		expect(parsed).toEqual({ problem: null, rows: [{ email: 'ana@example.test', first_name: 'Ana', last_name: 'Ruiz, Jr.', tags: 'vip;tea' }, { email: 'ben@example.test', first_name: 'Ben "B"', last_name: '', tags: '' }] });
	});
	it('needs an email column, and refuses more than 5,000 rows', () => {
		expect(parseContactsCsv('name\nAna').problem).toBe('The file needs an "email" column.');
		expect(parseContactsCsv(`email\n${'a@b.test\n'.repeat(5001)}`).problem).toBe('Import at most 5,000 contacts at a time.');
	});
});

describe('planning an import', () => {
	it('imports good rows once, and counts every skipped row by reason', () => {
		const rows = [
			{ email: 'Ana@Example.test', first_name: 'Ana', tags: 'VIP; tea' },
			{ email: 'ana@example.test' },
			{ email: 'not-an-email' },
			{ email: 'postmaster@example.test' },
			{ email: 'left@example.test' },
			{ email: 'blocked@example.test' },
			{ email: 'gone@example.test' },
			{ email: 'cy@example.test' },
			{ email: 'dee@example.test' },
		];
		const plan = planImport({
			rows,
			existing: new Map([['left@example.test', { consent: 'unsubscribed', suppressed: null }], ['blocked@example.test', { consent: 'subscribed', suppressed: 'complaint' }]]),
			bounced: new Set(['gone@example.test']),
			room: 2,
		});
		expect(plan.toImport).toEqual([{ email: 'ana@example.test', firstName: 'Ana', lastName: null, tags: ['vip', 'tea'] }, { email: 'cy@example.test', firstName: null, lastName: null, tags: [] }]);
		expect(plan.skipped).toEqual({ invalid: 1, role: 1, duplicate: 1, unsubscribed: 1, suppressed: 1, bounced: 1, over_limit: 1 });
	});
});
```

The real-SQL controller test (`imports.sql.test.ts`) checks:
- **Refusals:**
  - without `attest`: 400;
  - on Basic: 403, "Imports come with Premium.";
  - for a `new` seller level: 403, "Imports open once your store is established.";
  - the third import in a day: 429.
- **Success:**
  - it writes `marketing_imports` with the attestation text;
  - it creates contacts `subscribed` with source `import`, each with an `imported` consent record;
  - it answers the counts.
- **Existing contacts:** a contact who already exists at `none` becomes `subscribed`, through `nextConsent('none', 'import')`.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Tags are split on `;` or `,` inside the field.
  - The seller level comes from `StripeConnectService.getByUser(...).sellerLevel`, pinned through `getSellerLimitsSettings`, as `store-platform.ts` reads it.
  - Imported contacts count toward the plan limit.
  - The first-campaign limit (spec section 19): when more than 20% of a campaign's audience came from imports in the last 30 days, `startDueCampaigns` materializes at most 1,000 and sets the campaign's `paused_reason` to "Waiting for review of imported contacts". It auto-releases after 24 hours when `storeRates` shows bounces under 2%. Add these cases to `campaigns.sql.test.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): csv imports with attestation, for established premium sellers, that never resubscribe anyone`, with the trailer.

### Task 3.9: The Campaigns tab, segments, imports and the admin view

**Files:**
- Create: `src/routes/emails/campaigns.tsx`, `campaign-page.tsx` (`/emails/campaigns/:id`: Content, Audience, Rules and Schedule steps), `segment-builder.tsx`, `import-dialog.tsx`, `campaign-format.ts` and `campaign-format.test.ts`, `campaigns-guard.test.ts`
- Create: `src/routes/admin/marketing-stores.tsx`; route `admin/marketing`; an admin sidebar link next to the existing admin links
- Modify: `src/routes.tsx`, `email-tabs.tsx` (Campaigns tab), `src/hooks/use-marketing.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/api-types.ts`

- [ ] **Step 1: Write the failing tests.**
  - **`campaign-format.test.ts`:**
    - status labels;
    - "Sends Oct 20, 8:00 AM (Central)";
    - skip reason labels ("Unsubscribed", "Bounced or blocked", "Bought recently", "Not engaged in 180 days", "Too many emails this week");
    - condition sentences ("Tagged vip", "Ordered in the last 30 days", "Never ordered", "Bought Oolong").
  - **`campaigns-guard.test.ts`:**
    - the campaign page reuses `DocumentEditor`;
    - the audience step shows a live count;
    - the schedule step shows the store time zone;
    - Send now asks for confirmation with the audience count;
    - the import dialog contains the attestation sentence "Everyone in this file asked to get emails from";
    - no supplier or AI names.
- [ ] **Step 2:** Run `rtk proxy npx vitest run src/routes/emails src/routes/admin`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 25.
- [ ] **Step 4:** Run the tests and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): a campaigns tab with audiences, rules and scheduling, imports, and an admin view of every store's sending`, with the trailer.

### Task 3.10: End to end, CI and the PR

- [ ] **Step 1:** Apply 0031 locally.
- [ ] **Step 2: By eye.** Run local dev with the queue running inline.
  1. Create a campaign from a starter, with an audience of tag `vip` and exclusions.
  2. Schedule it 6 minutes ahead.
  3. Wait for the minute cron. Trigger it with `curl "http://localhost:8100/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"` if the dev server exposes scheduled handlers; otherwise call `runMarketingSchedule` from a scratch test.
  4. See each email in the dev log, the campaign `sent`, and its counters.
  5. Unsubscribe from one email's link.
  6. Send a second campaign, and see that contact skipped.
- [ ] **Step 3:** Run the CI steps.
- [ ] **Step 4: Push and open the PR.**
  - Push `feat/marketing-campaigns`.
  - `gh pr create --repo alastrat/vibesdk --base main --title "feat(marketing): campaigns, segments, sending rules and an ses send queue"`.
  - The body lists the owner steps this phase needs: create the queues, and the minute cron is new. It ends with the Claude Code line.

---
## Phase 4: Automations (welcome, abandoned cart, thank-you, win-back)

Branch `feat/marketing-automations` from `feat/marketing-campaigns`. Migration `0032_marketing_automations`.

### Task 4.1: Automation types, tables and the service

**Files:**
- Create: `shared/types/marketing-automations.ts`
- Modify: `worker/database/schema.ts` (`marketing_automations`, `marketing_enrollments`), generating `migrations/0032_marketing_automations.sql`
- Create: `worker/database/services/MarketingAutomationService.ts` (exported), `worker/database/services/marketing-automations.sql.test.ts`

**Interfaces:**
- **Produces, shared:**
  - `AUTOMATION_KINDS = ['welcome', 'abandoned_cart', 'thank_you', 'win_back', 'back_in_stock']` / `AutomationKind`
  - `AutomationTrigger`, `StepCondition`, `AutomationStep { id; waitMinutes; document: EmailDocument; documentId: string | null; condition: StepCondition | null }`, `AutomationReentry` and `AutomationRules`, all per spec section 13.1
  - `AUTOMATION_STATUSES` (`off`, `on`, `paused`)
  - `AUTOMATION_DEFAULTS: Record<AutomationKind, { name: string; trigger: AutomationTrigger; rules: AutomationRules; waits: number[] }>`, following the table in spec section 13.3
  - `MarketingAutomationView`
  - `automationSummary(view): string`, for example "1 email, 1 hour after a shopper leaves checkout"
- **Produces, the service:**
  - `get(appId, kind)`, `byId(id)`, `save(appId, kind, input, now)` (upsert, with `documentId`s written through `MarketingCampaignService.snapshotDocument` for each step) and `setStatus(appId, kind, status, now)`
  - `enroll(input: { id; automationId; appId; contactId; triggerKey; stepId; nextRunAt; context: EnrollmentContext; now }): Promise<boolean>`
  - `claimDue(now, leaseUntil, limit): Promise<EnrollmentRow[]>`
  - `advance(id, stepId: string, nextRunAt: Date, now)`, `finish(id, status: 'completed' | 'exited' | 'canceled', reason: string | null, now)` and `cancelActive(automationId, now): Promise<number>`
  - `exitActiveForContact(appId, contactId, kinds: AutomationKind[], reason, now): Promise<number>`
  - `onStores(kind): Promise<Array<{ appId; automationId; trigger; rules }>>` (automations that are on)
  - `addCounters(automationId, counters)`
- **Produces:** `EnrollmentContext = { checkoutId?: string; orderId?: string; variantId?: string }`

- [ ] **Step 1: Write the failing real-SQL test**

```ts
// worker/database/services/marketing-automations.sql.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { MarketingAutomationService } from './MarketingAutomationService';
import { AUTOMATION_DEFAULTS } from '../../../shared/types/marketing-automations';

const NOW = new Date(1_800_000_000_000);
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
let db: D1Database;
const automations = () => new MarketingAutomationService(envWith(db));
const STEP = { id: 's1', waitMinutes: 0, document: { version: 1 as const, subject: 'Welcome', preheader: '', blocks: [{ type: 'divider' as const }] }, documentId: null, condition: null };

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
});

describe('automations on real SQL', () => {
	it('keeps one automation per store and kind, created off, and turns it on', async () => {
		const defaults = AUTOMATION_DEFAULTS.welcome;
		await automations().save('app_tea', 'welcome', { name: defaults.name, trigger: defaults.trigger, rules: defaults.rules, steps: [STEP] }, NOW);
		await automations().save('app_tea', 'welcome', { name: 'Hello', trigger: defaults.trigger, rules: defaults.rules, steps: [STEP] }, NOW);
		expect(await automations().get('app_tea', 'welcome')).toMatchObject({ name: 'Hello', status: 'off' });
		await automations().setStatus('app_tea', 'welcome', 'on', NOW);
		expect((await automations().onStores('welcome')).map((row) => row.appId)).toEqual(['app_tea']);
	});

	it('enrolls a contact once per trigger key', async () => {
		const automation = await automations().get('app_tea', 'welcome');
		const enroll = (id: string, key: string) => automations().enroll({ id, automationId: automation!.id, appId: 'app_tea', contactId: 'mc_1', triggerKey: key, stepId: 's1', nextRunAt: NOW, context: {}, now: NOW });
		expect(await enroll('me_1', 'once')).toBe(true);
		expect(await enroll('me_2', 'once')).toBe(false);
		expect(await enroll('me_3', 'other')).toBe(true);
	});

	it('claims due enrollments once, advances, finishes and cancels', async () => {
		const claimed = await automations().claimDue(NOW, at(300), 10);
		expect(claimed.map((row) => row.id).sort()).toEqual(['me_1', 'me_3']);
		expect(await automations().claimDue(NOW, at(300), 10)).toEqual([]);
		await automations().advance('me_1', 's2', at(3600), NOW);
		await automations().finish('me_3', 'exited', 'ordered', NOW);
		expect(await automations().claimDue(at(3600), at(3900), 10)).toMatchObject([{ id: 'me_1', stepId: 's2' }]);
		const automation = await automations().get('app_tea', 'welcome');
		expect(await automations().cancelActive(automation!.id, NOW)).toBe(1);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`claimDue`:** `UPDATE marketing_enrollments SET next_run_at = ? WHERE id IN (SELECT id FROM marketing_enrollments WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at LIMIT ?) RETURNING *`. It pushes `next_run_at` to the lease, so a second run finds nothing.
  - **`save`** validates every step document with `documentProblem` for the automation's kind, and every condition and rule. It answers the problem text instead of writing. The controller in Task 4.5 turns that into a 400.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): automations with linear steps and enrollments that are claimed once`, with the trailer.

### Task 4.2: The automation engine

**Files:**
- Create: `worker/services/marketing/automations/engine.ts` and `engine.test.ts`
- Modify: `worker/services/marketing/send.ts`: `AutomationSource = { kind: 'automation'; id: string; paused: boolean; rules: AutomationRules; document: EmailDocument; documentKind: EmailDocumentKind; dueAt: Date; orderedSinceTrigger: boolean; conditionHolds: boolean; cart: RenderContext['cart']; order: RenderContext['order'] }`. `sendOne` passes these into `decideSend`'s `automation` and `exclusions`. Add a `send.test.ts` case: an automation send whose shopper ordered since the trigger is skipped as `ordered`.

**Interfaces:**
- **Consumes:** Task 4.1, `MarketingSendService.create`, `MarketingQueueProducer` (3.4).
- **Produces:**
  - `enrollmentKey(reentry: AutomationReentry, input: { triggerKey: string; at: Date }): string`
  - `EngineDeps`:
    - `automations: Pick<MarketingAutomationService, 'get' | 'enroll' | 'claimDue' | 'advance' | 'finish' | 'addCounters'> & { byId(id: string): Promise<AutomationRow | null> }`;
    - `contacts: Pick<MarketingContactService, 'byId'>`;
    - `inAudience(contactId: string, filter: SegmentFilter): Promise<boolean>`;
    - `orderedSince(appId: string, email: string, since: Date): Promise<boolean>`;
    - `conditionHolds(condition: StepCondition, input: { enrollment: EnrollmentRow; contact: MarketingContactRow }): Promise<boolean>`;
    - `sends: Pick<MarketingSendService, 'create'>`;
    - `queue: MarketingQueueProducer`;
    - `now()` and `newId()`.
  - `triggerAutomation(deps, input: { appId: string; kind: AutomationKind; contactId: string; triggerKey: string; context: EnrollmentContext; at: Date }): Promise<boolean>`
  - `runDueEnrollments(deps, limit = 200): Promise<number>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/automations/engine.test.ts
import { describe, expect, it } from 'vitest';
import { enrollmentKey, runDueEnrollments, triggerAutomation, type EngineDeps } from './engine';
import type { AutomationRow, EnrollmentRow } from '../../../database/services/MarketingAutomationService';
import type { MarketingContactRow } from '../../../database/services/MarketingContactService';
import type { MarketingQueueMessage } from '../queue';
import { AUTOMATION_DEFAULTS } from '../../../../shared/types/marketing-automations';

const NOW = new Date('2026-10-19T15:00:00Z');
const DOC = { version: 1 as const, subject: 'Your cart', preheader: '', blocks: [{ type: 'cart' as const, buttonLabel: 'Back to your cart' }] };
const AUTOMATION = {
	id: 'ma_cart', appId: 'app_tea', kind: 'abandoned_cart', status: 'on',
	trigger: AUTOMATION_DEFAULTS.abandoned_cart.trigger, rules: AUTOMATION_DEFAULTS.abandoned_cart.rules,
	steps: [
		{ id: 's1', waitMinutes: 0, document: DOC, documentId: 'md_1', condition: null },
		{ id: 's2', waitMinutes: 23 * 60, document: DOC, documentId: 'md_2', condition: { kind: 'no_order_since_trigger' } },
	],
} as unknown as AutomationRow;

function world(input: { status?: 'on' | 'off' | 'paused'; ordered?: boolean; inAudience?: boolean } = {}) {
	const enrollments = new Map<string, EnrollmentRow>();
	const sends: string[] = [];
	const queued: MarketingQueueMessage[] = [];
	const finished: string[] = [];
	let ids = 0;
	const automation = { ...AUTOMATION, status: input.status ?? 'on' } as AutomationRow;
	const deps: EngineDeps = {
		automations: {
			get: async () => automation,
			byId: async () => automation,
			enroll: async (row) => {
				const key = `${row.automationId}:${row.contactId}:${row.triggerKey}`;
				if ([...enrollments.values()].some((existing) => `${existing.automationId}:${existing.contactId}:${existing.triggerKey}` === key)) return false;
				enrollments.set(row.id, { ...row, status: 'active', exitReason: null, createdAt: row.now, updatedAt: row.now } as unknown as EnrollmentRow);
				return true;
			},
			claimDue: async (now) => [...enrollments.values()].filter((row) => row.status === 'active' && row.nextRunAt <= now),
			advance: async (id, stepId, nextRunAt) => {
				const row = enrollments.get(id)!;
				row.stepId = stepId;
				row.nextRunAt = nextRunAt;
			},
			finish: async (id, status, reason) => {
				enrollments.get(id)!.status = status;
				finished.push(`${status} ${reason ?? ''}`.trim());
			},
			addCounters: async () => undefined,
		},
		contacts: { byId: async () => ({ id: 'mc_1', appId: 'app_tea', email: 'ana@example.test', consent: 'subscribed', suppressed: null } as MarketingContactRow) },
		inAudience: async () => input.inAudience ?? true,
		orderedSince: async () => input.ordered ?? false,
		conditionHolds: async (condition) => (condition.kind === 'no_order_since_trigger' ? !(input.ordered ?? false) : true),
		sends: { create: async (row) => { sends.push(row.dedupeKey); return true; } },
		queue: { send: async (messages) => { queued.push(...messages); } },
		now: () => NOW,
		newId: () => `id_${++ids}`,
	};
	return { deps, enrollments, sends, queued, finished };
}

describe('re-entry keys', () => {
	it('is fixed for once, a time bucket for every N days, and the trigger for per-trigger', () => {
		expect(enrollmentKey({ kind: 'once' }, { triggerKey: 'chk_1', at: NOW })).toBe('once');
		expect(enrollmentKey({ kind: 'every', days: 180 }, { triggerKey: 'x', at: NOW })).toBe(`every:${Math.floor(NOW.getTime() / (180 * 86_400_000))}`);
		expect(enrollmentKey({ kind: 'per_trigger' }, { triggerKey: 'chk_1', at: NOW })).toBe('chk_1');
	});
});

describe('the automation engine', () => {
	const trigger = (deps: EngineDeps) => triggerAutomation(deps, { appId: 'app_tea', kind: 'abandoned_cart', contactId: 'mc_1', triggerKey: 'chk_1', context: { checkoutId: 'chk_1' }, at: NOW });

	it('enrolls once per checkout, only while the automation is on and the contact is in its audience', async () => {
		const on = world();
		expect(await trigger(on.deps)).toBe(true);
		expect(await trigger(on.deps)).toBe(false);
		expect(await trigger(world({ status: 'off' }).deps)).toBe(false);
		expect(await trigger(world({ inAudience: false }).deps)).toBe(false);
	});

	it('sends the first email at once, then waits for the second', async () => {
		const { deps, enrollments, sends, queued } = world();
		await trigger(deps);
		expect(await runDueEnrollments(deps)).toBe(1);
		const [enrollment] = [...enrollments.values()];
		expect(sends).toEqual([`a:${enrollment.id}:s1`]);
		expect(queued).toHaveLength(1);
		expect(enrollment).toMatchObject({ stepId: 's2', nextRunAt: new Date(NOW.getTime() + 23 * 3_600_000) });
	});

	it('exits when the shopper ordered, before any email', async () => {
		const { deps, sends, finished } = world({ ordered: true });
		await trigger(deps);
		await runDueEnrollments(deps);
		expect(sends).toEqual([]);
		expect(finished).toEqual(['exited ordered']);
	});

	it('leaves enrollments of a paused automation waiting, and cancels those of one turned off', async () => {
		const paused = world({ status: 'paused' });
		paused.enrollments.set('me_p', { id: 'me_p', automationId: 'ma_cart', appId: 'app_tea', contactId: 'mc_1', triggerKey: 'k', stepId: 's1', status: 'active', nextRunAt: NOW, context: {} } as unknown as EnrollmentRow);
		await runDueEnrollments(paused.deps);
		expect(paused.sends).toEqual([]);
		expect(paused.enrollments.get('me_p')?.status).toBe('active');
		const off = world({ status: 'off' });
		off.enrollments.set('me_o', { id: 'me_o', automationId: 'ma_cart', appId: 'app_tea', contactId: 'mc_1', triggerKey: 'k', stepId: 's1', status: 'active', nextRunAt: NOW, context: {} } as unknown as EnrollmentRow);
		await runDueEnrollments(off.deps);
		expect(off.finished).toEqual(['canceled automation off']);
	});

	it('completes after the last step', async () => {
		const { deps, enrollments, finished } = world();
		await trigger(deps);
		await runDueEnrollments(deps);
		deps.now = () => new Date(NOW.getTime() + 24 * 3_600_000);
		await runDueEnrollments(deps);
		expect([...enrollments.values()][0].status).toBe('completed');
		expect(finished).toEqual(['completed']);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 13.2.
  - **A paused automation** leaves its enrollment active, and its lease from `claimDue` makes it due again 5 minutes later. Pass a 5-minute lease.
  - **A turned-off automation** cancels the enrollment with the reason `automation off`.
  - **Sends** are created with `kind: 'automation'`, `automationId`, `enrollmentId`, `stepId` and the step's `documentId`.
  - **A step whose condition is false** is skipped: no send, and the enrollment moves on.
- [ ] **Step 4:** Run it, and `worker/services/marketing/send.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): an automation engine that enrolls once, waits, checks conditions, exits on orders and sends each step once`, with the trailer.

### Task 4.3: Triggers: subscribed, order placed, abandoned checkouts and win-back

**Files:**
- Create: `worker/services/marketing/automations/triggers.ts` and `triggers.test.ts`
- Modify: `worker/database/services/MarketingAutomationService.ts`: `abandonedCheckouts(input: { now: Date; afterMinutes: number; limit: number })` and `winBackCandidates(input: { now: Date; days: number; limit: number })`
- Test: `worker/database/services/marketing-triggers.sql.test.ts`
- Modify: `worker/services/marketing/wiring.ts`:
  - `onConfirmed` (Task 1.8) and the checkout subscribe in `recordMarketingOrder` call `triggerAutomation(..., 'welcome', ...)`;
  - `afterOrder` calls `triggerAutomation(..., 'thank_you', triggerKey: orderId)` and `exitActiveForContact(..., ['abandoned_cart', 'win_back'], 'ordered')`;
  - `runMarketingSchedule` runs `runDueEnrollments` every minute, `sweepAbandoned` every 15 minutes and `sweepWinBack` daily.

**Interfaces:**
- **Produces:**
  - `abandonedCheckouts(...)` returns `Array<{ checkoutId; appId; contactId; contactAt: Date }>`, per spec section 13.3, with automations on and the time limits.
  - `sweepAbandoned(deps, now): Promise<number>` and `sweepWinBack(deps, now): Promise<number>`

- [ ] **Step 1: Write the failing real-SQL test**

```ts
// worker/database/services/marketing-triggers.sql.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertCheckout, insertUser, migratedD1 } from '../test-support/real-d1';
import { MarketingAutomationService } from './MarketingAutomationService';
import { MarketingContactService } from './MarketingContactService';

const NOW = new Date(1_800_000_000_000);
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
let db: D1Database;

async function contactAt(checkoutId: string, email: string, at: Date) {
	await db.prepare('UPDATE store_checkouts SET contact_email = ?, marketing_consent = 1, contact_at = ?, mode = ? WHERE id = ?').bind(email, seconds(at), 'live', checkoutId).run();
}

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_1', userId: 'seller_1', title: 'Store' });
	const contacts = new MarketingContactService(envWith(db));
	for (const email of ['ana@example.test', 'ben@example.test', 'cy@example.test', 'dee@example.test']) {
		const row = await contacts.create({ id: `mc_${email[0]}`, appId: 'app_1', email, firstName: null, lastName: null, consent: 'subscribed', source: 'form', timezone: null, now: minutes(-600) });
		await contacts.setConsent(row.id, 'subscribed', minutes(-600));
	}
	await contacts.setConsent('mc_d', 'unsubscribed', minutes(-600));
	for (const [id, email, at] of [['chk_ana', 'ana@example.test', minutes(-90)], ['chk_ben_old', 'ben@example.test', minutes(-120)], ['chk_ben_new', 'ben@example.test', minutes(-70)], ['chk_cy', 'cy@example.test', minutes(-30)], ['chk_dee', 'dee@example.test', minutes(-90)], ['chk_paid', 'ana@example.test', minutes(-100)]] as const) {
		await insertCheckout(db, { id, sellerUserId: 'seller_1', status: 'expired', weightedCents: 0, createdAt: at });
		await contactAt(id, email, at);
	}
	await db.prepare(`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, customer_email, created_at, updated_at) VALUES ('ord_paid', 'live', 'app_1', 1, 'chk_paid', 'seller_1', 100, 0, 100, 0, 'Ana@Example.test', ?, ?)`).bind(seconds(minutes(-80)), seconds(minutes(-80))).run();
});

describe('abandoned checkouts on real SQL', () => {
	it("finds subscribed shoppers' newest unpaid checkout past the wait, with no order since", async () => {
		const found = await new MarketingAutomationService(envWith(db)).abandonedCheckouts({ now: NOW, afterMinutes: 60, limit: 50 });
		expect(found.map((row) => row.checkoutId).sort()).toEqual(['chk_ben_new']);
	});
});
```

Why only `chk_ben_new`:
- `chk_ana` is excluded, because Ana ordered (`ord_paid`, 80 minutes ago, with her email in another case) after it started 90 minutes ago.
- `chk_ben_old` is excluded, because Ben has a newer checkout within 24 hours.
- `chk_cy` is too recent.
- `chk_dee` is excluded, because Dee unsubscribed.
- `chk_paid` has an order.

Add the win-back case: a subscribed contact whose `last_order_at` is 90 days and 1 hour ago is found once on that day, and not the next day.

`triggers.test.ts`, with fakes:
- `sweepAbandoned` triggers `abandoned_cart` with `triggerKey` = the checkout id and `context.checkoutId`;
- `sweepWinBack` triggers `win_back` keyed through `every`;
- each sweep skips stores whose automation is off.

- [ ] **Step 2:** Run `rtk proxy npx vitest run worker/database/services/marketing-triggers.sql.test.ts worker/services/marketing/automations/triggers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the SQL per spec section 13.3 with bound parameters only. The order check compares `lower(o.customer_email)` to the normalized `contact_email`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): welcome, thank-you, abandoned-cart and win-back triggers, from events and sweeps`, with the trailer.

### Task 4.4: Cart and order blocks, and restoring a cart from an email

**Files:**
- Modify: `worker/services/marketing/render/render.ts` and `render.test.ts` (the `cart` and `order` blocks)
- Modify: `worker/services/marketing/wiring.ts` (the send-time `cart` and `order` context from `EnrollmentContext`)
- Create: `worker/services/marketing/cart-restore.ts` and `cart-restore.test.ts`
- Modify: `worker/api/handlers/store-platform.ts` (`GET /__estori/cart/restore/{token}`), `worker/services/store-payments/pay-page.ts` and `pay-page-script.test.ts` (read `restore`)

**Interfaces:**
- **Produces:**
  - `cartRestoreAnswer(checkout: StoreCheckoutRecord | null, appId: string): { items: Array<{ variantId: string; quantity: number }>; shipTo: string } | null`
  - `restoreUrl(storeUrl: string, token: string): string`, which is `${storeUrl}/__estori/pay?restore=${token}`
  - `cartContext(checkout, products: RenderProduct[], storeUrl, token): RenderContext['cart']`

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/marketing/cart-restore.test.ts
import { describe, expect, it } from 'vitest';
import { cartRestoreAnswer, restoreUrl } from './cart-restore';
import type { StoreCheckoutRecord } from '../store-payments/store';

const CHECKOUT = {
	id: 'chk_1', appId: 'app_tea', shipToCountry: 'US',
	pricedCart: { lines: [{ kind: 'own', productId: 'oolong', variantId: 'o-100', name: 'Oolong', quantity: 2, unitPriceCents: 2400 }, { kind: 'catalog', productId: 'pot', variantId: 'pot-1', name: 'Pot', quantity: 1, unitPriceCents: 3000, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 1500 }] },
} as unknown as StoreCheckoutRecord;

describe('restoring a cart from an email', () => {
	it("answers only variant ids, quantities and the country, never prices, for this store's checkout", () => {
		expect(cartRestoreAnswer(CHECKOUT, 'app_tea')).toEqual({ items: [{ variantId: 'o-100', quantity: 2 }, { variantId: 'pot-1', quantity: 1 }], shipTo: 'US' });
		expect(cartRestoreAnswer(CHECKOUT, 'app_other')).toBeNull();
		expect(cartRestoreAnswer(null, 'app_tea')).toBeNull();
	});
	it("links to the store's own checkout page", () => {
		expect(restoreUrl('https://northwind-tea.estori.shop', 'chk_1.mc_1.mac')).toBe('https://northwind-tea.estori.shop/__estori/pay?restore=chk_1.mc_1.mac');
	});
});
```

`render.test.ts` gains:
- a `cart` block lists each line with its quantity and price, and a button to `context.cart.url` through `context.link`;
- an `order` block lists the lines and the total;
- both are omitted when the context has no cart or order.

`pay-page-script.test.ts` gains: with `?restore=`, the script fetches `basePath + '/__estori/cart/restore/' + token`, writes each item with `Estori.cart.setQuantity`, sets the country, and removes the parameter with `history.replaceState` before starting checkout.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The endpoint:**
    - reads the token with `readMarketingToken(secret, 'restore', token)`;
    - loads the checkout with `StoreCheckoutService.get`;
    - answers 404 for anything wrong;
    - is rate-limited by `STORE_CHECKOUT`'s per-client limit.
  - **The token is signed in `composeEmail`** when the enrollment context has a `checkoutId`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): abandoned-cart emails show the cart and bring it back on the store's checkout page, on any device`, with the trailer.

### Task 4.5: The automations API and the Automations tab

**Files:**
- Create: `worker/api/controllers/marketing/automationsController.ts`, `automations.sql.test.ts`; routes per spec section 24 (phase 4)
- Create: `src/routes/emails/automations.tsx`, `automation-editor.tsx`, `automation-format.ts` and `automation-format.test.ts`, `automations-guard.test.ts`
- Modify: `email-tabs.tsx`, `src/routes.tsx`, hooks, api client, query keys, api types

- [ ] **Step 1: Write the failing tests.**
  - **Controller** (`automations.sql.test.ts`):
    - `GET /automations` answers all four kinds, with defaults for the unsaved ones (status `off`);
    - `PUT /automations/:kind` saves steps and answers 400 naming a bad step ("Email 2: ...");
    - `POST /automations/:kind/status { status: 'on' }` answers 409 when marketing is off for the store;
    - turning off cancels active enrollments.
  - **Format:** summaries such as "1 email, 1 hour after a shopper leaves checkout" and "2 emails: at once, then 23 hours later if they haven't ordered"; condition labels.
  - **Guard:**
    - four cards, each with a switch;
    - the editor uses `DocumentEditor` for each step;
    - the abandoned-cart editor explains "Only shoppers who subscribed get this email";
    - no supplier or AI names.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** per spec section 25.
- [ ] **Step 4:** Run them and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): an automations tab to turn on and edit welcome, abandoned cart, thank-you and win-back emails`, with the trailer.

### Task 4.6: End to end, CI and the PR

- [ ] **Step 1:** Apply 0032 locally.
- [ ] **Step 2: By eye.**
  1. Turn on welcome and abandoned cart.
  2. Sign up and confirm: the welcome email appears in the dev log within a minute.
  3. On a live local store, enter an email with the box ticked, then leave checkout.
  4. Set `afterMinutes` to 30 and wait for the 15-minute sweep (or call `sweepAbandoned` from a scratch test).
  5. The cart email appears. Its button restores the cart on a fresh browser profile.
  6. Pay, and the second cart email never comes.
- [ ] **Step 3:** Run the CI steps.
- [ ] **Step 4:** Push and open the PR: `feat(marketing): welcome, abandoned cart, thank-you and win-back automations`. It ends with the Claude Code line.

---
## Phase 5: Stats, attribution, and the public page, capability and pricing

Branch `feat/marketing-stats` from `feat/marketing-automations`. Migration `0033_marketing_stats`.

### Task 5.1: Click and open tracking

**Files:**
- Modify: `worker/database/schema.ts`: `marketing_link_clicks`, `marketing_attributions`, and `marketing_sends.last_clicked_at`. Generate `migrations/0033_marketing_stats.sql`.
- Create: `worker/services/marketing/tracking.ts` and `tracking.test.ts`
- Modify: `worker/services/marketing/compose.ts`: with `tracking: true`, it signs one click token and one open token per send, sets `link = (url, index) => `${linkBase}/e/c/${clickToken}/${index}``, and sets `openPixelUrl`.
- Modify: `worker/services/marketing/wiring.ts`: production sends use `tracking: true`; tests and previews use `false`.
- Modify: `worker/api/handlers/marketing-links.ts` and its test: `GET /e/c/{token}/{index}` and `GET /e/o/{token}`
- Modify: `worker/database/services/MarketingSendService.ts`: `recordClick(id, at, scanner): Promise<{ first: boolean }>` and `recordOpen(id, at, machine): Promise<{ first: boolean }>`. `MarketingCampaignService` and `MarketingAutomationService` gain `addLinkClick(documentId, index, unique)`.

**Interfaces:**
- **Produces:**
  - `TRANSPARENT_GIF: Uint8Array` (43 bytes)
  - `isMachineOpen(input: { asn: number | null; secondsSinceDelivery: number | null }): boolean`
  - `isScannerClick(input: { secondsSinceDelivery: number | null; linksClickedWithin10s: number }): boolean`
  - `TrackingDeps`:
    - `secret`;
    - `sends: Pick<MarketingSendService, 'byId' | 'recordClick' | 'recordOpen'>`;
    - `links(documentId: string): Promise<string[] | null>`;
    - `recentClicks(sendId: string, since: Date): Promise<number>`;
    - `countClick(send, index, unique: boolean)` and `countOpen(send, machine: boolean)`;
    - `now()`.
  - `clickResponse(deps, token: string, index: string, cf: { asn: number | null }): Promise<Response>`
  - `openResponse(deps, token: string, cf: { asn: number | null }): Promise<Response>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/tracking.test.ts
import { describe, expect, it } from 'vitest';
import { clickResponse, isMachineOpen, isScannerClick, openResponse, TRANSPARENT_GIF, type TrackingDeps } from './tracking';
import { signMarketingToken } from './tokens';
import type { MarketingSendRow } from '../../database/services/MarketingSendService';

const SECRET = 'a-test-secret-that-is-long-enough-0123456789';
const NOW = new Date('2026-10-19T15:00:00Z');
const SEND = { id: 'ms_1', appId: 'app_tea', documentId: 'md_1', kind: 'campaign', campaignId: 'mcp_1', deliveredAt: new Date('2026-10-19T14:00:00Z'), sentAt: new Date('2026-10-19T13:59:58Z') } as MarketingSendRow;

function world() {
	const counted: string[] = [];
	let firstClick = true;
	let firstOpen = true;
	const deps: TrackingDeps = {
		secret: SECRET,
		sends: {
			byId: async (id) => (id === 'ms_1' ? SEND : null),
			recordClick: async () => { const first = firstClick; firstClick = false; return { first }; },
			recordOpen: async () => { const first = firstOpen; firstOpen = false; return { first }; },
		},
		links: async (documentId) => (documentId === 'md_1' ? ['https://northwind-tea.estori.shop/', 'https://northwind-tea.estori.shop/products/oolong'] : null),
		recentClicks: async () => 0,
		countClick: async (_send, index, unique) => { counted.push(`click ${index} ${unique}`); },
		countOpen: async (_send, machine) => { counted.push(`open ${machine}`); },
		now: () => NOW,
	};
	return { deps, counted };
}

describe('click tracking', () => {
	it('redirects only to the link stored for that email, and counts the first click as unique', async () => {
		const { deps, counted } = world();
		const token = await signMarketingToken(SECRET, 'click', ['ms_1']);
		const response = await clickResponse(deps, token, '1', { asn: 7922 });
		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe('https://northwind-tea.estori.shop/products/oolong');
		await clickResponse(deps, token, '1', { asn: 7922 });
		expect(counted).toEqual(['click 1 true', 'click 1 false']);
	});
	it('answers 404 for a forged token or an index the email does not have', async () => {
		const { deps } = world();
		expect((await clickResponse(deps, 'ms_1.AAAAAAAAAAAAAAAAAAAAAA', '0', { asn: null })).status).toBe(404);
		const token = await signMarketingToken(SECRET, 'click', ['ms_1']);
		for (const index of ['2', '-1', 'x', '1e3']) expect((await clickResponse(deps, token, index, { asn: null })).status).toBe(404);
	});
});

describe('open tracking', () => {
	it('answers a 1x1 GIF that is never cached, and counts Apple-network opens as machine opens', async () => {
		const { deps, counted } = world();
		const response = await openResponse(deps, await signMarketingToken(SECRET, 'open', ['ms_1']), { asn: 714 });
		expect(response.headers.get('Content-Type')).toBe('image/gif');
		expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(TRANSPARENT_GIF);
		expect(counted).toEqual(['open true']);
	});
	it('answers the GIF even for a bad token, counting nothing', async () => {
		const { deps, counted } = world();
		expect((await openResponse(deps, 'bad', { asn: null })).status).toBe(200);
		expect(counted).toEqual([]);
	});
});

describe('telling machines from people', () => {
	it('treats Apple-network opens and opens within a minute of delivery as automatic', () => {
		expect(isMachineOpen({ asn: 714, secondsSinceDelivery: 3600 })).toBe(true);
		expect(isMachineOpen({ asn: 6185, secondsSinceDelivery: 3600 })).toBe(true);
		expect(isMachineOpen({ asn: 7922, secondsSinceDelivery: 30 })).toBe(true);
		expect(isMachineOpen({ asn: 7922, secondsSinceDelivery: 3600 })).toBe(false);
		expect(isMachineOpen({ asn: null, secondsSinceDelivery: null })).toBe(false);
	});
	it('treats several links clicked within 10 seconds of delivery as a scanner', () => {
		expect(isScannerClick({ secondsSinceDelivery: 5, linksClickedWithin10s: 2 })).toBe(true);
		expect(isScannerClick({ secondsSinceDelivery: 5, linksClickedWithin10s: 0 })).toBe(false);
		expect(isScannerClick({ secondsSinceDelivery: 300, linksClickedWithin10s: 5 })).toBe(false);
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The index** must match `^\d{1,3}$` and be less than `links.length`.
  - **Clicks:**
    - `recordClick` sets `clicked_at` only when it's null and the click isn't a scanner, and always updates `last_clicked_at`.
    - It also updates the contact's `last_click_at`.
    - It answers `first: true` only when `clicked_at` was just set.
    - Scanner clicks still redirect, but count nothing.
  - **Opens:** a machine open sets `machine_opened_at`. Otherwise it sets `opened_at` and the contact's `last_open_at`.
  - **Counters:** "unique" is the first counted click or open per send.
  - **`secondsSinceDelivery`** uses `delivered_at`, else `sent_at`.
  - **Links** follow spec section 18.1: `/e/c/{token}/{index}`, with one click token per send.
- [ ] **Step 4:** Run it, and `worker/api/handlers/marketing-links.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): click and open tracking on news.estori.app that only redirects to an email's own links and sets apple's automatic opens apart`, with the trailer.

### Task 5.2: Revenue attribution

**Files:**
- Create: `worker/services/marketing/attribution.ts` and `attribution.test.ts`
- Modify: `worker/database/services/MarketingSendService.ts`: `latestClick(appId, email, from, to): Promise<{ sendId; campaignId: string | null; automationId: string | null; clickedAt: Date } | null>`. It uses `last_clicked_at`, joined to `marketing_contacts` on `contact_id`, where the contact's `email` equals the normalized order email. Add the real-SQL case to `marketing-sends.sql.test.ts`.
- Modify: `worker/services/marketing/wiring.ts`: `afterOrder` calls `attributeOrder` for live orders.

**Interfaces:**
- **Produces:**
  - `ATTRIBUTION_WINDOW_MS = 5 * 86_400_000`
  - `AttributionDeps`:
    - `latestClick(appId, email, from, to)`;
    - `save(row: { orderId; appId; sendId; campaignId; automationId; revenueCents; clickedAt; now }): Promise<boolean>` (insert or ignore on `order_id`);
    - `count(target: { campaignId: string | null; automationId: string | null }, revenueCents: number): Promise<void>`;
    - `now()`.
  - `attributeOrder(deps, order: { id: string; appId: string; mode: StoreMode; customerEmail: string | null; totalCents: number; createdAt: Date }): Promise<'attributed' | 'none'>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/attribution.test.ts
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_WINDOW_MS, attributeOrder, type AttributionDeps } from './attribution';

const ORDER = { id: 'ord_1', appId: 'app_tea', mode: 'live' as const, customerEmail: 'Ana@Example.test', totalCents: 4599, createdAt: new Date('2026-10-19T15:00:00Z') };

function world(click: { clickedAt: Date } | null) {
	const saved = new Set<string>();
	const counted: number[] = [];
	const queries: Array<{ email: string; from: Date; to: Date }> = [];
	const deps: AttributionDeps = {
		latestClick: async (_appId, email, from, to) => {
			queries.push({ email, from, to });
			return click && click.clickedAt >= from && click.clickedAt <= to ? { sendId: 'ms_1', campaignId: 'mcp_1', automationId: null, clickedAt: click.clickedAt } : null;
		},
		save: async (row) => { if (saved.has(row.orderId)) return false; saved.add(row.orderId); return true; },
		count: async (_target, revenue) => { counted.push(revenue); },
		now: () => ORDER.createdAt,
	};
	return { deps, counted, queries };
}

describe('attributing an order to an email', () => {
	it('credits the last click within 5 days before the order, once', async () => {
		const { deps, counted, queries } = world({ clickedAt: new Date(ORDER.createdAt.getTime() - ATTRIBUTION_WINDOW_MS + 60_000) });
		expect(await attributeOrder(deps, ORDER)).toBe('attributed');
		expect(await attributeOrder(deps, ORDER)).toBe('attributed');
		expect(counted).toEqual([4599]);
		expect(queries[0]).toEqual({ email: 'ana@example.test', from: new Date(ORDER.createdAt.getTime() - ATTRIBUTION_WINDOW_MS), to: ORDER.createdAt });
	});
	it('credits nothing for an older click, a test order, or an order with no email', async () => {
		expect(await attributeOrder(world({ clickedAt: new Date(ORDER.createdAt.getTime() - ATTRIBUTION_WINDOW_MS - 60_000) }).deps, ORDER)).toBe('none');
		expect(await attributeOrder(world({ clickedAt: ORDER.createdAt }).deps, { ...ORDER, mode: 'test' })).toBe('none');
		expect(await attributeOrder(world({ clickedAt: ORDER.createdAt }).deps, { ...ORDER, customerEmail: null })).toBe('none');
	});
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** The counters add `orders + 1` and `revenue_cents + total` to the campaign or the automation.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): orders placed within 5 days of a click count toward that email's sales`, with the trailer.

### Task 5.3: The stats API and stats in the UI

**Files:**
- Create: `worker/api/controllers/marketing/statsController.ts`, `stats.sql.test.ts`; routes `GET /stats`, `GET /campaigns/:cid/stats` and `GET /automations/:kind/stats`
- Create: `src/routes/emails/overview.tsx` (the store overview at the top of Campaigns), `src/routes/emails/campaign-stats.tsx`, `stats-format.ts` and `stats-format.test.ts`, `stats-guard.test.ts`
- Modify: `shared/types/marketing-campaigns.ts`: `MarketingStoreStats` and `MarketingCampaignStats`

**Interfaces:**
- **Produces:**
  - `MarketingStoreStats { subscribers: number; subscribersChange30d: number; sent30d: number; revenue30dCents: number; topCampaigns: Array<{ id; name; revenueCents }> }`
  - `MarketingCampaignStats { counters: CampaignCounters; rates: { delivered; clicked; unsubscribed; complained; estimatedOpens }; links: Array<{ url; clicks; uniqueClicks }> }`
  - `estimatedOpens(counters)`, which is `opened` (`machine_opened` is never counted in `opened`) over delivered

- [ ] **Step 1: Write the failing tests.**
  - **SQL:** the store stats count consents in the last 30 days (subscribed or confirmed, minus unsubscribed); campaign stats join link clicks to the document's links in order.
  - **Format:** "4.2%", "$1,234.56"; the tooltip "Some mail apps open every email automatically, so clicks and sales tell you more."
  - **Guard:** the stats show "Opens (estimated)" with that tooltip; Clicks come before Opens; Revenue is labelled "Sales from this email".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per spec section 18.2.
- [ ] **Step 4:** Run them, plus `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): campaign and automation stats with clicks first, estimated opens, unsubscribes and sales`, with the trailer.

### Task 5.4: The public page, the capability and the pricing comparison

**Files:**
- Modify:
  - `src/lib/capabilities.ts` (`email-marketing` becomes `available`);
  - `src/content/solution-pages.ts` (`EMAIL_MARKETING_COPY`: the FAQ says it's available, and drops `COMING_SOON_QUESTION`; the steps say "Turn on email marketing in Emails, then add a sign-up form by asking.");
  - `src/lib/plans.ts` (a `capabilitySection('email-marketing', ...)` built from `MARKETING_PLAN_LIMITS`, on every plan with Basic's limits shown);
  - `src/lib/credits.ts` only if the owner picked option 2 in spec section 20 (credits per 1,000 emails).
- Test: extend the existing tests in `src/lib` and `src/content` that cover capabilities, plans and solution pages (find them with `ls src/lib/*.test.ts src/content/*.test.ts`).

- [ ] **Step 1: Write the failing test additions:**
  - `CAPABILITIES['email-marketing'].status === 'available'`;
  - the email marketing page's FAQ has no "coming soon";
  - `PLAN_COMPARISON` has a section with `capability: 'email-marketing'` whose rows include "Subscribers per store" with `basic: '250'` and `premium: '10,000'`, and "Imports" as `PAID`;
  - every row label passes the copy rules.
- [ ] **Step 2:** Run `rtk proxy npx vitest run src/lib src/content`. Expected: FAIL.
- [ ] **Step 3:** Implement. Read the numbers from `MARKETING_PLAN_LIMITS` (through `@/api-types`), never as literals, so the pricing page follows the limits.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): email marketing is available, and the pricing comparison lists its limits on every plan`, with the trailer.

### Task 5.5: End to end, CI and the PR

- [ ] **Step 1:** Apply 0033 locally.
- [ ] **Step 2: By eye.**
  1. Send a campaign to two local subscribers.
  2. Open one email's link from the dev log: it redirects, and Clicks goes up.
  3. Pay a live-mode local order with the clicking shopper's email: the campaign's sales go up.
  4. Check the public page and pricing.
- [ ] **Step 3:** Run the CI steps.
- [ ] **Step 4:** Push and open the PR: `feat(marketing): tracking, sales attribution, stats, and email marketing on the public site`. It ends with the Claude Code line.

---

## Phase 6 (optional): Sellers' own sending domains, and back in stock

Branch `feat/marketing-domains` from `main` once phase 5 has merged. Migration `0034_marketing_domains`. Build it only when the owner confirms decision 17.

### Task 6.1: Domain identities and claims

**Files:**
- Modify: `worker/services/marketing/ses/client.ts` and `client.test.ts`: `createDomainIdentity(domain)`, `getDomainIdentity(domain)`, `deleteDomainIdentity(domain)` and `setMailFrom(domain, mailFromDomain)`, through the same `call` helper
- Modify: `worker/database/schema.ts` (`marketing_domains`, `marketing_stock_alerts`), generating `migrations/0034_marketing_domains.sql`
- Create: `worker/services/marketing/domains.ts` and `domains.test.ts`; `worker/database/services/MarketingDomainService.ts`

**Interfaces:**
- **Produces:**
  - `SesDomainIdentity { verifiedForSending: boolean; dkimStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TEMPORARY_FAILURE' | 'NOT_STARTED'; dkimTokens: string[]; signingHostedZone: string; mailFromStatus: string | null }`
  - `domainClaimProblem(domain: string, claimed: readonly string[]): string | null`, which refuses an invalid hostname, an exact match, or a parent or child of a domain another store claimed, and Estori's own domains (`estori.app`, the stores domain and their subdomains)
  - `dnsRecordsFor(domain: string, identity: SesDomainIdentity, region: string): Array<{ type: 'CNAME' | 'MX' | 'TXT'; name: string; value: string; priority?: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/domains.test.ts
import { describe, expect, it } from 'vitest';
import { dnsRecordsFor, domainClaimProblem } from './domains';

describe('claiming a sending domain', () => {
	it("refuses another store's domain, its parents and children, and Estori's own", () => {
		const claimed = ['northwind.com'];
		expect(domainClaimProblem('northwind.com', claimed)).toBe('Another store already sends from this domain.');
		expect(domainClaimProblem('mail.northwind.com', claimed)).toBe('Another store already sends from this domain.');
		expect(domainClaimProblem('com', ['northwind.com'])).toBe('Enter a domain you own, such as mail.yourshop.com.');
		expect(domainClaimProblem('news.estori.app', [])).toBe("You can't send from an Estori domain.");
		expect(domainClaimProblem('shop.example.com', claimed)).toBeNull();
	});
});

describe('the DNS records a seller adds', () => {
	it('lists three DKIM CNAMEs from the signing zone, and the MAIL FROM MX and SPF', () => {
		const records = dnsRecordsFor('mail.northwind.com', { verifiedForSending: false, dkimStatus: 'PENDING', dkimTokens: ['t1', 't2', 't3'], signingHostedZone: 'dkim.amazonses.com', mailFromStatus: 'PENDING' }, 'us-east-1');
		expect(records).toEqual([
			{ type: 'CNAME', name: 't1._domainkey.mail.northwind.com', value: 't1.dkim.amazonses.com' },
			{ type: 'CNAME', name: 't2._domainkey.mail.northwind.com', value: 't2.dkim.amazonses.com' },
			{ type: 'CNAME', name: 't3._domainkey.mail.northwind.com', value: 't3.dkim.amazonses.com' },
			{ type: 'MX', name: 'bounce.mail.northwind.com', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
			{ type: 'TXT', name: 'bounce.mail.northwind.com', value: 'v=spf1 include:amazonses.com ~all' },
		]);
	});
});
```

- [ ] **Step 2:** Run it, and the extended client test (`POST /v2/email/identities` with `{ EmailIdentity }`; `GET /v2/email/identities/{domain}` mapped to `SesDomainIdentity`; `PUT /v2/email/identities/{domain}/mail-from` with `{ MailFromDomain, BehaviorOnMxFailure: 'USE_DEFAULT_VALUE' }`). Expected: FAIL.
- [ ] **Step 3:** Implement. Hostnames are checked with `tldts` (`getDomain`, already a dependency).
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): sellers claim a sending domain only once across stores, and see the dkim and mail from records to add`, with the trailer.

### Task 6.2: The domain API, verification polling, the From switch and the UI

**Files:**
- Create: `worker/api/controllers/marketing/domainController.ts`, `domain.sql.test.ts`; routes per spec section 24 (phase 6), behind `MARKETING_PLAN_LIMITS[plan].ownDomain`
- Modify: `worker/services/marketing/wiring.ts`:
  - daily, poll pending domains at most one a second (`scheduler.wait(1000)` between calls);
  - the send-time From uses `{mailbox}@{domain}` only when the store's domain row is `verified` and its domain matches. Otherwise it uses the default address.
- Modify: `worker/services/email/templates.ts` (`sellerSendingDomainFailedEmail`)
- Create: `src/routes/emails/sending-domain.tsx` (in Settings), with a guard test

- [ ] **Step 1: Write the failing tests:**
  - `PUT /domain` creates the identity and MAIL FROM, associates the tenant, and answers the records;
  - a Basic seller gets 403;
  - `POST /domain/check` updates the status from a fake `getDomainIdentity`;
  - `DELETE` deletes the identity and the row;
  - the send-time From switches only when verified;
  - a `FAILED` status falls back and emails the seller once.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement per spec section 5.3, with a DMARC check through `worker/services/live-stores/domain-checks.ts`'s DNS-over-HTTPS helper.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): premium stores send from their own verified domain, and fall back safely when it breaks`, with the trailer.

### Task 6.3: Back in stock

**Files:**
- Modify: `worker/services/store-payments/store-script.ts`: `Estori.notifyWhenAvailable({ variantId, email, consentText })` calls `Estori.subscribe` with `form: 'back-in-stock:' + variantId`, then POSTs `/__estori/notify`
- Modify: `worker/api/handlers/store-platform.ts`: `POST /__estori/notify` writes a `marketing_stock_alerts` row for the contact
- Create: `worker/services/marketing/stock.ts` and `stock.test.ts`: `restockedVariants(before: StoreManifest | null, after: StoreManifest): string[]`
- Modify: the live-store publish path (`worker/services/live-stores/`, where `LiveStoreService.publish` is called): after a successful publish, compare the previous and new manifests and trigger `back_in_stock` for each waiting alert, keyed by the alert id
- Modify: `AUTOMATION_DEFAULTS.back_in_stock`, the renderer (a products block filled with the variant's product), and the Automations tab (a fifth card)
- Modify: `worker/agents/think/skills/store-email-signup/SKILL.md` and its test (teach "Notify me")

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/marketing/stock.test.ts
import { describe, expect, it } from 'vitest';
import { restockedVariants } from './stock';
import type { StoreManifest } from '../../../shared/types/store-payments';

const manifest = (available: boolean, extra: boolean): StoreManifest => ({
	version: 1, currency: 'usd', shipping: { countries: ['US'], flatRateCents: 0 },
	products: [{ id: 'mug', name: 'Mug', variants: [{ id: 'm-blue', name: 'Blue', priceCents: 1800, available }, ...(extra ? [{ id: 'm-red', name: 'Red', priceCents: 1800 }] : [])] }],
});

describe('restocked variants', () => {
	it('finds variants that became available, and new variants are not restocks', () => {
		expect(restockedVariants(manifest(false, false), manifest(true, true))).toEqual(['m-blue']);
		expect(restockedVariants(manifest(true, false), manifest(true, false))).toEqual([]);
		expect(restockedVariants(null, manifest(true, false))).toEqual([]);
	});
});
```

The handler and engine cases:
- a notify request without a confirmed subscription records the alert, but nothing is sent until the contact confirms;
- a restock sends one email per alert, and marks it `sent`.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. A variant counts as available when `available !== false`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marketing): shoppers ask to hear when a product is back, and get one email when the seller restocks it`, with the trailer.

### Task 6.4: CI and the PR

- [ ] **Step 1:** Run the CI steps.
- [ ] **Step 2:** Push and open the PR: `feat(marketing): sellers' own sending domains and back-in-stock emails`. It ends with the Claude Code line.

---

## After each PR

- **Update the spec** wherever the build had to differ from it (the spike's findings, renamed fields), in the same PR, with a `docs(specs): ...` commit.
- **Report to the owner:**
  - the PR link;
  - the owner setup steps that phase needs;
  - anything left unverified.

  Never merge, never push to `estori-live`, and never approve a deploy.
