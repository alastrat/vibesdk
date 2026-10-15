import { CONTACT_FIELD_LIMITS, isCompanySize, isContactTopic, type ContactRequestInput } from '../../../../shared/types/contact';
import type { ContactRequestRow } from '../../../database/services/ContactService';
import { validateEmail } from '../../../utils/validationUtils';
import type { ContactAdminData } from './types';

export type ParsedContactRequest = { ok: true; value: ContactRequestInput } | { ok: false; error: string };

/** The largest Premium pool a request can name; anything past it is a typo or a probe. */
const MAX_PREMIUM_CREDITS = 10_000_000;

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

function text(body: unknown, key: string): string {
	const value = field(body, key);
	return typeof value === 'string' ? value.trim() : '';
}

function premiumCredits(body: unknown): number | null {
	const value = field(body, 'premiumCredits');
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PREMIUM_CREDITS ? value : null;
}

/** Checks the form field by field and names the first one to fix, in the order the form shows them. */
export function parseContactRequest(body: unknown): ParsedContactRequest {
	const firstName = text(body, 'firstName');
	const lastName = text(body, 'lastName');
	const email = text(body, 'email').toLowerCase();
	const company = text(body, 'company');
	const companySize = field(body, 'companySize');
	const topic = field(body, 'topic');
	const message = text(body, 'message');

	if (!firstName) return { ok: false, error: 'Enter your first name' };
	if (!lastName) return { ok: false, error: 'Enter your last name' };
	if (firstName.length > CONTACT_FIELD_LIMITS.name || lastName.length > CONTACT_FIELD_LIMITS.name) return { ok: false, error: 'Keep names under 80 characters' };
	if (!email || email.length > CONTACT_FIELD_LIMITS.email || !validateEmail(email).valid) return { ok: false, error: 'Enter a valid work email' };
	if (!company) return { ok: false, error: 'Enter your company' };
	if (company.length > CONTACT_FIELD_LIMITS.company) return { ok: false, error: 'Keep the company name under 120 characters' };
	if (!isCompanySize(companySize)) return { ok: false, error: 'Choose your company size' };
	if (!isContactTopic(topic)) return { ok: false, error: 'Choose what this is about' };
	if (message.length > CONTACT_FIELD_LIMITS.message) return { ok: false, error: 'Keep the message under 2,000 characters' };

	return {
		ok: true,
		value: {
			firstName,
			lastName,
			email,
			company,
			companySize,
			topic,
			message: message || null,
			premiumCredits: topic === 'premium' ? premiumCredits(body) : null,
		},
	};
}

/** True when the hidden `website` field holds anything: people never see it, so only bots fill it in. */
export function isHoneypotFilled(body: unknown): boolean {
	const value = field(body, 'website');
	return typeof value === 'string' && value.trim().length > 0;
}

export function toContactAdminData(rows: readonly ContactRequestRow[]): ContactAdminData {
	return {
		requests: rows.map((row) => ({
			id: row.id,
			name: `${row.firstName} ${row.lastName}`,
			email: row.email,
			company: row.company,
			companySize: row.companySize,
			topic: row.topic,
			message: row.message,
			premiumCredits: row.premiumCredits,
			receivedAt: row.createdAt.toISOString(),
		})),
	};
}
