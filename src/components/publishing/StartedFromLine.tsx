import { Link } from 'react-router';
import type { StartedFromView } from '@/api-types';

export function StartedFromLine({ startedFrom }: { startedFrom: StartedFromView }) {
	if (!startedFrom.available) {
		return <p className="text-sm text-kumo-subtle">Started from a site that is no longer available</p>;
	}
	return (
		<p className="text-sm text-kumo-subtle">
			Started from{' '}
			<Link to={`/app/${startedFrom.appId}`} className="text-kumo-default underline-offset-2 hover:underline">
				{startedFrom.title}
			</Link>{' '}
			by {startedFrom.creatorName}
		</p>
	);
}
