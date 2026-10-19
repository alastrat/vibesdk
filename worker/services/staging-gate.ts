/**
 * Staging locks itself with STAGING_GATE_KEY until Cloudflare Access protects it. A browser unlocks on the unlock
 * page and keeps a 30-day cookie holding a digest of the key, never the key; automated checks send the key in a
 * header. Stripe's signed webhook and the preview host stay open, as in production. It runs only where
 * ENVIRONMENT=staging, and staging without its key stays shut.
 */

import { parseCookies } from '../utils/authUtils';

export const STAGING_GATE_PATH = '/__staging';
const STAGING_ENVIRONMENT = 'staging';
const COOKIE = 'estori_staging';
const KEY_HEADER = 'x-estori-staging-key';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const STRIPE_WEBHOOK_PATH = '/api/stripe/webhook';
const GATE_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } as const;

const encoder = new TextEncoder();

async function digest(key: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`estori-staging-gate:${key}`)));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares without stopping at the first difference, so timing doesn't reveal how much matched. */
function sameText(a: string, b: string): boolean {
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	let difference = left.length ^ right.length;
	for (let i = 0; i < Math.max(left.length, right.length); i += 1) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
	return difference === 0;
}

function page(title: string, body: string, status: number, extra: Record<string, string> = {}): Response {
	const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;color:#1a1a1a;line-height:1.5;">
${body}
</body>
</html>`;
	return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...GATE_HEADERS, ...extra } });
}

function unlockForm(message: string | null, status: number): Response {
	return page(
		'Estori staging',
		`<h1 style="font-size:20px;">Estori staging</h1>
<p>This is Estori's test environment. Enter the staging key to continue.</p>
${message ? `<p style="color:#b42318;">${message}</p>\n` : ''}<form method="post" action="${STAGING_GATE_PATH}">
<input name="key" type="password" autocomplete="current-password" required style="width:100%;padding:8px;margin:8px 0;box-sizing:border-box;">
<button type="submit" style="padding:8px 16px;">Unlock</button>
</form>`,
		status,
	);
}

async function unlock(request: Request, key: string): Promise<Response> {
	if (request.method !== 'POST') return unlockForm(null, 200);
	const form = await request.formData().catch(() => null);
	const given = form?.get('key');
	if (typeof given !== 'string' || !sameText(given, key)) return unlockForm("That key isn't right.", 401);
	return new Response(null, {
		status: 303,
		headers: {
			Location: '/',
			'Set-Cookie': `${COOKIE}=${await digest(key)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
			...GATE_HEADERS,
		},
	});
}

function locked(pathname: string): Response {
	if (pathname.startsWith('/api/')) {
		return Response.json({ success: false, error: { message: 'Estori staging is locked' } }, { status: 401, headers: GATE_HEADERS });
	}
	return page('Estori staging', `<h1 style="font-size:20px;">Estori staging is locked</h1>\n<p><a href="${STAGING_GATE_PATH}">Unlock it with the staging key</a>.</p>`, 401);
}

/** The response that keeps a request out, or null to let it through. */
export async function stagingGate(request: Request, env: Env, hosts: { previewDomain: string; separatePreviewDomain: boolean }): Promise<Response | null> {
	// Only staging is ever gated, so a key that reaches local development or production locks nothing.
	if (env.ENVIRONMENT !== STAGING_ENVIRONMENT) return null;
	const key = env.STAGING_GATE_KEY?.trim();
	// Staging without its key stays shut, so a deploy that lands before the key is set is never open.
	if (!key) return page('Estori staging', '<h1 style="font-size:20px;">Estori staging isn\'t set up yet</h1>', 503);
	const { hostname, pathname } = new URL(request.url);
	if (hosts.separatePreviewDomain && hostname === hosts.previewDomain) return null;
	if (pathname === STRIPE_WEBHOOK_PATH && request.method === 'POST') return null;
	if (pathname === STAGING_GATE_PATH) return unlock(request, key);
	const header = request.headers.get(KEY_HEADER);
	if (header !== null && sameText(header, key)) return null;
	const cookie = parseCookies(request.headers.get('Cookie') ?? '')[COOKIE];
	if (cookie && sameText(cookie, await digest(key))) return null;
	return locked(pathname);
}
