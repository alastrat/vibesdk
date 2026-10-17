import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/apps/controller.ts'], { query: '?raw', import: 'default', eager: true });

describe('deleting an app', () => {
	it("reads its store's domain first, and lets it go at the provider only once the owner's delete succeeded", () => {
		const controller = sources['/worker/api/controllers/apps/controller.ts'] ?? '';
		const remove = controller.slice(controller.indexOf('static async deleteApp('));
		const read = remove.indexOf('new LiveStoreService(env).domainOfApp(appId)');
		const deleted = remove.indexOf('appService.deleteApp(appId, user.id)');
		const released = remove.indexOf('releaseDeletedStoreDomain(');
		expect(read).toBeGreaterThan(-1);
		expect(deleted).toBeGreaterThan(read);
		expect(released).toBeGreaterThan(remove.indexOf('if (!result.success)'));
	});
});
