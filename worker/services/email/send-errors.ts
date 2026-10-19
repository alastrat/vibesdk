/** What a failed Email Service send means for the email: try again later, never to this address, or give up. Pure. */

import { BLOCKED_RECIPIENT_CODE } from './recipient-allowlist';

const RETRY_CODES = new Set(['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_DELIVERY_FAILED', 'E_INTERNAL_SERVER_ERROR']);

export type SendErrorOutcome = 'retry' | 'suppressed' | 'failed';

export function classifySendError(error: unknown): SendErrorOutcome {
	const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
	if (code === 'E_RECIPIENT_SUPPRESSED' || code === BLOCKED_RECIPIENT_CODE) return 'suppressed';
	// No code: a network failure or an outage, which a later attempt may get through.
	if (code === null || RETRY_CODES.has(code)) return 'retry';
	return 'failed';
}
