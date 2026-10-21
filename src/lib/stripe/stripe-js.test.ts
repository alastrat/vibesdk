import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRIPE_JS_URL } from '../../../shared/types/stripe';
import type { StripeJs } from './stripe-js';

// The Workers test pool has no DOM, so the loader runs against a minimal stand-in for the page.
class FakeScript extends EventTarget {
	src = '';
	async = false;
	isConnected = false;
	remove(): void {
		this.isConnected = false;
	}
}

interface FakePage {
	scripts: FakeScript[];
	stripePage: { Stripe?: (key: string) => StripeJs };
}

function installFakePage(): FakePage {
	const scripts: FakeScript[] = [];
	const stripePage: FakePage['stripePage'] = {};
	vi.stubGlobal('window', stripePage);
	vi.stubGlobal('document', {
		createElement: () => new FakeScript(),
		querySelector: (selector: string) => scripts.find((script) => script.isConnected && selector.includes(script.src)) ?? null,
		head: {
			append: (script: FakeScript) => {
				script.isConnected = true;
				scripts.push(script);
			},
		},
	});
	return { scripts, stripePage };
}

function fakeStripe(key: string): StripeJs {
	return { key } as unknown as StripeJs;
}

async function freshLoader() {
	vi.resetModules();
	return import('./stripe-js');
}

describe('loadStripe', () => {
	let page: FakePage;

	beforeEach(() => {
		page = installFakePage();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('adds one script however many callers wait, and gives each its own stripe', async () => {
		const { loadStripe } = await freshLoader();
		const first = loadStripe('pk_test_a', 'en');
		const second = loadStripe('pk_test_b', 'en');
		expect(page.scripts).toHaveLength(1);
		expect(page.scripts[0].src).toBe(STRIPE_JS_URL);
		page.stripePage.Stripe = vi.fn(fakeStripe);
		page.scripts[0].dispatchEvent(new Event('load'));
		const [a, b] = await Promise.all([first, second]);
		expect(a).toEqual({ key: 'pk_test_a' });
		expect(b).toEqual({ key: 'pk_test_b' });
		expect(page.stripePage.Stripe).toHaveBeenCalledTimes(2);
	});

	it("opens each stripe in the app's language, Latin American Spanish for Spanish", async () => {
		const { loadStripe } = await freshLoader();
		const factory = vi.fn(fakeStripe);
		page.stripePage.Stripe = factory;
		await loadStripe('pk_test_a', 'en');
		await loadStripe('pk_test_a', 'es');
		await loadStripe('pk_test_a', 'pt-BR');
		expect(factory.mock.calls.map((call) => (call as unknown[])[1])).toEqual([{ locale: 'en' }, { locale: 'es-419' }, { locale: 'pt-BR' }]);
	});

	it('does not add a script when stripe is already on the page', async () => {
		const { loadStripe } = await freshLoader();
		page.stripePage.Stripe = fakeStripe;
		await expect(loadStripe('pk_test_a', 'en')).resolves.toEqual({ key: 'pk_test_a' });
		expect(page.scripts).toHaveLength(0);
	});

	it('rejects when the script fails, then adds a fresh one on the next try', async () => {
		const { loadStripe } = await freshLoader();
		const failed = loadStripe('pk_test_a', 'en');
		page.scripts[0].dispatchEvent(new Event('error'));
		await expect(failed).rejects.toThrow('Stripe could not load');
		expect(page.scripts[0].isConnected).toBe(false);

		const retried = loadStripe('pk_test_a', 'en');
		expect(page.scripts).toHaveLength(2);
		page.stripePage.Stripe = fakeStripe;
		page.scripts[1].dispatchEvent(new Event('load'));
		await expect(retried).resolves.toEqual({ key: 'pk_test_a' });
	});

	it('rejects when the script loads but defines no stripe', async () => {
		const { loadStripe } = await freshLoader();
		const loading = loadStripe('pk_test_a', 'en');
		page.scripts[0].dispatchEvent(new Event('load'));
		await expect(loading).rejects.toThrow('Stripe could not load');
	});
});
