import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAY_PAGE_SCRIPT, renderPayPage } from './pay-page';
import { STORE_SCRIPT } from './store-script';
import type { StoreCheckoutResponse, StoreInfo } from '../../../shared/types/store-payments';

const BASE = '/space/app_1/preview/main';

const INFO: StoreInfo = {
	mode: 'test',
	paymentsAvailable: true,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 0 },
	products: [{ id: 'kenya', name: 'Kenya Nyeri AA', variants: [{ id: 'kenya-250', name: 'Whole bean, 250g', priceCents: 2000 }] }],
	brand: null,
};

interface FakeElement {
	id: string;
	hidden: boolean;
	disabled: boolean;
	textContent: string;
	innerHTML: string;
	value: string;
	href: string;
	children: FakeElement[];
	onclick: (() => void) | null;
	onchange: (() => void) | null;
	classList: { toggle(name: string, on?: boolean): void };
	appendChild(child: FakeElement): void;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: () => void): void;
	fire(type: string): void;
}

function element(id = ''): FakeElement {
	const children: FakeElement[] = [];
	const listeners: Record<string, Array<() => void>> = {};
	return {
		id,
		hidden: false,
		disabled: false,
		textContent: '',
		get innerHTML() {
			return '';
		},
		set innerHTML(_value: string) {
			children.length = 0;
		},
		value: '',
		href: '',
		children,
		onclick: null,
		onchange: null,
		classList: { toggle: () => undefined },
		appendChild: (child) => void children.push(child),
		setAttribute: () => undefined,
		addEventListener: (type, listener) => void (listeners[type] = [...(listeners[type] ?? []), listener]),
		fire: (type) => (listeners[type] ?? []).forEach((listener) => listener()),
	};
}

/**
 * A fake Stripe that keeps Stripe's rules: the session holds no shipping address until payment (only the address field
 * knows what was typed, and says so in its own change event), an email without "@" is refused, and confirming refuses a
 * session whose email was set while Stripe's own email field is mounted.
 */
function fakeStripe() {
	const held: { answer: ((result: { type: string; error?: { message: string } }) => void) | null; hold: boolean } = { answer: null, hold: false };
	const mounted: string[] = [];
	const emails: string[] = [];
	const confirmed: string[] = [];
	const shippingOptions: unknown[] = [];
	const instances: number[] = [];
	const Stripe = () => (instances.push(instances.length), {
		initCheckoutElementsSdk: ({ clientSecret }: { clientSecret: string }) => {
			mounted.push(clientSecret);
			let contactField = false;
			let emailSet = false;
			const field = () => ({ mount: () => undefined, destroy: () => undefined, on: () => undefined });
			const addressField = () => ({
				...field(),
				on: (_event: string, listener: (event: unknown) => void) =>
					listener({ complete: true, value: { name: 'A Shopper', address: { line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } } }),
			});
			return {
				on: (_event: string, listener: (session: unknown) => void) =>
					listener({ email: null, shippingAddress: null, canConfirm: true, total: { total: { minorUnitsAmount: 2000 } } }),
				createContactDetailsElement: () => ((contactField = true), field()),
				// Stripe refuses a saved address with a field that isn't a string, such as the empty second line its own field reports.
				createShippingAddressElement: (options?: { contacts: { address: Record<string, unknown> }[] }) => {
					if (options?.contacts.some((contact) => Object.values(contact.address).some((value) => typeof value !== 'string'))) {
						throw new Error('options.contacts.0.address.line2 should be a string');
					}
					shippingOptions.push(options);
					return addressField();
				},
				createPaymentElement: field,
				loadActions: async () => ({
					type: 'success',
					actions: {
						updateEmail: async (email: string) => {
							if (!email.includes('@')) return { type: 'error', error: { message: 'Your email address is invalid.' } };
							emails.push(`${clientSecret} ${email}`);
							emailSet = true;
							return { type: 'success' };
						},
						confirm: async () => {
							if (contactField && emailSet) throw new Error('IntegrationError: confirm() while the Contact Details Element is mounted after updateEmail()');
							confirmed.push(clientSecret);
							if (held.hold) return new Promise((resolve) => (held.answer = resolve));
							return { type: 'success' };
						},
					},
				}),
			};
		},
	});
	return { Stripe, mounted, emails, confirmed, shippingOptions, instances, held };
}

/** Opens the checkout page in a fake browser tab whose storage survives a reload, answering checkouts in turn. */
function openPage(tab: { local: Map<string, string>; session: Map<string, string> }, answers: StoreCheckoutResponse[]) {
	const elements = new Map<string, FakeElement>();
	const html = renderPayPage({ basePath: BASE, publishableKey: 'pk_test_123', info: INFO, nonce: 'n', returnPaths: { successPath: '/thanks', cancelPath: '/' } });
	const config = html.match(/<script type="application\/json" id="estori-pay-config">([\s\S]*?)<\/script>/)?.[1] ?? '';
	const document = {
		currentScript: { src: `https://preview.test${BASE}/__estori/store.js` },
		getElementById: (id: string) => {
			if (!elements.has(id)) elements.set(id, element(id));
			const found = elements.get(id) as FakeElement;
			if (id === 'estori-pay-config') found.textContent = config;
			return found;
		},
		createElement: () => element(),
	};
	const storage = (map: Map<string, string>) => ({
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key),
	});
	const stripe = fakeStripe();
	const window: Record<string, unknown> = {
		location: { href: `https://preview.test${BASE}/__estori/pay?success=%2Fthanks`, search: '?success=%2Fthanks', assign: () => undefined },
		localStorage: storage(tab.local),
		sessionStorage: storage(tab.session),
		addEventListener: () => undefined,
		Stripe: stripe.Stripe,
	};
	const posted: Record<string, unknown>[] = [];
	const fetchFake = async (_url: string, init: { body: string }) => {
		posted.push(JSON.parse(init.body));
		const answer = answers.shift();
		return { json: async () => answer };
	};
	new Function('window', 'document', 'fetch', STORE_SCRIPT)(window, document, fetchFake);
	new Function('window', 'document', 'fetch', PAY_PAGE_SCRIPT)(window, document, fetchFake);
	return { posted, stripe, elements, cart: (window.Estori as { cart: { add(id: string, quantity?: number): void; setQuantity(id: string, quantity: number): void } }).cart };
}

