import { describe, expect, it } from 'vitest';
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
	it("sends each planned notice to the account's email", async () => {
		const { deps, sent } = mail();
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toBe(2);
		expect(sent.map((email) => email.subject)).toEqual(['Welcome to Estori Pro', 'Pro ends on November 5']);
		expect(sent.every((email) => email.to === 'ana@example.test')).toBe(true);
	});

	it('sends nothing without a sender or an address, and never throws', async () => {
		expect(await sendBillingEmails(mail({ sender: null }).deps, 'u1', [STARTED])).toBe(0);
		expect(await sendBillingEmails(mail({ userEmail: async () => null }).deps, 'u1', [STARTED])).toBe(0);
		const failing = mail({ sender: { send: async () => { throw new Error('Email Service unavailable'); } } });
		await expect(sendBillingEmails(failing.deps, 'u1', [STARTED, ENDING])).resolves.toBe(0);
		const noAddress = mail({ userEmail: async () => { throw new Error('D1 unavailable'); } });
		await expect(sendBillingEmails(noAddress.deps, 'u1', [STARTED])).resolves.toBe(0);
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
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toBe(1);
		expect(sent).toEqual(['Pro ends on November 5']);
	});

	it("marks staging's subjects and sends only to the allowlist there", async () => {
		const delivered: Array<{ to: string; subject: string }> = [];
		const env = { ENVIRONMENT: 'staging', EMAIL_RECIPIENT_ALLOWLIST: '@pluriza.com', EMAIL: { send: async (message: { to: string; subject: string }) => { delivered.push({ to: message.to, subject: message.subject }); return { messageId: 'm1' }; } } } as unknown as Env;
		const sender = createEmailSender(env);
		expect(await sendBillingEmails({ sender, userEmail: async () => 'team@pluriza.com', baseUrl: null }, 'u1', [STARTED])).toBe(1);
		expect(await sendBillingEmails({ sender, userEmail: async () => 'ana@example.test', baseUrl: null }, 'u2', [STARTED])).toBe(0);
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

	it('answers not-sent when a claimed notice cannot go out, and never throws', async () => {
		const claim = async () => true;
		const failing = mail({ sender: { send: async () => { throw new Error('Email Service unavailable'); } } });
		expect(await claimAndSendNotice({ ...failing.deps, claim }, 'u1', STARTED)).toBe('not-sent');
		await expect(claimAndSendNotice({ ...mail().deps, claim: async () => { throw new Error('D1 unavailable'); } }, 'u1', STARTED)).resolves.toBe('not-sent');
	});

	it('claims with the notice kind', async () => {
		const claims: Array<[string, string, string]> = [];
		const { deps } = mail();
		await claimAndSendNotice({ ...deps, claim: async (userId, key, kind) => { claims.push([userId, key, kind]); return true; } }, 'u1', ENDING);
		expect(claims).toEqual([['u1', 'plan_ending:sub_1:1793872800', 'plan_ending']]);
	});
});
