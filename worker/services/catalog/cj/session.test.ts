import { describe, expect, it } from 'vitest';
import { CJ_SESSION_KEY, CjSession, type CjTokenRecord } from './session';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function fakeKv() {
	const values = new Map<string, { value: string; ttl: number | undefined }>();
	const kv: Pick<KVNamespace, 'get' | 'put'> = {
		get: (async (key: string) => values.get(key)?.value ?? null) as KVNamespace['get'],
		put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: KVNamespacePutOptions) => {
			values.set(key, { value: String(value), ttl: options?.expirationTtl });
		},
	};
	return { kv, values };
}

function tokenSource(record: CjTokenRecord) {
	let calls = 0;
	return {
		fetchToken: async () => {
			calls += 1;
			return { ...record, accessToken: `${record.accessToken}-${calls}` };
		},
		calls: () => calls,
	};
}

const RECORD: CjTokenRecord = { accessToken: 'cj-token', accessTokenExpiresAt: NOW + 180 * DAY, openId: '1234567' };

describe('CjSession', () => {
	it('fetches a token once and shares it with every later session through KV', async () => {
		const { kv } = fakeKv();
		const source = tokenSource(RECORD);
		const first = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });
		const second = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });

		expect((await first.token()).accessToken).toBe('cj-token-1');
		expect((await first.token()).accessToken).toBe('cj-token-1');
		expect((await second.token()).accessToken).toBe('cj-token-1');
		expect(source.calls()).toBe(1);
	});

	it('stores only ciphertext, which another API key cannot read', async () => {
		const { kv, values } = fakeKv();
		const source = tokenSource(RECORD);
		await new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW }).token();

		const stored = values.get(CJ_SESSION_KEY);
		expect(stored?.value).not.toContain('cj-token');
		expect(stored?.value).not.toContain('1234567');
		// The entry expires 7 days before the token does.
		expect(stored?.ttl).toBe((180 - 7) * 24 * 60 * 60);

		const rotated = new CjSession({ kv, apiKey: 'key-2', fetchToken: source.fetchToken, now: () => NOW });
		expect((await rotated.token()).accessToken).toBe('cj-token-2');
		expect(source.calls()).toBe(2);
	});

	it('fetches a new token on refresh, and when the stored one is about to expire', async () => {
		const { kv } = fakeKv();
		const source = tokenSource(RECORD);
		const session = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });
		await session.token();
		expect((await session.refresh()).accessToken).toBe('cj-token-2');

		const late = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW + 175 * DAY });
		expect((await late.token()).accessToken).toBe('cj-token-3');
	});
});
