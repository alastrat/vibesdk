import { SpinnerGapIcon } from '@phosphor-icons/react';
import { planName, type PaidPlanId } from '@/api-types';
import { pillClass, type PillVariant } from '@/components/public-site/primitives';
import { usePlanCheckout } from '@/hooks/use-billing';
import { cn } from '@/lib/utils';

/** "Get Pro" or "Get Premium", styled as the public pages' pill buttons; it opens Stripe's checkout, or sign-up first. */
export function PlanButton({ plan, variant = 'charcoal', className }: { plan: PaidPlanId; variant?: PillVariant; className?: string }) {
	const checkout = usePlanCheckout();
	const busy = checkout.pending === plan;
	return (
		<button type="button" onClick={() => void checkout.start(plan)} disabled={busy} aria-busy={busy} className={pillClass(variant, cn('disabled:cursor-wait', className))}>
			{busy && <SpinnerGapIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
			Get {planName(plan)}
		</button>
	);
}
