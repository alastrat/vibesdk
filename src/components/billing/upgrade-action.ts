/** What the Upgrade dialog says and offers for a plan-limit refusal. */

import { BILLING_PATH, planName, type PaidPlanId, type PlanLimitKey, type PlanLimitRefusal } from '@/api-types';
import { contactPath } from '@/lib/contact';
import { msg, t } from '@/lib/i18n';

export type UpgradeAction = { kind: 'checkout'; plan: PaidPlanId; label: string } | { kind: 'link'; to: string; label: string } | { kind: 'none' };

/** Each limit's title; `upgradeTitleFor` translates it where it is shown. */
export const UPGRADE_TITLES: Record<PlanLimitKey, string> = {
	aiCredits: msg("You're out of AI credits"),
	storesLifetime: msg("You've started all your stores"),
	newStoresPerDay: msg("That's today's new stores"),
	liveStores: msg("You've reached your live stores"),
	ownDomainsPerLiveStore: msg('Own domains come with Pro and Premium'),
	supplierCatalog: msg('Catalog products need Pro or Premium'),
	extraCredits: msg('Extra credits come with Premium'),
};

/** Paid plans already include an own domain, so their refusal is for one more. */
export function upgradeTitleFor(refusal: PlanLimitRefusal): string {
	if (refusal.paymentFailed) return t("Your payment didn't go through");
	if (refusal.limit === 'ownDomainsPerLiveStore' && refusal.plan !== 'basic') return t('More own domains');
	return t(UPGRADE_TITLES[refusal.limit]);
}

/** Basic buys a plan at checkout; Pro moves up on the billing page, where the charge is explained first. */
export function upgradeActionFor(refusal: PlanLimitRefusal): UpgradeAction {
	if (refusal.paymentFailed) return { kind: 'link', to: BILLING_PATH, label: t('Open billing') };
	switch (refusal.upgradeTo) {
		case 'pro':
			return { kind: 'checkout', plan: 'pro', label: t('Get {plan}', { plan: planName('pro') }) };
		case 'premium':
			return refusal.plan === 'basic'
				? { kind: 'checkout', plan: 'premium', label: t('Get {plan}', { plan: planName('premium') }) }
				: { kind: 'link', to: `${BILLING_PATH}?plan=premium`, label: t('Move to {plan}', { plan: planName('premium') }) };
		case 'credits':
			return { kind: 'link', to: `${BILLING_PATH}#extra-credits`, label: t('Buy credits') };
		case 'enterprise':
			return { kind: 'link', to: contactPath('enterprise'), label: t('Talk to us') };
		default:
			return { kind: 'none' };
	}
}
