import { describe, expect, it } from 'vitest';
import { matchStorePlatformPath } from './store-platform';

const sources = import.meta.glob<string>(['/worker/api/handlers/space-preview.ts', '/worker/api/controllers/payments/webhook.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('matchStorePlatformPath', () => {
	it('claims every spelling of the platform prefix on a preview', () => {
		for (const path of ['/__estori/store.js', '/__ESTORI/checkout', '/%5F%5Festori/store', '/%255F%255Festori/store', '/__estori']) {
			const match = matchStorePlatformPath(`/space/app_1/preview/main${path}`);
			expect(match?.basePath).toBe('/space/app_1/preview/main');
			expect(match?.platformPath.startsWith('/__estori')).toBe(true);
		}
		expect(matchStorePlatformPath('/space/app_1/preview/main/__ESTORI/Checkout')?.platformPath).toBe('/__estori/checkout');
	});

	it("leaves the store's own paths to the store", () => {
		for (const path of ['/space/app_1/preview/main/', '/space/app_1/preview/main/shop/__estori', '/space/app_1/preview/main/__estorix', '/api/apps']) {
			expect(matchStorePlatformPath(path)).toBeNull();
		}
	});
});

describe('preview wiring', () => {
	it('answers platform paths before anything reaches SpaceDO', () => {
		const preview = source('/worker/api/handlers/space-preview.ts');
		const serve = preview.slice(preview.indexOf('async function serveAuthorizedPreview('));
		expect(serve.indexOf('matchStorePlatformPath(')).toBeGreaterThan(-1);
		expect(serve.indexOf('matchStorePlatformPath(')).toBeLessThan(serve.indexOf('forwardToSpacePreview('));
		// Every authorized request goes through serveAuthorizedPreview; no other path forwards.
		expect(preview.match(/forwardToSpacePreview\(request, env, spaceName\)/g)).toHaveLength(1);
	});

	it('routes store sessions to the store recorder before the template path', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook.indexOf('recordStoreSession(env, object.id)')).toBeGreaterThan(-1);
		expect(webhook.indexOf('recordStoreSession(env, object.id)')).toBeLessThan(webhook.indexOf('fulfillCheckoutSession('));
		expect(webhook).toContain("event.type === 'checkout.session.expired'");
	});
});
