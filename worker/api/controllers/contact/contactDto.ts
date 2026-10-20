import { CONTACT_FIELD_LIMITS, isCompanySize, isContactTopic, isPremiumCredits, type ContactRequestInput } from '../../../../shared/types/contact';
import type { ContactRequestRow } from '../../../database/services/ContactService';
import { validateEmail } from '../../../utils/validationUtils';
import type { ContactAdminData } from './types';

export type ParsedContactRequest = { ok: true; value: ContactRequestInput } | { ok: false; error: string };

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

function text(body: unknown, key: string): string {
	const value = field(body, key);
	return typeof value === 'string' ? value.trim() : '';
}

/** Tabs and line breaks: the only control characters a message may use. */
const MESSAGE_WHITESPACE: readonly string[] = ['\t', '\n', '\r'];

/** True when the text holds a control character, which could break an email subject, other than those `allowed`. */
function hasControlCharacters(value: string, allowed: readonly string[] = []): boolean {
	for (const char of value) {
		const code = char.charCodeAt(0);
		if ((code < 0x20 || code === 0x7f) && !allowed.includes(char)) return true;
	}
	return false;
}

function premiumCredits(body: unknown): number | null {
	const value = field(body, 'premiumCredits');
	return isPremiumCredits(value) ? value : null;
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
	if (firstName.length > CONTACT_FIELD_LIMITS.name || lastName.length > CONTACT_FIELD_LIMITS.name) {
		return { ok: false, error: `Keep names under ${CONTACT_FIELD_LIMITS.name} characters` };
	}
	if (hasControlCharacters(firstName) || hasControlCharacters(lastName)) return { ok: false, error: 'Use plain text in your name' };
	if (!email || email.length > CONTACT_FIELD_LIMITS.email || !validateEmail(email).valid) return { ok: false, error: 'Enter a valid work email' };
	if (!company) return { ok: false, error: 'Enter your company' };
	if (company.length > CONTACT_FIELD_LIMITS.company) {
		return { ok: false, error: `Keep the company name under ${CONTACT_FIELD_LIMITS.company} characters` };
	}
	if (hasControlCharacters(company)) return { ok: false, error: 'Use plain text in the company name' };
	if (!isCompanySize(companySize)) return { ok: false, error: 'Choose your company size' };
	if (!isContactTopic(topic)) return { ok: false, error: 'Choose what this is about' };
	if (message.length > CONTACT_FIELD_LIMITS.message) {
		return { ok: false, error: `Keep the message under ${CONTACT_FIELD_LIMITS.message.toLocaleString('en-US')} characters` };
	}
	if (hasControlCharacters(message, MESSAGE_WHITESPACE)) return { ok: false, error: 'Use plain text in the message' };

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
