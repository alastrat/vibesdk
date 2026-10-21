import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { RateLimitExceededError, SecurityError, SecurityErrorType } from 'shared/types/errors';
import { setErrorReporter } from '../logger';
import { RateLimitType } from '../services/rate-limit/config';
import type { AppEnv } from '../types/appenv';
import { unhandledApiError } from './unhandled-error';

const reportServerError = vi.fn();
setErrorReporter(reportServerError);

function app() {
	const routes = new Hono<AppEnv>();
	routes.get('/api/boom', () => {
		throw new TypeError('kaput');
	});
	routes.get('/api/teapot', () => {
		throw new HTTPException(418, { message: 'short and stout' });
	});
	routes.get('/api/limited', () => {
		throw new RateLimitExceededError('Global API rate limit exceeded', RateLimitType.API_RATE_LIMIT);
	});
	routes.get('/api/forbidden', () => {
		throw new SecurityError(SecurityErrorType.FORBIDDEN, 'Not yours', 403);
	});
	routes.onError(unhandledApiError);
	return routes;
}

describe('an error no route handled', () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		reportServerError.mockClear();
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
		const response = await app().request('/api/teapot');
		expect(response.status).toBe(418);
		expect(reportServerError).not.toHaveBeenCalled();
	});

	it('answers a rate limit with its own 429, neither logged nor reported', async () => {
		const response = await app().request('/api/limited');
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({ success: false, error: { type: 'RATE_LIMITED', message: 'Global API rate limit exceeded' } });
		expect(reportServerError).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('answers any other security error with its own status, neither logged nor reported', async () => {
		const response = await app().request('/api/forbidden');
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ success: false, error: { type: 'FORBIDDEN', message: 'Not yours' } });
		expect(reportServerError).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
	});
});
