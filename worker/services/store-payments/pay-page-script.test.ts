import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAY_PAGE_SCRIPT, renderPayPage } from './pay-page';
import { storeScript } from './store-script';
import { formatDollars } from '../../../shared/i18n/format';
import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import { STORE_CHECKOUT_MESSAGES, type StoreCheckoutResponse, type StoreInfo } from '../../../shared/types/store-payments';

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
	/** What the script set, so a test can read it back. */
	classes: Set<string>;
	attributes: Record<string, string>;
	appendChild(child: FakeElement): void;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: () => void): void;
	fire(type: string): void;
}

function element(id = ''): FakeElement {
	const children: FakeElement[] = [];
	const listeners: Record<string, Array<() => void>> = {};
	const classes = new Set<string>();
	const attributes: Record<string, string> = {};
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
		classList: { toggle: (name, on) => void ((on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)) },
		classes,
		attributes,
		appendChild: (child) => void children.push(child),
		setAttribute: (name, value) => void (attributes[name] = value),
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
	// Set by a test: Stripe can no longer load the session's actions, as once a session has expired.
	const control = { loadFails: false };
	const held: { answer: ((result: { type: string; error?: { message: string } }) => void) | null; hold: boolean } = { answer: null, hold: false };
	const mounted: string[] = [];
	const emails: string[] = [];
	const confirmed: string[] = [];
	const shippingOptions: unknown[] = [];
	const instances: number[] = [];
	const stripeOptions: unknown[] = [];
	const Stripe = (_publishableKey: string, options?: unknown) => (instances.push(instances.length), stripeOptions.push(options), {
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
				loadActions: async () => (control.loadFails ? { type: 'error', error: { message: 'This Checkout Session is no longer active.' } } : {
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
	return { Stripe, mounted, emails, confirmed, shippingOptions, instances, stripeOptions, held, control };
}

/** Opens the checkout page in a fake browser tab whose storage survives a reload, answering checkouts in turn. */
function openPage(tab: { local: Map<string, string>; session: Map<string, string> }, answers: StoreCheckoutResponse[], locale: Locale = 'en') {
	const elements = new Map<string, FakeElement>();
	const html = renderPayPage({ basePath: BASE, publishableKey: 'pk_test_123', info: INFO, nonce: 'n', returnPaths: { successPath: '/thanks', cancelPath: '/' }, locale });
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
	const requested: string[] = [];
	const fetchFake = async (url: string, init: { body: string }) => {
		requested.push(url);
		posted.push(JSON.parse(init.body));
		const answer = answers.shift();
		return { json: async () => answer };
	};
	new Function('window', 'document', 'fetch', storeScript(locale))(window, document, fetchFake);
	new Function('window', 'document', 'fetch', PAY_PAGE_SCRIPT)(window, document, fetchFake);
	return { posted, requested, stripe, elements, cart: (window.Estori as { cart: { add(id: string, quantity?: number): void; setQuantity(id: string, quantity: number): void } }).cart };
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

	it("shows the cart's order note in the summary and sends it with the checkout", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }], note: 'Happy birthday, Mom!' })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_note')]);
		await settle();
		expect(page.posted[0]).toMatchObject({ note: 'Happy birthday, Mom!' });
		expect(page.elements.get('note-row')?.hidden).toBe(false);
		expect(page.elements.get('note-text')?.textContent).toBe('Happy birthday, Mom!');
	});

	it('hides the note and sends none when the cart has no note', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_plain')]);
		await settle();
		expect(page.posted[0]).not.toHaveProperty('note');
		expect(page.elements.get('note-row')?.hidden).toBe(true);
	});

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
		openPage(tab, [{ ok: false, reason: 'store_paused', message: STORE_CHECKOUT_MESSAGES.store_paused }]);
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

	it("opens and folds the phone order summary, whose button carries the order's total", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		expect(page.elements.get('summary-toggle-total')?.textContent).toBe('$20.00');
		// The page starts folded, with "Show order summary" in its markup.
		page.elements.get('summary-toggle')?.onclick?.();
		expect(page.elements.get('summary-toggle-label')?.textContent).toBe('Hide order summary');
		expect(page.elements.get('summary')?.classes.has('open')).toBe(true);
		expect(page.elements.get('summary-toggle')?.attributes['aria-expanded']).toBe('true');
		page.elements.get('summary-toggle')?.onclick?.();
		expect(page.elements.get('summary-toggle-label')?.textContent).toBe('Show order summary');
		expect(page.elements.get('summary')?.classes.has('open')).toBe(false);
		expect(page.elements.get('summary-toggle')?.attributes['aria-expanded']).toBe('false');
	});

	it("tells the shopper to refresh when the session can't load, even while an earlier email error is still showing", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		typeEmail(page, 'not-an-email');
		await settle();
		expect(page.elements.get('email-error')?.hidden).toBe(false);
		page.stripe.control.loadFails = true;
		const field = page.elements.get('email');
		if (field) field.value = 'shopper@example.com';
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.elements.get('notice')).toMatchObject({ hidden: false, textContent: "This checkout can't continue. Refresh the page and try again." });
	});

	it('shows the checkout again when items are added to an empty cart from another tab', async () => {
		const tab = { local: new Map<string, string>(), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		expect(page.elements.get('checkout')?.hidden).toBe(true);
		expect(page.elements.get('empty')?.hidden).toBe(false);
		page.cart.add('kenya-250');
		vi.advanceTimersByTime(400);
		await settle();
		expect(page.elements.get('checkout')?.hidden).toBe(false);
		expect(page.elements.get('empty')?.hidden).toBe(true);
		expect(page.stripe.mounted).toEqual(['cs_secret_chk_first']);
	});

	it("tells the shopper to refresh, instead of doing nothing, when Stripe can't load the checkout to pay", async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first')]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.stripe.control.loadFails = true;
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.stripe.confirmed).toEqual([]);
		expect(page.elements.get('notice')).toMatchObject({ hidden: false, textContent: "This checkout can't continue. Refresh the page and try again." });
	});

	it('offers nothing to pay once an edited cart is refused, since the earlier session was already expired', async () => {
		const tab = { local: new Map([[`estori:cart:${BASE}`, JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }] })]]), session: new Map<string, string>() };
		const page = openPage(tab, [started('chk_first'), { ok: false, reason: 'order_over_limit', message: STORE_CHECKOUT_MESSAGES.order_over_limit }]);
		await settle();
		typeEmail(page, 'shopper@example.com');
		page.cart.setQuantity('kenya-250', 9);
		vi.advanceTimersByTime(400);
		await settle();
		expect(page.elements.get('notice')).toMatchObject({ hidden: false, textContent: STORE_CHECKOUT_MESSAGES.order_over_limit });
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

