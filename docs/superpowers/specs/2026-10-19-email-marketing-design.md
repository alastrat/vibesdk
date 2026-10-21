# Email marketing: subscribers, campaigns and automations, sent through Amazon SES

To be built in six phases, each its own PR into `main` (section 29). Phase 1 is cut from `main` at 4dc09fb or later. It builds on shopper emails (`docs/superpowers/specs/2026-10-18-shopper-emails-design.md`), live stores and Estori's checkout page.

## 1. Purpose and the owner's request

The public page `/platform/email-marketing` (`EMAIL_MARKETING_COPY` in `src/content/solution-pages.ts`) already promises:
- sign-up forms and pop-ups in the store's style;
- one list of subscribers and customers;
- consent built in, with one-click leaving;
- newsletters "written by asking", with the store's products and brand;
- automatic emails: welcome, abandoned cart and thank-you;
- opens, clicks and the sales each email brings in.

`src/lib/capabilities.ts` marks `email-marketing` as coming soon.

Cloudflare Email Service allows only transactional mail. The shopper-emails spec, section 15, says marketing email can't be sent while relying on Cloudflare alone. The owner's decisions for this spec are:
- **Provider.** Marketing email goes through Amazon SES (the SES v2 API over HTTPS, signed with SigV4). Everything else stays on Cloudflare: Workers, D1, Queues, Cron Triggers and Turnstile. Order emails stay on Cloudflare Email Service.
- **Sender.** Every email to shoppers and sellers comes from Estori. Stripe's own receipts are off.
- **Automation.** Sellers automate campaigns and set automation and sending rules: triggers, delays, conditions, audience filters, frequency caps, send windows, exclusions such as recent buyers, per-store daily limits and pausing.
- **Templates.** Ready-made templates that sellers customize as rich HTML: brand colors, fonts and logo, plus blocks for a header, hero, text, button, product grid, divider, social links and footer. The compliance footer is locked. The HTML must be email-safe, and seller content is sanitized.
- **Writing by asking.** AI drafting through Estori's existing model access.
- **Markets.** US only, but consent is recorded properly.
- **Copy.** Seller- and shopper-facing copy never names suppliers or AI assistants (`src/routes/copy-rules.ts`).

## 2. What SES allows, and what it costs

All facts below were checked on 2026-10-19. The sources are in section 31.

| Fact | Effect on the design |
| --- | --- |
| `SendEmail` (`POST https://email.{region}.amazonaws.com/v2/email/outbound-emails`) takes `Content.Simple` with `Subject`, `Body.Html`, `Body.Text` and up to **15 custom `Headers`**. `List-Unsubscribe` and `List-Unsubscribe-Post` are allowed, once each. `From`, `Reply-To`, `Subject` and the like can't be custom headers. | One message per recipient, with Estori's own one-click unsubscribe headers. Raw MIME isn't needed. |
| It also takes `ConfigurationSetName`, `EmailTags` (`[A-Za-z0-9_-]`, up to 256 characters), `TenantName` and `ConfigurationOverrides.Tracking`. It answers `{ MessageId }`. | Every send carries the tags `estori_send` (the send id), `estori_store` and `estori_kind`. That's how events find their send. |
| `SendBulkEmail` needs SES templates, takes up to 50 destinations per call and reports each one separately. | Not used: Estori renders each email itself (section 10). |
| 40 MB per message and 50 recipients per message. Quotas count recipients. | Emails stay small, with no attachments. |
| **Errors:** 429 `TooManyRequestsException`. 400 `ThrottlingException` with "Maximum sending rate exceeded" or "Daily message quota exceeded" (the docs disagree on which name is used). 400 `SendingPausedException`, `AccountSuspendedException`, `MessageRejected`, `MailFromDomainNotVerifiedException` and `BadRequestException`. 404 `NotFoundException`. 5xx. | Classified in section 15.5. A timeout or 5xx can happen after SES accepted the email, so those sends wait for an event before any retry. |
| `aws4fetch` 1.0.20 (MIT, 2.5 kB gzipped) signs SigV4 with `fetch` and WebCrypto. Cloudflare's R2 docs use it. By default it retries 429 and 5xx 10 times. | Added as a dependency, created with `retries: 0` so Estori controls retries (section 15.5). |
| **Sandbox:** verified recipients only, 200 emails per 24 h, 1 per second. Production access is requested per region (`MailType: MARKETING`), with a first answer within 96 h. `GetAccount` returns `SendQuota { Max24HourSend, MaxSendRate, SentLast24Hours }` and `EnforcementStatus` (`HEALTHY`, `PROBATION` or `SHUTDOWN`). | Staging stays in the sandbox in its own region (section 21). Production polls `GetAccount` hourly and paces itself to `MaxSendRate`. |
| **Reputation:** keep bounces below 2% (review at 5%, possible pause at 10%) and complaints below 0.1% (review at 0.1%, possible pause at 0.5%). No event announces an account pause, so `EnforcementStatus` has to be polled. | Each store is held to tighter limits and is paused automatically (section 17.4). |
| **Configuration sets:** 10,000 per region and 10 event destinations each. Destinations include SNS and EventBridge (default bus only). Event types: `SEND`, `REJECT`, `BOUNCE`, `COMPLAINT`, `DELIVERY`, `OPEN`, `CLICK`, `RENDERING_FAILURE`, `DELIVERY_DELAY` and `SUBSCRIPTION`. Events carry `mail.tags`. | One set, `estori-marketing`, publishing `DELIVERY`, `BOUNCE`, `COMPLAINT`, `REJECT` and `RENDERING_FAILURE` to EventBridge (section 17.1). |
| **Tracking:** SES rewrites links to `awstrack.me` or a custom redirect domain. A custom HTTPS domain needs a CDN that forwards the `Host` header. Opens and clicks carry `isBotEvent`. | Estori tracks on its own links instead (section 18). SES tracking is off. |
| **SES list management:** one contact list per AWS account, `SendEmail` only, and it overrides your own `List-Unsubscribe` headers. Your own headers are supported. | Not used. Estori keeps consent and unsubscribes itself. |
| **Suppression:** the account-level list (`BOUNCE` and/or `COMPLAINT`) holds hard bounces until they're removed. Suppressed sends count toward the quota but not toward reputation. Tenant- and configuration-set-level lists override it. | Account level is set to `BOUNCE` only. Complaints are suppressed per store in D1, so one store's complaint doesn't silence the shopper for every store (section 17.2). |
| **Identities:** `CreateEmailIdentity` with Easy DKIM returns 3 tokens, each a CNAME `{token}._domainkey.{domain}` pointing to `{token}.{SigningHostedZone}`. SES looks for them for 72 h. `GetEmailIdentity` reports `VerifiedForSendingStatus` and the DKIM status. A custom MAIL FROM needs MX `10 feedback-smtp.{region}.amazonses.com` and TXT `v=spf1 include:amazonses.com ~all`. Limit: 10,000 identities per region. A parent domain covers its subdomains, but configuration sets need the subdomain verified itself. Control-plane calls are limited to 1 per second. | `news.estori.app` is verified on its own. Sellers' domains are verified through DNS records at any provider (section 5.3). Identity status is polled slowly. |
| **Tenants** (August 2025): one tenant per customer. Each has its own reputation tracking and automatic pausing ("Standard" policy), and `SendingStatus` is `ENABLED`, `REINSTATED` or `DISABLED`. Status changes and findings arrive on EventBridge. Default limit 10,000 tenants, auto-approved up to 300,000. A send with `TenantName` fails unless the tenant is associated with the identity and configuration set. | One tenant per store with marketing on. A paused tenant pauses the store in Estori (section 17.4). Tenants still count toward the account's reputation. |
| **Pricing** (changed 2026-07-21). New accounts start on **Essentials: $0.16 per 1,000** emails, Virtual Deliverability Manager included. **À la carte: $0.10 per 1,000**, plus $0.12 per GB of attachments. Tenants: $0.005 per tenant per month plus $0.005 per 1,000 emails. Dedicated IPs: $24.95 per IP per month (standard), or $15 per month plus $0.02–0.08 per 1,000 (managed). The free tier is gone. | See below. Shared IPs: dedicated IPs need steady volume and a 45-day warm-up. |

**Cost at volume** (à la carte with tenants, $0.105 per 1,000):
- 100,000 emails a month cost about **$10.50**, plus $0.005 per active store.
- On Essentials, the same volume costs about $16. Whether tenants cost extra on Essentials isn't stated.
- Cloudflare Queues adds about $0.05 per million emails: 3 operations per message, 25 emails per message, $0.40 per million operations after 1 million free a month.

The cost that matters is reputation, not money. One merchant with a bought list can get the account reviewed. Sections 17 and 19 exist for that.

**Mailbox provider rules**, which apply to Estori as a whole:
- **Gmail:**
  - "Bulk" means about 5,000 messages a day to personal Gmail, and the status is permanent. Subdomains count toward the organizational domain, so `news.estori.app`, `orders.estori.app` and `estori.app` count together.
  - Bulk senders need SPF and DKIM, DMARC (at least `p=none`), and alignment of the From domain with SPF or DKIM.
  - Marketing mail needs one-click unsubscribe (RFC 8058) plus a visible link, honored within 48 hours.
  - The spam rate should stay below 0.1% and must never reach 0.3%.
  - Gmail asks senders to confirm subscribers' addresses, and to keep subscription and non-subscription mail on different addresses.
- **Yahoo** has the same rules and honors unsubscribes within 2 days.
- **Outlook.com** requires SPF, DKIM and DMARC at 5,000 a day.
- **CAN-SPAM** sets eight requirements:
  - no false headers;
  - no deceptive subjects;
  - identify the message as an ad;
  - a valid postal address;
  - a clear way to opt out;
  - honor opt-outs within 10 business days, and keep the opt-out working for 30 days after sending;
  - opt-out by email address alone, in one step;
  - the advertiser stays liable when another company sends for it.

  The penalty is up to $53,088 per email; the 2025 level still applies in 2026. Stripe calls abandoned-cart emails promotional, so Estori treats them as commercial.
- **Washington's CEMA** (*Brown v. Old Navy*, 2025) makes any false or misleading subject line cost $500 per email, such as "Today only" for a sale that continues. Section 11 keeps drafted subjects honest.

## 3. Scope

**In**
- **The list:**
  - one contact list per store, holding both subscribers and customers;
  - a consent record for every change;
  - tags, and saved segments.
- **Sign-up:**
  - sign-up forms in generated stores through `Estori.subscribe()`, with Turnstile and double opt-in;
  - a consent checkbox on Estori's checkout page.
- **Templates:**
  - eight starter templates;
  - a block editor with the store's brand, a locked footer and a sandboxed preview;
  - test sends, and drafts written from a description.
- **Campaigns:**
  - audiences and exclusions;
  - send now or scheduled;
  - pause, resume and cancel.
- **Automations:**
  - welcome, abandoned cart, thank-you and win-back, with delays and conditions;
  - back-in-stock in phase 6.
