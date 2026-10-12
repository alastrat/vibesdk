import { Link } from 'react-router';
import type { TemplateOrigin } from '@/api-types';

export function TemplateOriginLine({ origin }: { origin: TemplateOrigin }) {
	return (
		<p className="text-sm text-kumo-subtle">
			Started from template{' '}
			{origin.listed ? (
				<Link to={`/templates/${origin.slug}`} className="text-kumo-default underline-offset-2 hover:underline">
					{origin.name}
				</Link>
			) : (
				<span className="text-kumo-default">{origin.name}</span>
			)}{' '}
			by {origin.creatorName}
		</p>
	);
}
