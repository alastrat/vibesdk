import { planName, type BillingInterval, type PaidPlanId } from '@/api-types';
import { pillClass, type PillVariant } from '@/components/public-site/primitives';
import { usePlanCheckout } from '@/hooks/use-billing';
import { ENGLISH, type Translator } from '../../../shared/i18n/translate';

/**
 * "Get Pro" or "Get Premium", styled as the public pages' pill buttons; it opens Estori's checkout, or sign-up first. It
 * defaults to English unless the caller supplies a translator. Public pricing and app billing pass the active locale.
 */
export function PlanButton({ plan, billingInterval, monthlyCredits, variant = 'charcoal', className, i18n = ENGLISH }: { plan: PaidPlanId; billingInterval?: BillingInterval; monthlyCredits?: number; variant?: PillVariant; className?: string; i18n?: Translator }) {
	const checkout = usePlanCheckout();
	return (
		<button type="button" onClick={() => checkout.start(plan, billingInterval, monthlyCredits)} className={pillClass(variant, className)}>
			{i18n.t('Get {plan}', { plan: planName(plan) })}
		</button>
	);
}
