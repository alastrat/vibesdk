import { LEGAL_CONTACT } from './legal';
import { msg } from '../i18n/translate';

/** What a contact-sales request can be about; the API accepts only these ids. */
export const CONTACT_TOPICS = [
	{ id: 'enterprise', label: msg('the Enterprise plan') },
	{ id: 'pro', label: msg('the Pro plan') },
	{ id: 'premium', label: msg('the Premium plan') },
	{ id: 'partnership', label: msg('a partnership') },
	{ id: 'other', label: msg('something else') },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]['id'];

export const COMPANY_SIZES = ['Just me', '2–10', '11–50', '51–200', '201–1,000', 'More than 1,000'] as const;

export type CompanySize = (typeof COMPANY_SIZES)[number];

/** What the form shows when the API turns a request away, with an address that always works. */
export const CONTACT_LIMITED_MESSAGE = `Too many requests. Please try again in an hour, or email ${LEGAL_CONTACT.support}.`;
export const CONTACT_FAILED_MESSAGE = `Couldn't send your message. Please try again, or email ${LEGAL_CONTACT.support}.`;

/** Longest values the form and the API accept. */
export const CONTACT_FIELD_LIMITS = { name: 80, email: 254, company: 120, message: 2_000 } as const;

export function isContactTopic(value: unknown): value is ContactTopic {
	return typeof value === 'string' && CONTACT_TOPICS.some((topic) => topic.id === value);
}

/** The most AI credits a month a Premium request can name; anything past it is a typo or a probe. */
export const MAX_PREMIUM_CREDITS = 10_000_000;

/** The credits a month a Premium request can carry: a whole number from 1 to MAX_PREMIUM_CREDITS. */
export function isPremiumCredits(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PREMIUM_CREDITS;
}

export function isCompanySize(value: unknown): value is CompanySize {
	return typeof value === 'string' && (COMPANY_SIZES as readonly string[]).includes(value);
}

/** "the Premium plan", for sentences like "your message about the Premium plan". */
export function contactTopicLabel(topic: ContactTopic): string {
	return CONTACT_TOPICS.find((entry) => entry.id === topic)?.label ?? 'something else';
}

/** The form as sent; `website` is a field people never see, so only bots fill it in. */
export interface ContactRequestBody {
	firstName: string;
	lastName: string;
	email: string;
	company: string;
	companySize: CompanySize;
	topic: ContactTopic;
	message: string;
	/** The AI credits a month the visitor needs, from the pricing calculator, if any. */
	premiumCredits: number | null;
	website: string;
}

/** A request after validation, as it's stored and emailed. */
export interface ContactRequestInput {
	firstName: string;
	lastName: string;
	email: string;
	company: string;
	companySize: CompanySize;
	topic: ContactTopic;
	message: string | null;
	premiumCredits: number | null;
}
