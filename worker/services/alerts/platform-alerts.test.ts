import { describe, expect, it } from 'vitest';
import { ALERT_THROTTLE_SECONDS, PLATFORM_ALERT_EMAILS, platformAlertsFromEnv, sendPlatformAlert, type PlatformAlert, type PlatformAlertDeps } from './platform-alerts';
import { PLATFORM_ADMIN_EMAILS } from '../auth/admin-access';
import type { OutgoingEmail } from '../email/types';

function fakeDeps(overrides: Partial<PlatformAlertDeps> = {}) {
	const kv = new Map<string, { value: string; ttl: number }>();
	const sent: OutgoingEmail[] = [];
	const logged: PlatformAlert[] = [];
	const deps: PlatformAlertDeps = {
		throttle: {
			get: async (key) => kv.get(key)?.value ?? null,
			put: async (key, value, options) => void kv.set(key, { value, ttl: options.expirationTtl }),
		},
		sender: { send: async (email) => void sent.push(email) },
		recipients: ['ops@example.test', 'owner@example.test'],
		log: (alert) => void logged.push(alert),
		...overrides,
	};
	return { deps, kv, sent, logged };
}

const ALERT: PlatformAlert = { kind: 'needs-attention', subject: 'co_1', message: 'Placement failed 6 times' };

describe('sendPlatformAlert', () => {
	it('emails every recipient and remembers the kind and subject for a day', async () => {
		const { deps, kv, sent, logged } = fakeDeps();
		expect(await sendPlatformAlert(deps, ALERT)).toBe('sent');
		expect(sent.map((email) => email.to)).toEqual(['ops@example.test', 'owner@example.test']);
		expect(sent[0].subject).toContain('co_1');
		expect(kv.get('alert:needs-attention:co_1')?.ttl).toBe(ALERT_THROTTLE_SECONDS);
		expect(logged).toEqual([ALERT]);
	});

	it('sends the same kind and subject once a day, whatever the message, and other subjects at once', async () => {
		const { deps, sent, logged } = fakeDeps();
		await sendPlatformAlert(deps, ALERT);
		expect(await sendPlatformAlert(deps, { ...ALERT, message: 'Placement failed 7 times' })).toBe('throttled');
		expect(await sendPlatformAlert(deps, { ...ALERT, subject: 'co_2' })).toBe('sent');
		expect(sent).toHaveLength(4);
		expect(logged).toHaveLength(3);
	});

	it('logs, sends nothing and throttles nothing without an email sender', async () => {
		const { deps, kv, logged } = fakeDeps({ sender: null });
		expect(await sendPlatformAlert(deps, ALERT)).toBe('not-sent');
		expect(logged).toHaveLength(1);
		expect(kv.size).toBe(0);
	});

	it('has its own recipients, apart from the admin list', () => {
		expect(PLATFORM_ALERT_EMAILS).toEqual(['alastrat@pluriza.com']);
		expect(PLATFORM_ALERT_EMAILS).not.toBe(PLATFORM_ADMIN_EMAILS);
	});

	it('lets a daily job alert again the next day, even when it runs a little earlier, and not twice the same day', async () => {
		let now = 0;
		const markers = new Map<string, number>();
		const sent: OutgoingEmail[] = [];
		const deps: PlatformAlertDeps = {
			throttle: {
				get: async (key) => ((markers.get(key) ?? 0) > now ? '1' : null),
				put: async (key, _value, options) => void markers.set(key, now + options.expirationTtl * 1000),
			},
			sender: { send: async (email) => void sent.push(email) },
			recipients: ['ops@example.test'],
			log: () => undefined,
		};
		expect(await sendPlatformAlert(deps, ALERT)).toBe('sent');
		now += 24 * 60 * 60 * 1000 - 60_000;
		expect(await sendPlatformAlert(deps, ALERT)).toBe('sent');
		now += 60 * 60 * 1000;
		expect(await sendPlatformAlert(deps, ALERT)).toBe('throttled');
	});
});

describe('platformAlertsFromEnv', () => {
	it("never throws when the alert email can't be sent, so the work that raised it carries on", async () => {
		const sends: string[] = [];
		const env = {
			EMAIL: { send: async (message: { to: string }) => (sends.push(message.to), Promise.reject(new Error('Email Service is down'))) },
			VibecoderStore: { get: async () => null, put: async () => undefined },
		} as unknown as Env;
		await expect(platformAlertsFromEnv(env)({ kind: 'not-shipped', subject: 'co_1', message: 'An item has no tracking yet.' })).resolves.toBeUndefined();
		expect(sends.length).toBeGreaterThan(0);
	});
});

