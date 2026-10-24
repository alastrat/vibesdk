import { getLocale, t } from '@/lib/i18n';
import { PLAN_LIMITS, formatCredits } from '@/api-types';

/** Basic's monthly pool comes from the same plan definition the billing ledger enforces. */
export function PlanLimits({ className }: { className?: string }) {
	return <p className={className}>{t('{credits} AI credits a month', { credits: formatCredits(PLAN_LIMITS.basic.aiCredits, getLocale()) })}</p>;
}
