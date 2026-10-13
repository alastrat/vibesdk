import { TEMPLATE_CATEGORY_LABELS, type SitePageData } from '@/api-types';
import { sitePriceLabel } from '@/lib/site-page-display';

function formatDate(iso: string | null): string | null {
	return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

export function SiteDetailsCard({ page }: { page: SitePageData }) {
	const published = formatDate(page.publishedAt);
	const updated = formatDate(page.updatedAt);
	const price = sitePriceLabel(page);
	const rows: Array<[string, string]> = [
		['Category', page.category ? TEMPLATE_CATEGORY_LABELS[page.category] : 'None'],
		...(price ? [['Price', price] as [string, string]] : []),
		['Uses', String(page.stats.uses)],
		['Views', String(page.stats.views)],
		['Likes', String(page.stats.likes)],
		...(published ? [['Published', published] as [string, string]] : []),
		...(updated ? [['Last updated', updated] as [string, string]] : []),
	];
	return (
		<aside className="grid h-fit gap-4 rounded-xl p-4 ring ring-kumo-hairline">
			<div className="flex items-center gap-3">
				{page.creator.avatarUrl ? (
					<img src={page.creator.avatarUrl} alt="" className="size-9 rounded-full" />
				) : (
					<span className="flex size-9 items-center justify-center rounded-full bg-kumo-elevated text-sm text-kumo-default">
						{page.creator.displayName.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="text-sm font-medium text-kumo-default">{page.creator.displayName}</span>
			</div>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-kumo-subtle">{label}</dt>
						<dd className="text-kumo-default">{value}</dd>
					</div>
				))}
			</dl>
			{page.approvedShots && (
				<div className="grid gap-2">
					<span className="text-xs text-kumo-subtle">Approved version</span>
					<div className="grid grid-cols-[1fr_auto] items-end gap-2">
						<img src={page.approvedShots.desktop} alt={`${page.title} on a desktop`} className="w-full rounded-md ring ring-kumo-hairline" />
						<img src={page.approvedShots.mobile} alt={`${page.title} on a phone`} className="w-14 rounded-md ring ring-kumo-hairline" />
					</div>
				</div>
			)}
			<p className="text-sm text-kumo-subtle">
				What you get: your own copy of the full site, which you can keep editing with the AI.
			</p>
			{page.paid && <p className="text-xs text-kumo-subtle">Secure checkout with Stripe</p>}
		</aside>
	);
}
