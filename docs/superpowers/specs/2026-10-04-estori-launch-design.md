# Estori Production Launch — Design

Date: 2026-10-04
Status: Draft for review
Depends on: `docs/superpowers/specs/2026-10-04-estori-rebrand-design.md` (implemented on branch `claude/project-analysis-local-setup-dfd834`)

## Goal

Launch the Estori-branded VibeSDK as a **private beta** on the Estori Cloudflare account (`6d16ad8a9f081e4939993391bd35ca4e`), serving the app at `app.getestori.com`. Done means:

- An invited person can open the app, pass the beta gate, sign up, generate an app, and see its preview.
- A redeploy does not log anyone out.
- Every production deploy is a reviewed, repeatable GitHub Actions run.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Private beta |
| Beta gate | Cloudflare Access (Zero Trust) on the app host; `ALLOWED_EMAIL` stays unset |
| App host | `app.getestori.com` |
| Previews | `*.apps.getestori.com`, covered by Advanced Certificate Manager (purchased by the owner) |
| Zone | Move `getestori.com` from its current account into the Estori account |
| Generated-app deploy | Preview only; no Workers for Platforms; Deploy hidden through a new `platformDeploy` capability |
| Version history | Cloudflare Artifacts enabled from day one (open beta since 2026-10-01; Workers Paid; billing from 2026-10-14) |
| Deploy method | GitHub Actions on `alastrat/vibesdk`, push to `estori-live`, with manual approval |
| Config strategy | Dedicated `wrangler.estori.jsonc`, deployed with `WRANGLER_CONFIG_PATH`; upstream `wrangler.jsonc` untouched |
| Project types | Think "app" only (`PLATFORM_CAPABILITIES` unchanged) |
| Auth inside the app | Email and password only; no Google, GitHub or Cloudflare OAuth; no GitHub export |
| Model | `google-ai-studio/gemini-3.6-flash` via AI Gateway `estori-gateway` with a Google AI Studio key |
| Environments | Production only; staging is a later addition |

## Non-goals

- Public sign-up, billing, and Workers for Platforms or user-account deploys.
- A staging environment.
- Migrating any data from local dev; production starts empty.
- Changes to the marketing site on Vercel, beyond keeping it working through the zone move.
- Changes to upstream `wrangler.jsonc`, `deploy-release-live.yml` or `deploy-staging.yml`.

## 1. Account and domain migration

This is done first: routes and custom domains can only attach to a zone in the Worker's account.

### Preconditions

- The Estori account is on **Workers Paid** (Workers & Pages → Plans). This is required for Durable Objects, Worker Loader, Browser Rendering and Artifacts.
- The registrar of `getestori.com` is known: Cloudflare Registrar in the old account, or an external registrar.

### Runbook

This goes in `docs/estori/domain-migration.md`.

1. **Old account.**
   - Export DNS records as a BIND file.
   - Record the SSL/TLS settings and any redirect, page or configuration rules.
   - Turn off DNSSEC; with an external registrar, also remove the DS record there.
   - Cancel the Advanced Certificate Manager subscription. Contact Cloudflare billing about prorating the recent purchase.
2. **Estori account.**
   - Add the site `getestori.com` on the Free plan.
   - Import the BIND file with **every record DNS-only (grey cloud)**, so the apex and `www` (Vercel, `76.76.21.21`) and mail records resolve exactly as before.
   - Purchase Advanced Certificate Manager and order a certificate covering `getestori.com`, `*.getestori.com` and `*.apps.getestori.com`.
3. **Switch authority.**
   - **External registrar:** set the nameservers to the pair shown by the Estori zone.
   - **Cloudflare Registrar:** use the inter-account move under Manage Domain → Configuration. Only the registration and WHOIS move; the zone added in step 2 serves DNS. The Estori account accepts within 5 days, and the registration is then transfer-locked for 30 days.
4. **Wait.** Both the zone and the ACM certificate must show **Active**.
5. **Verify, then clean up.**
   - `dig NS getestori.com` returns the Estori pair.
   - The apex and `www` serve the Vercel site.
   - MX, TXT and SPF records resolve.
   - Then delete the zone from the old account.

The `app` and `*.apps` records are created in section 2, not here.

### Risk

While the zone is Pending, Cloudflare does not proxy it. The current records are DNS-only to Vercel, so visitors are unaffected. Mail records are the main item to verify.

## 2. Production configuration and provisioning

### `wrangler.estori.jsonc`

This file is new, derived from the committed upstream `wrangler.jsonc`.

