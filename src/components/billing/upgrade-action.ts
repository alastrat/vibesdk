/** What the Upgrade dialog says and offers for a plan-limit refusal. */

import { BILLING_PATH, type PaidPlanId, type PlanLimitKey, type PlanLimitRefusal } from '@/api-types';
import { contactPath } from '@/lib/contact';

export type UpgradeAction = { kind: 'checkout'; plan: PaidPlanId; label: string } | { kind: 'link'; to: string; label: string } | { kind: 'none' };

export const UPGRADE_TITLES: Record<PlanLimitKey, string> = {
	aiCredits: "You're out of AI credits",
	storesLifetime: "You've started all your stores",
	newStoresPerDay: "That's today's new stores",
	liveStores: "You've reached your live stores",
	ownDomainsPerLiveStore: 'Own domains come with Pro and Premium',
	supplierCatalog: 'Catalog products need Pro or Premium',
	extraCredits: 'Extra credits come with Premium',
};

/** Paid plans already include an own domain, so their refusal is for one more. */
export function upgradeTitleFor(refusal: PlanLimitRefusal): string {
	if (refusal.paymentFailed) return "Your payment didn't go through";
	if (refusal.limit === 'ownDomainsPerLiveStore' && refusal.plan !== 'basic') return 'More own domains';
	return UPGRADE_TITLES[refusal.limit];
}

/** Basic buys a plan at checkout; Pro moves up on the billing page, where the charge is explained first. */
export function upgradeActionFor(refusal: PlanLimitRefusal): UpgradeAction {
	if (refusal.paymentFailed) return { kind: 'link', to: BILLING_PATH, label: 'Manage billing' };
	switch (refusal.upgradeTo) {
		case 'pro':
			return { kind: 'checkout', plan: 'pro', label: 'Get Pro' };
		case 'premium':
			return refusal.plan === 'basic'
				? { kind: 'checkout', plan: 'premium', label: 'Get Premium' }
				: { kind: 'link', to: `${BILLING_PATH}?plan=premium`, label: 'Move to Premium' };
		case 'credits':
			return { kind: 'link', to: `${BILLING_PATH}#extra-credits`, label: 'Buy credits' };
		case 'enterprise':
			return { kind: 'link', to: contactPath('enterprise'), label: 'Talk to us' };
		default:
			return { kind: 'none' };
	}
}
