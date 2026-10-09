import type { ReferenceCard as ReferenceCardData } from '@/api-types';

interface ReferenceCardProps {
	reference: ReferenceCardData;
}

/** A reference URL in the chat: what the model sees, or why it could not be captured. */
export function ReferenceCard({ reference }: ReferenceCardProps) {
	if (!reference.ok) {
		return (
			<div className="max-w-md rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm text-kumo-subtle">
				Couldn't capture <span className="font-medium text-kumo-strong">{reference.host}</span>: {reference.reason}
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
					alt={`Screenshot of ${reference.host}`}
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