| Area | Value |
|---|---|
| `name` | `estori-production` |
| `routes` | `{ pattern: "app.getestori.com", custom_domain: true }` and `{ pattern: "*.apps.getestori.com/*", zone_name: "getestori.com" }` |
| `vars` | `CUSTOM_DOMAIN=app.getestori.com`, `CUSTOM_PREVIEW_DOMAIN=apps.getestori.com`, `ENVIRONMENT=prod`, `CLOUDFLARE_AI_GATEWAY=estori-gateway`, `ARTIFACTS_NAMESPACE=estori-production`, `TEMPLATES_REPOSITORY` and `PLATFORM_CAPABILITIES` as upstream, `MAX_SANDBOX_INSTANCES` and `SANDBOX_INSTANCE_TYPE` dropped. No `DEV_BROWSER_*`, no `DISPATCH_NAMESPACE` |
| D1 | binding `DB` → `estori-db` (new `database_id`), `migrations_dir: migrations` |
| KV | binding `VibecoderStore` (name kept; code uses it) → namespace `estori-store` |
| R2 | binding `TEMPLATES_BUCKET` → bucket `estori-assets` (image uploads, screenshots) |
| Artifacts | binding `ARTIFACTS`, namespace `estori-production` |
| Kept as upstream | `ai`, `browser`, `worker_loaders`, both `unsafe` ratelimit bindings, all `durable_objects` bindings and `migrations` v1–v6, `assets`, `observability`, `version_metadata`, `alias`, `rules`, `compatibility_*`, `keep_vars: true`, `workers_dev: false`, `preview_urls: false` |
| Removed | `containers` (no image build, no Containers product) and `dispatch_namespaces` (preview only) |

The `Sandbox` DO binding (`UserAppSandboxService`) stays declared, because the class is exported and created in migration v1. Without `containers` it is an unused Durable Object. The plan verifies this with `wrangler deploy --dry-run` before anything else.

### Provisioning runbook

This goes in `docs/estori/provisioning.md`. It runs once and its IDs are committed into `wrangler.estori.jsonc`.

- `wrangler d1 create estori-db`
- `wrangler kv namespace create estori-store`
- `wrangler r2 bucket create estori-assets`
- Artifacts namespace `estori-production`: the plan determines whether the binding alone creates it on first use, or whether a `wrangler artifacts` command is needed, and records the answer here.
- The AI Gateway `estori-gateway` already exists.

### Dashboard-managed variables

These are set once and survive deploys through `keep_vars`:

- `ENABLE_ARTIFACTS=true`
- `CLOUDFLARE_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/6d16ad8a9f081e4939993391bd35ca4e/estori-gateway/`. Local dev needed this override because the AI binding's gateway lookup failed on the new account. It is kept in production as a deterministic URL.

### `scripts/deploy.ts` adjustments

These are small changes, written so they can go upstream.

- **Dispatch namespace.** Skip dispatch-namespace creation and syncing when the target config has no `dispatch_namespaces`. Today the script creates the namespace if it is missing, which requires Workers for Platforms.
- **Artifacts binding.** The script removes the `artifacts` binding unless `ENABLE_ARTIFACTS=true` in its environment. The CI job sets it; no code change is needed for this.
- **Containers.** The script's container patching already handles a config without `containers`: it logs a warning and skips (`deploy.ts:1280`, `:1345`). No change is needed.
- **JWT secret.** The plan reads the script's JWT handling (`deploy.ts` around lines 1790–1804). The required outcome is that `JWT_SECRET` is uploaded once and never regenerated on later deploys. If the script cannot achieve this, it gets a minimal fix.
- **Runtime secrets.** The plan lists exactly which secrets the script uploads to the Worker. The broad deploy `CLOUDFLARE_API_TOKEN` must not become a Worker secret if a narrower token covers the runtime need; the narrower tokens are in section 3.

Local dev keeps using `wrangler.jsonc` and its local-only edits. Production does not depend on them.

## 3. Access, secrets, and the platform-deploy capability

### Cloudflare Access

This is configured in the Estori account's Zero Trust (free for up to 50 users) and documented in `docs/estori/access.md`.

- **Self-hosted application** "Estori", covering `app.getestori.com`, all paths.
- **Policy "Beta invitees" (Allow):** the include rule is an email list, and email domains may be added. Login method is the One-time PIN.
- **Policy "CI smoke" (Service Auth):** the include rule is the service token `estori-ci-smoke`. Its client ID and secret are stored as GitHub secrets.
- **Not covered:** `*.apps.getestori.com`. Previews are protected by signed, branch-scoped URLs and load in the app's iframe.
- **API and WebSockets:** both use the same host and the Access cookie.
- **Inviting someone:** add their email to the policy. No deploy is needed.

### Secrets and variables

