import { Badge } from '@cloudflare/kumo';
import { useSellerLimits } from '@/hooks/use-payments';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';

function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** The seller's level, their two store limits with this week's use, and what's left before the next level. */
export function SellerLimits() {
	const limits = useSellerLimits();
	if (!limits.data) return null;
	const data = limits.data;
	return (
		<div className="grid gap-1 text-sm text-kumo-default">
			<div className="flex items-center gap-2">
				<span className="font-medium">Store limits</span>
				<Badge variant={data.level === 'established' ? 'success' : 'info'}>{data.level === 'established' ? 'Established seller' : 'New seller'}</Badge>
			</div>
			<span>Largest order: {dollars(data.largestOrderCents)}</span>
			<span>
				Weekly limit used: {dollars(data.weeklySalesUsedCents)} of {dollars(data.weeklySalesCents)}
			</span>
			<span className="text-kumo-subtle">{OWN_PRODUCTS_WEIGHTING}</span>
			<span>Payouts wait {data.payoutDelayDays} business days after each sale.</span>
			{data.nextLevel && (
				<span className="text-kumo-subtle">
					Limits grow at {data.nextLevel.completedOrdersNeeded} completed orders and {data.nextLevel.daysNeeded} days of selling. You have {data.nextLevel.completedOrders} completed orders and {data.nextLevel.daysSinceFirstSale} days.
				</span>
			)}
		</div>
	);
}
