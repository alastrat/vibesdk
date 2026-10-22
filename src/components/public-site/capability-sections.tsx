import { marketingCopy } from '@/content/marketing-copy';
import { useRef, type Ref } from 'react';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { AGENTIC_COMMERCE_SUMMARY, PERSONALIZATION_CARDS } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_SECTION, LEAD, TextLink } from './primitives';
import { ShopperArt } from './shopper-mocks';

function DiagramNode({ ref, label }: { ref: Ref<HTMLDivElement>; label: string }) {
	return (
		<div ref={ref} className="relative z-10 rounded-[14px] bg-white px-4 py-3 text-center text-[15px] text-public-ink ring ring-public-line">
			{label}
		</div>
	);
}

/** Store, assistant, customer: how a store gets recommended when shoppers ask AI. The diagram is decorative; the text explains it. */
export function AgenticCommerceSection({ id }: { id?: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef<HTMLDivElement>(null);
	const assistantRef = useRef<HTMLDivElement>(null);
	const customerRef = useRef<HTMLDivElement>(null);
	const beam = { containerRef, gradientStartColor: '#145fe4', gradientStopColor: '#6ea8ff', pathColor: '#145fe4', className: 'hidden sm:block' };

	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] gap-12 lg:grid-cols-2 lg:items-center">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<Eyebrow>{marketingCopy.home.recommendations.eyebrow}</Eyebrow>
						<CapabilityTag id="agentic-commerce" />
					</div>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>{marketingCopy.home.recommendations.title}</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{AGENTIC_COMMERCE_SUMMARY}</p>
					<TextLink to="/agentic-commerce" className="mt-6">
						{marketingCopy.home.recommendations.link}</TextLink>
				</div>
				<div ref={containerRef} aria-hidden className="relative grid gap-6 sm:grid-cols-3 sm:gap-10">
					<DiagramNode ref={storeRef} label={marketingCopy.home.recommendations.diagram.store} />
					<DiagramNode ref={assistantRef} label={marketingCopy.home.recommendations.diagram.assistant} />
					<DiagramNode ref={customerRef} label={marketingCopy.home.recommendations.diagram.customer} />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={assistantRef} />
					<AnimatedBeam {...beam} fromRef={assistantRef} toRef={customerRef} delay={0.6} />
				</div>
			</div>
		</section>
	);
}

/** 1Password's feature cards, two by two: a heading and a line of text over a store moment drawn in code. */
export function PersonalizationSection({ id }: { id?: string }) {
	return (
		<section id={id} aria-labelledby="personalization-title" className="scroll-mt-36 bg-white px-3 py-6 sm:px-6">
			<div className="mx-auto max-w-[1392px] rounded-[25px] bg-[#f2f2f3] px-3 pt-16 pb-3 sm:px-6 sm:pt-24 sm:pb-6">
				<div className="mx-auto max-w-[1248px] px-3 sm:px-0">
					<div className="flex flex-wrap items-center gap-3">
						<Eyebrow>{marketingCopy.home.personalization.eyebrow}</Eyebrow>
						<CapabilityTag id="personalized-shopping" />
					</div>
					<h2 id="personalization-title" className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>
						{marketingCopy.home.personalization.title}</h2>
					<p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>{marketingCopy.home.personalization.description}</p>
				</div>
				<div className="mx-auto mt-12 grid max-w-[1248px] gap-3 sm:mt-16 md:grid-cols-2 md:gap-8">
					{PERSONALIZATION_CARDS.map((card) => (
						// The subgrid lines titles, text and pictures up across each row.
						<article key={card.id} className="flex flex-col overflow-hidden rounded-[25px] bg-white md:row-span-3 md:grid md:grid-rows-subgrid md:gap-0">
							<h3 className="max-w-[calc(12em+6rem)] px-6 pt-8 text-[28px] leading-[1.2] font-light tracking-[-0.02em] text-balance text-public-ink sm:px-12 sm:pt-12 sm:text-4xl xl:text-[40px]">
								{card.title}
							</h3>
							<p className="px-6 pt-4 text-lg leading-relaxed font-light text-pretty text-public-ink/80 sm:px-12 sm:text-xl">{card.body}</p>
							<ShopperArt id={card.id} />
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
