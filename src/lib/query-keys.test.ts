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

	it('keeps product pages under the public apps prefix, per viewer', () => {
		const page = queryKeys.apps.sitePage('app1', 'u1');
		expect(page.slice(0, queryKeys.apps.all.length)).toEqual(queryKeys.apps.all);
		expect(queryKeys.apps.sitePage('app1', null)).not.toEqual(page);
		expect(page.slice(0, queryKeys.apps.sitePageAll().length)).toEqual(queryKeys.apps.sitePageAll());
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

describe('store translation and task query keys', () => {
	it.each([
		['stores', queryKeys.account.storeTranslations.stores(), queryKeys.account.storeTranslations.all()],
		['store', queryKeys.account.storeTranslations.store('app1'), queryKeys.account.storeTranslations.all()],
		["store's tasks", queryKeys.account.tasks.store('app1'), queryKeys.account.tasks.all()],
	])('keeps the %s cache out of storage and under the account prefix', (_name, key, prefix) => {
		expect(key.slice(0, prefix.length)).toEqual(prefix);
		expect(key[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(key)).toBe(false);
	});

	it('keeps each store apart', () => {
		expect(queryKeys.account.storeTranslations.store('app1')).not.toEqual(queryKeys.account.storeTranslations.store('app2'));
		expect(queryKeys.account.tasks.store('app1')).not.toEqual(queryKeys.account.tasks.store('app2'));
	});

	it("keeps the editor's texts out of storage, nested by store, language and search, and apart from the store's languages", () => {
		const keys = queryKeys.account.storeTranslations;
		const texts = keys.texts('app1', 'es', 'velas');
		expect(texts.slice(0, keys.languageTexts('app1', 'es').length)).toEqual(keys.languageTexts('app1', 'es'));
		expect(keys.languageTexts('app1', 'es').slice(0, keys.textsOf('app1').length)).toEqual(keys.textsOf('app1'));
		expect(keys.textsOf('app1').slice(0, keys.all().length)).toEqual(keys.all());
		expect(persisted(texts)).toBe(false);
		expect(keys.texts('app1', 'es', 'velas')).not.toEqual(keys.texts('app1', 'es', ''));
		expect(keys.languageTexts('app1', 'es')).not.toEqual(keys.languageTexts('app1', 'pt-BR'));
		expect(keys.textsOf('app1')).not.toEqual(keys.textsOf('app2'));
		// Reading a store's languages again (a prefix match on `store`) must not touch the editor's lists.
		expect(texts.slice(0, keys.store('app1').length)).not.toEqual(keys.store('app1'));
	});
});

describe('billing query key', () => {
	it('keeps the account plan out of storage and under the account prefix, so signing out drops it', () => {
		expect(queryKeys.billing()[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(queryKeys.billing())).toBe(false);
	});

	it("keeps the invoice history under the plan's key, so refreshing the plan refreshes it, and out of storage", () => {
		expect(queryKeys.billingHistory().slice(0, queryKeys.billing().length)).toEqual(queryKeys.billing());
		expect(persisted(queryKeys.billingHistory())).toBe(false);
	});
});
