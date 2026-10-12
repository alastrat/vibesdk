import { describe, expect, it } from 'vitest';
import { queryPersistOptions } from './query-client';
import { queryKeys } from './query-keys';

const { shouldDehydrateQuery } = queryPersistOptions.dehydrateOptions;

function persisted(queryKey: readonly unknown[]): boolean {
	return shouldDehydrateQuery({ queryKey, state: { status: 'success' } });
}

describe('template query keys', () => {
	it('persists the public gallery and detail caches', () => {
		expect(persisted(queryKeys.templates.gallery({ category: null, search: '', limit: 12 }))).toBe(true);
		expect(persisted(queryKeys.templates.detail('fernwood', 'user1'))).toBe(true);
	});

	it.each([
		['mine', queryKeys.account.templates.mine('user1')],
		['app', queryKeys.account.templates.app('app1')],
		['pending', queryKeys.account.templates.pending()],
		['version files', queryKeys.account.templates.versionFiles('v1')],
		['version file', queryKeys.account.templates.versionFile('v1', 'src/index.ts')],
	])('keeps the private %s cache out of storage and under the account prefix', (_name, key) => {
		expect(key.slice(0, queryKeys.account.templates.all().length)).toEqual(queryKeys.account.templates.all());
		expect(key[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(key)).toBe(false);
	});
});
