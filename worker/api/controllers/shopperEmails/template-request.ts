import { msg } from '../../../../shared/i18n/translate';
/** A seller's shopper email template and reply-to setting as the API takes them. Pure. */

import type { ShopperEmailKind, ShopperEmailTemplate, ShopperEmailTemplateFields } from '../../../../shared/types/shopper-emails';
import { templateProblem } from '../../../services/shopper-emails/template';
import { validateEmail } from '../../../utils/validationUtils';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const FIELDS_MESSAGE = msg('Send a subject, a heading and a message');

/** The subject, heading and message of a template, checked as saving checks them. */
export function parseTemplateFields(kind: ShopperEmailKind, body: unknown): Parsed<ShopperEmailTemplateFields> {
	if (!body || typeof body !== 'object') return { ok: false, message: FIELDS_MESSAGE };
	const { subject, heading, body: message } = body as Record<string, unknown>;
	if (typeof subject !== 'string' || typeof heading !== 'string' || typeof message !== 'string') return { ok: false, message: FIELDS_MESSAGE };
	const fields = { subject: subject.trim(), heading: heading.trim(), body: message.trimEnd() };
	const problem = templateProblem(kind, fields);
	return problem ? { ok: false, message: problem } : { ok: true, value: fields };
}

export function parseTemplateRequest(kind: ShopperEmailKind, body: unknown): Parsed<ShopperEmailTemplate> {
	const enabled = body && typeof body === 'object' ? (body as Record<string, unknown>).enabled : undefined;
	if (typeof enabled !== 'boolean') return { ok: false, message: msg('Send whether the email is on, a subject, a heading and a message') };
	const fields = parseTemplateFields(kind, body);
	return fields.ok ? { ok: true, value: { enabled, ...fields.value } } : fields;
}

/** One email address, or null for the seller's account email. */
export function parseReplyTo(body: unknown): Parsed<string | null> {
	const replyTo = body && typeof body === 'object' ? (body as Record<string, unknown>).replyTo : undefined;
	if (replyTo === null) return { ok: true, value: null };
	if (typeof replyTo !== 'string') return { ok: false, message: msg('Send replyTo: an email address, or null') };
	const address = replyTo.trim();
	if (!address) return { ok: true, value: null };
	return validateEmail(address).valid ? { ok: true, value: address } : { ok: false, message: msg('Enter one email address, such as help@yourstore.com') };
}
