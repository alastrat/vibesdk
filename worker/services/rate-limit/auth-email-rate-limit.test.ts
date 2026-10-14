import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from 'shared/types/errors';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType, type RateLimitSettings } from './config';
import { RateLimitService } from './rateLimits';

const sources = import.meta.glob<string>('/worker/services/rate-limit/rateLimits.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
});

function methodBody(signature: string): string {
	const text = sources['/worker/services/rate-limit/rateLimits.ts'];
	if (text === undefined) throw new Error('rateLimits.ts source not found');
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = text.indexOf('\n\tstatic ', start + signature.length);
	return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe('account email limit', () => {
	it('allows five emails per client or user per hour by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.AUTH_EMAIL]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 5,
			period: 60 * 60,
		});
	});

	it('is keyed as authEmail', () => {
		expect(RateLimitType.AUTH_EMAIL).toBe('authEmail');
	});

	it('builds its key from the universal identifier with the AUTH_EMAIL type', () => {
		const body = methodBody('static async enforceAuthEmailRateLimit(');
		expect(body).toContain('getUniversalIdentifier(user, request)');
		expect(body).toContain('buildRateLimitKey(RateLimitType.AUTH_EMAIL');
		expect(body).toContain("'Please try again in an hour.'");
	});
});

describe('reset email limit per recipient', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('allows three emails per address per hour by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.AUTH_EMAIL_RECIPIENT]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 3,
			period: 60 * 60,
		});
		expect(RateLimitType.AUTH_EMAIL_RECIPIENT).toBe('authEmailRecipient');
	});

	it('keys on a hash of the trimmed, lowercased address and never stores the address', async () => {
		const enforce = vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: true });
		await RateLimitService.enforceAuthEmailRecipientRateLimit({} as Env, DEFAULT_RATE_LIMIT_SETTINGS, 'User@Example.test');
		await RateLimitService.enforceAuthEmailRecipientRateLimit({} as Env, DEFAULT_RATE_LIMIT_SETTINGS, ' user@example.test ');
		await RateLimitService.enforceAuthEmailRecipientRateLimit({} as Env, DEFAULT_RATE_LIMIT_SETTINGS, 'other@example.test');
		const [first, second, third] = enforce.mock.calls.map((call) => call[1]);
		expect(first).toBe(second);
		expect(third).not.toBe(first);
		expect(first).toContain(RateLimitType.AUTH_EMAIL_RECIPIENT);
		expect(first).not.toContain('example');
		expect(enforce.mock.calls.every((call) => call[3] === RateLimitType.AUTH_EMAIL_RECIPIENT)).toBe(true);
	});

	it('throws RateLimitExceededError once the address has had its emails', async () => {
		vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: false });
		const error = await RateLimitService.enforceAuthEmailRecipientRateLimit(
			{} as Env,
			DEFAULT_RATE_LIMIT_SETTINGS,
			'user@example.test',
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RateLimitExceededError);
		expect((error as RateLimitExceededError).limitType).toBe(RateLimitType.AUTH_EMAIL_RECIPIENT);
		expect((error as RateLimitExceededError).limit).toBe(3);
	});

	it('does not count anything when the limit is switched off', async () => {
		const enforce = vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: false });
		const disabled: RateLimitSettings = {
			...DEFAULT_RATE_LIMIT_SETTINGS,
			authEmailRecipient: { enabled: false, store: RateLimitStore.DURABLE_OBJECT, limit: 3, period: 60 * 60 },
		};
		await expect(
			RateLimitService.enforceAuthEmailRecipientRateLimit({} as Env, disabled, 'user@example.test'),
		).resolves.toBeUndefined();
		expect(enforce).not.toHaveBeenCalled();
	});
});

describe('confirmation resend limit per user', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('allows three resends per user per hour by default, in its own bucket', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.EMAIL_CONFIRMATION_RESEND]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 3,
			period: 60 * 60,
		});
		expect(RateLimitType.EMAIL_CONFIRMATION_RESEND).toBe('emailConfirmationResend');
	});

	it('keys on the user id', async () => {
		const enforce = vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: true });
		await RateLimitService.enforceEmailConfirmationResendRateLimit({} as Env, DEFAULT_RATE_LIMIT_SETTINGS, 'user-1');
		await RateLimitService.enforceEmailConfirmationResendRateLimit({} as Env, DEFAULT_RATE_LIMIT_SETTINGS, 'user-2');
		const [first, second] = enforce.mock.calls.map((call) => call[1]);
		expect(first).toBe('platform:emailConfirmationResend:user:user-1');
		expect(second).toBe('platform:emailConfirmationResend:user:user-2');
		expect(enforce.mock.calls.every((call) => call[3] === RateLimitType.EMAIL_CONFIRMATION_RESEND)).toBe(true);
	});

	it('throws RateLimitExceededError once the user has had three resends', async () => {
		vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: false });
		const error = await RateLimitService.enforceEmailConfirmationResendRateLimit(
			{} as Env,
			DEFAULT_RATE_LIMIT_SETTINGS,
			'user-1',
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RateLimitExceededError);
		expect((error as RateLimitExceededError).limitType).toBe(RateLimitType.EMAIL_CONFIRMATION_RESEND);
		expect((error as RateLimitExceededError).limit).toBe(3);
	});

	it('does not count anything when the limit is switched off', async () => {
		const enforce = vi.spyOn(RateLimitService, 'enforce').mockResolvedValue({ success: false });
		const disabled: RateLimitSettings = {
			...DEFAULT_RATE_LIMIT_SETTINGS,
			emailConfirmationResend: { enabled: false, store: RateLimitStore.DURABLE_OBJECT, limit: 3, period: 60 * 60 },
		};
		await expect(
			RateLimitService.enforceEmailConfirmationResendRateLimit({} as Env, disabled, 'user-1'),
		).resolves.toBeUndefined();
		expect(enforce).not.toHaveBeenCalled();
	});
});
