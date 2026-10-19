import { describe, expect, it } from 'vitest';

const configs = import.meta.glob<string>(['/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'], { query: '?raw', import: 'default', eager: true });

function config(path: string): string {
	const text = configs[path];
	if (text === undefined) throw new Error(`Config not found: ${path}`);
	return text;
}

/** Every value a key holds in a config, such as each route's pattern. */
function valuesOf(text: string, key: string): string[] {
	return [...text.matchAll(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'g'))].map((match) => match[1]);
}

describe('the staging config', () => {
	const production = config('/wrangler.estori.jsonc');
	const staging = config('/wrangler.estori-staging.jsonc');

	it("never names production's hosts, data or Worker, since a push to main deploys it without approval", () => {
		// The Worker's own name is the first "name"; binding names after it are meant to match.
		expect(valuesOf(staging, 'name')[0]).not.toBe(valuesOf(production, 'name')[0]);
		for (const key of ['pattern', 'CUSTOM_DOMAIN', 'CUSTOM_PREVIEW_DOMAIN', 'database_name', 'database_id', 'bucket_name', 'namespace', 'ARTIFACTS_NAMESPACE', 'namespace_id']) {
			const shared = valuesOf(staging, key).filter((value) => valuesOf(production, key).includes(value));
			expect(shared, key).toEqual([]);
		}
		expect(valuesOf(staging, 'id').filter((value) => valuesOf(production, 'id').includes(value))).toEqual([]);
	});

	it('runs as staging, where live supplier orders are never placed and the gate and email guard apply', () => {
		expect(valuesOf(staging, 'ENVIRONMENT')).toEqual(['staging']);
		expect(valuesOf(staging, 'EMAIL_RECIPIENT_ALLOWLIST')).toEqual(['@pluriza.com']);
		expect(staging).not.toContain('CATALOG_SUPPLIER_LIVE');
	});
});
