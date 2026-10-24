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

	it('keeps the order note in the cart, where the checkout page reads it', () => {
		expect(SKILL).toContain('`Estori.cart.note()` and `Estori.cart.setNote(text)`');
		expect(SKILL).toContain('the seller sees it on the order');
	});

	it('teaches store code that runs in the classic script tags the skill asks for', () => {
		const example = SKILL.match(/```js\n([\s\S]+?)\n```/)?.[1] ?? '';
		expect(example).toContain('Estori.store()');
		// Parsing only: a top-level await is a syntax error outside a module.
		expect(() => new Function(example)).not.toThrow();
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

	it('tells the agent that shoppers pay on the live store the owner publishes, and that its edits wait for the next publish', () => {
		const testAndLive = SKILL.slice(SKILL.indexOf('Test and live'), SKILL.indexOf('## 7.')).replace(/\s+/g, ' ');
		expect(testAndLive).toContain('Go live');
		expect(testAndLive).toContain('any shopper can pay');
		expect(testAndLive).toContain('Publish changes');
		expect(testAndLive).toContain("You can't publish");
	});

	it('documents immutable private projections and cookie-protected receipt delivery', () => {
  for (const requirement of ['type: "physical"', 'type: "digital"', 'Digital-only carts', 'Never invent or alter `accountProductId` or `downloadAssetIds`', 'receipt.downloads', '/__estori/orders/:orderId/downloads/:assetId', 'HttpOnly receipt cookie', '/api/my-products/assets/']) expect(SKILL).toContain(requirement);
 });

 it('renders real receipt downloads safely with the correct live or preview prefix', async () => {
  const example = SKILL.match(/```js\n([\s\S]+?)\n```/)?.[1] ?? '';
  const source = example.replace(/\n(?:main|showConfirmation)\(\);/g, '');
  for (const prefix of ['', '/space/app-1/preview/main']) {
   const order = {orderId: 'ord_abc', orderNumber: 7, downloads: [
    {id: 'asset-1', name: '<img src=x onerror=alert(1)>', url: prefix + '/__estori/orders/ord_abc/downloads/asset-1'},
    {id: 'asset-2', name: 'Unsafe origin', url: 'https://other.test/__estori/orders/ord_abc/downloads/asset-2'},
    {id: 'asset-3', name: 'Owner asset', url: '/api/my-products/assets/asset-3'},
   ]};
   const links: Array<{href: string; textContent: string}> = [];
   const downloads = {replaceChildren: () => {links.length = 0;}, appendChild: (link: {href: string; textContent: string}) => links.push(link)};
   const number = {textContent: ''};
   const document = {
    querySelector: (selector: string) => selector === '#order-number' ? number : selector === '#order-downloads' ? downloads : {src: 'https://store.test' + prefix + '/__estori/store.js'},
    createElement: () => ({href: '', textContent: ''}),
   };
   const location = {origin: 'https://store.test', href: 'https://store.test' + prefix + '/thanks?order=ord_abc', search: '?order=ord_abc'};
   const render = new Function('Estori', 'document', 'location', source + '\nreturn showConfirmation();');
   await render({order: async (id: string) => id === 'ord_abc' ? order : null}, document, location);
   expect(number.textContent).toBe('Order #7');
   expect(links).toEqual([{href: 'https://store.test' + prefix + '/__estori/orders/ord_abc/downloads/asset-1', textContent: '<img src=x onerror=alert(1)>'}]);
   // A refunded/historical receipt removes stale links and offers no invented files.
   await render({order: async () => ({...order, downloads: undefined})}, document, location);
   expect(links).toEqual([]);
  }
 });

	it('keeps payments on the platform', () => {
		for (const rule of ['/__estori/store.js', 'Estori.checkout(', 'Estori.order(', 'card details', 'catalogVariantId']) expect(SKILL).toContain(rule);
		expect(APP_FILE_STRUCTURE).toContain('store-checkout');
	});
});
