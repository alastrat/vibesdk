import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reportServerError } = vi.hoisted(() => ({ reportServerError: vi.fn() }));
vi.mock('../services/posthog/server-errors', () => ({ reportServerError }));

const { createLogger } = await import('./core');

describe('the logger and PostHog', () => {
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

	it('reports nothing for warnings and info', () => {
		createLogger('Quiet').warn('slow');
		createLogger('Quiet').info('fine');
		expect(reportServerError).not.toHaveBeenCalled();
	});
});
