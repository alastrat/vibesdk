import { usePublicPlan } from '@/hooks/use-public-plan';

/** "Up to 3 new sites a day · 200 AI credits a day", or nothing when the limits aren't known. */
export function PlanLimits({ className }: { className?: string }) {
	const plan = usePublicPlan();
	const parts: string[] = [];
	if (plan.data?.newSitesPerDay != null) parts.push(`Up to ${plan.data.newSitesPerDay} new sites a day`);
	if (plan.data?.aiCreditsPerDay != null) parts.push(`${plan.data.aiCreditsPerDay} AI credits a day`);
	if (parts.length === 0) return null;
	return <p className={className}>{parts.join(' · ')}</p>;
}
