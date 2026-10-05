/**
 * Post-deploy smoke checks for the Estori production Worker.
 * Usage (CI): ACCESS_CLIENT_ID=... ACCESS_CLIENT_SECRET=... bun scripts/estori-smoke.ts
 */

export interface SmokeConfig {
	appOrigin: string;
	previewProbeUrl: string;
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
	];
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}`);
	return value;
}

async function main(): Promise<void> {
	const config: SmokeConfig = {
		appOrigin: process.env.ESTORI_APP_ORIGIN ?? 'https://estori.app',
		previewProbeUrl: process.env.ESTORI_PREVIEW_PROBE_URL ?? 'https://preview.estori.app/',
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
