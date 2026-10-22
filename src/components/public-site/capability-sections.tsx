import { marketingCopy } from '@/content/marketing-copy';
import { PERSONALIZATION_CARDS } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_SECTION, LEAD } from './primitives';
import { ShopperArt } from './shopper-mocks';

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
