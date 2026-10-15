import { useRef, type Ref } from 'react';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { AGENTIC_COMMERCE_SUMMARY, PERSONALIZATION_CARDS } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_SECTION, LEAD, TextLink } from './primitives';
import { CardSection } from './solution-page';

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
						<Eyebrow>AI recommendations</Eyebrow>
						<CapabilityTag id="agentic-commerce" />
					</div>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Get recommended when shoppers ask AI what to buy</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{AGENTIC_COMMERCE_SUMMARY}</p>
					<TextLink to="/agentic-commerce" className="mt-6">
						How it works
					</TextLink>
				</div>
				<div ref={containerRef} aria-hidden className="relative grid gap-6 sm:grid-cols-3 sm:gap-10">
					<DiagramNode ref={storeRef} label="Your store" />
					<DiagramNode ref={assistantRef} label="An AI assistant" />
					<DiagramNode ref={customerRef} label="A new customer" />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={assistantRef} />
					<AnimatedBeam {...beam} fromRef={assistantRef} toRef={customerRef} delay={0.6} />
				</div>
			</div>
		</section>
	);
}

export function PersonalizationSection({ id }: { id?: string }) {
	return (
		<CardSection
			id={id}
			eyebrow="Personalized shopping"
			tag="personalized-shopping"
			title="Show every shopper the right products"
			lead="Built into your store, with no extra apps to install."
			cards={PERSONALIZATION_CARDS}
		/>
	);
}
