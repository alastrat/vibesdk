import { describe, expect, it } from 'vitest';
import { createCjClient, requestCjAccessToken } from './client';
import { CjApiError } from './errors';
import type { CjTokenRecord } from './session';

const TOKEN: CjTokenRecord = { accessToken: 'tok-1', accessTokenExpiresAt: 1_900_000_000_000, openId: '42' };

function scriptedFetch(answers: Array<{ status?: number; body: unknown }>) {
	const calls: Array<{ url: string; method: string; token: string | null; body: string | null }> = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		calls.push({
			url: String(input),
			method: init?.method ?? 'GET',
			token: new Headers(init?.headers).get('CJ-Access-Token'),
			body: typeof init?.body === 'string' ? init.body : null,
		});
		const answer = answers.shift();
		if (!answer) throw new Error('No scripted answer left');
		return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
	};
	return { calls, fakeFetch };
}

function fakeSession() {
	let refreshes = 0;
	return {
		session: {
			token: async () => TOKEN,
			refresh: async () => {
				refreshes += 1;
				return { ...TOKEN, accessToken: `tok-${refreshes + 1}` };
			},
		},
		refreshes: () => refreshes,
	};
}

function clock() {
	let now = 0;
	const sleeps: number[] = [];
	return {
		now: () => now,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			now += ms;
		},
		sleeps,
	};
}

const OK = (data: unknown) => ({ body: { code: 200, result: true, message: 'Success', data, requestId: 'r1', pointsInfo: { remaining: 49_000 } } });

describe('createCjClient', () => {
	it('sends the token, reads the data and remembers the points left', async () => {
		const { calls, fakeFetch } = scriptedFetch([OK({ pid: 'p1', variants: [] })]);
		const time = clock();
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, ...time });

		expect(await client.queryProduct('p1')).toEqual({ pid: 'p1', variants: [] });
		expect(calls[0]).toMatchObject({ url: 'https://developers.cjdropshipping.com/api2.0/v1/product/query?pid=p1', method: 'GET', token: 'tok-1' });
		expect(client.pointsRemaining()).toBe(49_000);
	});

	it('treats HTTP 200 with a failing code as an error', async () => {
		const { fakeFetch } = scriptedFetch([{ body: { code: 1602001, result: false, message: 'Product removed', data: null, requestId: 'r2' } }]);
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, ...clock() });

		const error = await client.queryProduct('p1').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CjApiError);
		expect(error).toMatchObject({ code: 1602001, requestId: 'r2' });
	});

	it('fetches a new token once when CJ refuses the current one', async () => {
		const { calls, fakeFetch } = scriptedFetch([
			{ body: { code: 1600001, result: false, message: 'Invalid token', data: null } },
			OK([]),
		]);
		const { session, refreshes } = fakeSession();
		const client = createCjClient({ session, fetchImpl: fakeFetch, ...clock() });

		await client.freightCalculate({ startCountryCode: 'US', endCountryCode: 'US', products: [{ vid: 'v1', quantity: 1 }] });
		expect(refreshes()).toBe(1);
		expect(calls.map((call) => call.token)).toEqual(['tok-1', 'tok-2']);
		expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ startCountryCode: 'US', endCountryCode: 'US', products: [{ vid: 'v1', quantity: 1 }] });
	});

	it('waits and repeats once when throttled, and spaces every call', async () => {
		const { fakeFetch } = scriptedFetch([{ status: 429, body: { code: 1600200, message: 'Too many requests' } }, OK({ pid: 'p1' }), OK({ pid: 'p2' })]);
		const time = clock();
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, minIntervalMs: 1100, ...time });

		await client.queryProduct('p1');
		await client.queryProduct('p2');
		expect(time.sleeps).toEqual([1200, 1100, 1100]);
	});
});

describe('requestCjAccessToken', () => {
	it('reads the token, its expiry and the open id', async () => {
		const { calls, fakeFetch } = scriptedFetch([OK({ accessToken: 'tok-9', accessTokenExpiryDate: '2027-04-14T05:27:03+08:00', openId: 1234567 })]);
		expect(await requestCjAccessToken('key-1', fakeFetch)).toEqual({ accessToken: 'tok-9', accessTokenExpiresAt: Date.parse('2027-04-14T05:27:03+08:00'), openId: '1234567' });
		expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ apiKey: 'key-1' });
	});
});
