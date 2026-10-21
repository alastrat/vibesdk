import { describe, expect, it } from 'vitest';
import type { PlanLimitRefusal } from '@/api-types';
import { announcePlanLimit, onPlanLimit } from '@/lib/plan-limit-events';
import { UPGRADE_TITLES, upgradeActionFor, upgradeTitleFor } from './upgrade-action';

function refusal(overrides: Partial<PlanLimitRefusal> = {}): PlanLimitRefusal {
	return { code: 'plan_limit', limit: 'liveStores', plan: 'basic', upgradeTo: 'pro', message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.', ...overrides };
}

describe('the Upgrade dialog', () => {
	it('starts a checkout from Basic, moves Pro up on the billing page, sells Premium credits, and sends the rest to sales', () => {
		expect(upgradeActionFor(refusal())).toEqual({ kind: 'checkout', plan: 'pro', label: 'Get Pro' });
		expect(upgradeActionFor(refusal({ limit: 'extraCredits', upgradeTo: 'premium' }))).toEqual({ kind: 'checkout', plan: 'premium', label: 'Get Premium' });
		expect(upgradeActionFor(refusal({ plan: 'pro', upgradeTo: 'premium' }))).toEqual({ kind: 'link', to: '/settings/billing?plan=premium', label: 'Move to Premium' });
		expect(upgradeActionFor(refusal({ plan: 'premium', limit: 'aiCredits', upgradeTo: 'credits' }))).toEqual({ kind: 'link', to: '/settings/billing#extra-credits', label: 'Buy credits' });
		expect(upgradeActionFor(refusal({ plan: 'premium', upgradeTo: 'enterprise' }))).toEqual({ kind: 'link', to: '/contact?topic=enterprise', label: 'Talk to us' });
		expect(upgradeActionFor(refusal({ plan: 'enterprise', upgradeTo: null }))).toEqual({ kind: 'none' });
	});

	it('has a title for every limit', () => {
		expect(Object.keys(UPGRADE_TITLES).sort()).toEqual(['aiCredits', 'extraCredits', 'liveStores', 'newStoresPerDay', 'ownDomainsPerLiveStore', 'storesLifetime', 'supplierCatalog']);
	});

	it('titles own domains by whether the plan has them', () => {
		expect(upgradeTitleFor(refusal({ limit: 'ownDomainsPerLiveStore' }))).toBe('Own domains come with Pro and Premium');
		expect(upgradeTitleFor(refusal({ limit: 'ownDomainsPerLiveStore', plan: 'pro', upgradeTo: null }))).toBe('More own domains');
		expect(upgradeTitleFor(refusal({ limit: 'ownDomainsPerLiveStore', plan: 'premium', upgradeTo: 'enterprise' }))).toBe('More own domains');
		expect(Object.values(UPGRADE_TITLES)).not.toContain("Own domains aren't on your plan");
	});

	it('sends a seller whose payment failed to the billing page, where the failed payment is paid', () => {
		const failed = refusal({ limit: 'aiCredits', plan: 'pro', upgradeTo: null, paymentFailed: true });
		expect(upgradeTitleFor(failed)).toBe("Your payment didn't go through");
		expect(upgradeActionFor(failed)).toEqual({ kind: 'link', to: '/settings/billing', label: 'Open billing' });
	});

	it('hands each refusal to whoever listens, until they stop', () => {
		const heard: string[] = [];
		const stop = onPlanLimit((entry) => heard.push(entry.limit));
		announcePlanLimit(refusal());
		stop();
		announcePlanLimit(refusal({ limit: 'aiCredits' }));
		expect(heard).toEqual(['liveStores']);
	});
});
