# Estori Production Launch — Design

Date: 2026-10-04
Status: Approved; revised 2026-10-05 (domain moved to `estori.app`, see Revision note)
Depends on: `docs/superpowers/specs/2026-10-04-estori-rebrand-design.md` (implemented on branch `claude/project-analysis-local-setup-dfd834`)

## Goal

Launch the Estori-branded VibeSDK as a **private beta** on the Estori Cloudflare account (`6d16ad8a9f081e4939993391bd35ca4e`), serving the app at `estori.app`. Done means:

- An invited person can open the app, pass the beta gate, sign up, generate an app, and see its preview.
- A redeploy does not log anyone out.
- Every production deploy is a reviewed, repeatable GitHub Actions run.

## Revision note (2026-10-05)

`getestori.com` turned out to be in the Pluriza account and actively serving the existing Estori product (estori/core) on Workers for Platforms, with advanced certificates for `*.sites.getestori.com` and canary/staging hosts. Moving that zone or cancelling its certificate add-on would break published customer sites. The owner bought `estori.app` in the Estori account instead. `getestori.com` and the Pluriza account are not touched by this launch.

Think previews are path-based URLs on a single preview host (`https://<preview-host>/space/<app>/preview/<branch>?t=<token>`, `worker/agents/core/behaviors/think.ts` `getBrowserPreviewURL`), not wildcard subdomains. Without a separate preview host, `worker/index.ts` serves previews on the main host, which would run generated code on the app's own origin. The preview host is therefore `preview.estori.app`, a different origin from `estori.app`. The session cookie is host-only (`worker/utils/authUtils.ts` `createSecureCookie` sets no `Domain`), CORS admits only the app origin, and CSRF tokens are not readable from the preview.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Private beta |
| Beta gate | Cloudflare Access (Zero Trust) on the app host; `ALLOWED_EMAIL` stays unset |
| App host | `estori.app` (apex) |
| Previews | `preview.estori.app` (`CUSTOM_PREVIEW_DOMAIN`), covered by the free Universal SSL certificate |
| Zone | `estori.app`, registered in and served by the Estori account; `getestori.com` untouched |
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
- Any change to `getestori.com`, the Pluriza account, or the existing estori/core deployment.
- Changes to upstream `wrangler.jsonc`, `deploy-release-live.yml` or `deploy-staging.yml`.

## 1. Domain setup (`estori.app`)

`estori.app` was bought through Cloudflare Registrar in the Estori account, so its zone already lives there and no migration is needed.

### Preconditions

- The Estori account is on **Workers Paid** (confirmed by the owner 2026-10-05).
- The `estori.app` zone shows **Active** and its nameservers resolve publicly (`dig +short NS estori.app`).

### Runbook

This goes in `docs/estori/domain-setup.md` (replacing the earlier `domain-migration.md`).

1. Confirm the zone is Active (Domains → `estori.app`).
2. Confirm SSL/TLS mode is **Full (strict)** and the Universal certificate covers `estori.app` and `*.estori.app`.
3. Add the preview record: type `AAAA`, name `preview`, content `100::`, **Proxied**. The app host `estori.app` gets its record automatically from the Worker custom domain.
4. Verify: `dig +short NS estori.app` returns Cloudflare nameservers; `echo | openssl s_client -connect preview.estori.app:443 -servername preview.estori.app` shows a certificate whose SAN covers `preview.estori.app`.

## 2. Production configuration and provisioning

### `wrangler.estori.jsonc`

This file is new, derived from the committed upstream `wrangler.jsonc`.

| Area | Value |
|---|---|
| `name` | `estori-production` |
| `routes` | `{ pattern: "estori.app", custom_domain: true }` and `{ pattern: "*preview.estori.app/*", zone_name: "estori.app" }` (the form `deploy.ts` writes from `CUSTOM_PREVIEW_DOMAIN`, as upstream does with `*build-preview.cloudflare.dev/*`) |
| `vars` | `CUSTOM_DOMAIN=estori.app`, `CUSTOM_PREVIEW_DOMAIN=preview.estori.app`, `ENVIRONMENT=prod`, `CLOUDFLARE_AI_GATEWAY=estori-gateway`, `ARTIFACTS_NAMESPACE=estori-production`, `TEMPLATES_REPOSITORY` and `PLATFORM_CAPABILITIES` as upstream, `MAX_SANDBOX_INSTANCES` and `SANDBOX_INSTANCE_TYPE` dropped. No `DEV_BROWSER_*`, no `DISPATCH_NAMESPACE` |
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
- Artifacts namespace `estori-production`: no command needed. Artifacts creates a namespace automatically when the first repository is created in it, which SpaceDO does through the binding.
- The AI Gateway `estori-gateway` already exists.

### Variables delivered by the deploy

`scripts/deploy.ts` uploads every variable on its allowlist that is present in its environment as a Worker secret (`createProdVarsFile`). A dashboard variable with the same name would collide with that secret, so these come from CI instead of the dashboard:

- `ENABLE_ARTIFACTS=true` (also required so the script keeps the `artifacts` binding)
- `CLOUDFLARE_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/6d16ad8a9f081e4939993391bd35ca4e/estori-gateway/`. Local dev needed this override because the AI binding's gateway lookup failed on the new account. It is kept in production as a deterministic URL.

### `scripts/deploy.ts` adjustments

These are small changes, written so they can go upstream.

