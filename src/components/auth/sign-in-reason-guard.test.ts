import { describe, expect, it } from 'vitest';

const loaders = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/**/*.{test,spec,d}.{ts,tsx}'], { query: '?raw', import: 'default' });

async function sources(): Promise<Array<{ path: string; text: string }>> {
	return Promise.all(Object.entries(loaders).map(async ([path, load]) => ({ path, text: await load() })));
}

/** A whole sentence marked for the catalogs, as the window shows it translated: `msg('Sign in to star this app')`. */
const REASON = /^msg\('Sign in [^']+'\)/;

describe('why sign-in was asked for', () => {
	// Every source file is read here, so the default 5 s is too little.
	it('is a whole sentence marked with msg() wherever a caller gives it, never a fragment that is joined into one', async () => {
		const found: string[] = [];
		const wrong: string[] = [];
		for (const { path, text } of await sources()) {
			for (const match of text.matchAll(/\bactionContext\s*(?::|=)\s*([^\n]+)/g)) {
				const value = match[1].trim();
				// Passing one on is fine: a parameter, or the context of an action that has its own.
				if (/^(?:actionContext|config\.context|context|options\.actionContext|\{modalContext\})/.test(value) || /^\?/.test(value)) continue;
				found.push(`${path}: ${value}`);
				if (!REASON.test(value)) wrong.push(`${path}: ${value}`);
			}
			for (const match of text.matchAll(/\bshowAuthModal\(\s*(msg\('[^']*'\)|[^,)\n]+)/g)) {
				const value = match[1].trim();
				if (/^(?:undefined|context|options\.actionContext)$/.test(value)) continue;
				found.push(`${path}: ${value}`);
				if (!REASON.test(value)) wrong.push(`${path}: ${value}`);
			}
		}
		expect(wrong).toEqual([]);
		// The callers this was written for are still being found, so the scan cannot pass by finding nothing.
		expect(found.length).toBeGreaterThanOrEqual(7);
	}, 30_000);

	it('is a whole sentence for each endpoint that answers 401, and for each action of the app page', async () => {
		const all = await sources();
		const client = all.find(({ path }) => path === '/src/lib/api-client.ts')?.text ?? '';
		const body = client.slice(client.indexOf('getAuthContextForEndpoint(endpoint: string)'), client.indexOf('shouldTriggerAuthModal(endpoint: string)'));
		const returns = [...body.matchAll(/return ([^;\n]+);/g)].map((match) => match[1]);
		expect(returns.length).toBeGreaterThanOrEqual(6);
		for (const value of returns) expect(value).toMatch(REASON);

		const page = all.find(({ path }) => path === '/src/routes/app/index.tsx')?.text ?? '';
		const contexts = [...page.matchAll(/\bcontext:[ \t]+(?!string\b)([^\n]+)/g)].map((match) => match[1].trim());
		expect(contexts).toHaveLength(2);
		for (const value of contexts) expect(value).toMatch(REASON);
	});
});
