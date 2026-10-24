import { useQuery } from '@tanstack/react-query';
import { Button, Loader } from '@cloudflare/kumo';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { t, useI18n } from '@/lib/i18n';
import { TrafficWidgets } from './traffic-widgets';

export function DeployedStoreAnalytics({
	appId,
	userId,
	days,
	mode,
	paidCents,
	customerCount,
	compare,
	throughDay,
	productId,
}: {
	appId: string;
	userId: string;
	days: number;
	mode: 'live' | 'test';
	paidCents: number;
	customerCount: number;
	compare: boolean;
	throughDay?: string;
	productId?: string;
}) {
	useI18n();
	const query = useQuery({
		queryKey: queryKeys.account.storeAnalytics(
			userId,
			appId,
			days,
			mode,
			throughDay,
			productId,
		),
		queryFn: () =>
			unwrap(
				apiClient.getStoreAnalytics(appId, {
					days,
					mode,
					throughDay,
					productId,
				}),
				t("Couldn't load store analytics. Try again in a moment."),
			),
		enabled: !!userId,
		refetchInterval: 30000,
		refetchIntervalInBackground: false,
		retry: false,
	});
	if (query.isPending)
		return (
			<div className="ea-traffic-loading" role="status">
				<Loader />
				{t('Loading storefront analytics…')}
			</div>
		);
	if (query.isError)
		return (
			<div className="ea-test-notice">
				<p>
					{t("Couldn't load store analytics. Try again in a moment.")}
				</p>
				<Button size="sm" onClick={() => void query.refetch()}>
					{t('Try again')}
				</Button>
			</div>
		);
	return (
		<TrafficWidgets
			key={`${appId}:${days}:${mode}:${throughDay}:${productId}`}
			data={query.data}
			compare={compare}
			paidCents={paidCents}
			customerCount={customerCount}
		/>
	);
}
