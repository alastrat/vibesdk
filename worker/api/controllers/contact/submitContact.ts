import type { ContactRequestInput } from '../../../../shared/types/contact';
import type { OutgoingEmail } from '../../../services/email/types';
import { contactNotificationEmail, contactReceivedEmail } from '../../../services/email/templates';
import { isHoneypotFilled, parseContactRequest } from './contactDto';

/** What a submission needs from the outside world, so its order of steps can be tested on its own. */
export interface ContactSubmissionDeps {
	/** True when this client has sent too many requests lately. */
	isLimited(): Promise<boolean>;
	/** False when this address has been sent enough confirmations lately; the request is still stored. */
	canConfirm(email: string): Promise<boolean>;
	store(input: ContactRequestInput): Promise<void>;
	send(email: OutgoingEmail): Promise<void>;
	/** Where the team hears about new requests; null skips that notice. */
	teamInbox: string | null;
	log(message: string, error?: unknown): void;
}

export type ContactSubmissionResult =
	| { status: 'received'; confirmationSent: boolean }
	| { status: 'invalid'; error: string }
	| { status: 'limited' };

/**
 * Validates, limits, stores, then emails. A bot that fills the hidden field gets the same answer as a person, with
 * nothing stored or sent. Once stored, a request counts as received even if an email fails: the team can still read it.
 */
export async function submitContact(body: unknown, deps: ContactSubmissionDeps): Promise<ContactSubmissionResult> {
	if (isHoneypotFilled(body)) return { status: 'received', confirmationSent: true };
	const parsed = parseContactRequest(body);
	if (!parsed.ok) return { status: 'invalid', error: parsed.error };
	if (await deps.isLimited()) return { status: 'limited' };

	await deps.store(parsed.value);
	let confirmationSent = false;
	try {
		if (await deps.canConfirm(parsed.value.email)) {
			await deps.send(contactReceivedEmail(parsed.value));
			confirmationSent = true;
		}
	} catch (error) {
		deps.log("Couldn't send the contact confirmation", error);
	}
	if (deps.teamInbox) {
		try {
			await deps.send(contactNotificationEmail(deps.teamInbox, parsed.value));
		} catch (error) {
			deps.log("Couldn't send the contact notification", error);
		}
	}
	return { status: 'received', confirmationSent };
}
