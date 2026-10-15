import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { FeatureArt } from '@/components/public-site/feature-art';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { STORE_FEATURES, type StoreFeature } from '@/content/positioning';
import { cn } from '@/lib/utils';

/** Vori's product card: light gray with a hairline border, a picture at the bottom, and a tab that rises on hover. */
function FeatureCard({ feature }: { feature: StoreFeature }) {
	return (
		<article className="group relative h-full rounded-[16px] transition-shadow duration-300 hover:shadow-[0_4px_12px_2px_rgba(0,0,0,0.08)] motion-reduce:transition-none">
			{/* Sits behind the card, so only its top peeks out above the card's edge. */}
			<span
				aria-hidden
				className="absolute inset-x-0 top-0 h-24 -translate-y-[40%] rounded-t-[16px] bg-[#dbe8fb] px-7 pt-2 font-mono text-[13px] text-public-blue opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
			>
				{feature.tag}
			</span>
			<div className="relative flex h-full flex-col overflow-hidden rounded-[16px] border border-public-line bg-[#fafafa]">
				<div className="flex flex-col items-start gap-3 p-7">
					<h3 className="text-[19px] leading-snug font-medium text-public-ink">{feature.title}</h3>
					<p className="text-[15px] leading-relaxed font-light text-public-muted">{feature.body}</p>
					<Link
						to={feature.link.to}
						className="mt-3 inline-flex items-center gap-2 text-[15px] font-medium text-public-ink after:absolute after:inset-0 after:rounded-[16px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-public-blue"
					>
						{feature.link.label}
						<span className="grid size-6 place-items-center rounded-[5px] transition-colors duration-300 group-hover:bg-public-blue group-hover:text-white motion-reduce:transition-none">
							<ArrowRightIcon weight="bold" className="size-3.5" />
						</span>
					</Link>
				</div>
				<FeatureArt id={feature.id} />
			</div>
		</article>
	);
}

/** What every store has today, in Vori's layout: the heading on the left, the action on the right, and six cards. */
export function Features() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<div className="flex flex-wrap items-end justify-between gap-8">
					<div className="max-w-3xl">
						<Eyebrow>Estori store builder</Eyebrow>
						<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>What your store comes with today</h2>
						<p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>
							Start from scratch or from a store in Discover, then change anything by chatting.
						</p>
					</div>
					<PillLink to="/#build" variant="blue">
						Start building free
					</PillLink>
				</div>
				{/* Row gaps leave room for the tab each card raises on hover. */}
				<div className="mt-16 grid grid-cols-1 gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
					{STORE_FEATURES.map((feature) => (
						<FeatureCard key={feature.id} feature={feature} />
					))}
				</div>
				<p className="mt-14 flex flex-wrap items-center gap-3 text-sm text-public-muted">
					Accept payments in your store <ComingSoon />
				</p>
			</div>
		</section>
	);
}
