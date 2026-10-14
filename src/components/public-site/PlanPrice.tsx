import { formatPlanPrice, type Plan } from '@/lib/plans';

export function PlanPrice({ plan, className }: { plan: Plan; className?: string }) {
	return (
		<p className={className}>
			{formatPlanPrice(plan)}
			{plan.priceCents > 0 && <span className="text-base font-normal tracking-normal text-public-muted"> / month</span>}
		</p>
	);
}
