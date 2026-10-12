import { Badge } from '@cloudflare/kumo';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS, type PublicTemplateCard } from '@/api-types';

interface TemplateCardProps {
	template: PublicTemplateCard;
	onOpen: (slug: string) => void;
	/** Hides the description, for small strips. */
	compact?: boolean;
}

export function TemplateCard({ template, onOpen, compact = false }: TemplateCardProps) {
	return (
		<button
			type="button"
			onClick={() => onOpen(template.slug)}
			className="group flex w-full flex-col overflow-hidden rounded-xl bg-kumo-base text-left ring ring-kumo-hairline transition hover:shadow-md"
		>
			<div className="aspect-[16/10] w-full overflow-hidden bg-kumo-elevated">
				<img
					src={template.desktopShotUrl}
					alt={`${template.name} preview`}
					loading="lazy"
					className="size-full object-cover object-top transition group-hover:scale-[1.02]"
				/>
			</div>
			<div className="grid gap-1 px-3 py-3">
				<div className="flex items-center justify-between gap-2">
					<p className="truncate text-sm font-semibold text-kumo-default">{template.name}</p>
					<Badge variant={template.priceCents > 0 ? 'info' : 'success'}>
						{formatTemplatePrice(template.priceCents)}
					</Badge>
				</div>
				{!compact && <p className="line-clamp-2 text-sm text-kumo-subtle">{template.description}</p>}
				<p className="truncate text-xs text-kumo-subtle">
					{TEMPLATE_CATEGORY_LABELS[template.category]} · by {template.creatorName} · {template.useCount} uses
				</p>
			</div>
		</button>
	);
}
