/**
 * What a seller or visitor reads while a shipped feature is paused by its pause flag (shared/types/feature-flags.ts).
 * A pause refuses new work only; work already running finishes, and what exists keeps working.
 */

// By its alias, as the Worker's SecurityError checks import it; under Vitest a relative path loads a second copy that
// `instanceof SecurityError` wouldn't match.
import { SecurityError, SecurityErrorType } from 'shared/types/errors';

export const AI_BUILDS_PAUSED_MESSAGE = 'Building is paused for a few minutes. Your stores keep working.';
/** The editor's WebSocket error code for a refused turn; it shows as a popup. */
export const AI_BUILDS_PAUSED_CODE = 'AI_BUILDS_PAUSED';

export const SIGNUPS_PAUSED_MESSAGE = 'Sign-ups are paused for a moment. Please try again soon.';
/** The `?error=` code a provider sign-in comes back with when it would have created an account. */
export const SIGNUPS_PAUSED_ERROR_CODE = 'signups_paused';

export const STORE_PUBLISHING_PAUSED_MESSAGE = 'Publishing is paused for a few minutes. Your live store keeps working.';
export const CUSTOM_DOMAINS_PAUSED_MESSAGE = 'Connecting a new domain is paused right now. Domains already connected keep working.';
export const TEMPLATE_SALES_PAUSED_MESSAGE = 'Buying paid templates is paused right now. Free templates still work.';
export const BILLING_CHECKOUT_PAUSED_MESSAGE = 'Plan changes and credit purchases are paused for a few minutes. Your current plan keeps working.';

/** A new account refused while sign-ups are paused; existing accounts still sign in. */
export class SignupsPausedError extends SecurityError {
	constructor() {
		super(SecurityErrorType.FORBIDDEN, SIGNUPS_PAUSED_MESSAGE, 503);
		this.name = 'SignupsPausedError';
	}
}
