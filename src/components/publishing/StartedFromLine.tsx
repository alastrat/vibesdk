import { t, useI18n } from '@/lib/i18n';
import { Link } from 'react-router';
import type { StartedFromView } from '@/api-types';

export function StartedFromLine({ startedFrom }: { startedFrom: StartedFromView }) {
	useI18n();
	if (!startedFrom.available) {
		return <p className="text-sm text-kumo-subtle">{t("Started from a site that is no longer available")}</p>;
	}
	return (
		<p className="text-sm text-kumo-subtle">{t("Started from")}{' '}
			<Link to={`/app/${startedFrom.appId}`} className="text-kumo-default underline-offset-2 hover:underline">
				{startedFrom.title}
			</Link>{' '}{t("by")}{startedFrom.creatorName}
		</p>
	);
}
