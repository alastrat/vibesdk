import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, setErrorReporter } from './core';

/** The frontend's type check reaches the logger, so it must import nothing that only the Worker can resolve. */
const sources = import.meta.glob<string>(['/worker/logger/core.ts'], { query: '?raw', import: 'default', eager: true });

const reportServerError = vi.fn();
setErrorReporter(reportServerError);

describe('the logger and its error reporter', () => {
	beforeEach(() => {
		reportServerError.mockClear();
		for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reports each error with its component, message and error', () => {
		const error = new TypeError('kaput');
		createLogger('AuthController').error('Registration error', error, { userId: 'u1' });
		expect(reportServerError).toHaveBeenCalledWith({ component: 'AuthController', message: 'Registration error', error });
	});

	it("takes the error from the data's error field, as most calls log it", () => {
		const error = new Error('D1 timeout');
		createLogger('StripeWebhook').error('Stripe webhook handling failed', { type: 'charge.updated', id: 'evt_1', error });
		expect(reportServerError).toHaveBeenCalledWith({ component: 'StripeWebhook', message: 'Stripe webhook handling failed', error });
	});

	it('reports an error logged without one', () => {
		createLogger('StripeWebhook').error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set');
		expect(reportServerError).toHaveBeenCalledWith({ component: 'StripeWebhook', message: 'Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set', error: undefined });
	});

	it('logs an error without a reporter registered', async () => {
		vi.resetModules();
		const fresh = await import('./core');
		expect(() => fresh.createLogger('Alone').error('nobody listening', new Error('kaput'))).not.toThrow();
		expect(reportServerError).not.toHaveBeenCalled();
	});

	it('imports nothing Worker-only, so the frontend can type-check it', () => {
		const text = sources['/worker/logger/core.ts'] ?? '';
		expect(text).not.toBe('');
		expect(text).not.toMatch(/from '[^']*(services|cloudflare:)/);
	});

	it('reports nothing for warnings and info', () => {
		createLogger('Quiet').warn('slow');
		createLogger('Quiet').info('fine');
		expect(reportServerError).not.toHaveBeenCalled();
	});
});
