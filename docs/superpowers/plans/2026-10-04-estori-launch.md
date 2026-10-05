# Estori Production Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch Estori as a private beta at `app.getestori.com` on the Estori Cloudflare account, deployed by a reviewed GitHub Actions workflow.

**Architecture:**
- A dedicated `wrangler.estori.jsonc` is deployed through upstream's `scripts/deploy.ts`, with `WRANGLER_CONFIG_PATH` pointing at it.
- Cloudflare Access gates the app host. Previews run on `*.apps.getestori.com` and are not gated.
- Generated-app deploy is hidden behind a new `platformDeploy` capability.
- A post-deploy smoke script verifies the live system through an Access service token.
- Tasks 1–5 are code and docs. Tasks 6, 8, 9, 10 and 11 involve the owner's accounts and outward-facing actions, and each needs an explicit go-ahead.

**Tech Stack:** Cloudflare Workers, Wrangler 4, D1, KV, R2, Artifacts, Cloudflare Access, GitHub Actions, bun, Vitest (`@cloudflare/vitest-pool-workers`), React 19.

**Spec:** `docs/superpowers/specs/2026-10-04-estori-launch-design.md`

## Global Constraints

**Account and naming**

- Estori Cloudflare account ID: `6d16ad8a9f081e4939993391bd35ca4e`.
- Worker name: `estori-production`.
- Resource names: D1 `estori-db`, KV `estori-store`, R2 `estori-assets`, Artifacts namespace `estori-production`, AI Gateway `estori-gateway` (already exists).
- Hosts: `app.getestori.com` for the app, `apps.getestori.com` as the preview domain, `*.apps.getestori.com` for previews.

**Configuration**

- Upstream `wrangler.jsonc`, `.github/workflows/deploy-release-live.yml` and `.github/workflows/deploy-staging.yml` stay unchanged.
- The local, uncommitted edits to `wrangler.jsonc` are never committed or staged. Neither are `.dev.vars` or `bun.lockb`.
- `ENABLE_ARTIFACTS` and `CLOUDFLARE_AI_GATEWAY_URL` reach the Worker as secrets uploaded by `deploy.ts` from CI env, never as dashboard variables (a same-name dashboard variable would collide with the secret).
- The CI deploy job sets `DEPLOY_SKIP_SECRETS=CLOUDFLARE_API_TOKEN`, so the broad deploy token never becomes a Worker secret.
- `JWT_SECRET` is generated once (≥ 32 chars, ≥ 3 character types, no 4-character repeats), stored as a GitHub `production` environment secret, and set as a Worker secret with `wrangler secret put` right after the first deploy. It is never regenerated.

**Testing and code conventions**

