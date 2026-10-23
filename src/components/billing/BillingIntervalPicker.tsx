import { Tabs } from '@cloudflare/kumo';
import { isBillingInterval, type BillingInterval } from '@/api-types';
import { msg } from '@/lib/i18n';

/** Shared cadence selector; public copy remains English, account screens can supply translated labels. */
export function BillingIntervalPicker({
	value,
	onChange,
	monthly = 'Monthly',
	yearly = 'Yearly',
	savings = msg('Save 20%'),
}: {
	value: BillingInterval;
	onChange: (interval: BillingInterval) => void;
	monthly?: string;
	yearly?: string;
	savings?: string;
}) {
	return (
		<div className="flex flex-wrap items-center justify-center gap-3" role="group" aria-label={`${monthly} / ${yearly}`}>
			<Tabs
				value={value}
				onValueChange={(next) => {
					if (isBillingInterval(next)) onChange(next);
				}}
				tabs={[
					{ value: 'month', label: monthly },
					{ value: 'year', label: yearly },
				]}
			/>
			<span className="rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-medium text-public-blue">{savings}</span>
		</div>
	);
}
