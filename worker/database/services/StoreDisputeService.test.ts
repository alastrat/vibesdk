import { describe, expect, it } from 'vitest';
import { StoreDisputeService } from './StoreDisputeService';
import { recordingD1 } from '../test-support/recording-d1';

const ROW = { id: 'dp_1', orderId: 'ord_1', amountCents: 6599, reason: 'fraudulent', reversalState: 'done' as const, reversalId: null, reversedCents: 6599, feeCents: 1500, returnedCents: 0, now: new Date(1_800_000_000_000) };

describe('StoreDisputeService.save', () => {
	it('stamps when a dispute closed, once, so a loss counts from the day it was lost', async () => {
		const { d1, statements } = recordingD1();
		await new StoreDisputeService({ DB: d1 } as unknown as Env).save({ ...ROW, status: 'lost' });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_disputes"'));
		expect(insert?.sql).toContain('"closed_at"');
		// Created, updated and closed in the row, and updated again on a conflict.
		expect(insert?.params.filter((param) => param === 1_800_000_000)).toHaveLength(4);
		expect(insert?.sql.toLowerCase()).toContain('coalesce("store_disputes"."closed_at", excluded.closed_at)');
	});

	it('leaves an open dispute unstamped', async () => {
		const { d1, statements } = recordingD1();
		await new StoreDisputeService({ DB: d1 } as unknown as Env).save({ ...ROW, status: 'needs_response' });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_disputes"'));
		// Created and updated in the row, and updated again on a conflict; no close time.
		expect(insert?.params.filter((param) => param === 1_800_000_000)).toHaveLength(3);
	});
});
