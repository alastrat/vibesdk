import { BILLING_CHECKOUT_PATH, BILLING_PATH, isBillingInterval, type BillingInterval, type PaidPlanId } from '@/api-types';

function planQuery(plan: PaidPlanId, interval?: BillingInterval, monthlyCredits?: number): string {
	const params = new URLSearchParams({ plan });
	if (interval !== undefined) params.set('interval', interval);
	if (monthlyCredits !== undefined) params.set('monthlyCredits', String(monthlyCredits));
	return params.toString();
}
export const planBillingPath = (plan: PaidPlanId, interval?: BillingInterval, monthlyCredits?: number): string => `${BILLING_PATH}?${planQuery(plan, interval, monthlyCredits)}`;
export const planCheckoutPath = (plan: PaidPlanId, interval?: BillingInterval, monthlyCredits?: number): string => `${BILLING_CHECKOUT_PATH}?${planQuery(plan, interval, monthlyCredits)}`;
/** Legacy upgrade links inherit the customer's cadence; explicit pricing choices override it. */
export function requestedBillingInterval(search: string, current: BillingInterval = 'month'): BillingInterval {
	const requested = new URLSearchParams(search).get('interval');
	return isBillingInterval(requested) ? requested : current;
}
