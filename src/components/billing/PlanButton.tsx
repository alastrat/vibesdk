import { planName, type PaidPlanId } from '@/api-types';
import { pillClass, type PillVariant } from '@/components/public-site/primitives';
import { usePlanCheckout } from '@/hooks/use-billing';

/** "Get Pro" or "Get Premium", styled as the public pages' pill buttons; it opens Estori's checkout, or sign-up first. */
export function PlanButton({ plan, variant = 'charcoal', className }: { plan: PaidPlanId; variant?: PillVariant; className?: string }) {
	const checkout = usePlanCheckout();
	return (
		<button type="button" onClick={() => checkout.start(plan)} className={pillClass(variant, className)}>
			Get {planName(plan)}
		</button>
	);
}
