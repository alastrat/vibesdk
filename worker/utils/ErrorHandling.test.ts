import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityError, SecurityErrorType, UsageLimitExceededError } from 'shared/types/errors';
import { setErrorReporter } from '../logger';
import { ControllerErrorHandler, ErrorFactory, ErrorHandler } from './ErrorHandling';

const reportServerError = vi.fn();
setErrorReporter(reportServerError);

describe('what the error handler logs', () => {
	let consoleWarn: ReturnType<typeof vi.spyOn>;
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		reportServerError.mockClear();
		consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('hands on the original error, so its stack reaches error tracking', () => {
		const error = new TypeError('D1 timeout');
		const appError = ErrorHandler.handleError(error, 'publish store', { appId: 'a1' });
		expect(appError.statusCode).toBe(500);
		expect(reportServerError).toHaveBeenCalledWith({ component: 'ErrorHandling', message: 'Error during publish store', error });
	});

	it('keeps the original error when the context has a name or message of its own', () => {
		const error = new TypeError('D1 timeout');
		ErrorHandler.handleError(error, 'publish store', { name: 'Ana', message: 'hello' });
		expect(reportServerError).toHaveBeenCalledWith(expect.objectContaining({ error }));
	});

	it('reports a failure that was not an Error, with the log line as the exception', () => {
		ErrorHandler.handleError('boom', 'publish store');
		expect(reportServerError).toHaveBeenCalledWith({ component: 'ErrorHandling', message: 'Error during publish store', error: undefined });
	});

	it('reports an AppError that is a failure on our side', () => {
		const error = ErrorFactory.externalServiceError('Stripe');
		ErrorHandler.handleError(error, 'charge');
		expect(reportServerError).toHaveBeenCalledWith(expect.objectContaining({ error }));
	});

	it.each([
		['a validation error', () => ErrorFactory.validationError('name is required')],
		['a security error', () => new SecurityError(SecurityErrorType.FORBIDDEN, 'Not yours', 403)],
		['a usage limit', () => new UsageLimitExceededError('Over the limit', [])],
	])('only warns about %s, which refused the request', (_name, makeError) => {
		ErrorHandler.handleError(makeError(), 'publish store');
		expect(reportServerError).not.toHaveBeenCalled();
		expect(consoleWarn).toHaveBeenCalledTimes(1);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('only warns about a request body that is not JSON', async () => {
		const failure = await ControllerErrorHandler.parseJsonBody(new Request('https://estori.app/api/x', { method: 'POST', body: '{' })).catch((error: unknown) => error);
		expect(ErrorHandler.handleError(failure, 'read the request').statusCode).toBe(400);
		expect(reportServerError).not.toHaveBeenCalled();
	});

	it('reports an external service failure with the original error', () => {
		const error = new Error('supplier down');
		expect(() => ControllerErrorHandler.handleExternalServiceError('CJ', error, { orderId: 'o1' })).toThrow('External service CJ unavailable');
		expect(reportServerError).toHaveBeenCalledWith({ component: 'ErrorHandling', message: 'External service error: CJ', error });
	});
});
