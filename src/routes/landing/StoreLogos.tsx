import { Link } from 'react-router';
import { Marquee } from '@/components/magicui/marquee';
import { EdgeFades } from '@/components/public-site/primitives';
import { shouldShowShowcase, type ShowcaseStore } from '@/lib/showcase';
import { cn } from '@/lib/utils';

/** Four type treatments, rotated by position, so the names read like a wall of logos. */
const WORDMARK_STYLES = [
	'text-[26px] font-semibold tracking-[-0.03em]',
	'text-[17px] font-medium uppercase tracking-[0.28em]',
	'text-[25px] font-extralight tracking-[0.02em]',
	'text-[21px] font-bold uppercase tracking-[0.02em]',
] as const;

/** Stores built on Estori, where 1Password shows customer logos: real Discover stores only. */
export function StoreLogos({ stores }: { stores: readonly ShowcaseStore[] }) {
	if (!shouldShowShowcase(stores.length)) return null;
	return (
		<section aria-labelledby="store-logos-title" className="border-b border-white/10 bg-public-charcoal py-12 text-white">
			<h2 id="store-logos-title" className="text-center text-xs uppercase tracking-[0.04em] text-white/60">
				Stores built on Estori
			</h2>
			<div className="group/edges relative mt-8">
				<Marquee pauseOnHover className="px-0 py-1 [--duration:60s] [--gap:4rem]">
					{stores.map((store, index) => (
						<Link
							key={store.id}
							to={`/discover/${store.id}`}
							className={cn('whitespace-nowrap text-white/55 transition-colors hover:text-white focus-visible:text-white', WORDMARK_STYLES[index % WORDMARK_STYLES.length])}
						>
							{store.wordmark || store.title}
						</Link>
					))}
				</Marquee>
				<EdgeFades />
			</div>
		</section>
	);
}
