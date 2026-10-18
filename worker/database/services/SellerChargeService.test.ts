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

	it('claims a collection only while that much of the charge is still owed, then refreshes what is collected', async () => {
		const { d1, statements } = recordingD1([[275]]);
		const claimed = await new SellerChargeService({ DB: d1 } as unknown as Env).claimCollection({ chargeId: 'sc_1', orderId: 'ord_1', amountCents: 275, now: new Date(0) });
		expect(claimed).toBe(275);
		const insert = statements.find((entry) => entry.sql.toLowerCase().includes('insert into seller_charge_collections'));
		expect(insert?.sql.toLowerCase()).toContain('amount_cents - (select coalesce(sum(amount_cents), 0) from seller_charge_collections where charge_id =');
		expect(insert?.sql.toLowerCase()).toContain('on conflict (charge_id, order_id) do nothing');
		expect(insert?.params).toEqual(expect.arrayContaining(['sc_1', 'ord_1', 275]));
		expect(statements.some((entry) => entry.sql.toLowerCase().startsWith('update seller_charges set collected_cents'))).toBe(true);
	});

	it('reports a lost claim when another sale already took what was owed', async () => {
		const { d1 } = recordingD1([]);
		expect(await new SellerChargeService({ DB: d1 } as unknown as Env).claimCollection({ chargeId: 'sc_1', orderId: 'ord_2', amountCents: 275, now: new Date(0) })).toBeNull();
	});
});
