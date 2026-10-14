import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@cloudflare/kumo';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { formatTemplatePrice, type PublicAppsData } from '@/api-types';

/** Popular sites anyone can reuse now; shared by the strip and the landing page's featured stores. */
export function useDiscoverStripSites() {
	return useQuery({
		queryKey: queryKeys.apps.strip(),
		queryFn: async () => {
			const response = await apiClient.getPublicApps({ sort: 'popular', limit: 6, reusableOnly: true });
			if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to load sites');
			return response.data.apps;
		},
		staleTime: 60_000,
	});
}

/** Screenshot tiles linking to each site's Discover page. */
export function DiscoverSiteGrid({ apps, className }: { apps: PublicAppsData['apps']; className?: string }) {
	return (
		<div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', className)}>
			{apps.map((app) => (
				<Link
					key={app.id}
					to={`/discover/${app.id}`}
					className="group grid grid-cols-1 gap-2 rounded-xl p-2 ring ring-kumo-hairline hover:ring-kumo-line"
				>
					<div className="aspect-[16/10] overflow-hidden rounded-lg bg-kumo-recessed">
						{app.screenshotUrl && (
							<img src={app.screenshotUrl} alt="" loading="lazy" className="size-full object-cover" />
						)}
					</div>
					<div className="flex items-center justify-between gap-2 px-1">
						<span className="truncate text-sm text-kumo-default">{app.title}</span>
						<span className="shrink-0 text-xs text-kumo-subtle">
							{app.priceCents !== null ? formatTemplatePrice(app.priceCents) : 'Free'}
						</span>
					</div>
				</Link>
			))}
		</div>
	);
}

/** "Start from a published site" under the home prompt: popular sites anyone can reuse now. */
export function DiscoverStrip() {
	const sites = useDiscoverStripSites();
	const apps = sites.data ?? [];
	if (apps.length === 0) return null;

	return (
		<section className="mt-8 grid w-full gap-3">
			<div className="flex items-baseline justify-between">
				<h2 className="text-sm font-medium text-kumo-default">Start from a published site</h2>
				<Link to="/discover" className="text-sm text-kumo-subtle hover:text-kumo-default">
					See all
				</Link>
			</div>
			<DiscoverSiteGrid apps={apps} />
		</section>
	);
}
