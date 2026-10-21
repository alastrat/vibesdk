import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';

/** The addresses the client asks for, with the browser the client reads (storage, cookies) and `fetch` stood in for. */
function askedAddresses(): string[] {
	const asked: string[] = [];
	vi.stubGlobal('localStorage', { getItem: () => 'token', setItem: () => undefined });
	vi.stubGlobal('document', { cookie: 'session=abc' });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (address: string) => {
			asked.push(address);
			return new Response(JSON.stringify({ success: true, data: { rows: [], nextCursor: null } }), { status: 200 });
		}),
	);
	return asked;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the address of a language\'s texts', () => {
	it('has no query string without a search or a cursor', async () => {
		const asked = askedAddresses();
		await apiClient.getStoreTranslationTexts('app 1', 'pt-BR');
		await apiClient.getStoreTranslationTexts('app 1', 'pt-BR', { query: '' });
		expect(asked).toEqual(['/api/stores/app%201/translations/pt-BR/texts', '/api/stores/app%201/translations/pt-BR/texts']);
	});

	it('carries the search and the cursor, encoded', async () => {
		const asked = askedAddresses();
		await apiClient.getStoreTranslationTexts('app1', 'es', { query: 'velas & cera' });
		await apiClient.getStoreTranslationTexts('app1', 'es', { cursor: '1729:42' });
		await apiClient.getStoreTranslationTexts('app1', 'es', { query: 'velas', cursor: '1729:42' });
		expect(asked).toEqual([
			'/api/stores/app1/translations/es/texts?query=velas+%26+cera',
			'/api/stores/app1/translations/es/texts?cursor=1729%3A42',
			'/api/stores/app1/translations/es/texts?query=velas&cursor=1729%3A42',
		]);
	});

	it('is built without `URLSearchParams.size`, which Safari 16 lacks', async () => {
		const asked = askedAddresses();
		const size = vi.spyOn(URLSearchParams.prototype, 'size', 'get').mockImplementation(() => {
			throw new Error('URLSearchParams.size is not available');
		});
		try {
			await apiClient.getStoreTranslationTexts('app1', 'es', { query: 'velas' });
		} finally {
			size.mockRestore();
		}
		expect(asked).toEqual(['/api/stores/app1/translations/es/texts?query=velas']);
	});
});
