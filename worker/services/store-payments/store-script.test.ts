import { describe, expect, it } from 'vitest';
import { STORE_SCRIPT } from './store-script';
import type { StoreCartApi } from '../../../shared/types/store-payments';

interface FakeEstori {
	cart: StoreCartApi;
	checkout(request?: unknown): Promise<{ ok: boolean; message?: string }>;
	order(orderId: string): Promise<unknown>;
	store(): Promise<unknown>;
}

/** Runs the store script in a fake browser: a store at `basePath`, its own `localStorage`, and recorded navigation. */
function browser(basePath = '/space/app_1/preview/main', storage = new Map<string, string>()) {
	const assigned: string[] = [];
	const storageListeners: Array<(event: { key: string }) => void> = [];
	const responses = new Map<string, unknown>();
	const window: Record<string, unknown> = {
		location: { href: `https://preview.test${basePath}/products`, assign: (url: string) => void assigned.push(url) },
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key),
		},
		addEventListener: (type: string, listener: (event: { key: string }) => void) => {
			if (type === 'storage') storageListeners.push(listener);
		},
	};
	const document = { currentScript: { src: `https://preview.test${basePath}/__estori/store.js` } };
	const fetchFake = async (url: string) => ({ json: async () => responses.get(url) ?? null });
	new Function('window', 'document', 'fetch', STORE_SCRIPT)(window, document, fetchFake);
	return { Estori: window.Estori as FakeEstori, storage, assigned, responses, storageListeners };
}

describe('Estori.cart', () => {
	it("keeps each store's cart apart, since stores share one origin on the preview domain", () => {
		const storage = new Map<string, string>();
		browser('/space/app_1/preview/main', storage).Estori.cart.add('mug-blue', 2);
		expect(browser('/space/app_2/preview/main', storage).Estori.cart.items()).toEqual([]);
		expect(browser('/space/app_1/preview/main', storage).Estori.cart.items()).toEqual([{ variantId: 'mug-blue', quantity: 2 }]);
	});

	it('adds to a line, sets and removes quantities, counts units and clears, telling listeners each time', () => {
		const { Estori } = browser();
		const seen: number[] = [];
		Estori.cart.onChange((items) => seen.push(items.length));
		Estori.cart.add('mug-blue');
		Estori.cart.add('mug-blue', 2);
		Estori.cart.add('cap-red', 1);
		expect(Estori.cart.items()).toEqual([{ variantId: 'mug-blue', quantity: 3 }, { variantId: 'cap-red', quantity: 1 }]);
		expect(Estori.cart.count()).toBe(4);
		Estori.cart.setQuantity('mug-blue', 0);
		expect(Estori.cart.items()).toEqual([{ variantId: 'cap-red', quantity: 1 }]);
		Estori.cart.remove('cap-red');
		Estori.cart.add('mug-blue', 500);
		expect(Estori.cart.items()).toEqual([{ variantId: 'mug-blue', quantity: 99 }]);
		Estori.cart.clear();
		expect(Estori.cart.count()).toBe(0);
		expect(seen).toEqual([1, 1, 2, 1, 0, 1, 0]);
	});

	it('remembers the ship-to country, and hears edits made on the checkout page in another tab', () => {
		const storage = new Map<string, string>();
		const store = browser('/space/app_1/preview/main', storage);
		store.Estori.cart.setShipTo('us');
		expect(store.Estori.cart.shipTo()).toBe('US');
		const heard: number[] = [];
		store.Estori.cart.onChange((items) => heard.push(items.length));
		browser('/space/app_1/preview/main', storage).Estori.cart.add('mug-blue');
		for (const listener of store.storageListeners) listener({ key: [...storage.keys()][0] });
		expect(heard).toEqual([1]);
	});

	it('reads a damaged cart as empty instead of failing the store', () => {
		const storage = new Map([['estori:cart:/space/app_1/preview/main', '{not json']]);
		expect(browser('/space/app_1/preview/main', storage).Estori.cart.items()).toEqual([]);
	});
});

describe('Estori.checkout', () => {
	it("opens Estori's checkout page on the store's own address, with the return paths", async () => {
		const { Estori, assigned } = browser();
		Estori.cart.add('mug-blue');
		expect(await Estori.checkout({ successPath: '/thanks', cancelPath: '/cart' })).toEqual({ ok: true });
		expect(assigned).toEqual(['/space/app_1/preview/main/__estori/pay?success=%2Fthanks&cancel=%2Fcart']);
	});

	it('takes the items of a store written for the old contract into the cart first', async () => {
		const { Estori, assigned } = browser();
		await Estori.checkout({ items: [{ variantId: 'mug-blue', quantity: 2 }], shipTo: 'CA' });
		expect(Estori.cart.items()).toEqual([{ variantId: 'mug-blue', quantity: 2 }]);
		expect(Estori.cart.shipTo()).toBe('CA');
		expect(assigned).toEqual(['/space/app_1/preview/main/__estori/pay']);
	});

	it('answers an empty cart instead of opening an empty checkout', async () => {
		const { Estori, assigned } = browser();
		expect(await Estori.checkout()).toEqual({ ok: false, reason: 'invalid_request', message: 'Your cart is empty.' });
		expect(assigned).toEqual([]);
	});
});

describe('Estori.order', () => {
	it('clears the cart once it reads the receipt of a paid order', async () => {
		const { Estori, responses } = browser();
		Estori.cart.add('mug-blue');
		responses.set('/space/app_1/preview/main/__estori/orders/ord_1', { orderId: 'ord_1', orderNumber: 3 });
		await Estori.order('ord_1');
		expect(Estori.cart.count()).toBe(0);
		Estori.cart.add('mug-blue');
		await Estori.order('ord_unknown');
		expect(Estori.cart.count()).toBe(1);
	});
});
