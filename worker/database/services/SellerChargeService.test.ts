import { describe, expect, it } from 'vitest';
import { SellerChargeService } from './SellerChargeService';
import { recordingD1 } from '../test-support/recording-d1';

describe('SellerChargeService', () => {
	it('adds a charge keyed by kind and source', async () => {
		// The insert returns the new row's id; an existing kind and source returns none.
		const { d1, statements } = recordingD1([['sc_1']]);
		const charges = new SellerChargeService({ DB: d1 } as unknown as Env);
		expect(await charges.add({ sellerUserId: 'u1', kind: 'dispute-fee', sourceId: 'dp_1', amountCents: 1500, now: new Date(0) })).toBe('added');
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "seller_charges"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['u1', 'dispute-fee', 'dp_1', 1500]));
		expect(insert?.sql.toLowerCase()).toContain('on conflict');
	});

	it('reports a charge for the same kind and source as existing', async () => {
		const { d1 } = recordingD1([]);
		expect(await new SellerChargeService({ DB: d1 } as unknown as Env).add({ sellerUserId: 'u1', kind: 'dispute-fee', sourceId: 'dp_1', amountCents: 1500, now: new Date(0) })).toBe('exists');
	});

	it('records a collection and adds it to the charge in one batch', async () => {
		const { d1, batches } = recordingD1();
		await new SellerChargeService({ DB: d1 } as unknown as Env).recordCollection({ chargeId: 'sc_1', orderId: 'ord_1', reversalId: 'trr_1', amountCents: 400, now: new Date(0) });
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase())).toEqual(['insert into "seller_charge_collections"', 'update "seller_charges" set']);
	});
});