| Name | Location | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` (deploy) | GitHub secret | `wrangler deploy`, D1 migrations, routes. Scoped to the Estori account (Workers Scripts, D1, KV, R2, Workers Routes, AI Gateway, Artifacts) and the `getestori.com` zone |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub variable and Worker var | Account `6d16ad8a9f081e4939993391bd35ca4e` |
| `JWT_SECRET` | GitHub secret and Worker secret | Session signing. Generated once: ≥ 32 chars, ≥ 3 character types, no 4-character repeats (see `worker/utils/jwtUtils.ts`) |
| `CLOUDFLARE_AI_GATEWAY_TOKEN` | Worker secret | AI Gateway Run only |
| `GOOGLE_AI_STUDIO_API_KEY` | Worker secret | Gemini |
| `ARTIFACTS_API_TOKEN` | Worker secret, set once with `wrangler secret put` (the `deploy.ts` allowlist drops it) | Artifacts read-only, for the Repo tab |
| `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET` | GitHub secrets | Smoke test through Access |

### `platformDeploy` capability

This is a small code change.

- **Server:** `worker/api/controllers/capabilities/controller.ts` returns `platformDeploy: isDispatcherAvailable(env)` (from `worker/utils/dispatcherUtils.ts`). The field is added to the `PlatformCapabilities` type exported through `src/api-types.ts`.
- **Client:** `src/routes/chat/chat.tsx` renders the Deploy button only when `capabilities.platformDeploy || capabilities.userAccountDeploy`. With neither set, as in the beta, the button and "View Live" are not rendered.
- **Deploy endpoint:** keeps its current error when called without a dispatcher.
- **Tests:**
  - A controller unit test covers `platformDeploy` with and without a `DISPATCHER` binding.
  - A brand-guard style rule asserts `chat.tsx` gates the Deploy button on these capabilities.

## 4. CI pipeline, verification and rollback

### `.github/workflows/deploy-estori.yml`

This is a new file.

- **Triggers:** `push` to `estori-live`, plus `workflow_dispatch`.
- **Repository guard:** `if: github.repository == 'alastrat/vibesdk'`.
- **Concurrency:** `concurrency: { group: estori-production, cancel-in-progress: false }`.
- **Approval:** `environment: production`, with the owner as required reviewer.
- **Gate:** `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test`.
  - At baseline locally, `bun run typecheck` reports 4 errors in vendored `packages/artifacts-viewer`, and `bun run test` has 15 failures in `space/test` and aborts on local port exhaustion.
  - The plan's first CI run establishes the Linux baseline.
  - Any failures that reproduce there are fixed or explicitly quarantined, each with a recorded reason, before deploys are enabled. The gate never ignores failures implicitly.
- **Deploy:** `WRANGLER_CONFIG_PATH=wrangler.estori.jsonc ENABLE_ARTIFACTS=true bun scripts/deploy.ts`, with the section 3 secrets as env. This includes `db:migrate:remote`.
- **Release:** fast-forward `estori-live` to the chosen commit and push, then approve the environment.

### Post-deploy smoke test

`scripts/estori-smoke.ts` runs as the last CI step. It sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers and checks:

1. `GET https://app.getestori.com/api/health` → `200` with `{"status":"ok"}`.
2. `GET https://app.getestori.com/api/capabilities` → `platformDeploy === false` and `artifacts === true`.
3. `GET https://smoke.apps.getestori.com/` → a valid TLS handshake, and a response from the Worker rather than Vercel (Vercel serves only the apex and `www`).

Any failure fails the job and prints the rollback command.

### Launch checklist

This lives in `docs/estori/launch-checklist.md` and is run once by a person at first launch.

1. Open `app.getestori.com`: the Access One-time PIN works for an invited email and is refused for a non-invited one.
2. Sign up with email and password.
3. Create an app; its preview loads on `*.apps.getestori.com`.
4. The Repo tab shows commits (Artifacts).
5. Asking "Who are you?" gets "Estori".
6. Trigger a redeploy; the signed-in session survives.
7. The apex and `www` still serve the Vercel marketing site.
8. No Deploy button is shown.

### Rollback and operations

- **Rollback:** `wrangler rollback --name estori-production` restores the previous Worker version. This is documented in `docs/estori/provisioning.md`.
- **Standing rule:** D1 migrations are forward-only, so every migration must be compatible with the previous Worker version.
- **Logs:** Workers Logs, already enabled by `observability` in the config.

## Files

**New:**

- `wrangler.estori.jsonc`
- `.github/workflows/deploy-estori.yml`
- `scripts/estori-smoke.ts`
- `docs/estori/domain-migration.md`
- `docs/estori/provisioning.md`
- `docs/estori/access.md`
- `docs/estori/launch-checklist.md`

**Modified:**

- `scripts/deploy.ts` (dispatch-namespace skip; JWT and secret-upload fixes only if needed)
- `worker/api/controllers/capabilities/controller.ts`
- the `PlatformCapabilities` type
- `src/routes/chat/chat.tsx`
- tests for the capability and the guard rule

## Owner actions (cannot be automated)

- Confirm Workers Paid on the Estori account.
- Run the domain migration in both accounts and at the registrar, and buy ACM in the Estori account.
- Create the Zero Trust organization, the Access application and policies, and the service token.
- Create the scoped API tokens (deploy, AI Gateway Run, Artifacts read) and add them to GitHub and the Worker.
- Create the GitHub Environment `production` with yourself as required reviewer.
- Approve each deploy.

## Risks

- **Artifacts is in open beta.** A sync failure does not break commits or deploys (`space/src/space/artifacts-sync.ts`), but history durability depends on it.
- **Domain move.** The Pending window and mail records need care; the runbook verifies both.
- **CI test baseline.** Pre-existing failures may block the gate on Linux. This is handled by an explicit fix-or-quarantine task.
- **Access and long-lived WebSockets.** Access session expiry can drop a long chat session. The session duration is set to 24 hours in the Access application.
- **`deploy.ts` behavior.** The script is complex (about 2,100 lines). Changes are limited to the dispatch skip and verified JWT and secret handling, each covered by the first dry-run.