- **Dispatch namespace.** No change needed. `ensureDispatchNamespace` already returns early when the config has no `dispatch_namespaces` (`deploy.ts:273-278`).
- **Artifacts binding.** The script removes the `artifacts` binding unless `ENABLE_ARTIFACTS=true` in its environment. The CI job sets it; no code change is needed for this.
- **Containers.** The script's container patching already handles a config without `containers`: it logs a warning and skips (`deploy.ts:1280`, `:1345`). No change is needed.
- **JWT secret.** No change needed. When `JWT_SECRET` is present in the environment the script leaves it out of the upload, so the Worker's existing secret is kept. It only generates a new one when the variable is absent (`deploy.ts:1790-1804`). CI always provides it, and the Worker secret is set once with `wrangler secret put` right after the first deploy, before anyone signs up.
- **Runtime secrets.** `CLOUDFLARE_API_TOKEN` is on the upload allowlist, so the broad deploy token would become a Worker secret. In this configuration its runtime uses are all covered by narrower tokens: `CLOUDFLARE_AI_GATEWAY_TOKEN` for inference and analytics, `ARTIFACTS_API_TOKEN` for the Repo viewer. The others belong to disabled features: platform deploy, the container sandbox, and Cloudflare Images. The script gains a generic `DEPLOY_SKIP_SECRETS` option, a comma-separated list of names to leave out of the upload, and CI sets `DEPLOY_SKIP_SECRETS=CLOUDFLARE_API_TOKEN`.

Local dev keeps using `wrangler.jsonc` and its local-only edits. Production does not depend on them.

## 3. Access, secrets, and the platform-deploy capability

### Cloudflare Access

This is configured in the Estori account's Zero Trust (free for up to 50 users) and documented in `docs/estori/access.md`.

- **Self-hosted application** "Estori", covering exactly the host `estori.app`, all paths. No wildcard: `preview.estori.app` must not be covered.
- **Policy "Beta invitees" (Allow):** the include rule is an email list, and email domains may be added. Login method is the One-time PIN.
- **Policy "CI smoke" (Service Auth):** the include rule is the service token `estori-ci-smoke`. Its client ID and secret are stored as GitHub secrets.
- **Not covered:** `preview.estori.app`. Previews are protected by signed, branch-scoped URLs and load in the app's iframe.
- **Access cookie scope:** the `CF_Authorization` cookie must be scoped to `estori.app` only (no `Domain=estori.app` that would reach subdomains), so the preview host never receives it. Verified in the launch checklist.
- **API and WebSockets:** both use the same host and the Access cookie.
- **Inviting someone:** add their email to the policy. No deploy is needed.

### Secrets and variables

| Name | Location | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` (deploy) | GitHub secret | `wrangler deploy`, D1 migrations, routes. Scoped to the Estori account (Workers Scripts, D1, KV, R2, Workers Routes, AI Gateway, Artifacts) and the `estori.app` zone |
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

1. `GET https://estori.app/api/health` → `200` with `{"status":"ok"}`.
2. `GET https://estori.app/api/capabilities` → `platformDeploy === false` and `artifacts === true`.
3. `GET https://preview.estori.app/` → a valid TLS handshake, `server: cloudflare`, and no redirect to `cloudflareaccess.com` (the preview host must not be behind Access).

Any failure fails the job and prints the rollback command.

### Launch checklist

This lives in `docs/estori/launch-checklist.md` and is run once by a person at first launch.

1. Open `estori.app`: the Access One-time PIN works for an invited email and is refused for a non-invited one.
2. Sign up with email and password.
3. Create an app; its preview loads from `https://preview.estori.app/space/...`.
4. The Repo tab shows commits (Artifacts).
5. Asking "Who are you?" gets "Estori".
6. Trigger a redeploy; the signed-in session survives.
7. In browser devtools on `estori.app`, the `CF_Authorization` and `accessToken` cookies have no `Domain` attribute covering subdomains; requests to `preview.estori.app` carry neither.
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
- `docs/estori/domain-setup.md`
- `docs/estori/provisioning.md`
- `docs/estori/access.md`
- `docs/estori/launch-checklist.md`

**Modified:**

- `scripts/deploy.ts` (`DEPLOY_SKIP_SECRETS`), with the filter in a new `scripts/deploy-secrets.ts`
- `worker/api/controllers/capabilities/controller.ts`
- the `PlatformCapabilities` type
- `src/routes/chat/chat.tsx`
- tests for the capability and the guard rule

## Owner actions (cannot be automated)

- Confirm Workers Paid on the Estori account.
- Confirm `estori.app` is Active and add the proxied `preview` record.
- Create the Zero Trust organization, the Access application and policies, and the service token.
- Create the scoped API tokens (deploy, AI Gateway Run, Artifacts read) and add them to GitHub and the Worker.
- Create the GitHub Environment `production` with yourself as required reviewer.
- Approve each deploy.

## Risks

- **Artifacts is in open beta.** A sync failure does not break commits or deploys (`space/src/space/artifacts-sync.ts`), but history durability depends on it.
- **Same-site previews.** `estori.app` and `preview.estori.app` share a registrable domain, the same model upstream uses (`build.cloudflare.dev` / `build-preview.cloudflare.dev`). Isolation relies on host-only cookies, origin-restricted CORS and CSRF tokens; the launch checklist verifies the cookie scopes.
- **CI test baseline.** Pre-existing failures may block the gate on Linux. This is handled by an explicit fix-or-quarantine task.
- **Access and long-lived WebSockets.** Access session expiry can drop a long chat session. The session duration is set to 24 hours in the Access application.
- **`deploy.ts` behavior.** The script is complex (about 2,100 lines). Changes are limited to the dispatch skip and verified JWT and secret handling, each covered by the first dry-run.
