import type { ReactNode } from 'react';
import { pageTitle } from '@/brand';
import { BlurFade } from '@/components/magicui/blur-fade';
import type { CardCopy } from '@/content/positioning';
import type { CapabilityId } from '@/lib/capabilities';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, PillLink } from './primitives';

export function PageMeta({ title, description }: { title: string; description: string }) {
	return (
		<>
			<title>{pageTitle(title)}</title>
			<meta name="description" content={description} />
		</>
	);
}

/** 1Password's solution hero on charcoal: eyebrow and status, headline, lead and actions. */
export function SolutionHero({
	eyebrow,
	title,
	lead,
	tag,
	actions,
}: {
	eyebrow: string;
	title: string;
	lead: string;
	tag?: CapabilityId;
	actions?: ReactNode;
}) {
	return (
		<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
			<div className="flex flex-wrap items-center justify-center gap-3">
				<Eyebrow tone="dark">{eyebrow}</Eyebrow>
				{tag && <CapabilityTag id={tag} tone="dark" />}
			</div>
			<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-4xl text-balance')}>{title}</h1>
			<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-pretty text-white/80')}>{lead}</p>
			<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
				{actions ?? (
					<PillLink to="/#build" variant="white">
						Start building free
					</PillLink>
				)}
			</div>
		</section>
	);
}

/** A titled section of value cards; `id` makes it a link target below the sticky top bar. */
export function CardSection({
	id,
	eyebrow,
	title,
	lead,
	tag,
	cards,
	children,
}: {
	id?: string;
	eyebrow?: string;
	title: string;
	lead?: string;
	tag?: CapabilityId;
	cards: readonly CardCopy[];
	children?: ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto max-w-[1248px]">
				{(eyebrow || tag) && (
					<div className="flex flex-wrap items-center gap-3">
						{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
						{tag && <CapabilityTag id={tag} />}
					</div>
				)}
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>{title}</h2>
				{lead && <p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>{lead}</p>}
				{cards.length > 0 && (
					<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{cards.map((card) => (
							<article key={card.title} className="rounded-[24px] p-7 ring ring-public-line">
								<h3 className={cn(HEADING_CARD, 'text-public-ink')}>{card.title}</h3>
								<p className="mt-3 text-[15px] leading-relaxed font-light text-public-muted">{card.body}</p>
							</article>
						))}
					</div>
				)}
				{children && <div className="mt-10 flex flex-wrap items-center gap-4">{children}</div>}
			</BlurFade>
		</section>
	);
}

export function HowItWorks({ steps }: { steps: readonly string[] }) {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow>How it works</Eyebrow>
				<ol className="mt-8 grid gap-4 md:grid-cols-3">
					{steps.map((step, index) => (
						<li key={step} className="rounded-[24px] bg-public-charcoal p-7 text-white">
							<span className="text-sm text-white/70">Step {index + 1}</span>
							<p className="mt-3 text-xl leading-snug font-light">{step}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
