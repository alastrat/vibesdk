import { describe, expect, it } from 'vitest';
import { PAY_PAGE_SCRIPT, payPageHeaders, renderPayPage } from './pay-page';
import { formatDollars } from '../../../shared/i18n/format';
import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import type { StoreInfo } from '../../../shared/types/store-payments';
import { STRIPE_JS_URL } from '../../../shared/types/stripe';

const INFO: StoreInfo = {
	mode: 'test',
	paymentsAvailable: true,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 500, freeOverCents: 5000 },
	products: [{ id: 'kenya', name: 'Kenya Nyeri AA', image: '/images/kenya.jpg', variants: [{ id: 'kenya-250', name: 'Whole bean, 250g', priceCents: 2000 }] }],
	brand: { name: 'Ember Roasters', logo: '/images/logo.svg', colors: { background: '#1a1210', surface: '#241a17', text: '#f5ede6', accent: '#f59a46', accentText: '#1a1210' }, font: 'Fraunces', corners: 'pill' },
};

const page = (overrides: Partial<Parameters<typeof renderPayPage>[0]> = {}) =>
	renderPayPage({ basePath: '/space/app_1/preview/main', publishableKey: 'pk_test_123', info: INFO, nonce: 'n0nce', returnPaths: { successPath: '/thanks', cancelPath: '/cart' }, locale: 'en', ...overrides });

function configOf(html: string): Record<string, unknown> {
	const match = html.match(/<script type="application\/json" id="estori-pay-config">([\s\S]*?)<\/script>/);
	if (!match) throw new Error('no config');
	return JSON.parse(match[1]);
}

describe('renderPayPage', () => {
	it("loads only the store script, Stripe.js for the pinned API version and its own script, in the store's brand", () => {
		const html = page();
		expect(html).toContain('<script src="/space/app_1/preview/main/__estori/store.js"></script>');
		expect(STRIPE_JS_URL).toBe('https://js.stripe.com/dahlia/stripe.js');
		expect(html).toContain(`<script src="${STRIPE_JS_URL}"></script>`);
		expect(html).toContain('<script nonce="n0nce">');
		expect(html.match(/<script(?![^>]*type="application\/json")[^>]*>/g)).toHaveLength(3);
		expect(html).toContain('<title>Checkout · Ember Roasters</title>');
		expect(html).toContain('--accent: #f59a46;');
		expect(html).toContain('family=Fraunces');
		expect(html).toContain('<img class="logo" src="/space/app_1/preview/main/images/logo.svg" alt="">');
	});

	it("keeps hidden rows hidden, such as the ship-to choice of a store shipping to one country, whatever their own display", () => {
		expect(page()).toContain('[hidden] { display: none !important; }');
	});

	it('names no seller on the page of a store without a brand, rather than a placeholder name', () => {
		const html = page({ info: { ...INFO, brand: null } });
		expect(html).toContain('<title>Checkout</title>');
		expect(html).toContain('This store is the seller.');
		expect(html).not.toContain('<span>Checkout</span>');
	});

	it('hands the page its publishable key, brand, countries and products, with store image paths resolved', () => {
		const config = configOf(page());
		expect(config).toMatchObject({ basePath: '/space/app_1/preview/main', publishableKey: 'pk_test_123', countries: ['US', 'CA'], dark: true, radius: { button: '999px' } });
		expect(config.products).toEqual([{ id: 'kenya', name: 'Kenya Nyeri AA', image: '/space/app_1/preview/main/images/kenya.jpg', variants: [{ id: 'kenya-250', name: 'Whole bean, 250g', priceCents: 2000 }] }]);
	});

	it('takes its return paths from the server, which already checked them, and never reads them from its own address', () => {
		expect(configOf(page())).toMatchObject({ successPath: '/thanks', cancelPath: '/cart' });
		expect(PAY_PAGE_SCRIPT).not.toContain("params.get('success')");
		expect(PAY_PAGE_SCRIPT).not.toContain("params.get('cancel')");
	});

	it('folds the order summary on phones behind a button that shows the total, and keeps it open on wider screens', () => {
		const html = page();
		expect(html).toContain('<button class="summary-toggle" id="summary-toggle" type="button" aria-expanded="false" aria-controls="summary-body">');
		const phone = html.slice(html.indexOf('@media (max-width: 860px)'));
		expect(phone.slice(0, phone.indexOf('}\n}'))).toContain('.summary:not(.open) .summary-body { display: none; }');
		expect(html).toContain('.summary-toggle { display: none;');
	});

	it('keeps the ship-to country out of the folded part, so a shopper on a phone can always change it', () => {
		const html = page();
		const summary = html.slice(html.indexOf('id="summary"'), html.indexOf('</aside>'));
		expect(summary).toContain('id="country-row"');
		expect(summary.slice(summary.indexOf('id="summary-body"'))).not.toContain('id="country-row"');
	});

	it('has a place for the order note in the summary, hidden until the cart has one', () => {
		const html = page();
		const summary = html.slice(html.indexOf('id="summary-body"'), html.indexOf('</aside>'));
		expect(summary).toContain('<div class="note" id="note-row" hidden><h3>Order note</h3><p id="note-text"></p></div>');
	});

	it('keeps store text from closing its script or adding markup', () => {
		const html = page({ info: { ...INFO, brand: { ...INFO.brand!, name: 'Evil </script><script>alert(1)</script>' }, products: [{ ...INFO.products[0], name: '</script><img src=x onerror=alert(1)>' }] } });
		expect(html).not.toContain('</script><script>alert(1)');
		expect(html).not.toContain('<img src=x');
		expect(configOf(html).products).toEqual([expect.objectContaining({ name: '</script><img src=x onerror=alert(1)>' })]);
	});

	it("says the store can't take payments when the deployment has no publishable key or the store no file", () => {
		expect(page({ publishableKey: null })).toContain("This store can't take payments right now.");
		const neutral = page({ info: null });
		expect(neutral).toContain("This store can't take payments right now.");
		expect(neutral).toContain('<title>Checkout</title>');
	});
});

