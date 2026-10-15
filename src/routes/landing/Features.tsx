import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { DeviceSwitch, FeatureArt, PreviewArt, PreviewStory } from '@/components/public-site/feature-art';
import { Eyebrow, HEADING_SECTION, LEAD } from '@/components/public-site/primitives';
import { STORE_FEATURES, type StoreFeature } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { StartBuildingButton } from '@/components/public-site/StartBuildingButton';

/** Vori's product card: light gray with a hairline border, a picture at the bottom, and a tab that rises on hover. */
function FeatureCard({ feature, art, aside, storyRef }: { feature: StoreFeature; art: ReactNode; aside?: ReactNode; storyRef?: Ref<HTMLElement> }) {
	return (
		<article ref={storyRef} className="group relative h-full rounded-[16px] transition-shadow duration-300 hover:shadow-[0_4px_12px_2px_rgba(0,0,0,0.08)] motion-reduce:transition-none">
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
					<div className="mt-3 flex min-h-6 w-full items-center justify-between gap-3">
						{feature.link && (
							<Link
								to={feature.link.to}
								className="inline-flex items-center gap-2 text-[15px] font-medium text-public-ink after:absolute after:inset-0 after:rounded-[16px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-public-blue"
							>
								{feature.link.label}
								<span className="grid size-6 place-items-center rounded-[5px] transition-colors duration-300 group-hover:bg-public-blue group-hover:text-white motion-reduce:transition-none">
									<ArrowRightIcon weight="bold" className="size-3.5" />
								</span>
							</Link>
						)}
						{aside}
					</div>
				</div>
				{art}
			</div>
		</article>
	);
}

type SectionTone = 'light' | 'dark';

/** The section around the cards: white as on Vori, or the charcoal the landing page used before. */
const TONES: Readonly<Record<SectionTone, { section: string; heading: string; lead: string; action: 'blue' | 'white' }>> = {
	light: { section: 'border-t border-public-line bg-white', heading: 'text-public-ink', lead: 'text-public-muted', action: 'blue' },
	dark: { section: 'bg-public-charcoal', heading: 'text-white', lead: 'text-white/80', action: 'white' },
};

/** What every store has today, in Vori's layout: the heading on the left, the action on the right, and six cards. */
export function Features({ tone = 'light' }: { tone?: SectionTone }) {
	const colors = TONES[tone];
	return (
		<section className={cn(colors.section, 'px-4 py-20 sm:px-6 sm:py-28')}>
			<div className="mx-auto max-w-[1248px]">
				<div className="flex flex-wrap items-end justify-between gap-8">
					<div className="max-w-3xl">
						<Eyebrow tone={tone}>Estori store builder</Eyebrow>
						<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance', colors.heading)}>What your store comes with today</h2>
						<p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty', colors.lead)}>
							Start from scratch or from a store in Discover, then change anything by chatting.
						</p>
					</div>
					<StartBuildingButton variant={colors.action} />
				</div>
				{/* Row gaps leave room for the tab each card raises on hover. */}
				<div className="mt-16 grid grid-cols-1 gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
					{STORE_FEATURES.map((feature) =>
						feature.id === 'preview' ? (
							<PreviewStory key={feature.id}>
								{(storyRef, phone) => (
									<FeatureCard
										feature={feature}
										storyRef={storyRef}
										aside={<DeviceSwitch phone={phone} />}
										art={<PreviewArt phone={phone} />}
									/>
								)}
							</PreviewStory>
						) : (
							<FeatureCard key={feature.id} feature={feature} art={<FeatureArt id={feature.id} />} />
						),
					)}
				</div>
			</div>
		</section>
	);
}