- Test command for one file: `bun run test <path>`.
- Typecheck: `bun run typecheck`. Locally it has 4 pre-existing errors in `packages/artifacts-viewer`, so locally pass only if no errors appear elsewhere.
- Lint: `bun run lint`.
- No `any`. No emojis in code or comments. Commit subjects are lowercase (commitlint `subject-case`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Owner actions**

- Anything that creates or changes resources in Cloudflare, GitHub, DNS or a registrar needs the owner's explicit go-ahead in chat at execution time. This covers Tasks 6, 8, 9, 10 and 11.

## Review Focus

1. **Redeploy with signed-in users.** Sessions must survive a second deploy.
   - Task 2 adds a test that `JWT_SECRET` stays in the upload list unless explicitly skipped.
   - Task 11 includes a manual redeploy-while-signed-in step.
2. **Unauthenticated or non-invited request to `app.getestori.com`.** It must be stopped by Access: an API request without credentials is redirected to the Access login, never served.
   - Task 11 adds a `curl` check.
3. **Preview host.** It must *not* be behind Access and must be answered by the Worker.
   - Task 3's smoke test asserts the preview probe is served by Cloudflare and is not a redirect to `cloudflareaccess.com`.
4. **Marketing site after the zone move and wildcard route.** The apex must still be served by Vercel.
   - Task 3's smoke test includes an apex check (`server: Vercel`).
   - Task 8 verifies apex, `www` and mail records.
5. **Long chat sessions through Access.** Streaming over WebSocket must work through Access, and the session must last a working day.
   - Task 9 sets the Access session duration to 24 hours.
   - Task 11's checklist runs a full generation through Access.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/agents/core/features/types.ts` (modify) | Add `platformDeploy: boolean` to `PlatformCapabilities` |
| `worker/api/controllers/capabilities/controller.ts` (modify) | Return `platformDeploy: isDispatcherAvailable(env)` |
| `worker/api/controllers/capabilities/controller.test.ts` (new) | Capability tests |
| `src/routes/chat/chat.tsx` (modify) | Render Deploy and View Live only when a deploy target exists |
| `src/brand/brand-guard.test.ts` (modify) | Guard rule that keeps the Deploy button gated |
| `scripts/deploy-secrets.ts` (new) | `filterSkippedSecrets()`, a pure helper |
| `scripts/deploy-secrets.test.ts` (new) | Its tests |
| `scripts/deploy.ts` (modify) | Apply `DEPLOY_SKIP_SECRETS` in `createProdVarsFile` |
| `scripts/estori-smoke.ts` (new) | Post-deploy smoke checks; CLI entry |
| `scripts/estori-smoke.test.ts` (new) | Smoke-check tests with a fake fetch |
| `.github/workflows/deploy-estori.yml` (new) | Gate, approval, deploy, smoke |
| `wrangler.estori.jsonc` (new) | Estori production Worker config |
| `scripts/estori-config.test.ts` (new) | Validates `wrangler.estori.jsonc` against upstream and the spec |
| `docs/estori/domain-migration.md` (new) | Zone move runbook |
| `docs/estori/provisioning.md` (new) | Resource creation, secrets, rollback |
| `docs/estori/access.md` (new) | Zero Trust and Access setup |
| `docs/estori/launch-checklist.md` (new) | First-launch manual checks |

---

### Task 1: `platformDeploy` capability

**Files:**
- Modify: `worker/agents/core/features/types.ts` (the `PlatformCapabilities` interface)
- Modify: `worker/api/controllers/capabilities/controller.ts`
- Create: `worker/api/controllers/capabilities/controller.test.ts`
- Modify: `src/routes/chat/chat.tsx` (around lines 357–360 and 409)
- Modify: `src/brand/brand-guard.test.ts`

**Interfaces:**
- Consumes: `isDispatcherAvailable(env: Env): boolean` from `worker/utils/dispatcherUtils.ts`.
- Produces: `PlatformCapabilities.platformDeploy: boolean`, returned by `GET /api/capabilities` and read by the frontend through `useFeature().capabilities`.

- [ ] **Step 1: Write the failing controller test**

Create `worker/api/controllers/capabilities/controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CapabilitiesController } from './controller';
import type { RouteContext } from '../../types/route-context';
import type { PlatformCapabilities } from '../../../agents/core/features/types';

type TestEnv = Parameters<typeof CapabilitiesController.getCapabilities>[1];
type TestCtx = Parameters<typeof CapabilitiesController.getCapabilities>[2];

const baseEnv = {
	PLATFORM_CAPABILITIES: {
		features: {
			app: { enabled: true },
			presentation: { enabled: false },
			general: { enabled: false },
		},
		version: '1.0.0',
	},
};

async function capabilitiesFor(extraEnv: Record<string, unknown>): Promise<PlatformCapabilities> {
	const env = { ...baseEnv, ...extraEnv } as unknown as TestEnv;
	const response = await CapabilitiesController.getCapabilities(
		new Request('https://app.local/api/capabilities'),
		env,
		{} as TestCtx,
		{} as RouteContext,
	);
	const body = (await response.json()) as { data: PlatformCapabilities };
	return body.data;
}

describe('CapabilitiesController.getCapabilities', () => {
	it('reports platform deploy when the dispatcher binding exists', async () => {
		const capabilities = await capabilitiesFor({ DISPATCHER: {} });
		expect(capabilities.platformDeploy).toBe(true);
	});

	it('reports no platform deploy without a dispatcher binding', async () => {
		const capabilities = await capabilitiesFor({});
		expect(capabilities.platformDeploy).toBe(false);
	});

	it('keeps user-account deploy and artifacts flags independent', async () => {
		const capabilities = await capabilitiesFor({
			ENABLE_USER_ACCOUNT_DEPLOY: 'true',
			ENABLE_ARTIFACTS: 'true',
		});
		expect(capabilities.platformDeploy).toBe(false);
		expect(capabilities.userAccountDeploy).toBe(true);
		expect(capabilities.artifacts).toBe(true);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts`

Expected: the first test FAILS (`expected undefined to be true`). The second and third may fail on `platformDeploy` being `undefined`.

- [ ] **Step 3: Add the field to the type**

In `worker/agents/core/features/types.ts`, inside `export interface PlatformCapabilities`, add this after the `userAccountDeploy` member:

```ts
	/**
	 * Whether think apps can deploy to the platform dispatch namespace
	 * (the DISPATCHER binding exists). When false and userAccountDeploy is
	 * false, the UI hides Deploy.
	 */
	platformDeploy: boolean;
```

- [ ] **Step 4: Return it from the controller**

In `worker/api/controllers/capabilities/controller.ts`, add this import after `import { createLogger } from '../../../logger';`:

```ts
import { isDispatcherAvailable } from '../../../utils/dispatcherUtils';
```

In the `capabilities` object literal, add this after `userAccountDeploy: env.ENABLE_USER_ACCOUNT_DEPLOY === 'true',`:

```ts
			platformDeploy: isDispatcherAvailable(env),
```

- [ ] **Step 5: Run the controller test**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 6: Write the failing guard rule for the UI**

In `src/brand/brand-guard.test.ts`, append:

```ts
describe('brand guard: deploy availability', () => {
	it('renders Deploy only when a deploy target is available', () => {
		const chat = source(frontendSources, '/src/routes/chat/chat.tsx');
		expect(chat).toMatch(/capabilities\?\.platformDeploy/);
		expect(chat).toMatch(/behaviorType === 'think' && chatId && !appLoading && deployAvailable &&/);
	});
});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the new test FAILS and all others pass.

- [ ] **Step 7: Gate the button in `chat.tsx`**

In `src/routes/chat/chat.tsx`, replace:

```tsx
	const { capabilities } = useFeature();
	const userAccountDeployEnabled = capabilities?.userAccountDeploy ?? false;
```

with:

```tsx
	const { capabilities } = useFeature();
	const userAccountDeployEnabled = capabilities?.userAccountDeploy ?? false;
	// Hide Deploy entirely when the platform has no deploy target.
	const deployAvailable = Boolean(capabilities?.platformDeploy) || userAccountDeployEnabled;
```

Then replace the header condition:

```tsx
					{behaviorType === 'think' && chatId && !appLoading && (
```

with:

```tsx
					{behaviorType === 'think' && chatId && !appLoading && deployAvailable && (
```

- [ ] **Step 8: Run tests, typecheck, and lint**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts src/brand && bun run typecheck; bun run lint`

Expected:
- Tests PASS.
- Typecheck reports only the 4 baseline errors in `packages/artifacts-viewer`.
- Lint shows 0 errors.

If typecheck reports a missing `platformDeploy` anywhere else, for example a test fixture building `PlatformCapabilities`, add `platformDeploy: false` there.

- [ ] **Step 9: Commit**

```bash
git add worker/agents/core/features/types.ts worker/api/controllers/capabilities/controller.ts worker/api/controllers/capabilities/controller.test.ts src/routes/chat/chat.tsx src/brand/brand-guard.test.ts
git commit -m "feat(capabilities): expose platform deploy availability and hide deploy without a target" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `DEPLOY_SKIP_SECRETS` in the deploy script

**Files:**
- Create: `scripts/deploy-secrets.ts`
- Create: `scripts/deploy-secrets.test.ts`
- Modify: `scripts/deploy.ts` (the imports, and `createProdVarsFile` near line 1800: `secretVars.forEach((varName) => {`)

**Interfaces:**
- Produces: `filterSkippedSecrets(names: readonly string[], skipList: string | undefined): string[]`.
- Produces: environment variable `DEPLOY_SKIP_SECRETS`, a comma-separated list of names, consumed by Task 4's workflow.

- [ ] **Step 1: Write the failing tests**

Create `scripts/deploy-secrets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterSkippedSecrets } from './deploy-secrets';

const NAMES = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'JWT_SECRET', 'ENABLE_ARTIFACTS'];

describe('filterSkippedSecrets', () => {
	it('keeps every name when nothing is skipped', () => {
		expect(filterSkippedSecrets(NAMES, undefined)).toEqual(NAMES);
		expect(filterSkippedSecrets(NAMES, '')).toEqual(NAMES);
	});

	it('drops the listed names', () => {
		expect(filterSkippedSecrets(NAMES, 'CLOUDFLARE_API_TOKEN')).toEqual([
			'CLOUDFLARE_ACCOUNT_ID',
			'JWT_SECRET',
			'ENABLE_ARTIFACTS',
		]);
	});

	it('trims entries and ignores empty and unknown ones', () => {
		expect(filterSkippedSecrets(NAMES, ' CLOUDFLARE_API_TOKEN , ,NOT_A_SECRET ')).toEqual([
			'CLOUDFLARE_ACCOUNT_ID',
			'JWT_SECRET',
			'ENABLE_ARTIFACTS',
		]);
	});

	it('keeps JWT_SECRET unless it is explicitly skipped', () => {
		expect(filterSkippedSecrets(NAMES, 'CLOUDFLARE_API_TOKEN')).toContain('JWT_SECRET');
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test scripts/deploy-secrets.test.ts`

Expected: FAIL, because `./deploy-secrets` cannot be resolved.

- [ ] **Step 3: Implement the helper**

Create `scripts/deploy-secrets.ts`:

```ts
/**
 * Removes the names listed in a comma-separated skip list (DEPLOY_SKIP_SECRETS)
 * from the variables the deploy script uploads as Worker secrets.
 */
export function filterSkippedSecrets(names: readonly string[], skipList: string | undefined): string[] {
	const skipped = new Set(
		(skipList ?? '')
			.split(',')
			.map((name) => name.trim())
			.filter((name) => name.length > 0),
	);
	return names.filter((name) => !skipped.has(name));
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test scripts/deploy-secrets.test.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Use it in `deploy.ts`**

Add this import next to the script's other local imports at the top of `scripts/deploy.ts`. If none exist, put it directly after the last `import` line.

```ts
import { filterSkippedSecrets } from './deploy-secrets';
```

In `createProdVarsFile`, replace:

```ts
		secretVars.forEach((varName) => {
```

with:

```ts
		filterSkippedSecrets(secretVars, process.env.DEPLOY_SKIP_SECRETS).forEach((varName) => {
```

Run: `grep -n "filterSkippedSecrets" scripts/deploy.ts`

Expected: 2 lines, the import and the call.

- [ ] **Step 6: Confirm the script still parses**

Run: `bun build scripts/deploy.ts --target=bun --outdir "$(mktemp -d)" > /dev/null && echo BUILD_OK`

Expected: `BUILD_OK`.

- [ ] **Step 7: Commit**

```bash
git add scripts/deploy-secrets.ts scripts/deploy-secrets.test.ts scripts/deploy.ts
git commit -m "feat(deploy): allow skipping secrets from the worker upload" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Post-deploy smoke script

**Files:**
- Create: `scripts/estori-smoke.ts`
- Create: `scripts/estori-smoke.test.ts`

**Interfaces:**
- Produces:
  - `runSmokeChecks(config: SmokeConfig, fetchImpl: FetchLike): Promise<SmokeResult[]>`
  - `SmokeConfig = { appOrigin: string; previewProbeUrl: string; apexUrl: string; accessClientId: string; accessClientSecret: string }`
  - `SmokeResult = { name: string; ok: boolean; detail: string }`
  - CLI `bun scripts/estori-smoke.ts`, reading env `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET` (required), plus optional `ESTORI_APP_ORIGIN`, `ESTORI_PREVIEW_PROBE_URL` and `ESTORI_APEX_URL`.
- Consumed by: Task 4 (workflow step).

- [ ] **Step 1: Write the failing tests**

Create `scripts/estori-smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runSmokeChecks, type SmokeConfig } from './estori-smoke';

const CONFIG: SmokeConfig = {
	appOrigin: 'https://app.getestori.com',
	previewProbeUrl: 'https://smoke.apps.getestori.com/',
	apexUrl: 'https://getestori.com/',
	accessClientId: 'id',
	accessClientSecret: 'secret',
};

type Route = (init?: RequestInit) => Response;

function fakeFetch(routes: Record<string, Route>) {
	const seen: Array<{ url: string; headers: Headers }> = [];
	const impl = async (url: string, init?: RequestInit): Promise<Response> => {
		seen.push({ url, headers: new Headers(init?.headers) });
		const route = routes[url];
		if (!route) throw new Error(`unexpected fetch ${url}`);
		return route(init);
	};
	return { impl, seen };
}

const healthy: Record<string, Route> = {
	'https://app.getestori.com/api/health': () => Response.json({ status: 'ok' }),
	'https://app.getestori.com/api/capabilities': () =>
		Response.json({ success: true, data: { platformDeploy: false, artifacts: true } }),
	'https://smoke.apps.getestori.com/': () =>
		new Response('not found', { status: 404, headers: { server: 'cloudflare' } }),
	'https://getestori.com/': () => new Response('<html>', { status: 200, headers: { server: 'Vercel' } }),
};

describe('runSmokeChecks', () => {
	it('passes every check against a healthy deployment', async () => {
		const { impl } = fakeFetch(healthy);
		const results = await runSmokeChecks(CONFIG, impl);
		expect(results.map((r) => [r.name, r.ok])).toEqual([
			['health', true],
			['capabilities', true],
			['preview-host', true],
			['marketing-apex', true],
		]);
	});

	it('sends Access service-token headers to the app host only', async () => {
		const { impl, seen } = fakeFetch(healthy);
		await runSmokeChecks(CONFIG, impl);
		const app = seen.filter((s) => s.url.startsWith(CONFIG.appOrigin));
		const other = seen.filter((s) => !s.url.startsWith(CONFIG.appOrigin));
		expect(app.every((s) => s.headers.get('CF-Access-Client-Id') === 'id')).toBe(true);
		expect(app.every((s) => s.headers.get('CF-Access-Client-Secret') === 'secret')).toBe(true);
		expect(other.every((s) => s.headers.get('CF-Access-Client-Id') === null)).toBe(true);
	});

	it('fails health on a non-ok status', async () => {
		const { impl } = fakeFetch({ ...healthy, 'https://app.getestori.com/api/health': () => new Response('down', { status: 503 }) });
		const health = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'health');
		expect(health?.ok).toBe(false);
	});

	it('fails capabilities when platform deploy is exposed or artifacts is off', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://app.getestori.com/api/capabilities': () =>
				Response.json({ success: true, data: { platformDeploy: true, artifacts: false } }),
		});
		const caps = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'capabilities');
		expect(caps?.ok).toBe(false);
	});

	it('fails the preview check when Access redirects it or Vercel answers', async () => {
		const accessRedirect = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () =>
				new Response(null, { status: 302, headers: { server: 'cloudflare', location: 'https://estori.cloudflareaccess.com/cdn-cgi/access/login' } }),
		});
		const vercel = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () => new Response('x', { status: 404, headers: { server: 'Vercel' } }),
		});
		expect((await runSmokeChecks(CONFIG, accessRedirect.impl)).find((r) => r.name === 'preview-host')?.ok).toBe(false);
		expect((await runSmokeChecks(CONFIG, vercel.impl)).find((r) => r.name === 'preview-host')?.ok).toBe(false);
	});

	it('reports a thrown fetch (for example a TLS failure) as a failed check', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://smoke.apps.getestori.com/': () => {
				throw new Error('certificate has expired');
			},
		});
		const preview = (await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'preview-host');
		expect(preview).toEqual({ name: 'preview-host', ok: false, detail: 'certificate has expired' });
	});

	it('fails the apex check when the marketing site is no longer served by Vercel', async () => {
		const { impl } = fakeFetch({
			...healthy,
			'https://getestori.com/': () => new Response('x', { status: 200, headers: { server: 'cloudflare' } }),
		});
		expect((await runSmokeChecks(CONFIG, impl)).find((r) => r.name === 'marketing-apex')?.ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test scripts/estori-smoke.test.ts`

Expected: FAIL, because `./estori-smoke` cannot be resolved.

- [ ] **Step 3: Implement the smoke script**

Create `scripts/estori-smoke.ts`:

```ts
/**
 * Post-deploy smoke checks for the Estori production Worker.
 * Usage (CI): ACCESS_CLIENT_ID=... ACCESS_CLIENT_SECRET=... bun scripts/estori-smoke.ts
 */

export interface SmokeConfig {
	appOrigin: string;
	previewProbeUrl: string;
	apexUrl: string;
	accessClientId: string;
	accessClientSecret: string;
}

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface CapabilitiesBody {
	data?: { platformDeploy?: boolean; artifacts?: boolean };
}

async function check(name: string, probe: () => Promise<string | null>): Promise<SmokeResult> {
	try {
		const problem = await probe();
		return { name, ok: problem === null, detail: problem ?? 'ok' };
	} catch (error) {
		return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
}

export async function runSmokeChecks(config: SmokeConfig, fetchImpl: FetchLike): Promise<SmokeResult[]> {
	const accessHeaders = {
		'CF-Access-Client-Id': config.accessClientId,
		'CF-Access-Client-Secret': config.accessClientSecret,
	};

	return [
		await check('health', async () => {
			const res = await fetchImpl(`${config.appOrigin}/api/health`, { headers: accessHeaders, redirect: 'manual' });
			if (res.status !== 200) return `expected 200, got ${res.status}`;
			const body = (await res.json()) as { status?: string };
			return body.status === 'ok' ? null : `unexpected body ${JSON.stringify(body)}`;
		}),
		await check('capabilities', async () => {
			const res = await fetchImpl(`${config.appOrigin}/api/capabilities`, { headers: accessHeaders, redirect: 'manual' });
			if (res.status !== 200) return `expected 200, got ${res.status}`;
			const body = (await res.json()) as CapabilitiesBody;
			if (body.data?.platformDeploy !== false) return 'platformDeploy must be false for the beta';
			if (body.data?.artifacts !== true) return 'artifacts must be true';
			return null;
		}),
		await check('preview-host', async () => {
			const res = await fetchImpl(config.previewProbeUrl, { redirect: 'manual' });
			const location = res.headers.get('location') ?? '';
			if (location.includes('cloudflareaccess.com')) return 'preview host is behind Access';
			const server = res.headers.get('server') ?? '';
			return server.toLowerCase() === 'cloudflare' ? null : `preview served by "${server}", expected cloudflare`;
		}),
		await check('marketing-apex', async () => {
			const res = await fetchImpl(config.apexUrl, { redirect: 'manual' });
			const server = res.headers.get('server') ?? '';
			return server.toLowerCase() === 'vercel' ? null : `apex served by "${server}", expected Vercel`;
		}),
	];
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}`);
	return value;
}

async function main(): Promise<void> {
	const config: SmokeConfig = {
		appOrigin: process.env.ESTORI_APP_ORIGIN ?? 'https://app.getestori.com',
		previewProbeUrl: process.env.ESTORI_PREVIEW_PROBE_URL ?? 'https://smoke.apps.getestori.com/',
		apexUrl: process.env.ESTORI_APEX_URL ?? 'https://getestori.com/',
		accessClientId: requireEnv('ACCESS_CLIENT_ID'),
		accessClientSecret: requireEnv('ACCESS_CLIENT_SECRET'),
	};
	const results = await runSmokeChecks(config, (url, init) => fetch(url, init));
	for (const result of results) {
		console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`);
	}
	if (results.some((result) => !result.ok)) {
		console.log('Rollback: bunx wrangler rollback --name estori-production');
		process.exit(1);
	}
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('estori-smoke.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test scripts/estori-smoke.test.ts`

Expected: 7 tests PASS.

- [ ] **Step 5: Check the CLI's missing-credentials path**

Run: `env -u ACCESS_CLIENT_ID -u ACCESS_CLIENT_SECRET bun scripts/estori-smoke.ts; echo "exit=$?"`

Expected: `Missing required environment variable ACCESS_CLIENT_ID` and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/estori-smoke.ts scripts/estori-smoke.test.ts
git commit -m "feat(estori): add post-deploy smoke checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Deploy workflow

**Files:**
- Create: `.github/workflows/deploy-estori.yml`

**Interfaces:**
- Consumes:
  - `scripts/deploy.ts` with `WRANGLER_CONFIG_PATH`, `ENABLE_ARTIFACTS` and `DEPLOY_SKIP_SECRETS` (Task 2).
  - `scripts/estori-smoke.ts` (Task 3).
  - `wrangler.estori.jsonc` (Task 7).
- Produces:
  - GitHub `production` environment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `GOOGLE_AI_STUDIO_API_KEY`, `JWT_SECRET`, `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`.
  - GitHub `production` environment variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_URL`.
  - Task 9 creates all of these.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/deploy-estori.yml`:

```yaml
name: Deploy (Estori production)

on:
  push:
    branches: [estori-live]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: estori-production
  cancel-in-progress: false

jobs:
  gate:
    if: github.repository == 'alastrat/vibesdk'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Cache Bun install cache
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test

  deploy:
    needs: gate
    if: github.repository == 'alastrat/vibesdk'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    environment: production

    env:
      CI: true
      WRANGLER_NON_INTERACTIVE: true
      WRANGLER_CONFIG_PATH: wrangler.estori.jsonc
      # deploy.ts drops the ARTIFACTS binding unless this is "true"; it is also uploaded as a Worker secret.
      ENABLE_ARTIFACTS: "true"
      # Keep the broad deploy token out of the Worker's secrets.
      DEPLOY_SKIP_SECRETS: CLOUDFLARE_API_TOKEN
      CLOUDFLARE_AI_GATEWAY_URL: ${{ vars.CLOUDFLARE_AI_GATEWAY_URL }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Cache Bun install cache
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-bun-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Add local binaries to PATH
        run: echo "${{ github.workspace }}/node_modules/.bin" >> "$GITHUB_PATH"

      - name: Deploy via deploy script
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_AI_GATEWAY_TOKEN: ${{ secrets.CLOUDFLARE_AI_GATEWAY_TOKEN }}
          GOOGLE_AI_STUDIO_API_KEY: ${{ secrets.GOOGLE_AI_STUDIO_API_KEY }}
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
        run: bun scripts/deploy.ts

      - name: Smoke test
        env:
          ACCESS_CLIENT_ID: ${{ secrets.ACCESS_CLIENT_ID }}
          ACCESS_CLIENT_SECRET: ${{ secrets.ACCESS_CLIENT_SECRET }}
        run: bun scripts/estori-smoke.ts
```

- [ ] **Step 2: Validate the structure**

Run:

```bash
bun -e "
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
const wf = parse(readFileSync('.github/workflows/deploy-estori.yml', 'utf8'));
const checks = {
  trigger: JSON.stringify(wf.on.push.branches) === '[\"estori-live\"]',
  concurrency: wf.concurrency.group === 'estori-production' && wf.concurrency['cancel-in-progress'] === false,
  repoGuard: wf.jobs.gate.if === \"github.repository == 'alastrat/vibesdk'\" && wf.jobs.deploy.if === wf.jobs.gate.if,
  approval: wf.jobs.deploy.environment === 'production' && wf.jobs.deploy.needs === 'gate',
  config: wf.jobs.deploy.env.WRANGLER_CONFIG_PATH === 'wrangler.estori.jsonc',
  artifacts: wf.jobs.deploy.env.ENABLE_ARTIFACTS === 'true',
  skip: wf.jobs.deploy.env.DEPLOY_SKIP_SECRETS === 'CLOUDFLARE_API_TOKEN',
  smoke: wf.jobs.deploy.steps.at(-1).run === 'bun scripts/estori-smoke.ts',
};
console.log(checks);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
"; echo "exit=$?"
```

Expected: every check `true` and `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-estori.yml
git commit -m "ci(estori): add gated production deploy workflow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Runbooks

**Files:**
- Create: `docs/estori/domain-migration.md`, `docs/estori/provisioning.md`, `docs/estori/access.md`, `docs/estori/launch-checklist.md`

**Interfaces:**
- Consumes: spec sections 1–4.
- Produces: the runbooks that Tasks 6, 8, 9 and 11 follow.

- [ ] **Step 1: Write `docs/estori/domain-migration.md`**

````markdown
# Move getestori.com into the Estori Cloudflare account

Target account: Estori (`6d16ad8a9f081e4939993391bd35ca4e`). Do this before the first deploy; Worker routes need the zone in the same account.

## Before you start
- Estori account is on Workers Paid (Workers & Pages → Plans).
- Know the registrar: Cloudflare Registrar (in the old account) or external.

## 1. Old account
1. DNS → Records → Export: save the BIND file.
2. Note SSL/TLS mode, and any Redirect, Page, or Configuration Rules.
3. DNS → Settings → DNSSEC: disable. If the registrar is external, also delete the DS record there.
4. SSL/TLS → Edge Certificates: cancel Advanced Certificate Manager. Ask Cloudflare billing about prorating.

## 2. Estori account
1. Add a domain → `getestori.com` → Free plan.
2. DNS → Records → Import the BIND file. Set every imported record to DNS only (grey cloud).
3. Check the apex and `www` still point at Vercel (`76.76.21.21` or the Vercel CNAME), and that MX/TXT/SPF records match the export.
4. Buy Advanced Certificate Manager and order a certificate for `getestori.com`, `*.getestori.com`, `*.apps.getestori.com`.
5. Add the preview wildcard record: type `AAAA`, name `*.apps`, content `100::`, Proxied (orange cloud).

## 3. Switch authority
- External registrar: replace the nameservers with the two shown on the Estori zone's Overview.
- Cloudflare Registrar: old account → Domain Registration → Manage → Configuration → move to account `6d16ad8a9f081e4939993391bd35ca4e`. Accept in the Estori account within 5 days. The registration is transfer-locked for 30 days after.

## 4. Wait and verify
```bash
dig +short NS getestori.com
dig +short getestori.com
curl -sI https://getestori.com | grep -i '^server'
dig +short MX getestori.com
```
Expect: the Estori nameserver pair; the Vercel address; `server: Vercel`; the original MX records. Zone and ACM certificate both show Active in the dashboard. Then delete the zone from the old account.
````

- [ ] **Step 2: Write `docs/estori/provisioning.md`**

````markdown
# Provision Estori production resources

Run once, logged in to the Estori account (`wrangler whoami` lists Estori).

## Create resources
```bash
./node_modules/.bin/wrangler d1 create estori-db
./node_modules/.bin/wrangler kv namespace create estori-store
./node_modules/.bin/wrangler r2 bucket create estori-assets
```
R2 must be enabled for the account first (R2 → Overview → Purchase/enable, free tier).

Artifacts needs no command: the `estori-production` namespace is created automatically with the first repository. The AI Gateway `estori-gateway` already exists.

The D1 and KV IDs go into `wrangler.estori.jsonc` (see the implementation plan, Task 7).

## Worker secrets set once (after the first deploy)
```bash
./node_modules/.bin/wrangler secret put JWT_SECRET --config wrangler.estori.jsonc
./node_modules/.bin/wrangler secret put ARTIFACTS_API_TOKEN --config wrangler.estori.jsonc
```
Use the same `JWT_SECRET` value stored in the GitHub `production` environment. Never regenerate it: a new value signs everyone out.

All other runtime values reach the Worker through the deploy (`scripts/deploy.ts` uploads them from CI env): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `CLOUDFLARE_AI_GATEWAY_URL`, `GOOGLE_AI_STUDIO_API_KEY`, `ENABLE_ARTIFACTS`. Do not add dashboard variables with these names; they collide with the uploaded secrets.

## Releasing
```bash
git push origin <commit>:refs/heads/estori-live
```
Then approve the `production` environment in the GitHub Actions run.

## Rollback
```bash
./node_modules/.bin/wrangler rollback --name estori-production
```
D1 migrations are forward-only. Every migration must work with the previous Worker version.
````

- [ ] **Step 3: Write `docs/estori/access.md`**

````markdown
# Cloudflare Access for the Estori beta

In the Estori account: Zero Trust (free, up to 50 users).

1. Create the Zero Trust organization (team name, for example `estori`) if prompted.
2. Settings → Authentication → Login methods: enable One-time PIN.
3. Access → Applications → Add → Self-hosted:
   - Name `Estori`, domain `app.getestori.com`, path empty (all paths).
   - Session duration: 24 hours.
4. Policy `Beta invitees`: Action Allow; Include → Emails → the invitee list (add `Emails ending in` a domain if wanted).
5. Access → Service Auth → Service Tokens → Create `estori-ci-smoke`. Copy the Client ID and Client Secret into the GitHub `production` environment as `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET`.
6. Policy `CI smoke`: Action Service Auth; Include → Service Token → `estori-ci-smoke`.
7. Do not create an application for `*.apps.getestori.com`. Previews are protected by signed URLs and must load without Access.

Inviting someone: add their email to `Beta invitees`. No deploy needed.
````

- [ ] **Step 4: Write `docs/estori/launch-checklist.md`**

````markdown
# First launch checklist

Run after the first successful deploy and smoke test.

1. Private window → `https://app.getestori.com` → Access asks for an email. A non-invited email gets no PIN or is refused. An invited email receives a PIN and gets through.
2. `curl -sI https://app.getestori.com/api/health` (no credentials) → a 302 to `*.cloudflareaccess.com`, never `200`.
3. Sign up with email and password.
4. Create an app ("Create a habit tracker"). The agent streams; the preview loads on a `*.apps.getestori.com` URL.
5. Repo tab shows at least one commit (Artifacts).
6. Ask "Who are you?" → the answer names Estori.
7. While signed in, trigger a redeploy (Actions → Deploy (Estori production) → Run workflow → approve). Reload the app: still signed in.
8. `https://getestori.com` and `https://www.getestori.com` still show the Vercel marketing site.
9. No Deploy button in the chat header.
````

- [ ] **Step 5: Commit**

```bash
git add docs/estori
git commit -m "docs(estori): add launch runbooks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Provision production resources (owner go-ahead required)

**Files:** none committed in this task. The IDs it captures feed Task 7.

**Interfaces:**
- Produces: shell variables `D1_ID` (UUID) and `KV_ID` (32 hex characters), recorded in the session for Task 7. Also the R2 bucket `estori-assets`.

- [ ] **Step 1: Confirm prerequisites with the owner**

Ask the owner to confirm in chat:
- the Estori account is on Workers Paid;
- R2 is enabled.

Then run: `./node_modules/.bin/wrangler whoami 2>&1 | sed -n '/Account Name/,/┘/p'`

Expected: only `Estori │ 6d16ad8a9f081e4939993391bd35ca4e`.

- [ ] **Step 2: Create the resources (after the owner's go-ahead)**

Run:

```bash
export CLOUDFLARE_ACCOUNT_ID=6d16ad8a9f081e4939993391bd35ca4e
./node_modules/.bin/wrangler d1 create estori-db
./node_modules/.bin/wrangler kv namespace create estori-store
./node_modules/.bin/wrangler r2 bucket create estori-assets
```

Expected: each command reports success. The D1 output includes a `database_id`, and the KV output includes an `id`.

- [ ] **Step 3: Capture the IDs**

Run:

```bash
export CLOUDFLARE_ACCOUNT_ID=6d16ad8a9f081e4939993391bd35ca4e
D1_ID=$(./node_modules/.bin/wrangler d1 info estori-db --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).uuid))")
KV_ID=$(./node_modules/.bin/wrangler kv namespace list | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=JSON.parse(s.slice(s.indexOf('['))).find(x=>x.title.endsWith('estori-store'));console.log(n.id)})")
echo "D1_ID=$D1_ID"; echo "KV_ID=$KV_ID"
```

Expected:
- `D1_ID` is a UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
- `KV_ID` is 32 hex characters.

Record both in the ledger for Task 7.

---

### Task 7: `wrangler.estori.jsonc`

**Files:**
- Create: `wrangler.estori.jsonc`
- Create: `scripts/estori-config.test.ts`

**Interfaces:**
- Consumes: `D1_ID` and `KV_ID` from Task 6.
- Produces: the production config read by `deploy.ts` through `WRANGLER_CONFIG_PATH` (Task 4).

- [ ] **Step 1: Write the failing config test**

Create `scripts/estori-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import estoriRaw from '../wrangler.estori.jsonc?raw';
import upstreamRaw from '../wrangler.jsonc?raw';

