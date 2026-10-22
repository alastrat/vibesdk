import { PLAN_LIMITS, formatCredits } from '@/api-types';

/** Basic's monthly pool comes from the same plan definition the billing ledger enforces. */
export function PlanLimits({ className }: { className?: string }) {
	return <p className={className}>{formatCredits(PLAN_LIMITS.basic.aiCredits)} AI credits a month</p>;
}