- **Sending rules:** a send window, a frequency cap, a daily limit, exclusions and pausing, with a defined evaluation order.
- **Pipeline:** SES sending through a Cloudflare Queue, paced to the account's rate, idempotent per campaign and contact, with retries.
- **Unsubscribe:** one-click headers, plus unsubscribe and confirmation pages.
- **Suppression:** handling of bounces, complaints and suppression, and automatic pausing of a store.
- **Stats:** opens (with Apple's automatic opens accounted for), clicks, unsubscribes, and the orders and revenue each email brings in.
- **Sending identity:**
  - every store sends from its own address on `news.estori.app` by default;
  - sellers may verify their own domain (phase 6).
- **Limits and copy:** plan limits, plus updates to the public page, the capability status and the pricing comparison.

**Out**
- Countries outside the US: no EU consent flows, and no translations.
- SMS and push.
- A/B tests, per-contact send-time optimization and predictive segments.
- Branching (if/else) automation graphs. Steps are linear, each with an optional condition (section 13).
- Image uploads. Images come from the store's products, its logo, or an https address.
- Discount codes, which Estori's checkout doesn't have.
- Dedicated IPs, SES Virtual Deliverability Manager and SES list management.
- Marketing email from previews: sign-ups and sends need a live store.
- Moving order emails off Cloudflare.

## 4. Architecture

Requests flow left to right:

- **Sign-up on a store.**
  1. The store's form calls `Estori.subscribe()` from `/__estori/store.js`.
  2. The script gets a Turnstile token and POSTs it to `/__estori/subscribe` on the store's own host, which `handleStorePlatform` answers.
  3. The Worker checks the token with Turnstile's `siteverify` and checks the rate limits.
  4. It writes the contact (`pending`) and a consent record to D1.
  5. It sends a confirmation email through SES.
  6. The shopper opens `https://news.estori.app/e/confirm/{token}` and presses Confirm. The contact becomes `subscribed`, and the welcome automation enrolls them.
- **Consent at checkout.**
  1. Estori's checkout page posts the shopper's email and the checkbox to `/__estori/checkout/contact`, which saves them on `store_checkouts`.
  2. When `recordStoreOrder` records the order, it upserts the contact (subscribed only if the box was ticked) and updates the contact's order totals.
  3. Each order fires the thank-you trigger, and attributes revenue to a recent click.
- **The seller.** The Emails page (`/emails/...`) calls `/api/stores/:id/marketing/...`. Those routes are owner-only Hono routes, with services in `worker/database/services/Marketing*.ts`.
- **Schedules.** A new cron, `* * * * *`, runs `runMarketingMinute`:
  - It claims due campaigns and due automation steps, and sends a `materialize` or `send` message to the `estori-marketing` queue.
  - Every 15 minutes, on the existing `*/15 * * * *`, it sweeps abandoned checkouts and fails sends whose outcome stayed unknown.
  - Hourly, on the existing `5 * * * *`, it reads `GetAccount`.
  - Daily, on the existing `35 6 * * *`, it runs win-back, prunes old sends and polls domain identities.
- **Sending.** The queue consumer (`queue()` in `worker/index.ts`) does three things:
  1. It materializes audiences page by page into `marketing_sends`, one row per contact, deduplicated by key.
  2. It sends: claims each row, applies the sending rules again, renders the email, calls SES `SendEmail` with the store's tenant, the configuration set and tags, and records the message id.
  3. It paces itself so all consumers together stay under `MaxSendRate`.
- **Events back.** SES publishes to the EventBridge default bus. A rule targets an API destination, `POST https://news.estori.app/e/ses-events`, which sends a secret header. The Worker checks the header, parses the event and applies it in D1: delivered, bounced, complained or rejected, plus contact suppression and tenant pauses.
- **Shopper links.** Everything a shopper opens lives on the marketing link host (`MARKETING_LINK_HOST`, `news.estori.app`) under `/e/`:
  - `/e/u/{token}`: unsubscribe page and one-click POST;
  - `/e/confirm/{token}`: confirm a subscription;
  - `/e/c/{token}/{index}`: a tracked click, redirected to the stored link;
  - `/e/o/{token}`: the open pixel.
  
  `worker/index.ts` routes this host, and the same `/e/` paths on the main domain, to `handleMarketingLinks` before any other routing. On localhost the links use the main domain.

Nothing here touches SpaceDO or the store's generated code, except the new `Estori.subscribe` in the store script and a skill that teaches the build agent to use it.

## 5. Sending identity

### 5.1 The default: one address per store on `news.estori.app`
- **From:** `{ email: "{slug}@{MARKETING_FROM_DOMAIN}", name: <the store's sender name, 60 characters at most> }`.
  - `slug` is the live store's slug, made safe the way `storeSenderAddress` does it (`worker/services/shopper-emails/sender-address.ts`), and reserved mailbox names get the `-store` suffix.
  - Reuse that function with the marketing domain (DRY): call `storeSenderAddress(slug, "news@" + MARKETING_FROM_DOMAIN)`.
  - `MARKETING_FROM_DOMAIN` is a variable, `news.estori.app` in production. It is kept apart from `orders.estori.app`, which carries order emails on Cloudflare, so that a marketing complaint never touches order-email reputation. Gmail asks for exactly this separation.
- **Reply-To:**
  1. the marketing setting "Replies go to";
  2. else the shopper-emails reply-to;
  3. else the seller's account email.
- **Headers:**
  - `List-Unsubscribe: <https://news.estori.app/e/u/{token}>`;
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
  - `List-Id: "{store name}" <{slug}.list.news.estori.app>`;
  - `X-Estori-Store: {appId}`.

  That's 4 of the 15 allowed.
- **Authentication:**
  - `news.estori.app` is an SES domain identity with Easy DKIM (2048-bit). So DKIM `d=news.estori.app` aligns with the From domain.
  - The custom MAIL FROM is `bounce.news.estori.app`, which gives SPF alignment too, in relaxed mode.
  - DMARC is `_dmarc.estori.app`, at least `p=none` with a `rua` address. The owner checks whether one already exists (section 26).
- **Links:** on the same host (`news.estori.app/e/...`), so every link in the email aligns with the From domain.

### 5.2 A tenant per store
When a store turns marketing on:
1. Estori creates the SES tenant `store-{appId}` with the Standard reputation policy.
2. It associates the tenant with the `news.estori.app` identity and the `estori-marketing` configuration set.
3. It stores the tenant name in `marketing_settings.ses_tenant`.

Every send passes `TenantName`. If SES pauses a tenant (`SendingStatus: DISABLED`), the EventBridge event pauses the store in Estori with `paused_by = 'estori'` and alerts the team (section 17.4).

**Unverified:** whether one identity can be associated with thousands of tenants. The phase 1 spike checks it (section 29). If it can't, tenants are dropped, `TenantName` is left out, and Estori's own per-store thresholds (section 17.4) are the only guard.

### 5.3 A seller's own domain (phase 6, Premium)
1. **The seller enters a domain they control**, such as `mail.northwind.com` or `northwind.com`, and a mailbox name (default `hello`).
2. **Estori claims and creates the identity.**
   - It refuses the domain when another store already has it, or has its parent or a child of it. A verified parent lets the account send from its subdomains, so a store could otherwise send as another's domain.
   - It calls `CreateEmailIdentity`, then `PutEmailIdentityMailFromAttributes` with MAIL FROM `bounce.{domain}` and `BehaviorOnMxFailure: USE_DEFAULT_VALUE`.
   - It associates the identity with the store's tenant.
3. **Estori shows the records to add** at any DNS provider:
   - 3 CNAMEs for DKIM;
   - one MX and one TXT for MAIL FROM;
   - a recommended `_dmarc` TXT if none exists. Estori checks this over DNS-over-HTTPS, as `worker/services/live-stores/domain-checks.ts` does for store domains.
4. **Estori polls `GetEmailIdentity`.** The daily cron polls, and so does the seller's "Check now" button, at most one call a second across the account. When `VerifiedForSendingStatus` is true, the store sends from `{mailbox}@{domain}`.
5. **If verification later fails** (`DkimAttributes.Status` is `FAILED`), the store falls back to its `news.estori.app` address and the seller is emailed.

Before every send, Estori checks that the From domain is the store's own verified domain or `MARKETING_FROM_DOMAIN`. It never relies on SES verification alone. Links stay on `news.estori.app` either way. Links on the seller's domain, through a Cloudflare for SaaS hostname, are a later improvement.

## 6. Data model

**Migrations.** Each phase adds its own migration, taking the next free number when its PR is cut. Today's latest is 0028.

| Migration | Phase |
| --- | --- |
| `0029_marketing_contacts.sql` | 1 |
| `0030_marketing_templates.sql` | 2 |
| `0031_marketing_campaigns.sql` | 3 |
| `0032_marketing_automations.sql` | 4 |
| `0033_marketing_stats.sql` | 5 |
| `0034_marketing_domains.sql` | 6 |

**Conventions:**
- Times use Drizzle's `timestamp` mode (seconds). Booleans are `integer(..., { mode: 'boolean' })`.
- Ids are a prefix plus `nanoid()` (alphabet `A-Za-z0-9_-`), so they are valid SES tag values. The prefixes are `mc_`, `mx_`, `ms_`, `mt_`, `md_`, `mg_`, `mcp_`, `ma_` and `me_`.
- Store-owned tables reference `apps(id)` with cascade delete. `marketing_sends` and `marketing_attributions` don't, matching `shopper_emails`.

**Phase 1 (0029)**
- `marketing_settings`: one row per store.
  - `app_id` is the primary key, referencing apps.
  - `status` is `off` or `on`. `paused_by` is null, `seller`, `reputation` or `estori`. Also `paused_reason` and `paused_at`.
  - `sender_name`, `reply_to` (nullable), `postal_address`, `timezone` (IANA name, default `America/New_York`).
  - `send_window` (JSON `{ startHour, endHour }`, default 8 and 20) and `frequency_cap` (JSON `{ max, days }` or null, default 4 per 7 days).
  - `checkout_consent` (boolean, default true) and `consent_text` (default `Email me news and offers from {store}`).
  - `ses_tenant` (nullable), `terms_accepted_at`, `created_at` and `updated_at`.
- `marketing_contacts`:
  - `id`, `app_id`, `email` (trimmed and lowercased), `first_name` and `last_name`;
  - `consent`: `pending`, `subscribed`, `unsubscribed` or `none` (a customer who never opted in);
  - `suppressed`: null, `bounce`, `complaint` or `seller`;
  - `source`: `form`, `checkout`, `order`, `import` or `seller`;
  - `tags` (a JSON array, at most 20, each at most 40 characters) and `products_bought` (a JSON array of product ids, at most 200);
  - `orders_count`, `total_spent_cents`, `first_order_at` and `last_order_at`;
  - `last_sent_at`, `last_open_at` and `last_click_at`;
  - `timezone` (from `request.cf.timezone`, nullable);
  - `confirm_sent_at`, `subscribed_at`, `unsubscribed_at`, `created_at` and `updated_at`.
  - Constraints: unique (`app_id`, `email`); indexes on (`app_id`, `consent`, `suppressed`) and (`app_id`, `created_at`).
- `marketing_consents`, append-only proof:
  - `id`, `app_id`, `contact_id` (cascade);
  - `action`: `requested`, `confirmed`, `subscribed`, `unsubscribed`, `resubscribed`, `imported`, `added`, `suppressed` or `unsuppressed`;
  - `channel`: `form`, `checkout`, `import`, `seller`, `unsubscribe_page`, `one_click`, `complaint`, `bounce` or `estori`;
  - `text` (the exact consent wording shown), `form` (the form's label), `page_url` (origin and path, never the query);
  - `ip`, `user_agent` (256 characters at most), `send_id` and `created_at`;
  - index on (`contact_id`, `created_at`).
- `marketing_sends`, both the outbox and the log:
  - `id`, `app_id`, `contact_id`;
  - `kind`: `confirmation`, `campaign`, `automation` or `test`;
  - `campaign_id`, `automation_id`, `enrollment_id`, `step_id` and `document_id` (all nullable);
  - `dedupe_key` (unique), `recipient`;
  - `status`: `queued`, `held`, `sending`, `sent`, `skipped` or `failed`, with `skip_reason`;
  - `attempts`, `next_attempt_at` (the due time, or the lease end while sending), `ses_message_id` (unique when set) and `error`;
  - `delivered_at`, `bounced_at`, `bounce_type`, `complained_at`, `opened_at`, `machine_opened_at`, `clicked_at` and `unsubscribed_at`;
  - `created_at` and `sent_at`;
  - indexes on (`status`, `next_attempt_at`), (`campaign_id`, `status`), (`contact_id`, `sent_at`) and (`app_id`, `created_at`).
  - Dedupe keys: `c:{campaignId}:{contactId}`, `a:{enrollmentId}:{stepId}`, `confirm:{contactId}:{n}` and `test:{id}`.
- `marketing_global_suppressions`: `email` (primary key), `reason` (`bounce`), `detail` and `created_at`. These are hard bounces from any store, checked before every send.
- `store_checkouts` gains `contact_email` (nullable), `marketing_consent` (boolean, default false), `contact_at` (nullable) and `contact_updates` (integer, default 0, for the 20-update limit). There is also a new index on `contact_at` for the abandoned-checkout sweep, which runs across all stores.

**Phase 2 (0030)**
- `marketing_templates`: `id`, `app_id`, `name`, `kind` (a starter kind or `custom`), `document` (JSON `EmailDocument`), `created_at`, `updated_at`; index on `app_id`.
- `marketing_settings` gains `brand` (JSON overrides of the store manifest's brand, nullable), `social` (JSON links), and `product_path` (default `/`; the store path a product links to, where `{id}` becomes the product id).

**Phase 3 (0031)**
- `marketing_segments`: `id`, `app_id`, `name`, `filter` (JSON `SegmentFilter`), `created_at`, `updated_at`.
- `marketing_documents`: immutable rendered inputs.
  - `id`, `app_id`, `document` (JSON), `links` (a JSON array of the absolute links, in order) and `created_at`.
  - A campaign takes a snapshot when it starts sending, and an automation step takes one when it is saved. A send points at its document, so a click on an old email still finds its link after the seller edits.
- `marketing_campaigns`:
  - `id`, `app_id`, `name`;
  - `status`: `draft`, `scheduled`, `sending`, `paused`, `sent`, `canceled` or `failed`;
  - `document` (the editable draft) and `document_id` (the snapshot);
  - `audience` (JSON `{ segmentId, filter }`, where nulls mean all subscribers) and `rules` (JSON `CampaignRules`);
  - `scheduled_at`, `started_at`, `finished_at`, `cursor` (the last contact id materialized) and `audience_count`;
  - counters: `queued`, `sent`, `skipped`, `failed`, `delivered`, `bounced`, `complained`, `opened`, `machine_opened`, `clicked`, `unsubscribed`, `orders` and `revenue_cents`;
  - `created_at`, `updated_at`; index on (`status`, `scheduled_at`).
- `marketing_imports`: `id`, `app_id`, `file_name`, `rows`, `imported`, `skipped` (a JSON count per reason), `attested_text`, `attested_at`, `created_by` and `created_at`.
- `marketing_sends` gains `enqueued_at`: when the send's id last went to the queue. The minute cron re-queues a `queued` row only when it's due and wasn't queued since it became due, or was queued over an hour ago.

**Phase 4 (0032)**
- `marketing_automations`:
  - `id`, `app_id`, `kind` (`welcome`, `abandoned_cart`, `thank_you`, `win_back` or `back_in_stock`), `name`;
  - `status`: `off`, `on` or `paused`;
  - `trigger` (JSON), `steps` (JSON `AutomationStep[]`) and `rules` (JSON `AutomationRules`);
  - counters, as on campaigns, plus `enrolled`;
  - `created_at`, `updated_at`; unique (`app_id`, `kind`).
- `marketing_enrollments`:
  - `id`, `automation_id` (cascade), `app_id`, `contact_id`, `trigger_key`;
  - `step_id` (the next step), `status` (`active`, `completed`, `exited` or `canceled`), `exit_reason`, `context` (JSON: a checkout id or order id), `next_run_at`;
  - `created_at`, `updated_at`;
  - unique (`automation_id`, `contact_id`, `trigger_key`); index on (`status`, `next_run_at`).

**Phase 5 (0033)**
- `marketing_link_clicks`: `document_id`, `link_index`, `clicks` and `unique_clicks`, with primary key (`document_id`, `link_index`).
- `marketing_attributions`: `order_id` (primary key), `app_id`, `send_id`, `campaign_id`, `automation_id`, `revenue_cents`, `clicked_at` and `created_at`.
- `marketing_sends` gains `last_clicked_at`, so the last click wins attribution.

**Phase 6 (0034)**
- `marketing_domains`:
  - `id`, `app_id` (unique), `domain` (unique), `mailbox`;
  - `status`: `pending`, `verified`, `failed` or `temporary_failure`;
  - `dkim_records` (JSON), `mail_from_domain`, `mail_from_status`, `last_error`;
  - `checked_at`, `verified_at` and `created_at`.
- `marketing_stock_alerts`: `id`, `app_id`, `contact_id`, `variant_id`, `status` (`waiting` or `sent`) and `created_at`; unique (`contact_id`, `variant_id`).

**Retention:**
- Sends are kept 180 days. The daily cron deletes older ones; campaign and automation counters keep the totals.
- Consent records are kept as long as their contact.
- Deleting a contact deletes its consent records. Its sends stay until they age out, with the recipient replaced by `deleted`.

**Size estimate:** 1 million sends a month, kept 180 days, is about 6 million rows of about 350 bytes, or roughly 2.1 GB. D1 allows 10 GB per database. If volume gets near that, sends move to a database of their own.

## 7. Contacts, consent and statuses

- **Consent states:**

  | Transition | Trigger |
  | --- | --- |
  | `none` → `pending` | A form sign-up |
  | `pending` → `subscribed` | Confirmed |
  | `none` → `subscribed` | The checkout box, an import with attestation, or the seller adding the contact after attesting |
  | any → `unsubscribed` | An unsubscribe link, one-click, a complaint, or the seller |
  | `unsubscribed` → `subscribed` | Only on the shopper's own new consent: a confirmed form sign-up or the checkout box. Never through an import or the seller. |

- **Suppression is separate from consent.**
  - `bounce`: a permanent bounce.
  - `complaint`: the contact is also unsubscribed.
  - `seller`: the seller blocked them.
  - Suppressed contacts get no marketing email, whatever their consent. Only Estori support lifts `bounce` or `complaint`.
- **Marketing goes only to `consent = subscribed AND suppressed IS NULL`**, and not to an address on the global list. Confirmation emails go only to `pending` contacts that aren't suppressed.
- **Every transition writes a consent record** with its channel, wording, page and IP. The Subscribers page shows the history for each contact.
- **Customers are contacts too.**
  - Every live-mode order upserts the contact (`source: order`, `consent: none` when new). It adds 1 to `orders_count`, adds the total to `total_spent_cents`, moves `last_order_at`, and adds the product ids to `products_bought`.
  - Test-mode orders touch nothing.
  - This is the "one customer list". Customers who never opted in are shown but get no marketing.
- **Normalization:** emails are trimmed and lowercased. Syntax is checked with `validateEmail` (`worker/utils/validationUtils.ts`), the validator account sign-up uses, at most 254 characters. Addresses with local parts that belong to roles (`abuse`, `postmaster`, `noreply`, `no-reply`, `mailer-daemon`) are refused.
- **The seller may:**
  - add one contact by hand, after ticking "This person asked to get emails from {store}" (recorded as `added`, channel `seller`);
  - edit names and tags;
  - unsubscribe or block a contact;
  - delete a contact;
  - export CSV.

  Deleting a contact is also how a shopper's erasure request is carried out.

## 8. Sign-up forms in generated stores

### 8.1 The store API
The store script (`STORE_SCRIPT` in `worker/services/store-payments/store-script.ts`) gains:

```js
Estori.subscribe({ email, firstName, form, consentText }) // -> Promise<{ ok: true, confirm: true } | { ok: false, reason, message }>
```

- **Fields:** `form` is a label such as `footer` or `popup`, up to 40 characters, recorded on the consent. `consentText` is what the form showed, up to 200 characters. Without it, the store's `consent_text` is recorded.
- **It always resolves,** as the rest of the script does. On a network error, `reason` is `unavailable`.
- **Refusal reasons:** `invalid_email`, `unavailable` (marketing off, the store isn't live, or the network failed), `challenge_failed`, `too_many` and `preview`.
- **The answer never says whether an address is already on the list.** A visitor learns nothing about other people's addresses. An already subscribed contact gets no email, and the answer is the same `{ ok: true, confirm: true }`.
- **`Estori.store()` now includes `marketing: { signup: boolean, consentText: string }`,** so a store can hide its form when marketing is off.

### 8.2 Turnstile
- **One widget**, managed mode with `appearance: 'interaction-only'`, so most visitors never see a challenge.
  - The sitekey is `TURNSTILE_SITE_KEY` (a variable); the secret is `TURNSTILE_SECRET_KEY`.
  - The widget's hostnames are the stores domain (for example `estori.shop`), which covers every store subdomain, plus `localhost` in development.
  - Free widgets hold 10 hostnames and cover their subdomains. "Any hostname" needs Enterprise.
- **On the store's own subdomain,** `Estori.subscribe` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` and renders the widget in a container it adds near the end of the body. The container is shown only when Turnstile asks for interaction.
- **On a seller's own domain,** which isn't in the widget's list, the script renders the challenge in an iframe:
  1. The iframe loads `https://{slug}.{STORES_DOMAIN}/__estori/challenge`, a page Estori serves with a strict CSP.
  2. The page posts the token to its parent with `postMessage`, checking `event.origin`.
  3. **Spike in phase 1:** confirm that Turnstile runs in this cross-site iframe. If it doesn't, sign-ups on custom domains skip Turnstile. They then rely on double opt-in plus the tighter per-address limit below, and the seller sees a note.
- **Server side:**
  - `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, `remoteip` and an `idempotency_key`.
  - It accepts only `success` with `hostname` equal to the store's own subdomain (`{slug}.{STORES_DOMAIN}`) or to the request's host.
  - Tokens last 300 s and are single use.
  - When Turnstile is unreachable, the sign-up answers `unavailable` and nothing is stored.

### 8.3 The endpoint `POST /__estori/subscribe`
Answered in `handleStorePlatform`. Checks, in order:
1. **Request shape:** same-origin and JSON, with a body of 4 KB at most, as the checkout endpoint checks.
2. **Live store:** the viewer is `live`. Previews answer `preview`, so a seller tests from the Emails page instead.
3. **Marketing on:** `marketing_settings.status = 'on'`, not paused, and plan room for another contact (section 20).
4. **Rate limits:**
   - 5 sign-ups per client per store per 10 minutes (`RateLimitType.STORE_SIGNUP`);
   - 3 confirmation emails per address per day across all stores (`RateLimitType.SIGNUP_RECIPIENT`, keyed by a hash, like `CONTACT_RECIPIENT`);
   - over a limit, the answer is `too_many`.
5. **Turnstile.**
6. **Email syntax and role names.**
7. **Upsert:**
   - A new contact, or one at `none` or `unsubscribed`, becomes `pending`. A `requested` consent is recorded with the text, form, page (from `Referer`, origin and path only), IP and user agent. Then the confirmation email is sent, unless one went in the last 10 minutes.
   - A `pending` contact gets the confirmation sent again, at most 3 times a day.
   - A `subscribed` contact changes nothing.
   - A suppressed contact changes nothing, and no email is sent.

### 8.4 Double opt-in
Double opt-in is always on for forms. Gmail recommends confirmed addresses, and AWS's acceptable-use guidance asks for double opt-in.
- **The confirmation email** is sent at once (not queued) through the marketing sender, from the store's address.
  - Subject: "Confirm your subscription to {store}".
  - It has one button to `/e/confirm/{token}`, plus the store's postal address.
  - The token is valid for 7 days.
  - It carries no `List-Unsubscribe` header. It isn't marketing, and ignoring it is the opt-out.
- **The confirm page** shows the store's name and a **Confirm** button that POSTs to the same URL.
  - A GET never confirms on its own. Security scanners open links in mail, and that must not subscribe anyone.
  - On POST: `subscribed`, a `confirmed` record, the welcome automation's trigger, and a thank-you page with a link to the store.
  - An expired token shows "This link has expired" and a link to the store.

### 8.5 The build agent learns forms
A new skill, `worker/agents/think/skills/store-email-signup/SKILL.md`, is registered in `skills.ts`. It teaches:
- **The form itself:**
  - call `Estori.subscribe` from a form in the store's style;
  - show the store's consent text and a privacy link next to the field. California's notice at collection asks for one near the input. The store needs a privacy page, and the skill says to add one when it's missing.
  - show "Check your inbox to confirm" on success;
  - handle every refusal reason.
- **Pop-ups:** at most once per visitor per 14 days (`localStorage`), never before 10 seconds on the page, and always closable.
- **Hidden forms:** never pre-tick consent, and hide the form when `Estori.store().marketing.signup` is false.

## 9. Marketing consent at checkout

- **The checkbox.** Estori's checkout page (`renderPayPage`) shows a checkbox under the Email field, unticked: the store's `consent_text`, for example "Email me news and offers from Northwind Tea".
  - It appears only when the store has marketing on and `checkout_consent` is true. `StoreInfo` gains `marketing`.
  - Stripe's own `consent_collection.promotions` isn't supported with `ui_mode: 'elements'`, so the checkbox is Estori's.
- **Saving the contact.** When the email changes, and again on Pay, the page POSTs `{ checkoutId, email, marketing }` to `/__estori/checkout/contact`.
  - The request must be same-origin and JSON.
  - The checkout must belong to this store and be `creating` or `open`.
  - At most 20 updates per checkout.
  - It writes `contact_email`, `marketing_consent` and `contact_at`.
  - Failures are silent; checkout never waits on this.
- **When the order is recorded.** `recordStoreOrder` calls a new dep after the shopper email, `recordMarketingOrder(orderId)`. It never throws. It:
  - upserts the customer contact (section 7);
  - subscribes them, if the checkout had `marketing_consent`, with a `subscribed` record: channel `checkout`, the text shown, and the checkout id in `form`;
  - fires `order_placed` (thank-you);
  - exits their abandoned-cart enrollments;
  - attributes the order (section 18).
- **The address used.** The consent is tied to the email on the checkout's contact row. If Stripe's `customer_details.email` differs, the order's email becomes the customer, and the consent applies only when the two match after normalization.
- **Abandoned carts** come from checkouts with a `contact_email` and no order (section 13.3).

## 10. Templates and the editor

### 10.1 The document
A campaign or automation email is an `EmailDocument` (`shared/types/marketing-documents.ts`):

```ts
interface EmailDocument {
	version: 1;
	subject: string;   // 1-150 characters, one line
	preheader: string; // 0-150 characters, the inbox preview text
	blocks: EmailBlock[]; // 1-40 blocks
}
```

| Block | Fields | Notes |
| --- | --- | --- |
| `header` | `showLogo`, `align` (`left` or `center`) | The store's logo, or its name in the brand font |
| `hero` | `imageUrl` (nullable), `alt`, `heading` (at most 120 characters), `text` (rich, at most 600), `button` (`{ label, url }` or null) | |
| `text` | `markdown` (rich, at most 5,000), `align` | |
| `button` | `label` (at most 40), `url`, `align` | |
| `image` | `url`, `alt`, `link` (nullable), `width` (`full` or `half`) | https only |
| `products` | `productIds` (1-6, from the live manifest), `columns` (1-3), `showPrice`, `buttonLabel` | Name, image and price come from the manifest when the email is sent, never from the document |
| `divider`, `spacer` | `spacer.height` is 16, 32 or 48 | |
| `social` | `links: { network, url }[]` | `instagram`, `facebook`, `tiktok`, `x`, `youtube`, `pinterest` |
| `cart` | `buttonLabel` | Abandoned cart only: the checkout's lines and a button back to the cart |
| `order` | none | Thank-you only: the order's items |

- **The footer isn't a block.** Every marketing email ends with a locked footer the seller can't remove or edit:
  - the store's name and postal address;
  - "You're getting this email because you subscribed to {store}." For a checkout subscriber, "because you asked for news when you ordered from {store}";
  - **Unsubscribe**, linking to `/e/u/{token}`;
  - "Sent with Estori."
- **Placeholders:** `{{first_name}}` (falls back to "there") and `{{store_name}}`, in the subject, preheader, headings and text, with the same syntax and validation as `worker/services/shopper-emails/template.ts`.
- **Rich text** is a small Markdown subset, not HTML:
  - paragraphs separated by blank lines;
  - `**bold**`, `_italic_` and `[label](url)`;
  - lines starting with `- ` as a list.

  The parser builds a tree and the renderer escapes every text node. Sellers never enter HTML, so there is no HTML to sanitize.
- **URLs:**
  - Allowed: `https:`, `mailto:` in text links, and store paths (`/collections/tea`), which become absolute on the live store's address. `http:` is allowed only for local hosts in development.
  - Refused: `javascript:`, `data:`, protocol-relative `//` and anything with control characters or spaces.
  - Product links use `product_path`.
- **Colors and fonts:**
  - Colors are `#rrggbb` only.
  - Fonts come from the store's brand font (a Google Fonts family name, as the manifest allows), with a web-safe fallback stack. The font is linked with `<link>`, which Apple Mail honors and others ignore, so the fallback carries the design.
- **The theme** comes from the live store manifest's `brand` (`colors`, `font`, `logo`, `corners`), overridden by `marketing_settings.brand`. Without a brand, Estori's neutral theme is used.

### 10.2 The renderer (recommendation: Estori's own)
`renderEmailDocument(document, context)` is a pure function in `worker/services/marketing/render/`. It returns `{ subject, preheader, html, text, links }`.
- **HTML:**
  - a 600px centered table layout with inline styles;
  - a hidden preheader;
  - `role="presentation"` tables;
  - bulletproof buttons (a padded `<a>` inside a table cell);
  - product grids as table cells that stack under 480px through one `<style>` media query, with inline widths that still work where `<style>` is stripped;
  - dark-mode meta tags;
  - `alt` on every image.
- **Text version:** mirrors the HTML, with links written out.
- **Links:** every link is passed through `context.link(url, index)`. Phase 5 wraps them for click tracking (section 18), and `links` lists them in order for the document snapshot.

**Why not MJML:**
- `mjml` needs Node's `fs` and `path`.
- `mjml-browser` 5.4.1 is 331 KB gzipped, and nothing confirms it runs on Workers. Version 4.x threw "window is not defined".
- The Worker bundle is already about 6.4 MB gzipped.
- A fixed set of 11 blocks is about 400 lines of tested code, matches the shopper-email renderer's style, and keeps escaping in one place.

`@react-email/render` would add React rendering in the Worker for no gain.

### 10.3 Starter templates
Starter templates are code constants (`MARKETING_STARTERS` in `worker/services/marketing/render/starters.ts`), filled with the store's name and brand and its first products when a seller picks one. Each is a complete, honest draft:

| Starter | Contents |
| --- | --- |
| **Newsletter** | Header, hero, text, products (3), button, social |
| **Product launch** | Header, hero with the product's image, text, products (1), button |
| **Sale** | Header, hero ("{{store_name}} sale"), text with a placeholder sentence the seller must edit, products (3), button. No percentage or end date is invented. |
| **Welcome** (automation) | Header, text, products (3), button |
| **Abandoned cart** (automation) | Header, text, cart, button |
| **Thank-you** (automation) | Header, text, order, products ("You might also like", 3) |
| **Win-back** (automation) | Header, hero, text, products (3) |
| **Back in stock** (automation, phase 6) | Header, text, products (1) |

Sellers save their own templates (`marketing_templates`) from any document.

### 10.4 The editor
The editor is a page, `/emails/campaigns/:id`, and a dialog for automation steps.
- **Left: the block list.**
  - Add, move up or down, duplicate and delete.
  - Each block opens a small form: text fields, a Markdown text area with Bold, Italic and Link buttons, URL fields, a product picker over the live manifest's products, and alignment and size choices.
  - The footer shows as a locked block with "Required by law: your address and an unsubscribe link".
- **Top:** the subject (with a character count and placeholder chips) and the preheader.
- **Right: the preview.**
  - `POST /api/stores/:id/marketing/preview` renders the unsaved document with a sample contact, debounced at 500 ms.
  - It's shown in `<iframe sandbox="" srcDoc>`, as the shopper-email editor does, with a Desktop (600px) / Phone (375px) toggle.
- **Actions:** Save, **Send me a test** (to the seller's confirmed account email; 10 an hour; subject prefixed `[Test] `) and **Save as template**.
- **Checks before scheduling:**
  - every placeholder is valid;
  - every product still exists;
  - every link is allowed;
  - the subject has no line breaks;
  - the store has a postal address.

  Each problem names its block.

## 11. Writing by asking

- **Endpoint:** `POST /api/stores/:id/marketing/draft` with `{ prompt, kind, productIds }`.
  - `prompt` is up to 1,000 characters.
  - `kind` is optional: a starter kind, or `campaign`.
  - `productIds` is optional; when empty, the model may pick from the manifest.
- **Answer:** an `EmailDocument` built from the allowed blocks (`header`, `hero`, `text`, `button`, `products`, `divider`), plus the subject and preheader. Nothing is saved: the editor loads the draft, and the seller edits and saves.
- **Model access** follows the page-copy draft (`worker/api/controllers/sitePage/draftController.ts` and `worker/services/site-pages/draft.ts`):
  - `executeInference` with a zod schema, `agentActionName: 'templateSelection'`, `modelName: AIModels.GEMINI_3_6_FLASH`, `retryLimit: 1` and `maxTokens: 3000`;
  - the store's name, brand, product names, descriptions and prices go in as context;
  - one corrective retry when validation fails.
- **Validation** reuses `documentProblem`:
  - product ids must exist;
  - links must be the store's address or paths on it;
  - no supplier names (`SUPPLIER_NAMES`) and no AI-assistant names;
  - no prices in the text, since the product blocks show them.
- **Honest subjects.** The system prompt forbids invented deadlines, discounts, scarcity, "Re:" or "Fwd:" prefixes, and claims the store didn't make, because of CAN-SPAM's deceptive-subject rule and Washington's CEMA. The editor shows the same reminder next to the subject.
- **Rate limit:** `RateLimitType.EMAIL_DRAFT`, 20 an hour per user, with the same behavior as `PAGE_COPY_DRAFT`. Running out of AI credits answers 429, as page drafts do.
- **UI copy:** "Describe the email you want" and **Draft it**. No assistant or model is ever named.

## 12. Campaigns and scheduling

- **Statuses:**
  - `draft` → `scheduled` → `sending` → `sent`;
  - `sending` → `paused` → `sending`;
  - `draft` or `scheduled` → `canceled`, and `paused` → `canceled`;
  - `sending` → `failed`, only when the account is suspended.
- **Audience:** all subscribers, a saved segment, or a one-off filter (`SegmentFilter`, section 14.2). The editor shows a live count (`POST .../audience-count`).
- **Campaign rules:**
  - `excludeRecentBuyersDays` (null or 1-90);
  - `excludeUnengagedDays` (null or 30-365, default 180): skip contacts with no click and no order in that many days who subscribed before then;
  - `respectFrequencyCap` (default true).
- **Schedule:** **Send now**, or a date and time in the store's time zone, 5 minutes to 90 days ahead.
  - A time outside the store's send window is refused, with the next allowed time suggested.
  - Scheduling is refused when the audience count is larger than what's left of today's daily limit or this month's allowance, and the message says by how much.
- **Starting.** The minute cron claims due campaigns (`scheduled` → `sending`, `started_at`), freezes the document into `marketing_documents`, and sends one `materialize` message.
  - Materialization inserts sends in pages of 500, then sends their ids to the queue in messages of 25 ids each (at most 100 messages per `sendBatch`), and queues the next page.
  - When the cursor is done and no `queued`, `held` or `sending` rows remain, the campaign is `sent`.
- **Pause:**
  - Queued sends become `held`, and the consumer skips them.
  - Resume moves them back to `queued` and queues them again.
  - Cancel marks the remaining ones `skipped` (`canceled`).
- **Editing.** A scheduled campaign can be edited until it starts. A sending campaign can't be edited.

## 13. Automations

### 13.1 Model
- **One automation per kind per store,** created from its starter when the seller first turns it on.
- **`trigger`** is one of:
  - `{ type: 'subscribed', sources: ('form' | 'checkout')[] }`. Imports never trigger it.
  - `{ type: 'checkout_abandoned', afterMinutes: 30-1440 }`, default 60.
  - `{ type: 'order_placed' }`, for live orders only.
  - `{ type: 'no_order_for', days: 30-365 }`, default 90.
  - `{ type: 'back_in_stock' }`, in phase 6.
- **`steps`** are linear. Each one has:
  - `{ id, waitMinutes: 0-43,200, document, condition }`;
  - `condition` is null or one of `no_order_since_trigger`, `has_tag` (with `tag`), `not_clicked_previous` and `order_total_at_least` (with `cents`). When it's false, the email is skipped and the enrollment moves on.
  - There are 1 to 5 steps. `waitMinutes` counts from the trigger for the first step, and from the previous step after that.
- **`rules`:**
  - `reentry`: `once` per contact, `every` N days, or `per_trigger` (one enrollment per checkout or order).
  - `exitOnOrder`: default true, except for thank-you.
  - `respectSendWindow`: default false for welcome, abandoned cart and thank-you, which answer the shopper's own action; true for win-back.
  - `respectFrequencyCap`: default true.
  - `maxLateMinutes`: default 1,440. A step this late is skipped (`too_late`), for example after a pause.
  - `audience`: a `SegmentFilter` or null.

### 13.2 The engine
- **Enrolling.** An event creates an enrollment with `INSERT OR IGNORE` on (`automation`, `contact`, `trigger_key`), so a repeated trigger enrolls once. The rules' `reentry` decides the key:
  - `once`: the key is `once`;
  - `every`: the key is a date bucket;
  - `per_trigger`: the key is the checkout or order id.

  `next_run_at` is the trigger time plus the first wait.
- **Event triggers:**
  - `subscribed` fires on confirm and on a checkout subscribe;
  - `order_placed` fires from `recordMarketingOrder`.
- **Sweeps:**
  - `checkout_abandoned` runs every 15 minutes;
  - `no_order_for` runs daily: contacts whose `last_order_at` is exactly N days back, keyed by that date.
- **Running due steps.** The minute cron claims enrollments due now (200 per run, with a lease on `next_run_at`). For each:
  1. If the automation is off or paused, leave it.
  2. If the store is paused, leave it.
  3. If `exitOnOrder` is set and the contact has ordered since enrolling, the enrollment becomes `exited` (`ordered`).
  4. If the step's condition is false, skip the email.
  5. Otherwise create the send (`a:{enrollmentId}:{stepId}`) and queue it.
  6. Move `step_id` and `next_run_at` to the next step, or mark the enrollment `completed`.
- **Editing.** Turning an automation off cancels its active enrollments. Editing steps keeps step ids. An enrollment whose next step was deleted moves to the following step, or completes.

### 13.3 The four starters
| Automation | Trigger | Steps | Rules |
| --- | --- | --- | --- |
| **Welcome** | subscribed (form, checkout) | Email at 0 min | `once` |
| **Abandoned cart** | checkout_abandoned, 60 min | Email at 0; second email 23 h later, condition `no_order_since_trigger` | `per_trigger`; exits on order |
| **Thank-you** | order_placed | Email 3 days after | `per_trigger` |
| **Win-back** | no_order_for 90 days | Email at 0 | `every` 180 days |

Abandoned cart is marketing (section 2), so it goes only to subscribed contacts, as every automation does. That's the public page's promise: "People who joined your list."

**Finding abandoned checkouts.** A checkout counts as abandoned when it:
- has a `contact_email` whose contact is subscribed;
- has `contact_at` older than `afterMinutes` and newer than 7 days;
- has no `store_orders` row;
- is in `live` mode;
- has no order from the same email at this store since the checkout started;
- is the newest such checkout for that email in the last 24 hours. The checkout page replaces checkouts when the cart changes, so one visit can leave several.

**Restoring the cart.**
- The `cart` block's button links to `https://{store host}/__estori/pay?restore={token}`. The token is signed and holds the checkout id and contact id.
- The checkout page's script reads `restore`, calls `GET /__estori/cart/restore/{token}`, and writes the lines into `Estori.cart` with `setQuantity`. It then removes the parameter and starts checkout as usual.
- That endpoint answers only `[{ variantId, quantity }]` and `shipTo`, for a checkout of this store. Prices are recomputed by the new checkout.

## 14. Sending rules

### 14.1 Where rules live
| Level | Rules | Set by |
| --- | --- | --- |
| Platform | Kill switch (`MARKETING_SENDING=off` variable); SES `EnforcementStatus` not `HEALTHY` or `SendingEnabled` false; daily quota reached | Estori |
| Plan | Contacts per store, emails per month, emails per day (section 20) | Estori; admins override per user in KV `user_config:{userId}` under `marketing` |
| Store | On/off, pause, time zone, send window, frequency cap, daily limit (at most the plan's), Estori's reputation pause | Seller, and Estori |
| Campaign | Audience, recent-buyer and unengaged exclusions, honor the frequency cap, schedule | Seller |
| Automation | Trigger, audience, steps with waits and conditions, re-entry, exit on order, send window, frequency cap, lateness | Seller |
| Contact | Consent, suppression, global hard bounces | Shopper and events |

### 14.2 Segments
A `SegmentFilter` is `{ match: 'all' | 'any', conditions }`, with 1 to 10 conditions:
- `tag` `has` or `not_has` a value;
- `source` `is` or `is_not`;
- `subscribed_at`, `within_days` or `before_days`;
- `orders_count` `gte` or `lte` a number;
- `total_spent_cents` `gte` or `lte` a number;
- `last_order_at` `within_days`, `before_days` or `never`;
- `purchased_product` `has` or `not_has` a product id;
- `last_click_at`, `within_days` or `not_within_days` (phase 5 data).

`compileSegment` turns a filter into a parameterized SQL `WHERE` fragment over `marketing_contacts c`. Tags and products use `EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ?)`. A filter never produces SQL text from seller input: values are always bound.

### 14.3 The evaluation order
`decideSend(input)` is a pure function, run when a send is created and again just before SES is called. It returns one of:
- `{ action: 'send' }`;
- `{ action: 'skip', reason }`;
- `{ action: 'defer', until, reason }`;
- `{ action: 'hold', reason }`.

| # | Rule | Fails as |
| --- | --- | --- |
| 1 | Platform kill switch; SES health and the daily quota | Kill switch: `hold`: `platform`. An SES hold: `defer` until it ends, `platform`. |
| 2 | Store marketing on and not paused; campaign or automation not paused | `hold`: `store_paused` or `paused` |
| 3 | Consent `subscribed` (`pending` for confirmations) | `skip`: `not_subscribed` |
| 4 | Not suppressed, and not on the global bounce list | `skip`: `suppressed` |
| 5 | Exclusions: a recent buyer, unengaged, or (automations) ordered since the trigger or the step's condition is false | `skip`: `recent_buyer`, `unengaged`, `ordered` or `condition` |
| 6 | Lateness (automations): due more than `maxLateMinutes` ago | `skip`: `too_late` |
| 7 | Frequency cap: marketing sends to this contact in the last `days` days have reached `max` (confirmations and tests don't count) | campaigns `skip`: `frequency_cap`; automations `defer` until the oldest counted send leaves the window |
| 8 | Store daily limit and plan monthly allowance | campaigns `defer` to tomorrow's window (schedule-time checks make this rare); automations `defer` to the next UTC day; monthly → `hold`: `allowance` |
| 9 | Send window (when the rule applies) | `defer` to the next window opening in the store's time zone |

Then the email is sent.

- **Hard rules first.** Rules 3 and 4 come before everything that might delay, so a contact who unsubscribed while a send waited is never mailed.
- **Re-checked at send time.** The consumer runs `decideSend` again right before SES, with fresh contact and store rows, so pausing or unsubscribing works even for sends already in the queue.
- **Skipped sends** count in the campaign's `skipped`, with their reason, and the campaign page shows them.

## 15. The sending pipeline

### 15.1 The queue
- **Queue:** `estori-marketing`, with a dead-letter queue `estori-marketing-dlq`. The staging queues are `estori-marketing-staging` and `estori-marketing-staging-dlq`.
- **Consumer settings:** `max_batch_size: 4`, `max_batch_timeout: 5`, `max_retries: 10`, `max_concurrency: 4`.
- **Messages** (128 KB at most):
  - `{ type: 'materialize', campaignId }`;
  - `{ type: 'send', sendIds: string[] }` with at most 25 ids, so a batch of 4 sends at most 100 emails.
- **Without the queue binding** (local development and tests), the producer runs the message at once inside `ctx.waitUntil`.

### 15.2 Pacing
- **The budget.** `GetAccount.SendQuota.MaxSendRate` is cached in KV for an hour. Each consumer allows itself `floor(MaxSendRate × 0.8 / max_concurrency)` sends a second, at least 1. It waits between sends with `scheduler.wait`.
- **Too fast.** If SES still says the rate was exceeded, the consumer stops, releases the unsent ids back to `queued`, and retries the message with `delaySeconds: 30`.
- **Fairness.** Messages are small (25 sends), so stores interleave in the queue. Each store's daily limit keeps one store from filling the day.

### 15.3 Idempotency
- **One row per contact.** A send row is unique per `dedupe_key`, so materializing twice, or an automation step running twice, creates one row.
- **One sender at a time.** `claim(id, now, leaseUntil)`:

  ```sql
  update ... set status = 'sending', attempts = attempts + 1, next_attempt_at = :lease
  where id = ? and status = 'queued' and next_attempt_at <= :now
  returning *
  ```

  The lease is 10 minutes.
- **A crash after SES accepted.** If a run dies after SES accepted the email but before Estori recorded it, the row stays `sending`.
  - The DELIVERY, BOUNCE or COMPLAINT event carries the `estori_send` tag, and the event handler moves a `sending` row to `sent` with the message id.
  - A sweep marks rows still `sending` 30 minutes after their lease ends as `failed` ("outcome unknown"). They are never retried.
  - A rare missed email is better than a duplicate campaign.

### 15.4 Sending one email (`sendOne`)
1. Claim the row.
2. Load the contact, the store's settings, and the document snapshot.
3. Run `decideSend`.
   - `skip`: write it and stop.
   - `defer`: back to `queued` with `next_attempt_at = until`. The minute cron re-queues due deferred rows, 500 per run.
   - `hold`: becomes `held`.
4. Render, with:
   - the contact's placeholders;
   - links through `context.link`;
   - the unsubscribe token;
   - the footer;
   - the store's From, Reply-To and tenant.
5. Send through the marketing sender.
6. Record the result.

### 15.5 SES errors
`classifySesError(error)` maps each SES error to an outcome:

| Error | Outcome | What happens |
| --- | --- | --- |
| 429, or any error whose message has "Maximum sending rate exceeded" | `throttled` | Release, then retry the message in 30 s |
| "Daily message quota exceeded" | `daily_quota` | Release, set the platform hold in KV until 00:00 UTC, alert the team |
| `SendingPausedException`, `AccountSuspendedException` | `paused` | Release, set the platform hold, alert the team, poll `GetAccount` |
| `MailFromDomainNotVerifiedException`, `NotFoundException` (identity, tenant or configuration set) | `config` | Fail the send, pause the store with `paused_by = 'estori'`, alert |
| `MessageRejected`, `BadRequestException`, any other 4xx | `rejected` | Fail the send, with the message as the error |
| 5xx or a network error | `uncertain` | Back to `queued` with `next_attempt_at` 10 minutes later. If an event marks it `sent` in that time, the retry is skipped. Fail after 3 attempts. |

### 15.6 Throughput
At `MaxSendRate` 14 a second (a common first production quota), a 10,000-contact campaign takes about 15 minutes. At 100 a second, it takes about 2 minutes. Consumers run up to 15 minutes of wall time, and a message of 25 sends at 3 a second takes about 9 seconds.

## 16. Unsubscribe, confirmation and preferences pages

`handleMarketingLinks` answers on the marketing link host:
- **`GET /e/u/{token}`** shows a page in the store's colors: "Unsubscribe from {store}'s emails?" with an **Unsubscribe** button (a POST form to the same URL).
  - If the contact is already unsubscribed, it says so and offers **Subscribe again**, which POSTs to `/e/u/{token}/resubscribe` and is recorded as `resubscribed`, channel `unsubscribe_page`.
- **`POST /e/u/{token}`** is the RFC 8058 one-click target.
  - The body is `List-Unsubscribe=One-Click`, as multipart or url-encoded, or the page's own form post.
  - It unsubscribes at once, writes `unsubscribed` with channel `one_click` or `unsubscribe_page` and the send id, sets the send's `unsubscribed_at`, and adds 1 to the campaign's or automation's counter.
  - It answers 200 with a short page: no redirect, no cookies, no authentication.
  - It works for 2 years from the send, beyond CAN-SPAM's 30 days, because the token is a signed send id and doesn't expire.
- **Preferences.** There are no topics: one store list means "Unsubscribe" is the whole preference. The page links to the store, and the seller's Reply-To answers questions.
- **Tokens.**
  - The format is `{id}.{mac}`. The MAC is the first 16 bytes of HMAC-SHA-256 under a key derived from `JWT_SECRET` with HKDF-SHA-256 (salt `estori-marketing`, info = the token kind), written in base64url.
  - Each kind (`unsubscribe`, `confirm`, `click`, `open`, `restore`) has its own key, so one kind can't stand in for another.
  - `JWT_SECRET` is never regenerated, which the launch spec states, so links keep working.
- **CSP on these pages:** `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. They load no scripts, and carry `noindex` and `Cache-Control: no-store`.

## 17. Bounces, complaints and suppression

### 17.1 Receiving events (recommendation: EventBridge)
- **The route:**
  1. The configuration set `estori-marketing` has an EventBridge destination (the default bus).
  2. A rule matches `source: ["aws.ses"]` and these `detail.eventType` values: Delivery, Bounce, Complaint, Reject and Rendering Failure. It also matches tenant status changes; their exact detail-type is unverified, and the phase 1 spike records it.
  3. The rule targets an API destination: `POST https://news.estori.app/e/ses-events`, through a connection that sends `x-estori-events-key: {SES_EVENTS_KEY}`.
- **The Worker:**
  - compares the header in constant time;
  - checks `account` against `SES_ACCOUNT_ID`;
  - parses `detail` and applies the event.
  - It answers 200 for applied, ignored or unknown events. It answers 500 on a D1 failure, so EventBridge retries: for 24 hours, 185 attempts, with a dead-letter queue.
  - It must answer within 5 seconds, the API destination's timeout.
- **Why EventBridge:**
  - a shared-secret header instead of X.509 signature checks;
  - retries for 24 hours instead of SNS's 3 tries;
  - a DLQ;
  - $0.20 per million;
  - tenant events only arrive there anyway.
- **The SNS alternative,** if the owner prefers it:
  - verify `SignatureVersion 2`, which must be set on the topic;
  - build the string to sign:
    - for a Notification: Message, MessageId, Subject if present, Timestamp, TopicArn, Type;
    - for a SubscriptionConfirmation: Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type;
  - accept `SigningCertURL` only over https on `sns.{region}.amazonaws.com`, and cache the certificate;
  - read the certificate with `node:crypto` `X509Certificate` (`nodejs_compat` is on), then verify RSA-SHA256;
  - check `TopicArn`, then confirm subscriptions by fetching `SubscribeURL`.

### 17.2 What each event does
Every event is found through `mail.tags.estori_send`, or else `ses_message_id`. Applying an event is idempotent, and only first timestamps are written, because EventBridge delivery is best-effort and may be out of order.

| Event | Effect |
| --- | --- |
| Delivery | `delivered_at`; a `sending` row becomes `sent`; the campaign or automation's `delivered` goes up by 1 |
| Bounce, `Permanent` | `bounced_at`, `bounce_type`. The contact is suppressed with `bounce` (a `suppressed` record), and the address goes on the global list. `bounced` goes up by 1. |
| Bounce, `Transient` or `Undetermined` | `bounce_type` only. Three transient bounces in 30 days for a contact suppress it with `bounce`. |
| Bounce subtype `OnAccountSuppressionList` | Like Permanent, but it doesn't count toward the store's bounce rate |
| Complaint | `complained_at`. The contact is unsubscribed (channel `complaint`) and suppressed with `complaint`. `complained` goes up by 1, and the store's thresholds are checked. |
| Reject or Rendering Failure | The send is `failed`, and the team is alerted with `marketing-send-rejected` |
| Tenant `DISABLED` | The store is paused with `paused_by = 'estori'` and a reason, the team is alerted, and the seller is emailed |
| Tenant `REINSTATED` or `ENABLED` | Nothing automatic: the team unpauses after review |

### 17.3 Suppression levels
- **SES account level:** `BOUNCE` only, set by the owner with `PutAccountSuppressionAttributes`.
- **Estori global** (`marketing_global_suppressions`): permanent bounces, checked before sending. That saves the SES call and keeps the quota for real mail.
- **Per store** (`marketing_contacts.suppressed`): complaints, bounces and the seller's blocks.

  Gmail sends no complaint feedback to SES, so Gmail complaints show only in Postmaster Tools (section 26). That is one more reason for double opt-in and the unengaged exclusion.

### 17.4 Automatic pausing
After every bounce or complaint event, and daily, Estori computes each store's rates over its last 30 days of delivered marketing sends. It pauses the store (`paused_by = 'reputation'`) when:
- permanent bounces are above **4%** with at least 200 sends; or
- complaints are above **0.2%** with at least 500 sends; or
- there are **5 complaints** in 24 hours, at any volume.

A pause holds queued sends, emails the seller with the reason and what to do, and alerts the team (`marketing-store-paused`). Only an Estori admin lifts a reputation pause (`POST /api/admin/marketing/stores/:id/unpause`). These limits are tighter than SES's review levels (5% and 0.1%) because the account's rates are what SES judges.

- **Platform.** The hourly `GetAccount` check:
  - sets the platform hold and alerts when `EnforcementStatus` isn't `HEALTHY` or sending is disabled;
  - alerts when `SentLast24Hours` passes 80% of `Max24HourSend`.

## 18. Stats and revenue attribution

### 18.1 Tracking (recommendation: Estori's own, phase 5)
- **Clicks.** At send time each link becomes `https://news.estori.app/e/c/{token}/{index}`. The token is one signed click token per send (`{sendId}.{mac}`), and `index` is the link's position in the email.
  - The handler verifies the token, then looks up the send and its document snapshot. It redirects (302) to `links[index]`, never to a URL from the request, so there's no open redirect. Changing the index can only pick another link of the same email.
  - On the first click it sets `clicked_at`. Every click sets `last_clicked_at` and the contact's `last_click_at`. It adds to `marketing_link_clicks` and to the campaign or automation's `clicked` (unique).
  - The unsubscribe link and `mailto:` links aren't wrapped.
- **Opens.** A 1×1 GIF at `/e/o/{sendId}.{mac}`, placed at the end of the HTML.
  - The first open sets `opened_at` and the contact's `last_open_at`, and adds to `opened`.
  - **Machine opens.** An open is treated as automatic when it comes from an Apple network (`request.cf.asn` 714 or 6185) or arrives within 60 seconds of delivery. These open-from-proxy heuristics aren't published by Apple, so they're flagged for review with real data. Such an open sets `machine_opened_at` and adds to `machine_opened` instead.
  - Apple Mail is about 77% of opens (Litmus, September 2026). Mail Privacy Protection prefetches pixels, so raw opens mean little.
- **Why our own tracking:**
  - Links stay on the From domain, where SES's alternative is `awstrack.me` or a custom HTTPS domain behind a host-forwarding CDN.
  - No open or click events go through EventBridge.
  - Clicks update stats at once.
  - The same `/e/` handler already exists for unsubscribe.
- **Security scanners.** Clicks within 10 seconds of delivery on 3 or more links of the same email count as one scanner visit, not clicks. Unique clicks count each contact once.

### 18.2 What sellers see
- **Per campaign and per automation step:**
  - Recipients, Delivered, Bounced, Unsubscribed and Complaints.
  - **Clicks**, unique, with the click rate over delivered.
  - **Opens** as "Opens (estimated)": unique opens minus machine opens, with a tooltip saying some mail apps open every email automatically, so clicks and sales are the better measure.
  - **Orders** and **Revenue**, plus a table of clicks per link.
- **Per store (the Emails overview):**
  - subscribers now, and their change over the last 30 days (from consent records);
  - emails sent in the last 30 days;
  - revenue attributed in the last 30 days;
  - the top 5 campaigns by revenue.

### 18.3 Attribution
- **The rule.** When a live order is recorded, Estori looks for the latest click by a contact with the order's email, at this store, within **5 days** before the order. If there is one, it writes `marketing_attributions` and adds the order and its total to that campaign's or automation's counters.
- **Opens don't count,** because of the machine opens above.
- **One email per order:** the last click wins.
- **Refunds** don't reduce attributed revenue, which is shown as "orders placed".

## 19. Abuse prevention and imports

- **Marketing rules for sellers.** Turning marketing on requires accepting them, which records `terms_accepted_at`. The rules:
  - Email only people who asked for this store's emails.
  - No bought, rented, shared or scraped lists.
  - No misleading subjects.
  - A real postal address.

  They become a new section of the Terms (section 23).
- **New stores start small.** Seller level `new` gets the lower daily limit (section 20). Imports need seller level `established` and a Premium plan. Before billing exists, an admin sets the plan in `user_config`.
- **Imports (phase 3).**
  - **File:** CSV with `email`, and optionally `first_name`, `last_name` and `tags`. At most 5,000 rows and 1 MB per file, and 2 imports a day.
  - **Attestation:** the seller ticks "Everyone in this file asked to get emails from {store}, and I can show how". The wording and time are recorded on the import and on each `imported` consent record.
  - **Skipped rows** are counted by reason:
    - invalid syntax;
    - role addresses;
    - duplicates;
    - contacts unsubscribed or suppressed at this store (an import never resubscribes);
    - addresses on the global bounce list;
    - rows over the plan's contact limit.
  - **Monitoring:** the first campaign to a list that is more than 20% imported contacts is limited to 1,000 recipients. The rest is held for an admin's release, or released automatically after 24 hours if the store's bounce rate stays under 2%.
- **Signals the team sees:** an admin view of stores with marketing on, showing sends, bounce rate, complaints, pauses and imports.
- **Contacts never move between stores,** even stores of the same seller.

## 20. Plans, limits and pricing options

**Recommended limits.** These live in one table, `MARKETING_PLAN_LIMITS` in `shared/types/marketing.ts`. Enforcement reads them through `GlobalConfigurableSettings.marketing`, so an admin can override them per user in KV.

| | Basic (free) | Premium | Enterprise |
| --- | --- | --- | --- |
| Contacts per store (subscribed and pending) | 250 | 10,000 | Custom |
| Marketing emails per month, per seller | 1,000 | 50,000 | Custom |
| Emails per day, per store | 500 (new seller) / 1,000 (established) | 2,000 (new) / 20,000 (established) | Custom |
| Sign-up forms, checkout consent, double opt-in | Yes | Yes | Yes |
| Campaigns, starter templates, writing by asking | Yes | Yes | Yes |
| Automations (welcome, abandoned cart, thank-you, win-back) | Yes | Yes | Yes |
| Imports | No | Established sellers | Yes |
| Own sending domain (phase 6) | No | Yes | Yes |
| Stats and revenue | Yes | Yes | Yes |

**Pricing options for the owner:**
1. **Included allowances** (above). No overage until billing exists; sends past the allowance are held.
   - SES cost at the allowance: about $0.10 per Basic seller a month, and $5.25 for a Premium seller at the cap.
   - **Recommended for launch.**
2. **Credits for overage.** Once billing exists, past the allowance, about 50 credits per 1,000 emails. That's about $0.25 at the first Premium tier's rate of $99 for 20,000 credits, roughly 2.4 times SES's cost. It would go into `CREDIT_ACTIONS` and the calculator.
3. **Contact tiers,** as most email tools charge. This is simpler to explain, but needs billing and a new axis on the pricing page.

Until billing exists, a user's marketing plan is `user_config:{userId}.marketing.plan`, `basic` by default.

## 21. Staging and local development

- **Staging:**
  - It uses the same AWS account but region **us-east-2**, left in the **SES sandbox**. Sandbox status is per region, so production's access in us-east-1 doesn't reach staging.
  - The sandbox only delivers to verified identities. The owner verifies the team's addresses there, or the `pluriza.com` domain.
  - Staging has its own identity (`news-staging.estori.app`), configuration set (`estori-marketing-staging`), EventBridge route, queue and IAM user.
  - The marketing sender reuses `EMAIL_RECIPIENT_ALLOWLIST` (`@pluriza.com`) and the `[Staging] ` subject prefix. The wrappers in `worker/services/email/sender.ts` are made generic and shared, so staging can't email strangers even if the sandbox is lifted by mistake.
  - Turnstile on staging uses Cloudflare's test keys or a staging widget.
- **Local development:**
  - Without SES keys, the marketing sender writes each email to the dev log, with its confirm and unsubscribe links on `http://localhost:8100/e/...`.
  - Without the queue binding, messages run inline.
  - Without Turnstile keys in development, Cloudflare's always-pass test keys are used: sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
- **Production:** `MARKETING_SENDING` is unset or `on`. Setting it to `off` holds all marketing at once.

## 22. Security

- **Owner checks** (`AuthConfig.ownerOnly`) on every `/api/stores/:id/marketing/...` route. The store pickers are `authenticated`. Admin routes are `AuthConfig.admin`.
- **Public endpoints:**
  - `/__estori/subscribe`, `/__estori/checkout/contact` and `/__estori/cart/restore/{token}` are same-origin and JSON, size-limited and rate-limited. The first is Turnstile-checked, and none of them leaks list membership.
  - `/e/*` takes only signed tokens. `/e/ses-events` takes only the secret header.
- **No HTML from sellers.** Text is escaped. URLs, colors and fonts are allow-listed. Subjects and preheaders are stripped of line breaks, and headers are built only by Estori. The preview iframe is sandboxed.
- **AWS keys:**
  - One IAM user per environment, holding only the actions in section 26.
  - The keys are Worker secrets (`SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`), never logged.
  - The SES client never logs request bodies, only the status, the error code and the send id.
- **Shopper data in logs:** recipients appear only masked (`maskEmail`).
- **CSV exports** are generated on request for the owner and never stored.
- **Imports** are parsed in the Worker with limits (section 19). The file isn't stored.
- **Domain claims** (phase 6) are exclusive across stores, and the From domain is checked before every send (section 5.3).
- **AI drafts** are validated like seller input, and never sent without the seller saving them.

## 23. Privacy and legal updates

The owner should have counsel review these before launch (CAN-SPAM, CCPA notice at collection, Washington CEMA).
- **Privacy Policy (`src/content/legal/privacy.md`):**
  - **Service providers:** add Amazon Web Services: "sending the marketing emails stores send their subscribers, and processing delivery, bounce and complaint reports".
  - **Section 10, "Your store's visitors":**
    - When someone signs up for a store's emails, or ticks the box at checkout, Estori stores their email, name if given, the consent record (when, where, the wording, IP address and browser) and their email activity (delivered, opened, clicked) for the store.
    - The store's owner sees them.
    - Every email has a one-click unsubscribe.
    - Sends are kept 180 days.
    - Turnstile checks sign-ups for bots.
  - **Erasure:** a subscriber can ask the store, or Estori, to be deleted.
- **Terms (`src/content/legal/terms.md`):**
  - a new subsection under Acceptable use, "Email to your customers":
    - the marketing rules in section 19;
    - the seller is the sender and advertiser under CAN-SPAM, responsible for their content and consent;
    - Estori may pause or end marketing for any store that breaks the rules or harms deliverability;
  - bump `TERMS_VERSION`.
- **The store's own privacy notice.** The sign-up skill tells the build agent to link it next to sign-up forms. Estori's privacy policy already says sellers are responsible for their visitors' notice.
- **The postal address in every footer** is the seller's, never Estori's.

## 24. API

**Seller routes:** all `ownerOnly` on `/api/stores/:id/marketing`.

| Method and path | Does | Phase |
| --- | --- | --- |
| `GET /settings`, `PUT /settings` | Read and save settings | 1 |
| `POST /status` | `{ status: 'on' \| 'off', acceptRules }`. Turning on requires a postal address, a sender name and accepted rules; it creates the SES tenant. | 1 |
| `POST /pause` | `{ paused }`: the seller's own pause and resume. It can't lift a pause by Estori. | 1 |
| `GET /contacts?consent=&q=&cursor=` | Contacts page (50), with counts per state | 1 |
| `POST /contacts` | Add one contact, with attestation | 1 |
| `PATCH /contacts/:contactId` | Names, tags, unsubscribe, block | 1 |
| `DELETE /contacts/:contactId` | Delete a contact and its consent records | 1 |
| `GET /contacts/:contactId` | A contact, with consent history and recent sends | 1 |
| `GET /contacts.csv` | Export | 1 |
| `GET /templates`, `POST /templates`, `PUT /templates/:tid`, `DELETE /templates/:tid` | Saved templates; `POST` from a starter or a document | 2 |
| `GET /starters` | Starter documents filled with this store's brand and products | 2 |
| `POST /preview` | `{ document, kind }` → `{ subject, html, text }` | 2 |
| `POST /test` | Send a document to the seller (10 an hour) | 2 |
| `POST /draft` | Writing by asking (section 11) | 2 |
| `GET /segments`, `POST /segments`, `PUT /segments/:sid`, `DELETE /segments/:sid` | Saved segments | 3 |
| `POST /audience-count` | `{ audience, rules }` → `{ count }` | 3 |
| `GET /campaigns`, `POST /campaigns`, `GET /campaigns/:cid`, `PUT /campaigns/:cid`, `DELETE /campaigns/:cid` (drafts only) | Campaigns | 3 |
| `POST /campaigns/:cid/schedule`, `/pause`, `/resume`, `/cancel` | Lifecycle | 3 |
| `POST /imports` | CSV upload with attestation | 3 |
| `GET /automations`, `PUT /automations/:kind`, `POST /automations/:kind/status` | Automations | 4 |
| `GET /stats`, `GET /campaigns/:cid/stats`, `GET /automations/:kind/stats` | Stats | 5 |
| `GET /domain`, `PUT /domain`, `POST /domain/check`, `DELETE /domain` | Own sending domain | 6 |

**Other routes:**
- `GET /api/marketing/stores` (`authenticated`): the seller's stores with a live store, for the picker.
- `POST /api/admin/marketing/stores/:id/unpause` and `GET /api/admin/marketing/stores` (`AuthConfig.admin`).

**Store paths** on the store host:
- `POST /__estori/subscribe`;
- `POST /__estori/checkout/contact`;
- `GET /__estori/cart/restore/{token}`;
- `GET /__estori/challenge`;
- and in phase 6, `POST /__estori/notify`.

**Link host:** `/e/u/{token}` (GET and POST), `/e/u/{token}/resubscribe` (POST), `/e/confirm/{token}` (GET and POST), `/e/c/{token}/{index}`, `/e/o/{token}` and `/e/ses-events` (POST).

## 25. The Emails page

The Emails page (`/emails`) becomes a page with tabs, sharing the store picker. It keeps `SHOPPER_EMAILS_PATH`.
- **Order emails** (`/emails`): unchanged. Its note "Cloudflare … doesn't allow marketing email" is replaced by "Order emails go to every shopper. Marketing emails go only to your subscribers."
- **Subscribers** (`/emails/subscribers`):
  - counts per state;
  - search, and a table (cards on phones) of email, name, state, source, orders and date;
  - a contact drawer with the consent history;
  - Add contact, Export, and Import (phase 3).
- **Templates** (`/emails/templates`, phase 2): starters and saved templates, each opening the editor at `/emails/templates/:id` with preview, test send and drafting by asking. Phase 2 ships this tab before campaigns exist.
- **Campaigns** (`/emails/campaigns`): the list with status and key stats, **New campaign** (blank, from a starter, from a saved template, or "Describe it"), and the editor at `/emails/campaigns/:id` with audience, rules and schedule steps.
- **Automations** (`/emails/automations`): four cards with an on/off switch, a summary such as "1 email, 1 hour after a shopper leaves checkout", and stats. Each opens an editor with the trigger, steps, conditions and rules.
- **Settings** (`/emails/settings`): turn marketing on (with the rules to accept), sender name, Replies go to, postal address, time zone, send window, frequency cap, daily limit, checkout checkbox and wording, brand overrides, social links, product page path, and (phase 6) own domain.
- **When marketing is off,** the Subscribers, Campaigns and Automations tabs show an empty state with **Turn on email marketing**.
- **When the store is paused,** a banner shows who paused it and why.

## 26. Owner setup steps

Do these once per environment. Production uses us-east-1; staging uses us-east-2.

1. **AWS account and region.** Use the company's AWS account, with MFA on the root user and billing alerts. In SES (us-east-1), switch the pricing plan to à la carte if that decision is taken (section 30).
2. **Identity.** Create the domain identity `news.estori.app` with Easy DKIM, RSA 2048.
   - In Cloudflare DNS for `estori.app`, add the 3 DKIM CNAMEs, DNS only (not proxied).
   - Set the custom MAIL FROM `bounce.news.estori.app`: MX `10 feedback-smtp.us-east-1.amazonses.com`, and TXT `v=spf1 include:amazonses.com ~all`.
3. **DMARC.** Check `_dmarc.estori.app`. If there is none, add `v=DMARC1; p=none; rua=mailto:dmarc@estori.app`, with a mailbox or Email Routing rule for the reports. Tighten it to `quarantine` after 30 days of clean reports.
4. **Configuration set** `estori-marketing`:
   - reputation metrics on;
   - SES open and click tracking off;
   - event destination EventBridge (default bus) for Delivery, Bounce, Complaint, Reject and Rendering failure.
5. **Account suppression:** reasons = `BOUNCE` only.
6. **EventBridge.**
   - Create a connection `estori-ses-events` with API key auth, header `x-estori-events-key` and a long random value. Keep the same value for the Worker secret `SES_EVENTS_KEY`.
   - Create an API destination `POST https://news.estori.app/e/ses-events`, with a rule on `source = aws.ses` targeting it, plus a dead-letter SQS queue.
   - Note the AWS account id, which goes in `SES_ACCOUNT_ID`.
7. **IAM.** Create the user `estori-ses-production` with this policy only, and an access key:
   - `ses:SendEmail` on `arn:aws:ses:us-east-1:{account}:identity/*`, `arn:aws:ses:us-east-1:{account}:configuration-set/estori-marketing` and `arn:aws:ses:us-east-1:{account}:tenant/*`;
   - `ses:GetAccount` on `*`;
   - `ses:CreateTenant`, `ses:GetTenant`, `ses:DeleteTenant` and `ses:CreateTenantResourceAssociation` on `arn:aws:ses:us-east-1:{account}:tenant/*`, plus the identity and configuration-set ARNs;
   - in phase 6, `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity` and `ses:PutEmailIdentityMailFromAttributes` on `identity/*`.

   The exact ARN forms for tenants are checked in the phase 1 spike.
8. **Production access.** Request it for us-east-1 with `MailType: MARKETING`, website `https://estori.app`, and a use case describing:
   - double opt-in forms and checkout consent;
   - one-click unsubscribe;
   - bounce and complaint handling through EventBridge;
   - per-store tenants and automatic pauses;
   - no purchased lists.

   Then ask Service Quotas for a daily quota of at least 50,000 and 14 a second, or more.
9. **Cloudflare.**
   - Add the custom domain `news.estori.app` to the production Worker. The PR adds the route; the deploy creates the record.
   - Make sure Cloudflare Access doesn't cover `news.estori.app`.
   - Create the queues: `wrangler queues create estori-marketing` and `estori-marketing-dlq`, plus the staging pair.
   - Create a Turnstile widget (managed) with the stores domain and `localhost` as hostnames.
10. **Worker secrets and variables** for production and staging:
    - **Secrets:** `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_EVENTS_KEY`, `TURNSTILE_SECRET_KEY`.
    - **Variables in the wrangler config:** `SES_REGION`, `SES_ACCOUNT_ID`, `SES_CONFIGURATION_SET`, `MARKETING_FROM_DOMAIN`, `MARKETING_LINK_HOST`, `TURNSTILE_SITE_KEY`.
    - Set each secret with `npx wrangler secret put NAME --config wrangler.estori.jsonc`, which prompts for the value without echoing it.
11. **Postmaster Tools.** Register `estori.app` with Gmail Postmaster Tools and watch the spam rate weekly; Gmail gives SES no complaint data. Also join Yahoo's complaint feedback loop.
12. **Staging.** Repeat steps 2–7 and 9–10 in us-east-2 with `news-staging.estori.app`, the `-staging` names and the IAM user `estori-ses-staging`, without step 8. Verify the team's recipient addresses in us-east-2.
13. **Deploys.** Approve each phase's deploy. Migrations 0029 onward apply through `scripts/deploy.ts` as usual.

## 27. Testing

- **Pure logic:**
  - SES request building and error classification;
  - token signing, with keys per kind;
  - EventBridge event parsing;
  - consent transitions;
  - email normalization and role names;
  - Turnstile result checks;
  - the rich-text parser and escaping;
  - every block's HTML and text, the locked footer, URL and color allow-lists, document validation and placeholders;
  - the segment compiler (bound parameters only);
  - `decideSend` in every evaluation order case;
  - next-window times across DST in `America/Chicago`;
  - pacing math;
  - automation step advancement and re-entry keys;
  - abandoned-checkout selection;
  - machine-open and scanner heuristics;
  - attribution windows;
  - CSV import parsing and skip reasons;
  - reputation thresholds.
- **Real SQL** (`worker/database/test-support/real-d1.ts`):
  - contacts' upsert and uniqueness, and consent records;
  - send dedupe and atomic claims;
  - frequency-cap counts;
  - materialization pages;
  - enrollments' uniqueness and due claims;
  - abandoned-checkout and win-back queries;
  - counters;
  - retention pruning;
  - attribution lookup.
- **Handlers:**
  - `/__estori/subscribe` refusals and the no-leak answer;
  - checkout contact;
  - cart restore;
  - `/e/u` GET, page POST and one-click POST with no redirect;
  - `/e/confirm`;
  - `/e/c` redirecting only to stored links;
  - `/e/ses-events` rejecting a missing or wrong key.
- **Queue consumer,** with fakes: pacing, throttling release, `uncertain` waits, holds and defers.
- **Endpoints:** owner checks, validation, rate limits and plan limits.
- **UI:** source guards for the tabs, routes, sandboxed preview, locked footer, copy rules (no supplier or AI-assistant names, no "Cloudflare doesn't allow marketing" note), and the empty states.
- **By eye on localhost** (dev-log sender):
  - sign up on a live store at `*.stores.localhost`;
  - follow the confirm link;
  - see the subscriber;
  - build and test-send a campaign;
  - schedule one 5 minutes out and watch it send in the dev log;
  - unsubscribe through the link;
  - run an abandoned checkout and see the email after the sweep.
- **Staging:** a real SES send in the sandbox to an `@pluriza.com` address, checking:
  - DKIM `d=news-staging.estori.app` covering `List-Unsubscribe` (`h=` in the received headers);
  - SPF pass on `bounce.news-staging.estori.app`;
  - DMARC pass;
  - Gmail's one-click Unsubscribe button working;
  - a bounce from `bounce@simulator.amazonses.com` and a complaint from `complaint@simulator.amazonses.com` reaching `/e/ses-events`.

## 28. Rollout

- **Each phase ships behind marketing being off by default per store.** Phase 1 can deploy before SES production access: sign-ups and confirmations work in the sandbox only for verified addresses. Turn on the public capability only after phase 5.
- **Production access first.** Request SES production access as soon as phase 1 is merged, since the review takes days.
- **Flipping the capability:**
  - `email-marketing` becomes `available` in `src/lib/capabilities.ts`;
  - `EMAIL_MARKETING_COPY`'s FAQ drops "coming soon";
  - `PLAN_COMPARISON` gets an email-marketing section from `MARKETING_PLAN_LIMITS`.

  This happens in phase 5.

## 29. Phasing

| Phase | PR | Contents | Migration |
| --- | --- | --- | --- |
| 1. Foundation | `feat/marketing-foundation` | **Spike first:** SES tenant association limits, the tenant event detail-type, DKIM covering `List-Unsubscribe`, Turnstile in a cross-site iframe. Then: SES client and marketing sender, link tokens, settings, contacts and consent, `Estori.subscribe` with Turnstile, double opt-in, checkout consent and customer upserts, unsubscribe and confirm pages, the EventBridge webhook and suppression, Subscribers and Settings tabs, the sign-up skill, privacy and terms | 0029 |
| 2. Templates | `feat/marketing-templates` | Documents, rich text, renderer, starters, saved templates, the editor and preview, test sends, writing by asking | 0030 |
| 3. Campaigns | `feat/marketing-campaigns` | Segments, campaigns, sending rules, the minute cron, the queue producer and consumer, pacing, idempotency, retries, imports, reputation pauses, admin view | 0031 |
| 4. Automations | `feat/marketing-automations` | Automations, enrollments, the four starters, abandoned-checkout sweep and cart restore | 0032 |
| 5. Stats | `feat/marketing-stats` | Click and open tracking, machine opens, stats pages, attribution, public page, capability and pricing | 0033 |
| 6. Own domains, back in stock | `feat/marketing-domains` | Seller domains through SES identities, back-in-stock requests and sends | 0034 |

Each phase is stacked on the previous one's branch until that merges. Each runs the CI steps before its PR.

## 30. Decisions for the owner

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | SES pricing plan | **À la carte**, $0.10 per 1,000 | Estori builds its own stats. Essentials ($0.16) adds Virtual Deliverability Manager, which isn't needed yet. |
| 2 | SES tenants, one per store | **Yes, from phase 1**, if the spike confirms identity sharing | Per-store reputation and automatic pausing for $0.005 per store a month. A single bad merchant is the main risk. |
| 3 | How SES events reach Estori | **EventBridge API destination** with a secret header | Simpler to verify than SNS signatures, retries for 24 h, has a DLQ, and carries tenant events |
| 4 | Click and open tracking | **Estori's own links on `news.estori.app`** (phase 5) | Links aligned with the From domain, attribution under our control, no HTTPS-CDN setup for SES's custom tracking domain |
| 5 | Marketing domain and addresses | **`{slug}@news.estori.app`**, links on the same host, MAIL FROM `bounce.news.estori.app` | Keeps marketing away from `orders.estori.app`, as Gmail asks |
| 6 | Double opt-in for forms | **Always on**; the checkout checkbox is single opt-in | Gmail and AWS recommend it, and it protects the shared account |
| 7 | Who gets automations, abandoned cart included | **Subscribers only** | The public page promises it, and Stripe and CAN-SPAM treat abandoned-cart email as promotional |
| 8 | Plan limits | **Basic: 250 contacts, 1,000 emails a month. Premium: 10,000 contacts, 50,000 emails. Enterprise: custom.** No overage until billing exists. | Lets every store try it, costs little, and keeps free-plan abuse small |
| 9 | Imports | **Premium and established sellers only**, with attestation, 5,000 rows, and the first send limited to 1,000 | Imports are where bought lists come in |
| 10 | Store auto-pause thresholds | **Bounces > 4% (200+ sends), complaints > 0.2% (500+ sends), or 5 complaints in 24 h** | Below SES's review levels |
| 11 | Defaults | **Frequency cap 4 per 7 days; send window 8:00–20:00 in the store's time zone; unengaged exclusion 180 days** | Common practice; sellers can change them |
| 12 | Attribution | **Clicks only, 5 days, last click wins** | Apple's automatic opens make opens unreliable |
| 13 | Staging | **Same AWS account, us-east-2, left in the sandbox**, plus the code allowlist | Sandbox status is per region, so this costs nothing |
| 14 | Turnstile on sellers' own domains | **A challenge iframe from the store's subdomain**, falling back to tighter limits if the spike fails | "Any hostname" needs Turnstile Enterprise |
| 15 | Postal address | **The seller's own, required to turn marketing on** | CAN-SPAM names the advertiser. A P.O. box or registered private mailbox is allowed. |
| 16 | Legal review | **Counsel reviews the Terms and Privacy changes before phase 1 deploys** | CAN-SPAM, CCPA notice at collection, Washington CEMA |
| 17 | Own sending domains and back in stock | **Phase 6, Premium only** | Not needed for launch; each adds DNS support load |
| 18 | Dedicated IPs | **No** | They need steady volume and a 45-day warm-up |

## 31. Sources

Checked 2026-10-19.

**Amazon SES**
- API v2 `SendEmail`: https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
- Message headers: https://docs.aws.amazon.com/ses/latest/dg/header-fields.html and https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageHeader.html
- Custom headers launch: https://aws.amazon.com/about-aws/whats-new/2024/03/amazon-ses-headers-sending-email
- Quotas: https://docs.aws.amazon.com/ses/latest/dg/quotas.html
- Errors: https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas-errors.html and https://docs.aws.amazon.com/ses/latest/APIReference-V2/CommonErrors.html
- Events: https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html and https://docs.aws.amazon.com/ses/latest/dg/monitoring-eventbridge.html
- Tracking and custom domains: https://docs.aws.amazon.com/ses/latest/dg/configure-custom-open-click-domains.html
- List management: https://docs.aws.amazon.com/ses/latest/dg/sending-email-list-management.html
- One-click unsubscribe with SES: https://aws.amazon.com/blogs/messaging-and-targeting/using-one-click-unsubscribe-with-amazon-ses/
- Suppression lists: https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html and https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list-tenant-level.html
- Production access: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- Enforcement: https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html
- Identities: https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html
- MAIL FROM: https://docs.aws.amazon.com/ses/latest/dg/mail-from.html
- Tenants: https://docs.aws.amazon.com/ses/latest/dg/tenants.html and https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-ses-tenant-isolation-automated-reputation-policies
- Pricing: https://aws.amazon.com/ses/pricing/ and https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-ses-pricing-plans/
- Dedicated IPs: https://docs.aws.amazon.com/ses/latest/dg/dedicated-ip.html

**Signing and events**
- `aws4fetch`: https://github.com/mhart/aws4fetch, and Cloudflare's R2 example at https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
- SNS signatures: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html
- Node crypto in Workers: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- EventBridge API destinations and pricing: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html and https://aws.amazon.com/eventbridge/pricing/

**Mailbox providers and law**
- Gmail: https://support.google.com/a/answer/81126, https://support.google.com/a/answer/14229414 and https://support.google.com/mail/answer/15263077
- Yahoo: https://senders.yahooinc.com/best-practices/
- Outlook.com: https://support.microsoft.com/en-us/outlook/fix-ndr-error-550-5-7-515-in-outlook-com
- RFC 8058: https://www.rfc-editor.org/rfc/rfc8058.html
- CAN-SPAM: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Penalty level for 2026: https://public-inspection.federalregister.gov/2026-18853.pdf
- Washington CEMA: https://www.clarkhill.com/news-events/news/washington-supreme-court-says-its-illegal-to-include-any-false-or-misleading-information-in-the-subject-line-of-a-commercial-email
- CCPA notice at collection: https://law.cornell.edu/regulations/california/11-CCR-7012
- Stripe on abandoned carts: https://docs.stripe.com/payments/checkout/abandoned-carts.md
- Stripe consent collection: https://docs.stripe.com/payments/checkout/promotional-emails-consent.md
- Apple Mail share: https://www.litmus.com/email-client-market-share

**Cloudflare**
- Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- Turnstile hostnames: https://developers.cloudflare.com/turnstile/concepts/hostname-management/
- Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Queues limits and pricing: https://developers.cloudflare.com/queues/platform/limits/ and https://developers.cloudflare.com/queues/platform/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/

**Templating**
- MJML sizes: https://bundlephobia.com/api/size?package=mjml-browser@5.4.1
- MJML on Workers: https://github.com/mjmlio/mjml/issues/2812

## 32. Not verified, to settle in the phase 1 spike

- **Tenants:** whether one identity and one configuration set can be associated with thousands of tenants, and the IAM resource ARN for tenants.
- **Tenant events:** the EventBridge detail-type of tenant status changes.
- **DKIM coverage:** whether SES's Easy DKIM signature covers our `List-Unsubscribe` and `List-Unsubscribe-Post` headers. RFC 8058 requires it, and AWS's blog implies it. Check `h=` on a received message.
- **Turnstile in a cross-site iframe:** whether it runs there, for sellers' own domains.
- **Apple opens:** Apple's MPP proxies' networks (`asn` 714 or 6185). This is a heuristic Apple doesn't publish.
- **SNS pricing:** official per-delivery pricing. It doesn't matter if EventBridge is chosen.
- **Outlook.com:** when it started rejecting, rather than junking, non-compliant bulk mail.
- **DMARC:** whether `estori.app` already publishes a DMARC record.
- **Cloudflare Access:** whether it covers subdomains of `estori.app`.
