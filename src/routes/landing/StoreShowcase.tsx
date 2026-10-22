import { marketingCopy } from '@/content/marketing-copy';
import { useState } from 'react';
import { Link } from 'react-router';
import { Marquee } from '@/components/magicui/marquee';
import { EdgeFades, Eyebrow, HEADING_SECTION, LEAD, TextLink } from '@/components/public-site/primitives';
import {
	filterShowcase,
	shouldShowShowcase,
	showcaseFilterLabel,
	showcaseFilters,
	showcaseLayout,
	storesWithImages,
	type ShowcaseFilter,
	type ShowcaseStore,
} from '@/lib/showcase';
import { cn } from '@/lib/utils';

/** Discover stores on tall cards: two rows scrolling in opposite directions, with category filters. */
export function StoreShowcase({ stores }: { stores: readonly ShowcaseStore[] }) {
	const [filter, setFilter] = useState<ShowcaseFilter>('all');
	const withImages = storesWithImages(stores);
	if (!shouldShowShowcase(withImages.length)) return null;
	const filters = showcaseFilters(withImages);
	const activeFilter = filters.includes(filter) ? filter : 'all';
	const layout = showcaseLayout(filterShowcase(withImages, activeFilter));

	return (
		<section id="discover" aria-labelledby="showcase-title" className="scroll-mt-36 bg-public-charcoal py-20 text-white sm:py-28">
			<div className="mx-auto flex max-w-[1296px] flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
				<div className="max-w-2xl">
					<Eyebrow tone="dark">{marketingCopy.common.discover}</Eyebrow>
					<h2 id="showcase-title" className={cn(HEADING_SECTION, 'mt-4 text-balance')}>
						{marketingCopy.home.showcase.title}</h2>
					<p className={cn(LEAD, 'mt-5 text-white/80')}>
						{marketingCopy.home.showcase.description}</p>
				</div>
				{filters.length > 0 && (
					<div role="group" aria-label={marketingCopy.home.showcase.filterLabel} className="flex flex-wrap gap-2">
						{filters.map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={activeFilter === option}
								onClick={() => setFilter(option)}
								className={cn(
									'rounded-full px-4 py-2 text-sm transition-colors',
									activeFilter === option ? 'bg-white text-public-charcoal' : 'bg-white/10 text-white/85 hover:bg-white/20',
								)}
							>
								{showcaseFilterLabel(option)}
							</button>
						))}
					</div>
				)}
			</div>
			<div className="group/edges relative mt-12">
				{layout.kind === 'static' ? (
					<div className="mx-auto flex max-w-[1296px] flex-wrap gap-4 px-4 sm:px-6">
						{layout.row.map((store) => (
							<ShowcaseCard key={store.id} store={store} />
						))}
					</div>
				) : (
					<div className="grid gap-4">
						<Marquee pauseOnHover className="px-0 py-1 [--duration:70s] [--gap:1rem]">
							{layout.rows[0].map((store) => (
								<ShowcaseCard key={store.id} store={store} />
							))}
						</Marquee>
						{/* The same stores in reverse: one set of tab stops and one reading is enough. */}
						<Marquee pauseOnHover reverse aria-hidden className="px-0 py-1 [--duration:80s] [--gap:1rem]">
							{layout.rows[1].map((store) => (
								<ShowcaseCard key={store.id} store={store} focusable={false} />
							))}
						</Marquee>
						<EdgeFades />
					</div>
				)}
			</div>
			<div className="mx-auto mt-10 max-w-[1296px] px-4 sm:px-6">
				<TextLink to="/discover" tone="dark">
					{marketingCopy.home.showcase.link}</TextLink>
			</div>
		</section>
	);
}

/** A store card; `focusable={false}` keeps a repeated card clickable but out of the tab order. */
function ShowcaseCard({ store, focusable = true }: { store: ShowcaseStore; focusable?: boolean }) {
	// Remembers which URL failed, so a re-signed URL from a later fetch gets a fresh try.
	const [failedImage, setFailedImage] = useState<string | null>(null);
	return (
		<Link
			to={`/discover/${store.id}`}
			tabIndex={focusable ? undefined : -1}
			className="group relative block h-[280px] w-[220px] shrink-0 overflow-hidden rounded-[18px] bg-[#2a2a30] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-[360px] sm:w-[280px]"
		>
			{store.imageUrl && failedImage !== store.imageUrl && (
				<img
					src={store.imageUrl}
					alt=""
					loading="lazy"
					onError={() => setFailedImage(store.imageUrl)}
					className={cn(
						'absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none',
						store.tallImage ? 'object-top' : 'object-left-top',
					)}
				/>
			)}
			<span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
			<span
				className={cn(
					'absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold',
					store.isFree ? 'bg-[#047857] text-white' : 'bg-white text-public-charcoal',
				)}
			>
				{store.priceLabel}
			</span>
			<span className="absolute inset-x-4 bottom-4 grid justify-items-start gap-1 text-white">
				{store.categoryLabel && <span className="mb-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs backdrop-blur-sm">{store.categoryLabel}</span>}
				<span className="text-lg leading-tight font-medium">{store.title}</span>
				{store.byline && <span className="text-xs text-white/75">{store.byline}</span>}
			</span>
		</Link>
	);
}
