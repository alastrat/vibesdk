/** `get_payments_setup`: whether the app's owner can take store payments yet, and the next step if not. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { SELLER_SETUP_MESSAGES, SELLER_SETUP_PATH, sellerSetupStep, type SellerReadiness } from '../../../shared/types/seller-setup';
import { SellerTermsService, StripeConnectService } from '../../database';
import { sellerReadiness } from '../../services/payments/stripe-client';

export interface PaymentsSetupDeps {
	/** Null when the owner is unknown. */
	readiness(): Promise<SellerReadiness | null>;
}

const NOT_STARTED: SellerReadiness = { termsAccepted: false, connected: false, detailsSubmitted: false, cardPaymentsActive: false, transfersActive: false, payoutsEnabled: false };

export function createPaymentsSetupTool(deps: PaymentsSetupDeps): { get_payments_setup: Tool } {
	return {
		get_payments_setup: tool({
			description: [
				"Check whether this app's owner can take payments in their store yet.",
				'Call it before telling the user checkout works. When ready is false, tell them their next step in plain words,',
				'and that they finish it at setupPath in Estori. Until then the store shows that checkout is unavailable.',
			].join(' '),
			inputSchema: z.object({}),
			execute: async () => {
				const step = sellerSetupStep((await deps.readiness()) ?? NOT_STARTED);
				if (step === null) return JSON.stringify({ ready: true });
				return JSON.stringify({ ready: false, nextStep: SELLER_SETUP_MESSAGES[step], setupPath: SELLER_SETUP_PATH });
			},
		}),
	};
}

/** Reads the stored flags, which `account.updated` keeps current; checkout itself always asks Stripe. */
export function paymentsSetupDepsFromEnv(env: Env, userId: string | null): PaymentsSetupDeps {
	return {
		readiness: async () => {
			if (!userId) return null;
			const [stored, termsAccepted] = await Promise.all([new StripeConnectService(env).getByUser(userId), new SellerTermsService(env).hasAccepted(userId)]);
			return sellerReadiness(stored, termsAccepted);
		},
	};
}
