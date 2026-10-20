import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailSender } from '../email/sender';
import type { OutgoingEmail } from '../email/types';
import { claimAndSendNotice, sendBillingEmails, type BillingMailDeps, type PlannedNotice } from './notices';

const STARTED: PlannedNotice = { key: 'plan_started:sub_1', email: { kind: 'plan_started', plan: 'pro', renewsAt: Date.UTC(2026, 10, 5) } };
const ENDING: PlannedNotice = { key: 'plan_ending:sub_1:1793872800', email: { kind: 'plan_ending', plan: 'pro', endsAt: Date.UTC(2026, 10, 5) } };

function mail(overrides: Partial<BillingMailDeps> = {}): { deps: BillingMailDeps; sent: OutgoingEmail[] } {
	const sent: OutgoingEmail[] = [];
	return { sent, deps: { sender: { send: async (email) => void sent.push(email) }, userEmail: async () => 'ana@example.test', baseUrl: 'https://estori.app', ...overrides } };
}

describe('sending billing emails', () => {
	// Failing sends are logged; the tests below fail them on purpose.
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends each planned notice to the account's email", async () => {
		const { deps, sent } = mail();
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toEqual({ sent: 2, failed: [] });
		expect(sent.map((email) => email.subject)).toEqual(['Welcome to Estori Pro', 'Pro ends on November 5']);
		expect(sent.every((email) => email.to === 'ana@example.test')).toBe(true);
	});

	it('sends nothing without a sender or an address, never throws, and names what failed in a way a resend could get past', async () => {
		expect(await sendBillingEmails(mail({ sender: null }).deps, 'u1', [STARTED])).toEqual({ sent: 0, failed: [] });
		expect(await sendBillingEmails(mail({ userEmail: async () => null }).deps, 'u1', [STARTED])).toEqual({ sent: 0, failed: [] });
		const failing = mail({ sender: { send: async () => { throw new Error('Email Service unavailable'); } } });
		await expect(sendBillingEmails(failing.deps, 'u1', [STARTED, ENDING])).resolves.toEqual({ sent: 0, failed: [STARTED, ENDING] });
		const rejected = mail({ sender: { send: async () => { throw Object.assign(new Error('bad request'), { code: 'E_VALIDATION_ERROR' }); } } });
		await expect(sendBillingEmails(rejected.deps, 'u1', [STARTED])).resolves.toEqual({ sent: 0, failed: [STARTED] });
		const suppressed = mail({ sender: { send: async () => { throw Object.assign(new Error('suppressed'), { code: 'E_RECIPIENT_SUPPRESSED' }); } } });
		await expect(sendBillingEmails(suppressed.deps, 'u1', [STARTED])).resolves.toEqual({ sent: 0, failed: [] });
		const noAddress = mail({ userEmail: async () => { throw new Error('D1 unavailable'); } });
		await expect(sendBillingEmails(noAddress.deps, 'u1', [STARTED])).resolves.toEqual({ sent: 0, failed: [STARTED] });
	});

	it('keeps sending the rest when one email fails', async () => {
		const sent: string[] = [];
		const { deps } = mail({
			sender: {
				send: async (email) => {
					if (email.subject.startsWith('Welcome')) throw new Error('rejected');
					sent.push(email.subject);
				},
			},
		});
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toEqual({ sent: 1, failed: [STARTED] });
		expect(sent).toEqual(['Pro ends on November 5']);
	});

	it("marks staging's subjects and sends only to the allowlist there", async () => {
		const delivered: Array<{ to: string; subject: string }> = [];
		const env = { ENVIRONMENT: 'staging', EMAIL_RECIPIENT_ALLOWLIST: '@pluriza.com', EMAIL: { send: async (message: { to: string; subject: string }) => { delivered.push({ to: message.to, subject: message.subject }); return { messageId: 'm1' }; } } } as unknown as Env;
		const sender = createEmailSender(env);
		expect(await sendBillingEmails({ sender, userEmail: async () => 'team@pluriza.com', baseUrl: null }, 'u1', [STARTED])).toEqual({ sent: 1, failed: [] });
		// Staging refuses addresses off its allowlist on purpose: nothing for anyone to resend.
		expect(await sendBillingEmails({ sender, userEmail: async () => 'ana@example.test', baseUrl: null }, 'u2', [STARTED])).toEqual({ sent: 0, failed: [] });
		expect(delivered).toEqual([{ to: 'team@pluriza.com', subject: '[Staging] Welcome to Estori Pro' }]);
	});

	it('claims a notice before sending it, so it goes once', async () => {
		const claimed = new Set<string>();
		const { deps, sent } = mail();
		const claiming = {
			...deps,
			claim: async (userId: string, key: string) => {
				if (claimed.has(`${userId}:${key}`)) return false;
				claimed.add(`${userId}:${key}`);
				return true;
			},
		};
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('sent');
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('already-sent');
		expect(sent).toHaveLength(1);
	});

	it('leaves a notice unclaimed without a sender, so a later run with one can still send it', async () => {
		const claims: string[] = [];
		const claim = async (_userId: string, key: string) => {
			claims.push(key);
			return true;
		};
		expect(await claimAndSendNotice({ ...mail({ sender: null }).deps, claim }, 'u1', STARTED)).toBe('not-sent');
		expect(claims).toEqual([]);
	});

	it('answers not-sent when a notice is given back or never claimed, claimed when the claim stays, and never throws', async () => {
		const claim = async () => true;
		const release = async () => undefined;
		const failing = mail({ sender: { send: async () => { throw new Error('Email Service unavailable'); } } });
		expect(await claimAndSendNotice({ ...failing.deps, claim, release }, 'u1', STARTED)).toBe('not-sent');
		await expect(claimAndSendNotice({ ...mail().deps, claim: async () => { throw new Error('D1 unavailable'); }, release }, 'u1', STARTED)).resolves.toBe('not-sent');
		// A claim that can't be given back is still held, so the notice won't be tried again.
		await expect(claimAndSendNotice({ ...failing.deps, claim, release: async () => { throw new Error('D1 unavailable'); } }, 'u1', STARTED)).resolves.toBe('claimed');
	});

	describe('when the email does not go out', () => {
		function claims() {
			const held = new Set<string>();
			return {
				held,
				claim: async (userId: string, key: string) => {
					if (held.has(`${userId}:${key}`)) return false;
					held.add(`${userId}:${key}`);
					return true;
				},
				release: async (userId: string, key: string) => void held.delete(`${userId}:${key}`),
			};
		}

		it('gives the claim back after a send that fails, so the next run sends it', async () => {
			const book = claims();
			const sent: OutgoingEmail[] = [];
			let outage = true;
			const { deps } = mail({
				sender: {
					send: async (email) => {
						if (outage) throw new Error('Email Service unavailable');
						sent.push(email);
					},
				},
			});
			const claiming = { ...deps, claim: book.claim, release: book.release };
			expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('not-sent');
			expect(book.held.size).toBe(0);
			outage = false;
			expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('sent');
			expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('already-sent');
			expect(sent).toHaveLength(1);
		});

		it('gives the claim back when the address cannot be looked up', async () => {
			const book = claims();
			const { deps } = mail({ userEmail: async () => { throw new Error('D1 unavailable'); } });
			expect(await claimAndSendNotice({ ...deps, claim: book.claim, release: book.release }, 'u1', ENDING)).toBe('not-sent');
			expect(book.held.size).toBe(0);
		});

		it.each([
			['an address the service suppresses', Object.assign(new Error('suppressed'), { code: 'E_RECIPIENT_SUPPRESSED' })],
			["a recipient staging's allowlist refuses", Object.assign(new Error('blocked'), { code: 'E_STAGING_BLOCKED' })],
			['a request the service rejects', Object.assign(new Error('bad request'), { code: 'E_VALIDATION_ERROR' })],
		])('keeps the claim for %s, since a retry would fail the same way', async (_name, error) => {
			const book = claims();
			const { deps } = mail({ sender: { send: async () => { throw error; } } });
			expect(await claimAndSendNotice({ ...deps, claim: book.claim, release: book.release }, 'u1', ENDING)).toBe('claimed');
			expect(book.held.size).toBe(1);
		});

		it('keeps the claim of an account with no address to send to', async () => {
			const book = claims();
			const { deps } = mail({ userEmail: async () => null });
			expect(await claimAndSendNotice({ ...deps, claim: book.claim, release: book.release }, 'u1', ENDING)).toBe('claimed');
			expect(book.held.size).toBe(1);
		});
	});

	it('claims with the notice kind', async () => {
		const claims: Array<[string, string, string]> = [];
		const { deps } = mail();
		await claimAndSendNotice({ ...deps, claim: async (userId, key, kind) => { claims.push([userId, key, kind]); return true; } }, 'u1', ENDING);
		expect(claims).toEqual([['u1', 'plan_ending:sub_1:1793872800', 'plan_ending']]);
	});
});
