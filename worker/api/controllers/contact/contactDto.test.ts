import { describe, expect, it } from 'vitest';
import { isHoneypotFilled, parseContactRequest, toContactAdminData } from './contactDto';

const VALID = {
	firstName: '  Ana ',
	lastName: 'Ruiz',
	email: ' Ana@Example.com ',
	company: 'North Ridge Coffee',
	companySize: '2–10',
	topic: 'enterprise',
	message: '  We run 30 stores.  ',
	premiumCredits: null,
	website: '',
};

describe('parseContactRequest', () => {
	it('accepts a complete request, trimmed, with the email lowercased', () => {
		expect(parseContactRequest(VALID)).toEqual({
			ok: true,
			value: {
				firstName: 'Ana',
				lastName: 'Ruiz',
				email: 'ana@example.com',
				company: 'North Ridge Coffee',
				companySize: '2–10',
				topic: 'enterprise',
				message: 'We run 30 stores.',
				premiumCredits: null,
			},
		});
	});

	it('treats an empty message as none', () => {
		const parsed = parseContactRequest({ ...VALID, message: '   ' });
		expect(parsed.ok && parsed.value.message).toBeNull();
		const missing = parseContactRequest({ ...VALID, message: undefined });
		expect(missing.ok && missing.value.message).toBeNull();
	});

	it('keeps the chosen Premium credits only for Premium requests', () => {
		const premium = parseContactRequest({ ...VALID, topic: 'premium', premiumCredits: 50_000 });
		expect(premium.ok && premium.value.premiumCredits).toBe(50_000);
		const other = parseContactRequest({ ...VALID, topic: 'enterprise', premiumCredits: 50_000 });
		expect(other.ok && other.value.premiumCredits).toBeNull();
		for (const premiumCredits of [-5, 1.5, '50000', 100_000_000]) {
			const odd = parseContactRequest({ ...VALID, topic: 'premium', premiumCredits });
			expect(odd.ok && odd.value.premiumCredits, String(premiumCredits)).toBeNull();
		}
	});

	it('names the first field that needs fixing', () => {
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ firstName: ' ' }, 'Enter your first name'],
			[{ lastName: '' }, 'Enter your last name'],
			[{ email: 'not-an-email' }, 'Enter a valid work email'],
			[{ company: '' }, 'Enter your company'],
			[{ companySize: 'Huge' }, 'Choose your company size'],
			[{ topic: 'jobs' }, 'Choose what this is about'],
			[{ firstName: 'A'.repeat(81) }, 'Keep names under 80 characters'],
			[{ company: 'C'.repeat(121) }, 'Keep the company name under 120 characters'],
			[{ message: 'M'.repeat(2_001) }, 'Keep the message under 2,000 characters'],
			[{ firstName: 7 }, 'Enter your first name'],
			[{ firstName: 'Ana\nBcc: x@y.z' }, 'Use plain text in your name'],
			[{ lastName: 'Ruiz\u0000' }, 'Use plain text in your name'],
			[{ company: 'Acme\r\nBcc: x@y.z' }, 'Use plain text in the company name'],
			[{ company: 'Acme\tCo' }, 'Use plain text in the company name'],
			[{ message: 'Hello\u0007' }, 'Use plain text in the message'],
		];
		for (const [change, error] of cases) expect(parseContactRequest({ ...VALID, ...change }), error).toEqual({ ok: false, error });
	});

	it('lets the message run over several lines', () => {
		const parsed = parseContactRequest({ ...VALID, message: 'We run 30 stores.\r\n\tCan you help?' });
		expect(parsed.ok && parsed.value.message).toBe('We run 30 stores.\r\n\tCan you help?');
	});

	it('rejects bodies that are not objects', () => {
		for (const body of [null, 'hello', 3, []]) expect(parseContactRequest(body)).toEqual({ ok: false, error: 'Enter your first name' });
	});
});

describe('isHoneypotFilled', () => {
	it('spots the hidden field only bots fill in', () => {
		expect(isHoneypotFilled({ ...VALID, website: 'https://spam.example' })).toBe(true);
		expect(isHoneypotFilled(VALID)).toBe(false);
		expect(isHoneypotFilled({ ...VALID, website: undefined })).toBe(false);
		expect(isHoneypotFilled(null)).toBe(false);
	});
});

describe('toContactAdminData', () => {
	it('lists requests with their dates as ISO strings, in the order given', () => {
		const data = toContactAdminData([
			{
				id: 'c1',
				firstName: 'Ana',
				lastName: 'Ruiz',
				email: 'ana@example.com',
				company: 'North Ridge',
				companySize: '2–10',
				topic: 'enterprise',
				message: null,
				premiumCredits: null,
				createdAt: new Date('2026-10-15T08:00:00Z'),
			},
		]);
		expect(data.requests).toEqual([
			{
				id: 'c1',
				name: 'Ana Ruiz',
				email: 'ana@example.com',
				company: 'North Ridge',
				companySize: '2–10',
				topic: 'enterprise',
				message: null,
				premiumCredits: null,
				receivedAt: '2026-10-15T08:00:00.000Z',
			},
		]);
	});
});
