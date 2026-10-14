import { useRef, type Ref } from 'react';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { AGENTIC_COMMERCE_SUMMARY, OPERATIONS_CARDS, PERSONALIZATION_CARDS } from '@/content/positioning';
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

/** Store, standards, assistants: how a store reaches shoppers who ask AI. The diagram is decorative; the text explains it. */
export function AgenticCommerceSection({ id }: { id?: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef<HTMLDivElement>(null);
	const standardsRef = useRef<HTMLDivElement>(null);
	const assistantsRef = useRef<HTMLDivElement>(null);
	const beam = { containerRef, gradientStartColor: '#145fe4', gradientStopColor: '#6ea8ff', pathColor: '#145fe4', className: 'hidden sm:block' };

	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] gap-12 lg:grid-cols-2 lg:items-center">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<Eyebrow>Agentic commerce</Eyebrow>
						<CapabilityTag id="agentic-commerce" />
					</div>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Sell wherever shoppers ask AI</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{AGENTIC_COMMERCE_SUMMARY}</p>
					<TextLink to="/agentic-commerce" className="mt-6">
						How agentic commerce works
					</TextLink>
				</div>
				<div ref={containerRef} aria-hidden className="relative grid gap-6 sm:grid-cols-3 sm:gap-10">
					<DiagramNode ref={storeRef} label="Your store" />
					<DiagramNode ref={standardsRef} label="Open standards" />
					<DiagramNode ref={assistantsRef} label="AI assistants" />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={standardsRef} />
					<AnimatedBeam {...beam} fromRef={standardsRef} toRef={assistantsRef} delay={0.6} />
				</div>
			</div>
		</section>
	);
}

export function OperationsSection({ id }: { id?: string }) {
	return (
		<CardSection
			id={id}
			eyebrow="Operations agents"
			tag="operations-agents"
			title="Agents that help run your store"
			lead="The day-to-day work of a store, handled by agents that know your catalog and your customers."
			cards={OPERATIONS_CARDS}
		/>
	);
}

export function PersonalizationSection({ id }: { id?: string }) {
	return (
		<CardSection
			id={id}
			eyebrow="Personalized shopping"
			tag="personalized-shopping"
			title="Shopping that adapts to every customer"
			lead="Built into the store, with no apps to add."
			cards={PERSONALIZATION_CARDS}
		/>
	);
}
