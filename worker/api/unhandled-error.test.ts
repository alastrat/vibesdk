import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types/appenv';

const { reportServerError } = vi.hoisted(() => ({ reportServerError: vi.fn() }));
vi.mock('../services/posthog/server-errors', () => ({ reportServerError }));

const { unhandledApiError } = await import('./unhandled-error');

function app() {
	const routes = new Hono<AppEnv>();
	routes.get('/api/boom', () => {
		throw new TypeError('kaput');
	});
	routes.get('/api/teapot', () => {
		throw new HTTPException(418, { message: 'short and stout' });
	});
	routes.onError(unhandledApiError);
	return routes;
}

describe('an error no route handled', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is reported and answered as a plain 500', async () => {
		const response = await app().request('/api/boom');
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ success: false, error: { message: 'Internal server error' } });
		expect(reportServerError).toHaveBeenCalledWith(expect.objectContaining({ component: 'UnhandledApiError', message: 'Unhandled API error' }));
	});

	it("keeps an HTTPException's own answer and reports nothing", async () => {
		reportServerError.mockClear();
		const response = await app().request('/api/teapot');
		expect(response.status).toBe(418);
		expect(reportServerError).not.toHaveBeenCalled();
	});
});
