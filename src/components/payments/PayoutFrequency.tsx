import { toast } from 'sonner';
import type { PayoutInterval, StripeConnectStatusData } from '@/api-types';
import { useSetPayoutSchedule } from '@/hooks/use-payments';
import { stripeFeesText } from './payout-costs';

const LABELS: Readonly<Record<PayoutInterval, string>> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** How often the seller is paid, each choice with what Stripe's account and payout fees would cost them a month. */
export function PayoutFrequency({ status }: { status: StripeConnectStatusData }) {
	const setSchedule = useSetPayoutSchedule();
	const choose = (interval: PayoutInterval, anchor: string) =>
		setSchedule.mutate({ interval, anchor }, { onError: (error) => toast.error(error.message) });
	const estimate = (interval: PayoutInterval) =>
		status.payoutCostEstimates[interval] > 0
			? `about ${dollars(status.payoutCostEstimates[interval])} a month in Stripe fees`
			: stripeFeesText(status.accountCosts);

	return (
		<fieldset className="grid gap-2" disabled={setSchedule.isPending}>
			<legend className="text-sm font-medium text-kumo-default">How often you're paid</legend>
			{(['daily', 'weekly', 'monthly'] as const).map((interval) => (
				<label key={interval} className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
					<input
						type="radio"
						name="payout-interval"
						checked={status.payoutInterval === interval}
						onChange={() => choose(interval, interval === 'weekly' ? 'monday' : interval === 'monthly' ? '1' : '')}
					/>
					<span>
						{LABELS[interval]}: {estimate(interval)}
					</span>
					{interval === 'weekly' && status.payoutInterval === 'weekly' && (
						<select aria-label="Payout day" value={status.payoutAnchor} onChange={(event) => choose('weekly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
							{WEEKDAYS.map((day) => (
								<option key={day} value={day}>
									{day[0].toUpperCase() + day.slice(1)}
								</option>
							))}
						</select>
					)}
					{interval === 'monthly' && status.payoutInterval === 'monthly' && (
						<select aria-label="Payout day of the month" value={status.payoutAnchor} onChange={(event) => choose('monthly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
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
	);
}
