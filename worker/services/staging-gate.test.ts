import { describe, expect, it } from 'vitest';
import { STAGING_GATE_PATH, stagingGate } from './staging-gate';

const KEY = 'correct-horse-battery-staple';
const HOSTS = { previewDomain: 'preview-staging.estori.app', separatePreviewDomain: true };
const env = (key?: string) => ({ STAGING_GATE_KEY: key }) as unknown as Env;
const at = (path: string, init?: RequestInit) => new Request(`https://staging.estori.app${path}`, init);

async function unlockCookie(): Promise<string> {
	const response = await stagingGate(at(STAGING_GATE_PATH, { method: 'POST', body: new URLSearchParams({ key: KEY }) }), env(KEY), HOSTS);
	const cookie = response?.headers.get('Set-Cookie') ?? '';
	return cookie.split(';')[0];
}

describe('the staging gate', () => {
	it('does nothing where no key is set, as in production', async () => {
		expect(await stagingGate(at('/'), env(undefined), HOSTS)).toBeNull();
	});

	it('locks pages and APIs, kept out of search engines', async () => {
		const page = await stagingGate(at('/emails'), env(KEY), HOSTS);
		expect(page?.status).toBe(401);
		expect(page?.headers.get('Content-Type')).toContain('text/html');
		expect(await page?.text()).toContain(STAGING_GATE_PATH);
		expect(page?.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
		const api = await stagingGate(at('/api/health'), env(KEY), HOSTS);
		expect(api?.status).toBe(401);
		expect(await api?.json()).toMatchObject({ success: false });
	});

	it('lets in a request with the key in its header, and turns away a wrong key', async () => {
		expect(await stagingGate(at('/api/health', { headers: { 'x-estori-staging-key': KEY } }), env(KEY), HOSTS)).toBeNull();
		expect((await stagingGate(at('/api/health', { headers: { 'x-estori-staging-key': 'nope' } }), env(KEY), HOSTS))?.status).toBe(401);
	});

	it('unlocks a browser with the right key on the unlock page, for 30 days, with a cookie that holds no key', async () => {
		const form = await stagingGate(at(STAGING_GATE_PATH), env(KEY), HOSTS);
		expect(await form?.text()).toContain('<form');
		const response = await stagingGate(at(STAGING_GATE_PATH, { method: 'POST', body: new URLSearchParams({ key: KEY }) }), env(KEY), HOSTS);
		expect(response?.status).toBe(303);
		const setCookie = response?.headers.get('Set-Cookie') ?? '';
		for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=2592000', 'Path=/']) expect(setCookie).toContain(part);
		expect(setCookie).not.toContain(KEY);
		expect(await stagingGate(at('/emails', { headers: { Cookie: await unlockCookie() } }), env(KEY), HOSTS)).toBeNull();
		const wrong = await stagingGate(at(STAGING_GATE_PATH, { method: 'POST', body: new URLSearchParams({ key: 'nope' }) }), env(KEY), HOSTS);
		expect(wrong?.status).toBe(401);
		expect(wrong?.headers.get('Set-Cookie')).toBeNull();
		expect(await stagingGate(at('/emails', { headers: { Cookie: 'estori_staging=forged' } }), env(KEY), HOSTS)).not.toBeNull();
	});

	it("lets through Stripe's signed webhook and the preview host, which production doesn't lock either", async () => {
		expect(await stagingGate(at('/api/stripe/webhook', { method: 'POST', body: '{}' }), env(KEY), HOSTS)).toBeNull();
		expect(await stagingGate(new Request('https://preview-staging.estori.app/space/s/preview/main/'), env(KEY), HOSTS)).toBeNull();
		expect(await stagingGate(at('/api/stripe/webhook'), env(KEY), HOSTS)).not.toBeNull();
	});
});

const sources = import.meta.glob<string>(['/worker/index.ts'], { query: '?raw', import: 'default', eager: true });

describe('the Worker', () => {
	it('checks the staging gate before routing any host', () => {
		const index = sources['/worker/index.ts'] ?? '';
		const gate = index.indexOf('await stagingGate(request, env,');
		expect(gate).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(index.indexOf('resolveStoreHost(env, hostname)'));
	});
});