describe("Estori's checkout page script in the shopper's language", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const SPANISH_MUG = JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 2 }] });
	const tabWith = (cart = SPANISH_MUG) => ({ local: new Map([[`estori:cart:${BASE}`, cart]]), session: new Map<string, string>() });

	it.each(LOCALES)('writes every amount in %s as US dollars the way the language does, with the same amounts in each', async (locale) => {
		const page = openPage(tabWith(), [started('chk_1')], locale);
		await settle();
		const [, body, total] = page.elements.get('lines')?.children[0].children ?? [];
		// Two units at $20.00 each, priced from the store's own file until the session's summary says otherwise.
		expect(total.textContent).toBe(formatDollars(40, locale, 'always'));
		const each = { en: 'each', es: 'c/u', 'pt-BR': 'cada' }[locale];
		expect(body.children[1].textContent).toBe(`Whole bean, 250g · ${formatDollars(20, locale, 'always')} ${each}`);
		expect(page.elements.get('subtotal')?.textContent).toBe(formatDollars(20, locale, 'always'));
		expect(page.elements.get('total')?.textContent).toBe(formatDollars(20, locale, 'always'));
		expect(page.elements.get('summary-toggle-total')?.textContent).toBe(formatDollars(20, locale, 'always'));
		expect(page.elements.get('shipping')?.textContent).toBe({ en: 'Free', es: 'Gratis', 'pt-BR': 'Grátis' }[locale]);
	});

	it("names the amount on the Pay button in the shopper's language", async () => {
		const spanish = openPage(tabWith(), [started('chk_1')], 'es');
		await settle();
		expect(spanish.elements.get('pay')?.textContent).toBe(`Pagar ${formatDollars(20, 'es', 'always')}`);
		const portuguese = openPage(tabWith(), [started('chk_2')], 'pt-BR');
		await settle();
		expect(portuguese.elements.get('pay')?.textContent).toBe(`Pagar ${formatDollars(20, 'pt-BR', 'always')}`);
		const english = openPage(tabWith(), [started('chk_3')]);
		await settle();
		expect(english.elements.get('pay')?.textContent).toBe('Pay $20.00');
	});

	it("labels the cart's controls and the removed-item line in the shopper's language", async () => {
		const tab = tabWith(JSON.stringify({ items: [{ variantId: 'kenya-250', quantity: 1 }, { variantId: 'gone', quantity: 1 }] }));
		const page = openPage(tab, [started('chk_1')], 'es');
		await settle();
		const [first, gone] = page.elements.get('lines')?.children ?? [];
		const controls = first.children[1].children[2];
		expect(controls.children[0].children[0].attributes['aria-label']).toBe('Uno menos');
		expect(controls.children[0].children[2].attributes['aria-label']).toBe('Uno más');
		expect(controls.children[1].textContent).toBe('Quitar');
		expect(gone.children[1].children[0].textContent).toBe('Un artículo que ya no se vende aquí');
	});

	it("folds and opens the phone summary with the language's words", async () => {
		const page = openPage(tabWith(), [started('chk_1')], 'pt-BR');
		await settle();
		page.elements.get('summary-toggle')?.onclick?.();
		expect(page.elements.get('summary-toggle-label')?.textContent).toBe('Ocultar resumo do pedido');
		page.elements.get('summary-toggle')?.onclick?.();
		expect(page.elements.get('summary-toggle-label')?.textContent).toBe('Mostrar resumo do pedido');
	});

	it("shows the page's own messages in the shopper's language, and Estori's refusals as the server worded them", async () => {
		const failed = openPage(tabWith(), [], 'es');
		await settle();
		expect(failed.elements.get('notice')).toMatchObject({ hidden: false, textContent: 'No se pudo iniciar la compra. Actualiza la página e inténtalo de nuevo.' });

		const page = openPage(tabWith(), [started('chk_1')], 'pt-BR');
		await settle();
		typeEmail(page, 'shopper@example.com');
		await settle();
		page.stripe.control.loadFails = true;
		page.elements.get('pay')?.onclick?.();
		await settle();
		expect(page.elements.get('notice')?.textContent).toBe('Esta compra não pode continuar. Atualize a página e tente novamente.');

		const refused = openPage(tabWith(), [{ ok: false, reason: 'store_paused', message: 'Esta tienda no está recibiendo pedidos nuevos en este momento. Inténtalo más tarde.' }], 'es');
		await settle();
		expect(refused.elements.get('notice')?.textContent).toBe('Esta tienda no está recibiendo pedidos nuevos en este momento. Inténtalo más tarde.');
	});

	it("starts a checkout in the page's language, so a refusal is worded for the shopper even without the language cookie", async () => {
		const spanish = openPage(tabWith(), [started('chk_1')], 'es');
		await settle();
		expect(spanish.requested).toEqual([`${BASE}/__estori/checkout?lang=es`]);
		const english = openPage(tabWith(), [started('chk_2')]);
		await settle();
		expect(english.requested).toEqual([`${BASE}/__estori/checkout?lang=en`]);
	});

	it("gives Stripe's card form the language, on every session it starts", async () => {
		const spanish = openPage(tabWith(), [started('chk_1'), started('chk_2')], 'es');
		await settle();
		spanish.cart.setQuantity('kenya-250', 3);
		vi.advanceTimersByTime(400);
		await settle();
		expect(spanish.stripe.stripeOptions).toEqual([{ locale: 'es-419' }, { locale: 'es-419' }]);
		const portuguese = openPage(tabWith(), [started('chk_3')], 'pt-BR');
		await settle();
		expect(portuguese.stripe.stripeOptions).toEqual([{ locale: 'pt-BR' }]);
		const english = openPage(tabWith(), [started('chk_4')]);
		await settle();
		// English pages keep Stripe's own choice, from the browser, as they did before the page was translated.
		expect(english.stripe.stripeOptions).toEqual([{ locale: 'auto' }]);
	});

	it('keeps the cart, the checkout request and every amount when the shopper switches language mid-checkout', async () => {
		const tab = tabWith();
		const english = openPage(tab, [started('chk_en')]);
		await settle();
		typeEmail(english, 'shopper@example.com');
		await settle();

		const spanish = openPage(tab, [started('chk_es')], 'es');
		await settle();
		// The same cart is priced again, replacing the checkout the English page opened; only the words differ.
		expect(spanish.posted[0]).toEqual({ ...english.posted[0], replaces: 'chk_en' });
		expect(spanish.elements.get('lines')?.children).toHaveLength(1);
		expect(spanish.elements.get('lines')?.children[0].children[1].children[2].children[0].children[1].textContent).toBe('2');
		expect(spanish.elements.get('total')?.textContent).toBe(formatDollars(20, 'es', 'always'));
		expect(spanish.stripe.mounted).toEqual(['cs_secret_chk_es']);
	});
});
