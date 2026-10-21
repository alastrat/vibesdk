import { t, useI18n } from '@/lib/i18n';
import { Link } from 'react-router';
import type { SitePageCard } from '@/api-types';
import { sitePriceLabel } from '@/lib/site-page-display';

export function MoreFromCreator({ creatorName, sites }: { creatorName: string; sites: SitePageCard[] }) {
	useI18n();
	if (sites.length === 0) return null;
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-semibold text-kumo-strong">{t('More from {creator}', { creator: creatorName })}</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{sites.map((site) => {
					const price = sitePriceLabel(site);
					return (
						<Link
							key={site.id}
							to={`/discover/${site.id}`}
							className="grid gap-2 rounded-xl p-2 ring ring-kumo-hairline hover:ring-kumo-line"
						>
							<div className="aspect-[16/10] overflow-hidden rounded-lg bg-kumo-recessed">
								{site.screenshotUrl && <img src={site.screenshotUrl} alt="" loading="lazy" className="size-full object-cover" />}
							</div>
							<div className="flex items-center justify-between gap-2 px-1">
								<span className="truncate text-sm text-kumo-default">{site.title}</span>
								{price && <span className="shrink-0 text-xs text-kumo-subtle">{price}</span>}
							</div>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
