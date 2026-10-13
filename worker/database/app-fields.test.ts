import { describe, expect, it } from 'vitest';
import { omitInternalAppFields } from './app-fields';

const sources = import.meta.glob<string>(['/worker/database/services/AppService.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function methodBody(text: string, method: string, nextMethod: string): string {
	const start = text.indexOf(`async ${method}(`);
	const end = text.indexOf(`async ${nextMethod}(`, start);
	if (start === -1 || end === -1) throw new Error(`Method not found: ${method}`);
	return text.slice(start, end);
}

describe('omitInternalAppFields', () => {
	it('drops admin moderation and provenance fields and keeps the rest', () => {
		const app = {
			id: 'app-1',
			title: 'Lumen Studio',
			visibility: 'public' as const,
			removedFromDiscoverAt: null,
			removedFromDiscoverBy: 'admin-1',
			removedFromDiscoverReason: 'Copied brand',
			reuseConsentAt: new Date(0),
			parentAppId: 'source-app',
			fromTemplateVersionId: 'version-1',
		};
		const result = omitInternalAppFields(app);
		expect(result).toEqual({ id: 'app-1', title: 'Lumen Studio', visibility: 'public', removedFromDiscoverAt: null });
		for (const key of [
			'removedFromDiscoverBy',
			'removedFromDiscoverReason',
			'reuseConsentAt',
			'parentAppId',
			'fromTemplateVersionId',
		]) {
			expect(result).not.toHaveProperty(key);
		}
	});

	it('leaves the input row untouched', () => {
		const app = {
			id: 'app-1',
			removedFromDiscoverBy: null,
			removedFromDiscoverReason: null,
			reuseConsentAt: null,
			parentAppId: null,
			fromTemplateVersionId: null,
		};
		omitInternalAppFields(app);
		expect(app).toHaveProperty('parentAppId', null);
	});
});

describe('user app lists', () => {
	const service = sources['/worker/database/services/AppService.ts'];
	if (service === undefined) throw new Error('Source not found: AppService.ts');

	it("omit the internal fields from the owner's apps and from favorites", () => {
		expect(methodBody(service, 'getUserAppsWithFavorites', 'getRecentAppsWithFavorites')).toContain(
			'...omitInternalAppFields(app),',
		);
		expect(methodBody(service, 'getFavoriteAppsOnly', 'toggleAppFavorite')).toContain(
			'...omitInternalAppFields(safeApp),',
		);
	});
});
