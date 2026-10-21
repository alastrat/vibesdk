import { LayerCard } from '@cloudflare/kumo';
import { ChartBar } from 'lucide-react';
import { GPC_ANALYTICS_MESSAGE } from '@/api-types';
import { BRAND } from '@/brand';
import { Switch } from '@/components/ui/switch';
import { useAnalyticsPreference, useSetAnalyticsPreference } from '@/hooks/use-telemetry';

export function AnalyticsPreferenceCard() {
	const preference = useAnalyticsPreference();
	const update = useSetAnalyticsPreference();
	const data = preference.data;
	return (
		<LayerCard id="analytics">
			<LayerCard.Secondary className="font-funky-mono tracking-tighter">
				<div className="flex items-center gap-2">
					<span className="flex items-center">
						<ChartBar className="size-4" />
					</span>
					<span>Analytics</span>
				</div>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="flex items-start justify-between gap-4">
					<div className="grid gap-1.5">
						<h4 className="text-sm font-medium text-kumo-default">Share usage analytics with {BRAND.name}</h4>
						<p className="text-sm text-kumo-subtle">
							{BRAND.name} uses the pages you visit, where you click, recordings of some sessions that show layouts and clicks but not
							what's written, and error reports to fix problems and improve the product. Your email and name are never shared.
						</p>
						{data?.gpc && <p className="text-sm text-kumo-subtle">{GPC_ANALYTICS_MESSAGE}</p>}
					</div>
					<Switch
						checked={data ? !data.optedOut : false}
						disabled={!data || data.gpc || update.isPending}
						onCheckedChange={(checked) => update.mutate(!checked)}
						aria-label={`Share usage analytics with ${BRAND.name}`}
					/>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}
