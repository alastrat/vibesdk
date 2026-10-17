import { describe, expect, it } from 'vitest';
import { parseEarlyAccessRequest, toEarlyAccessAdminData } from './earlyAccessDto';

describe('parseEarlyAccessRequest', () => {
	it('accepts the early-access programs', () => {
		expect(parseEarlyAccessRequest({ capability: 'digital-products' })).toEqual({ ok: true, capability: 'digital-products' });
		expect(parseEarlyAccessRequest({ capability: 'content-creators' })).toEqual({ ok: true, capability: 'content-creators' });
	});

	it('rejects built-in capabilities, unknown ids and malformed bodies', () => {
		for (const body of [{ capability: 'agentic-commerce' }, { capability: 'nope' }, { capability: 3 }, {}, null, 'digital-products']) {
			expect(parseEarlyAccessRequest(body)).toEqual({ ok: false, error: 'Unknown early access program' });
		}
	});
});

describe('toEarlyAccessAdminData', () => {
	it('counts every program, including ones nobody asked for, and keeps the order', () => {
		const data = toEarlyAccessAdminData([
			{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', createdAt: new Date('2026-10-14T10:00:00Z') },
			{ capability: 'content-creators', email: 'bo@example.com', displayName: 'Bo', createdAt: new Date('2026-10-13T10:00:00Z') },
		]);
		expect(data.counts).toEqual({ 'digital-products': 0, 'content-creators': 2 });
		expect(data.requests).toEqual([
			{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', requestedAt: '2026-10-14T10:00:00.000Z' },
			{ capability: 'content-creators', email: 'bo@example.com', displayName: 'Bo', requestedAt: '2026-10-13T10:00:00.000Z' },
		]);
	});
});
