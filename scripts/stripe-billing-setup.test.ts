import { describe, expect, it } from 'vitest';
import { BILLING_LOOKUP_KEYS, setUpBilling } from './stripe-billing-setup';

type Route = (body: URLSearchParams) => Response;

function stripe(routes: Record<string, Route>) {
	const seen: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const key = `${init?.method ?? 'GET'} ${url.pathname}`;
		seen.push(key);
		const route = routes[key] ?? routes[`${init?.method ?? 'GET'} ${url.pathname.replace(/\/[^/]+$/, '/:id')}`];
		if (!route) throw new Error(`unexpected ${key}`);
		return route(new URLSearchParams(String(init?.body ?? '')));
	};
	return { fetchImpl, seen };
}

const PORTAL_OK = () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] });

describe('setUpBilling', () => {
	it('creates the three products and their prices, tagged, on a first run', async () => {
		const created: Array<Record<string, string | null>> = [];
		const { fetchImpl } = stripe({
			'GET /v1/products/:id': () => Response.json({ error: { code: 'resource_missing', message: 'No such product' } }, { status: 404 }),
			'POST /v1/products': (body) => Response.json({ id: body.get('id') }),
			'GET /v1/prices': () => Response.json({ data: [] }),
			'POST /v1/prices': (body) => {
				created.push({ lookup: body.get('lookup_key'), amount: body.get('unit_amount'), interval: body.get('recurring[interval]'), plan: body.get('metadata[estori_plan]'), kind: body.get('metadata[estori_kind]'), product: body.get('product') });
				return Response.json({ id: `price_${created.length}` });
			},
			'GET /v1/billing_portal/configurations': PORTAL_OK,
		});
		const result = await setUpBilling({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result).toEqual({ mode: 'test', priceIds: { pro: 'price_1', premium: 'price_2', credits: 'price_3' }, portalProblems: [] });
		expect(created).toEqual([
			{ lookup: BILLING_LOOKUP_KEYS.pro, amount: '4900', interval: 'month', plan: 'pro', kind: null, product: 'estori_pro' },
			{ lookup: BILLING_LOOKUP_KEYS.premium, amount: '19900', interval: 'month', plan: 'premium', kind: null, product: 'estori_premium' },
			{ lookup: BILLING_LOOKUP_KEYS.credits, amount: '150', interval: null, plan: null, kind: 'credits', product: 'estori_credits' },
		]);
	});

	it('reuses prices that already match, and reports a portal that lets sellers switch plans', async () => {
		const existing = [
			{ id: 'price_old_pro', lookup_key: BILLING_LOOKUP_KEYS.pro, unit_amount: 4_900, active: true },
			{ id: 'price_old_premium', lookup_key: BILLING_LOOKUP_KEYS.premium, unit_amount: 19_900, active: true },
			{ id: 'price_old_credits', lookup_key: BILLING_LOOKUP_KEYS.credits, unit_amount: 150, active: true },
		];
		const { fetchImpl, seen } = stripe({
			'GET /v1/products/:id': () => Response.json({ id: 'estori_pro' }),
			'GET /v1/prices': () => Response.json({ data: existing }),
			'GET /v1/billing_portal/configurations': () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'immediately' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] }),
		});
		const result = await setUpBilling({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result.priceIds).toEqual({ pro: 'price_old_pro', premium: 'price_old_premium', credits: 'price_old_credits' });
		expect(seen.some((call) => call.startsWith('POST'))).toBe(false);
		expect(result.portalProblems).toEqual(['Turn off plan switching in the customer portal.', 'Set cancellations to happen at the end of the billing period.']);
	});

	it('replaces a price whose amount changed, moving the lookup key to the new one, and asks for a portal that is missing', async () => {
		const created: Array<Record<string, string | null>> = [];
		const { fetchImpl } = stripe({
			'GET /v1/products/:id': () => Response.json({ id: 'estori_pro' }),
			'GET /v1/prices': () =>
				Response.json({
					data: [
						{ id: 'price_old_pro', lookup_key: BILLING_LOOKUP_KEYS.pro, unit_amount: 3_900, active: true },
						{ id: 'price_premium', lookup_key: BILLING_LOOKUP_KEYS.premium, unit_amount: 19_900, active: true },
						{ id: 'price_credits', lookup_key: BILLING_LOOKUP_KEYS.credits, unit_amount: 150, active: true },
					],
				}),
			'POST /v1/prices': (body) => {
				created.push({ lookup: body.get('lookup_key'), amount: body.get('unit_amount'), transfer: body.get('transfer_lookup_key') });
				return Response.json({ id: 'price_new_pro' });
			},
			'GET /v1/billing_portal/configurations': () => Response.json({ data: [] }),
		});
		const result = await setUpBilling({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(created).toEqual([{ lookup: BILLING_LOOKUP_KEYS.pro, amount: '4900', transfer: 'true' }]);
		expect(result.priceIds).toEqual({ pro: 'price_new_pro', premium: 'price_premium', credits: 'price_credits' });
		expect(result.portalProblems).toEqual(["Create the customer portal's default configuration in the Stripe Dashboard."]);
	});

	it("refuses a key whose mode isn't the one asked for", async () => {
		const { fetchImpl } = stripe({});
		await expect(setUpBilling({ secretKey: 'sk_live_fake', mode: 'test', fetchImpl })).rejects.toThrow('The key is a live key, but --mode test was asked for.');
		await expect(setUpBilling({ secretKey: 'rk_test_fake', mode: 'live', fetchImpl })).rejects.toThrow('The key is a test key, but --mode live was asked for.');
	});
});
