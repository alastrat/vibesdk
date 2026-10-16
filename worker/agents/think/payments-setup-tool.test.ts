import { describe, expect, it } from 'vitest';
import type { ToolExecutionOptions } from 'ai';
import { createPaymentsSetupTool } from './payments-setup-tool';
import type { SellerReadiness } from '../../../shared/types/seller-setup';

const READY: SellerReadiness = { termsAccepted: true, connected: true, detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };
const OPTIONS = { toolCallId: 't1', messages: [] } as unknown as ToolExecutionOptions;

async function run(readiness: SellerReadiness | null): Promise<unknown> {
	const { get_payments_setup } = createPaymentsSetupTool({ readiness: async () => readiness });
	const output = await get_payments_setup.execute?.({}, OPTIONS);
	return JSON.parse(String(output));
}

describe('get_payments_setup', () => {
	it('says a ready seller can take payments', async () => {
		expect(await run(READY)).toEqual({ ready: true });
	});

	it('names the next step and where to finish it', async () => {
		expect(await run({ ...READY, payoutsEnabled: false })).toEqual({ ready: false, nextStep: 'Add and verify a bank account', setupPath: '/profile?tab=paid' });
		expect(await run(null)).toEqual({ ready: false, nextStep: 'Accept the selling terms', setupPath: '/profile?tab=paid' });
	});
});
