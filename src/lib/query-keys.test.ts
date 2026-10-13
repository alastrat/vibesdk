import { describe, expect, it } from 'vitest';
import { queryPersistOptions } from './query-client';
import { queryKeys } from './query-keys';

const { shouldDehydrateQuery } = queryPersistOptions.dehydrateOptions;

function persisted(queryKey: readonly unknown[]): boolean {
	return shouldDehydrateQuery({ queryKey, state: { status: 'success' } });
}

describe('publishing query keys', () => {
	it.each([
		['app', queryKeys.account.publishing.app('app1')],
		['mine', queryKeys.account.publishing.mine('user1')],
		['reviews', queryKeys.account.publishing.reviews()],
		['version files', queryKeys.account.publishing.versionFiles('v1')],
		['version file', queryKeys.account.publishing.versionFile('v1', 'src/index.ts')],
	])('keeps the private %s cache out of storage and under the account prefix', (_name, key) => {
		expect(key.slice(0, queryKeys.account.publishing.all().length)).toEqual(queryKeys.account.publishing.all());
		expect(key[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(key)).toBe(false);
	});

	it('keeps the Discover strip under the public apps prefix', () => {
		expect(queryKeys.apps.strip().slice(0, queryKeys.apps.all.length)).toEqual(queryKeys.apps.all);
	});
});

describe('payments query keys', () => {
	it.each([
		['status', queryKeys.account.payments.status('user1')],
		['sales', queryKeys.account.payments.sales()],
	])('keeps the private %s cache out of storage and under the account prefix', (_name, key) => {
		expect(key.slice(0, queryKeys.account.payments.all().length)).toEqual(queryKeys.account.payments.all());
		expect(key[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(key)).toBe(false);
	});

	it('scopes the Stripe status to the signed-in user', () => {
		expect(queryKeys.account.payments.status('user1')).not.toEqual(queryKeys.account.payments.status('user2'));
		expect(queryKeys.account.payments.status(null)).toEqual(queryKeys.account.payments.status(undefined));
	});
});
