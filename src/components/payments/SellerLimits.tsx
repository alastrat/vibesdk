import { t, useI18n } from '@/lib/i18n';
import { Badge } from '@cloudflare/kumo';
import { useSellerLimits } from '@/hooks/use-payments';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';
import { formatUsd } from '@/api-types';

/** The seller's level, their two store limits with this week's use, and what's left before the next level. */
export function SellerLimits() {
	const { locale, tn } = useI18n();
	const limits = useSellerLimits();
	if (!limits.data) return null;
	const data = limits.data;
	return (
		<div className="grid gap-1 text-sm text-kumo-default">
			<div className="flex items-center gap-2">
				<span className="font-medium">{t("Store limits")}</span>
				<Badge variant={data.level === 'established' ? 'success' : 'info'}>{data.level === 'established' ? t("Established seller") : t("New seller")}</Badge>
			</div>
			<span>{t('Largest order: {amount}', { amount: formatUsd(data.largestOrderCents, locale) })}</span>
			<span>{t('Weekly limit used: {used} of {limit}', { used: formatUsd(data.weeklySalesUsedCents, locale), limit: formatUsd(data.weeklySalesCents, locale) })}
			</span>
			<span className="text-kumo-subtle">{t(OWN_PRODUCTS_WEIGHTING)}</span>
			<span>{tn('Payouts wait {count} business day after each sale.', 'Payouts wait {count} business days after each sale.', data.payoutDelayDays)}</span>
			{data.nextLevel && (
				<span className="text-kumo-subtle">{t('To increase your limits: completed orders {orders}/{requiredOrders}, days of selling {days}/{requiredDays}.', { orders: data.nextLevel.completedOrders, requiredOrders: data.nextLevel.completedOrdersNeeded, days: data.nextLevel.daysSinceFirstSale, requiredDays: data.nextLevel.daysNeeded })}</span>
			)}
		</div>
	);
}
