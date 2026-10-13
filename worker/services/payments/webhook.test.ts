import { describe, expect, it } from 'vitest';
import { parseStripeEvent, verifyStripeSignature } from './webhook';

const SECRET = 'whsec_fake';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
	return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('verifyStripeSignature', () => {
	const now = 1_800_000_000;

	it('accepts a valid signature', async () => {
		const header = `t=${now},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(true);
	});

	it('accepts when one of several v1 signatures matches', async () => {
		const header = `t=${now},v1=${'0'.repeat(64)},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(true);
	});

	it('rejects a wrong secret, a tampered body, an old timestamp and a missing header', async () => {
		const header = `t=${now},v1=${await sign(PAYLOAD, now, 'whsec_other')}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(false);
		const valid = `t=${now},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD.replace('cs_1', 'cs_2'), valid, SECRET, now)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, valid, SECRET, now + 301)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, null, SECRET, now)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, 'garbage', SECRET, now)).toBe(false);
	});
});

describe('parseStripeEvent', () => {
	it('reads the id, type and object of an event', () => {
		expect(parseStripeEvent(PAYLOAD)).toEqual({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
	});

	it('returns null for anything that is not an event', () => {
		expect(parseStripeEvent('not json')).toBeNull();
		expect(parseStripeEvent(JSON.stringify({ id: 'evt_1' }))).toBeNull();
	});
});
