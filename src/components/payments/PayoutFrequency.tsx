import { useBilling } from '@/hooks/use-billing';
import { PlanButton } from '@/components/billing/PlanButton';
import { t, msg, useI18n } from '@/lib/i18n';
import { formatUsd } from '@/api-types';
import { INTL_LOCALE } from 'shared/i18n/locales';
import { toast } from 'sonner';
import type { PayoutInterval, StripeConnectStatusData } from '@/api-types';
import { useSetPayoutSchedule } from '@/hooks/use-payments';
import { stripeFeesText } from './payout-costs';

const LABELS: Readonly<Record<PayoutInterval, string>> = { daily: msg('Daily'), weekly: msg('Weekly'), monthly: msg('Monthly') };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

/** How often the seller is paid, each choice with what Stripe's account and payout fees would cost them a month. */
export function PayoutFrequency({ status }: { status: StripeConnectStatusData }) {
	const i18n = useI18n();
	const { locale } = i18n;
	const billing = useBilling();
	const canChoose = billing.data?.enabled === false || billing.data?.limits.flexiblePayouts === true;
	const setSchedule = useSetPayoutSchedule();
	const choose = (interval: PayoutInterval, anchor: string) =>
		setSchedule.mutate({ interval, anchor }, { onError: (error) => toast.error(error.message) });
	const estimate = (interval: PayoutInterval) =>
		status.payoutCostEstimates[interval] > 0
			? t('about {amount} a month in Stripe fees', { amount: formatUsd(status.payoutCostEstimates[interval], locale) })
			: stripeFeesText(status.accountCosts, locale, t);

	return (
		<>
		<fieldset className="grid gap-2" disabled={setSchedule.isPending || !canChoose}>
			<legend className="text-sm font-medium text-kumo-default">{t("How often you're paid")}</legend>
			{(['daily', 'weekly', 'monthly'] as const).map((interval) => (
				<label key={interval} className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
					<input
						type="radio"
						name="payout-interval"
						checked={status.payoutInterval === interval}
						onChange={() => choose(interval, interval === 'weekly' ? 'monday' : interval === 'monthly' ? '1' : '')}
					/>
					<span>
						{t(LABELS[interval])}: {estimate(interval)}
					</span>
					{interval === 'weekly' && status.payoutInterval === 'weekly' && (
						<select aria-label={t("Payout day")} value={status.payoutAnchor} onChange={(event) => choose('weekly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
							{WEEKDAYS.map((day) => (
								<option key={day} value={day}>
									{new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 19 + WEEKDAYS.indexOf(day))))}
								</option>
							))}
						</select>
					)}
					{interval === 'monthly' && status.payoutInterval === 'monthly' && (
						<select aria-label={t("Payout day of the month")} value={status.payoutAnchor} onChange={(event) => choose('monthly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
							{Array.from({ length: 28 }, (_, index) => String(index + 1)).map((day) => (
								<option key={day} value={day}>
									{day}
								</option>
							))}
						</select>
					)}
				</label>
			))}
		</fieldset>
		{billing.data?.enabled && !canChoose && (
			<div className="grid justify-items-start gap-2 text-sm">
				<p className="text-kumo-subtle">{t('Choosing your payout schedule comes with Pro and Premium. Your current schedule stays in place.')}</p>
				<PlanButton plan="pro" i18n={i18n} className="px-4 py-2 text-sm" />
			</div>
		)}
		{billing.isError && <p className="text-sm text-kumo-subtle">{billing.error.message}</p>}
		</>
	);
}
