import { describe, expect, it } from 'vitest';
import { classifySendError } from './send-errors';

const coded = (code: string) => Object.assign(new Error(code), { code });

describe('a failed send', () => {
	it('waits and retries when Cloudflare defers it or fails on its side', () => {
		for (const code of ['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_DELIVERY_FAILED', 'E_INTERNAL_SERVER_ERROR']) expect(classifySendError(coded(code)), code).toBe('retry');
		expect(classifySendError(new Error('network connection lost'))).toBe('retry');
	});

	it('stops for a suppressed address, and gives up on what a retry cannot fix', () => {
		expect(classifySendError(coded('E_RECIPIENT_SUPPRESSED'))).toBe('suppressed');
		for (const code of ['E_VALIDATION_ERROR', 'E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_HEADER_NOT_ALLOWED']) expect(classifySendError(coded(code)), code).toBe('failed');
	});
});