interface Binding { binding?: string; name?: string; [key: string]: unknown }
interface WranglerConfig {
	name: string;
	routes?: Array<Record<string, unknown>>;
	vars?: Record<string, unknown>;
	d1_databases?: Binding[];
	kv_namespaces?: Binding[];
	r2_buckets?: Binding[];
	artifacts?: Binding[];
	containers?: unknown[];
	dispatch_namespaces?: unknown[];
	durable_objects?: { bindings: Binding[] };
	migrations?: unknown[];
	keep_vars?: boolean;
	workers_dev?: boolean;
	assets?: unknown;
	worker_loaders?: unknown;
}

const estori = parse(estoriRaw) as WranglerConfig;
const upstream = parse(upstreamRaw) as WranglerConfig;

describe('wrangler.estori.jsonc', () => {
	it('names the production worker', () => {
		expect(estori.name).toBe('estori-production');
	});

	it('has no container sandbox and no dispatch namespace', () => {
		expect(estori.containers).toBeUndefined();
		expect(estori.dispatch_namespaces).toBeUndefined();
	});

	it('binds Estori data resources with real ids', () => {
		expect(estori.d1_databases).toEqual([
			{ binding: 'DB', database_name: 'estori-db', database_id: expect.stringMatching(/^[0-9a-f-]{36}$/), migrations_dir: 'migrations' },
		]);
		expect(estori.kv_namespaces).toEqual([{ binding: 'VibecoderStore', id: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
		expect(estori.r2_buckets).toEqual([{ binding: 'TEMPLATES_BUCKET', bucket_name: 'estori-assets' }]);
		expect(estori.artifacts).toEqual([{ binding: 'ARTIFACTS', namespace: 'estori-production' }]);
		expect(estoriRaw).not.toContain('__ESTORI_');
	});

	it('routes the app host and the preview wildcard', () => {
		expect(estori.routes).toEqual([
			{ pattern: 'app.getestori.com', custom_domain: true },
			{ pattern: '*apps.getestori.com/*', zone_name: 'getestori.com' },
		]);
	});

	it('sets the Estori vars without dev or dispatch settings', () => {
		expect(estori.vars).toMatchObject({
			CUSTOM_DOMAIN: 'app.getestori.com',
			CUSTOM_PREVIEW_DOMAIN: 'apps.getestori.com',
			ENVIRONMENT: 'prod',
			CLOUDFLARE_AI_GATEWAY: 'estori-gateway',
			ARTIFACTS_NAMESPACE: 'estori-production',
		});
		const keys = Object.keys(estori.vars ?? {});
		expect(keys.filter((k) => k.startsWith('DEV_BROWSER_') || k === 'DISPATCH_NAMESPACE')).toEqual([]);
	});

	it('keeps Durable Objects, migrations, assets and loaders identical to upstream', () => {
		expect(estori.durable_objects).toEqual(upstream.durable_objects);
		expect(estori.migrations).toEqual(upstream.migrations);
		expect(estori.assets).toEqual(upstream.assets);
		expect(estori.worker_loaders).toEqual(upstream.worker_loaders);
		expect(estori.keep_vars).toBe(true);
		expect(estori.workers_dev).toBe(false);
	});
});
```

Note: `upstream` must be the **committed** `wrangler.jsonc`. If the local working copy carries the local-only edits (Artifacts and dispatch removed, containers off), they do not touch `durable_objects`, `migrations`, `assets` or `worker_loaders`, so the comparison still holds.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test scripts/estori-config.test.ts`

Expected: FAIL, because `../wrangler.estori.jsonc?raw` cannot be found.

- [ ] **Step 3: Create the config with ID tokens**

Create `wrangler.estori.jsonc`:

```jsonc
/**
 * Estori production Worker configuration.
 * Deployed with WRANGLER_CONFIG_PATH=wrangler.estori.jsonc (see .github/workflows/deploy-estori.yml).
 * Derived from the upstream wrangler.jsonc: no container sandbox, no dispatch namespace,
 * Artifacts enabled, Estori resources and hosts.
 */
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "estori-production",
	"main": "worker/index.ts",
	"alias": {
		"artifacts-viewer": "./packages/artifacts-viewer/packages/artifacts-viewer/src/index.ts",
		"artifacts-viewer/server/cache": "./packages/artifacts-viewer/packages/artifacts-viewer/src/server/cache-adapters.ts"
	},
	"compatibility_date": "2026-05-23",
	"compatibility_flags": ["nodejs_compat"],
	"keep_vars": true,
	"rules": [
		{ "type": "Text", "globs": ["**/*.md", "**/*.md?raw"], "fallthrough": true }
	],
	"version_metadata": {
		"binding": "CF_VERSION_METADATA"
	},
	"assets": {
		"directory": "dist/client",
		"not_found_handling": "single-page-application",
		"run_worker_first": true,
		"binding": "ASSETS"
	},
	"observability": {
		"enabled": true,
		"head_sampling_rate": 1,
		"logs": {
			"enabled": true,
			"invocation_logs": true
		},
		"traces": {
			"enabled": true
		}
	},
	"unsafe": {
		"bindings": [
			{
				"name": "API_RATE_LIMITER",
				"type": "ratelimit",
				"namespace_id": "2101",
				"simple": { "limit": 10000, "period": 60 }
			},
			{
				"name": "AUTH_RATE_LIMITER",
				"type": "ratelimit",
				"namespace_id": "2102",
				"simple": { "limit": 1000, "period": 60 }
			}
		]
	},
	"ai": {
		"binding": "AI"
	},
	"browser": {
		"binding": "BROWSER"
	},
	"artifacts": [
		{
			"binding": "ARTIFACTS",
			"namespace": "estori-production"
		}
	],
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "estori-db",
			"database_id": "__ESTORI_D1_ID__",
			"migrations_dir": "migrations"
		}
	],
	"durable_objects": {
		"bindings": [
			{ "class_name": "CodeGeneratorAgent", "name": "CodeGenObject" },
			{ "class_name": "UserAppSandboxService", "name": "Sandbox" },
			{ "class_name": "DORateLimitStore", "name": "DORateLimitStore" },
			{ "class_name": "UserSecretsStore", "name": "UserSecretsStore" },
			{ "class_name": "ThinkAgent", "name": "THINK_DO" },
			{ "class_name": "SpaceDO", "name": "SPACE_DO" }
		]
	},
	"worker_loaders": [
		{ "binding": "LOADER" }
	],
	"r2_buckets": [
		{
			"binding": "TEMPLATES_BUCKET",
			"bucket_name": "estori-assets"
		}
	],
	"kv_namespaces": [
		{
			"binding": "VibecoderStore",
			"id": "__ESTORI_KV_ID__"
		}
	],
	"migrations": [
		{ "new_sqlite_classes": ["CodeGeneratorAgent", "UserAppSandboxService"], "tag": "v1" },
		{ "new_sqlite_classes": ["DORateLimitStore"], "tag": "v2" },
		{ "new_sqlite_classes": ["UserSecretsStore"], "tag": "v3" },
		{ "new_sqlite_classes": ["SpaceDO"], "tag": "v5" },
		{ "new_sqlite_classes": ["ThinkAgent"], "tag": "v6" }
	],
	"routes": [
		{
			"pattern": "app.getestori.com",
			"custom_domain": true
		},
		{
			"pattern": "*apps.getestori.com/*",
			"zone_name": "getestori.com"
		}
	],
	"vars": {
		"TEMPLATES_REPOSITORY": "https://github.com/cloudflare/vibesdk-templates",
		"CLOUDFLARE_AI_GATEWAY": "estori-gateway",
		"ARTIFACTS_NAMESPACE": "estori-production",
		"PLATFORM_CAPABILITIES": {
			"features": {
				"app": { "enabled": true },
				"presentation": { "enabled": false },
				"general": { "enabled": false }
			},
			"version": "1.0.0"
		},
		"CUSTOM_DOMAIN": "app.getestori.com",
		"CUSTOM_PREVIEW_DOMAIN": "apps.getestori.com",
		"ENVIRONMENT": "prod"
	},
	"workers_dev": false,
	"preview_urls": false
}
```

The preview route uses `*apps.getestori.com/*`, the same form `deploy.ts` writes from `CUSTOM_PREVIEW_DOMAIN` (as upstream's `*build-preview.cloudflare.dev/*`), so the committed file and the deployed routes match.

- [ ] **Step 4: Fill in the IDs from Task 6**

Run (using the values recorded in Task 6):

```bash
sed -i '' -e "s/__ESTORI_D1_ID__/$D1_ID/" -e "s/__ESTORI_KV_ID__/$KV_ID/" wrangler.estori.jsonc
grep -c "__ESTORI_" wrangler.estori.jsonc
```

Expected: `0`.

- [ ] **Step 5: Run the config test**

Run: `bun run test scripts/estori-config.test.ts`

Expected: 6 tests PASS.

If the durable-objects or migrations comparison fails, the local working copy of `wrangler.jsonc` differs from the committed upstream in those sections. Compare with `git show HEAD:wrangler.jsonc` and copy those sections exactly.

- [ ] **Step 6: Dry-run the production bundle**

Run:

```bash
bun run build > /tmp/estori-build.log 2>&1 && echo BUILD_OK
./node_modules/.bin/wrangler deploy --dry-run --config wrangler.estori.jsonc --outdir "$(mktemp -d)" 2>&1 | tee /tmp/estori-dryrun.log | tail -40
```

Expected:
- `BUILD_OK`.
- The dry run ends with `--dry-run: exiting now.`
- The binding list includes `env.ARTIFACTS`, `env.DB (estori-db)`, `env.VibecoderStore`, `env.TEMPLATES_BUCKET (estori-assets)`, `env.LOADER`, `env.AI`, `env.BROWSER`, all six Durable Objects, and the vars above.
- No `containers` and no `DISPATCHER`.

If wrangler rejects `UserAppSandboxService` without a container, stop: record a ruling and choose between keeping the class bound (current) and removing its binding while keeping migration v1.

- [ ] **Step 7: Commit**

```bash
git add wrangler.estori.jsonc scripts/estori-config.test.ts
git commit -m "feat(estori): add production wrangler config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Domain migration (owner-run; executor verifies)

**Files:** none.

**Interfaces:**
- Consumes: `docs/estori/domain-migration.md` (Task 5).
- Produces: `getestori.com` Active in the Estori account, the ACM certificate Active, and the `*.apps` proxied record.

- [ ] **Step 1: The owner runs `docs/estori/domain-migration.md` sections 1–3**

The executor waits for the owner to report that the zone shows Active in the Estori account.

- [ ] **Step 2: Verify DNS and the marketing site**

Run:

```bash
dig +short NS getestori.com
dig +short getestori.com
curl -sI https://getestori.com | grep -i '^server'
curl -sI https://www.getestori.com | grep -i '^server'
dig +short MX getestori.com
dig +short TXT getestori.com
```

Expected:
- The nameservers are the Estori zone's pair (as shown in the dashboard).
- The apex resolves to the Vercel address.
- Both `server` headers are `Vercel`.
- MX and TXT records match the exported BIND file.

- [ ] **Step 3: Verify the wildcard certificate**

Run: `echo | openssl s_client -connect smoke.apps.getestori.com:443 -servername smoke.apps.getestori.com 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`

Expected: the SAN list includes `*.apps.getestori.com`. Before the first deploy the HTTP response may be an error page; only the certificate matters here.

---

### Task 9: Access, tokens, and GitHub environment (owner-run with executor support)

**Files:** none committed.

**Interfaces:**
- Consumes: `docs/estori/access.md` (Task 5).
- Produces: the GitHub `production` environment with the secrets and variables listed in Task 4, and the Access application with its service token.

- [ ] **Step 1: The owner configures Access per `docs/estori/access.md`**

Includes the 24-hour session and the `estori-ci-smoke` service token.

- [ ] **Step 2: The owner creates three API tokens in the Estori account**

| Token | Permissions |
|---|---|
| `estori-deploy` | Account: Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Workers R2 Storage Edit, AI Gateway Edit, Artifacts Edit, Account Settings Read. Zone `getestori.com`: Workers Routes Edit, Zone Read, DNS Read |
| `estori-ai-gateway-run` | Account: AI Gateway Run |
| `estori-artifacts-read` | Account: Artifacts Read |

- [ ] **Step 3: Generate the JWT secret (executor, owner present)**

Run:

```bash
node -e '
const c=require("crypto");let s;
do{s=c.randomBytes(48).toString("base64")}while(!(/[a-z]/.test(s)&&/[A-Z]/.test(s)&&/[0-9]/.test(s)&&/[^a-zA-Z0-9]/.test(s))||/(.)\1{3,}/.test(s));
require("fs").writeFileSync(process.env.HOME+"/.estori-jwt-secret",s,{mode:0o600});console.log("written, length",s.length)'
```

Expected: `written, length 64`. The value is never printed.

- [ ] **Step 4: Create the GitHub environment and its values (after the owner's go-ahead)**

The owner creates the environment `production` in `alastrat/vibesdk` (Settings → Environments) with themselves as required reviewer. Then, with `gh` authenticated as the owner:

```bash
gh secret set JWT_SECRET --env production --repo alastrat/vibesdk < ~/.estori-jwt-secret
gh variable set CLOUDFLARE_ACCOUNT_ID --env production --repo alastrat/vibesdk --body 6d16ad8a9f081e4939993391bd35ca4e
gh variable set CLOUDFLARE_AI_GATEWAY_URL --env production --repo alastrat/vibesdk --body https://gateway.ai.cloudflare.com/v1/6d16ad8a9f081e4939993391bd35ca4e/estori-gateway/
```

The owner sets these secrets themselves with `gh secret set <NAME> --env production --repo alastrat/vibesdk`, pasting each value at the prompt:
- `CLOUDFLARE_API_TOKEN` (the `estori-deploy` token)
- `CLOUDFLARE_AI_GATEWAY_TOKEN`
- `GOOGLE_AI_STUDIO_API_KEY`
- `ACCESS_CLIENT_ID`
- `ACCESS_CLIENT_SECRET`

- [ ] **Step 5: Verify**

Run:

```bash
gh secret list --env production --repo alastrat/vibesdk
gh variable list --env production --repo alastrat/vibesdk
```

Expected:
- Secrets: `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `CLOUDFLARE_API_TOKEN`, `GOOGLE_AI_STUDIO_API_KEY`, `JWT_SECRET`.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_URL`.

---

### Task 10: CI gate baseline on Linux (owner go-ahead to push)

**Files:**
- Modify: only if the gate fails, as the steps below describe.

**Interfaces:**
- Consumes: Tasks 1–7 committed; the Task 9 environment exists, so the deploy job will wait for approval.
- Produces: a green `gate` job on GitHub Actions.

- [ ] **Step 1: Push the branch and trigger the gate (after the owner's go-ahead)**

Run:

```bash
git push -u origin claude/project-analysis-local-setup-dfd834
git push origin HEAD:refs/heads/estori-live
gh run list --repo alastrat/vibesdk --workflow deploy-estori.yml --limit 1
```

Expected: a run in progress. The `deploy` job will show "Waiting" for approval; **do not approve it in this task.**

- [ ] **Step 2: Read the gate result**

Run: `gh run watch --repo alastrat/vibesdk --exit-status $(gh run list --repo alastrat/vibesdk --workflow deploy-estori.yml --limit 1 --json databaseId -q '.[0].databaseId') || true`

Expected: the `gate` job is green. If it is green, skip to Step 4.

- [ ] **Step 3: If the gate is red, fix or quarantine each failure**

- **Lint or typecheck in our files:** fix them, with a test where behavior changes.
- **Typecheck errors only in `packages/artifacts-viewer` (vendored):** replace the workflow's Typecheck step with a check that fails on any error outside that package, and record a ruling:

```yaml
      - name: Typecheck (vendored artifacts-viewer excluded)
        run: |
          set -o pipefail
          out=$(bun run typecheck 2>&1 || true)
          echo "$out"
          if echo "$out" | grep -E "error TS" | grep -v '^packages/artifacts-viewer/'; then exit 1; fi
```

- **Failing test files that also fail on `main` (pre-existing):** add one `--exclude` per file to the Test step, each with a comment giving the reason, then record a ruling per file:

```yaml
      - name: Test
        # Quarantined (pre-existing failures on main, see ledger rulings):
        run: bun run test --exclude 'space/test/git-objects.test.ts'
```

Fail-only-new tests are bugs: fix them rather than excluding them.

Commit the change with `ci(estori): <what changed>`, push both refs again, and repeat Step 2 until the gate is green.

- [ ] **Step 4: Cancel the waiting deploy**

Run: `gh run cancel --repo alastrat/vibesdk $(gh run list --repo alastrat/vibesdk --workflow deploy-estori.yml --limit 1 --json databaseId -q '.[0].databaseId')`

Expected: the run shows cancelled with no deploy performed.

---

### Task 11: First production deploy and launch checks (owner approves)

**Files:** none, unless a check fails. Fixes then follow TDD in their own commits.

**Interfaces:**
- Consumes: everything above.
- Produces: Estori live at `app.getestori.com` for invited users.

- [ ] **Step 1: Release and approve**

Run: `gh workflow run deploy-estori.yml --repo alastrat/vibesdk --ref estori-live`

Then the owner approves the `production` environment in the Actions UI.

- [ ] **Step 2: Watch the deploy**

Run: `gh run watch --repo alastrat/vibesdk --exit-status $(gh run list --repo alastrat/vibesdk --workflow deploy-estori.yml --limit 1 --json databaseId -q '.[0].databaseId')`

Expected:
- The deploy step completes, including `db:migrate:remote`.
- The smoke step **may fail on `health` only**: `JWT_SECRET` is not on the Worker yet. That does not affect `/api/health`, but any failure is read before continuing.

- [ ] **Step 3: Set the one-time Worker secrets (owner present)**

Run:

```bash
export CLOUDFLARE_ACCOUNT_ID=6d16ad8a9f081e4939993391bd35ca4e
./node_modules/.bin/wrangler secret put JWT_SECRET --config wrangler.estori.jsonc < ~/.estori-jwt-secret
./node_modules/.bin/wrangler secret put ARTIFACTS_API_TOKEN --config wrangler.estori.jsonc
rm ~/.estori-jwt-secret
```

The owner pastes the `estori-artifacts-read` token at the prompt.

Expected: both report `Success! Uploaded secret`.

- [ ] **Step 4: Run the smoke checks again**

Run: `gh run rerun --repo alastrat/vibesdk --failed $(gh run list --repo alastrat/vibesdk --workflow deploy-estori.yml --limit 1 --json databaseId -q '.[0].databaseId')` if the first smoke failed. Otherwise run the smoke script locally with the service token:

```bash
ACCESS_CLIENT_ID=<from owner> ACCESS_CLIENT_SECRET=<from owner> bun scripts/estori-smoke.ts
```

Expected: `PASS health`, `PASS capabilities`, `PASS preview-host`, `PASS marketing-apex`.

- [ ] **Step 5: Run `docs/estori/launch-checklist.md` with the owner (Review Focus 1, 2, 5)**

Record each of the 9 items as pass or fail in the ledger. Item 2 (unauthenticated `curl` gets a 302 to Access) and item 7 (redeploy keeps the session) are required.

- [ ] **Step 6: Commit any fixes**

Fixes from Step 5 are committed by path with conventional, lowercase subjects. Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`.
