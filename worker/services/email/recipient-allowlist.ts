/** Who a deployment may email. Staging sets EMAIL_RECIPIENT_ALLOWLIST so its emails reach only the team. Pure. */

/** The error code of a send the allowlist blocked; the outbox treats it as final and alerts no one. */
export const BLOCKED_RECIPIENT_CODE = 'E_STAGING_BLOCKED';

/** Comma-separated whole addresses (`ana@example.com`) and domains (`@pluriza.com`); null allows everyone. */
export function recipientAllowlist(value: string | undefined): ((recipient: string) => boolean) | null {
	const entries = (value ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	if (entries.length === 0) return null;
	const domains = new Set(entries.filter((entry) => entry.startsWith('@')));
	const addresses = new Set(entries.filter((entry) => !entry.startsWith('@')));
	return (recipient) => {
		const address = recipient.trim().toLowerCase();
		return addresses.has(address) || domains.has(address.slice(address.lastIndexOf('@')));
	};
}

export function blockedRecipientError(): Error & { code: string } {
	return Object.assign(new Error('Email not sent: the recipient is not on this deployment\'s allowlist'), { code: BLOCKED_RECIPIENT_CODE });
}
