import { SELLER_SETUP_MESSAGES, type StripeConnectStatusData } from '@/api-types';

export interface SetupPrompt {
	/** Saved when the seller chooses Not now, so the prompt returns only when a different step is needed. */
	key: string;
	message: string;
	action: string;
}

const INVITE = 'invite';
/** What Not now saved before steps were remembered: it dismissed the invitation. */
const LEGACY_DISMISSAL = '1';

/**
 * The home page's payments prompt: an invitation for someone who never started, then the next step for a seller who
 * started but whose stores can't take payments yet, until setup is complete.
 */
export function setupPrompt(
	status: Pick<StripeConnectStatusData, 'configured' | 'connected' | 'sellerTermsAccepted' | 'setupStep'>,
	dismissed: string | null,
): SetupPrompt | null {
	if (!status.configured || status.setupStep === null) return null;
	const started = status.connected || status.sellerTermsAccepted;
	const step = SELLER_SETUP_MESSAGES[status.setupStep];
	const prompt: SetupPrompt = started
		? { key: status.setupStep, message: `Your stores can't take payments yet: ${step.charAt(0).toLowerCase()}${step.slice(1)}.`, action: 'Finish setup' }
		: { key: INVITE, message: "Want your stores to take payments? Set up payments when you're ready to sell.", action: 'Set up payments' };
	if (dismissed === prompt.key || (prompt.key === INVITE && dismissed === LEGACY_DISMISSAL)) return null;
	return prompt;
}
