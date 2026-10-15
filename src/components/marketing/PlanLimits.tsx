import { usePublicPlan } from '@/hooks/use-public-plan';

/** "Up to 3 new sites a day · 200 AI credits a day"; while the limits aren't known, the fallback or nothing. */
export function PlanLimits({ className, fallback }: { className?: string; fallback?: string }) {
	const plan = usePublicPlan();
	const parts: string[] = [];
	if (plan.data?.newSitesPerDay != null) parts.push(`Up to ${plan.data.newSitesPerDay} new sites a day`);
	if (plan.data?.aiCreditsPerDay != null) parts.push(`${plan.data.aiCreditsPerDay} AI credits a day`);
	if (parts.length === 0) return fallback ? <p className={className}>{fallback}</p> : null;
	return <p className={className}>{parts.join(' · ')}</p>;
}