describe("renderPayPage in the shopper's language", () => {
	/** The page's copy as the template writes it, for the three languages; the English is the page as it was before translation. */
	const COPY: Record<Locale, { title: string; heading: string; back: string; steps: string[]; pay: string; fine: string; summary: string; toggle: string; totals: string[]; note: string; empty: string }> = {
		en: {
			title: '<title>Checkout · Ember Roasters</title>',
			heading: '<h1>Checkout</h1>',
			back: '<a class="back" id="back" href="/space/app_1/preview/main/">&larr; Continue shopping</a>',
			steps: [
				'<h2><span>1</span> Contact</h2><label class="field-label" for="email">Email</label>',
				'placeholder="you@example.com"',
				'<h2><span>2</span> Shipping address</h2>',
				'<h2><span>3</span> Payment</h2>',
			],
			pay: '<button class="pay" id="pay" type="button" disabled>Pay</button>',
			fine: '<p class="fine">Payments are processed securely by Stripe. Ember Roasters is the seller.</p>',
			summary: '<aside class="panel summary" id="summary" aria-label="Order summary">',
			toggle: '<span id="summary-toggle-label">Show order summary</span>',
			totals: ['<label for="country">Ship to</label>', '<dt>Subtotal</dt>', '<dt>Shipping</dt>', '<dt class="total">Total</dt>'],
			note: '<div class="note" id="note-row" hidden><h3>Order note</h3>',
			empty: '<h2>Your cart is empty</h2>\n    <p><a id="empty-back" href="/space/app_1/preview/main/">Continue shopping</a></p>',
		},
		es: {
			title: '<title>Finalizar compra · Ember Roasters</title>',
			heading: '<h1>Finalizar compra</h1>',
			back: '<a class="back" id="back" href="/space/app_1/preview/main/">&larr; Seguir comprando</a>',
			steps: [
				'<h2><span>1</span> Contacto</h2><label class="field-label" for="email">Correo electrónico</label>',
				'placeholder="tu@ejemplo.com"',
				'<h2><span>2</span> Dirección de envío</h2>',
				'<h2><span>3</span> Pago</h2>',
			],
			pay: '<button class="pay" id="pay" type="button" disabled>Pagar</button>',
			fine: '<p class="fine">Los pagos se procesan de forma segura con Stripe. Ember Roasters es el vendedor.</p>',
			summary: '<aside class="panel summary" id="summary" aria-label="Resumen del pedido">',
			toggle: '<span id="summary-toggle-label">Mostrar resumen del pedido</span>',
			totals: ['<label for="country">Enviar a</label>', '<dt>Subtotal</dt>', '<dt>Envío</dt>', '<dt class="total">Total</dt>'],
			note: '<div class="note" id="note-row" hidden><h3>Nota del pedido</h3>',
			empty: '<h2>Tu carrito está vacío</h2>\n    <p><a id="empty-back" href="/space/app_1/preview/main/">Seguir comprando</a></p>',
		},
		'pt-BR': {
			title: '<title>Finalizar compra · Ember Roasters</title>',
			heading: '<h1>Finalizar compra</h1>',
			back: '<a class="back" id="back" href="/space/app_1/preview/main/">&larr; Continuar comprando</a>',
			steps: [
				'<h2><span>1</span> Contato</h2><label class="field-label" for="email">E-mail</label>',
				'placeholder="voce@exemplo.com"',
				'<h2><span>2</span> Endereço de entrega</h2>',
				'<h2><span>3</span> Pagamento</h2>',
			],
			pay: '<button class="pay" id="pay" type="button" disabled>Pagar</button>',
			fine: '<p class="fine">Os pagamentos são processados com segurança pela Stripe. Ember Roasters é o vendedor.</p>',
			summary: '<aside class="panel summary" id="summary" aria-label="Resumo do pedido">',
			toggle: '<span id="summary-toggle-label">Mostrar resumo do pedido</span>',
			totals: ['<label for="country">Enviar para</label>', '<dt>Subtotal</dt>', '<dt>Envio</dt>', '<dt class="total">Total</dt>'],
			note: '<div class="note" id="note-row" hidden><h3>Nota do pedido</h3>',
			empty: '<h2>Seu carrinho está vazio</h2>\n    <p><a id="empty-back" href="/space/app_1/preview/main/">Continuar comprando</a></p>',
		},
	};

	it.each(LOCALES)('writes every line of the %s page in that language, with the language on the document', (locale) => {
		const html = page({ locale });
		const copy = COPY[locale];
		expect(html).toContain(`<html lang="${locale}">`);
		for (const line of [copy.title, copy.heading, copy.back, ...copy.steps, copy.pay, copy.fine, copy.summary, copy.toggle, ...copy.totals, copy.note, copy.empty]) expect(html).toContain(line);
	});

	it('leaves the English page as it was, so nothing in it says it was translated', () => {
		const html = page();
		expect(html).toContain('<html lang="en">');
		expect(html).toContain('<h2>Order summary</h2>');
		expect(html).toContain('<dd id="subtotal">&mdash;</dd>');
		expect(configOf(html)).toMatchObject({ locale: 'en', stripeLocale: 'en', intlLocale: 'en-US', unavailable: "This store can't take payments right now." });
	});

	it("gives Stripe's form the language: Latin American Spanish for es, Brazilian Portuguese for pt-BR", () => {
		expect(configOf(page({ locale: 'es' }))).toMatchObject({ locale: 'es', stripeLocale: 'es-419', intlLocale: 'es-419' });
		expect(configOf(page({ locale: 'pt-BR' }))).toMatchObject({ locale: 'pt-BR', stripeLocale: 'pt-BR', intlLocale: 'pt-BR' });
	});

	it('hands the script its own words in the language, so a message it shows is the shopper\'s', () => {
		const text = configOf(page({ locale: 'es' })).text as Record<string, string>;
		expect(text.checkoutFailed).toBe('No se pudo iniciar el pago. Actualiza la página e inténtalo de nuevo.');
		expect(text.payAmount).toBe('Pagar {amount}');
		expect(configOf(page({ locale: 'es' })).unavailable).toBe('Esta tienda no puede recibir pagos en este momento.');
		expect((configOf(page({ locale: 'pt-BR' })).text as Record<string, string>).free).toBe('Grátis');
	});

	it("says the store can't take payments in the shopper's language", () => {
		expect(page({ locale: 'es', publishableKey: null })).toContain('<div class="notice" id="notice">Esta tienda no puede recibir pagos en este momento.</div>');
		expect(page({ locale: 'pt-BR', info: null })).toContain('Esta loja não pode receber pagamentos agora.');
	});

	it("names no seller in the language's words on a store without a brand", () => {
		expect(page({ locale: 'es', info: { ...INFO, brand: null } })).toContain('Esta tienda es el vendedor.');
		expect(page({ locale: 'pt-BR', info: { ...INFO, brand: null } })).toContain('Esta loja é o vendedor.');
		expect(page({ locale: 'es', info: { ...INFO, brand: null } })).toContain('<title>Finalizar compra</title>');
	});

	it('escapes a brand name in a translated sentence, so store text still cannot add markup', () => {
		const html = page({ locale: 'es', info: { ...INFO, brand: { ...INFO.brand!, name: '<b>"Ember" & Co</b>' } } });
		expect(html).toContain('<title>Finalizar compra · &lt;b&gt;&quot;Ember&quot; &amp; Co&lt;/b&gt;</title>');
		expect(html).toContain('&lt;b&gt;&quot;Ember&quot; &amp; Co&lt;/b&gt; es el vendedor.');
		expect(html).not.toContain('<b>"Ember"');
	});

	it('keeps the products, ids and prices the page was given, whatever the language', () => {
		const products = INFO.products.map((product) => ({ ...product, name: 'Café de Kenia', variants: product.variants.map((variant) => ({ ...variant, name: 'Grano entero, 250 g' })) }));
		const spanish = configOf(page({ locale: 'es', info: { ...INFO, products } }));
		expect(spanish.products).toEqual([
			{ id: 'kenya', name: 'Café de Kenia', image: '/space/app_1/preview/main/images/kenya.jpg', variants: [{ id: 'kenya-250', name: 'Grano entero, 250 g', priceCents: 2000 }] },
		]);
		expect(spanish).toMatchObject({ countries: ['US', 'CA'] });
	});

	it('writes dollars the way the language does, so they cannot be taken for pesos or reais', () => {
		const money = (locale: Locale, cents: number) => {
			const { intlLocale } = configOf(page({ locale })) as { intlLocale: string };
			return new Intl.NumberFormat(intlLocale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
		};
		for (const locale of LOCALES) for (const cents of [0, 5, 2000, 2450, 123_450]) expect(money(locale, cents), `${locale} ${cents}`).toBe(formatDollars(cents / 100, locale, 'always'));
		expect(money('es', 2450)).toBe('USD\u00a024.50');
		expect(money('pt-BR', 123_450)).toBe('US$\u00a01.234,50');
	});

	it('keeps its security policy and nonce in every language', () => {
		for (const locale of LOCALES) {
			const html = page({ locale });
			expect(html).toContain('<script nonce="n0nce">');
			expect(html.match(/<script(?![^>]*type="application\/json")[^>]*>/g)).toHaveLength(3);
		}
	});
});

describe('payPageHeaders', () => {
	it("allows Stripe's scripts, frames and connections, the page's own script by nonce, and framing only by Estori", () => {
		const headers = payPageHeaders('n0nce', 'https://build.estori.app');
		const policy = headers['Content-Security-Policy'];
		expect(policy).toContain("script-src 'self' 'nonce-n0nce' https://js.stripe.com");
		expect(policy).toContain('frame-src https://js.stripe.com');
		expect(policy).toContain("connect-src 'self' https://api.stripe.com");
		// Stripe.js fetches the brand font's stylesheet for its fields.
		expect(policy).toMatch(/connect-src [^;]*https:\/\/fonts\.googleapis\.com/);
		expect(policy).toContain("frame-ancestors 'self' https://build.estori.app");
		expect(policy).not.toContain("'unsafe-inline' https://js.stripe.com");
		expect(headers['Cache-Control']).toBe('no-store');
	});
});
