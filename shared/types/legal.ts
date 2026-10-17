/** Who runs Estori, how to reach them, and which terms version users agree to. */

export const TERMS_VERSION = '2026-10-16';

export const TERMS_REQUIRED_MESSAGE = 'Agree to the Terms of Service and Privacy Policy to create an account';
export const TERMS_OUTDATED_MESSAGE = 'The terms were updated; reload the page to agree to the latest version';

export const LEGAL_ENTITY = {
	name: 'Globalink Commerce Technologies LLC',
	kind: 'a Texas limited liability company',
	street: '206 Gray Street, Unit 3112',
	city: 'Houston',
	state: 'TX',
	zip: '77002',
} as const;

export const LEGAL_CONTACT = {
	support: 'support@estori.app',
	privacy: 'privacy@estori.app',
	copyright: 'copyright@estori.app',
} as const;

export function legalAddressLine(): string {
	return `${LEGAL_ENTITY.street}, ${LEGAL_ENTITY.city}, ${LEGAL_ENTITY.state} ${LEGAL_ENTITY.zip}`;
}

export function isCurrentTermsVersion(version: unknown): boolean {
	return version === TERMS_VERSION;
}
