import { describe, expect, it } from 'vitest';
import { sendSellerNotice, type SellerNoticeDeps } from './seller-notices';
import type { OutgoingEmail } from '../email/types';

function fakeDeps(email: string | null = 'seller@example.test') {
	const kv = new Map<string, string>();
	const sent: OutgoingEmail[] = [];
	const deps: SellerNoticeDeps = {
		throttle: { get: async (key) => kv.get(key) ?? null, put: async (key, value) => void kv.set(key, value) },
		sender: { send: async (message) => void sent.push(message) },
		sellerEmail: async () => email,
	};
	return { deps, kv, sent };
}

describe('sendSellerNotice', () => {
	it("tells the seller their store hit its weekly cap, once a day", async () => {
		const { deps, sent } = fakeDeps();
		const notice = { sellerUserId: 'u1', kind: 'limit-reached' as const, weeklySalesCents: 50_000 };
		expect(await sendSellerNotice(deps, notice)).toBe('sent');
		expect(await sendSellerNotice(deps, notice)).toBe('throttled');
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('seller@example.test');
		expect(sent[0].text).toContain('$500.00');
	});

	it("tells the seller a connected domain's DNS records went, once a day per domain", async () => {
		const { deps, sent } = fakeDeps();
		const notice = { sellerUserId: 'u1', kind: 'domain-unreachable' as const, hostname: 'shop.northwindtea.com' };
		expect(await sendSellerNotice(deps, notice)).toBe('sent');
		expect(await sendSellerNotice(deps, notice)).toBe('throttled');
		expect(await sendSellerNotice(deps, { ...notice, hostname: 'www.lumenhome.com' })).toBe('sent');
		expect(sent[0].subject).toBe('Check the DNS records for shop.northwindtea.com');
		expect(sent[0].text).toContain("We can't see the DNS records that point shop.northwindtea.com to your store.");
		expect(sent[0].text).toContain('choose Go live');
	});

	it('sends nothing when the seller has no email', async () => {
		const { deps, sent } = fakeDeps(null);
		expect(await sendSellerNotice(deps, { sellerUserId: 'u1', kind: 'limit-reached', weeklySalesCents: 50_000 })).toBe('not-sent');
		expect(sent).toHaveLength(0);
	});
});
