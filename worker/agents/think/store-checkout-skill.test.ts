import { describe, expect, it } from 'vitest';
import SKILL from './skills/store-checkout/SKILL.md?raw';
import APP_FILE_STRUCTURE from './skills/app-file-structure/SKILL.md?raw';
import { parseStoreManifest } from '../../services/store-payments/manifest';

const skills = import.meta.glob<string>('/worker/agents/think/skills.ts', { query: '?raw', import: 'default', eager: true });

describe('the store checkout skill', () => {
	it('is registered with the agent', () => {
		expect(Object.values(skills)[0]).toContain("'store-checkout': STORE_CHECKOUT");
		expect(SKILL).toMatch(/^---\nname: store-checkout\ndescription: .+\n---/);
	});

	it('teaches a manifest Estori accepts, with the brand block for the checkout page', () => {
		const example = SKILL.match(/```json\n([\s\S]+?)\n```/)?.[1] ?? '';
		const parsed = parseStoreManifest(example);
		expect(parsed.ok).toBe(true);
		expect(parsed.ok && parsed.manifest.brand?.name).toBeTruthy();
		for (const field of ['"logo"', '"colors"', '"font"', '"corners"']) expect(example).toContain(field);
	});

	it("keeps the cart in Estori.cart, the one cart the store and Estori's checkout page share", () => {
		for (const call of ['Estori.cart.add(', 'Estori.cart.setQuantity(', 'Estori.cart.remove(', 'Estori.cart.items()', 'Estori.cart.count()', 'Estori.cart.onChange(']) {
			expect(SKILL).toContain(call);
		}
		expect(SKILL).not.toMatch(/localStorage\.(setItem|removeItem|getItem)/);
	});

	it("leaves the checkout page to Estori: the store's button only calls Estori.checkout()", () => {
		expect(SKILL).toContain("Never build a checkout page");
		expect(SKILL).toContain('Never collect an email, a shipping address or card details');
		expect(SKILL).toMatch(/Estori\.checkout\(\{ successPath: '\/thanks', cancelPath: '\/cart' \}\)/);
	});

	it("forbids money copy that Estori doesn't do", () => {
		expect(SKILL).toContain('Never write money copy');
		for (const example of ['Taxes included', 'delivery']) expect(SKILL).toContain(example);
	});

	it('keeps every other skill whole', () => {
		expect(APP_FILE_STRUCTURE).toMatch(/^---\nname: cloudflare-bundler-apps\ndescription: .+\n---/);
		expect(APP_FILE_STRUCTURE.split('\n').length).toBeGreaterThan(400);
	});

	it('teaches catalog products through the catalog tools', () => {
		for (const phrase of ['search_catalog', 'get_catalog_product', 'minimumRetailPriceCents', 'suggestedRetailPriceCents']) expect(SKILL).toContain(phrase);
	});

	it("checks the owner's payments setup before promising checkout", () => {
		expect(SKILL).toContain('get_payments_setup');
		expect(SKILL).toContain('setupPath');
	});

	it('keeps the payments-setup check apart from the test-and-live section', () => {
		const setup = SKILL.indexOf('Before promising checkout');
		const testAndLive = SKILL.indexOf('Test and live');
		expect(setup).toBeGreaterThan(-1);
		expect(setup).toBeLessThan(testAndLive);
		expect(SKILL.slice(testAndLive)).toContain("Stripe's test cards");
	});

	it('keeps payments on the platform', () => {
		for (const rule of ['/__estori/store.js', 'Estori.checkout(', 'Estori.order(', 'card details', 'catalogVariantId']) expect(SKILL).toContain(rule);
		expect(APP_FILE_STRUCTURE).toContain('store-checkout');
	});
});