/** The shopper types an email in the page's own field and leaves it. */
function typeEmail(page: ReturnType<typeof openPage>, email: string): void {
	const field = page.elements.get('email');
	if (!field) throw new Error('the page has no email field');
	field.value = email;
	field.fire('change');
}

function started(checkoutId: string): StoreCheckoutResponse {
	return {
		ok: true,
		checkoutId,
		clientSecret: `cs_secret_${checkoutId}`,
		summary: { currency: 'usd', shipTo: 'US', lines: [], subtotalCents: 2000, shippingCents: 0, totalCents: 2000 },
	};
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

describe("Estori's checkout page script", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('remembers its checkout for the tab, so a reload replaces it instead of holding a second one against the weekly cap', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const first = openPage(tab, [started('chk_first')]);
		await settle();
		expect(first.posted[0]).not.toHaveProperty('replaces');

		const reloaded = openPage(tab, [started('chk_second')]);
		await settle();
		expect(reloaded.posted[0]).toMatchObject({ replaces: 'chk_first' });
	});

	it('forgets the remembered checkout once a checkout is refused, so the next start names none', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		openPage(tab, [started('chk_first')]);
		await settle();
		openPage(tab, [{ ok: false, reason: 'limit_reached', message: "This store isn't taking new orders right now. Try again later." }]);
		await settle();
		const next = openPage(tab, [started('chk_third')]);
		await settle();
		expect(next.posted[0]).not.toHaveProperty('replaces');
	});

	it('prices an edited cart once the edits stop, replacing the open checkout and keeping what the shopper typed', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first'), started('chk_second')]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.cart.setQuantity('kenya-250', 2);
		page.cart.setQuantity('kenya-250', 3);
		vi.advanceTimersByTime(399);
		expect(page.posted).toHaveLength(1);
		vi.advanceTimersByTime(1);
		await settle();
		expect(page.posted).toHaveLength(2);
		expect(page.posted[1]).toMatchObject({ items: [{ variantId: 'kenya-250', quantity: 3 }], replaces: 'chk_first' });
		expect(page.stripe.mounted).toEqual(['cs_secret_chk_first', 'cs_secret_chk_second']);
		// Stripe.js can't confirm a second session started on the same instance, so each session gets its own.
		expect(page.stripe.instances).toHaveLength(2);
		expect(page.stripe.emails).toEqual(['cs_secret_chk_first shopper@example.com', 'cs_secret_chk_second shopper@example.com']);
		// Stripe's address field shows only what it is given when created, so the typed address comes back as a saved one.
		expect(page.stripe.shippingOptions).toEqual([
			undefined,
			{ contacts: [{ name: 'A Shopper', address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } }] },
		]);
	});

	it("pays with the email from the page's own field, which Stripe allows only while its own email field is not mounted", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual(['cs_secret_chk_first']);
		expect(page.elements.get('notice')?.hidden).toBe(true);
	});

	it("shows Stripe's answer under the email field and doesn't pay when Stripe refuses the email", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		const field = page.elements.get('email');
		if (field) field.value = 'not-an-email';
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual([]);
		expect(page.elements.get('email-error')).toMatchObject({ hidden: false, textContent: 'Your email address is invalid.' });
	});

	it('offers nothing to pay once an edited cart is refused, since the earlier session was already expired', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first'), { ok: false, reason: 'order_limit', message: 'This order is over the largest order this store can take.' }]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		page.cart.setQuantity('kenya-250', 9);
		vi.advanceTimersByTime(400);
		await settle();
		expect(page.elements.get('notice')).toMatchObject({ hidden: false, textContent: 'This order is over the largest order this store can take.' });
		expect(page.elements.get('pay')?.disabled).toBe(true);
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual([]);
	});

	it('holds Pay from the moment the cart changes until the new cart is priced, so the old session is never paid', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first'), started('chk_second')]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.cart.setQuantity('kenya-250', 2);
		expect(page.elements.get('pay')?.disabled).toBe(true);
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual([]);

		vi.advanceTimersByTime(400);
		await settle();
		expect(page.elements.get('pay')?.disabled).toBe(false);
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual(['cs_secret_chk_second']);
	});

	it('prices a cart changed during a payment only once that payment has answered', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first'), started('chk_second')]);
		page.stripe.held.hold = true;
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual(['cs_secret_chk_first']);

		// Another tab changes the cart while the card is being confirmed: the session being paid stays.
		page.cart.setQuantity('kenya-250', 2);
		vi.advanceTimersByTime(400);
		await settle();
		expect(page.posted).toHaveLength(1);

		page.stripe.held.answer?.({ type: 'error', error: { message: 'Your card was declined.' } });
		await settle();
		expect(page.posted).toHaveLength(2);
		expect(page.posted[1]).toMatchObject({ items: [{ variantId: 'kenya-250', quantity: 2 }], replaces: 'chk_first' });
	});
});
