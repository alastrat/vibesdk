/** Email addresses never reach PostHog: the Worker's error reports and the browser's events both pass through this. */

/** Bounded runs, so reading a long text without an address stays linear. */
const EMAIL = /[^\s@<>()"',;:]{1,64}@[^\s@<>()"',;:]{1,255}\.[a-z]{2,}/gi;
const ENCODED_AT = /%40/gi;

export function scrubEmails(text: string): string {
	// An address in a URL is encoded, so its @ is decoded first, which keeps the scrubbing to one linear pattern.
	return text.replace(ENCODED_AT, '@').replace(EMAIL, '[email]');
}
