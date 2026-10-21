/** The translations and tasks calls of the API client: the paths, methods and query strings they send, with `fetch` stood in. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';

interface Sent {
	url: string;
	method: string;
	body: unknown;
}

let sent: Sent[];

beforeEach(() => {
	sent = [];
	vi.stubGlobal('localStorage', { getItem: () => 'anonymous', setItem: () => undefined });
	vi.stubGlobal('document', { cookie: 'session=1' });
	vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
		sent.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
		const data = url.includes('/csrf-token') ? { token: 'csrf', expiresIn: 3_600 } : [];
		return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	});
});

afterEach(() => vi.unstubAllGlobals());

/** What the client sent for the call itself, leaving out the CSRF token it fetched first. */
const calls = (): Sent[] => sent.filter((request) => !request.url.includes('/csrf-token'));

describe('the translations calls', () => {
	it("send a text list's search and page as a query string only when there is one, in a form older browsers also read", async () => {
		const client = new ApiClient();
		await client.getStoreTranslationTexts('app 1', 'es');
		await client.getStoreTranslationTexts('app 1', 'pt-BR', { query: 'té & café', cursor: '17:4' });
		await client.getStoreTranslationTexts('app 1', 'es', { cursor: '17:4' });
		expect(calls().map((request) => request.url)).toEqual([
			'/api/stores/app%201/translations/es/texts',
			'/api/stores/app%201/translations/pt-BR/texts?query=t%C3%A9+%26+caf%C3%A9&cursor=17%3A4',
			'/api/stores/app%201/translations/es/texts?cursor=17%3A4',
		]);
	});

	it('keep the search and page on a browser whose URLSearchParams has no size, as Safari 16 and earlier', async () => {
		const original = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
		Object.defineProperty(URLSearchParams.prototype, 'size', { get: () => undefined, configurable: true });
		try {
			await new ApiClient().getStoreTranslationTexts('app_1', 'es', { query: 'tea', cursor: '1:2' });
		} finally {
			if (original) Object.defineProperty(URLSearchParams.prototype, 'size', original);
		}
		expect(calls().map((request) => request.url)).toEqual(['/api/stores/app_1/translations/es/texts?query=tea&cursor=1%3A2']);
	});

	it('call the routes the worker offers, with their methods and bodies', async () => {
		const client = new ApiClient();
		await client.getTranslationStores();
		await client.getStoreTranslations('app_1');
		await client.saveStoreTranslationSettings('app_1', { showSwitcher: false, targets: { es: { enabled: true } } });
		await client.runStoreTranslation('app_1', 'pt-BR');
		await client.saveStoreTranslationText('app_1', 'es', 'a'.repeat(64), 'Hola');
		await client.revertStoreTranslationText('app_1', 'es', 'a'.repeat(64));
		await client.getTasks();
		await client.getTasks('app_1');
		await client.cancelTask('task_1');
		await client.resumeTask('task_1');
		expect(calls()).toEqual([
			{ url: '/api/translations/stores', method: 'GET', body: undefined },
			{ url: '/api/stores/app_1/translations', method: 'GET', body: undefined },
			{ url: '/api/stores/app_1/translations/settings', method: 'PUT', body: { showSwitcher: false, targets: { es: { enabled: true } } } },
			{ url: '/api/stores/app_1/translations/pt-BR/run', method: 'POST', body: undefined },
			{ url: `/api/stores/app_1/translations/es/texts/${'a'.repeat(64)}`, method: 'PUT', body: { text: 'Hola' } },
			{ url: `/api/stores/app_1/translations/es/texts/${'a'.repeat(64)}`, method: 'DELETE', body: undefined },
			{ url: '/api/tasks', method: 'GET', body: undefined },
			{ url: '/api/tasks?appId=app_1', method: 'GET', body: undefined },
			{ url: '/api/tasks/task_1/cancel', method: 'POST', body: undefined },
			{ url: '/api/tasks/task_1/resume', method: 'POST', body: undefined },
		]);
	});
});
