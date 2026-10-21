import { LEGACY_CREDIT_FACTOR, PLAN_LIMITS, formatCredits } from '@/api-types';
import { useBillingOn } from '@/hooks/use-billing';
import { usePublicPlan } from '@/hooks/use-public-plan';

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "5,000 AI credits a month · 3 stores · 1 live store", Basic's limits once billing is on. */
function basicMonthly(): string {
	const { aiCredits, storesLifetime, liveStores } = PLAN_LIMITS.basic;
	const parts = [`${formatCredits(aiCredits)} AI credits a month`];
	if (storesLifetime !== null) parts.push(count(storesLifetime, 'store'));
	if (liveStores !== null) parts.push(count(liveStores, 'live store'));
	return parts.join(' · ');
}

/**
 * Basic's allowance: its monthly limits once billing is on, and until then "Up to 3 new sites a day · 3,400 AI credits a
 * day" from the limits in force, the credits converted from the older unit they're set in to the one steps are priced
 * in; while those aren't known, the fallback or nothing.
 */
export function PlanLimits({ className, fallback }: { className?: string; fallback?: string }) {
	const plan = usePublicPlan();
	const billing = useBillingOn();
	if (billing) return <p className={className}>{basicMonthly()}</p>;
	const parts: string[] = [];
	if (plan.data?.newSitesPerDay != null) parts.push(`Up to ${plan.data.newSitesPerDay} new sites a day`);
	if (plan.data?.aiCreditsPerDay != null) parts.push(`${formatCredits(plan.data.aiCreditsPerDay * LEGACY_CREDIT_FACTOR)} AI credits a day`);
	if (parts.length === 0) return fallback ? <p className={className}>{fallback}</p> : null;
	return <p className={className}>{parts.join(' · ')}</p>;
}
