import { describe, expect, it } from 'vitest';
import type { OutgoingEmail } from '../../../services/email/types';
import type { ContactRequestInput } from '../../../../shared/types/contact';
import { submitContact, type ContactSubmissionDeps } from './submitContact';

const BODY = {
	firstName: 'Ana',
	lastName: 'Ruiz',
	email: 'ana@example.com',
	company: 'North Ridge Coffee',
	companySize: '2–10',
	topic: 'enterprise',
	message: 'We run 30 stores.',
	premiumCredits: null,
	website: '',
};

function fakeDeps(overrides: Partial<ContactSubmissionDeps> = {}) {
	const stored: ContactRequestInput[] = [];
	const sent: OutgoingEmail[] = [];
	const logged: string[] = [];
	const deps: ContactSubmissionDeps = {
		isLimited: async () => false,
		store: async (input) => {
			stored.push(input);
		},
		send: async (email) => {
			sent.push(email);
		},
		teamInbox: null,
		log: (message) => {
			logged.push(message);
		},
		...overrides,
	};
	return { deps, stored, sent, logged };
}

describe('submitContact', () => {
	it('stores the request and emails the sender that we will be in touch', async () => {
		const { deps, stored, sent } = fakeDeps();
		expect(await submitContact(BODY, deps)).toEqual({ status: 'received' });
		expect(stored).toHaveLength(1);
		expect(stored[0].email).toBe('ana@example.com');
		expect(sent.map((email) => email.to)).toEqual(['ana@example.com']);
		expect(sent[0].text).toContain("We'll be in touch");
	});

	it('also tells the team when an inbox is set', async () => {
		const { deps, sent } = fakeDeps({ teamInbox: 'sales@estori.app' });
		await submitContact(BODY, deps);
		expect(sent.map((email) => email.to)).toEqual(['ana@example.com', 'sales@estori.app']);
		expect(sent[1].text).toContain('North Ridge Coffee');
	});

	it('answers a filled honeypot as if received, without storing or sending anything', async () => {
		const { deps, stored, sent } = fakeDeps();
		expect(await submitContact({ ...BODY, website: 'https://spam.example' }, deps)).toEqual({ status: 'received' });
		expect(stored).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});

	it('returns the first problem without touching the limit, the store or the inbox', async () => {
		let checked = false;
		const { deps, stored, sent } = fakeDeps({
			isLimited: async () => {
				checked = true;
				return false;
			},
		});
		expect(await submitContact({ ...BODY, email: 'nope' }, deps)).toEqual({ status: 'invalid', error: 'Enter a valid work email' });
		expect(checked).toBe(false);
		expect(stored).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});

	it('stops a client over the limit before anything is stored', async () => {
		const { deps, stored, sent } = fakeDeps({ isLimited: async () => true });
		expect(await submitContact(BODY, deps)).toEqual({ status: 'limited' });
		expect(stored).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});

	it('keeps the request when an email fails, and logs it', async () => {
		const { deps, stored, logged } = fakeDeps({
			teamInbox: 'sales@estori.app',
			send: async () => {
				throw new Error('mail down');
			},
		});
		expect(await submitContact(BODY, deps)).toEqual({ status: 'received' });
		expect(stored).toHaveLength(1);
		expect(logged).toEqual(["Couldn't send the contact confirmation", "Couldn't send the contact notification"]);
	});
});
