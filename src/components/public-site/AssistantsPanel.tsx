import { marketingCopy } from '@/content/marketing-copy';
import type { ReactNode } from 'react';
import { SparkleIcon } from '@phosphor-icons/react';
import { ASSISTANTS_HEADING, ASSISTANTS_LEAD, STORE_ASSISTANTS, type StoreAssistant } from '@/content/positioning';
import { useRevealOnce } from '@/hooks/use-reveal-once';
import { cn } from '@/lib/utils';
import { AssistantMock } from './assistant-mocks';
import { CapabilityTag } from './CapabilityTag';
import { HEADING_SECTION, LEAD, PillLink } from './primitives';

/**
 * Plays once when the panel scrolls into view: the glow first, the header at 0.5s, card text at 1s and card
 * pictures at 1.5s, each fading over 0.9s. Reduced motion shows everything at once.
 */
const REVEAL =
	'opacity-0 transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[revealed]/reveal:opacity-100 motion-reduce:opacity-100 motion-reduce:transition-none';

/** The rising horizon behind the header: the lit edge of a huge circle over film grain. Decorative. */
function Glow() {
	return (
		<div
			aria-hidden
			className={cn(REVEAL, 'pointer-events-none absolute inset-0 -translate-y-[10%] group-data-[revealed]/reveal:translate-y-0 motion-reduce:translate-y-0')}
		>
			<div className="absolute top-[29rem] left-1/2 h-[32rem] w-full -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_50%_45%_at_50%_50%,rgba(20,95,228,0.38),transparent_75%)] sm:top-[38%]" />
			{/* On phones the panel is much taller, so the horizon sits at a fixed distance under the button and curves more gently. */}
			<div className="absolute top-[29rem] left-1/2 aspect-square w-[260%] -translate-x-1/2 rounded-full sm:top-[38%] sm:w-[150%] bg-[radial-gradient(closest-side,transparent_86%,rgba(20,95,228,0.22)_95%,rgba(140,185,255,0.75)_99.6%,transparent_100%)] shadow-[0_-24px_120px_-12px_rgba(46,120,255,0.75),inset_0_50px_120px_-50px_rgba(110,168,255,0.55)]" />
			<div className="public-grain absolute inset-0 opacity-[0.12] mix-blend-overlay" />
		</div>
	);
}

function AssistantCard({ assistant }: { assistant: StoreAssistant }) {
	return (
		<article className="flex h-full flex-col justify-between gap-10 overflow-hidden rounded-[14px] border border-white/25 bg-white/[0.08] px-6 pt-8 backdrop-blur-3xl transition-[transform,border-color] duration-[350ms] hover:-translate-y-[38px] hover:border-white motion-reduce:transition-none motion-reduce:hover:translate-y-0">
			<div className={cn(REVEAL, 'grid gap-4 delay-1000')}>
				<p className="flex items-center gap-3 text-lg font-medium">
					<SparkleIcon weight="fill" className="size-6 shrink-0" aria-hidden />
					{assistant.name}
				</p>
				<h3 className="text-2xl leading-tight font-medium text-balance">{assistant.title}</h3>
				<p className="text-base leading-relaxed font-light text-white/80">{assistant.body}</p>
			</div>
			<div aria-hidden className={cn(REVEAL, 'delay-[1500ms]')}>
				<AssistantMock id={assistant.id} />
			</div>
		</article>
	);
}

/** The store assistants on a dark panel with a rising glow and frosted cards; `id` makes it a link target. */
export function AssistantsPanel({ id, action }: { id?: string; action?: ReactNode }) {
	const [ref, revealed] = useRevealOnce<HTMLDivElement>();
	return (
		<section id={id} aria-labelledby="assistants-title" className="scroll-mt-36 bg-white px-3 py-6 sm:px-6">
			<div
				ref={ref}
				data-revealed={revealed || undefined}
				className="group/reveal relative mx-auto max-w-[1392px] overflow-hidden rounded-[25px] bg-[#0f0f12] px-4 pb-4 text-white sm:px-6 sm:pb-6"
			>
				<Glow />
				<div className={cn(REVEAL, 'relative z-10 mx-auto max-w-3xl pt-20 text-center delay-500 sm:pt-28')}>
					<CapabilityTag id="operations-agents" tone="dark" />
					<h2 id="assistants-title" className={cn(HEADING_SECTION, 'mt-5 text-balance')}>
						{ASSISTANTS_HEADING}
					</h2>
					<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-pretty text-white/80')}>{ASSISTANTS_LEAD}</p>
					<div className="mt-10 flex justify-center">
						{action ?? (
							<PillLink to="/solutions/brands#operations" variant="white">
								{marketingCopy.home.assistants.link}</PillLink>
						)}
					</div>
				</div>
				<div className="relative z-10 mt-24 grid gap-4 sm:mt-36 lg:grid-cols-3">
					{STORE_ASSISTANTS.map((assistant) => (
						<AssistantCard key={assistant.id} assistant={assistant} />
					))}
				</div>
			</div>
		</section>
	);
}
