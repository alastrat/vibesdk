import type { ReferenceCard as ReferenceCardData } from '@/api-types';
import { T, t } from '@/lib/i18n';

interface ReferenceCardProps {
	reference: ReferenceCardData;
}

/** A reference URL in the chat: what the model sees, or why it could not be captured. */
export function ReferenceCard({ reference }: ReferenceCardProps) {
	if (!reference.ok) {
		return (
			<div className="max-w-md rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-subtle">
				<T
					text="Couldn't capture <host>{host}</host>: {reason}"
					values={{ host: reference.host, reason: t(reference.reason) }}
					components={{ host: (children) => <span className="font-medium text-kumo-strong">{children}</span> }}
				/>
			</div>
		);
	}
	return (
		<a
			href={reference.url}
			target="_blank"
			rel="noopener noreferrer"
			className="flex max-w-md items-center gap-3 rounded-lg border border-kumo-line bg-kumo-elevated p-2 text-sm hover:border-kumo-brand"
		>
			{reference.thumbnailUrl && (
				<img
					src={reference.thumbnailUrl}
					alt={t('Screenshot of {host}', { host: reference.host })}
					loading="lazy"
					className="h-16 w-28 shrink-0 rounded object-cover object-top"
				/>
			)}
			<div className="min-w-0">
				<p className="truncate font-medium text-kumo-strong">{reference.host}</p>
				<p className="truncate text-xs text-kumo-subtle">{reference.summary}</p>
			</div>
		</a>
	);
}
