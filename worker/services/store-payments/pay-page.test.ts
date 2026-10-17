import { describe, expect, it } from 'vitest';
import { payPageHeaders, renderPayPage, STRIPE_JS_URL } from './pay-page';
import type { StoreInfo } from '../../../shared/types/store-payments';

const INFO: StoreInfo = {
	mode: 'test',
	paymentsAvailable: true,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 500, freeOverCents: 5000 },
	products: [{ id: 'kenya', name: 'Kenya Nyeri AA', image: '/images/kenya.jpg', variants: [{ id: 'kenya-250', name: 'Whole bean, 250g', priceCents: 2000 }] }],
	brand: { name: 'Ember Roasters', logo: '/images/logo.svg', colors: { background: '#1a1210', surface: '#241a17', text: '#f5ede6', accent: '#f59a46', accentText: '#1a1210' }, font: 'Fraunces', corners: 'pill' },
};

const page = (overrides: Partial<Parameters<typeof renderPayPage>[0]> = {}) =>
	renderPayPage({ basePath: '/space/app_1/preview/main', publishableKey: 'pk_test_123', info: INFO, nonce: 'n0nce', ...overrides });

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
